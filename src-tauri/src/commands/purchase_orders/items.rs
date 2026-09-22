use super::helpers::{clean, recalc_po_totals};
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
// PURCHASE ORDERS — ITEM MANAGEMENT COMMANDS
// ==========================================

/// Adds an item to a draft PO
#[tauri::command]
pub async fn add_po_item(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
    product_id: String,
    quantity: i64,
    unit_cost: i64,
    tax_rate: i64,
    expiry_date: Option<String>,
) -> Result<Vec<PublicPOItem>, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "edit").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    // Validate PO is draft
    let status: String =
        sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
            .bind(&po_id)
            .bind(company_id)
            .fetch_one(pool.inner())
            .await
            .map_err(|_| "PO not found".to_string())?;
    if status != "draft" {
        return Err(AppError::internal("Can only add items to draft POs".to_string()));
    }
    if quantity <= 0 {
        return Err(AppError::internal("Quantity must be positive".to_string()));
    }

    // Get product
    let (pname, psku): (String, String) =
        sqlx::query_as("SELECT name, sku FROM products WHERE id = ? AND company_id = ?")
            .bind(&product_id)
            .bind(company_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| AppError::internal(format!("Error: {e}")))?
            .ok_or("Product not found")?;

    let tax_amount = (quantity * unit_cost * tax_rate) / 10000;
    let line_total = (quantity * unit_cost) + tax_amount;
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_order_items (id,po_id,company_id,product_id,product_name,product_sku,quantity_ordered,unit_cost,tax_rate,tax_amount,line_total,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(&id).bind(&po_id).bind(company_id).bind(&product_id)
    .bind(&pname).bind(&psku).bind(quantity).bind(unit_cost)
    .bind(tax_rate).bind(tax_amount).bind(line_total).bind(clean(&expiry_date.unwrap_or_default()))
    .execute(pool.inner()).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    // Recalculate totals
    recalc_po_totals(pool.inner(), &po_id, company_id).await?;

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "update",
        "purchase_order_item",
        Some(&id),
        &format!("Added item {}× '{}' to PO {}", quantity, pname, po_id),
    )
    .await;

    // Return items
    let details = get_purchase_order(pool, session, po_id).await?;
    Ok(details.items)
}

/// Removes an item from a draft PO
#[tauri::command]
pub async fn remove_po_item(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
    item_id: String,
) -> Result<Vec<PublicPOItem>, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "edit").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let status: String =
        sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
            .bind(&po_id)
            .bind(company_id)
            .fetch_one(pool.inner())
            .await
            .map_err(|_| "PO not found".to_string())?;
    if status != "draft" {
        return Err(AppError::internal("Can only remove from draft POs".to_string()));
    }

    sqlx::query("DELETE FROM purchase_order_items WHERE id = ? AND po_id = ?")
        .bind(&item_id)
        .bind(&po_id)
        .execute(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    recalc_po_totals(pool.inner(), &po_id, company_id).await?;

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "delete",
        "purchase_order_item",
        Some(&item_id),
        &format!("Removed item from PO {}", po_id),
    )
    .await;

    let details = get_purchase_order(pool, session, po_id).await?;
    Ok(details.items)
}

/// Receives items from a PO — increases stock
#[tauri::command]
pub async fn receive_po_items(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
    expiries: Vec<ReceiveItemExpiry>,
) -> Result<PublicPurchaseOrder, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "finalize").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    // Verify PO is ordered
    let status: String =
        sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
            .bind(&po_id)
            .bind(company_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Error: {e}")))?
            .ok_or("PO not found")?;
    if status != "ordered" {
        return Err(AppError::internal("PO must be in 'ordered' status to receive".to_string()));
    }

    // Get all items
    let items: Vec<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, product_id, quantity_ordered, quantity_received, unit_cost, expiry_date FROM purchase_order_items WHERE po_id = ?"
    )
    .bind(&po_id)
    .fetch_all(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    for (item_id, product_id, qty_ordered, qty_received, unit_cost, expiry) in &items {
        let qty_to_receive = qty_ordered - qty_received;
        if qty_to_receive <= 0 {
            continue;
        }

        // Expiry comes from the user at receive time (from the supplier's
        // delivery note). Fall back to any date stored on the item so older
        // flows keep working.
        let expiry_override = expiries
            .iter()
            .find(|e| e.item_id == *item_id)
            .and_then(|e| e.expiry_date.as_deref());
        let effective_expiry: Option<String> = match expiry_override {
            Some(exp) if !exp.is_empty() => Some(exp.to_string()),
            _ => expiry.clone().filter(|e| !e.is_empty()),
        };

        // Update item received qty
        sqlx::query(
            "UPDATE purchase_order_items SET quantity_received = quantity_ordered WHERE id = ?",
        )
        .bind(item_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Error: {e}")))?;

        // Increase product stock
        sqlx::query("UPDATE products SET quantity_in_stock = quantity_in_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
            .bind(qty_to_receive).bind(product_id).bind(company_id)
            .execute(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

        // Record stock movement
        let mid = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_movements (id,company_id,product_id,movement_type,quantity,reference_note,performed_by) VALUES (?,?,?,'purchase',?,?,?)")
            .bind(&mid).bind(company_id).bind(product_id).bind(qty_to_receive)
            .bind(format!("PO {}", po_id)).bind(&user.id)
            .execute(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

        // If an expiry date is known, record it on the item and create a
        // batch (auto-numbered) so FIFO expiry tracking kicks in.
        if let Some(ref exp) = effective_expiry {
            sqlx::query("UPDATE purchase_order_items SET expiry_date = ? WHERE id = ?")
                .bind(exp)
                .bind(item_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| AppError::internal(format!("Error: {e}")))?;

            crate::commands::inventory::add_batch(
                &mut tx,
                company_id,
                product_id,
                qty_to_receive,
                *unit_cost,
                exp,
                "purchase",
                None,
            )
            .await
            .map_err(|e| AppError::internal(format!("Error: {e}")))?;
        }
    }

    // Mark PO as received
    sqlx::query("UPDATE purchase_orders SET status = 'received', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&po_id).execute(&mut *tx).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    tx.commit().await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "receive",
        "purchase_order",
        Some(&po_id),
        &format!(
            "Received {} item(s) into stock from PO {}",
            items.len(),
            po_id
        ),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    get_purchase_order(pool, session, po_id)
        .await
        .map(|d| d.order)
}
