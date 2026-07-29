use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::{
    hash_password,
    map_user_write_error,
    normalize_email,
    require_current_user,
    validate_password,
    validate_person_name,
    PublicUser,
    SessionState,
};

fn validate_managed_role(role: &str) -> Result<String, String> {
    match role.trim().to_lowercase().as_str() {
        "admin" => Ok("admin".to_string()),
        "employee" => Ok("employee".to_string()),
        _ => Err(
            "Role must be either admin or employee".to_string(),
        ),
    }
}

fn get_company_id(user: &PublicUser) -> Result<String, String> {
    user.company_id
        .clone()
        .ok_or_else(|| "User is not assigned to a company".to_string())
}

async fn fetch_company_user(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
) -> Result<PublicUser, String> {
    sqlx::query_as::<_, PublicUser>(
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
          AND company_id = ?
        "#,
    )
    .bind(user_id)
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Database error: {error}"))?
    .ok_or_else(|| "Company user was not found".to_string())
}

// ==========================================
// LIST COMPANY USERS
// ==========================================

#[tauri::command]
pub async fn list_company_users(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicUser>, String> {
    let current_user =
        require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err(
            "Only the owner or an admin can view company users".to_string(),
        );
    }

    let company_id = get_company_id(&current_user)?;

    sqlx::query_as::<_, PublicUser>(
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
        WHERE company_id = ?
        ORDER BY
            CASE role
                WHEN 'owner' THEN 1
                WHEN 'admin' THEN 2
                WHEN 'employee' THEN 3
                ELSE 4
            END,
            full_name COLLATE NOCASE
        "#,
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))
}

// ==========================================
// CREATE ADMIN OR EMPLOYEE
// ==========================================

#[tauri::command]
pub async fn create_company_user(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    email: String,
    password: String,
    full_name: String,
    role: String,
) -> Result<PublicUser, String> {
    let current_user =
        require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err(
            "Only the owner or an admin can create users".to_string(),
        );
    }

    let role = validate_managed_role(&role)?;

    // Admins may create employees, but only the owner may create admins.
    if current_user.role == "admin" && role != "employee" {
        return Err(
            "An admin may only create employee accounts".to_string(),
        );
    }

    let company_id = get_company_id(&current_user)?;
    let email = normalize_email(&email)?;
    let full_name = validate_person_name(&full_name)?;

    validate_password(&password)?;

    let password_hash = hash_password(&password).await?;
    let user_id = Uuid::new_v4().to_string();

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
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&full_name)
    .bind(&role)
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(map_user_write_error)?;

    fetch_company_user(pool.inner(), &company_id, &user_id).await
}

// ==========================================
// CHANGE USER ROLE
// ==========================================

#[tauri::command]
pub async fn update_company_user_role(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    user_id: String,
    role: String,
) -> Result<PublicUser, String> {
    let current_user =
        require_current_user(pool.inner(), session.inner()).await?;

    // Only the owner can promote/demote admins.
    if current_user.role != "owner" {
        return Err(
            "Only the company owner can change user roles".to_string(),
        );
    }

    let company_id = get_company_id(&current_user)?;
    let role = validate_managed_role(&role)?;

    let target_user =
        fetch_company_user(pool.inner(), &company_id, &user_id).await?;

    if target_user.role == "owner" {
        return Err(
            "The company owner role cannot be changed by this command"
                .to_string(),
        );
    }

    sqlx::query(
        r#"
        UPDATE users
        SET role = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND company_id = ?
        "#,
    )
    .bind(&role)
    .bind(&user_id)
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    fetch_company_user(pool.inner(), &company_id, &user_id).await
}

// ==========================================
// ACTIVATE OR DEACTIVATE USER
// ==========================================

// We use soft deactivation instead of DELETE.
//
// Later, users may be referenced by invoices, payments, stock movements
// and audit records. Deleting them would destroy business history.
#[tauri::command]
pub async fn set_company_user_active(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    user_id: String,
    active: bool,
) -> Result<PublicUser, String> {
    let current_user =
        require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err(
            "Only the owner or an admin can activate or deactivate users"
                .to_string(),
        );
    }

    let company_id = get_company_id(&current_user)?;

    let target_user =
        fetch_company_user(pool.inner(), &company_id, &user_id).await?;

    if target_user.id == current_user.id {
        return Err(
            "You cannot deactivate your own currently logged-in account"
                .to_string(),
        );
    }

    if target_user.role == "owner" {
        return Err(
            "The company owner cannot be deactivated".to_string(),
        );
    }

    // Admins may manage employees, but not other admins.
    if current_user.role == "admin" && target_user.role != "employee" {
        return Err(
            "An admin may only activate or deactivate employees"
                .to_string(),
        );
    }

    let active_value = if active { 1_i64 } else { 0_i64 };

    sqlx::query(
        r#"
        UPDATE users
        SET is_active = ?,
            token_version = token_version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND company_id = ?
        "#,
    )
    .bind(active_value)
    .bind(&user_id)
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    fetch_company_user(pool.inner(), &company_id, &user_id).await
}