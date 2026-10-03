use super::types::*;
use super::helpers::{
    audit_for, clean_optional_text, default_modules_from_package, fetch_modules_for_company,
    fetch_package, fetch_subscription_for_company, now_iso, require_super_admin, validate_company_name,
    validate_currency_code,
};
use crate::commands::auth::{
    hash_password, normalize_email, validate_password, validate_person_name,
    PublicUser, SessionState,
};
use crate::commands::company::PublicCompany;
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// TENANT MANAGEMENT COMMANDS
// ==========================================

// ==========================================
// TENANT (COMPANY) MANAGEMENT — Super Admin
// ==========================================

#[tauri::command]
pub async fn list_tenant_companies(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<TenantCompanySummary>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        return cloud_db.list_tenant_companies().await;
    }

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
        LEFT JOIN company_subscriptions AS s ON s.id = (
            SELECT cs.id FROM company_subscriptions cs WHERE cs.company_id = c.id ORDER BY cs.created_at DESC LIMIT 1
        )
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
) -> Result<TenantCompanyDetail, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        return cloud_db.get_tenant_company_detail(&company_id).await;
    }

    let company = sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id, name, email, phone, address, tax_number,
            currency_code, is_active, created_at, updated_at,
            ntn, strn, fbr_registered, fbr_registration_date, province
        FROM companies
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?
    .ok_or_else(|| AppError::internal("Company not found".to_string()))?;

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
) -> Result<RegisterTenantResult, AppError> {
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

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        return cloud_db
            .register_tenant(
                &company_name,
                &admin_full_name,
                &admin_email,
                &password_hash,
                &package_id,
                phone.as_deref(),
                address.as_deref(),
                tax_number.as_deref(),
                &currency_code,
                ntn.as_deref(),
                strn.as_deref(),
                province.as_deref(),
            )
            .await;
    }

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
            currency_code, is_active, created_at, updated_at,
            ntn, strn, fbr_registered, fbr_registration_date, province
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
        .ok_or_else(|| AppError::internal("Subscription not found".to_string()))?;
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
) -> Result<(), AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        let _ = cloud_db.archive_company(&company_id).await;
    }

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

    if result.rows_affected() == 0 && !cloud_db.is_connected() {
        return Err(AppError::internal("Company not found or already archived".to_string()));
    }

    let _ = sqlx::query("UPDATE users SET token_version = token_version + 1 WHERE company_id = ?")
        .bind(&company_id)
        .execute(pool.inner())
        .await;

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
) -> Result<(), AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        let _ = cloud_db.activate_company(&company_id).await;
    }

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

    if result.rows_affected() == 0 && !cloud_db.is_connected() {
        return Err(AppError::internal("Company not found".to_string()));
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
) -> Result<PublicCompany, AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM companies WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;
    if exists == 0 {
        return Err(AppError::internal("Company not found".to_string()));
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
               is_active, created_at, updated_at,
               ntn, strn, fbr_registered, fbr_registration_date, province
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| AppError::database(format!("Database error: {error}")))
}


