// ==========================================
// TEST HELPERS (only compiled in test builds)
// ==========================================
//
// Shared infrastructure for the per-command test modules.
//
// Every integration test runs against a REAL SQLite database:
//   1. a fresh temp-file DB is created,
//   2. all production migrations (001..009) are applied,
//   3. a mock Tauri app is built that manages the pool, the in-memory
//      Rust session, and the login-rate-limit tracker — exactly like
//      lib.rs does at runtime,
//   4. the test calls the real #[tauri::command] functions through
//      the extracted `State` handles.
//
// This means the tests exercise the exact code paths production uses:
//   - SQL schema (migrations 001..009, including role_permissions seeds)
//   - permission checks, soft-deletes and optimistic versioning
//   - audit log writes
//   - session management (require_current_user)

#![cfg(test)]

use std::path::PathBuf;

use sqlx::sqlite::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Manager, State};
use uuid::Uuid;

use crate::commands::auth::{LoginAttemptTracker, PublicUser, SessionState};
use crate::commands::company::{register_company, RegisterCompanyResult};
use crate::db::sqlite_migrate::run_sqlite_migrations;

/// Creates a fresh temp-file SQLite database with all migrations applied.
/// Returns the pool plus the temp file path (kept alive for the test's lifetime).
pub async fn setup_pool() -> (SqlitePool, PathBuf) {
    let path = std::env::temp_dir().join(format!("ijaz-test-{}.db", Uuid::new_v4()));
    let url = format!("sqlite:{}", path.display());

    run_sqlite_migrations(&url)
        .await
        .expect("migrations should apply cleanly");

    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("pool should connect");

    (pool, path)
}

/// Builds a mock Tauri app exactly like lib.rs does:
/// manages the SQLite pool, the Rust session and the login-rate-limit tracker.
pub async fn setup_app() -> tauri::App<MockRuntime> {
    let (pool, _path) = setup_pool().await;

    mock_builder()
        .manage(pool)
        .manage(SessionState::new())
        .manage(LoginAttemptTracker::new())
        .build(mock_context(noop_assets()))
        .expect("mock app should build")
}

/// Extracts a `State` handle to a managed value from the mock app.
pub fn state_of<T>(app: &tauri::App<MockRuntime>) -> State<'_, T>
where
    T: Send + Sync + 'static,
{
    app.state::<T>()
}

/// Registers the very first company + owner and logs them in.
/// Returns the owner's public user (id, email, company_id, role = "owner").
pub async fn register_owner(app: &tauri::App<MockRuntime>, email: &str) -> PublicUser {
    let result = register_company(
        state_of::<SqlitePool>(app),
        state_of::<SessionState>(app),
        "Test Company".to_string(),
        "Test Owner".to_string(),
        email.to_string(),
        "password123".to_string(),
        None,
        None,
        None,
        Some("PKR".to_string()),
    )
    .await
    .expect("register_company should succeed");

    result.user
}

/// Convenience: registers the owner AND returns the full result
/// (company + user) for tests that need the company id.
pub async fn register_owner_full(
    app: &tauri::App<MockRuntime>,
    email: &str,
) -> RegisterCompanyResult {
    register_company(
        state_of::<SqlitePool>(app),
        state_of::<SessionState>(app),
        "Test Company".to_string(),
        "Test Owner".to_string(),
        email.to_string(),
        "password123".to_string(),
        None,
        None,
        None,
        Some("PKR".to_string()),
    )
    .await
    .expect("register_company should succeed")
}

/// Inserts an extra company user directly into the DB (bypasses permissions).
/// Useful for testing owner/admin/employee behaviour.
pub async fn insert_user(
    pool: &SqlitePool,
    company_id: &str,
    email: &str,
    full_name: &str,
    role: &str,
    active: bool,
) -> PublicUser {
    let password_hash = crate::commands::auth::hash_password("password123")
        .await
        .expect("hash should succeed");

    let user_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, full_name, role, company_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&user_id)
    .bind(email)
    .bind(&password_hash)
    .bind(full_name)
    .bind(role)
    .bind(company_id)
    .bind(active)
    .execute(pool)
    .await
    .expect("insert_user should succeed");

    sqlx::query_as::<_, PublicUser>(
        r#"
        SELECT id, email, full_name, role, company_id, is_active, created_at
        FROM users
        WHERE id = ?
        "#,
    )
    .bind(&user_id)
    .fetch_one(pool)
    .await
    .expect("fetch inserted user should succeed")
}

/// Signs a given user into the in-memory session (used to test
/// role-specific behaviour without going through login).
pub async fn set_session_user(app: &tauri::App<MockRuntime>, user: PublicUser) {
    let session = state_of::<SessionState>(app);
    crate::commands::auth::set_current_user(&session, user).await;
}

/// Deactivates the company owned by the given id (simulates an
/// "inactive company" scenario for require_current_user).
pub async fn deactivate_company(pool: &SqlitePool, company_id: &str) {
    sqlx::query("UPDATE companies SET is_active = 0 WHERE id = ?")
        .bind(company_id)
        .execute(pool)
        .await
        .expect("deactivate_company should succeed");
}
