#![allow(clippy::too_many_arguments)]

// ==========================================
// PURCHASE ORDERS
// ==========================================
//
// Tracks buying from suppliers.
// Lifecycle: draft → ordered → received → paid
//
// When items are received:
//   1. product.quantity_in_stock goes UP
//   2. stock_movement recorded (type: 'purchase')
//   3. If expiry_date provided, stock_batch created

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

// ==========================================
// TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicPurchaseOrder {
    pub id: String,
    pub company_id: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub po_number: String,
    pub po_date: String,
    pub expected_date: Option<String>,
    pub status: String,
    pub subtotal: i64,
    pub tax_total: i64,
    pub grand_total: i64,
    pub amount_paid: i64,
    pub balance_due: i64,
    pub reference_note: Option<String>,
    pub created_by: String,
    pub received_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPOItem {
    pub id: String,
    pub po_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub quantity_ordered: i64,
    pub quantity_received: i64,
    pub unit_cost: i64,
    pub tax_rate: i64,
    pub tax_amount: i64,
    pub line_total: i64,
    pub expiry_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderWithItems {
    pub order: PublicPurchaseOrder,
    pub items: Vec<PublicPOItem>,
}

// Expiry dates entered by the user when RECEIVING goods. The supplier's
// expiry is only known once the physical stock arrives, so it is captured
// at receive time (per item), never when the PO item is first added.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveItemExpiry {
    pub item_id: String,
    pub expiry_date: Option<String>,
}

// #[derive(Debug, Clone, Serialize)]
// #[serde(rename_all = "camelCase")]
// pub struct PublicPOPayment {
//     pub id: String,
//     pub po_id: String,
//     pub amount: i64,
//     pub payment_method: String,
//     pub payment_date: String,
//     pub reference: Option<String>,
//     pub notes: Option<String>,
//     pub recorded_by: String,
//     pub created_at: String,
// }

fn clean(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

async fn next_po_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
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
    .map_err(|e| format!("Error: {e}"))?;

    Ok(format!("PO-{:04}", number))
}

// ==========================================
// COMMANDS
// ==========================================

/// Lists all purchase orders
#[tauri::command]
pub async fn list_purchase_orders(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicPurchaseOrder>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, PublicPurchaseOrder>(
        r#"
        SELECT po.id, po.company_id, po.supplier_id, s.name AS supplier_name,
               po.po_number, po.po_date, po.expected_date, po.status,
               po.subtotal, po.tax_total, po.grand_total,
               po.amount_paid, po.balance_due, po.reference_note,
               po.created_by, po.received_at, po.created_at, po.updated_at
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.company_id = ?
        ORDER BY po.created_at DESC
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    Ok(rows)
}

/// Gets a PO with its items
#[tauri::command]
pub async fn get_purchase_order(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
) -> Result<PurchaseOrderWithItems, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let order = sqlx::query_as::<_, PublicPurchaseOrder>(
        r#"
        SELECT po.id, po.company_id, po.supplier_id, s.name AS supplier_name,
               po.po_number, po.po_date, po.expected_date, po.status,
               po.subtotal, po.tax_total, po.grand_total,
               po.amount_paid, po.balance_due, po.reference_note,
               po.created_by, po.received_at, po.created_at, po.updated_at
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = ? AND po.company_id = ?
        "#,
    )
    .bind(&po_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?
    .ok_or("Purchase order not found")?;

    let items = sqlx::query_as::<_, (String, String, String, String, String, i64, i64, i64, i64, i64, i64, Option<String>)>(
        "SELECT id, po_id, product_id, product_name, product_sku, quantity_ordered, quantity_received, unit_cost, tax_rate, tax_amount, line_total, expiry_date FROM purchase_order_items WHERE po_id = ? ORDER BY created_at"
    )
    .bind(&po_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    Ok(PurchaseOrderWithItems {
        order,
        items: items
            .into_iter()
            .map(|r| PublicPOItem {
                id: r.0,
                po_id: r.1,
                product_id: r.2,
                product_name: r.3,
                product_sku: r.4,
                quantity_ordered: r.5,
                quantity_received: r.6,
                unit_cost: r.7,
                tax_rate: r.8,
                tax_amount: r.9,
                line_total: r.10,
                expiry_date: r.11,
            })
            .collect(),
    })
}

/// Creates a draft purchase order
#[tauri::command]
pub async fn create_purchase_order(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
    po_date: String,
    expected_date: String,
    reference_note: String,
) -> Result<PublicPurchaseOrder, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "create").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    // Validate supplier
    sqlx::query_scalar::<_, String>("SELECT name FROM suppliers WHERE id = ? AND company_id = ?")
        .bind(&supplier_id)
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|_| "Supplier not found".to_string())?;

    let po_number = next_po_number(pool.inner(), company_id).await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_orders (id,company_id,supplier_id,po_number,po_date,expected_date,status,reference_note,created_by) VALUES (?,?,?,?,?,?,'draft',?,?)"
    )
    .bind(&id).bind(company_id).bind(&supplier_id).bind(&po_number)
    .bind(&po_date).bind(clean(&expected_date)).bind(clean(&reference_note)).bind(&user.id)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "create",
        "purchase_order",
        Some(&id),
        &format!("Created purchase order {}", po_number),
    )
    .await;

    get_purchase_order(pool, session, id).await.map(|d| d.order)
}

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
) -> Result<Vec<PublicPOItem>, String> {
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
        return Err("Can only add items to draft POs".to_string());
    }
    if quantity <= 0 {
        return Err("Quantity must be positive".to_string());
    }

    // Get product
    let (pname, psku): (String, String) =
        sqlx::query_as("SELECT name, sku FROM products WHERE id = ? AND company_id = ?")
            .bind(&product_id)
            .bind(company_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Error: {e}"))?
            .ok_or("Product not found")?;

    let tax_amount = (quantity * unit_cost * tax_rate) / 10000;
    let line_total = (quantity * unit_cost) + tax_amount;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_order_items (id,po_id,company_id,product_id,product_name,product_sku,quantity_ordered,unit_cost,tax_rate,tax_amount,line_total,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(&id).bind(&po_id).bind(company_id).bind(&product_id)
    .bind(&pname).bind(&psku).bind(quantity).bind(unit_cost)
    .bind(tax_rate).bind(tax_amount).bind(line_total).bind(clean(&expiry_date.unwrap_or_default()))
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

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
) -> Result<Vec<PublicPOItem>, String> {
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
        return Err("Can only remove from draft POs".to_string());
    }

    sqlx::query("DELETE FROM purchase_order_items WHERE id = ? AND po_id = ?")
        .bind(&item_id)
        .bind(&po_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Error: {e}"))?;

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

/// Marks PO as ordered
#[tauri::command]
pub async fn submit_purchase_order(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
) -> Result<PublicPurchaseOrder, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "finalize").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query(
        "UPDATE purchase_orders SET status = 'ordered', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'draft'"
    )
    .bind(&po_id).bind(company_id)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("PO not found or not in draft status".to_string());
    }

    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "submit",
        "purchase_order",
        Some(&po_id),
        &format!("Submitted purchase order {}", po_id),
    )
    .await;

    get_purchase_order(pool, session, po_id)
        .await
        .map(|d| d.order)
}

/// Receives items from a PO — increases stock
#[tauri::command]
pub async fn receive_po_items(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
    expiries: Vec<ReceiveItemExpiry>,
) -> Result<PublicPurchaseOrder, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "finalize").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Error: {e}"))?;

    // Verify PO is ordered
    let status: String =
        sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
            .bind(&po_id)
            .bind(company_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("Error: {e}"))?
            .ok_or("PO not found")?;
    if status != "ordered" {
        return Err("PO must be in 'ordered' status to receive".to_string());
    }

    // Get all items
    let items: Vec<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, product_id, quantity_ordered, quantity_received, unit_cost, expiry_date FROM purchase_order_items WHERE po_id = ?"
    )
    .bind(&po_id)
    .fetch_all(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

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
        .map_err(|e| format!("Error: {e}"))?;

        // Increase product stock
        sqlx::query("UPDATE products SET quantity_in_stock = quantity_in_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
            .bind(qty_to_receive).bind(product_id).bind(company_id)
            .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

        // Record stock movement
        let mid = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_movements (id,company_id,product_id,movement_type,quantity,reference_note,performed_by) VALUES (?,?,?,'purchase',?,?,?)")
            .bind(&mid).bind(company_id).bind(product_id).bind(qty_to_receive)
            .bind(format!("PO {}", po_id)).bind(&user.id)
            .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

        // If an expiry date is known, record it on the item and create a
        // batch (auto-numbered) so FIFO expiry tracking kicks in.
        if let Some(ref exp) = effective_expiry {
            sqlx::query("UPDATE purchase_order_items SET expiry_date = ? WHERE id = ?")
                .bind(exp)
                .bind(item_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Error: {e}"))?;

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
            .map_err(|e| format!("Error: {e}"))?;
        }
    }

    // Mark PO as received
    sqlx::query("UPDATE purchase_orders SET status = 'received', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&po_id).execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    tx.commit().await.map_err(|e| format!("Error: {e}"))?;

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
) -> Result<PublicPurchaseOrder, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "edit").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;
    if amount <= 0 {
        return Err("Amount must be positive".to_string());
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Error: {e}"))?;

    let (status, grand, paid): (String, i64, i64) = sqlx::query_as(
        "SELECT status, grand_total, amount_paid FROM purchase_orders WHERE id = ? AND company_id = ?"
    )
    .bind(&po_id).bind(company_id)
    .fetch_optional(&mut *tx).await.map_err(|e| format!("Error: {e}"))?
    .ok_or("PO not found")?;

    if status == "draft" || status == "cancelled" {
        return Err("Cannot pay for draft/cancelled POs".to_string());
    }

    let new_paid = paid + amount;
    let new_balance = grand - new_paid;
    if new_balance < 0 {
        return Err("Payment exceeds balance".to_string());
    }

    let new_status = if new_balance == 0 {
        "paid"
    } else {
        &status.to_string()
    };

    let pid = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO purchase_payments (id,po_id,company_id,amount,payment_method,payment_date,reference,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&pid).bind(&po_id).bind(company_id).bind(amount)
        .bind(&payment_method).bind(&payment_date)
        .bind(clean(&reference)).bind(clean(&notes)).bind(&user.id)
        .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    sqlx::query("UPDATE purchase_orders SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(new_paid).bind(new_balance).bind(new_status).bind(&po_id)
        .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    tx.commit().await.map_err(|e| format!("Error: {e}"))?;

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

// ==========================================
// HELPERS
// ==========================================

async fn recalc_po_totals(pool: &SqlitePool, po_id: &str, company_id: &str) -> Result<(), String> {
    let (subtotal, tax): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(quantity_ordered * unit_cost), 0), COALESCE(SUM(tax_amount), 0) FROM purchase_order_items WHERE po_id = ?"
    )
    .bind(po_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Error: {e}"))?;

    let grand = subtotal + tax;

    // Compute balance_due in Rust — do NOT use `balance_due = grand_total - amount_paid`
    // inside the same UPDATE that sets grand_total, because SQLite evaluates the
    // right-hand side with the OLD value of grand_total, not the new one.
    let amount_paid = sqlx::query_as::<_, (i64,)>("SELECT amount_paid FROM purchase_orders WHERE id = ?")
        .bind(po_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Error: {e}"))?
        .0;
    let balance = grand - amount_paid;

    sqlx::query("UPDATE purchase_orders SET subtotal = ?, tax_total = ?, grand_total = ?, balance_due = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
        .bind(subtotal).bind(tax).bind(grand).bind(balance).bind(po_id).bind(company_id)
        .execute(pool).await.map_err(|e| format!("Error: {e}"))?;

    Ok(())
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

    /// Registers the owner and returns an app with an owner session.
    /// NOTE: `check_permission` short-circuits the "owner" role to always
    /// allowed, so owners can run the full PO workflow without extra seeds.
    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Creates a supplier through the real inventory command.
    async fn make_supplier(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> crate::commands::inventory::PublicSupplier {
        crate::commands::inventory::create_supplier(
            app.state(),
            app.state(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create supplier")
    }

    /// Creates a product through the real inventory command.
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> crate::commands::inventory::PublicProduct {
        crate::commands::inventory::create_product(
            app.state(),
            app.state(),
            "".to_string(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    /// Creates a draft PO for the given supplier.
    async fn make_po(
        app: &tauri::App<tauri::test::MockRuntime>,
        supplier_id: &str,
    ) -> PublicPurchaseOrder {
        create_purchase_order(
            app.state(),
            app.state(),
            supplier_id.to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "restock".to_string(),
        )
        .await
        .expect("create po")
    }

    /// Creates a submitted (ordered) PO with one item.
    async fn ordered_po_with_item(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> (
        PublicPurchaseOrder,
        crate::commands::inventory::PublicProduct,
    ) {
        let supplier = make_supplier(app, "Acme").await;
        let product = make_product(app, "Widget").await;
        let po = make_po(app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");
        let ordered = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");
        (ordered, product)
    }

    /// Company id of the registered owner.
    async fn company_id(app: &tauri::App<tauri::test::MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap()
    }

    // ---------------------------------------------------------------
    // clean (pure)
    // ---------------------------------------------------------------

    #[test]
    fn clean_blank_is_none() {
        // Input: "   ".
        // Expected: None.
        assert_eq!(clean("   "), None);
    }

    #[test]
    fn clean_trims_value() {
        // Input: "  note  ".
        // Expected: Some("note").
        assert_eq!(clean("  note  "), Some("note".to_string()));
    }

    // ---------------------------------------------------------------
    // next_po_number (helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn po_numbers_increment() {
        // Input: two calls.
        // Expected: "PO-0001" then "PO-0002".
        let app = owner_app().await;
        let cid = company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        let n1 = next_po_number(&pool, &cid).await.expect("n1");
        let n2 = next_po_number(&pool, &cid).await.expect("n2");
        assert_eq!(n1, "PO-0001");
        assert_eq!(n2, "PO-0002");
    }

    // ---------------------------------------------------------------
    // create_purchase_order
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_po_draft_with_number() {
        // Input: valid supplier.
        // Expected: Ok, status "draft", po_number "PO-0001".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;

        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "2026-02-01".to_string(),
            "restock".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(po.status, "draft");
        assert_eq!(po.po_number, "PO-0001");
        assert_eq!(po.supplier_name, "Acme");
        assert_eq!(po.expected_date.as_deref(), Some("2026-02-01"));
    }

    #[tokio::test]
    async fn create_po_supplier_not_found() {
        // Input: a random supplier id.
        // Expected: Err "Supplier not found".
        let app = owner_app().await;
        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Supplier not found");
    }

    #[tokio::test]
    async fn create_po_denied_for_employee() {
        // Input: employee logged in (purchase_orders/view only).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn create_po_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // add_po_item
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn add_po_item_recalculates_totals() {
        // Input: two items (10×500=5000, 5×200=1000 + 17% tax 170).
        // Expected: subtotal 6000, tax 170, grand 6170.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let p1 = make_product(&app, "Widget").await;
        let p2 = make_product(&app, "Gadget").await;
        let po = make_po(&app, &supplier.id).await;

        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p1.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("item 1");

        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p2.id.clone(),
            5,
            200,
            1700,
            None,
        )
        .await
        .expect("item 2");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.items.len(), 2);
        assert_eq!(details.order.subtotal, 6000);
        assert_eq!(details.order.tax_total, 170);
        assert_eq!(details.order.grand_total, 6170);
    }

    #[tokio::test]
    async fn add_po_item_rejects_zero_quantity() {
        // Input: quantity 0.
        // Expected: Err "Quantity must be positive".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            0,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Quantity must be positive");
    }

    #[tokio::test]
    async fn add_po_item_product_not_found() {
        // Input: a random product id.
        // Expected: Err "Product not found".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product not found");
    }

    #[tokio::test]
    async fn add_po_item_po_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let product = make_product(&app, "Widget").await;

        let err = add_po_item(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    #[tokio::test]
    async fn add_po_item_rejected_on_ordered_po() {
        // Input: adding an item to an ordered PO.
        // Expected: Err "Can only add items to draft POs".
        let app = owner_app().await;
        let (po, product) = ordered_po_with_item(&app).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Can only add items to draft POs");
    }

    #[tokio::test]
    async fn owner_always_can_edit_po_items() {
        // Input: owner (short-circuited to all permissions) adds an item.
        // Expected: Ok — the "owner" role bypasses the permission table.
        // NOTE: this documents that `check_permission` grants owner everything,
        // so the missing owner/purchase_orders/edit seed row has no effect.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create po");

        let items = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .expect("owner can add an item");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].product_id, product.id);
    }

    #[tokio::test]
    async fn employee_cannot_edit_po_items() {
        // Input: employee logged in after the PO was created by the owner.
        // Expected: Err "Access denied: employee cannot edit purchase_orders"
        // (employee has view-only PO permissions in the seed data).
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create po");

        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // remove_po_item
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn remove_po_item_removes_and_recalcs() {
        // Input: two items, remove one.
        // Expected: one item remains, totals recalculated to 0.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let p1 = make_product(&app, "Widget").await;
        let p2 = make_product(&app, "Gadget").await;
        let po = make_po(&app, &supplier.id).await;
        let items1 = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p1.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("item 1");
        let _items2 = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p2.id.clone(),
            5,
            200,
            0,
            None,
        )
        .await
        .expect("item 2");

        let remaining = remove_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            items1[0].id.clone(),
        )
        .await
        .expect("remove");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].product_id, p2.id);

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.order.grand_total, 1000);
    }

    #[tokio::test]
    async fn remove_po_item_missing_is_noop() {
        // Input: removing a non-existent item.
        // Expected: Ok — the DELETE matches 0 rows and no error is raised.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");

        let remaining = remove_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            Uuid::new_v4().to_string(),
        )
        .await
        .expect("remove noop");
        assert_eq!(remaining.len(), 1, "nothing was removed");
    }

    // ---------------------------------------------------------------
    // submit_purchase_order
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn submit_moves_to_ordered() {
        // Input: draft PO.
        // Expected: status "ordered".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let submitted = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");
        assert_eq!(submitted.status, "ordered");
    }

    #[tokio::test]
    async fn submit_rejects_double_submit() {
        // Input: submit an already-ordered PO.
        // Expected: Err "PO not found or not in draft status".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found or not in draft status");
    }

    #[tokio::test]
    async fn submit_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found or not in draft status".
        let app = owner_app().await;
        let err = submit_purchase_order(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found or not in draft status");
    }

    #[tokio::test]
    async fn submit_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // receive_po_items
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn receive_increases_stock_and_records_movement() {
        // Input: ordered PO with 10× Widget.
        // Expected: status "received"; product stock 10; 'purchase' movement.
        let app = owner_app().await;
        let (po, product) = ordered_po_with_item(&app).await;

        let received = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("receive");
        assert_eq!(received.status, "received");
        assert!(received.received_at.is_some());

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 10);

        let movements = crate::commands::inventory::list_stock_movements(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("movements");
        assert!(movements.iter().any(|m| m.movement_type == "purchase"));
    }

    #[tokio::test]
    async fn receive_creates_expiry_batch() {
        // Input: ordered PO with an expiry date on the item.
        // Expected: stock_batch created after receive.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Medicine").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            Some("2026-01-01".to_string()),
        )
        .await
        .expect("add item with expiry");
        submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");

        receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("receive");

        let batches = crate::commands::inventory::list_product_batches(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-01-01");
        assert_eq!(batches[0].quantity, 10);
    }

    #[tokio::test]
    async fn receive_uses_expiry_entered_at_receive_time() {
        // Input: ordered PO whose item has NO stored expiry, but the user
        // supplies an expiry when receiving (the normal flow — the supplier's
        // date is only known once the goods arrive).
        // Expected: stock_batch created with the receive-time expiry.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Syrup").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            5,
            400,
            0,
            None,
        )
        .await
        .expect("add item without expiry");
        submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("details");
        let item = &details.items[0];

        receive_po_items(
            app.state(),
            app.state(),
            po.id.clone(),
            vec![ReceiveItemExpiry {
                item_id: item.id.clone(),
                expiry_date: Some("2026-09-15".to_string()),
            }],
        )
        .await
        .expect("receive with expiry");

        let batches = crate::commands::inventory::list_product_batches(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-09-15");
        assert_eq!(batches[0].quantity, 5);
    }

    #[tokio::test]
    async fn receive_rejects_non_ordered_po() {
        // Input: receive a draft PO.
        // Expected: Err "PO must be in 'ordered' status to receive".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .unwrap_err();
        assert_eq!(err, "PO must be in 'ordered' status to receive");
    }

    #[tokio::test]
    async fn receive_po_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let err = receive_po_items(app.state(), app.state(), Uuid::new_v4().to_string(), vec![])
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    #[tokio::test]
    async fn receive_twice_is_rejected_after_received() {
        // Input: receive an already-received PO.
        // Expected: Err "PO must be in 'ordered' status to receive" — a second
        // receive is blocked by the status guard, so stock cannot double in.
        let app = owner_app().await;
        let (po, _product) = ordered_po_with_item(&app).await;
        receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("first receive");

        let err = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .unwrap_err();
        assert!(err.contains("must be in 'ordered' status"), "got: {err}");

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 10, "stock must not double");
    }

    // ---------------------------------------------------------------
    // record_po_payment
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn po_payment_partial_and_full() {
        // Input: ordered PO with grand total 5000; pay 2000 then 3000.
        // Expected: status ordered→(received skipped) stays "ordered" until fully paid.
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await; // 10 × 500 = 5000

        let after_partial = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            2000,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("partial");
        assert_eq!(after_partial.status, "ordered");
        assert_eq!(after_partial.amount_paid, 2000);
        assert_eq!(after_partial.balance_due, 3000);

        let after_full = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            3000,
            "bank_transfer".to_string(),
            "2026-01-21".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("full");
        assert_eq!(after_full.status, "paid");
        assert_eq!(after_full.balance_due, 0);
    }

    #[tokio::test]
    async fn po_payment_rejects_overpayment() {
        // Input: payment exceeding balance.
        // Expected: Err "Payment exceeds balance".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            999999,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Payment exceeds balance");
    }

    #[tokio::test]
    async fn po_payment_rejects_draft() {
        // Input: payment on a draft PO.
        // Expected: Err "Cannot pay for draft/cancelled POs".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cannot pay for draft/cancelled POs");
    }

    #[tokio::test]
    async fn po_payment_rejects_non_positive() {
        // Input: amount 0.
        // Expected: Err "Amount must be positive".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            0,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Amount must be positive");
    }

    #[tokio::test]
    async fn po_payment_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let err = record_po_payment(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    // ---------------------------------------------------------------
    // get / list
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_purchase_order_returns_items() {
        // Input: PO with one item.
        // Expected: order + 1 item with product sku snapshot.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.order.id, po.id);
        assert_eq!(details.items.len(), 1);
        assert_eq!(details.items[0].product_name, "Widget");
        assert_eq!(details.items[0].product_sku, product.sku);
        assert_eq!(details.items[0].quantity_ordered, 10);
    }

    #[tokio::test]
    async fn get_purchase_order_not_found() {
        // Input: a random PO id.
        // Expected: Err "Purchase order not found".
        let app = owner_app().await;
        let err = get_purchase_order(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Purchase order not found");
    }

    #[tokio::test]
    async fn list_purchase_orders_returns_all() {
        // Input: two POs.
        // Expected: 2 rows with supplier names.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        make_po(&app, &supplier.id).await;
        make_po(&app, &supplier.id).await;

        let pos = list_purchase_orders(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(pos.len(), 2);
        assert_eq!(pos[0].supplier_name, "Acme");
    }

    #[tokio::test]
    async fn list_purchase_orders_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_purchase_orders(app.state(), app.state())
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }
}
