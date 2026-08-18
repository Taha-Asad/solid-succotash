// ==========================================
// BACKUP & RESTORE
// ==========================================
//
// Backup: copies DB to user-chosen location
// Restore: replaces DB from user-chosen backup file
//
// The user picks the save/load location via Tauri dialog.

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: String,
}

/// Resolves the on-disk SQLite file behind the current pool.
/// Used by backup/restore so they always act on the real database file,
/// no matter where the pool was pointed (production data dir or a test temp DB).
fn current_db_path(pool: &SqlitePool) -> String {
    pool.connect_options()
        .get_filename()
        .to_string_lossy()
        .to_string()
}

/// Creates a backup at a user-specified path.
/// The frontend opens a Save dialog, user picks where to save.
#[tauri::command]
pub async fn create_backup(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    save_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;

    let db_file = current_db_path(pool.inner());

    // Copy the database file
    std::fs::copy(db_file, &save_path).map_err(|e| format!("Backup failed: {e}"))?;

    // Audit log
    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "backup",
        "database",
        None,
        &format!("Backup saved to: {save_path}"),
    )
    .await;

    Ok(save_path)
}

/// Restores the database from a backup file.
/// WARNING: this overwrites the current database. The app must restart after.
#[tauri::command]
pub async fn restore_backup(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    backup_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;

    if user.role != "owner" {
        return Err("Only the owner can restore backups".to_string());
    }

    // Verify the backup file exists and is a valid SQLite file
    if !std::path::Path::new(&backup_path).exists() {
        return Err("Backup file not found".to_string());
    }

    // Check it's a SQLite file (starts with "SQLite format 3")
    let header = std::fs::read(&backup_path).map_err(|e| format!("Cannot read backup: {e}"))?;
    if header.len() < 16 || &header[0..16] != b"SQLite format 3\0" {
        return Err("Not a valid SQLite database file".to_string());
    }

    let db_file = current_db_path(pool.inner());

    // Create a safety backup of current DB before overwriting
    let safety_backup = format!("{db_file}.before_restore");
    let _ = std::fs::copy(&db_file, &safety_backup);

    // Overwrite with the chosen backup
    std::fs::copy(&backup_path, db_file).map_err(|e| format!("Restore failed: {e}"))?;

    // Audit log
    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "restore",
        "database",
        None,
        &format!("Database restored from: {backup_path}"),
    )
    .await;

    Ok("Database restored successfully. Please restart the application.".to_string())
}

/// Lists backups in a specific directory
#[tauri::command]
pub async fn list_backups(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    directory: String,
) -> Result<Vec<BackupInfo>, String> {
    let _user = require_current_user(pool.inner(), session.inner()).await?;

    let dir = std::path::Path::new(&directory);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<BackupInfo> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "db") {
                let metadata = std::fs::metadata(&path).ok();
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = metadata
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let secs = t
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        format_timestamp(secs)
                    })
                    .unwrap_or_default();

                backups.push(BackupInfo {
                    path: path.to_string_lossy().to_string(),
                    filename: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    size_bytes: size,
                    created_at: modified,
                });
            }
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

fn format_timestamp(secs: u64) -> String {
    let days = secs / 86400;
    let tod = secs % 86400;
    let h = tod / 3600;
    let m = (tod % 3600) / 60;
    let mut y = 1970u64;
    let mut rem = days;
    loop {
        let d = if (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400) {
            366
        } else {
            365
        };
        if rem < d {
            break;
        }
        rem -= d;
        y += 1;
    }
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let md = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut mo = 1u64;
    for &d in &md {
        if rem < d {
            break;
        }
        rem -= d;
        mo += 1;
    }
    format!("{:04}-{:02}-{:02} {:02}:{:02}", y, mo, rem + 1, h, m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::create_product;
    use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
    use tauri::test::MockRuntime;
    use tauri::Manager;

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    async fn owner_app() -> tauri::App<MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    fn temp_dir_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("ijaz-backup-test-{}", uuid::Uuid::new_v4()))
    }

    /// Adds one product so the DB is non-empty and the backup has content.
    async fn seed_product(app: &tauri::App<MockRuntime>) {
        create_product(
            app.state(),
            app.state(),
            "SKU-1".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            5,
            "pcs".to_string(),
        )
        .await
        .expect("create product");
    }

    // ---------------------------------------------------------------
    // format_timestamp (pure)
    // ---------------------------------------------------------------

    #[test]
    fn format_timestamp_starts_at_unix_epoch() {
        // Input: 0 seconds.
        // Expected: "1970-01-01 00:00".
        assert_eq!(format_timestamp(0), "1970-01-01 00:00");
    }

    #[test]
    fn format_timestamp_advances_days() {
        // Input: exactly one day (86400s).
        // Expected: "1970-01-02 00:00".
        assert_eq!(format_timestamp(86400), "1970-01-02 00:00");
    }

    // ---------------------------------------------------------------
    // create_backup
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_backup_copies_live_database_to_save_path() {
        // Input: a registered owner with one product, save path in a temp dir.
        // Expected: file created, valid SQLite header, size > 0, audit row written.
        let app = owner_app().await;
        seed_product(&app).await;

        let dir = temp_dir_path();
        std::fs::create_dir_all(&dir).expect("create dir");
        let save_path = dir.join("backup.db");

        let returned = create_backup(
            app.state(),
            app.state(),
            save_path.to_string_lossy().to_string(),
        )
        .await
        .expect("backup");
        assert_eq!(returned, save_path.to_string_lossy().to_string());

        let header = std::fs::read(&save_path).expect("read backup");
        assert!(header.len() > 16, "backup should be larger than the header");
        assert_eq!(&header[0..16], b"SQLite format 3\0");

        let pool = app.state::<SqlitePool>();
        let audit: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'backup'")
                .fetch_one(&*pool)
                .await
                .expect("audit");
        assert_eq!(audit, 1);

        std::fs::remove_file(&save_path).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn create_backup_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_backup(app.state(), app.state(), "/tmp/x.db".to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn create_backup_fails_on_unwritable_save_path() {
        // Input: save path inside a non-existent directory.
        // Expected: Err containing "Backup failed".
        let app = owner_app().await;
        let err = create_backup(
            app.state(),
            app.state(),
            "/nonexistent-dir-xyz/backup.db".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Backup failed"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // restore_backup
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn restore_backup_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = restore_backup(app.state(), app.state(), "/tmp/x.db".to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn restore_backup_requires_owner_role() {
        // Input: an employee session.
        // Expected: Err "Only the owner can restore backups".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let company_id: String =
            sqlx::query_scalar("SELECT company_id FROM users WHERE email = 'owner@test.com'")
                .fetch_one(&*pool)
                .await
                .expect("company id");
        let employee =
            insert_user(&pool, &company_id, "emp@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let err = restore_backup(app.state(), app.state(), "/tmp/x.db".to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Only the owner can restore backups");
    }

    #[tokio::test]
    async fn restore_backup_rejects_missing_file() {
        // Input: owner session, backup path that does not exist.
        // Expected: Err "Backup file not found".
        let app = owner_app().await;
        let err = restore_backup(
            app.state(),
            app.state(),
            "/nonexistent-backup-xyz.db".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Backup file not found");
    }

    #[tokio::test]
    async fn restore_backup_rejects_non_sqlite_file() {
        // Input: a valid backup path whose contents are not a SQLite database.
        // Expected: Err "Not a valid SQLite database file".
        let app = owner_app().await;
        let dir = temp_dir_path();
        std::fs::create_dir_all(&dir).expect("create dir");
        let bad = dir.join("fake.db");
        std::fs::write(&bad, b"this is not a sqlite database at all").expect("write");

        let err = restore_backup(app.state(), app.state(), bad.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Not a valid SQLite database file");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn restore_backup_succeeds_and_writes_safety_copy() {
        // Input: a valid backup of the live test DB.
        // Expected: Ok, audit 'restore' row, and a .before_restore safety file.
        let app = owner_app().await;
        seed_product(&app).await;

        let dir = temp_dir_path();
        std::fs::create_dir_all(&dir).expect("create dir");
        let backup_path = dir.join("backup.db");
        create_backup(
            app.state(),
            app.state(),
            backup_path.to_string_lossy().to_string(),
        )
        .await
        .expect("make backup");

        let result = restore_backup(
            app.state(),
            app.state(),
            backup_path.to_string_lossy().to_string(),
        )
        .await
        .expect("restore");
        assert!(result.contains("restored"), "got: {result}");

        let pool = app.state::<SqlitePool>();
        let audit: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'restore'")
                .fetch_one(&*pool)
                .await
                .expect("audit");
        assert_eq!(audit, 1);

        let db_file = current_db_path(&pool);
        assert!(
            std::path::Path::new(&format!("{db_file}.before_restore")).exists(),
            "safety copy should exist"
        );

        std::fs::remove_file(&backup_path).ok();
        std::fs::remove_file(format!("{db_file}.before_restore")).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    // ---------------------------------------------------------------
    // list_backups
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_backups_lists_only_db_files() {
        // Input: a dir with one .db file, one .txt file and one subdir.
        // Expected: exactly one entry for the .db file with name + size.
        let app = owner_app().await;
        let dir = temp_dir_path();
        std::fs::create_dir_all(&dir).expect("create dir");

        let db_file = dir.join("snapshot.db");
        std::fs::write(&db_file, vec![0u8; 512]).expect("write db");
        std::fs::write(dir.join("notes.txt"), "not a db").expect("write txt");
        std::fs::create_dir_all(dir.join("subdir")).expect("subdir");

        let backups = list_backups(app.state(), app.state(), dir.to_string_lossy().to_string())
            .await
            .expect("list");
        assert_eq!(backups.len(), 1, "only .db files should be listed");
        assert_eq!(backups[0].filename, "snapshot.db");
        assert_eq!(backups[0].size_bytes, 512);
        assert!(
            !backups[0].created_at.is_empty(),
            "created_at should be set"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn list_backups_empty_for_missing_directory() {
        // Input: a directory that does not exist.
        // Expected: empty vec (not an error).
        let app = owner_app().await;
        let backups = list_backups(app.state(), app.state(), "/nonexistent-dir-xyz".to_string())
            .await
            .expect("list");
        assert!(backups.is_empty());
    }

    #[tokio::test]
    async fn list_backups_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_backups(app.state(), app.state(), "/tmp".to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }
}
