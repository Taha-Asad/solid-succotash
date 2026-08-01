use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::{
    hash_password, map_user_write_error, normalize_email, require_current_user, set_current_user,
    validate_password, validate_person_name, PublicUser, SessionState,
};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicCompany {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub tax_number: Option<String>,
    pub currency_code: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterCompanyResult {
    pub company: PublicCompany,
    pub user: PublicUser,
}

fn validate_company_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let character_count = name.chars().count();

    if character_count < 2 {
        return Err("Company name must contain at least 2 characters".to_string());
    }

    if character_count > 150 {
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

fn clean_optional_text(
    value: Option<String>,
    field_name: &str,
    maximum_length: usize,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    let value = value.trim();

    if value.is_empty() {
        return Ok(None);
    }

    if value.chars().count() > maximum_length {
        return Err(format!(
            "{field_name} cannot exceed {maximum_length} characters"
        ));
    }

    Ok(Some(value.to_string()))
}

fn clean_optional_email(email: Option<String>) -> Result<Option<String>, String> {
    match email {
        Some(email) if !email.trim().is_empty() => Ok(Some(normalize_email(&email)?)),
        _ => Ok(None),
    }
}

async fn fetch_company(pool: &SqlitePool, company_id: &str) -> Result<PublicCompany, String> {
    sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id,
            name,
            email,
            phone,
            address,
            tax_number,
            currency_code,
            is_active,
            created_at,
            updated_at
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Database error: {error}"))
}

// ==========================================
// INITIAL DESKTOP SETUP
// ==========================================

// This creates the desktop company's first owner.
//
// For SQLite desktop mode we intentionally allow only one company.
// PostgreSQL SaaS mode will use a different multi-tenant registration flow.
#[tauri::command]
pub async fn register_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_name: String,
    owner_full_name: String,
    email: String,
    password: String,
    phone: Option<String>,
    address: Option<String>,
    tax_number: Option<String>,
    currency_code: Option<String>,
) -> Result<RegisterCompanyResult, String> {
    let company_name = validate_company_name(&company_name)?;
    let owner_full_name = validate_person_name(&owner_full_name)?;
    let email = normalize_email(&email)?;

    validate_password(&password)?;

    let phone = clean_optional_text(phone, "Phone", 50)?;
    let address = clean_optional_text(address, "Address", 500)?;
    let tax_number = clean_optional_text(tax_number, "Tax number", 100)?;

    let currency_code = validate_currency_code(currency_code.as_deref().unwrap_or("PKR"))?;

    let password_hash = hash_password(&password).await?;

    let company_id = Uuid::new_v4().to_string();
    let owner_id = Uuid::new_v4().to_string();

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not start transaction: {error}"))?;

    let company_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM companies")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| format!("Database error: {error}"))?;

    if company_count > 0 {
        return Err(
            "Company setup has already been completed on this desktop installation".to_string(),
        );
    }

    sqlx::query(
        r#"
        INSERT INTO companies (
            id,
            name,
            email,
            phone,
            address,
            tax_number,
            currency_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&company_id)
    .bind(&company_name)
    .bind(&email)
    .bind(&phone)
    .bind(&address)
    .bind(&tax_number)
    .bind(&currency_code)
    .execute(&mut *transaction)
    .await
    .map_err(|error| format!("Could not create company: {error}"))?;

    sqlx::query(
        r#"
        INSERT INTO users (
            id,
            email,
            password_hash,
            full_name,
            role,
            company_id
        )
        VALUES (?, ?, ?, ?, 'owner', ?)
        "#,
    )
    .bind(&owner_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&owner_full_name)
    .bind(&company_id)
    .execute(&mut *transaction)
    .await
    .map_err(map_user_write_error)?;

    let company = sqlx::query_as::<_, PublicCompany>(
        r#"
        SELECT
            id,
            name,
            email,
            phone,
            address,
            tax_number,
            currency_code,
            is_active,
            created_at,
            updated_at
        FROM companies
        WHERE id = ?
        "#,
    )
    .bind(&company_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let user = sqlx::query_as::<_, PublicUser>(
        r#"
        SELECT
            id,
            email,
            full_name,
            role,
            company_id,
            is_active,
            created_at
        FROM users
        WHERE id = ?
        "#,
    )
    .bind(&owner_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not save company setup: {error}"))?;

    // Automatically log the owner in after initial registration.
    set_current_user(session.inner(), user.clone()).await;

    Ok(RegisterCompanyResult { company, user })
}

// Checks whether the initial desktop company setup has been completed.
//
// This command does not require authentication because the application
// needs it before showing either the setup screen or login screen.
#[tauri::command]
pub async fn is_company_setup(pool: State<'_, SqlitePool>) -> Result<bool, String> {
    let company_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM companies")
        .fetch_one(pool.inner())
        .await
        .map_err(|error| format!("Database error: {error}"))?;

    Ok(company_count > 0)
}
// ==========================================
// COMPANY PROFILE
// ==========================================

#[tauri::command]
pub async fn get_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<PublicCompany, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    fetch_company(pool.inner(), &company_id).await
}

#[tauri::command]
pub async fn update_company(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    email: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    tax_number: Option<String>,
    currency_code: String,
) -> Result<PublicCompany, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err(
            "Only the company owner or an admin can update company information".to_string(),
        );
    }

    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let name = validate_company_name(&name)?;
    let email = clean_optional_email(email)?;
    let phone = clean_optional_text(phone, "Phone", 50)?;
    let address = clean_optional_text(address, "Address", 500)?;
    let tax_number = clean_optional_text(tax_number, "Tax number", 100)?;
    let currency_code = validate_currency_code(&currency_code)?;

    sqlx::query(
        r#"
        UPDATE companies
        SET name = ?,
            email = ?,
            phone = ?,
            address = ?,
            tax_number = ?,
            currency_code = ?,
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
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    fetch_company(pool.inner(), &company_id).await
}
