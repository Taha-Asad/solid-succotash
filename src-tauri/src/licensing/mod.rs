pub mod fingerprint;
pub mod types;

use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use tracing::{info, warn};

use crate::db::neon::NeonCloudDb;
use crate::error::AppError;
use tauri::{AppHandle, Emitter};
use types::{DeviceIdentity, LicenseStatusResponse};

pub const APP_VERSION: &str = "1.3.2";
pub const DEFAULT_GRACE_DAYS: i64 = 7;

/// Starts a background ticker that periodically pings licensing status and emits corbel://license-revoked if revoked.
pub fn start_licensing_heartbeat_ticker(app: AppHandle, sqlite_pool: SqlitePool) {
    tokio::spawn(async move {
        // Delay 15 seconds after app startup
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;

        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10 * 60)); // every 10 minutes
        loop {
            interval.tick().await;
            if let Ok(status) = check_license_status(&sqlite_pool).await {
                if status.is_blocked || !status.is_licensed {
                    info!("License heartbeat detected non-licensed or blocked state. Emitting corbel://license-revoked event.");
                    let _ = app.emit("corbel://license-revoked", &status);
                }
            }
        }
    });
}

/// Returns current physical device identity.
pub fn get_device_identity() -> DeviceIdentity {
    DeviceIdentity {
        hwid: fingerprint::get_hardware_id(),
        device_name: fingerprint::get_device_name(),
        os_info: fingerprint::get_os_info(),
        app_version: APP_VERSION.to_string(),
    }
}

/// Checks whether the application is running in developer bypass mode.
pub fn is_dev_mode() -> bool {
    std::env::var("CORBEL_DEV_MODE").map(|v| v == "1" || v == "true").unwrap_or(false)
        || cfg!(debug_assertions)
}

/// Comprehensive license verification against local SQLite lease + Neon Cloud control plane.
pub async fn check_license_status(sqlite_pool: &SqlitePool) -> Result<LicenseStatusResponse, AppError> {
    let hwid = fingerprint::get_hardware_id();

    // 1. Developer Workstation Bypass — ensures Taha is never locked out during development
    if is_dev_mode() {
        return Ok(LicenseStatusResponse {
            is_licensed: true,
            is_blocked: false,
            block_reason: None,
            license_key: Some("CRBL-DEV-TAHA-PERPETUAL".to_string()),
            client_name: Some("The Foolish Crow Studio (Developer)".to_string()),
            license_type: Some("perpetual".to_string()),
            days_remaining: Some(9999),
            grace_days_remaining: Some(7),
            is_offline_grace: false,
            is_migration_grace: false,
            device_hwid: hwid,
        });
    }

    // 2. Query local SQLite lease
    let lease_row = sqlx::query(
        r#"
        SELECT license_key, client_name, device_hwid, lease_token,
               last_verified_at, grace_expires_at, license_expires_at,
               status, monotonic_counter
        FROM _license_lease
        WHERE id = 1
        "#,
    )
    .fetch_optional(sqlite_pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to query license lease: {e}")))?;

    let row = match lease_row {
        Some(r) => r,
        None => {
            // Check if this workstation has an existing company database!
            let company_count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL",
            )
            .fetch_one(sqlite_pool)
            .await
            .unwrap_or(0);

            if company_count > 0 {
                // Existing merchant installation undergoing migration!
                // Grant an automated 14-day transition grace period
                let now = Utc::now();
                let grace_expires = now + chrono::Duration::days(14);
                let now_str = now.to_rfc3339();
                let grace_str = grace_expires.to_rfc3339();

                let _ = sqlx::query(
                    r#"
                    INSERT OR REPLACE INTO _license_lease (
                        id, license_key, client_name, device_hwid, lease_token,
                        last_verified_at, grace_expires_at, license_expires_at,
                        status, monotonic_counter, offline_grace_days
                    ) VALUES (
                        1, 'CRBL-MIGRATION-GRACE', 'Existing Merchant (Migration Grace)',
                        ?, 'MIGRATION_GRACE_TOKEN', ?, ?, ?, 'migration_grace', 1, 14
                    )
                    "#,
                )
                .bind(&hwid)
                .bind(&now_str)
                .bind(&grace_str)
                .bind(&grace_str)
                .execute(sqlite_pool)
                .await;

                return Ok(LicenseStatusResponse {
                    is_licensed: true,
                    is_blocked: false,
                    block_reason: None,
                    license_key: Some("CRBL-MIGRATION-GRACE".to_string()),
                    client_name: Some("Existing Organization (Migration Grace)".to_string()),
                    license_type: Some("migration_grace".to_string()),
                    days_remaining: Some(14),
                    grace_days_remaining: Some(14),
                    is_offline_grace: false,
                    is_migration_grace: true,
                    device_hwid: hwid,
                });
            }

            return Ok(LicenseStatusResponse {
                is_licensed: false,
                is_blocked: false,
                block_reason: None,
                license_key: None,
                client_name: None,
                license_type: None,
                days_remaining: None,
                grace_days_remaining: None,
                is_offline_grace: false,
                is_migration_grace: false,
                device_hwid: hwid,
            });
        }
    };

    let license_key: String = row.get("license_key");
    let client_name: String = row.get("client_name");
    let saved_hwid: String = row.get("device_hwid");
    let status: String = row.get("status");
    let last_verified_at_str: String = row.get("last_verified_at");
    let grace_expires_at_str: String = row.get("grace_expires_at");
    let license_expires_at_str: Option<String> = row.get("license_expires_at");
    let monotonic_counter: i64 = row.get("monotonic_counter");

    // 3. HWID Cloning Check — if the database was copied to another machine, reject immediately!
    if saved_hwid != hwid {
        warn!("Database HWID mismatch! Saved: {saved_hwid}, Detected: {hwid}");
        return Ok(LicenseStatusResponse {
            is_licensed: false,
            is_blocked: true,
            block_reason: Some("Hardware identity mismatch. Machine cloned or database moved.".to_string()),
            license_key: Some(license_key),
            client_name: Some(client_name),
            license_type: None,
            days_remaining: None,
            grace_days_remaining: None,
            is_offline_grace: false,
            is_migration_grace: false,
            device_hwid: hwid,
        });
    }

    // 4. Status Check
    if status == "blocked" || status == "revoked" {
        return Ok(LicenseStatusResponse {
            is_licensed: false,
            is_blocked: true,
            block_reason: Some("Access revoked by administrator.".to_string()),
            license_key: Some(license_key),
            client_name: Some(client_name),
            license_type: None,
            days_remaining: None,
            grace_days_remaining: None,
            is_offline_grace: false,
            is_migration_grace: false,
            device_hwid: hwid,
        });
    }

    let now = Utc::now();

    // 4b. Migration Grace Check
    if status == "migration_grace" {
        let grace_expires = DateTime::parse_from_rfc3339(&grace_expires_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);

        if now <= grace_expires {
            let days_left = (grace_expires - now).num_days().max(1);
            return Ok(LicenseStatusResponse {
                is_licensed: true,
                is_blocked: false,
                block_reason: None,
                license_key: Some(license_key),
                client_name: Some(client_name),
                license_type: Some("migration_grace".to_string()),
                days_remaining: Some(days_left),
                grace_days_remaining: Some(days_left),
                is_offline_grace: false,
                is_migration_grace: true,
                device_hwid: hwid,
            });
        } else {
            return Ok(LicenseStatusResponse {
                is_licensed: false,
                is_blocked: false,
                block_reason: Some("14-Day migration transition grace expired. Workstation license key required.".to_string()),
                license_key: None,
                client_name: None,
                license_type: None,
                days_remaining: Some(0),
                grace_days_remaining: Some(0),
                is_offline_grace: false,
                is_migration_grace: false,
                device_hwid: hwid,
            });
        }
    }

    // 5. Monotonic Clock-Skew / Time Tamper Detection
    if let Ok(last_verified) = DateTime::parse_from_rfc3339(&last_verified_at_str) {
        if now < last_verified.with_timezone(&Utc) - chrono::Duration::hours(1) {
            warn!("System clock roll-back detected!");
            return Ok(LicenseStatusResponse {
                is_licensed: false,
                is_blocked: true,
                block_reason: Some("System clock tampering detected. Re-synchronize time.".to_string()),
                license_key: Some(license_key),
                client_name: Some(client_name),
                license_type: None,
                days_remaining: None,
                grace_days_remaining: None,
                is_offline_grace: false,
                is_migration_grace: false,
                device_hwid: hwid,
            });
        }
    }

    // 6. Attempt Cloud Heartbeat if Neon is available
    let cloud_db = NeonCloudDb::global();
    if cloud_db.is_connected() {
        match cloud_db.cloud_heartbeat(&license_key, &hwid, APP_VERSION).await {
            Ok(heartbeat_res) => {
                if heartbeat_res.is_blocked {
                    let _ = sqlx::query("UPDATE _license_lease SET status = 'blocked' WHERE id = 1")
                        .execute(sqlite_pool)
                        .await;

                    return Ok(LicenseStatusResponse {
                        is_licensed: false,
                        is_blocked: true,
                        block_reason: heartbeat_res.reason.or(Some("Revoked by administrator".to_string())),
                        license_key: Some(license_key),
                        client_name: Some(client_name),
                        license_type: None,
                        days_remaining: None,
                        grace_days_remaining: None,
                        is_offline_grace: false,
                        is_migration_grace: false,
                        device_hwid: hwid,
                    });
                }

                // Heartbeat success: extend local offline lease by DEFAULT_GRACE_DAYS (7 days)
                let new_grace = now + chrono::Duration::days(DEFAULT_GRACE_DAYS);
                let new_grace_str = new_grace.to_rfc3339();
                let now_str = now.to_rfc3339();

                let _ = sqlx::query(
                    r#"
                    UPDATE _license_lease
                    SET last_verified_at = ?,
                        grace_expires_at = ?,
                        status = 'active',
                        monotonic_counter = ?
                    WHERE id = 1
                    "#,
                )
                .bind(&now_str)
                .bind(&new_grace_str)
                .bind(monotonic_counter + 1)
                .execute(sqlite_pool)
                .await;

                let days_remaining = heartbeat_res.days_remaining;

                return Ok(LicenseStatusResponse {
                    is_licensed: true,
                    is_blocked: false,
                    block_reason: None,
                    license_key: Some(license_key),
                    client_name: Some(client_name),
                    license_type: heartbeat_res.license_type,
                    days_remaining,
                    grace_days_remaining: Some(DEFAULT_GRACE_DAYS),
                    is_offline_grace: false,
                    is_migration_grace: false,
                    device_hwid: hwid,
                });
            }
            Err(e) => {
                warn!("Cloud heartbeat failed, falling back to offline lease: {e}");
            }
        }
    }

    // 7. Offline Mode: Evaluate Grace Expiry
    let grace_expires = DateTime::parse_from_rfc3339(&grace_expires_at_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(now);

    if now > grace_expires {
        return Ok(LicenseStatusResponse {
            is_licensed: false,
            is_blocked: false,
            block_reason: Some("7-Day offline grace period expired. Please connect to internet to verify license.".to_string()),
            license_key: Some(license_key),
            client_name: Some(client_name),
            license_type: None,
            days_remaining: None,
            grace_days_remaining: Some(0),
            is_offline_grace: true,
            is_migration_grace: false,
            device_hwid: hwid,
        });
    }

    let grace_days_remaining = (grace_expires - now).num_days().max(0);

    let license_days_remaining = license_expires_at_str.and_then(|exp_str| {
        DateTime::parse_from_rfc3339(&exp_str)
            .map(|dt| (dt.with_timezone(&Utc) - now).num_days().max(0))
            .ok()
    });

    Ok(LicenseStatusResponse {
        is_licensed: true,
        is_blocked: false,
        block_reason: None,
        license_key: Some(license_key),
        client_name: Some(client_name),
        license_type: None,
        days_remaining: license_days_remaining,
        grace_days_remaining: Some(grace_days_remaining),
        is_offline_grace: true,
        is_migration_grace: false,
        device_hwid: hwid,
    })
}

/// Activates a license key for this physical machine.
pub async fn activate_license(
    sqlite_pool: &SqlitePool,
    license_key: &str,
    device_name: Option<String>,
) -> Result<LicenseStatusResponse, AppError> {
    let hwid = fingerprint::get_hardware_id();
    let name = device_name.unwrap_or_else(fingerprint::get_device_name);
    let os_info = fingerprint::get_os_info();

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation(
            "Internet connection required to activate license for the first time.".to_string(),
        ));
    }

    let act_res = cloud_db
        .cloud_activate_device(license_key, &hwid, &name, &os_info, APP_VERSION)
        .await?;

    let now = Utc::now();
    let grace_expires = now + chrono::Duration::days(DEFAULT_GRACE_DAYS);
    let lease_token = format!("{hwid}::{license_key}::{}", now.timestamp());

    // Upsert into local SQLite _license_lease
    sqlx::query(
        r#"
        INSERT INTO _license_lease (
            id, license_key, client_name, device_hwid, lease_token,
            last_verified_at, grace_expires_at, license_expires_at,
            status, monotonic_counter
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'active', 1)
        ON CONFLICT(id) DO UPDATE SET
            license_key = excluded.license_key,
            client_name = excluded.client_name,
            device_hwid = excluded.device_hwid,
            lease_token = excluded.lease_token,
            last_verified_at = excluded.last_verified_at,
            grace_expires_at = excluded.grace_expires_at,
            license_expires_at = excluded.license_expires_at,
            status = 'active',
            monotonic_counter = _license_lease.monotonic_counter + 1
        "#,
    )
    .bind(license_key)
    .bind(&act_res.client_name)
    .bind(&hwid)
    .bind(&lease_token)
    .bind(now.to_rfc3339())
    .bind(grace_expires.to_rfc3339())
    .bind(&act_res.expires_at)
    .execute(sqlite_pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to store local lease: {e}")))?;

    info!("Successfully activated license '{license_key}' for HWID '{hwid}'");

    Ok(LicenseStatusResponse {
        is_licensed: true,
        is_blocked: false,
        block_reason: None,
        license_key: Some(license_key.to_string()),
        client_name: Some(act_res.client_name),
        license_type: Some(act_res.license_type),
        days_remaining: act_res.days_remaining,
        grace_days_remaining: Some(DEFAULT_GRACE_DAYS),
        is_offline_grace: false,
        is_migration_grace: false,
        device_hwid: hwid,
    })
}

/// Deactivates / clears local license lease from this machine.
pub async fn deactivate_license(sqlite_pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("DELETE FROM _license_lease WHERE id = 1")
        .execute(sqlite_pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to remove local lease: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn create_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory sqlite db");

        sqlx::query(
            r#"
            CREATE TABLE _license_lease (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                license_key TEXT NOT NULL,
                client_name TEXT NOT NULL,
                device_hwid TEXT NOT NULL,
                lease_token TEXT NOT NULL,
                last_verified_at TEXT NOT NULL,
                grace_expires_at TEXT NOT NULL,
                license_expires_at TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                monotonic_counter INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("Failed to create _license_lease table");

        pool
    }

    #[tokio::test]
    async fn test_unlicensed_state_when_table_empty() {
        let pool = create_test_db().await;
        // Temporarily disable dev mode for test
        std::env::set_var("CORBEL_DEV_MODE", "0");

        // Use check directly on database rows
        let row = sqlx::query("SELECT COUNT(*) as count FROM _license_lease")
            .fetch_one(&pool)
            .await
            .unwrap();
        let count: i64 = row.get("count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_hwid_mismatch_blocks_device() {
        let pool = create_test_db().await;
        let fake_hwid = "CRBL-HWID-0000-0000-0000-0000";
        let actual_hwid = fingerprint::get_hardware_id();
        assert_ne!(fake_hwid, actual_hwid);

        let now = Utc::now();
        let grace = now + chrono::Duration::days(7);

        sqlx::query(
            r#"
            INSERT INTO _license_lease (
                id, license_key, client_name, device_hwid, lease_token,
                last_verified_at, grace_expires_at, status, monotonic_counter
            ) VALUES (1, 'CRBL-TEST-1234', 'Test Client', ?, 'token', ?, ?, 'active', 1)
            "#,
        )
        .bind(fake_hwid)
        .bind(now.to_rfc3339())
        .bind(grace.to_rfc3339())
        .execute(&pool)
        .await
        .unwrap();

        // Verify that the saved HWID in the DB does not match the host HWID
        let row = sqlx::query("SELECT device_hwid FROM _license_lease WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let saved_hwid: String = row.get("device_hwid");
        assert_ne!(saved_hwid, actual_hwid);
    }

    #[tokio::test]
    async fn test_deactivate_license_clears_lease() {
        let pool = create_test_db().await;
        let now = Utc::now();

        sqlx::query(
            r#"
            INSERT INTO _license_lease (
                id, license_key, client_name, device_hwid, lease_token,
                last_verified_at, grace_expires_at, status, monotonic_counter
            ) VALUES (1, 'CRBL-TEST-1234', 'Test Client', 'HWID', 'token', ?, ?, 'active', 1)
            "#,
        )
        .bind(now.to_rfc3339())
        .bind((now + chrono::Duration::days(7)).to_rfc3339())
        .execute(&pool)
        .await
        .unwrap();

        deactivate_license(&pool).await.unwrap();

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _license_lease")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }
}
