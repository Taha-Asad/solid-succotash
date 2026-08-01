// db/sqlite_migrate.rs
// This file handles running SQLite migrations.
// It reads .sql files from migrations/sqlite/ and runs them in order.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::{query, AssertSqlSafe};
use std::fs;
use std::path::Path;
use std::str::FromStr;
// What this function does (in plain English):
// 1. Connect to the SQLite database file
// 2. Create a "_migrations" table to track which migrations have run
// 3. Read all .sql files from migrations/sqlite/
// 4. Sort them by filename (001 before 002)
// 5. For each file, check if it already ran
// 6. If not, run it, then record it in _migrations table
pub async fn run_sqlite_migrations(db_path: &str) -> Result<(), String> {
    println!("[SQLite] Connecting to: {}", db_path);

    // Connect to SQLite
    let options = SqliteConnectOptions::from_str(db_path)
        .map_err(|e| format!("Invalid SQLite URL: {}", e))?
        .create_if_missing(true);

    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;

    // Create the _migrations table (if it doesn't exist)
    query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

    // Read all .sql files from migrations/sqlite/
    let migrations_dir = Path::new("migrations/sqlite");

    if !migrations_dir.exists() {
        return Err("migrations/sqlite folder not found".to_string());
    }

    let mut migrations: Vec<(i32, String)> = Vec::new();

    for entry in fs::read_dir(migrations_dir)
        .map_err(|e| format!("Failed to read migrations directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.ends_with(".sql") {
            let version_str = file_name.split('_').next().unwrap_or("0");

            if let Ok(version) = version_str.parse::<i32>() {
                migrations.push((version, file_name));
            }
        }
    }

    migrations.sort_by_key(|(version, _)| *version);

    for (version, file_name) in migrations {
        let already_applied = query("SELECT 1 FROM _migrations WHERE version = ? LIMIT 1")
            .bind(version)
            .fetch_optional(&pool)
            .await
            .map_err(|e| format!("Failed to check migration {}: {}", file_name, e))?;

        if already_applied.is_some() {
            println!("[migrations] Skipping {} (already applied)", file_name);
            continue;
        }

        let file_path = migrations_dir.join(&file_name);

        let sql = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

        // Execute migration SQL
        query(AssertSqlSafe(sql.as_str()))
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to run migration {}: {}", file_name, e))?;

        // Record migration
        query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
            .bind(version)
            .bind(&file_name)
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to record migration {}: {}", file_name, e))?;

        println!("[migrations] ✅ Applied {}", file_name);
    }

    Ok(())
}
