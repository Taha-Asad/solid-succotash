use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::commands::auth::{
    hash_password, map_user_write_error, normalize_email, require_current_user, validate_password,
    validate_person_name, PublicUser, SessionState,
};
use crate::commands::permissions::check_permission;

fn validate_managed_role(role: &str) -> Result<String, String> {
    match role.trim().to_lowercase().as_str() {
        "admin" => Ok("admin".to_string()),
        "employee" => Ok("employee".to_string()),
        _ => Err("Role must be either admin or employee".to_string()),
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
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err("Only the owner or an admin can view company users".to_string());
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
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "users", "create").await?;

    let role = validate_managed_role(&role)?;

    // Admins may create employees, but only the owner may create admins.
    if current_user.role == "admin" && role != "employee" {
        return Err("An admin may only create employee accounts".to_string());
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

    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "user",
        Some(&user_id),
        &format!("Created {role} account for {email}"),
    )
    .await;

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
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    // Only the owner can promote/demote admins.
    if current_user.role != "owner" {
        return Err("Only the company owner can change user roles".to_string());
    }

    let company_id = get_company_id(&current_user)?;
    let role = validate_managed_role(&role)?;

    let target_user = fetch_company_user(pool.inner(), &company_id, &user_id).await?;

    if target_user.role == "owner" {
        return Err("The company owner role cannot be changed by this command".to_string());
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

    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "user",
        Some(&user_id),
        &format!("Changed role of {user_id} to {role}"),
    )
    .await;

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
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "users", "edit").await?;

    let company_id = get_company_id(&current_user)?;

    let target_user = fetch_company_user(pool.inner(), &company_id, &user_id).await?;

    if target_user.id == current_user.id {
        return Err("You cannot deactivate your own currently logged-in account".to_string());
    }

    if target_user.role == "owner" {
        return Err("The company owner cannot be deactivated".to_string());
    }

    // Admins may manage employees, but not other admins.
    if current_user.role == "admin" && target_user.role != "employee" {
        return Err("An admin may only activate or deactivate employees".to_string());
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

    let status = if active { "activated" } else { "deactivated" };
    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "user",
        Some(&user_id),
        &format!("{status} account {user_id}"),
    )
    .await;

    fetch_company_user(pool.inner(), &company_id, &user_id).await
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
    use tauri::Manager;
    use uuid::Uuid;

    // ---------------------------------------------------------------
    // validate_managed_role (pure)
    // ---------------------------------------------------------------

    #[test]
    fn managed_role_accepts_admin_case_insensitive() {
        // Input: "Admin".
        // Expected: Ok("admin").
        assert_eq!(validate_managed_role("Admin").unwrap(), "admin");
    }

    #[test]
    fn managed_role_accepts_employee() {
        // Input: " employee ".
        // Expected: Ok("employee") — trimmed.
        assert_eq!(validate_managed_role(" employee ").unwrap(), "employee");
    }

    #[test]
    fn managed_role_rejects_other() {
        // Input: "manager".
        // Expected: Err "Role must be either admin or employee".
        assert_eq!(
            validate_managed_role("manager").unwrap_err(),
            "Role must be either admin or employee"
        );
    }

    // ---------------------------------------------------------------
    // get_company_id (pure)
    // ---------------------------------------------------------------

    #[test]
    fn company_id_present_returns_it() {
        // Input: PublicUser with company_id = Some("c1").
        // Expected: Ok("c1").
        let user = PublicUser {
            id: "u1".into(),
            email: "a@b.com".into(),
            full_name: "A".into(),
            role: "owner".into(),
            company_id: Some("c1".into()),
            is_active: true,
            created_at: "2026-01-01".into(),
        };
        assert_eq!(get_company_id(&user).unwrap(), "c1");
    }

    #[test]
    fn company_id_missing_errors() {
        // Input: PublicUser with company_id = None.
        // Expected: Err "User is not assigned to a company".
        let user = PublicUser {
            id: "u1".into(),
            email: "a@b.com".into(),
            full_name: "A".into(),
            role: "employee".into(),
            company_id: None,
            is_active: true,
            created_at: "2026-01-01".into(),
        };
        assert_eq!(
            get_company_id(&user).unwrap_err(),
            "User is not assigned to a company"
        );
    }

    // ---------------------------------------------------------------
    // fetch_company_user (private helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn fetch_company_user_finds_matching() {
        // Input: valid company_id + user_id.
        // Expected: Ok(user).
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let employee = insert_user(&app.state::<SqlitePool>(), owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;

        let found = fetch_company_user(
            &app.state::<SqlitePool>(),
            owner.company_id.as_deref().unwrap(),
            &employee.id,
        )
        .await
        .expect("should find user");
        assert_eq!(found.id, employee.id);
    }

    #[tokio::test]
    async fn fetch_company_user_rejects_wrong_company() {
        // Input: a user id that exists, but paired with a different company id.
        // Expected: Err "Company user was not found".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let employee = insert_user(&app.state::<SqlitePool>(), owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;

        let err = fetch_company_user(&app.state::<SqlitePool>(), "some-other-company", &employee.id)
            .await
            .unwrap_err();
        assert_eq!(err, "Company user was not found");
    }

    #[tokio::test]
    async fn fetch_company_user_rejects_missing() {
        // Input: a random non-existent user id.
        // Expected: Err "Company user was not found".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let err = fetch_company_user(
            &app.state::<SqlitePool>(),
            owner.company_id.as_deref().unwrap(),
            &Uuid::new_v4().to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Company user was not found");
    }

    // ---------------------------------------------------------------
    // list_company_users
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_users_owner_sees_all_ordered_by_role() {
        // Input: owner + one admin + one employee in the company.
        // Expected: 3 users, owner first.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let cid = owner.company_id.as_deref().unwrap();
        insert_user(&pool, cid, "a@test.com", "Alice", "admin", true).await;
        insert_user(&pool, cid, "b@test.com", "Bob", "employee", true).await;

        let users = list_company_users(app.state(), app.state()).await.expect("list");
        assert_eq!(users.len(), 3);
        assert_eq!(users[0].role, "owner");
    }

    #[tokio::test]
    async fn list_users_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_company_users(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn list_users_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Only the owner or an admin can view company users".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let err = list_company_users(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("Only the owner or an admin"), "got: {err}");
    }

    #[tokio::test]
    async fn list_users_rejects_user_without_company() {
        // Input: session user whose company_id is NULL.
        // Expected: Err — require_current_user cannot resolve an active company,
        // so the user is treated as belonging to an inactive/orphaned company.
        let app = setup_app().await;
        let pool = app.state::<SqlitePool>();
        let user_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, full_name, role, company_id)
            VALUES (?, ?, 'x', 'NoCompany', 'owner', NULL)
            "#,
        )
        .bind(&user_id)
        .bind("nc@test.com")
        .execute(&*pool)
        .await
        .unwrap();

        let session_user = sqlx::query_as::<_, PublicUser>(
            "SELECT id, email, full_name, role, company_id, is_active, created_at FROM users WHERE id = ?",
        )
        .bind(&user_id)
        .fetch_one(&*pool)
        .await
        .unwrap();
        set_session_user(&app, session_user).await;

        let err = list_company_users(app.state(), app.state()).await.unwrap_err();
        assert!(
            err.contains("no longer active"),
            "got: {err}"
        );
    }

    // ---------------------------------------------------------------
    // create_company_user
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_user_owner_creates_admin() {
        // Input: owner creates an admin.
        // Expected: Ok(user) with role "admin" and normalized email.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let created = create_company_user(
            app.state(),
            app.state(),
            "NewAdmin@Test.com".to_string(),
            "password123".to_string(),
            "New Admin".to_string(),
            "admin".to_string(),
        )
        .await
        .expect("create admin");
        assert_eq!(created.role, "admin");
        assert_eq!(created.email, "newadmin@test.com");
    }

    #[tokio::test]
    async fn create_user_owner_creates_employee() {
        // Input: owner creates an employee.
        // Expected: Ok(user) with role "employee".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let created = create_company_user(
            app.state(),
            app.state(),
            "emp@test.com".to_string(),
            "password123".to_string(),
            "Emp One".to_string(),
            "employee".to_string(),
        )
        .await
        .expect("create employee");
        assert_eq!(created.role, "employee");
    }

    #[tokio::test]
    async fn create_user_admin_creates_employee() {
        // Input: admin creates an employee.
        // Expected: Ok — admins may create employees.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "admin@test.com", "Adm", "admin", true).await;
        set_session_user(&app, admin).await;

        let created = create_company_user(
            app.state(),
            app.state(),
            "emp@test.com".to_string(),
            "password123".to_string(),
            "Emp Two".to_string(),
            "employee".to_string(),
        )
        .await
        .expect("admin creates employee");
        assert_eq!(created.role, "employee");
    }

    #[tokio::test]
    async fn create_user_admin_cannot_create_admin() {
        // Input: admin tries to create another admin.
        // Expected: Err "An admin may only create employee accounts".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "admin@test.com", "Adm", "admin", true).await;
        set_session_user(&app, admin).await;

        let err = create_company_user(
            app.state(),
            app.state(),
            "admin2@test.com".to_string(),
            "password123".to_string(),
            "Adm Two".to_string(),
            "admin".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "An admin may only create employee accounts");
    }

    #[tokio::test]
    async fn create_user_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_company_user(
            app.state(),
            app.state(),
            "emp@test.com".to_string(),
            "password123".to_string(),
            "Emp".to_string(),
            "employee".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn create_user_denied_for_employee() {
        // Input: employee logged in (no users/create permission).
        // Expected: Err "Access denied".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let err = create_company_user(
            app.state(),
            app.state(),
            "x@test.com".to_string(),
            "password123".to_string(),
            "X".to_string(),
            "employee".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn create_user_rejects_invalid_role() {
        // Input: role "manager".
        // Expected: Err "Role must be either admin or employee".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = create_company_user(
            app.state(),
            app.state(),
            "x@test.com".to_string(),
            "password123".to_string(),
            "X".to_string(),
            "manager".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Role must be either admin or employee");
    }

    #[tokio::test]
    async fn create_user_duplicate_email_rejected() {
        // Input: an email already in use (case-insensitive).
        // Expected: Err "Email address is already registered".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = create_company_user(
            app.state(),
            app.state(),
            "OWNER@test.com".to_string(),
            "password123".to_string(),
            "Dupe".to_string(),
            "employee".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Email address is already registered");
    }

    #[tokio::test]
    async fn create_user_rejects_short_password() {
        // Input: password "short".
        // Expected: Err about minimum length.
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = create_company_user(
            app.state(),
            app.state(),
            "x@test.com".to_string(),
            "short".to_string(),
            "Test User".to_string(),
            "employee".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("at least 8 characters"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_company_user_role
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn change_role_owner_promotes_employee_to_admin() {
        // Input: owner promotes an employee.
        // Expected: Ok(user) with role "admin".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;

        let updated = update_company_user_role(
            app.state(),
            app.state(),
            employee.id.clone(),
            "admin".to_string(),
        )
        .await
        .expect("promote");
        assert_eq!(updated.role, "admin");
    }

    #[tokio::test]
    async fn change_role_owner_demotes_admin_to_employee() {
        // Input: owner demotes an admin.
        // Expected: Ok(user) with role "employee".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a@test.com", "Adm", "admin", true).await;

        let updated = update_company_user_role(
            app.state(),
            app.state(),
            admin.id.clone(),
            "employee".to_string(),
        )
        .await
        .expect("demote");
        assert_eq!(updated.role, "employee");
    }

    #[tokio::test]
    async fn change_role_denied_for_non_owner() {
        // Input: admin tries to change a role.
        // Expected: Err "Only the company owner can change user roles".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a@test.com", "Adm", "admin", true).await;
        set_session_user(&app, admin).await;

        let err = update_company_user_role(
            app.state(),
            app.state(),
            employee.id.clone(),
            "admin".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Only the company owner can change user roles");
    }

    #[tokio::test]
    async fn change_role_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = update_company_user_role(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "admin".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn change_role_cannot_touch_owner() {
        // Input: owner tries to change the (their) owner role via the command.
        // Expected: Err "The company owner role cannot be changed by this command".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = update_company_user_role(
            app.state(),
            app.state(),
            owner.id.clone(),
            "employee".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            err,
            "The company owner role cannot be changed by this command"
        );
    }

    #[tokio::test]
    async fn change_role_rejects_invalid_role() {
        // Input: role "manager".
        // Expected: Err "Role must be either admin or employee".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;

        let err = update_company_user_role(
            app.state(),
            app.state(),
            employee.id.clone(),
            "manager".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Role must be either admin or employee");
    }

    #[tokio::test]
    async fn change_role_rejects_unknown_user() {
        // Input: a random user id.
        // Expected: Err "Company user was not found".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = update_company_user_role(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "admin".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Company user was not found");
    }

    // ---------------------------------------------------------------
    // set_company_user_active
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_active_owner_deactivates_employee() {
        // Input: owner deactivates an employee.
        // Expected: Ok(user) with is_active = false.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;

        let updated = set_company_user_active(
            app.state(),
            app.state(),
            employee.id.clone(),
            false,
        )
        .await
        .expect("deactivate");
        assert!(!updated.is_active);
    }

    #[tokio::test]
    async fn set_active_owner_reactivates() {
        // Input: owner reactivates an inactive employee.
        // Expected: Ok(user) with is_active = true.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", false).await;

        let updated = set_company_user_active(
            app.state(),
            app.state(),
            employee.id.clone(),
            true,
        )
        .await
        .expect("reactivate");
        assert!(updated.is_active);
    }

    #[tokio::test]
    async fn set_active_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = set_company_user_active(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn set_active_cannot_deactivate_self() {
        // Input: owner deactivates their own account.
        // Expected: Err "You cannot deactivate your own currently logged-in account".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            owner.id.clone(),
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You cannot deactivate your own currently logged-in account");
    }

    #[tokio::test]
    async fn set_active_cannot_deactivate_owner() {
        // Input: admin (granted users/edit) tries to deactivate the owner.
        // Expected: Err "The company owner cannot be deactivated".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        sqlx::query(
            "INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES ('rp-test-admin-users-edit', 'admin', 'users', 'edit', 1)",
        )
        .execute(&*pool)
        .await
        .unwrap();
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a@test.com", "Adm", "admin", true).await;
        set_session_user(&app, admin).await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            owner.id.clone(),
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "The company owner cannot be deactivated");
    }

    #[tokio::test]
    async fn set_active_admin_denied_without_permission() {
        // Input: admin WITHOUT the users/edit permission tries to deactivate.
        // Expected: Err "Access denied: admin cannot edit users" — admins have
        // no seeded users/edit row, so check_permission gates them out first.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a@test.com", "Adm", "admin", true).await;
        set_session_user(&app, admin).await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            employee.id.clone(),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn set_active_admin_deactivates_employee() {
        // Input: admin (granted users/edit) deactivates an employee.
        // Expected: Ok(user) with is_active = false.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        sqlx::query(
            "INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES ('rp-test-admin-users-edit', 'admin', 'users', 'edit', 1)",
        )
        .execute(&*pool)
        .await
        .unwrap();
        let admin = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a@test.com", "Adm", "admin", true).await;
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        set_session_user(&app, admin).await;

        let updated = set_company_user_active(
            app.state(),
            app.state(),
            employee.id.clone(),
            false,
        )
        .await
        .expect("admin deactivates employee");
        assert!(!updated.is_active);
    }

    #[tokio::test]
    async fn set_active_admin_cannot_touch_admin() {
        // Input: admin (granted users/edit) tries to deactivate another admin.
        // Expected: Err "An admin may only activate or deactivate employees".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        sqlx::query(
            "INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES ('rp-test-admin-users-edit', 'admin', 'users', 'edit', 1)",
        )
        .execute(&*pool)
        .await
        .unwrap();
        let admin1 = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a1@test.com", "Adm1", "admin", true).await;
        let admin2 = insert_user(&pool, owner.company_id.as_deref().unwrap(), "a2@test.com", "Adm2", "admin", true).await;
        set_session_user(&app, admin1).await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            admin2.id.clone(),
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "An admin may only activate or deactivate employees");
    }

    #[tokio::test]
    async fn set_active_denied_for_employee() {
        // Input: employee tries to change another user's status (no users/edit).
        // Expected: Err "Access denied".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(&pool, owner.company_id.as_deref().unwrap(), "e@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee.clone()).await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            employee.id.clone(),
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn set_active_rejects_unknown_user() {
        // Input: a random user id.
        // Expected: Err "Company user was not found".
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = set_company_user_active(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Company user was not found");
    }
}
