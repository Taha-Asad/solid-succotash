#![allow(clippy::too_many_arguments)]

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::commands::auth::{
    hash_password, normalize_email, require_current_user, validate_password, validate_person_name,
    PublicUser, SessionState,
};
use crate::commands::company::PublicCompany;
use crate::error::AppError;

// ==========================================
// DATA TRANSFER OBJECTS (SUPER ADMIN)
// ==========================================

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminCompanySummary {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub tax_number: Option<String>,
    pub currency_code: String,
    pub is_active: bool,
    pub created_at: String,
    pub package_id: Option<String>,
    pub package_name: Option<String>,
    pub subscription_status: Option<String>,
    pub user_count: i64,
    pub invoice_count: i64,
    pub total_revenue: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCompanyDetail {
    pub company: PublicCompany,
    pub subscription: Option<CompanySubscriptionRecord>,
    pub package: Option<PackageRecord>,
    pub modules: Vec<CompanyModuleRecord>,
    pub feature_flags: Vec<TenantFeatureFlagRecord>,
    pub users: Vec<PublicUser>,
    pub user_count: i64,
    pub invoice_count: i64,
    pub total_revenue: i64,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanySubscriptionRecord {
    pub id: String,
    pub company_id: String,
    pub package_id: String,
    pub status: String,
    pub current_period_start: String,
    pub current_period_end: String,
    pub trial_ends_at: Option<String>,
    pub metadata: String,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackageRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub billing_cycle: String,
    pub module_limits: String,
    pub max_users: i64,
    pub max_branches: i64,
    pub max_storage_mb: i64,
    pub features: String,
    pub is_active: bool,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanyModuleRecord {
    pub id: String,
    pub company_id: String,
    pub module_key: String,
    pub is_enabled: bool,
    pub settings: String,
}

#[derive(Debug, Serialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TenantFeatureFlagRecord {
    pub id: String,
    pub company_id: String,
    pub feature_key: String,
    pub is_enabled: bool,
    pub enabled_by: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAnalytics {
    pub total_companies: i64,
    pub active_companies: i64,
    pub total_users: i64,
    pub total_invoices: i64,
    pub total_volume_paisas: i64,
    pub package_distribution: Vec<PackageStat>,
    pub recent_activities: Vec<AdminAuditRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageStat {
    pub package_id: String,
    pub package_name: String,
    pub tenant_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditRecord {
    pub id: String,
    pub company_id: String,
    pub user_id: String,
    pub action: String,
    pub entity_type: String,
    pub details: Option<String>,
    pub created_at: String,
}


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTenantPayload {
    pub company_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub currency_code: Option<String>,
    pub admin_name: String,
    pub admin_email: String,
    pub admin_password: String,
    pub package_id: Option<String>,
}

// ==========================================
// AUTHORIZATION HELPER
// ==========================================

pub async fn require_super_admin(
    pool: &SqlitePool,
    session: &SessionState,
) -> Result<PublicUser, AppError> {
    let user = require_current_user(pool, session).await?;
    if !user.is_super_admin && user.role != "super_admin" {
        return Err(AppError::forbidden(
            "Access denied: Super Admin privileges required".to_string(),
        ));
    }
    Ok(user)
}

// ==========================================
// TAURI COMMANDS
// ==========================================

#[tauri::command]
pub async fn admin_get_system_analytics(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<SystemAnalytics, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let total_companies = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM companies")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let active_companies =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM companies WHERE is_active = 1")
            .fetch_one(pool.inner())
            .await
            .map_err(|e| format!("Database error: {e}"))?;

    let total_users = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE is_active = 1 AND is_super_admin = 0",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let total_invoices = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM invoices")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let total_volume_paisas = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(grand_total) FROM invoices WHERE status != 'draft'",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .unwrap_or(0);

    // Distribution across packages
    let distribution_rows = sqlx::query_as::<_, (String, String, i64)>(
        r#"
        SELECT p.id, p.name, COUNT(cs.company_id) AS cnt
        FROM packages AS p
        LEFT JOIN company_subscriptions AS cs
          ON cs.package_id = p.id
        GROUP BY p.id, p.name
        ORDER BY p.sort_order ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let package_distribution = distribution_rows
        .into_iter()
        .map(|(package_id, package_name, tenant_count)| PackageStat {
            package_id,
            package_name,
            tenant_count,
        })
        .collect();

    // Recent system activity
    let recent_activities = sqlx::query_as::<_, AdminAuditRecord>(
        r#"
        SELECT id, company_id, user_id, action, entity_type, details, created_at
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT 15
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    Ok(SystemAnalytics {
        total_companies,
        active_companies,
        total_users,
        total_invoices,
        total_volume_paisas,
        package_distribution,
        recent_activities,
    })
}

#[tauri::command]
pub async fn admin_list_companies(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<AdminCompanySummary>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let rows = sqlx::query_as::<_, AdminCompanySummary>(
        r#"
        SELECT
            c.id,
            c.name,
            c.email,
            c.phone,
            c.tax_number,
            c.currency_code,
            c.is_active,
            c.created_at,
            cs.package_id,
            p.name AS package_name,
            cs.status AS subscription_status,
            COALESCE((SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active = 1), 0) AS user_count,
            COALESCE((SELECT COUNT(*) FROM invoices i WHERE i.company_id = c.id), 0) AS invoice_count,
            COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.company_id = c.id AND i.status != 'draft'), 0) AS total_revenue
        FROM companies AS c
        LEFT JOIN company_subscriptions AS cs ON cs.company_id = c.id
        LEFT JOIN packages AS p ON p.id = cs.package_id
        ORDER BY c.created_at DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(rows)
}

#[tauri::command]
pub async fn admin_get_company_details(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<AdminCompanyDetail, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let company = sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id, name, email, phone, address, tax_number, currency_code,
            is_active, created_at, updated_at, ntn, strn, fbr_registered,
            fbr_registration_date, province
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or_else(|| AppError::not_found("Company not found".to_string()))?;

    let subscription = sqlx::query_as::<_, CompanySubscriptionRecord>(
        r#"
        SELECT id, company_id, package_id, status, current_period_start,
               current_period_end, trial_ends_at, metadata
        FROM company_subscriptions
        WHERE company_id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .unwrap_or(None);

    let package = if let Some(ref sub) = subscription {
        sqlx::query_as::<_, PackageRecord>(
            r#"
            SELECT id, name, description, price, billing_cycle, module_limits,
                   max_users, max_branches, max_storage_mb, features, is_active, sort_order
            FROM packages
            WHERE id = ?
            "#,
        )
        .bind(&sub.package_id)
        .fetch_optional(pool.inner())
        .await
        .unwrap_or(None)
    } else {
        None
    };

    let modules = sqlx::query_as::<_, CompanyModuleRecord>(
        r#"
        SELECT id, company_id, module_key, is_enabled, settings
        FROM company_modules
        WHERE company_id = ?
        ORDER BY module_key ASC
        "#,
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let feature_flags = sqlx::query_as::<_, TenantFeatureFlagRecord>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason
        FROM tenant_feature_flags
        WHERE company_id = ?
        ORDER BY feature_key ASC
        "#,
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let users = sqlx::query_as::<_, PublicUser>(
        r#"
        SELECT id, email, full_name, role, company_id, is_active, created_at,
               is_super_admin, must_change_password
        FROM users
        WHERE company_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    let user_count = users.len() as i64;

    let invoice_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM invoices WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .unwrap_or(0);

    let total_revenue = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(grand_total) FROM invoices WHERE company_id = ? AND status != 'draft'",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .unwrap_or(Some(0))
    .unwrap_or(0);

    Ok(AdminCompanyDetail {
        company,
        subscription,
        package,
        modules,
        feature_flags,
        users,
        user_count,
        invoice_count,
        total_revenue,
    })
}

#[tauri::command]
pub async fn admin_create_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    payload: CreateTenantPayload,
) -> Result<AdminCompanySummary, AppError> {
    let current_super = require_super_admin(pool.inner(), session.inner()).await?;

    let company_name = payload.company_name.trim();
    if company_name.chars().count() < 2 {
        return Err(AppError::validation("Company name must contain at least 2 characters"));
    }

    let admin_name = validate_person_name(&payload.admin_name)?;
    let admin_email = normalize_email(&payload.admin_email)?;
    validate_password(&payload.admin_password)?;

    let package_id = payload.package_id.unwrap_or_else(|| "pkg-basic".to_string());
    let currency_code = payload.currency_code.unwrap_or_else(|| "PKR".to_string()).to_uppercase();

    let company_id = Uuid::new_v4().to_string();
    let admin_id = Uuid::new_v4().to_string();
    let sub_id = Uuid::new_v4().to_string();
    let password_hash = hash_password(&payload.admin_password).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    sqlx::query(
        r#"
        INSERT INTO companies (id, name, email, phone, address, currency_code, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        "#,
    )
    .bind(&company_id)
    .bind(company_name)
    .bind(&payload.email)
    .bind(&payload.phone)
    .bind(&payload.address)
    .bind(&currency_code)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Could not insert company: {e}"))?;

    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, full_name, role, company_id, is_active)
        VALUES (?, ?, ?, ?, 'owner', ?, 1)
        "#,
    )
    .bind(&admin_id)
    .bind(&admin_email)
    .bind(&password_hash)
    .bind(&admin_name)
    .bind(&company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Could not insert admin user: {e}"))?;

    sqlx::query(
        r#"
        INSERT INTO company_subscriptions (
            id, company_id, package_id, status, current_period_start, current_period_end
        )
        VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+1 year'))
        "#,
    )
    .bind(&sub_id)
    .bind(&company_id)
    .bind(&package_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Could not insert subscription: {e}"))?;

    // Seed default modules
    let standard_modules = ["dashboard", "inventory", "sales", "purchases", "reports", "invoices", "customers"];
    for m in standard_modules {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO company_modules (id, company_id, module_key, is_enabled)
            VALUES (?, ?, ?, 1)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&company_id)
        .bind(m)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Could not seed module {m}: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    log_audit(
        pool.inner(),
        &company_id,
        &current_super.id,
        &current_super.email,
        &current_super.role,
        "provision",
        "company",
        Some(&company_id),
        &format!("Super Admin provisioned tenant company '{company_name}' with admin {admin_email}"),
    )
    .await;

    Ok(AdminCompanySummary {
        id: company_id,
        name: company_name.to_string(),
        email: payload.email,
        phone: payload.phone,
        tax_number: None,
        currency_code,
        is_active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        package_id: Some(package_id.clone()),
        package_name: Some(package_id),
        subscription_status: Some("active".to_string()),
        user_count: 1,
        invoice_count: 0,
        total_revenue: 0,
    })
}

#[tauri::command]
pub async fn admin_update_company_status(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    is_active: bool,
) -> Result<(), AppError> {
    let current_super = require_super_admin(pool.inner(), session.inner()).await?;

    let active_int = if is_active { 1 } else { 0 };

    sqlx::query("UPDATE companies SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(active_int)
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let action_str = if is_active { "reactivated" } else { "suspended" };

    log_audit(
        pool.inner(),
        &company_id,
        &current_super.id,
        &current_super.email,
        &current_super.role,
        "update_status",
        "company",
        Some(&company_id),
        &format!("Super Admin {action_str} company {company_id}"),
    )
    .await;

    Ok(())
}

#[tauri::command]
pub async fn admin_update_company_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    package_id: String,
) -> Result<(), AppError> {
    let current_super = require_super_admin(pool.inner(), session.inner()).await?;

    // Verify package exists
    let package_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM packages WHERE id = ?")
        .bind(&package_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    if package_exists == 0 {
        return Err(AppError::not_found(format!("Package '{package_id}' does not exist")));
    }

    sqlx::query(
        r#"
        INSERT INTO company_subscriptions (id, company_id, package_id, status, current_period_start, current_period_end)
        VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+1 year'))
        ON CONFLICT(company_id) DO UPDATE SET
            package_id = excluded.package_id,
            status = 'active',
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&company_id)
    .bind(&package_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    log_audit(
        pool.inner(),
        &company_id,
        &current_super.id,
        &current_super.email,
        &current_super.role,
        "change_package",
        "subscription",
        Some(&company_id),
        &format!("Super Admin upgraded company {company_id} to package '{package_id}'"),
    )
    .await;

    Ok(())
}

#[tauri::command]
pub async fn admin_list_packages(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PackageRecord>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let packages = sqlx::query_as::<_, PackageRecord>(
        r#"
        SELECT id, name, description, price, billing_cycle, module_limits,
               max_users, max_branches, max_storage_mb, features, is_active, sort_order
        FROM packages
        ORDER BY sort_order ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(packages)
}

#[tauri::command]
pub async fn admin_toggle_feature_flag(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    feature_key: String,
    is_enabled: bool,
) -> Result<(), AppError> {
    let current_super = require_super_admin(pool.inner(), session.inner()).await?;

    let is_enabled_int = if is_enabled { 1 } else { 0 };

    sqlx::query(
        r#"
        INSERT INTO tenant_feature_flags (id, company_id, feature_key, is_enabled, enabled_by, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(company_id, feature_key) DO UPDATE SET
            is_enabled = excluded.is_enabled,
            enabled_by = excluded.enabled_by,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&company_id)
    .bind(&feature_key)
    .bind(is_enabled_int)
    .bind(&current_super.email)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    log_audit(
        pool.inner(),
        &company_id,
        &current_super.id,
        &current_super.email,
        &current_super.role,
        "toggle_feature_flag",
        "feature_flag",
        Some(&company_id),
        &format!("Super Admin set feature flag '{feature_key}' to {is_enabled}"),
    )
    .await;

    Ok(())
}

#[tauri::command]
pub async fn admin_bootstrap_super_admin(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    email: String,
    password: String,
    full_name: String,
) -> Result<PublicUser, AppError> {
    let email = normalize_email(&email)?;
    validate_password(&password)?;
    let full_name = validate_person_name(&full_name)?;

    // Check if any super admin exists
    let existing_super_admins = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE is_super_admin = 1 OR role = 'super_admin'",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    // If super admin exists, caller must already be an authenticated super admin
    if existing_super_admins > 0 {
        require_super_admin(pool.inner(), session.inner()).await?;
    }

    let password_hash = hash_password(&password).await?;
    let user_id = Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, full_name, role, company_id, is_active, is_super_admin)
        VALUES (?, ?, ?, ?, 'super_admin', NULL, 1, 1)
        "#,
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&full_name)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Could not create super admin: {e}"))?;

    Ok(PublicUser {
        id: user_id,
        email,
        full_name,
        role: "super_admin".to_string(),
        company_id: None,
        is_active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        is_super_admin: true,
        must_change_password: false,
    })
}

#[cfg(test)]
#[path = "super_admin_tests.rs"]
mod tests;
