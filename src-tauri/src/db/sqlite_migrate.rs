// // db/sqlite_migrate.rs
// // This file handles running SQLite migrations.
// // It reads .sql files from migrations/sqlite/ and runs them in order.

// use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
// use sqlx::{query, AssertSqlSafe};
// use std::fs;
// use std::path::Path;
// use std::str::FromStr;
// // What this function does (in plain English):
// // 1. Connect to the SQLite database file
// // 2. Create a "_migrations" table to track which migrations have run
// // 3. Read all .sql files from migrations/sqlite/
// // 4. Sort them by filename (001 before 002)
// // 5. For each file, check if it already ran
// // 6. If not, run it, then record it in _migrations table
// pub async fn run_sqlite_migrations(db_path: &str) -> Result<(), String> {
//     println!("[SQLite] Connecting to: {}", db_path);

//     // Connect to SQLite
//     let options = SqliteConnectOptions::from_str(db_path)
//         .map_err(|e| format!("Invalid SQLite URL: {}", e))?
//         .create_if_missing(true);

//     let pool = SqlitePool::connect_with(options)
//         .await
//         .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;

//     // Create the _migrations table (if it doesn't exist)
//     query(
//         "CREATE TABLE IF NOT EXISTS _migrations (
//             version INTEGER PRIMARY KEY,
//             name TEXT NOT NULL,
//             applied_at TEXT DEFAULT CURRENT_TIMESTAMP
//         )",
//     )
//     .execute(&pool)
//     .await
//     .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

//     // Read all .sql files from migrations/sqlite/
//     let migrations_dir = Path::new("migrations/sqlite");

//     if !migrations_dir.exists() {
//         return Err("migrations/sqlite folder not found".to_string());
//     }

//     let mut migrations: Vec<(i32, String)> = Vec::new();

//     for entry in fs::read_dir(migrations_dir)
//         .map_err(|e| format!("Failed to read migrations directory: {}", e))?
//     {
//         let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
//         let file_name = entry.file_name().to_string_lossy().to_string();

//         if file_name.ends_with(".sql") {
//             let version_str = file_name.split('_').next().unwrap_or("0");

//             if let Ok(version) = version_str.parse::<i32>() {
//                 migrations.push((version, file_name));
//             }
//         }
//     }

//     migrations.sort_by_key(|(version, _)| *version);

//     for (version, file_name) in migrations {
//         let already_applied = query("SELECT 1 FROM _migrations WHERE version = ? LIMIT 1")
//             .bind(version)
//             .fetch_optional(&pool)
//             .await
//             .map_err(|e| format!("Failed to check migration {}: {}", file_name, e))?;

//         if already_applied.is_some() {
//             println!("[migrations] Skipping {} (already applied)", file_name);
//             continue;
//         }

//         let file_path = migrations_dir.join(&file_name);

//         let sql = fs::read_to_string(&file_path)
//             .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

//         // Execute migration SQL
//         query(AssertSqlSafe(sql.as_str()))
//             .execute(&pool)
//             .await
//             .map_err(|e| format!("Failed to run migration {}: {}", file_name, e))?;

//         // Record migration
//         query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
//             .bind(version)
//             .bind(&file_name)
//             .execute(&pool)
//             .await
//             .map_err(|e| format!("Failed to record migration {}: {}", file_name, e))?;

//         println!("[migrations] ✅ Applied {}", file_name);
//     }

//     Ok(())
// }
// ==========================================
// SQLite Migration Runner
// ==========================================
//
// Runs all unapplied .sql migration files in order.
// Tracks which migrations have been applied in a _migrations table.
//
// DATABASE LOCATION:
//   Development:  ./ijazandcompany.db  (project folder)
//   Production:   App data directory   (user's AppData on Windows)
//
// Tauri automatically resolves the app data directory differently
// for dev vs production builds.

use sqlx::sqlite::SqlitePool;
use std::path::PathBuf;

/// Gets the correct database path for the current environment.
/// In dev: uses the current directory (project folder)
/// In production: uses the app's data directory (AppData on Windows)
pub fn get_database_path() -> String {
    // Try to get the Tauri app data directory
    // In production, this resolves to:
    //   Windows: C:\Users\<user>\AppData\Roaming\com.ijazandcompany.erp\
    //   macOS:   ~/Library/Application Support/com.ijazandcompany.erp/
    //   Linux:   ~/.local/share/com.ijazandcompany.erp/

    let app_data = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));

    let db_dir = app_data.join("ijazandcompany-erp");

    // Create the directory if it doesn't exist
    std::fs::create_dir_all(&db_dir).ok();

    let db_path = db_dir.join("ijazandcompany.db");

    // Return as SQLite URL
    format!("sqlite:{}", db_path.display())
}

/// Runs all unapplied migrations from the sqlite migrations directory.
pub async fn run_sqlite_migrations(sqlite_url: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Connect to the database
    let pool = SqlitePool::connect(sqlite_url).await?;

    // Create migration tracking table if it doesn't exist
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

    // Find migration files
    let migrations_dir = find_migrations_dir()?;

    let mut migration_files: Vec<(i64, String, std::path::PathBuf)> = Vec::new();

    if migrations_dir.exists() {
        for entry in std::fs::read_dir(&migrations_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map_or(false, |ext| ext == "sql") {
                let filename = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                // Extract version number from filename like "001_create_users.sql"
                if let Some(version) = filename
                    .split('_')
                    .next()
                    .and_then(|v| v.parse::<i64>().ok())
                {
                    migration_files.push((version, filename, path));
                }
            }
        }
    }

    // Sort by version number
    migration_files.sort_by_key(|f| f.0);

    // Get already-applied migrations
    let applied: Vec<i64> = sqlx::query_scalar("SELECT version FROM _migrations ORDER BY version")
        .fetch_all(&pool)
        .await?;

    // Run unapplied migrations
    for (version, name, path) in &migration_files {
        if applied.contains(version) {
            continue;
        }

        println!("Applying migration {version}: {name}");

        let sql = std::fs::read_to_string(path)?;

        // Execute the migration SQL
        // Split by semicolons to handle multiple statements
        for statement in sql.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("--") {
                // raw_sql (unlike query) does not cache a prepared statement.
                // The SQL comes from our own bundled migration files (not user
                // input), so it is safe to mark with AssertSqlSafe.
                sqlx::raw_sql(sqlx::AssertSqlSafe(trimmed.to_string()))
                    .execute(&pool)
                    .await?;
            }
        }

        // Record the migration
        sqlx::query("INSERT INTO _migrations (version, name) VALUES (?, ?)")
            .bind(version)
            .bind(name)
            .execute(&pool)
            .await?;

        println!("  ✓ Applied");
    }

    pool.close().await;
    Ok(())
}

/// Finds the migrations directory relative to the executable
///
/// In production the bundled resources are placed relative to the app's
/// resource directory (on Windows that is the folder containing the exe).
/// Some bundlers place resources in a `resources` subfolder, so try both.
fn find_migrations_dir() -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // Production: resources live relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("migrations").join("sqlite"));
            candidates.push(exe_dir.join("resources").join("migrations").join("sqlite"));
        }
    }

    // Development fallbacks
    candidates.push(std::path::PathBuf::from("migrations").join("sqlite"));
    candidates.push(std::path::PathBuf::from("src-tauri").join("migrations").join("sqlite"));

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Could not find migrations/sqlite directory".into())
}
