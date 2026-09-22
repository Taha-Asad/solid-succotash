use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// PURCHASE ORDERS — HELPERS
// ==========================================

pub(crate) fn clean(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

pub(crate) async fn next_po_number(pool: &SqlitePool, company_id: &str) -> Result<String, AppError> {
    let number: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO company_po_settings (company_id, next_number) VALUES (?, 1)
        ON CONFLICT(company_id) DO UPDATE SET next_number = next_number + 1
        RETURNING next_number
        "#,
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    Ok(format!("PO-{:04}", number))
}

pub(crate) async fn recalc_po_totals(pool: &SqlitePool, po_id: &str, company_id: &str) -> Result<(), AppError> {
    let (subtotal, tax): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(quantity_ordered * unit_cost), 0), COALESCE(SUM(tax_amount), 0) FROM purchase_order_items WHERE po_id = ?"
    )
    .bind(po_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    let grand = subtotal + tax;

    // Compute balance_due in Rust — do NOT use `balance_due = grand_total - amount_paid`
    // inside the same UPDATE that sets grand_total, because SQLite evaluates the
    // right-hand side with the OLD value of grand_total, not the new one.
    let amount_paid = sqlx::query_as::<_, (i64,)>("SELECT amount_paid FROM purchase_orders WHERE id = ? AND company_id = ?")
        .bind(po_id)
        .bind(company_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::internal(format!("Error: {e}")))?
        .0;
    let balance = grand - amount_paid;

    sqlx::query("UPDATE purchase_orders SET subtotal = ?, tax_total = ?, grand_total = ?, balance_due = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
        .bind(subtotal).bind(tax).bind(grand).bind(balance).bind(po_id).bind(company_id)
        .execute(pool).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    Ok(())
}
