use super::helpers::clean;
use super::orders::get_purchase_order;
use super::types::*;
use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// PURCHASE ORDERS — PAYMENT RECORDING COMMANDS
// ==========================================

/// Records a payment to a supplier for a PO
#[tauri::command]
pub async fn record_po_payment(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
    amount: i64,
    payment_method: String,
    payment_date: String,
    reference: String,
    notes: String,
) -> Result<PublicPurchaseOrder, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "edit").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;
    if amount <= 0 {
        return Err(AppError::internal("Amount must be positive".to_string()));
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    let (status, grand, paid): (String, i64, i64) = sqlx::query_as(
        "SELECT status, grand_total, amount_paid FROM purchase_orders WHERE id = ? AND company_id = ?"
    )
    .bind(&po_id).bind(company_id)
    .fetch_optional(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?
    .ok_or("PO not found")?;

    if status == "draft" || status == "cancelled" {
        return Err(AppError::internal("Cannot pay for draft/cancelled POs".to_string()));
    }

    let new_paid = paid + amount;
    let new_balance = grand - new_paid;
    if new_balance < 0 {
        return Err(AppError::internal("Payment exceeds balance".to_string()));
    }

    let new_status = if new_balance == 0 {
        "paid"
    } else {
        &status.to_string()
    };

    let pid = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO purchase_payments (id,po_id,company_id,amount,payment_method,payment_date,reference,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&pid).bind(&po_id).bind(company_id).bind(amount)
        .bind(&payment_method).bind(&payment_date)
        .bind(clean(&reference)).bind(clean(&notes)).bind(&user.id)
        .execute(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    sqlx::query("UPDATE purchase_orders SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(new_paid).bind(new_balance).bind(new_status).bind(&po_id)
        .execute(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    tx.commit().await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "payment",
        "purchase_order",
        Some(&po_id),
        &format!(
            "Recorded payment of {} via {} for PO {}",
            amount, payment_method, po_id
        ),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    get_purchase_order(pool, session, po_id)
        .await
        .map(|d| d.order)
}
