use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::Row;
use std::path::PathBuf;
use std::str::FromStr;

/// Gets the correct database path.
pub fn get_database_path() -> String {
    let app_data = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));

    let db_dir = app_data.join("ijazandcompany-erp");

    if let Err(e) = std::fs::create_dir_all(&db_dir) {
        panic!("Failed to create database directory: {e}");
    }
    let db_path = db_dir.join("ijazandcompany.db");

    println!("Database directory: {}", db_dir.display());
    println!("Database file: {}", db_path.display());

    format!("sqlite:{}", db_path.to_string_lossy())
}

fn get_embedded_migrations() -> Vec<(i64, &'static str, &'static str)> {
    vec![
        (
            1,
            "001_create_users",
            include_str!("../../migrations/sqlite/001_create_users.sql"),
        ),
        (
            2,
            "002_create_companies",
            include_str!("../../migrations/sqlite/002_create_companies.sql"),
        ),
        (
            3,
            "003_create_inventory",
            include_str!("../../migrations/sqlite/003_create_inventory.sql"),
        ),
        (
            4,
            "004_create_invoices",
            include_str!("../../migrations/sqlite/004_create_invoices.sql"),
        ),
        (
            5,
            "005_persistent_session",
            include_str!("../../migrations/sqlite/005_persistent_session.sql"),
        ),
        (
            6,
            "006_expiry_batches",
            include_str!("../../migrations/sqlite/006_expiry_batches.sql"),
        ),
        (
            7,
            "007_purchase_orders",
            include_str!("../../migrations/sqlite/007_purchase_orders.sql"),
        ),
        (
            8,
            "008_audit_log",
            include_str!("../../migrations/sqlite/008_audit_log.sql"),
        ),
        (
            9,
            "009_soft_delete_versioning",
            include_str!("../../migrations/sqlite/009_soft_delete_versioning.sql"),
        ),
    ]
}

pub async fn run_sqlite_migrations(sqlite_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("SQLite URL: {sqlite_url}");

    let options = SqliteConnectOptions::from_str(sqlite_url)?.create_if_missing(true);

    let pool = SqlitePool::connect_with(options).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await?;

    let applied: Vec<i64> = sqlx::query_scalar("SELECT version FROM _migrations ORDER BY version")
        .fetch_all(&pool)
        .await?;

    // Every migration file is idempotent (all statements use
    // CREATE ... IF NOT EXISTS), so it is safe to re-run them on every
    // startup. This self-heals databases where the _migrations table
    // recorded a version without the schema actually being created.
    for (version, name, sql) in get_embedded_migrations() {
        println!("==============================");
        println!("Applying migration {version}");
        println!("{name}");
        println!("==============================");

        // Execute ENTIRE migration file.
        // Do NOT split on ';'
        sqlx::raw_sql(sql).execute(&pool).await?;

        sqlx::query("INSERT OR REPLACE INTO _migrations(version,name) VALUES(?,?)")
            .bind(version)
            .bind(name)
            .execute(&pool)
            .await?;

        println!("Migration {version} applied successfully.");
    }

    ensure_category_columns(&pool).await?;
    ensure_invoice_item_columns(&pool).await?;
    ensure_soft_delete_columns(&pool).await?;

    let _ = applied;

    pool.close().await;

    Ok(())
}

/// Adds columns that were introduced after the original CREATE TABLE.
/// The migration runner re-executes every file on startup, so plain
/// `ALTER TABLE ... ADD COLUMN` cannot live in a .sql file (it would
/// fail on the second run). Instead we check the live table once and
/// add any missing column here.
async fn ensure_category_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(categories)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "sku_prefix") {
        println!("Adding categories.sku_prefix column (old database)");
        sqlx::raw_sql("ALTER TABLE categories ADD COLUMN sku_prefix TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Adds columns introduced after the original invoice_items CREATE TABLE.
async fn ensure_invoice_item_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(invoice_items)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "discount_type") {
        println!("Adding invoice_items.discount_type column (old database)");
        sqlx::raw_sql(
            "ALTER TABLE invoice_items ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'percent'",
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Adds the soft-delete/version columns declared by migration 009.
/// The migration runner re-executes every file on startup, so plain
/// `ALTER TABLE ... ADD COLUMN` cannot live in a .sql file (it would
/// fail on the second run). Instead we check each live table once and
/// add any missing column here.
async fn ensure_soft_delete_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    for table in [
        "products",
        "customers",
        "categories",
        "suppliers",
        "invoices",
        "purchase_orders",
        "users",
    ] {
        let info_sql = format!("PRAGMA table_info({table})");
        let columns: Vec<String> =
            sqlx::query(sqlx::AssertSqlSafe(&*info_sql))
                .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
                .fetch_all(pool)
                .await?;

        if !columns.iter().any(|c| c == "deleted_at") {
            println!("Adding {table}.deleted_at column (old database)");
            let alter_sql = format!("ALTER TABLE {table} ADD COLUMN deleted_at TEXT");
            sqlx::raw_sql(sqlx::AssertSqlSafe(&*alter_sql))
                .execute(pool)
                .await?;
        }

        if !columns.iter().any(|c| c == "version") {
            println!("Adding {table}.version column (old database)");
            let alter_sql =
                format!("ALTER TABLE {table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
            sqlx::raw_sql(sqlx::AssertSqlSafe(&*alter_sql))
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}
