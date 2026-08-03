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

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
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
    if t.is_empty() { None } else { Some(t.to_string()) }
}

async fn next_po_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
    // Get or create settings
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT next_number FROM company_po_settings WHERE company_id = ?"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Error: {e}"))?;

    let (prefix, number) = match existing {
        Some(n) => ("PO".to_string(), n),
        None => {
            sqlx::query("INSERT INTO company_po_settings (company_id) VALUES (?)")
                .bind(company_id)
                .execute(pool)
                .await
                .map_err(|e| format!("Error: {e}"))?;
            ("PO".to_string(), 1i64)
        }
    };

    sqlx::query("UPDATE company_po_settings SET next_number = next_number + 1 WHERE company_id = ?")
        .bind(company_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Error: {e}"))?;

    Ok(format!("{}-{:04}", prefix, number))
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
    let company_id = user.company_id.as_ref().ok_or("Not assigned to a company")?;

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
        "#
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
        "#
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
        items: items.into_iter().map(|r| PublicPOItem {
            id: r.0, po_id: r.1, product_id: r.2, product_name: r.3, product_sku: r.4,
            quantity_ordered: r.5, quantity_received: r.6, unit_cost: r.7,
            tax_rate: r.8, tax_amount: r.9, line_total: r.10, expiry_date: r.11,
        }).collect(),
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
    if user.role == "employee" { return Err("Employees cannot create POs".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    // Validate supplier
    sqlx::query_scalar::<_, String>("SELECT name FROM suppliers WHERE id = ? AND company_id = ?")
        .bind(&supplier_id).bind(company_id)
        .fetch_one(pool.inner()).await
        .map_err(|_| "Supplier not found".to_string())?;

    let po_number = next_po_number(pool.inner(), company_id).await?;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_orders (id,company_id,supplier_id,po_number,po_date,expected_date,status,reference_note,created_by) VALUES (?,?,?,?,?,'draft',?,?,?)"
    )
    .bind(&id).bind(company_id).bind(&supplier_id).bind(&po_number)
    .bind(&po_date).bind(clean(&expected_date)).bind(clean(&reference_note)).bind(&user.id)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

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
    expiry_date: String,
) -> Result<Vec<PublicPOItem>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    if user.role == "employee" { return Err("Employees cannot modify POs".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    // Validate PO is draft
    let status: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
        .bind(&po_id).bind(company_id)
        .fetch_one(pool.inner()).await.map_err(|_| "PO not found".to_string())?;
    if status != "draft" { return Err("Can only add items to draft POs".to_string()); }
    if quantity <= 0 { return Err("Quantity must be positive".to_string()); }

    // Get product
    let (pname, psku): (String, String) = sqlx::query_as("SELECT name, sku FROM products WHERE id = ? AND company_id = ?")
        .bind(&product_id).bind(company_id)
        .fetch_optional(pool.inner()).await.map_err(|e| format!("Error: {e}"))?
        .ok_or("Product not found")?;

    let tax_amount = (quantity * unit_cost * tax_rate) / 10000;
    let line_total = (quantity * unit_cost) + tax_amount;
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_order_items (id,po_id,company_id,product_id,product_name,product_sku,quantity_ordered,unit_cost,tax_rate,tax_amount,line_total,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(&id).bind(&po_id).bind(company_id).bind(&product_id)
    .bind(&pname).bind(&psku).bind(quantity).bind(unit_cost)
    .bind(tax_rate).bind(tax_amount).bind(line_total).bind(clean(&expiry_date))
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    // Recalculate totals
    recalc_po_totals(pool.inner(), &po_id, company_id).await?;

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
    if user.role == "employee" { return Err("Cannot modify POs".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let status: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
        .bind(&po_id).bind(company_id)
        .fetch_one(pool.inner()).await.map_err(|_| "PO not found".to_string())?;
    if status != "draft" { return Err("Can only remove from draft POs".to_string()); }

    sqlx::query("DELETE FROM purchase_order_items WHERE id = ? AND po_id = ?")
        .bind(&item_id).bind(&po_id)
        .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    recalc_po_totals(pool.inner(), &po_id, company_id).await?;

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
    if user.role == "employee" { return Err("Cannot submit POs".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query(
        "UPDATE purchase_orders SET status = 'ordered', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'draft'"
    )
    .bind(&po_id).bind(company_id)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    if rows.rows_affected() == 0 { return Err("PO not found or not in draft status".to_string()); }

    get_purchase_order(pool, session, po_id).await.map(|d| d.order)
}

/// Receives items from a PO — increases stock
#[tauri::command]
pub async fn receive_po_items(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
) -> Result<PublicPurchaseOrder, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    if user.role == "employee" { return Err("Cannot receive POs".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let mut tx = pool.inner().begin().await.map_err(|e| format!("Error: {e}"))?;

    // Verify PO is ordered
    let status: String = sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?")
        .bind(&po_id).bind(company_id)
        .fetch_optional(&mut *tx).await.map_err(|e| format!("Error: {e}"))?
        .ok_or("PO not found")?;
    if status != "ordered" { return Err("PO must be in 'ordered' status to receive".to_string()); }

    // Get all items
    let items: Vec<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, product_id, quantity_ordered, quantity_received, unit_cost, expiry_date FROM purchase_order_items WHERE po_id = ?"
    )
    .bind(&po_id)
    .fetch_all(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    for (item_id, product_id, qty_ordered, qty_received, unit_cost, expiry) in &items {
        let qty_to_receive = qty_ordered - qty_received;
        if qty_to_receive <= 0 { continue; }

        // Update item received qty
        sqlx::query("UPDATE purchase_order_items SET quantity_received = quantity_ordered WHERE id = ?")
            .bind(item_id).execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

        // Increase product stock
        sqlx::query("UPDATE products SET quantity_in_stock = quantity_in_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
            .bind(qty_to_receive).bind(product_id).bind(company_id)
            .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

        // Record stock movement
        let mid = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO stock_movements (id,company_id,product_id,movement_type,quantity,reference_note,performed_by) VALUES (?,?,'purchase',?,?,?,?)")
            .bind(&mid).bind(company_id).bind(product_id).bind(qty_to_receive)
            .bind(format!("PO {}", po_id)).bind(&user.id)
            .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

        // If expiry date provided, create a batch
        if let Some(ref exp) = expiry {
            if !exp.is_empty() {
                let bid = uuid::Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO stock_batches (id,company_id,product_id,quantity,unit_cost,expiry_date,source) VALUES (?,?,?,?,?,'purchase')")
                    .bind(&bid).bind(company_id).bind(product_id).bind(qty_to_receive)
                    .bind(unit_cost).bind(exp)
                    .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;
            }
        }
    }

    // Mark PO as received
    sqlx::query("UPDATE purchase_orders SET status = 'received', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&po_id).execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    tx.commit().await.map_err(|e| format!("Error: {e}"))?;

    get_purchase_order(pool, session, po_id).await.map(|d| d.order)
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
    if user.role == "employee" { return Err("Cannot record payments".to_string()); }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;
    if amount <= 0 { return Err("Amount must be positive".to_string()); }

    let mut tx = pool.inner().begin().await.map_err(|e| format!("Error: {e}"))?;

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
    if new_balance < 0 { return Err("Payment exceeds balance".to_string()); }

    let new_status = if new_balance == 0 { "paid" } else { &status.to_string() };

    let pid = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO purchase_payments (id,po_id,company_id,amount,payment_method,payment_date,reference,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&pid).bind(&po_id).bind(company_id).bind(amount)
        .bind(&payment_method).bind(&payment_date)
        .bind(clean(&reference)).bind(clean(&notes)).bind(&user.id)
        .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    sqlx::query("UPDATE purchase_orders SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(new_paid).bind(new_balance).bind(&new_status).bind(&po_id)
        .execute(&mut *tx).await.map_err(|e| format!("Error: {e}"))?;

    tx.commit().await.map_err(|e| format!("Error: {e}"))?;

    get_purchase_order(pool, session, po_id).await.map(|d| d.order)
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
    sqlx::query("UPDATE purchase_orders SET subtotal = ?, tax_total = ?, grand_total = ?, balance_due = grand_total - amount_paid, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
        .bind(subtotal).bind(tax).bind(grand).bind(po_id).bind(company_id)
        .execute(pool).await.map_err(|e| format!("Error: {e}"))?;

    Ok(())
}
