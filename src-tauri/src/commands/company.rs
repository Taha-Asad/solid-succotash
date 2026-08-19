#![allow(clippy::too_many_arguments)]

use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::commands::auth::{
    hash_password, map_user_write_error, normalize_email, require_current_user, set_current_user,
    validate_password, validate_person_name, PublicUser, SessionState,
};
use crate::commands::permissions::check_permission;

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
    pub ntn: Option<String>,
    pub strn: Option<String>,
    pub fbr_registered: bool,
    pub fbr_registration_date: Option<String>,
    pub province: Option<String>,
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
            updated_at,
            ntn,
            strn,
            fbr_registered,
            fbr_registration_date,
            province
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
            updated_at,
            ntn,
            strn,
            fbr_registered,
            fbr_registration_date,
            province
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

    log_audit(
        pool.inner(),
        &company_id,
        &user.id,
        &user.email,
        &user.role,
        "create",
        "company",
        Some(&company_id),
        &format!("Registered company {}", company_name),
    )
    .await;

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

    check_permission(pool.inner(), &current_user.role, "settings", "edit").await?;

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

    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "company",
        Some(&company_id),
        &format!("Updated company profile (name: {name})"),
    )
    .await;

    fetch_company(pool.inner(), &company_id).await
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::auth::SessionState;
    use crate::commands::test_helpers::{insert_user, set_session_user, setup_app, state_of};

    /// Registers the owner through the real command, returning the result.
    async fn register(app: &tauri::App<tauri::test::MockRuntime>) -> RegisterCompanyResult {
        register_company(
            state_of::<SqlitePool>(app),
            state_of::<SessionState>(app),
            "ABC Traders".to_string(),
            "Owner Name".to_string(),
            "owner@test.com".to_string(),
            "password123".to_string(),
            Some("0300-1234567".to_string()),
            Some("Lahore".to_string()),
            Some("TN-001".to_string()),
            Some("PKR".to_string()),
        )
        .await
        .expect("register should succeed")
    }

    // ---------------------------------------------------------------
    // validate_company_name
    // ---------------------------------------------------------------

    #[test]
    fn company_name_trims_and_accepts() {
        // Input: "  Acme Co  " (>= 2, <= 150 chars).
        // Expected: Ok("Acme Co").
        assert_eq!(validate_company_name("  Acme Co  ").unwrap(), "Acme Co");
    }

    #[test]
    fn company_name_rejects_too_short() {
        // Input: "A" (1 char).
        // Expected: Err "Company name must contain at least 2 characters".
        assert_eq!(
            validate_company_name("A").unwrap_err(),
            "Company name must contain at least 2 characters"
        );
    }

    #[test]
    fn company_name_rejects_too_long() {
        // Input: 151 characters.
        // Expected: Err "Company name cannot exceed 150 characters".
        assert_eq!(
            validate_company_name(&"a".repeat(151)).unwrap_err(),
            "Company name cannot exceed 150 characters"
        );
    }

    // ---------------------------------------------------------------
    // validate_currency_code
    // ---------------------------------------------------------------

    #[test]
    fn currency_code_uppercases_valid() {
        // Input: "pkr" (3 letters, lowercase).
        // Expected: Ok("PKR").
        assert_eq!(validate_currency_code("pkr").unwrap(), "PKR");
    }

    #[test]
    fn currency_code_accepts_exact_three_letters() {
        // Input: "USD".
        // Expected: Ok("USD").
        assert_eq!(validate_currency_code("USD").unwrap(), "USD");
    }

    #[test]
    fn currency_code_rejects_wrong_length() {
        // Inputs: "PK" and "PKRS".
        // Expected: both Err about exactly 3 letters.
        for bad in ["PK", "PKRS"] {
            assert!(validate_currency_code(bad).is_err(), "should reject: {bad}");
        }
    }

    #[test]
    fn currency_code_rejects_digits() {
        // Input: "123".
        // Expected: Err.
        assert!(validate_currency_code("123").is_err());
    }

    // ---------------------------------------------------------------
    // clean_optional_text / clean_optional_email
    // ---------------------------------------------------------------

    #[test]
    fn optional_text_none_stays_none() {
        // Input: None.
        // Expected: Ok(None).
        assert_eq!(clean_optional_text(None, "Phone", 50).unwrap(), None);
    }

    #[test]
    fn optional_text_empty_becomes_none() {
        // Input: Some("   ").
        // Expected: Ok(None) — blank trimmed away.
        assert_eq!(
            clean_optional_text(Some("   ".to_string()), "Phone", 50).unwrap(),
            None
        );
    }

    #[test]
    fn optional_text_trims_value() {
        // Input: Some("  0300-111  ").
        // Expected: Ok(Some("0300-111")).
        assert_eq!(
            clean_optional_text(Some("  0300-111  ".to_string()), "Phone", 50).unwrap(),
            Some("0300-111".to_string())
        );
    }

    #[test]
    fn optional_text_rejects_too_long() {
        // Input: a 51-char string with max 50.
        // Expected: Err "Phone cannot exceed 50 characters".
        assert_eq!(
            clean_optional_text(Some("a".repeat(51)), "Phone", 50).unwrap_err(),
            "Phone cannot exceed 50 characters"
        );
    }

    #[test]
    fn optional_email_normalizes() {
        // Input: Some("Alice@Example.COM").
        // Expected: Ok(Some("alice@example.com")).
        assert_eq!(
            clean_optional_email(Some("Alice@Example.COM".to_string())).unwrap(),
            Some("alice@example.com".to_string())
        );
    }

    #[test]
    fn optional_email_blank_becomes_none() {
        // Input: Some("   ").
        // Expected: Ok(None).
        assert_eq!(clean_optional_email(Some("   ".to_string())).unwrap(), None);
    }

    #[test]
    fn optional_email_rejects_invalid() {
        // Input: Some("not-an-email").
        // Expected: Err "Invalid email address".
        assert!(clean_optional_email(Some("not-an-email".to_string())).is_err());
    }

    // ---------------------------------------------------------------
    // register_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn register_creates_company_and_owner_and_logs_in() {
        // Input: valid company details.
        // Expected: Ok(company + user); role "owner"; currency "PKR";
        // session is set (current_user works); an audit row is written.
        let app = setup_app().await;
        let result = register(&app).await;

        assert_eq!(result.company.name, "ABC Traders");
        assert_eq!(result.user.role, "owner");
        assert_eq!(result.company.currency_code, "PKR");

        let current = crate::commands::auth::current_user(state_of(&app), state_of(&app))
            .await
            .expect("owner logged in after registration");
        assert_eq!(current.email, "owner@test.com");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'create' AND resource = 'company'",
        )
        .fetch_one(&*state_of::<SqlitePool>(&app))
        .await
        .unwrap();
        assert_eq!(count, 1, "registration must be audited");
    }

    #[tokio::test]
    async fn register_allows_only_one_company() {
        // Input: a second register_company call on the same DB.
        // Expected: Err "Company setup has already been completed".
        let app = setup_app().await;
        register(&app).await;
        let err = register_company(
            state_of(&app),
            state_of(&app),
            "Second Co".to_string(),
            "Another Owner".to_string(),
            "second@test.com".to_string(),
            "password123".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("already been completed"), "got: {err}");
    }

    #[tokio::test]
    async fn register_rejects_short_company_name() {
        // Input: company name "A".
        // Expected: Err about minimum length.
        let app = setup_app().await;
        let err = register_company(
            state_of(&app),
            state_of(&app),
            "A".to_string(),
            "Owner".to_string(),
            "owner@test.com".to_string(),
            "password123".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("at least 2 characters"), "got: {err}");
    }

    #[tokio::test]
    async fn register_rejects_invalid_email() {
        // Input: email "not-an-email".
        // Expected: Err "Invalid email address".
        let app = setup_app().await;
        let err = register_company(
            state_of(&app),
            state_of(&app),
            "ABC Traders".to_string(),
            "Owner".to_string(),
            "not-an-email".to_string(),
            "password123".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email address");
    }

    #[tokio::test]
    async fn register_rejects_short_password() {
        // Input: password "short".
        // Expected: Err "Password must contain at least 8 characters".
        let app = setup_app().await;
        let err = register_company(
            state_of(&app),
            state_of(&app),
            "ABC Traders".to_string(),
            "Owner".to_string(),
            "owner@test.com".to_string(),
            "short".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Password must contain at least 8 characters");
    }

    #[tokio::test]
    async fn register_rejects_invalid_currency() {
        // Input: currency code "INR1" (4 chars).
        // Expected: Err about exactly 3 letters.
        let app = setup_app().await;
        let err = register_company(
            state_of(&app),
            state_of(&app),
            "ABC Traders".to_string(),
            "Owner".to_string(),
            "owner@test.com".to_string(),
            "password123".to_string(),
            None,
            None,
            None,
            Some("INR1".to_string()),
        )
        .await
        .unwrap_err();
        assert!(err.contains("exactly 3 letters"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // is_company_setup
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn is_company_setup_false_before_registration() {
        // Input: empty DB.
        // Expected: Ok(false).
        let app = setup_app().await;
        assert!(!is_company_setup(state_of(&app)).await.unwrap());
    }

    #[tokio::test]
    async fn is_company_setup_true_after_registration() {
        // Input: registered company.
        // Expected: Ok(true).
        let app = setup_app().await;
        register(&app).await;
        assert!(is_company_setup(state_of(&app)).await.unwrap());
    }

    // ---------------------------------------------------------------
    // get_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_company_returns_company() {
        // Input: logged-in owner.
        // Expected: Ok(company) with matching id/name.
        let app = setup_app().await;
        let result = register(&app).await;
        let company = get_company(state_of(&app), state_of(&app))
            .await
            .expect("get company");
        assert_eq!(company.id, result.company.id);
        assert_eq!(company.name, "ABC Traders");
    }

    #[tokio::test]
    async fn get_company_requires_login() {
        // Input: empty session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = get_company(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_company_succeeds_for_owner() {
        // Input: owner updates name to "New Name Ltd".
        // Expected: Ok(company) with new name; audit row written.
        let app = setup_app().await;
        register(&app).await;
        let pool = state_of::<SqlitePool>(&app);
        sqlx::query("DELETE FROM audit_logs")
            .execute(&*pool)
            .await
            .unwrap();

        let updated = update_company(
            state_of(&app),
            state_of(&app),
            "New Name Ltd".to_string(),
            Some("new@test.com".to_string()),
            None,
            None,
            None,
            "USD".to_string(),
        )
        .await
        .expect("update succeeds");
        assert_eq!(updated.name, "New Name Ltd");
        assert_eq!(updated.currency_code, "USD");
        assert_eq!(updated.email.as_deref(), Some("new@test.com"));

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE resource = 'company'")
                .fetch_one(&*pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "company update must be audited");
    }

    #[tokio::test]
    async fn update_company_succeeds_for_admin() {
        // Input: logged-in admin (has settings/edit via rp-38).
        // Expected: Ok — admins may edit company info.
        let app = setup_app().await;
        let result = register(&app).await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = result.user.company_id.as_deref().unwrap();
        let admin = insert_user(&pool, company_id, "admin@test.com", "Admin", "admin", true).await;
        set_session_user(&app, admin).await;

        let updated = update_company(
            state_of(&app),
            state_of(&app),
            "Admin Renamed".to_string(),
            None,
            None,
            None,
            None,
            "PKR".to_string(),
        )
        .await
        .expect("admin may update company");
        assert_eq!(updated.name, "Admin Renamed");
    }

    #[tokio::test]
    async fn update_company_denied_for_employee() {
        // Input: logged-in employee (no settings/edit permission).
        // Expected: Err "Access denied".
        let app = setup_app().await;
        let result = register(&app).await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = result.user.company_id.as_deref().unwrap();
        let employee =
            insert_user(&pool, company_id, "emp@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let err = update_company(
            state_of(&app),
            state_of(&app),
            "Renamed".to_string(),
            None,
            None,
            None,
            None,
            "PKR".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn update_company_requires_login() {
        // Input: empty session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = update_company(
            state_of(&app),
            state_of(&app),
            "Renamed".to_string(),
            None,
            None,
            None,
            None,
            "PKR".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn update_company_rejects_invalid_currency() {
        // Input: currency "XX".
        // Expected: Err about exactly 3 letters.
        let app = setup_app().await;
        register(&app).await;
        let err = update_company(
            state_of(&app),
            state_of(&app),
            "Renamed".to_string(),
            None,
            None,
            None,
            None,
            "XX".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("exactly 3 letters"), "got: {err}");
    }

    #[tokio::test]
    async fn update_company_rejects_invalid_email() {
        // Input: email "bad-email".
        // Expected: Err "Invalid email address".
        let app = setup_app().await;
        register(&app).await;
        let err = update_company(
            state_of(&app),
            state_of(&app),
            "Renamed".to_string(),
            Some("bad-email".to_string()),
            None,
            None,
            None,
            "PKR".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid email address");
    }

    // ---------------------------------------------------------------
    // fetch_company (private helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn fetch_company_returns_row() {
        // Input: a valid company id.
        // Expected: Ok(company).
        let app = setup_app().await;
        let result = register(&app).await;
        let company = fetch_company(&*state_of::<SqlitePool>(&app), &result.company.id)
            .await
            .expect("fetch");
        assert_eq!(company.id, result.company.id);
    }
}
