// ==========================================
// NOTIFICATIONS & ACTIVITY FEED
// ==========================================
//
// Surfaces alerts for:
//   - Low stock products
//   - Expiring batches
//   - Overdue invoices
//   - Recent activity

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

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

    // ---- Expiring batches ----
    let expiring = sqlx::query_as::<_, (String, String, String, String, i64)>(
        r#"
        SELECT sb.id, p.name, p.sku, sb.expiry_date, sb.quantity
        FROM stock_batches sb
        JOIN products p ON p.id = sb.product_id
        WHERE sb.company_id = ? AND sb.quantity > 0
        ORDER BY sb.expiry_date ASC
        LIMIT 20
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .unwrap_or_default();

    for (id, name, sku, expiry, qty) in &expiring {
        let today = today_str();
        let severity = if *expiry <= today {
            "critical".to_string()
        } else {
            "warning".to_string()
        };
        let title = if *expiry <= today {
            format!("EXPIRED: {name}")
        } else {
            format!("Expiring soon: {name}")
        };
        notifications.push(Notification {
            id: format!("exp-{id}"),
            notification_type: "expiring".to_string(),
            severity,
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
        let d = if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
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
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
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
