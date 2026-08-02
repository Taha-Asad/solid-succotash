// ==========================================
// BACKUP COMMANDS
// ==========================================
//
// Copies the database file to a safe location.
// The subscriber should back up regularly.

use crate::commands::auth::{require_current_user, SessionState};
use sqlx::SqlitePool;
use tauri::State;

/// Creates a backup of the database.
/// Returns the path where the backup was saved.
#[tauri::command]
pub async fn create_backup(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<String, String> {
    let _current_user = require_current_user(pool.inner(), session.inner()).await?;

    // Get the database path
    let db_path = crate::db::sqlite_migrate::get_database_path();
    // Remove the "sqlite:" prefix
    let db_file = db_path.strip_prefix("sqlite:").unwrap_or(&db_path);

    // Create backup filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let backup_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ijazandcompany-erp")
        .join("backups");

    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Could not create backup directory: {e}"))?;

    let backup_path = backup_dir.join(format!("backup_{timestamp}.db"));

    // Copy the database file
    std::fs::copy(db_file, &backup_path)
        .map_err(|e| format!("Backup failed: {e}"))?;

    let path_str = backup_path.to_string_lossy().to_string();
    Ok(path_str)
}

/// Lists available backups.
#[tauri::command]
pub async fn list_backups(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<String>, String> {
    let _current_user = require_current_user(pool.inner(), session.inner()).await?;

    let backup_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ijazandcompany-erp")
        .join("backups");

    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "db") {
                backups.push(path.to_string_lossy().to_string());
            }
        }
    }

    backups.sort();
    backups.reverse(); // newest first
    Ok(backups)
}
