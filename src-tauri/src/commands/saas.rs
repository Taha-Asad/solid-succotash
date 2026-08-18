#![allow(clippy::too_many_arguments)]

// ==========================================
// SAAS LAYER — packages, subscriptions, modules, feature flags
// ==========================================
//
// Multi-tenant management surface (SAAS_SPECIFICATION.md §3, §4, §5).
// Adapted to the desktop/SQLite mode: all tenant tables live in the same
// database and the "current tenant" is derived from the logged-in user's
// company_id. Row-level security and subscription enforcement are
// PostgreSQL/SaaS-mode concerns (§21) and are intentionally NOT shimmed
// here — the subscription data is available but not enforced on existing
// desktop commands.
//
// Authorization model:
//   - Super Admin (is_super_admin = 1): cross-tenant management —
//     package CRUD, tenant registration, subscriptions, feature flags,
//     archiving. Has no company_id.
//   - Company owner/admin: reads own subscription/modules/flags and toggles
//     modules within their own company.
//   - Everyone else: can list active packages.

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::commands::auth::{
    hash_password, normalize_email, require_current_user, validate_password, validate_person_name,
    PublicUser, SessionState,
};
use crate::commands::company::PublicCompany;

// ==========================================
// AUTHORIZATION
// ==========================================

/// Returns the current user ONLY if they are a cross-tenant super admin.
pub(crate) async fn require_super_admin(
    pool: &SqlitePool,
    session: &SessionState,
) -> Result<PublicUser, String> {
    let current_user = require_current_user(pool, session).await?;

    if !current_user.is_super_admin {
        return Err("Super admin access required".to_string());
    }

    Ok(current_user)
}

/// Resolves the target company id for a tenant-scoped read.
/// - None => the caller's own company (any logged-in user).
/// - Some(id) => requires super admin (cross-tenant view).
fn resolve_company_id(actor: &PublicUser, company_id: Option<String>) -> Result<String, String> {
    match company_id {
        Some(id) => {
            if !actor.is_super_admin {
                return Err("Super admin access required".to_string());
            }
            Ok(id)
        }
        None => actor
            .company_id
            .clone()
            .ok_or_else(|| "User is not assigned to a company".to_string()),
    }
}

/// Can `actor` manage modules/settings inside `target_company_id`?
fn can_manage_company(actor: &PublicUser, target_company_id: &str) -> bool {
    actor.is_super_admin
        || (actor.company_id.as_deref() == Some(target_company_id)
            && (actor.role == "owner" || actor.role == "admin"))
}

fn validate_module_key(module_key: &str) -> Result<String, String> {
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
        return Err(format!("Unknown module: {module_key}"));
    }
    Ok(module_key)
}

fn validate_feature_key(feature_key: &str) -> Result<String, String> {
    let feature_key = feature_key.trim().to_lowercase();
    if feature_key.is_empty() {
        return Err("Feature key cannot be empty".to_string());
    }
    Ok(feature_key)
}

// ==========================================
// PUBLIC TYPES
// ==========================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPackage {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub billing_cycle: String,
    pub module_limits: serde_json::Value,
    pub max_users: i64,
    pub max_branches: i64,
    pub max_storage_mb: i64,
    pub features: serde_json::Value,
    pub is_active: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSubscription {
    pub id: String,
    pub company_id: String,
    pub package_id: String,
    pub status: String,
    pub trial_ends_at: Option<String>,
    pub current_period_start: String,
    pub current_period_end: String,
    pub canceled_at: Option<String>,
    pub ended_at: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCompanyModule {
    pub id: String,
    pub company_id: String,
    pub module_key: String,
    pub is_enabled: bool,
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicFeatureFlag {
    pub id: String,
    pub company_id: String,
    pub feature_key: String,
    pub is_enabled: bool,
    pub enabled_by: Option<String>,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantCompanySummary {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub subscription_status: Option<String>,
    pub package_name: Option<String>,
    pub user_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantCompanyDetail {
    pub company: PublicCompany,
    pub subscription: Option<PublicSubscription>,
    pub package: Option<PublicPackage>,
    pub modules: Vec<PublicCompanyModule>,
    pub feature_flags: Vec<PublicFeatureFlag>,
    pub user_count: i64,
    pub ntn: Option<String>,
    pub strn: Option<String>,
    pub province: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTenantResult {
    pub company: PublicCompany,
    pub admin_user: PublicUser,
    pub subscription: PublicSubscription,
    pub modules: Vec<PublicCompanyModule>,
}

// ==========================================
// DB ROW TYPES
// ==========================================

#[derive(Debug, FromRow)]
struct PackageRow {
    id: String,
    name: String,
    description: Option<String>,
    price: f64,
    billing_cycle: String,
    module_limits: String,
    max_users: i64,
    max_branches: i64,
    max_storage_mb: i64,
    features: String,
    is_active: bool,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

impl PackageRow {
    fn to_public(&self) -> PublicPackage {
        PublicPackage {
            module_limits: serde_json::from_str(&self.module_limits).unwrap_or_default(),
            features: serde_json::from_str(&self.features).unwrap_or_default(),
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            price: self.price,
            billing_cycle: self.billing_cycle.clone(),
            max_users: self.max_users,
            max_branches: self.max_branches,
            max_storage_mb: self.max_storage_mb,
            is_active: self.is_active,
            sort_order: self.sort_order,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
struct SubscriptionRow {
    id: String,
    company_id: String,
    package_id: String,
    status: String,
    trial_ends_at: Option<String>,
    current_period_start: String,
    current_period_end: String,
    canceled_at: Option<String>,
    ended_at: Option<String>,
    metadata: String,
    created_at: String,
    updated_at: String,
}

impl SubscriptionRow {
    fn to_public(&self) -> PublicSubscription {
        PublicSubscription {
            metadata: serde_json::from_str(&self.metadata).unwrap_or_default(),
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            package_id: self.package_id.clone(),
            status: self.status.clone(),
            trial_ends_at: self.trial_ends_at.clone(),
            current_period_start: self.current_period_start.clone(),
            current_period_end: self.current_period_end.clone(),
            canceled_at: self.canceled_at.clone(),
            ended_at: self.ended_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
struct CompanyModuleRow {
    id: String,
    company_id: String,
    module_key: String,
    is_enabled: bool,
    settings: String,
    created_at: String,
    updated_at: String,
}

impl CompanyModuleRow {
    fn to_public(&self) -> PublicCompanyModule {
        PublicCompanyModule {
            settings: serde_json::from_str(&self.settings).unwrap_or_default(),
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            module_key: self.module_key.clone(),
            is_enabled: self.is_enabled,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
struct FeatureFlagRow {
    id: String,
    company_id: String,
    feature_key: String,
    is_enabled: bool,
    enabled_by: Option<String>,
    reason: Option<String>,
    expires_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl FeatureFlagRow {
    fn to_public(&self) -> PublicFeatureFlag {
        PublicFeatureFlag {
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            feature_key: self.feature_key.clone(),
            is_enabled: self.is_enabled,
            enabled_by: self.enabled_by.clone(),
            reason: self.reason.clone(),
            expires_at: self.expires_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

// ==========================================
// HELPERS
// ==========================================

const PACKAGE_SELECT: &str = "
    SELECT id, name, description, price, billing_cycle, module_limits,
           max_users, max_branches, max_storage_mb, features,
           is_active, sort_order, created_at, updated_at
    FROM packages
";

async fn fetch_package(pool: &SqlitePool, package_id: &str) -> Result<PackageRow, String> {
    let sql = format!("{PACKAGE_SELECT} WHERE id = ? AND deleted_at IS NULL");
    sqlx::query_as::<_, PackageRow>(sqlx::AssertSqlSafe(&*sql))
        .bind(package_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Database error: {error}"))?
        .ok_or_else(|| "Package not found".to_string())
}

async fn fetch_subscription_for_company(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<Option<PublicSubscription>, String> {
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

async fn fetch_modules_for_company(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<Vec<PublicCompanyModule>, String> {
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
fn default_modules_from_package(module_limits_json: &str) -> Vec<String> {
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

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn validate_company_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.chars().count() < 2 {
        return Err("Company name must contain at least 2 characters".to_string());
    }
    if name.chars().count() > 150 {
        return Err("Company name cannot exceed 150 characters".to_string());
    }
    Ok(name.to_string())
}

fn validate_currency_code(code: &str) -> Result<String, String> {
    let code = code.trim().to_uppercase();
    if code.len() != 3
        || !code
            .chars()
            .all(|character| character.is_ascii_alphabetic())
    {
        return Err("Currency code must contain exactly 3 letters, for example PKR".to_string());
    }
    Ok(code)
}

fn clean_optional_text(value: Option<String>, field_name: &str, max: usize) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > max {
        return Err(format!("{field_name} cannot exceed {max} characters"));
    }
    Ok(Some(value.to_string()))
}

async fn audit_for(
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

// ==========================================
// PACKAGES
// ==========================================

#[tauri::command]
pub async fn list_packages(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    include_inactive: Option<bool>,
) -> Result<Vec<PublicPackage>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let sql = if include_inactive.unwrap_or(false) && current_user.is_super_admin {
        format!("{PACKAGE_SELECT} WHERE deleted_at IS NULL ORDER BY sort_order")
    } else {
        format!("{PACKAGE_SELECT} WHERE deleted_at IS NULL AND is_active = 1 ORDER BY sort_order")
    };

    let rows = sqlx::query_as::<_, PackageRow>(sqlx::AssertSqlSafe(&*sql))
        .fetch_all(pool.inner())
        .await
        .map_err(|error| format!("Database error: {error}"))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

fn validate_json_arg(value: &str, field_name: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(value)
        .map_err(|_| format!("{field_name} must be valid JSON, for example {{\"sales\":1}}"))
}

#[tauri::command]
pub async fn create_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    description: Option<String>,
    price: Option<f64>,
    billing_cycle: Option<String>,
    module_limits: Option<String>,
    max_users: Option<i64>,
    max_branches: Option<i64>,
    max_storage_mb: Option<i64>,
    features: Option<String>,
    sort_order: Option<i64>,
) -> Result<PublicPackage, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let name = name.trim();
    if name.chars().count() < 2 || name.chars().count() > 80 {
        return Err("Package name must be between 2 and 80 characters".to_string());
    }

    let description = clean_optional_text(description, "Description", 500)?;
    let price = price.unwrap_or(0.0).max(0.0);
    let billing_cycle = billing_cycle
        .unwrap_or_else(|| "monthly".to_string())
        .trim()
        .to_lowercase();
    let module_limits_json = module_limits.unwrap_or_else(|| "{}".to_string());
    validate_json_arg(&module_limits_json, "module_limits")?;
    let features_json = features.unwrap_or_else(|| "{}".to_string());
    validate_json_arg(&features_json, "features")?;
    let max_users = max_users.unwrap_or(5).max(0);
    let max_branches = max_branches.unwrap_or(1).max(0);
    let max_storage_mb = max_storage_mb.unwrap_or(100).max(0);
    let sort_order = sort_order.unwrap_or(0);

    let package_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO packages (
            id, name, description, price, billing_cycle, module_limits,
            max_users, max_branches, max_storage_mb, features, is_active, sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        "#,
    )
    .bind(&package_id)
    .bind(name)
    .bind(&description)
    .bind(price)
    .bind(&billing_cycle)
    .bind(&module_limits_json)
    .bind(max_users)
    .bind(max_branches)
    .bind(max_storage_mb)
    .bind(&features_json)
    .bind(sort_order)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "create",
        "package",
        Some(&package_id),
        &format!("Created package {name}"),
    )
    .await;

    fetch_package(pool.inner(), &package_id).await.map(|r| r.to_public())
}

#[tauri::command]
pub async fn update_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    package_id: String,
    name: Option<String>,
    description: Option<String>,
    price: Option<f64>,
    billing_cycle: Option<String>,
    module_limits: Option<String>,
    max_users: Option<i64>,
    max_branches: Option<i64>,
    max_storage_mb: Option<i64>,
    features: Option<String>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<PublicPackage, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let mut current = fetch_package(pool.inner(), &package_id).await?;

    if let Some(name) = name {
        let name = name.trim();
        if name.chars().count() < 2 || name.chars().count() > 80 {
            return Err("Package name must be between 2 and 80 characters".to_string());
        }
        current.name = name.to_string();
    }
    if let Some(description) = description {
        current.description = clean_optional_text(Some(description), "Description", 500)?;
    }
    if let Some(price) = price {
        current.price = price.max(0.0);
    }
    if let Some(billing_cycle) = billing_cycle {
        current.billing_cycle = billing_cycle.trim().to_lowercase();
    }
    if let Some(module_limits) = module_limits {
        validate_json_arg(&module_limits, "module_limits")?;
        current.module_limits = module_limits;
    }
    if let Some(features) = features {
        validate_json_arg(&features, "features")?;
        current.features = features;
    }
    if let Some(max_users) = max_users {
        current.max_users = max_users.max(0);
    }
    if let Some(max_branches) = max_branches {
        current.max_branches = max_branches.max(0);
    }
    if let Some(max_storage_mb) = max_storage_mb {
        current.max_storage_mb = max_storage_mb.max(0);
    }
    if let Some(is_active) = is_active {
        current.is_active = is_active;
    }
    if let Some(sort_order) = sort_order {
        current.sort_order = sort_order;
    }

    sqlx::query(
        r#"
        UPDATE packages
        SET name = ?, description = ?, price = ?, billing_cycle = ?,
            module_limits = ?, max_users = ?, max_branches = ?, max_storage_mb = ?,
            features = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&current.name)
    .bind(&current.description)
    .bind(current.price)
    .bind(&current.billing_cycle)
    .bind(&current.module_limits)
    .bind(current.max_users)
    .bind(current.max_branches)
    .bind(current.max_storage_mb)
    .bind(&current.features)
    .bind(current.is_active)
    .bind(current.sort_order)
    .bind(&package_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "update",
        "package",
        Some(&package_id),
        &format!("Updated package {}", current.name),
    )
    .await;

    fetch_package(pool.inner(), &package_id).await.map(|r| r.to_public())
}

#[tauri::command]
pub async fn delete_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    package_id: String,
) -> Result<(), String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let result = sqlx::query(
        r#"
        UPDATE packages
        SET deleted_at = CURRENT_TIMESTAMP, is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&package_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    if result.rows_affected() == 0 {
        return Err("Package not found".to_string());
    }

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "delete",
        "package",
        Some(&package_id),
        "Soft-deleted package",
    )
    .await;

    Ok(())
}

// ==========================================
// SUBSCRIPTIONS
// ==========================================

#[tauri::command]
pub async fn get_current_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Option<PublicSubscription>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .clone()
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    fetch_subscription_for_company(pool.inner(), &company_id).await
}

#[tauri::command]
pub async fn get_company_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<Option<PublicSubscription>, String> {
    require_super_admin(pool.inner(), session.inner()).await?;
    fetch_subscription_for_company(pool.inner(), &company_id).await
}

#[tauri::command]
pub async fn assign_company_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    package_id: String,
    status: Option<String>,
    trial_days: Option<i64>,
) -> Result<PublicSubscription, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    // Ensure package + company exist.
    fetch_package(pool.inner(), &package_id).await?;
    let company_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM companies WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;
    if company_exists == 0 {
        return Err("Company not found".to_string());
    }

    let status = status.unwrap_or_else(|| "active".to_string());
    if !["active", "trial", "past_due", "suspended", "cancelled", "ended"].contains(&status.as_str())
    {
        return Err("Invalid subscription status".to_string());
    }

    let start = now_iso();
    let trial_ends_at = trial_days.map(|days| {
        (chrono::Utc::now() + chrono::Duration::days(days))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string()
    });
    let period_end = (chrono::Utc::now() + chrono::Duration::days(30))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let existing_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM company_subscriptions WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let subscription_id = match existing_id {
        Some(id) => {
            sqlx::query(
                r#"
                UPDATE company_subscriptions
                SET package_id = ?, status = ?, trial_ends_at = ?,
                    current_period_start = ?, current_period_end = ?,
                    canceled_at = NULL, ended_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(&package_id)
            .bind(&status)
            .bind(&trial_ends_at)
            .bind(&start)
            .bind(&period_end)
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
                INSERT INTO company_subscriptions (
                    id, company_id, package_id, status, trial_ends_at,
                    current_period_start, current_period_end, metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
                "#,
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&package_id)
            .bind(&status)
            .bind(&trial_ends_at)
            .bind(&start)
            .bind(&period_end)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
    };

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "update",
        "subscription",
        Some(&subscription_id),
        &format!("Assigned package {package_id} ({status}) to company {company_id}"),
    )
    .await;

    fetch_subscription_for_company(pool.inner(), &company_id)
        .await?
        .ok_or_else(|| "Subscription not found".to_string())
}

// ==========================================
// COMPANY MODULES
// ==========================================

#[tauri::command]
pub async fn list_company_modules(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: Option<String>,
) -> Result<Vec<PublicCompanyModule>, String> {
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
) -> Result<PublicCompanyModule, String> {
    let actor = require_current_user(pool.inner(), session.inner()).await?;

    if !can_manage_company(&actor, &company_id) {
        return Err("Only company owners/admins or a super admin can change modules".to_string());
    }

    let module_key = validate_module_key(&module_key)?;

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
    .map_err(|error| format!("Database error: {error}"))
    .map(|r| r.to_public())
}

// ==========================================
// FEATURE FLAGS (Super Admin only, spec §3.16)
// ==========================================

#[tauri::command]
pub async fn list_feature_flags(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: Option<String>,
) -> Result<Vec<PublicFeatureFlag>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let target = resolve_company_id(&current_user, company_id)?;

    let rows = sqlx::query_as::<_, FeatureFlagRow>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
               expires_at, created_at, updated_at
        FROM tenant_feature_flags
        WHERE company_id = ?
        ORDER BY feature_key
        "#,
    )
    .bind(&target)
    .fetch_all(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

#[tauri::command]
pub async fn set_feature_flag(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    feature_key: String,
    is_enabled: bool,
    reason: Option<String>,
) -> Result<PublicFeatureFlag, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;
    let feature_key = validate_feature_key(&feature_key)?;
    let reason = clean_optional_text(reason, "Reason", 500)?;

    let existing_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM tenant_feature_flags WHERE company_id = ? AND feature_key = ?",
    )
    .bind(&company_id)
    .bind(&feature_key)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let flag_id = match existing_id {
        Some(id) => {
            sqlx::query(
                r#"
                UPDATE tenant_feature_flags
                SET is_enabled = ?, enabled_by = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(is_enabled)
            .bind(&actor.id)
            .bind(&reason)
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
                INSERT INTO tenant_feature_flags
                    (id, company_id, feature_key, is_enabled, enabled_by, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&feature_key)
            .bind(is_enabled)
            .bind(&actor.id)
            .bind(&reason)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
    };

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "update",
        "feature_flag",
        Some(&flag_id),
        &format!("Set feature flag {feature_key} = {is_enabled}"),
    )
    .await;

    sqlx::query_as::<_, FeatureFlagRow>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
               expires_at, created_at, updated_at
        FROM tenant_feature_flags WHERE id = ?
        "#,
    )
    .bind(&flag_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))
    .map(|r| r.to_public())
}

// ==========================================
// TENANT (COMPANY) MANAGEMENT — Super Admin
// ==========================================

#[tauri::command]
pub async fn list_tenant_companies(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<TenantCompanySummary>, String> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let rows = sqlx::query_as::<_, TenantCompanySummary>(
        r#"
        SELECT
            c.id,
            c.name,
            c.email,
            c.phone,
            c.is_active,
            c.created_at,
            s.status AS subscription_status,
            p.name AS package_name,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count
        FROM companies AS c
        LEFT JOIN company_subscriptions AS s ON s.company_id = c.id
        LEFT JOIN packages AS p ON p.id = s.package_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(rows)
}

#[tauri::command]
pub async fn get_tenant_company_detail(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<TenantCompanyDetail, String> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let company = sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id, name, email, phone, address, tax_number,
            currency_code, is_active, created_at, updated_at
        FROM companies
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?
    .ok_or_else(|| "Company not found".to_string())?;

    let subscription = fetch_subscription_for_company(pool.inner(), &company_id).await?;
    let package = match &subscription {
        Some(sub) => Some(fetch_package(pool.inner(), &sub.package_id).await.map(|r| r.to_public())?),
        None => None,
    };
    let modules = fetch_modules_for_company(pool.inner(), &company_id).await?;

    let feature_flags = sqlx::query_as::<_, FeatureFlagRow>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
               expires_at, created_at, updated_at
        FROM tenant_feature_flags
        WHERE company_id = ?
        ORDER BY feature_key
        "#,
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let user_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE company_id = ? AND is_active = 1")
            .bind(&company_id)
            .fetch_one(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;

    let extra = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>)>(
        "SELECT ntn, strn, province FROM companies WHERE id = ?",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(TenantCompanyDetail {
        company,
        subscription,
        package,
        modules,
        feature_flags: feature_flags.into_iter().map(|r| r.to_public()).collect(),
        user_count,
        ntn: extra.0,
        strn: extra.1,
        province: extra.2,
    })
}

/// Super Admin registers a new tenant (spec §5.2, desktop adaptation):
/// company + initial admin (must_change_password = 1) + subscription +
/// default modules, all in one transaction.
#[tauri::command]
pub async fn register_tenant(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_name: String,
    admin_full_name: String,
    admin_email: String,
    admin_password: String,
    package_id: String,
    phone: Option<String>,
    address: Option<String>,
    tax_number: Option<String>,
    currency_code: Option<String>,
    ntn: Option<String>,
    strn: Option<String>,
    province: Option<String>,
) -> Result<RegisterTenantResult, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let company_name = validate_company_name(&company_name)?;
    let admin_full_name = validate_person_name(&admin_full_name)?;
    let admin_email = normalize_email(&admin_email)?;
    validate_password(&admin_password)?;

    let phone = clean_optional_text(phone, "Phone", 50)?;
    let address = clean_optional_text(address, "Address", 500)?;
    let tax_number = clean_optional_text(tax_number, "Tax number", 100)?;
    let ntn = clean_optional_text(ntn, "NTN", 20)?;
    let strn = clean_optional_text(strn, "STRN", 20)?;
    let province = clean_optional_text(province, "Province", 100)?;
    let currency_code = validate_currency_code(currency_code.as_deref().unwrap_or("PKR"))?;

    let package = fetch_package(pool.inner(), &package_id).await?;
    let password_hash = hash_password(&admin_password).await?;

    let company_id = Uuid::new_v4().to_string();
    let admin_id = Uuid::new_v4().to_string();
    let subscription_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let period_end = (chrono::Utc::now() + chrono::Duration::days(30))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let mut transaction = pool
        .inner()
        .begin()
        .await
        .map_err(|error| format!("Could not start transaction: {error}"))?;

    sqlx::query(
        r#"
        INSERT INTO companies (
            id, name, email, phone, address, tax_number, currency_code,
            ntn, strn, province, version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        "#,
    )
    .bind(&company_id)
    .bind(&company_name)
    .bind(&admin_email)
    .bind(&phone)
    .bind(&address)
    .bind(&tax_number)
    .bind(&currency_code)
    .bind(&ntn)
    .bind(&strn)
    .bind(&province)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not create company: {error}"))?;

    sqlx::query(
        r#"
        INSERT INTO users (
            id, email, password_hash, full_name, role, company_id, is_active,
            is_super_admin, must_change_password
        )
        VALUES (?, ?, ?, ?, 'owner', ?, 1, 0, 1)
        "#,
    )
    .bind(&admin_id)
    .bind(&admin_email)
    .bind(&password_hash)
    .bind(&admin_full_name)
    .bind(&company_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        let message = error.to_string();
        if message.contains("UNIQUE constraint failed: users.email") {
            "Email address is already registered".to_string()
        } else {
            format!("Could not create admin user: {error}")
        }
    })?;

    sqlx::query(
        r#"
        INSERT INTO company_subscriptions (
            id, company_id, package_id, status, trial_ends_at,
            current_period_start, current_period_end, metadata
        )
        VALUES (?, ?, ?, 'active', NULL, ?, ?, '{}')
        "#,
    )
    .bind(&subscription_id)
    .bind(&company_id)
    .bind(&package_id)
    .bind(&now)
    .bind(&period_end)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not create subscription: {error}"))?;

    let module_keys = default_modules_from_package(&package.module_limits);
    for module_key in &module_keys {
        sqlx::query(
            r#"
            INSERT INTO company_modules (id, company_id, module_key, is_enabled, settings)
            VALUES (?, ?, ?, 1, '{}')
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&company_id)
        .bind(module_key)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not enable module {module_key}: {error}"))?;
    }

    sqlx::query(
        r#"
        INSERT INTO company_storage_usage (id, company_id)
        VALUES (?, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&company_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not create storage usage row: {error}"))?;

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not save tenant registration: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "create",
        "company",
        Some(&company_id),
        &format!("Registered tenant {company_name} with package {}", package.name),
    )
    .await;

    let company = sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id, name, email, phone, address, tax_number,
            currency_code, is_active, created_at, updated_at
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let admin_user = sqlx::query_as::<_, PublicUser>(
        r#"
        SELECT id, email, full_name, role, company_id, is_active, created_at,
               is_super_admin, must_change_password
        FROM users
        WHERE id = ?
        "#,
    )
    .bind(&admin_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let subscription = fetch_subscription_for_company(pool.inner(), &company_id)
        .await?
        .ok_or_else(|| "Subscription not found".to_string())?;
    let modules = fetch_modules_for_company(pool.inner(), &company_id).await?;

    Ok(RegisterTenantResult {
        company,
        admin_user,
        subscription,
        modules,
    })
}

/// Soft-archives a company (spec §5.3): deactivates it and invalidates all
/// of its users' tokens. Hard deletes stay disabled for compliance.
#[tauri::command]
pub async fn archive_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<(), String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let result = sqlx::query(
        r#"
        UPDATE companies
        SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    if result.rows_affected() == 0 {
        return Err("Company not found or already archived".to_string());
    }

    sqlx::query("UPDATE users SET token_version = token_version + 1 WHERE company_id = ?")
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "archive",
        "company",
        Some(&company_id),
        "Archived company (soft delete)",
    )
    .await;

    Ok(())
}

#[tauri::command]
pub async fn activate_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<(), String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let result = sqlx::query(
        r#"
        UPDATE companies
        SET is_active = 1, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    if result.rows_affected() == 0 {
        return Err("Company not found".to_string());
    }

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "restore",
        "company",
        Some(&company_id),
        "Reactivated company",
    )
    .await;

    Ok(())
}

/// Super Admin edits a tenant company's core details (spec §5.3).
/// Full-replace semantics: the frontend always sends the complete form.
#[tauri::command]
pub async fn update_tenant_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    tax_number: Option<String>,
    currency_code: Option<String>,
    ntn: Option<String>,
    strn: Option<String>,
    province: Option<String>,
) -> Result<PublicCompany, String> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM companies WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;
    if exists == 0 {
        return Err("Company not found".to_string());
    }

    let name = validate_company_name(&name.unwrap_or_default())?;
    let email = match email {
        Some(e) if e.trim().is_empty() => None,
        Some(e) => Some(normalize_email(&e)?),
        None => None,
    };
    let phone = clean_optional_text(phone, "Phone", 50)?;
    let address = clean_optional_text(address, "Address", 500)?;
    let tax_number = clean_optional_text(tax_number, "Tax number", 100)?;
    let ntn = clean_optional_text(ntn, "NTN", 20)?;
    let strn = clean_optional_text(strn, "STRN", 20)?;
    let province = clean_optional_text(province, "Province", 100)?;
    let currency_code = validate_currency_code(currency_code.as_deref().unwrap_or("PKR"))?;

    sqlx::query(
        r#"
        UPDATE companies SET
            name = ?,
            email = ?,
            phone = ?,
            address = ?,
            tax_number = ?,
            currency_code = ?,
            ntn = ?,
            strn = ?,
            province = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&name)
    .bind(&email)
    .bind(&phone)
    .bind(&address)
    .bind(&tax_number)
    .bind(&currency_code)
    .bind(&ntn)
    .bind(&strn)
    .bind(&province)
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "update",
        "company",
        Some(&company_id),
        "Updated tenant company details",
    )
    .await;

    sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT id, name, email, phone, address, tax_number, currency_code,
               is_active, created_at, updated_at
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))
}

// ==========================================
// PLATFORM ANALYTICS
// ==========================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAnalytics {
    pub mrr: f64,
    pub total_tenants: i64,
    pub active_tenants: i64,
    pub total_users: i64,
    pub subscriptions_by_status: Vec<StatusCount>,
    pub tenants_by_package: Vec<PackageCount>,
    pub monthly_growth: Vec<MonthlyCount>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatusCount {
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PackageCount {
    pub package_id: String,
    pub package_name: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyCount {
    pub month: String,
    pub count: i64,
}

/// Aggregate platform KPIs for the Super Admin analytics view.
/// Requires super admin. Read-only (no audit entries written).
#[tauri::command]
pub async fn get_platform_analytics(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<PlatformAnalytics, String> {
    require_super_admin(pool.inner(), &session).await?;

    let total_tenants: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM companies")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let active_tenants: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM companies WHERE is_active = 1",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let mrr: f64 = sqlx::query_scalar(
        r#"
        SELECT CAST(COALESCE(SUM(CAST(
            CASE WHEN p.billing_cycle = 'yearly' THEN p.price / 12.0 ELSE p.price END
        AS REAL)), 0) AS REAL)
        FROM company_subscriptions s
        JOIN packages p ON p.id = s.package_id
        WHERE s.status IN ('active', 'trial')
        "#,
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let subscriptions_by_status: Vec<StatusCount> = sqlx::query_as(
        r#"
        SELECT COALESCE(status, 'none') AS status, COUNT(*) AS count
        FROM company_subscriptions
        GROUP BY status
        ORDER BY count DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let tenants_by_package: Vec<PackageCount> = sqlx::query_as(
        r#"
        SELECT p.id AS package_id, p.name AS package_name,
               COUNT(s.company_id) AS count
        FROM packages p
        LEFT JOIN company_subscriptions s
               ON s.package_id = p.id AND s.status IN ('active', 'trial')
        GROUP BY p.id, p.name
        ORDER BY count DESC, p.name ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let mut monthly_growth: Vec<MonthlyCount> = sqlx::query_as(
        r#"
        SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
        FROM companies
        GROUP BY month
        ORDER BY month DESC
        LIMIT 6
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;
    monthly_growth.reverse();

    Ok(PlatformAnalytics {
        mrr,
        total_tenants,
        active_tenants,
        total_users,
        subscriptions_by_status,
        tenants_by_package,
        monthly_growth,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::auth::{logout_user, PublicUser};
    use crate::commands::test_helpers::{
        insert_super_admin, register_owner, set_session_user, setup_app, state_of,
    };

    /// Inserts a super admin and signs it into the session.
    async fn login_super_admin(app: &tauri::App<tauri::test::MockRuntime>) -> PublicUser {
        let pool = state_of::<SqlitePool>(app);
        let admin = insert_super_admin(&*pool, "root@admin.test").await;
        set_session_user(app, admin.clone()).await;
        admin
    }

    // ---------------------------------------------------------------
    // list_packages
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_packages_requires_login() {
        let app = setup_app().await;
        let err = list_packages(state_of(&app), state_of(&app), None)
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn seeded_packages_are_listed_for_logged_in_users() {
        // Input: seeded database, any logged-in user.
        // Expected: the 3 default active packages are returned (spec §14.1.6).
        let app = setup_app().await;
        login_super_admin(&app).await;

        let packages = list_packages(state_of(&app), state_of(&app), None)
            .await
            .expect("list packages");
        assert_eq!(packages.len(), 3);
        assert!(packages.iter().any(|p| p.id == "pkg-basic"));
        assert!(packages.iter().any(|p| p.id == "pkg-standard"));
        assert!(packages.iter().any(|p| p.id == "pkg-premium"));
    }

    // ---------------------------------------------------------------
    // create_package
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_package_denied_for_company_owner() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_creates_package() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let created = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            Some("Priority".to_string()),
            Some(9999.0),
            Some("yearly".to_string()),
            Some(r#"{"inventory":1,"sales":1}"#.to_string()),
            Some(50),
            Some(10),
            Some(2000),
            Some(r#"{"fbr":true}"#.to_string()),
            Some(9),
        )
        .await
        .expect("create package");

        assert_eq!(created.name, "Gold");
        assert_eq!(created.price, 9999.0);
        assert_eq!(created.billing_cycle, "yearly");
        assert!(created.is_active);

        let packages = list_packages(state_of(&app), state_of(&app), None)
            .await
            .expect("list");
        assert_eq!(packages.len(), 4);
    }

    #[tokio::test]
    async fn create_package_rejects_bad_json() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let err = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            None,
            None,
            None,
            Some("not-json".to_string()),
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("module_limits must be valid JSON"));
    }

    // ---------------------------------------------------------------
    // register_tenant
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn register_tenant_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn register_tenant_creates_company_subscription_and_modules() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let result = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            Some("+92-300-0000000".to_string()),
            None,
            Some("1234567".to_string()),
            Some("PKR".to_string()),
            None,
            None,
            Some("Punjab".to_string()),
        )
        .await
        .expect("register tenant");

        assert_eq!(result.company.name, "ACME Trading");
        assert_eq!(result.admin_user.role, "owner");
        assert!(result.admin_user.must_change_password);
        assert_eq!(result.admin_user.company_id.as_deref(), Some(result.company.id.as_str()));

        assert_eq!(result.subscription.package_id, "pkg-basic");
        assert_eq!(result.subscription.status, "active");

        // pkg-basic enables: dashboard, inventory, sales, purchases,
        // reports, employees, invoices (branches:0 and import:0 excluded).
        assert_eq!(result.modules.len(), 7);
        assert!(result.modules.iter().any(|m| m.module_key == "invoices"));
        assert!(!result.modules.iter().any(|m| m.module_key == "branches"));

        // The new tenant admin can log in.
        logout_user(state_of(&app)).await.expect("logout");
        let login = crate::commands::auth::login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "admin@acme.com".to_string(),
            "password123".to_string(),
        )
        .await
        .expect("tenant admin can log in");
        assert_eq!(login.company_id.as_deref(), Some(result.company.id.as_str()));
    }

    #[tokio::test]
    async fn register_tenant_rejects_duplicate_email() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME One".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("first tenant");

        let err = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Two".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Email address is already registered");
    }

    // ---------------------------------------------------------------
    // update_tenant_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_tenant_company_requires_super_admin() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let company_id = owner.company_id.unwrap();

        let err = update_tenant_company(
            state_of(&app),
            state_of(&app),
            company_id,
            Some("Renamed".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_updates_tenant_company() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let created = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            Some("+92-300-0000000".to_string()),
            None,
            Some("1234567".to_string()),
            Some("PKR".to_string()),
            None,
            None,
            Some("Punjab".to_string()),
        )
        .await
        .expect("register tenant");

        let updated = update_tenant_company(
            state_of(&app),
            state_of(&app),
            created.company.id.clone(),
            Some("ACME International".to_string()),
            Some("hello@acme.com".to_string()),
            Some("+92-321-1111111".to_string()),
            Some("Main Bazaar, Lahore".to_string()),
            Some("7654321".to_string()),
            Some("USD".to_string()),
            None,
            None,
            None,
        )
        .await
        .expect("update tenant company");

        assert_eq!(updated.name, "ACME International");
        assert_eq!(updated.email.as_deref(), Some("hello@acme.com"));
        assert_eq!(updated.phone.as_deref(), Some("+92-321-1111111"));
        assert_eq!(updated.address.as_deref(), Some("Main Bazaar, Lahore"));
        assert_eq!(updated.tax_number.as_deref(), Some("7654321"));
        assert_eq!(updated.currency_code, "USD");

        let detail = get_tenant_company_detail(state_of(&app), state_of(&app), created.company.id)
            .await
            .expect("fetch detail");
        assert_eq!(detail.company.name, "ACME International");
    }

    #[tokio::test]
    async fn update_tenant_company_unknown_company_rejected() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let err = update_tenant_company(
            state_of(&app),
            state_of(&app),
            "company-does-not-exist".to_string(),
            Some("Nope".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("not found"));
    }

    // ---------------------------------------------------------------
    // get_platform_analytics
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn platform_analytics_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn platform_analytics_aggregates_platform() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let before = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .expect("analytics before");
        assert_eq!(before.total_tenants, 0);

        // Register two tenants on pkg-standard (1499/month) and one on pkg-basic.
        for email in ["admin@one.com", "admin@two.com"] {
            register_tenant(
                state_of(&app),
                state_of(&app),
                "Tenant Co".to_string(),
                "Ali".to_string(),
                email.to_string(),
                "password123".to_string(),
                "pkg-standard".to_string(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .expect("register tenant");
        }
        register_tenant(
            state_of(&app),
            state_of(&app),
            "Basic Co".to_string(),
            "Ali".to_string(),
            "admin@three.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("register basic tenant");

        let after = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .expect("analytics after");
        assert_eq!(after.total_tenants, 3);
        assert_eq!(after.active_tenants, 3);
        assert_eq!(after.total_users, 4); // 3 tenant admins + the super admin
        assert_eq!(after.mrr, 1499.0 * 2.0);

        let by_pkg = after.tenants_by_package;
        let standard = by_pkg.iter().find(|p| p.package_id == "pkg-standard").unwrap();
        assert_eq!(standard.count, 2);
        let basic = by_pkg.iter().find(|p| p.package_id == "pkg-basic").unwrap();
        assert_eq!(basic.count, 1);

        assert!(after
            .subscriptions_by_status
            .iter()
            .any(|s| s.status == "active" && s.count == 3));
        assert!(after.monthly_growth.iter().any(|m| m.count == 3));
    }

    // ---------------------------------------------------------------
    // set_company_module
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_company_module_owner_can_toggle_own_modules() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let company_id = owner.company_id.clone().unwrap();

        let module = set_company_module(
            state_of(&app),
            state_of(&app),
            company_id.clone(),
            "branches".to_string(),
            true,
        )
        .await
        .expect("owner toggles module");
        assert_eq!(module.module_key, "branches");
        assert!(module.is_enabled);

        let modules = list_company_modules(state_of(&app), state_of(&app), None)
            .await
            .expect("list");
        assert!(modules.iter().any(|m| m.module_key == "branches" && m.is_enabled));
    }

    #[tokio::test]
    async fn set_company_module_rejects_unknown_module() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = set_company_module(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "nonsense".to_string(),
            true,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unknown module"));
    }

    // ---------------------------------------------------------------
    // set_feature_flag
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_feature_flag_denied_for_owner() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = set_feature_flag(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "ai_insights".to_string(),
            true,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_toggles_feature_flag() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        login_super_admin(&app).await;

        let flag = set_feature_flag(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "ai_insights".to_string(),
            true,
            Some("Beta rollout".to_string()),
        )
        .await
        .expect("toggle flag");
        assert_eq!(flag.feature_key, "ai_insights");
        assert!(flag.is_enabled);
        assert_eq!(flag.reason.as_deref(), Some("Beta rollout"));
    }

    // ---------------------------------------------------------------
    // assign_company_subscription
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn assign_subscription_denied_for_owner() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "pkg-standard".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_assigns_subscription() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        login_super_admin(&app).await;

        let sub = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "pkg-premium".to_string(),
            Some("trial".to_string()),
            Some(14),
        )
        .await
        .expect("assign");
        assert_eq!(sub.package_id, "pkg-premium");
        assert_eq!(sub.status, "trial");
        assert!(sub.trial_ends_at.is_some());

        // Re-assigning updates, not duplicates.
        let sub2 = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "pkg-standard".to_string(),
            None,
            None,
        )
        .await
        .expect("reassign");
        assert_eq!(sub2.id, sub.id, "one subscription per company");
        assert_eq!(sub2.package_id, "pkg-standard");
    }

    // ---------------------------------------------------------------
    // archive_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn archive_company_deactivates_and_bumps_token_version() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.clone().unwrap();

        // Add a second user so token_version bump is observable.
        crate::commands::test_helpers::insert_user(
            &*pool,
            &company_id,
            "emp@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;

        login_super_admin(&app).await;
        archive_company(state_of(&app), state_of(&app), company_id.clone())
            .await
            .expect("archive");

        let is_active: i64 =
            sqlx::query_scalar("SELECT is_active FROM companies WHERE id = ?")
                .bind(&company_id)
                .fetch_one(&*pool)
                .await
                .unwrap();
        assert_eq!(is_active, 0);

        let versions: Vec<i64> =
            sqlx::query_scalar("SELECT token_version FROM users WHERE company_id = ?")
                .bind(&company_id)
                .fetch_all(&*pool)
                .await
                .unwrap();
        assert!(!versions.is_empty());
        assert!(versions.iter().all(|v| *v >= 1), "token_version bumped");
    }

    // ---------------------------------------------------------------
    // list_tenant_companies / detail
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn tenant_management_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = list_tenant_companies(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_lists_tenants_with_subscription() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("register tenant");

        let companies = list_tenant_companies(state_of(&app), state_of(&app))
            .await
            .expect("list");
        assert_eq!(companies.len(), 1);
        assert_eq!(companies[0].name, "ACME Trading");
        assert_eq!(companies[0].subscription_status.as_deref(), Some("active"));
        assert_eq!(companies[0].package_name.as_deref(), Some("Basic"));
        assert_eq!(companies[0].user_count, 1);

        let detail = get_tenant_company_detail(state_of(&app), state_of(&app), companies[0].id.clone())
            .await
            .expect("detail");
        assert_eq!(detail.company.name, "ACME Trading");
        assert_eq!(detail.province.as_deref(), None);
        assert!(detail.subscription.is_some());
        assert!(!detail.modules.is_empty());
    }
}

