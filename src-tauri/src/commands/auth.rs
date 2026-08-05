use bcrypt::{hash as bcrypt_hash, verify as bcrypt_verify, DEFAULT_COST};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use tokio::sync::RwLock;

use crate::commands::audit::log_audit;

// ==========================================
// PUBLIC USER
// ==========================================
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ==========================================
// LOGIN RATE LIMITING (PECA §16.2)
// ==========================================

pub struct LoginAttemptTracker {
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
}

impl LoginAttemptTracker {
    pub fn new() -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
        }
    }

    /// Returns Ok(remaining) if allowed, Err(message) if blocked.
    /// key = email address (or IP for future)
    /// max_attempts = how many tries in the window
    /// window = time window
    pub fn check(&self, key: &str, max_attempts: usize, window: Duration) -> Result<usize, String> {
        let mut map = self.attempts.lock().map_err(|_| "Lock error".to_string())?;
        let now = Instant::now();
        let entry = map.entry(key.to_lowercase()).or_insert_with(Vec::new);

        // Remove expired attempts
        entry.retain(|t| now.duration_since(*t) < window);

        if entry.len() >= max_attempts {
            let remaining = window
                .checked_sub(now.duration_since(entry[0]))
                .unwrap_or(Duration::ZERO);
            Err(format!(
                "Too many login attempts. Try again in {} seconds.",
                remaining.as_secs()
            ))
        } else {
            Ok(max_attempts - entry.len())
        }
    }

    /// Records a failed attempt.
    pub fn record(&self, key: &str) {
        if let Ok(mut map) = self.attempts.lock() {
            map.entry(key.to_lowercase())
                .or_insert_with(Vec::new)
                .push(Instant::now());
        }
    }

    /// Clears the attempt history after a successful login.
    pub fn clear(&self, key: &str) {
        if let Ok(mut map) = self.attempts.lock() {
            map.remove(&key.to_lowercase());
        }
    }
}
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
pub struct UserWithPassword {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub full_name: String,
    pub role: String,
    pub company_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
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
    tracker: State<'_, LoginAttemptTracker>,
    email: String,
    password: String,
) -> Result<PublicUser, String> {
    let email = normalize_email(&email)?;

    // Rate limit: 5 attempts per minute per email (PECA §16.2)
    tracker
        .check(&email, 5, Duration::from_secs(60))
        .map_err(|message| message)?;

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
        None => {
            tracker.record(&email);
            return Err("Invalid email or password".to_string());
        }
    };

    let password_is_correct = verify_password(&password, &user_row.password_hash).await?;

    if !password_is_correct {
        tracker.record(&email);
        return Err("Invalid email or password".to_string());
    }

    tracker.clear(&email);

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

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "profile",
        Some(&current_user.id),
        &format!("Updated own full name to {full_name}"),
    )
    .await;

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

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "password",
        Some(&current_user.id),
        "Changed own password",
    )
    .await;

    Ok(())
}

// ==========================================
// SESSION PERSISTENCE COMMANDS
// ==========================================
//
// These commands save/load the login session to SQLite
// so the user doesn't have to log in again after restarting.
//
// ADD THESE FUNCTIONS TO YOUR auth.rs FILE
// (at the bottom, after the existing commands)
//
// Then register them in lib.rs:
//   commands::auth::save_session,
//   commands::auth::load_saved_session,
//   commands::auth::clear_saved_session,

// ---- Add this function to auth.rs ----

/// Saves the current user's ID to the database so the session
/// persists across app restarts.
#[tauri::command]
pub async fn save_session(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    sqlx::query(
        r#"
        INSERT INTO app_session (id, user_id, saved_at)
        VALUES ('current', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            saved_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&current_user.id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to save session: {e}"))?;

    Ok(())
}

/// Attempts to restore a saved session from the database.
/// Called on app startup before showing the login screen.
/// Returns the user if a valid session exists, or error if not.
#[tauri::command]
pub async fn load_saved_session(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<PublicUser, String> {
    // 1. Check if there's a saved session
    let saved_user_id =
        sqlx::query_scalar::<_, String>("SELECT user_id FROM app_session WHERE id = 'current'")
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Session lookup error: {e}"))?;

    let user_id = match saved_user_id {
        Some(id) => id,
        None => return Err("No saved session".to_string()),
    };

    // 2. Load the user from the database
    let user_row = sqlx::query_as::<_, UserWithPassword>(
        r#"
        SELECT id, email, password_hash, full_name, role, company_id, is_active, created_at
        FROM users
        WHERE id = ? AND is_active = 1
        "#,
    )
    .bind(&user_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("User lookup error: {e}"))?;

    let user = match user_row {
        Some(u) => u,
        None => {
            // User was deactivated or deleted — clear the stale session
            let _ = sqlx::query("DELETE FROM app_session WHERE id = 'current'")
                .execute(pool.inner())
                .await;
            return Err("Saved user no longer active".to_string());
        }
    };

    // 3. Restore the in-memory session
    let public_user = PublicUser {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        company_id: user.company_id,
        is_active: user.is_active,
        created_at: user.created_at,
    };

    set_current_user(&session, public_user.clone()).await;

    Ok(public_user)
}

/// Clears the saved session (called on logout).
#[tauri::command]
pub async fn clear_saved_session(pool: State<'_, SqlitePool>) -> Result<(), String> {
    sqlx::query("DELETE FROM app_session WHERE id = 'current'")
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to clear session: {e}"))?;

    Ok(())
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{deactivate_company, register_owner, setup_app, state_of};

    // ---------------------------------------------------------------
    // normalize_email
    // ---------------------------------------------------------------

    #[test]
    fn normalize_email_trims_and_lowercases() {
        // Input: "  Alice@Example.COM  ".
        // Expected: Ok("alice@example.com").
        assert_eq!(normalize_email("  Alice@Example.COM  ").unwrap(), "alice@example.com");
    }

    #[test]
    fn normalize_email_accepts_valid() {
        // Input: a structurally valid address.
        // Expected: Ok (unchanged except normalization).
        assert!(normalize_email("user@company.pk").is_ok());
    }

    #[test]
    fn normalize_email_rejects_missing_at() {
        // Input: "not-an-email".
        // Expected: Err "Invalid email address".
        assert!(normalize_email("not-an-email").is_err());
    }

    #[test]
    fn normalize_email_rejects_empty_parts() {
        // Inputs: "@x.com", "a@", "a@@b.com", "a@b" (no dot in domain).
        // Expected: all Err "Invalid email address".
        for bad in ["@x.com", "a@", "a@@b.com", "a@b"] {
            assert!(normalize_email(bad).is_err(), "should reject: {bad}");
        }
    }

    #[test]
    fn normalize_email_accepts_dot_leading_domain() {
        // Input: "a@.com" — the validator only requires a dot somewhere in
        // the domain, it does not check the dot's position.
        // Expected: Ok (documents current accepted behaviour).
        assert!(normalize_email("a@.com").is_ok());
    }

    #[test]
    fn normalize_email_rejects_too_long() {
        // Input: 255+ character address.
        // Expected: Err "Email is too long".
        let long = format!("{}@example.com", "a".repeat(250));
        let err = normalize_email(&long).unwrap_err();
        assert_eq!(err, "Email is too long");
    }

    // ---------------------------------------------------------------
    // validate_person_name
    // ---------------------------------------------------------------

    #[test]
    fn person_name_accepts_valid() {
        // Input: "Ali Khan" (>= 2, <= 100 chars).
        // Expected: Ok (trimmed).
        assert_eq!(validate_person_name("  Ali Khan  ").unwrap(), "Ali Khan");
    }

    #[test]
    fn person_name_rejects_too_short() {
        // Input: "A" (1 char).
        // Expected: Err "Full name must contain at least 2 characters".
        assert_eq!(
            validate_person_name("A").unwrap_err(),
            "Full name must contain at least 2 characters"
        );
    }

    #[test]
    fn person_name_rejects_too_long() {
        // Input: 101 characters.
        // Expected: Err "Full name cannot exceed 100 characters".
        let err = validate_person_name(&"a".repeat(101)).unwrap_err();
        assert_eq!(err, "Full name cannot exceed 100 characters");
    }

    // ---------------------------------------------------------------
    // validate_password
    // ---------------------------------------------------------------

    #[test]
    fn password_accepts_eight_chars() {
        // Input: exactly 8 chars.
        // Expected: Ok.
        assert!(validate_password("password").is_ok());
    }

    #[test]
    fn password_rejects_short() {
        // Input: 7 chars.
        // Expected: Err "Password must contain at least 8 characters".
        assert_eq!(
            validate_password("1234567").unwrap_err(),
            "Password must contain at least 8 characters"
        );
    }

    #[test]
    fn password_rejects_over_72_bytes() {
        // Input: 73 ASCII bytes.
        // Expected: Err "Password cannot exceed 72 bytes".
        assert_eq!(
            validate_password(&"a".repeat(73)).unwrap_err(),
            "Password cannot exceed 72 bytes"
        );
    }

    // ---------------------------------------------------------------
    // hash_password / verify_password
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn password_hash_roundtrip() {
        // Input: "secret123" hashed, then verified against the hash.
        // Expected: verify returns true; wrong password returns false.
        let hash = hash_password("secret123").await.expect("hash");
        assert!(verify_password("secret123", &hash).await.unwrap());
        assert!(!verify_password("wrongpass", &hash).await.unwrap());
    }

    #[tokio::test]
    async fn hash_is_never_plaintext() {
        // Input: hash of "secret123".
        // Expected: the stored value does not contain the plaintext password.
        let hash = hash_password("secret123").await.unwrap();
        assert!(!hash.contains("secret123"));
    }

    // ---------------------------------------------------------------
    // map_user_write_error
    // ---------------------------------------------------------------

    #[test]
    fn user_write_error_maps_unique_email() {
        // Input: an sqlx error whose string contains the UNIQUE constraint
        // message for users.email.
        // Expected: friendly "Email address is already registered".
        let raw = sqlx::Error::Protocol("UNIQUE constraint failed: users.email".to_string());
        assert_eq!(map_user_write_error(raw), "Email address is already registered");
    }

    #[test]
    fn user_write_error_passthrough_other_errors() {
        // Input: any other error.
        // Expected: prefixed with "Database error:".
        let raw = sqlx::Error::Protocol("boom".to_string());
        assert!(map_user_write_error(raw).contains("Database error:"));
    }

    // ---------------------------------------------------------------
    // LoginAttemptTracker
    // ---------------------------------------------------------------

    #[test]
    fn tracker_allows_below_max() {
        // Input: 2 recorded attempts, max 5.
        // Expected: Ok with remaining = 3.
        let t = LoginAttemptTracker::new();
        t.record("a@b.com");
        t.record("a@b.com");
        let remaining = t.check("a@b.com", 5, Duration::from_secs(60)).unwrap();
        assert_eq!(remaining, 3);
    }

    #[test]
    fn tracker_blocks_at_max() {
        // Input: 5 recorded attempts, max 5.
        // Expected: Err "Too many login attempts".
        let t = LoginAttemptTracker::new();
        for _ in 0..5 {
            t.record("a@b.com");
        }
        assert!(t.check("a@b.com", 5, Duration::from_secs(60)).is_err());
    }

    #[tokio::test]
    async fn tracker_expires_old_attempts() {
        // Input: 1 attempt recorded, then a 100ms window is checked after 150ms.
        // Expected: Ok — the attempt expired out of the window.
        let t = LoginAttemptTracker::new();
        t.record("a@b.com");
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(t.check("a@b.com", 5, Duration::from_millis(100)).is_ok());
    }

    #[test]
    fn tracker_is_case_insensitive() {
        // Input: recorded under "A@B.com", checked as "a@b.com".
        // Expected: same bucket → blocked after 5.
        let t = LoginAttemptTracker::new();
        for _ in 0..5 {
            t.record("A@B.com");
        }
        assert!(t.check("a@b.com", 5, Duration::from_secs(60)).is_err());
    }

    #[test]
    fn tracker_clear_resets() {
        // Input: 5 recorded attempts, then clear().
        // Expected: check returns Ok again.
        let t = LoginAttemptTracker::new();
        for _ in 0..5 {
            t.record("a@b.com");
        }
        t.clear("a@b.com");
        assert!(t.check("a@b.com", 5, Duration::from_secs(60)).is_ok());
    }

    // ---------------------------------------------------------------
    // login_user
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn login_succeeds_with_valid_credentials() {
        // Input: registered owner email + correct password.
        // Expected: Ok(user); the session is now set (current_user works).
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        logout_user(state_of(&app)).await.expect("logout");

        let user = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "owner@test.com".to_string(),
            "password123".to_string(),
        )
        .await
        .expect("login succeeds");
        assert_eq!(user.email, "owner@test.com");
        assert_eq!(user.role, "owner");

        let current = current_user(state_of(&app), state_of(&app)).await.expect("session set");
        assert_eq!(current.email, "owner@test.com");
    }

    #[tokio::test]
    async fn login_fails_with_wrong_password() {
        // Input: registered owner email + wrong password.
        // Expected: Err "Invalid email or password".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "owner@test.com".to_string(),
            "wrongpass".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email or password");
    }

    #[tokio::test]
    async fn login_fails_with_unknown_email() {
        // Input: unregistered email.
        // Expected: Err "Invalid email or password" (no user enumeration).
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "ghost@test.com".to_string(),
            "password123".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email or password");
    }

    #[tokio::test]
    async fn login_fails_for_inactive_user() {
        // Input: registered owner, then is_active = 0.
        // Expected: Err "Invalid email or password".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        sqlx::query("UPDATE users SET is_active = 0 WHERE id = ?")
            .bind(&owner.id)
            .execute(&*pool)
            .await
            .unwrap();

        let err = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "owner@test.com".to_string(),
            "password123".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email or password");
    }

    #[tokio::test]
    async fn login_fails_for_inactive_company() {
        // Input: registered owner, then company is_active = 0.
        // Expected: Err "Invalid email or password".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        deactivate_company(&*pool, owner.company_id.as_deref().unwrap()).await;

        let err = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "owner@test.com".to_string(),
            "password123".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email or password");
    }

    #[tokio::test]
    async fn login_blocks_after_five_failures() {
        // Input: 5 wrong-password attempts on the same email.
        // Expected: attempts 1–5 fail with "Invalid email or password";
        // attempt 6 is blocked with "Too many login attempts".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        for _ in 0..5 {
            let err = login_user(
                state_of(&app),
                state_of(&app),
                state_of(&app),
                "owner@test.com".to_string(),
                "bad".to_string(),
            )
            .await
            .unwrap_err();
            assert_eq!(err, "Invalid email or password");
        }

        let err = login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "owner@test.com".to_string(),
            "bad".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Too many login attempts"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // logout_user
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn logout_clears_session() {
        // Input: logged-in owner logs out.
        // Expected: logout Ok; current_user then errors "log in first".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        logout_user(state_of(&app)).await.expect("logout");
        let err = current_user(state_of(&app), state_of(&app)).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // current_user
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn current_user_errors_when_not_logged_in() {
        // Input: empty session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = current_user(state_of(&app), state_of(&app)).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn current_user_errors_when_user_deactivated() {
        // Input: session points at a user, but the user was deactivated.
        // Expected: Err "account or company is no longer active".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        sqlx::query("UPDATE users SET is_active = 0 WHERE id = ?")
            .bind(&owner.id)
            .execute(&*pool)
            .await
            .unwrap();

        let err = current_user(state_of(&app), state_of(&app)).await.unwrap_err();
        assert!(err.contains("no longer active"), "got: {err}");
    }

    #[tokio::test]
    async fn current_user_errors_when_company_deactivated() {
        // Input: session points at a user whose company is inactive.
        // Expected: Err "account or company is no longer active".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        deactivate_company(&*pool, owner.company_id.as_deref().unwrap()).await;

        let err = current_user(state_of(&app), state_of(&app)).await.unwrap_err();
        assert!(err.contains("no longer active"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_my_profile
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_profile_succeeds() {
        // Input: owner updates their full name to "New Name".
        // Expected: Ok(user) with full_name = "New Name"; an audit row
        // with resource "profile" is written.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);

        let updated = update_my_profile(state_of(&app), state_of(&app), "New Name".to_string())
            .await
            .expect("update succeeds");
        assert_eq!(updated.full_name, "New Name");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource = 'profile'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "profile update must be audited");
    }

    #[tokio::test]
    async fn update_profile_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = update_my_profile(state_of(&app), state_of(&app), "New Name".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn update_profile_rejects_short_name() {
        // Input: "X" (1 char).
        // Expected: Err about minimum length.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = update_my_profile(state_of(&app), state_of(&app), "X".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("at least 2 characters"), "got: {err}");
    }

    #[tokio::test]
    async fn update_profile_rejects_long_name() {
        // Input: 101 characters.
        // Expected: Err about maximum length.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = update_my_profile(state_of(&app), state_of(&app), "a".repeat(101))
            .await
            .unwrap_err();
        assert!(err.contains("cannot exceed 100"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // change_my_password
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn change_password_succeeds() {
        // Input: correct current password + a new valid password.
        // Expected: Ok; the stored hash verifies against the new password
        // and NOT against the old one; an audit row with resource "password" is written.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);

        change_my_password(
            state_of(&app),
            state_of(&app),
            "password123".to_string(),
            "newpassword456".to_string(),
        )
        .await
        .expect("change succeeds");

        let hash: String =
            sqlx::query_scalar("SELECT password_hash FROM users WHERE email = 'owner@test.com'")
                .fetch_one(&*pool)
                .await
                .unwrap();
        assert!(verify_password("newpassword456", &hash).await.unwrap());
        assert!(!verify_password("password123", &hash).await.unwrap());

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource = 'password'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "password change must be audited");
    }

    #[tokio::test]
    async fn change_password_rejects_wrong_current() {
        // Input: wrong current password.
        // Expected: Err "Current password is incorrect".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = change_my_password(
            state_of(&app),
            state_of(&app),
            "wrong-current".to_string(),
            "newpassword456".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Current password is incorrect");
    }

    #[tokio::test]
    async fn change_password_rejects_same_password() {
        // Input: new password equals the current one.
        // Expected: Err "New password must be different from the current password".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = change_my_password(
            state_of(&app),
            state_of(&app),
            "password123".to_string(),
            "password123".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "New password must be different from the current password");
    }

    #[tokio::test]
    async fn change_password_rejects_short_new_password() {
        // Input: valid current password + a too-short new password.
        // Expected: Err "Password must contain at least 8 characters".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        let err = change_my_password(
            state_of(&app),
            state_of(&app),
            "password123".to_string(),
            "short".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Password must contain at least 8 characters");
    }

    // ---------------------------------------------------------------
    // save_session / load_saved_session / clear_saved_session
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn save_then_load_restores_session() {
        // Input: logged-in owner saves the session, logs out, then loads.
        // Expected: load returns the owner and the in-memory session is restored.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        save_session(state_of(&app), state_of(&app)).await.expect("save");
        logout_user(state_of(&app)).await.expect("logout");

        let loaded = load_saved_session(state_of(&app), state_of(&app))
            .await
            .expect("load");
        assert_eq!(loaded.email, "owner@test.com");

        let current = current_user(state_of(&app), state_of(&app)).await.expect("restored");
        assert_eq!(current.email, "owner@test.com");
    }

    #[tokio::test]
    async fn load_without_saved_session_fails() {
        // Input: no saved session row.
        // Expected: Err "No saved session".
        let app = setup_app().await;
        let err = load_saved_session(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "No saved session");
    }

    #[tokio::test]
    async fn load_clears_stale_session_for_deactivated_user() {
        // Input: saved session, but the user is later deactivated.
        // Expected: load Err "Saved user no longer active"; the app_session
        // row is deleted.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        save_session(state_of(&app), state_of(&app)).await.expect("save");

        sqlx::query("UPDATE users SET is_active = 0 WHERE id = ?")
            .bind(&owner.id)
            .execute(&*pool)
            .await
            .unwrap();
        logout_user(state_of(&app)).await.expect("logout");

        let err = load_saved_session(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "Saved user no longer active");

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM app_session").fetch_one(&*pool).await.unwrap();
        assert_eq!(count, 0, "stale session must be cleared");
    }

    #[tokio::test]
    async fn clear_saved_session_removes_row() {
        // Input: saved session then cleared.
        // Expected: clear Ok; a subsequent load fails with "No saved session".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        save_session(state_of(&app), state_of(&app)).await.expect("save");
        clear_saved_session(state_of(&app)).await.expect("clear");

        let err = load_saved_session(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "No saved session");
    }
}
