use super::types::*;
use super::helpers::{
    audit_for, can_manage_company, fetch_modules_for_company, fetch_package,
    fetch_subscription_for_company, resolve_company_id, validate_module_key,
};
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// COMPANY MODULES COMMANDS
// ==========================================

// ==========================================
// COMPANY MODULES
// ==========================================

#[tauri::command]
pub async fn list_company_modules(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: Option<String>,
) -> Result<Vec<PublicCompanyModule>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let target = resolve_company_id(&current_user, company_id)?;
    fetch_modules_for_company(pool.inner(), &target).await
}

#[tauri::command]
pub async fn set_company_module(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    module_key: String,
    is_enabled: bool,
) -> Result<PublicCompanyModule, AppError> {
    let actor = require_current_user(pool.inner(), session.inner()).await?;

    if !can_manage_company(&actor, &company_id) {
        return Err(AppError::internal("Only company owners/admins or a super admin can change modules".to_string()));
    }

    let module_key = validate_module_key(&module_key)?;

    if ["inventory", "invoices", "settings"].contains(&module_key.as_str()) && !is_enabled {
        return Err(AppError::internal("Core system modules (Inventory, Invoices, Settings) cannot be disabled".to_string()));
    }

    // Gate non-core module activations by the company's active subscription plan
    if is_enabled
        && !actor.is_super_admin
        && !["inventory", "invoices", "settings", "dashboard", "users"].contains(&module_key.as_str())
    {
        if let Ok(Some(sub)) = fetch_subscription_for_company(pool.inner(), &company_id).await {
            if let Ok(pkg) = fetch_package(pool.inner(), &sub.package_id).await {
                let allowed = pkg.features.iter().any(|f| f.eq_ignore_ascii_case(&module_key));
                if !allowed {
                    return Err(AppError::forbidden(format!(
                        "Module '{}' is not included in your organization's active '{}' plan. Contact Super Admin to upgrade.",
                        module_key, pkg.name
                    )));
                }
            }
        }
    }

    let existing_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM company_modules WHERE company_id = ? AND module_key = ?")
            .bind(&company_id)
            .bind(&module_key)
            .fetch_optional(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;

    let module_id = match existing_id {
        Some(id) => {
            sqlx::query(
                "UPDATE company_modules SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(is_enabled)
            .bind(&id)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO company_modules (id, company_id, module_key, is_enabled, settings)
                VALUES (?, ?, ?, ?, '{}')
                "#,
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&module_key)
            .bind(is_enabled)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
    };

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        let _ = cloud_db.set_company_module(&company_id, &module_key, is_enabled).await;
    }

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "update",
        "module",
        Some(&module_id),
        &format!("Set module {module_key} = {is_enabled}"),
    )
    .await;

    sqlx::query_as::<_, CompanyModuleRow>(
        r#"
        SELECT id, company_id, module_key, is_enabled, settings, created_at, updated_at
        FROM company_modules WHERE id = ?
        "#,
    )
    .bind(&module_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| AppError::database(format!("Database error: {error}")))
    .map(|r| r.to_public())
}


