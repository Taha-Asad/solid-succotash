use super::helpers::{clean, next_po_number};
use super::types::*;
use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// PURCHASE ORDERS — ORDER LIFECYCLE COMMANDS
// ==========================================

/// Lists all purchase orders
#[tauri::command]
pub async fn list_purchase_orders(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicPurchaseOrder>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Error: {e}")))?;

    Ok(rows)
}

/// Gets a PO with its items
#[tauri::command]
pub async fn get_purchase_order(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
) -> Result<PurchaseOrderWithItems, AppError> {
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
    .map_err(|e| AppError::internal(format!("Error: {e}")))?
    .ok_or("Purchase order not found")?;

    let items = sqlx::query_as::<_, (String, String, String, String, String, i64, i64, i64, i64, i64, i64, Option<String>)>(
        "SELECT id, po_id, product_id, product_name, product_sku, quantity_ordered, quantity_received, unit_cost, tax_rate, tax_amount, line_total, expiry_date FROM purchase_order_items WHERE po_id = ? ORDER BY created_at"
    )
    .bind(&po_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Error: {e}")))?;

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
) -> Result<PublicPurchaseOrder, AppError> {
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
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO purchase_orders (id,company_id,supplier_id,po_number,po_date,expected_date,status,reference_note,created_by) VALUES (?,?,?,?,?,?,'draft',?,?)"
    )
    .bind(&id).bind(company_id).bind(&supplier_id).bind(&po_number)
    .bind(&po_date).bind(clean(&expected_date)).bind(clean(&reference_note)).bind(&user.id)
    .execute(pool.inner()).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

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

/// Marks PO as ordered
#[tauri::command]
pub async fn submit_purchase_order(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    po_id: String,
) -> Result<PublicPurchaseOrder, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "purchase_orders", "finalize").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query(
        "UPDATE purchase_orders SET status = 'ordered', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status = 'draft'"
    )
    .bind(&po_id).bind(company_id)
    .execute(pool.inner()).await.map_err(|e| AppError::internal(format!("Error: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("PO not found or not in draft status".to_string()));
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
