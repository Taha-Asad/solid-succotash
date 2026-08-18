// ==========================================
// NOTIFICATIONS & ACTIVITY FEED
// ==========================================
//
// Surfaces alerts for:
//   - Low stock products
//   - Expiring batches
//   - Overdue invoices
//   - Recent activity

use std::sync::OnceLock;

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

/// Pushed by the backend whenever the alert set may have changed, so open
/// windows re-fetch notifications instead of waiting for a reload.
pub const NOTIFICATION_UPDATED_EVENT: &str = "notification:updated";

/// Captured at startup (mirrors `import_wizard::APP_HANDLE`). Lets any command
/// or the background ticker emit `notification:updated` without changing every
/// command signature; `None` in unit tests so emits are safe no-ops.
static NOTIF_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Registers the app handle used for push events. Called once from `setup`.
pub fn init_notifications(app: &AppHandle) {
    let _ = NOTIF_APP_HANDLE.set(app.clone());
}

/// Asks every open window to re-sync notifications. No-op when the handle was
/// never set (unit tests / headless).
pub fn emit_notifications_changed() {
    if let Some(app) = NOTIF_APP_HANDLE.get() {
        let _ = app.emit(NOTIFICATION_UPDATED_EVENT, ());
    }
}

/// Lightweight background ticker: every 30 seconds it nudges the UI to
/// re-sync, so *time-based* alerts surface on their own — a batch crossing
/// into the 30-day expiry window, an invoice going overdue — without waiting
/// for the next user action. Stock mutations emit immediately on their own.
pub fn start_notification_ticker() {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        emit_notifications_changed();
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub notification_type: String, // "low_stock", "expiring", "overdue", "activity"
    pub severity: String,          // "info", "warning", "critical"
    pub title: String,
    pub message: String,
    pub resource_type: String, // "product", "invoice", "batch"
    pub resource_id: Option<String>,
    pub created_at: String,
}

/// Gets all notifications for the current company.
#[tauri::command]
pub async fn get_notifications(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<Notification>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let mut notifications: Vec<Notification> = Vec::new();

    // ---- Low stock products ----
    let low_stock = sqlx::query_as::<_, (String, String, String, i64)>(
        "SELECT id, name, sku, quantity_in_stock FROM products WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL AND quantity_in_stock <= 10 AND quantity_in_stock > 0 ORDER BY quantity_in_stock ASC LIMIT 20"
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    for (id, name, sku, qty) in &low_stock {
        notifications.push(Notification {
            id: format!("low-{id}"),
            notification_type: "low_stock".to_string(),
            severity: if *qty <= 3 {
                "critical".to_string()
            } else {
                "warning".to_string()
            },
            title: format!("Low stock: {name}"),
            message: format!("{sku} has only {qty} units remaining"),
            resource_type: "product".to_string(),
            resource_id: Some(id.clone()),
            created_at: String::new(),
        });
    }

    // ---- Out of stock ----
    let out_of_stock = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, name, sku FROM products WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL AND quantity_in_stock <= 0 LIMIT 20"
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    for (id, name, sku) in &out_of_stock {
        notifications.push(Notification {
            id: format!("out-{id}"),
            notification_type: "low_stock".to_string(),
            severity: "critical".to_string(),
            title: format!("Out of stock: {name}"),
            message: format!("{sku} has 0 units"),
            resource_type: "product".to_string(),
            resource_id: Some(id.clone()),
            created_at: String::new(),
        });
    }

    // ---- Expiring batches (only within the next 30 days, matches
    // `list_expiring_batches(30)`) ----
    let today_naive = chrono::Local::now().date_naive();
    let cutoff = (today_naive + chrono::Duration::days(30))
        .format("%Y-%m-%d")
        .to_string();
    let expiring = sqlx::query_as::<_, (String, String, String, String, i64)>(
        r#"
        SELECT sb.id, p.name, p.sku, sb.expiry_date, sb.quantity
        FROM stock_batches sb
        JOIN products p ON p.id = sb.product_id AND p.company_id = sb.company_id
        WHERE sb.company_id = ? AND sb.quantity > 0 AND sb.expiry_date <= ?
        ORDER BY sb.expiry_date ASC
        LIMIT 20
        "#,
    )
    .bind(company_id)
    .bind(&cutoff)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    for (id, name, sku, expiry, qty) in &expiring {
        let expired = chrono::NaiveDate::parse_from_str(expiry, "%Y-%m-%d")
            .map(|d| d < today_naive)
            .unwrap_or(false);
        let severity = if expired { "critical" } else { "warning" };
        let title = if expired {
            format!("EXPIRED: {name}")
        } else {
            format!("Expiring soon: {name}")
        };
        notifications.push(Notification {
            id: format!("exp-{id}"),
            notification_type: "expiring".to_string(),
            severity: severity.to_string(),
            title,
            message: format!("{sku} — {qty} units expire {expiry}"),
            resource_type: "batch".to_string(),
            resource_id: Some(id.clone()),
            created_at: String::new(),
        });
    }

    // ---- Overdue invoices ----
    let overdue = sqlx::query_as::<_, (String, String, String, i64, i64)>(
        r#"
        SELECT i.id, i.invoice_number, c.name, i.balance_due, i.grand_total
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE i.company_id = ? AND i.status = 'finalized' AND i.balance_due > 0
        AND i.due_date IS NOT NULL AND i.due_date < ?
        ORDER BY i.due_date ASC
        LIMIT 20
        "#,
    )
    .bind(company_id)
    .bind(today_str())
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    for (id, inv_num, cust_name, balance, _total) in &overdue {
        notifications.push(Notification {
            id: format!("due-{id}"),
            notification_type: "overdue".to_string(),
            severity: "warning".to_string(),
            title: format!("Overdue: {inv_num}"),
            message: format!("{cust_name} owes {balance} paisa"),
            resource_type: "invoice".to_string(),
            resource_id: Some(id.clone()),
            created_at: String::new(),
        });
    }

    // Sort: critical first, then warning, then info
    notifications.sort_by(|a, b| {
        let order = |s: &str| match s {
            "critical" => 0,
            "warning" => 1,
            _ => 2,
        };
        order(&a.severity).cmp(&order(&b.severity))
    });

    Ok(notifications)
}

fn today_str() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    let tod = now % 86400;
    let _h = tod / 3600;
    let _m = (tod % 3600) / 60;
    let mut y = 1970u64;
    let mut rem = days;
    loop {
        let d = if (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400) {
            366
        } else {
            365
        };
        if rem < d {
            break;
        }
        rem -= d;
        y += 1;
    }
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let md = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut mo = 1u64;
    for &d in &md {
        if rem < d {
            break;
        }
        rem -= d;
        mo += 1;
    }
    format!("{:04}-{:02}-{:02}", y, mo, rem + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{register_owner_full, setup_app, state_of};

    fn date_in(days: i64) -> String {
        (chrono::Local::now().date_naive() + chrono::Duration::days(days))
            .format("%Y-%m-%d")
            .to_string()
    }

    async fn insert_product(app: &tauri::App<tauri::test::MockRuntime>, company_id: &str) -> String {
        let pool = state_of::<SqlitePool>(app);
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock)
            VALUES (?, ?, ?, ?, 100, 150, 5)
            "#,
        )
        .bind(&id)
        .bind(company_id)
        .bind(&id)
        .bind(&id)
        .execute(pool.inner())
        .await
        .expect("insert product");
        id
    }

    async fn insert_batch(
        app: &tauri::App<tauri::test::MockRuntime>,
        company_id: &str,
        product_id: &str,
        expiry_date: &str,
        quantity: i64,
    ) {
        let pool = state_of::<SqlitePool>(app);
        sqlx::query(
            r#"
            INSERT INTO stock_batches
                (id, company_id, product_id, quantity, unit_cost, expiry_date, batch_number, source)
            VALUES (?, ?, ?, ?, 0, ?, 'TEST', 'adjustment')
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(product_id)
        .bind(quantity)
        .bind(expiry_date)
        .execute(pool.inner())
        .await
        .expect("insert batch");
    }

    #[tokio::test]
    async fn expiring_far_future_is_not_flagged() {
        // Input: a batch expiring ~10 years out.
        // Expected: no "expiring" notification — the 30-day cutoff filters it.
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;
        let product_id = insert_product(&app, &owner.company.id).await;
        insert_batch(&app, &owner.company.id, &product_id, &date_in(3650), 5).await;

        let result = get_notifications(
            state_of::<SqlitePool>(&app),
            state_of::<SessionState>(&app),
        )
        .await
        .expect("get_notifications should succeed");

        assert!(
            result.iter().all(|n| n.notification_type != "expiring"),
            "a batch expiring years away must NOT produce an expiring alert: {result:?}"
        );
    }

    #[tokio::test]
    async fn expiring_within_window_is_flagged() {
        // Input: a batch expiring in ~10 days.
        // Expected: an "expiring" warning notification.
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;
        let product_id = insert_product(&app, &owner.company.id).await;
        insert_batch(&app, &owner.company.id, &product_id, &date_in(10), 5).await;

        let result = get_notifications(
            state_of::<SqlitePool>(&app),
            state_of::<SessionState>(&app),
        )
        .await
        .expect("get_notifications should succeed");

        assert!(
            result.iter().any(|n| n.notification_type == "expiring"),
            "a batch expiring in 10 days should be flagged: {result:?}"
        );
    }

    #[tokio::test]
    async fn emit_without_handle_is_safe_noop() {
        // Input: no handle ever registered (unit-test process).
        // Expected: no panic, no effect.
        emit_notifications_changed();
    }
}
