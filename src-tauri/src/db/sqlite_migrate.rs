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
        (
            10,
            "010_fts5_search",
            include_str!("../../migrations/sqlite/010_fts5_search.sql"),
        ),
        (
            11,
            "011_theme_settings",
            include_str!("../../migrations/sqlite/011_theme_settings.sql"),
        ),
        (
            12,
            "012_accounting_ledger",
            include_str!("../../migrations/sqlite/012_accounting_ledger.sql"),
        ),
        (
            13,
            "013_custom_roles",
            include_str!("../../migrations/sqlite/013_custom_roles.sql"),
        ),
        (
            14,
            "014_import_batches_and_units",
            include_str!("../../migrations/sqlite/014_import_batches_and_units.sql"),
        ),
        (
            15,
            "015_invoice_designs",
            include_str!("../../migrations/sqlite/015_invoice_designs.sql"),
        ),
        (
            16,
            "016_import_jobs_target",
            include_str!("../../migrations/sqlite/016_import_jobs_target.sql"),
        ),
        (
            17,
            "017_saas_infrastructure",
            include_str!("../../migrations/sqlite/017_saas_infrastructure.sql"),
        ),
        (
            18,
            "018_multi_currency",
            include_str!("../../migrations/sqlite/018_multi_currency.sql"),
        ),
        (
            19,
            "019_fbr_integration",
            include_str!("../../migrations/sqlite/019_fbr_integration.sql"),
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

        // Migrations 010/011 (FTS5 search, theme) reference the soft-delete
        // columns declared by migration 009, so the ALTER-based helpers must
        // run before those migrations are applied. Otherwise a fresh or old
        // database fails with "no such column: deleted_at".
        if version == 9 {
            ensure_category_columns(&pool).await?;
            ensure_invoice_item_columns(&pool).await?;
            ensure_soft_delete_columns(&pool).await?;
        }

        if version == 14 {
            ensure_import_columns(&pool).await?;
        }
    }

    ensure_batch_number_column(&pool).await?;
    ensure_invoice_design_columns(&pool).await?;
    ensure_import_job_columns(&pool).await?;
    ensure_import_template_columns(&pool).await?;
    ensure_saas_columns(&pool).await?;
    ensure_multi_currency_columns(&pool).await?;
    ensure_fbr_columns(&pool).await?;

    let _ = applied;

    pool.close().await;

    Ok(())
}

/// Adds the `stock_batches.batch_number` column that backs batch labelling
/// (migration 006 now declares it in the CREATE TABLE for fresh databases).
/// Idempotent — same PRAGMA check as the other ensure_* helpers.
async fn ensure_batch_number_column(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(stock_batches)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "batch_number") {
        println!("Adding stock_batches.batch_number column (old database)");
        sqlx::raw_sql("ALTER TABLE stock_batches ADD COLUMN batch_number TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Adds the multi-tenant / SaaS columns introduced by migration 017
/// (spec §3.10, §3.11). SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
/// EXISTS`, and the migration runner re-executes files on startup, so each
/// column is added from Rust once. Idempotent — same PRAGMA check as the
/// other ensure_* helpers.
async fn ensure_saas_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    // users: super-admin flag + forced-password-change flag
    // (token_version and deleted_at already exist on users).
    let user_columns: Vec<String> = sqlx::query("PRAGMA table_info(users)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !user_columns.iter().any(|c| c == "is_super_admin") {
        println!("Adding users.is_super_admin column (old database)");
        sqlx::raw_sql("ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !user_columns.iter().any(|c| c == "must_change_password") {
        println!("Adding users.must_change_password column (old database)");
        sqlx::raw_sql("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }

    // companies: soft-delete/version + FBR fields (is_active already exists).
    let company_columns: Vec<String> = sqlx::query("PRAGMA table_info(companies)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !company_columns.iter().any(|c| c == "deleted_at") {
        println!("Adding companies.deleted_at column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN deleted_at TEXT")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "version") {
        println!("Adding companies.version column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "ntn") {
        println!("Adding companies.ntn column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN ntn TEXT")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "strn") {
        println!("Adding companies.strn column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN strn TEXT")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "fbr_registered") {
        println!("Adding companies.fbr_registered column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN fbr_registered INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "fbr_registration_date") {
        println!("Adding companies.fbr_registration_date column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN fbr_registration_date TEXT")
            .execute(pool)
            .await?;
    }
    if !company_columns.iter().any(|c| c == "province") {
        println!("Adding companies.province column (old database)");
        sqlx::raw_sql("ALTER TABLE companies ADD COLUMN province TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Adds the invoice-design columns introduced by migration 015. SQLite has
/// no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and the migration runner
/// re-executes files on startup, so the columns are added from Rust once.
async fn ensure_invoice_design_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(company_invoice_settings)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "invoice_design") {
        println!("Adding company_invoice_settings.invoice_design column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN invoice_design TEXT NOT NULL DEFAULT 'classic'")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "design_accent_color") {
        println!("Adding company_invoice_settings.design_accent_color column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN design_accent_color TEXT NOT NULL DEFAULT '#1d2b54'")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "show_qr") {
        println!("Adding company_invoice_settings.show_qr column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN show_qr INTEGER NOT NULL DEFAULT 1")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "excel_template_base64") {
        println!("Adding company_invoice_settings.excel_template_base64 column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN excel_template_base64 TEXT")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "disclaimer") {
        println!("Adding company_invoice_settings.disclaimer column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN disclaimer TEXT")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "copyright") {
        println!("Adding company_invoice_settings.copyright column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN copyright TEXT")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "bank_details") {
        println!("Adding company_invoice_settings.bank_details column (old database)");
        sqlx::raw_sql("ALTER TABLE company_invoice_settings ADD COLUMN bank_details TEXT")
            .execute(pool)
            .await?;
    }

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
        let columns: Vec<String> = sqlx::query(sqlx::AssertSqlSafe(&*info_sql))
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

/// Adds the `import_batch_id` columns that back import rollback
/// (migration 014). Idempotent — same PRAGMA check as the other
/// ensure_* helpers.
///
/// The invoice / purchase-bill tables were added here when the sales-invoice
/// and purchase-bill import targets (§23.2) shipped, so imported records can
/// be removed by `rollback_import`.
async fn ensure_import_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    for table in [
        "products",
        "customers",
        "suppliers",
        "invoices",
        "invoice_items",
        "purchase_orders",
        "purchase_order_items",
    ] {
        let info_sql = format!("PRAGMA table_info({table})");
        let columns: Vec<String> = sqlx::query(sqlx::AssertSqlSafe(&*info_sql))
            .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
            .fetch_all(pool)
            .await?;

        if !columns.iter().any(|c| c == "import_batch_id") {
            println!("Adding {table}.import_batch_id column (old database)");
            let alter_sql = format!("ALTER TABLE {table} ADD COLUMN import_batch_id TEXT");
            sqlx::raw_sql(sqlx::AssertSqlSafe(&*alter_sql))
                .execute(pool)
                .await?;
        }
    }

    for table in ["stock_movements", "stock_batches"] {
        let info_sql = format!("PRAGMA table_info({table})");
        let columns: Vec<String> = sqlx::query(sqlx::AssertSqlSafe(&*info_sql))
            .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
            .fetch_all(pool)
            .await?;

        if !columns.iter().any(|c| c == "import_batch_id") {
            println!("Adding {table}.import_batch_id column (old database)");
            let alter_sql = format!("ALTER TABLE {table} ADD COLUMN import_batch_id TEXT");
            sqlx::raw_sql(sqlx::AssertSqlSafe(&*alter_sql))
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

/// Adds the `import_jobs` columns that were introduced after the original
/// CREATE TABLE. SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so
/// each column is added from Rust once. Idempotent — same PRAGMA check as the
/// other ensure_* helpers.
///
/// - `target`        (migration 016): what kind of data the job imported.
/// - `attempted_rows`: rows processed so far — drives the live progress bar
///   reported by `get_import_job`.
/// - `result_json`: the full `ImportResult` of a finished job, so a polled
///   client can render the same result screen as the old synchronous flow.
async fn ensure_import_job_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(import_jobs)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "target") {
        println!("Adding import_jobs.target column (old database)");
        sqlx::raw_sql("ALTER TABLE import_jobs ADD COLUMN target TEXT NOT NULL DEFAULT 'products'")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "attempted_rows") {
        println!("Adding import_jobs.attempted_rows column (old database)");
        sqlx::raw_sql("ALTER TABLE import_jobs ADD COLUMN attempted_rows INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "result_json") {
        println!("Adding import_jobs.result_json column (old database)");
        sqlx::raw_sql("ALTER TABLE import_jobs ADD COLUMN result_json TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Adds the `import_templates` columns required for per-target reusable
/// templates (spec §23.5). Introduced after the original CREATE TABLE, so each
/// column is added from Rust once. Idempotent — same PRAGMA check as the other
/// ensure_* helpers.
///
/// - `target`: what the template maps ("products", "customers", "suppliers",
///   "invoices", "purchase_bills", ...). Templates are matched against the
///   current import target only.
/// - `use_count`: how many times the template has been auto-reused.
/// - `last_used_at`: ISO timestamp of the most recent reuse (NULL until used).
async fn ensure_import_template_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let columns: Vec<String> = sqlx::query("PRAGMA table_info(import_templates)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !columns.iter().any(|c| c == "target") {
        println!("Adding import_templates.target column (old database)");
        sqlx::raw_sql("ALTER TABLE import_templates ADD COLUMN target TEXT NOT NULL DEFAULT 'products'")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "use_count") {
        println!("Adding import_templates.use_count column (old database)");
        sqlx::raw_sql("ALTER TABLE import_templates ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !columns.iter().any(|c| c == "last_used_at") {
        println!("Adding import_templates.last_used_at column (old database)");
        sqlx::raw_sql("ALTER TABLE import_templates ADD COLUMN last_used_at TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Adds the multi-currency columns introduced by migration 018.
/// - `invoices.currency_code`, `invoices.exchange_rate`
/// - `invoice_items.original_unit_price`, `invoice_items.original_line_total`
/// - `payment_records.currency_code`, `payment_records.exchange_rate`, `payment_records.base_currency_amount`
async fn ensure_multi_currency_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    // invoices: currency code + exchange rate
    let invoice_columns: Vec<String> = sqlx::query("PRAGMA table_info(invoices)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !invoice_columns.iter().any(|c| c == "currency_code") {
        println!("Adding invoices.currency_code column (old database)");
        sqlx::raw_sql("ALTER TABLE invoices ADD COLUMN currency_code TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await?;
    }
    if !invoice_columns.iter().any(|c| c == "exchange_rate") {
        println!("Adding invoices.exchange_rate column (old database)");
        sqlx::raw_sql("ALTER TABLE invoices ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0")
            .execute(pool)
            .await?;
    }

    // invoice_items: original price in invoice currency
    let item_columns: Vec<String> = sqlx::query("PRAGMA table_info(invoice_items)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !item_columns.iter().any(|c| c == "original_unit_price") {
        println!("Adding invoice_items.original_unit_price column (old database)");
        sqlx::raw_sql("ALTER TABLE invoice_items ADD COLUMN original_unit_price INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !item_columns.iter().any(|c| c == "original_line_total") {
        println!("Adding invoice_items.original_line_total column (old database)");
        sqlx::raw_sql("ALTER TABLE invoice_items ADD COLUMN original_line_total INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }

    // payment_records: currency info
    let payment_columns: Vec<String> = sqlx::query("PRAGMA table_info(payment_records)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !payment_columns.iter().any(|c| c == "currency_code") {
        println!("Adding payment_records.currency_code column (old database)");
        sqlx::raw_sql("ALTER TABLE payment_records ADD COLUMN currency_code TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await?;
    }
    if !payment_columns.iter().any(|c| c == "exchange_rate") {
        println!("Adding payment_records.exchange_rate column (old database)");
        sqlx::raw_sql("ALTER TABLE payment_records ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0")
            .execute(pool)
            .await?;
    }
    if !payment_columns.iter().any(|c| c == "base_currency_amount") {
        println!("Adding payment_records.base_currency_amount column (old database)");
        sqlx::raw_sql("ALTER TABLE payment_records ADD COLUMN base_currency_amount INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await?;
    }

    // Ensure FX accounts exist for all companies
    sqlx::raw_sql(
        r#"
        INSERT OR IGNORE INTO accounts (id, company_id, code, name, account_type, is_system, is_active)
        SELECT hex(randomblob(16)), c.id, '7000', 'Foreign Exchange Gain', 'revenue', 1, 1
        FROM companies c
        WHERE c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '7000')
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::raw_sql(
        r#"
        INSERT OR IGNORE INTO accounts (id, company_id, code, name, account_type, is_system, is_active)
        SELECT hex(randomblob(16)), c.id, '7100', 'Foreign Exchange Loss', 'expense', 1, 1
        FROM companies c
        WHERE c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '7100')
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Adds the FBR integration columns introduced by migration 019.
/// - `invoices.irn`: Invoice Reference Number from FBR
/// - `invoices.fbr_status`: validation status (pending, validated, failed, dead)
async fn ensure_fbr_columns(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error>> {
    let invoice_columns: Vec<String> = sqlx::query("PRAGMA table_info(invoices)")
        .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
        .fetch_all(pool)
        .await?;

    if !invoice_columns.iter().any(|c| c == "irn") {
        println!("Adding invoices.irn column (old database)");
        sqlx::raw_sql("ALTER TABLE invoices ADD COLUMN irn TEXT")
            .execute(pool)
            .await?;
    }
    if !invoice_columns.iter().any(|c| c == "fbr_status") {
        println!("Adding invoices.fbr_status column (old database)");
        sqlx::raw_sql("ALTER TABLE invoices ADD COLUMN fbr_status TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Applies all migrations to a fresh temp-file DB and returns a pool.
    async fn fresh_pool() -> SqlitePool {
        let path = std::env::temp_dir().join(format!("ijaz-migrate-test-{}.db", uuid::Uuid::new_v4()));
        let url = format!("sqlite:{}", path.display());

        run_sqlite_migrations(&url)
            .await
            .expect("migrations should apply cleanly");

        SqlitePoolOptions::new()
            .connect(&url)
            .await
            .expect("pool should connect")
    }

    async fn table_columns(pool: &SqlitePool, table: &str) -> Vec<String> {
        let info_sql = format!("PRAGMA table_info({table})");
        sqlx::query(sqlx::AssertSqlSafe(&*info_sql))
            .map(|row: sqlx::sqlite::SqliteRow| row.get::<String, _>(1))
            .fetch_all(pool)
            .await
            .expect("PRAGMA table_info should work")
    }

    #[tokio::test]
    async fn migration_017_seeds_default_packages() {
        // Input: fresh database with all migrations applied.
        // Expected: the three default packages exist (spec §14.1.6).
        let pool = fresh_pool().await;

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM packages WHERE is_active = 1")
            .fetch_one(&pool)
            .await
            .expect("packages table should exist");

        assert_eq!(count, 3, "Basic/Standard/Premium packages should be seeded");
    }

    #[tokio::test]
    async fn migration_017_creates_saas_tables() {
        // Input: fresh database with all migrations applied.
        // Expected: every SaaS table from migration 017 exists.
        let pool = fresh_pool().await;

        for table in [
            "packages",
            "company_subscriptions",
            "company_modules",
            "tenant_feature_flags",
            "user_activity_logs",
            "company_storage_usage",
        ] {
            let found = table_columns(&pool, table)
                .await
                .into_iter()
                .any(|c| c == "id");
            assert!(found, "table {table} should exist");
        }
    }

    #[tokio::test]
    async fn migration_017_adds_super_admin_columns() {
        // Input: fresh database with all migrations applied.
        // Expected: users has is_super_admin + must_change_password, and
        // companies has the soft-delete/FBR columns.
        let pool = fresh_pool().await;

        let user_cols = table_columns(&pool, "users").await;
        for column in ["is_super_admin", "must_change_password"] {
            assert!(
                user_cols.iter().any(|c| c == column),
                "users.{column} should exist"
            );
        }

        let company_cols = table_columns(&pool, "companies").await;
        for column in ["deleted_at", "version", "ntn", "strn", "fbr_registered", "province"] {
            assert!(
                company_cols.iter().any(|c| c == column),
                "companies.{column} should exist"
            );
        }
    }

    #[tokio::test]
    async fn migration_017_allows_super_admin_role() {
        // Input: fresh database; insert a role='super_admin' user.
        // Expected: the trigger allows it (migration 002's trigger is replaced).
        let pool = fresh_pool().await;

        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, full_name, role, company_id, is_super_admin)
            VALUES ('sa-1', 'root@admin.test', 'x', 'Super Admin', 'super_admin', NULL, 1)
            "#,
        )
        .execute(&pool)
        .await
        .expect("super_admin role should be accepted by the trigger");
    }
}
