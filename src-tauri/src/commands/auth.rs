use bcrypt::{hash as bcrypt_hash, verify as bcrypt_verify, DEFAULT_COST};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use tokio::sync::RwLock;

// ==========================================
// PUBLIC USER
// ==========================================

// This structure is safe to send to React.
// It intentionally does not contain password_hash.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub full_name: String,
    pub role: String,
    pub company_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

// Internal database structure.
// This is never returned to React because it contains password_hash.
#[derive(Debug, FromRow)]
struct UserWithPassword {
    id: String,
    email: String,
    password_hash: String,
    full_name: String,
    role: String,
    company_id: Option<String>,
    is_active: bool,
    created_at: String,
}

// ==========================================
// RUST-SIDE SESSION
// ==========================================

// The desktop application has one currently logged-in user.
//
// RwLock means:
// - many parts of the program may read the session
// - only one operation may modify it at a time
pub struct SessionState {
    current_user: RwLock<Option<PublicUser>>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            current_user: RwLock::new(None),
        }
    }
}

// ==========================================
// VALIDATION HELPERS
// ==========================================

pub(crate) fn normalize_email(email: &str) -> Result<String, String> {
    let email = email.trim().to_lowercase();

    if email.len() > 254 {
        return Err("Email is too long".to_string());
    }

    let Some((local, domain)) = email.split_once('@') else {
        return Err("Invalid email address".to_string());
    };

    if local.is_empty() || domain.is_empty() || domain.contains('@') || !domain.contains('.') {
        return Err("Invalid email address".to_string());
    }

    Ok(email)
}

pub(crate) fn validate_person_name(name: &str) -> Result<String, String> {
    let name = name.trim();

    let character_count = name.chars().count();

    if character_count < 2 {
        return Err("Full name must contain at least 2 characters".to_string());
    }

    if character_count > 100 {
        return Err("Full name cannot exceed 100 characters".to_string());
    }

    Ok(name.to_string())
}

pub(crate) fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("Password must contain at least 8 characters".to_string());
    }

    // Traditional bcrypt only considers up to 72 bytes.
    // Rejecting longer passwords prevents misleading password behavior.
    if password.as_bytes().len() > 72 {
        return Err("Password cannot exceed 72 bytes".to_string());
    }

    Ok(())
}

// ==========================================
// PASSWORD HELPERS
// ==========================================

// bcrypt is CPU intensive. spawn_blocking prevents bcrypt from blocking
// Tauri's asynchronous runtime while it works.
pub(crate) async fn hash_password(password: &str) -> Result<String, String> {
    let password = password.to_string();

    tokio::task::spawn_blocking(move || bcrypt_hash(password, DEFAULT_COST))
        .await
        .map_err(|error| format!("Password worker failed: {error}"))?
        .map_err(|error| format!("Failed to hash password: {error}"))
}

async fn verify_password(password: &str, password_hash: &str) -> Result<bool, String> {
    let password = password.to_string();
    let password_hash = password_hash.to_string();

    tokio::task::spawn_blocking(move || bcrypt_verify(password, &password_hash))
        .await
        .map_err(|error| format!("Password worker failed: {error}"))?
        .map_err(|error| format!("Failed to verify password: {error}"))
}

pub(crate) fn map_user_write_error(error: sqlx::Error) -> String {
    let message = error.to_string();

    if message.contains("UNIQUE constraint failed: users.email") {
        "Email address is already registered".to_string()
    } else {
        format!("Database error: {error}")
    }
}

// ==========================================
// SESSION HELPERS
// ==========================================

pub(crate) async fn set_current_user(session: &SessionState, user: PublicUser) {
    *session.current_user.write().await = Some(user);
}

// This does not blindly trust the cached session.
//
// It reloads the user from SQLite and checks:
// - user still exists
// - user is still active
// - company still exists
// - company is still active
//
// This means an admin who is deactivated immediately loses permission.
pub(crate) async fn require_current_user(
    pool: &SqlitePool,
    session: &SessionState,
) -> Result<PublicUser, String> {
    let session_user_id = {
        let session_guard = session.current_user.read().await;

        session_guard.as_ref().map(|user| user.id.clone())
    }
    .ok_or_else(|| "You must log in first".to_string())?;

    let user = sqlx::query_as::<_, PublicUser>(
        r#"
        SELECT
            u.id,
            u.email,
            u.full_name,
            u.role,
            u.company_id,
            u.is_active,
            u.created_at
        FROM users AS u
        INNER JOIN companies AS c
            ON c.id = u.company_id
        WHERE u.id = ?
          AND u.is_active = 1
          AND c.is_active = 1
        "#,
    )
    .bind(&session_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    match user {
        Some(user) => {
            *session.current_user.write().await = Some(user.clone());
            Ok(user)
        }
        None => {
            *session.current_user.write().await = None;

            Err("Your account or company is no longer active. Please log in again.".to_string())
        }
    }
}

// ==========================================
// LOGIN
// ==========================================

#[tauri::command]
pub async fn login_user(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    email: String,
    password: String,
) -> Result<PublicUser, String> {
    let email = normalize_email(&email)?;

    let user_row = sqlx::query_as::<_, UserWithPassword>(
        r#"
        SELECT
            u.id,
            u.email,
            u.password_hash,
            u.full_name,
            u.role,
            u.company_id,
            u.is_active,
            u.created_at
        FROM users AS u
        INNER JOIN companies AS c
            ON c.id = u.company_id
        WHERE u.email = ? COLLATE NOCASE
          AND u.is_active = 1
          AND c.is_active = 1
        "#,
    )
    .bind(&email)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let user_row = match user_row {
        Some(user) => user,
        None => return Err("Invalid email or password".to_string()),
    };

    let password_is_correct = verify_password(&password, &user_row.password_hash).await?;

    if !password_is_correct {
        return Err("Invalid email or password".to_string());
    }

    let public_user = PublicUser {
        id: user_row.id,
        email: user_row.email,
        full_name: user_row.full_name,
        role: user_row.role,
        company_id: user_row.company_id,
        is_active: user_row.is_active,
        created_at: user_row.created_at,
    };

    set_current_user(session.inner(), public_user.clone()).await;

    Ok(public_user)
}

// ==========================================
// LOGOUT AND CURRENT SESSION
// ==========================================

#[tauri::command]
pub async fn logout_user(session: State<'_, SessionState>) -> Result<(), String> {
    *session.current_user.write().await = None;
    Ok(())
}

#[tauri::command]
pub async fn current_user(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<PublicUser, String> {
    require_current_user(pool.inner(), session.inner()).await
}

// ==========================================
// PROFILE AND PASSWORD
// ==========================================

#[tauri::command]
pub async fn update_my_profile(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    full_name: String,
) -> Result<PublicUser, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let full_name = validate_person_name(&full_name)?;

    sqlx::query(
        r#"
        UPDATE users
        SET full_name = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&full_name)
    .bind(&current_user.id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    require_current_user(pool.inner(), session.inner()).await
}

#[tauri::command]
pub async fn change_my_password(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    validate_password(&new_password)?;

    let stored_password_hash =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = ?")
            .bind(&current_user.id)
            .fetch_one(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;

    let current_password_is_correct =
        verify_password(&current_password, &stored_password_hash).await?;

    if !current_password_is_correct {
        return Err("Current password is incorrect".to_string());
    }

    let same_as_old_password = verify_password(&new_password, &stored_password_hash).await?;

    if same_as_old_password {
        return Err("New password must be different from the current password".to_string());
    }

    let new_password_hash = hash_password(&new_password).await?;

    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = ?,
            token_version = token_version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&new_password_hash)
    .bind(&current_user.id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(())
}
