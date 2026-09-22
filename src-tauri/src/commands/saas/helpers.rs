use super::types::*;
use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, PublicUser, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// SAAS HELPERS
// ==========================================

/// Returns the current user ONLY if they are a cross-tenant super admin.
pub async fn require_super_admin(
    pool: &SqlitePool,
    session: &SessionState,
) -> Result<PublicUser, AppError> {
    let current_user = require_current_user(pool, session).await?;

    if !current_user.is_super_admin {
        return Err(AppError::internal("Super admin access required".to_string()));
    }

    Ok(current_user)
}

/// Resolves the target company id for a tenant-scoped read.
/// - None => the caller's own company (any logged-in user).
/// - Some(id) => requires super admin (cross-tenant view).
pub fn resolve_company_id(actor: &PublicUser, company_id: Option<String>) -> Result<String, AppError> {
    match company_id {
        Some(id) => {
            if !actor.is_super_admin {
                return Err(AppError::internal("Super admin access required".to_string()));
            }
            Ok(id)
        }
        None => actor
            .company_id
            .clone()
            .ok_or_else(|| AppError::internal("User is not assigned to a company".to_string())),
    }
}

/// Can `actor` manage modules/settings inside `target_company_id`?
pub fn can_manage_company(actor: &PublicUser, target_company_id: &str) -> bool {
    actor.is_super_admin
        || (actor.company_id.as_deref() == Some(target_company_id)
            && (actor.role == "owner" || actor.role == "admin"))
}

pub fn validate_module_key(module_key: &str) -> Result<String, AppError> {
    const MODULES: &[&str] = &[
        "dashboard",
        "inventory",
        "sales",
        "purchases",
        "import",
        "reports",
        "employees",
        "branches",
        "invoices",
        "data_import",
        "leads",
        "discussions",
        "ai_insights",
    ];

    let module_key = module_key.trim().to_lowercase();
    if !MODULES.contains(&module_key.as_str()) {
        return Err(AppError::internal(format!("Unknown module: {module_key}")));
    }
    Ok(module_key)
}

pub fn validate_feature_key(feature_key: &str) -> Result<String, AppError> {
    let feature_key = feature_key.trim().to_lowercase();
    if feature_key.is_empty() {
        return Err(AppError::internal("Feature key cannot be empty".to_string()));
    }
    Ok(feature_key)
}

pub const PACKAGE_SELECT: &str = "
    SELECT id, name, description, price, billing_cycle, module_limits,
           max_users, max_branches, max_storage_mb, features,
           is_active, sort_order, created_at, updated_at
    FROM packages
";

pub async fn fetch_package(pool: &SqlitePool, package_id: &str) -> Result<PackageRow, AppError> {
    let sql = format!("{PACKAGE_SELECT} WHERE id = ? AND deleted_at IS NULL");
    sqlx::query_as::<_, PackageRow>(sqlx::AssertSqlSafe(&*sql))
        .bind(package_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Database error: {error}"))?
        .ok_or_else(|| AppError::internal("Package not found".to_string()))
}

pub async fn fetch_subscription_for_company(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<Option<PublicSubscription>, AppError> {
    let row = sqlx::query_as::<_, SubscriptionRow>(
        r#"
        SELECT id, company_id, package_id, status, trial_ends_at,
               current_period_start, current_period_end, canceled_at, ended_at,
               metadata, created_at, updated_at
        FROM company_subscriptions
        WHERE company_id = ?
        "#,
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(row.map(|r| r.to_public()))
}

pub async fn fetch_modules_for_company(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<Vec<PublicCompanyModule>, AppError> {
    let rows = sqlx::query_as::<_, CompanyModuleRow>(
        r#"
        SELECT id, company_id, module_key, is_enabled, settings, created_at, updated_at
        FROM company_modules
        WHERE company_id = ?
        ORDER BY module_key
        "#,
    )
    .bind(company_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

/// Modules a tenant gets by default: every key in the package's
/// `module_limits` with a limit >= 1, or a core fallback set.
pub fn default_modules_from_package(module_limits_json: &str) -> Vec<String> {
    const CORE: &[&str] = &[
        "dashboard",
        "inventory",
        "sales",
        "purchases",
        "import",
        "reports",
        "employees",
        "branches",
        "invoices",
    ];

    let parsed = serde_json::from_str::<serde_json::Value>(module_limits_json);

    let mut keys: Vec<String> = match parsed {
        Ok(serde_json::Value::Object(map)) if !map.is_empty() => map
            .iter()
            .filter(|(_, value)| {
                matches!(value, serde_json::Value::Number(n) if n.as_i64().unwrap_or(0) >= 1)
                    || matches!(value, serde_json::Value::Bool(true))
            })
            .map(|(key, _)| key.clone())
            .collect(),
        _ => Vec::new(),
    };

    if keys.is_empty() {
        keys = CORE.iter().map(|s| s.to_string()).collect();
    }

    keys.sort();
    keys
}

pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn validate_company_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.chars().count() < 2 {
        return Err(AppError::internal("Company name must contain at least 2 characters".to_string()));
    }
    if name.chars().count() > 150 {
        return Err(AppError::internal("Company name cannot exceed 150 characters".to_string()));
    }
    Ok(name.to_string())
}

pub fn validate_currency_code(code: &str) -> Result<String, AppError> {
    let code = code.trim().to_uppercase();
    if code.len() != 3
        || !code
            .chars()
            .all(|character| character.is_ascii_alphabetic())
    {
        return Err(AppError::internal("Currency code must contain exactly 3 letters, for example PKR".to_string()));
    }
    Ok(code)
}

pub fn clean_optional_text(value: Option<String>, field_name: &str, max: usize) -> Result<Option<String>, AppError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max {
        return Err(AppError::internal(format!("{field_name} cannot exceed {max} characters")));
    }
    Ok(Some(value.to_string()))
}

pub async fn audit_for(
    pool: &SqlitePool,
    actor: &PublicUser,
    company_id: &str,
    action: &str,
    resource: &str,
    resource_id: Option<&str>,
    details: &str,
) {
    log_audit(
        pool,
        company_id,
        &actor.id,
        &actor.email,
        &actor.role,
        action,
        resource,
        resource_id,
        details,
    )
    .await;
}
