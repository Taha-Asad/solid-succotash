use sqlx::SqlitePool;
use tauri::State;

use super::helpers::require_super_admin;
use crate::commands::auth::SessionState;
use crate::db::neon::NeonCloudDb;
use crate::error::AppError;
use crate::licensing::types::{
    ActivateLicenseInput, DeviceIdentity, IssueLicenseInput, LicenseStatusResponse,
    PublicDeviceActivation, PublicLicense,
};

// ==========================================
// CLIENT RUNTIME / ACTIVATION COMMANDS
// ==========================================

#[tauri::command]
pub fn get_device_identity() -> DeviceIdentity {
    crate::licensing::get_device_identity()
}

#[tauri::command]
pub async fn check_license_status(
    pool: State<'_, SqlitePool>,
) -> Result<LicenseStatusResponse, AppError> {
    crate::licensing::check_license_status(pool.inner()).await
}

#[tauri::command]
pub async fn activate_license(
    pool: State<'_, SqlitePool>,
    input: ActivateLicenseInput,
) -> Result<LicenseStatusResponse, AppError> {
    crate::licensing::activate_license(pool.inner(), &input.license_key, input.device_name).await
}

#[tauri::command]
pub async fn deactivate_license(
    pool: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    crate::licensing::deactivate_license(pool.inner()).await
}

// ==========================================
// SUPER ADMIN FLEET GOVERNANCE COMMANDS
// ==========================================

#[tauri::command]
pub async fn saas_issue_license(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    input: IssueLicenseInput,
) -> Result<PublicLicense, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation("Neon Cloud database not connected".to_string()));
    }

    cloud_db.issue_tenant_license(input).await
}

#[tauri::command]
pub async fn saas_list_licenses(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicLicense>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Ok(Vec::new());
    }

    cloud_db.list_tenant_licenses().await
}

#[tauri::command]
pub async fn saas_list_active_devices(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicDeviceActivation>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Ok(Vec::new());
    }

    cloud_db.list_all_device_activations().await
}

#[tauri::command]
pub async fn saas_revoke_license(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    license_id: String,
    reason: Option<String>,
) -> Result<(), AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation("Neon Cloud database not connected".to_string()));
    }

    cloud_db.revoke_tenant_license(&license_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn saas_revoke_device(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    device_id: String,
    reason: Option<String>,
) -> Result<(), AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation("Neon Cloud database not connected".to_string()));
    }

    cloud_db.revoke_device_activation(&device_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn saas_unblock_device(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    device_id: String,
) -> Result<(), AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation("Neon Cloud database not connected".to_string()));
    }

    cloud_db.unblock_device_activation(&device_id).await
}

#[tauri::command]
pub async fn saas_extend_license(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    license_id: String,
    additional_days: i64,
) -> Result<(), AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = NeonCloudDb::global();
    if !cloud_db.is_connected() {
        return Err(AppError::validation("Neon Cloud database not connected".to_string()));
    }

    cloud_db.extend_tenant_license(&license_id, additional_days).await
}
