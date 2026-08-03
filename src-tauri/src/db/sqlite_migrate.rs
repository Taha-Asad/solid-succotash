// // // db/sqlite_migrate.rs
// // // This file handles running SQLite migrations.
// // // It reads .sql files from migrations/sqlite/ and runs them in order.

// // use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
// // use sqlx::{query, AssertSqlSafe};
// // use std::fs;
// // use std::path::Path;
// // use std::str::FromStr;
// // // What this function does (in plain English):
// // // 1. Connect to the SQLite database file
// // // 2. Create a "_migrations" table to track which migrations have run
// // // 3. Read all .sql files from migrations/sqlite/
// // // 4. Sort them by filename (001 before 002)
// // // 5. For each file, check if it already ran
// // // 6. If not, run it, then record it in _migrations table
// // pub async fn run_sqlite_migrations(db_path: &str) -> Result<(), String> {
// //     println!("[SQLite] Connecting to: {}", db_path);

// //     // Connect to SQLite
// //     let options = SqliteConnectOptions::from_str(db_path)
// //         .map_err(|e| format!("Invalid SQLite URL: {}", e))?
// //         .create_if_missing(true);

// //     let pool = SqlitePool::connect_with(options)
// //         .await
// //         .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;

// //     // Create the _migrations table (if it doesn't exist)
// //     query(
// //         "CREATE TABLE IF NOT EXISTS _migrations (
// //             version INTEGER PRIMARY KEY,
// //             name TEXT NOT NULL,
// //             applied_at TEXT DEFAULT CURRENT_TIMESTAMP
// //         )",
// //     )
// //     .execute(&pool)
// //     .await
// //     .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

// //     // Read all .sql files from migrations/sqlite/
// //     let migrations_dir = Path::new("migrations/sqlite");

// //     if !migrations_dir.exists() {
// //         return Err("migrations/sqlite folder not found".to_string());
// //     }

// //     let mut migrations: Vec<(i32, String)> = Vec::new();

// //     for entry in fs::read_dir(migrations_dir)
// //         .map_err(|e| format!("Failed to read migrations directory: {}", e))?
// //     {
// //         let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
// //         let file_name = entry.file_name().to_string_lossy().to_string();

// //         if file_name.ends_with(".sql") {
// //             let version_str = file_name.split('_').next().unwrap_or("0");

// //             if let Ok(version) = version_str.parse::<i32>() {
// //                 migrations.push((version, file_name));
// //             }
// //         }
// //     }

// //     migrations.sort_by_key(|(version, _)| *version);

// //     for (version, file_name) in migrations {
// //         let already_applied = query("SELECT 1 FROM _migrations WHERE version = ? LIMIT 1")
// //             .bind(version)
// //             .fetch_optional(&pool)
// //             .await
// //             .map_err(|e| format!("Failed to check migration {}: {}", file_name, e))?;

// //         if already_applied.is_some() {
// //             println!("[migrations] Skipping {} (already applied)", file_name);
// //             continue;
// //         }

// //         let file_path = migrations_dir.join(&file_name);

// //         let sql = fs::read_to_string(&file_path)
// //             .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

// //         // Execute migration SQL
// //         query(AssertSqlSafe(sql.as_str()))
// //             .execute(&pool)
// //             .await
// //             .map_err(|e| format!("Failed to run migration {}: {}", file_name, e))?;

// //         // Record migration
// //         query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
// //             .bind(version)
// //             .bind(&file_name)
// //             .execute(&pool)
// //             .await
// //             .map_err(|e| format!("Failed to record migration {}: {}", file_name, e))?;

// //         println!("[migrations] ✅ Applied {}", file_name);
// //     }

// //     Ok(())
// // }
// // ==========================================
// // SQLite Migration Runner
// // ==========================================
// //
// // Runs all unapplied .sql migration files in order.
// // Tracks which migrations have been applied in a _migrations table.
// //
// // DATABASE LOCATION:
// //   Development:  ./ijazandcompany.db  (project folder)
// //   Production:   App data directory   (user's AppData on Windows)
// //
// // Tauri automatically resolves the app data directory differently
// // for dev vs production builds.
// // ==========================================
// // SQLite Migration Runner
// // ==========================================
// //
// // Migrations are EMBEDDED in the binary using include_str!().
// // This means:
// //   - No external files needed at runtime
// //   - The .exe is fully self-contained
// //   - Works in both development and production
// //
// // DATABASE LOCATION:
// //   Windows: C:\Users\<user>\AppData\Roaming\com.ijazandcompany.erp\ijazandcompany.db
// //   macOS:   ~/Library/Application Support/com.ijazandcompany.erp/ijazandcompany.db
// //   Linux:   ~/.local/share/com.ijazandcompany.erp/ijazandcompany.db

// use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
// use std::{path::PathBuf, str::FromStr};

// /// Gets the correct database path for the current environment.
// pub fn get_database_path() -> String {
//     let app_data = dirs
//         ::data_dir()
//         .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
//         .unwrap_or_else(|| PathBuf::from("."));

//     let db_dir = app_data.join("ijazandcompany-erp");

//     // Create the directory if it doesn't exist
//     if let Err(e) = std::fs::create_dir_all(&db_dir) {
//         eprintln!("Warning: could not create db directory: {e}");
//     }

//     let db_path = db_dir.join("ijazandcompany.db");

//     // Return as SQLite URL
//     let url =format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
//     url
// }

// /// Each migration: (version_number, name, SQL_content)
// /// The SQL is embedded at compile time using include_str!().
// /// Paths are relative to THIS source file's location.
// fn get_embedded_migrations() -> Vec<(i64, &'static str, &'static str)> {
//     vec![
//         (1, "001_create_users", include_str!("../../migrations/sqlite/001_create_users.sql")),
//         (
//             2,
//             "002_create_companies",
//             include_str!("../../migrations/sqlite/002_create_companies.sql"),
//         ),
//         (
//             3,
//             "003_create_inventory",
//             include_str!("../../migrations/sqlite/003_create_inventory.sql"),
//         ),
//         (4, "004_create_invoices", include_str!("../../migrations/sqlite/004_create_invoices.sql")),
//         (
//             5,
//             "005_persistent_session",
//             include_str!("../../migrations/sqlite/005_persistent_session.sql"),
//         )
//     ]
// }

// /// Runs all unapplied migrations from the embedded SQL strings.
// pub async fn run_sqlite_migrations(sqlite_url: &str) -> Result<(), Box<dyn std::error::Error>> {
//     println!("SQLite URL: {}", sqlite_url);
//     println!(
//         "DB exists: {}",
//         std::path::Path::new(sqlite_url.trim_start_matches("sqlite:")).exists()
//     );
//     // Connect to the database (creates the .db file if it doesn't exist)
// // Create the database if it doesn't already exist
// let options = SqliteConnectOptions::from_str(sqlite_url)?
//     .create_if_missing(true);

// let pool = SqlitePool::connect_with(options).await?;
//     // Create migration tracking table if it doesn't exist
//     sqlx
//         ::query(
//             r#"
//         CREATE TABLE IF NOT EXISTS _migrations (
//             version INTEGER PRIMARY KEY,
//             name TEXT NOT NULL,
//             applied_at TEXT DEFAULT CURRENT_TIMESTAMP
//         )
//         "#
//         )
//         .execute(&pool).await?;

//     // Get embedded migrations
//     let migrations = get_embedded_migrations();

//     // Get already-applied migrations
//     let applied: Vec<i64> = sqlx
//         ::query_scalar("SELECT version FROM _migrations ORDER BY version")
//         .fetch_all(&pool).await?;

//     // Run unapplied migrations
//     for (version, name, sql) in &migrations {
//         if applied.contains(version) {
//             continue;
//         }

//         println!("Applying migration {version}: {name}");

//         // Execute the migration SQL
//         // Split by semicolons to handle multiple statements
//         for statement in sql.split(';') {
//             let trimmed = statement.trim();
//             // Skip empty strings, comments, and very short fragments
//             if !trimmed.is_empty() && !trimmed.starts_with("--") && trimmed.len() > 5 {
//                 match sqlx::raw_sql(trimmed).execute(&pool).await {
//                     Ok(_) => {}
//                     Err(e) => {
//                         let msg = e.to_string();
//                         // "already exists" errors are OK (CREATE IF NOT EXISTS)
//                         if !msg.contains("already exists") {
//                             eprintln!("  Warning in migration {version}: {msg}");
//                         }
//                     }
//                 }
//             }
//         }

//         // Record the migration
//         sqlx
//             ::query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
//             .bind(version)
//             .bind(name)
//             .execute(&pool).await?;

//         println!("✓ Applied");
//     }

//     pool.close().await;
//     Ok(())
// }

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
    ]
}

pub async fn run_sqlite_migrations(
    sqlite_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("SQLite URL: {sqlite_url}");

    let options = SqliteConnectOptions::from_str(sqlite_url)?
        .create_if_missing(true);

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

    let applied: Vec<i64> = sqlx::query_scalar(
        "SELECT version FROM _migrations ORDER BY version",
    )
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
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await?;

        sqlx::query(
            "INSERT OR REPLACE INTO _migrations(version,name) VALUES(?,?)",
        )
        .bind(version)
        .bind(name)
        .execute(&pool)
        .await?;

        println!("Migration {version} applied successfully.");
    }

    ensure_category_columns(&pool).await?;
    ensure_invoice_item_columns(&pool).await?;

    let _ = applied;

    pool.close().await;

    Ok(())
}

/// Adds columns that were introduced after the original CREATE TABLE.
/// The migration runner re-executes every file on startup, so plain
/// `ALTER TABLE ... ADD COLUMN` cannot live in a .sql file (it would
/// fail on the second run). Instead we check the live table once and
/// add any missing column here.
async fn ensure_category_columns(
    pool: &SqlitePool,
) -> Result<(), Box<dyn std::error::Error>> {
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
async fn ensure_invoice_item_columns(
    pool: &SqlitePool,
) -> Result<(), Box<dyn std::error::Error>> {
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
