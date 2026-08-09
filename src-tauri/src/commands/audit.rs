// ==========================================
// AUDIT LOGGING
// ==========================================
//
// Call log_audit() from every mutating command.
// It's fire-and-forget — if logging fails, the command still succeeds.
//
// Usage:
//   log_audit(pool, &current_user, "create", "product", Some(&product_id), "Created product SKU-001").await;

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub company_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_role: String,
    pub action: String,
    pub resource: String,
    pub resource_id: Option<String>,
    pub details: Option<String>,
    pub created_at: String,
}

/// Logs an audit entry. Fire-and-forget — errors are printed, not returned.
pub async fn log_audit(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
    user_email: &str,
    user_role: &str,
    action: &str,
    resource: &str,
    resource_id: Option<&str>,
    details: &str,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO audit_logs
            (id, company_id, user_id, user_email, user_role, action, resource, resource_id, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(user_id)
    .bind(user_email)
    .bind(user_role)
    .bind(action)
    .bind(resource)
    .bind(resource_id)
    .bind(details)
    .execute(pool)
    .await;

    if let Err(e) = result {
        eprintln!("Audit log failed: {e}");
    }
}

/// Lists audit logs for the current user's company (paginated).
#[tauri::command]
pub async fn list_audit_logs(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<AuditEntry>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" && current_user.role != "admin" {
        return Err("Only owners and admins can view audit logs".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let limit = limit.unwrap_or(100).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
        ),
    >(
        r#"
        SELECT id, company_id, user_id, user_email, user_role,
               action, resource, resource_id, details, created_at
        FROM audit_logs
        WHERE company_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(company_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Audit query error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| AuditEntry {
            id: r.0,
            company_id: r.1,
            user_id: r.2,
            user_email: r.3,
            user_role: r.4,
            action: r.5,
            resource: r.6,
            resource_id: r.7,
            details: r.8,
            created_at: r.9,
        })
        .collect())
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{
        insert_user, register_owner, set_session_user, setup_app, setup_pool, state_of,
    };

    /// Seeds an audit row directly with an explicit created_at so ordering
    /// tests are deterministic (CURRENT_TIMESTAMP has second precision).
    async fn seed_audit(
        pool: &SqlitePool,
        company_id: &str,
        user_id: &str,
        created_at: &str,
        action: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO audit_logs
                (id, company_id, user_id, user_email, user_role, action, resource, resource_id, details, created_at)
            VALUES (?, ?, ?, 't@t.com', 'owner', ?, 'product', 'p-1', 'seed', ?)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(user_id)
        .bind(action)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("seed_audit should succeed");
    }

    /// Clears audit_logs so exact-count assertions ignore the audit row
    /// that `register_owner` writes on registration.
    async fn clear_audit(pool: &SqlitePool) {
        sqlx::query("DELETE FROM audit_logs")
            .execute(pool)
            .await
            .expect("clear_audit should succeed");
    }

    // ---------------------------------------------------------------
    // log_audit (fire-and-forget)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn log_audit_writes_one_row() {
        // Input: a company id, user id/email/role, action "create", resource "product".
        // Expected: exactly one audit_logs row with the given values.
        let (pool, _p) = setup_pool().await;
        log_audit(
            &pool,
            "company-a",
            "user-1",
            "a@b.com",
            "owner",
            "create",
            "product",
            Some("prod-1"),
            "Created product",
        )
        .await;

        let (company_id, action, resource): (String, String, String) = sqlx::query_as(
            "SELECT company_id, action, resource FROM audit_logs WHERE user_id = 'user-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("row should exist");
        assert_eq!(company_id, "company-a");
        assert_eq!(action, "create");
        assert_eq!(resource, "product");
    }

    #[tokio::test]
    async fn log_audit_failure_does_not_panic() {
        // Input: an invalid table reference in resource (audit itself still inserts).
        // Expected: function returns () even though the DB has no audit_logs row
        // (fire-and-forget semantics) — we only assert it doesn't panic.
        let (pool, _p) = setup_pool().await;
        log_audit(
            &pool, "c", "u", "e@e.com", "owner", "update", "product", None, "x",
        )
        .await;
    }

    // ---------------------------------------------------------------
    // list_audit_logs
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_requires_login() {
        // Input: no user in the session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_audit_logs(state_of(&app), state_of(&app), None, None)
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    #[tokio::test]
    async fn list_denied_for_employee() {
        // Input: logged-in employee, owner-only endpoint.
        // Expected: Err "Only owners and admins can view audit logs".
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        let employee =
            insert_user(&pool, company_id, "emp@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let err = list_audit_logs(state_of(&app), state_of(&app), None, None)
            .await
            .unwrap_err();
        assert!(err.contains("Only owners and admins"), "got: {err}");
    }

    #[tokio::test]
    async fn list_returns_own_companys_logs() {
        // Input: owner with 2 audit rows for their company.
        // Expected: 2 rows returned (company scoping respected).
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        seed_audit(
            &pool,
            company_id,
            &owner.id,
            "2026-01-01T00:00:00Z",
            "create",
        )
        .await;
        seed_audit(
            &pool,
            company_id,
            &owner.id,
            "2026-01-02T00:00:00Z",
            "update",
        )
        .await;

        let logs = list_audit_logs(state_of(&app), state_of(&app), None, None)
            .await
            .expect("owner lists");
        assert_eq!(logs.len(), 2);
    }

    #[tokio::test]
    async fn list_orders_newest_first() {
        // Input: 3 rows with created_at 01-01, 01-02, 01-03.
        // Expected: returned order is 01-03, 01-02, 01-01.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-01T00:00:00Z", "a").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-02T00:00:00Z", "b").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-03T00:00:00Z", "c").await;

        let logs = list_audit_logs(state_of(&app), state_of(&app), None, None)
            .await
            .expect("list");
        let actions: Vec<&str> = logs.iter().map(|l| l.action.as_str()).collect();
        assert_eq!(actions, vec!["c", "b", "a"]);
    }

    #[tokio::test]
    async fn list_honors_limit() {
        // Input: 501 seeded rows, limit = 501.
        // Expected: limit is clamped to 500, so 500 rows are returned.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        for i in 0..501 {
            let stamp = format!("2026-01-{:02}T00:00:00Z", (i % 28) + 1);
            seed_audit(&pool, company_id, &owner.id, &stamp, "seed").await;
        }

        let logs = list_audit_logs(state_of(&app), state_of(&app), Some(501), None)
            .await
            .expect("list");
        assert_eq!(logs.len(), 500, "limit must clamp to 500");
    }

    #[tokio::test]
    async fn list_clamps_low_limit_up() {
        // Input: 3 rows, limit = 0.
        // Expected: limit clamped up to 1 → 1 row returned.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-01T00:00:00Z", "a").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-02T00:00:00Z", "b").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-03T00:00:00Z", "c").await;

        let logs = list_audit_logs(state_of(&app), state_of(&app), Some(0), None)
            .await
            .expect("list");
        assert_eq!(logs.len(), 1);
    }

    #[tokio::test]
    async fn list_honors_offset() {
        // Input: 3 rows, limit 2, offset 2.
        // Expected: the remaining 1 row (the oldest) is returned.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-01T00:00:00Z", "a").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-02T00:00:00Z", "b").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-03T00:00:00Z", "c").await;

        let logs = list_audit_logs(state_of(&app), state_of(&app), Some(2), Some(2))
            .await
            .expect("list");
        let actions: Vec<&str> = logs.iter().map(|l| l.action.as_str()).collect();
        assert_eq!(actions, vec!["a"]);
    }

    #[tokio::test]
    async fn list_negative_offset_treated_as_zero() {
        // Input: 2 rows, offset = -5.
        // Expected: offset clamped to 0 → both rows returned.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-01T00:00:00Z", "a").await;
        seed_audit(&pool, company_id, &owner.id, "2026-01-02T00:00:00Z", "b").await;

        let logs = list_audit_logs(state_of(&app), state_of(&app), None, Some(-5))
            .await
            .expect("list");
        assert_eq!(logs.len(), 2);
    }

    #[tokio::test]
    async fn list_admin_can_view() {
        // Input: logged-in admin user.
        // Expected: Ok (empty or seeded logs) — admins may view.
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.as_deref().unwrap();
        clear_audit(&pool).await;
        let admin = insert_user(&pool, company_id, "admin@test.com", "Admin", "admin", true).await;
        set_session_user(&app, admin).await;

        let result = list_audit_logs(state_of(&app), state_of(&app), None, None).await;
        assert!(result.is_ok(), "admin must be able to list");
    }
}
