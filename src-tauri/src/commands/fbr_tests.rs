use super::*;
use crate::commands::auth::SessionState;
use crate::commands::test_helpers::{insert_user, register_owner_full, set_session_user, setup_app, state_of};
use sqlx::SqlitePool;
use uuid::Uuid;

async fn create_test_customer(pool: &SqlitePool, company_id: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO customers (id, company_id, name, email, phone, address, buyer_type, is_active) \
         VALUES (?, ?, 'Test Customer', 'cust@test.com', '03001234567', 'Lahore', 'unregistered', 1)",
    )
    .bind(&id)
    .bind(company_id)
    .execute(pool)
    .await
    .expect("insert customer");
    id
}

async fn create_test_invoice(
    pool: &SqlitePool,
    company_id: &str,
    customer_id: &str,
    user_id: &str,
    date: &str,
    total: i64,
    irn: Option<&str>,
) -> String {
    let id = Uuid::new_v4().to_string();
    let invoice_number = format!("INV-{}", &Uuid::new_v4().to_string()[..8]);
    sqlx::query(
        "INSERT INTO invoices (id, company_id, invoice_number, invoice_date, due_date, \
         customer_id, status, subtotal, tax_total, discount_total, grand_total, amount_paid, \
         balance_due, created_by, irn, fbr_status) \
         VALUES (?, ?, ?, ?, ?, ?, 'finalized', ?, 0, 0, ?, 0, ?, ?, ?, 'pending')",
    )
    .bind(&id)
    .bind(company_id)
    .bind(&invoice_number)
    .bind(date)
    .bind(date)
    .bind(customer_id)
    .bind(total)
    .bind(total)
    .bind(total)
    .bind(user_id)
    .bind(irn)
    .execute(pool)
    .await
    .expect("insert invoice");
    id

}

#[tokio::test]
async fn test_fbr_qr_content_format() {
    let qr = fbr_qr_content("IRN-ABC-123", "2026-10-01", "1234567-8", 2500.50);
    assert_eq!(qr, "IRN-ABC-123|2026-10-01|1234567-8|2500.50");
}

#[tokio::test]
async fn test_get_fbr_config_returns_none_initially() {
    let app = setup_app().await;
    let _owner = register_owner_full(&app, "fbr_owner1@test.com").await;

    let config = get_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
    )
    .await
    .expect("get_fbr_config should succeed");

    assert!(config.is_none(), "initially there should be no FBR config");
}

#[tokio::test]
async fn test_get_fbr_config_requires_login() {
    let app = setup_app().await;
    let result = get_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
    )
    .await;

    assert!(result.is_err(), "unauthenticated call should fail");
}

#[tokio::test]
async fn test_save_and_get_fbr_config() {
    let app = setup_app().await;
    let _owner = register_owner_full(&app, "fbr_owner2@test.com").await;

    let saved = save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "sandbox".to_string(),
        true,
        Some("TEST_PRAL_TOKEN_123".to_string()),
    )
    .await
    .expect("save_fbr_config should succeed");

    assert_eq!(saved.environment, "sandbox");
    assert!(saved.is_active);
    assert_eq!(saved.pral_token, Some("TEST_PRAL_TOKEN_123".to_string()));

    let fetched = get_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
    )
    .await
    .expect("get_fbr_config should succeed")
    .expect("config should now exist");

    assert_eq!(fetched.id, saved.id);
    assert_eq!(fetched.environment, "sandbox");
    assert!(fetched.is_active);
    assert_eq!(fetched.pral_token, Some("TEST_PRAL_TOKEN_123".to_string()));
}

#[tokio::test]
async fn test_save_fbr_config_updates_existing() {
    let app = setup_app().await;
    let _owner = register_owner_full(&app, "fbr_owner3@test.com").await;

    let initial = save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "sandbox".to_string(),
        false,
        None,
    )
    .await
    .expect("first save should succeed");

    let updated = save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "production".to_string(),
        true,
        Some("NEW_TOKEN_XYZ".to_string()),
    )
    .await
    .expect("second save should succeed");

    assert_eq!(initial.id, updated.id, "ID should remain identical on upsert");
    assert_eq!(updated.environment, "production");
    assert!(updated.is_active);
    assert_eq!(updated.pral_token, Some("NEW_TOKEN_XYZ".to_string()));
}

#[tokio::test]
async fn test_save_fbr_config_denied_for_employee() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner4@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let employee = insert_user(
        pool.inner(),
        &owner.company.id,
        "employee_fbr@test.com",
        "Employee User",
        "employee",
        true,
    )
    .await;

    set_session_user(&app, employee).await;

    let result = save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "sandbox".to_string(),
        true,
        None,
    )
    .await;

    assert!(result.is_err(), "employee without settings permission must be denied");
}

#[tokio::test]
async fn test_get_fbr_queue_status_empty() {
    let app = setup_app().await;
    let _owner = register_owner_full(&app, "fbr_owner5@test.com").await;

    let status = get_fbr_queue_status(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
    )
    .await
    .expect("queue status should succeed");

    assert_eq!(status.total, 0);
    assert_eq!(status.queued, 0);
    assert_eq!(status.submitting, 0);
    assert_eq!(status.validated, 0);
    assert_eq!(status.failed, 0);
    assert_eq!(status.dead, 0);
    assert!(status.items.is_empty());
}

#[tokio::test]
async fn test_enqueue_fbr_submission_inactive_is_noop() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner6@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    // Save config with is_active = false
    save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "sandbox".to_string(),
        false,
        None,
    )
    .await
    .expect("save config");

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        10000,
        None,
    )
    .await;

    let mut tx = pool.inner().begin().await.expect("begin tx");
    enqueue_fbr_submission(&mut tx, pool.inner(), &owner.company.id, &inv_id)
        .await
        .expect("enqueue should succeed as noop");
    tx.commit().await.expect("commit tx");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fbr_submission_queue")
        .fetch_one(pool.inner())
        .await
        .expect("fetch count");

    assert_eq!(count, 0, "inactive FBR config must not enqueue submissions");
}

#[tokio::test]
async fn test_enqueue_fbr_submission_active_inserts_item() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner7@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    save_fbr_config(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        "sandbox".to_string(),
        true,
        Some("TOKEN".to_string()),
    )
    .await
    .expect("save config");

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        10000,
        None,
    )
    .await;

    let mut tx = pool.inner().begin().await.expect("begin tx");
    enqueue_fbr_submission(&mut tx, pool.inner(), &owner.company.id, &inv_id)
        .await
        .expect("enqueue should succeed");
    tx.commit().await.expect("commit tx");

    let status = get_fbr_queue_status(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
    )
    .await
    .expect("queue status");

    assert_eq!(status.total, 1);
    assert_eq!(status.queued, 1);
    assert_eq!(status.items.len(), 1);
    assert_eq!(status.items[0].invoice_id, inv_id);
    assert_eq!(status.items[0].status, "queued");
}

#[tokio::test]
async fn test_retry_fbr_submission_resets_failed_item() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner8@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        10000,
        None,
    )
    .await;

    let queue_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO fbr_submission_queue (id, company_id, invoice_id, invoice_type, payload, attempt_count, max_attempts, status, last_error) \
         VALUES (?, ?, ?, 'SI', '{}', 3, 5, 'failed', 'Network timeout')",
    )
    .bind(&queue_id)
    .bind(&owner.company.id)
    .bind(&inv_id)
    .execute(pool.inner())
    .await
    .expect("insert failed queue item");

    let retried = retry_fbr_submission(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        queue_id.clone(),
    )
    .await
    .expect("retry should succeed");

    assert_eq!(retried.status, "queued");
    assert_eq!(retried.attempt_count, 0);
    assert!(retried.last_error.is_none());

    let inv_fbr_status: String = sqlx::query_scalar("SELECT fbr_status FROM invoices WHERE id = ?")
        .bind(&inv_id)
        .fetch_one(pool.inner())
        .await
        .expect("fetch invoice fbr status");

    assert_eq!(inv_fbr_status, "pending");
}

#[tokio::test]
async fn test_retry_fbr_submission_rejects_queued_status() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner9@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        10000,
        None,
    )
    .await;

    let queue_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO fbr_submission_queue (id, company_id, invoice_id, invoice_type, payload, attempt_count, max_attempts, status) \
         VALUES (?, ?, ?, 'SI', '{}', 0, 5, 'queued')",
    )
    .bind(&queue_id)
    .bind(&owner.company.id)
    .bind(&inv_id)
    .execute(pool.inner())
    .await
    .expect("insert queued item");

    let result = retry_fbr_submission(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        queue_id,
    )
    .await;

    assert!(result.is_err(), "cannot retry non-failed submissions");
}

#[tokio::test]
async fn test_get_invoice_fbr_status() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner10@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        10000,
        Some("IRN-CONFIRMED-999"),
    )
    .await;

    let status = get_invoice_fbr_status(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        inv_id,
    )
    .await
    .expect("get_invoice_fbr_status should succeed");

    assert_eq!(status.irn, Some("IRN-CONFIRMED-999".to_string()));
    assert_eq!(status.fbr_status, "pending");
}

#[tokio::test]
async fn test_create_credit_note_validations() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner11@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2026-10-01",
        5000,
        Some("IRN-ORIG-123"),
    )
    .await;

    // Test non-positive amount
    let err_neg = create_credit_note(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        inv_id.clone(),
        "Test reason".to_string(),
        0,
        None,
    )
    .await;
    assert!(err_neg.is_err(), "credit amount <= 0 must be rejected");

    // Test amount exceeding original total
    let err_exceed = create_credit_note(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        inv_id.clone(),
        "Test reason".to_string(),
        6000,
        None,
    )
    .await;
    assert!(err_exceed.is_err(), "credit amount > original total must be rejected");

    // Test old invoice > 180 days
    let old_inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        "2025-01-01",
        5000,
        Some("IRN-OLD-123"),
    )
    .await;

    let err_old = create_credit_note(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        old_inv_id,
        "Old reason".to_string(),
        2000,
        None,
    )
    .await;
    assert!(err_old.is_err(), "invoice older than 180 days must be rejected");
}

#[tokio::test]
async fn test_create_credit_note_success() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner12@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        &today,
        5000,
        Some("IRN-ORIG-777"),
    )
    .await;

    let prod_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock) \
         VALUES (?, ?, 'SKU-CR-1', 'Credit Product', 100, 150, 10)",
    )
    .bind(&prod_id)
    .bind(&owner.company.id)
    .execute(pool.inner())
    .await
    .expect("insert test product");

    let items_json = format!(r#"[{{"product_id":"{}","product_name":"Credit Product","product_sku":"SKU-CR-1","quantity":2,"unit_price":1000}}]"#, prod_id);

    let cn = create_credit_note(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        inv_id,
        "Returned items".to_string(),
        2000,
        Some(items_json),
    )
    .await
    .expect("credit note should be created");


    assert_eq!(cn.status, "finalized");
    assert_eq!(cn.grand_total, -2000);
    assert_eq!(cn.irn, Some("IRN-ORIG-777".to_string()));

    let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoice_items WHERE invoice_id = ?")
        .bind(&cn.id)
        .fetch_one(pool.inner())
        .await
        .expect("count credit note items");

    assert_eq!(item_count, 1);
}

#[tokio::test]
async fn test_create_debit_note_success() {
    let app = setup_app().await;
    let owner = register_owner_full(&app, "fbr_owner13@test.com").await;
    let pool = state_of::<SqlitePool>(&app);

    let cust_id = create_test_customer(pool.inner(), &owner.company.id).await;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let inv_id = create_test_invoice(
        pool.inner(),
        &owner.company.id,
        &cust_id,
        &owner.user.id,
        &today,
        5000,
        Some("IRN-ORIG-888"),
    )
    .await;

    let dn = create_debit_note(
        state_of::<SqlitePool>(&app),
        state_of::<SessionState>(&app),
        inv_id,
        "Undercharged on original sale".to_string(),
        1500,
        None,
    )
    .await
    .expect("debit note should be created");

    assert_eq!(dn.status, "finalized");
    assert_eq!(dn.grand_total, 1500);
    assert_eq!(dn.irn, Some("IRN-ORIG-888".to_string()));
}
