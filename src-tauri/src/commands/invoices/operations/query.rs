use sqlx::SqlitePool;
use tauri::State;

use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;

use super::super::types::{
    InvoiceWithDetails, PublicCustomer, PublicInvoice, PublicInvoiceItem, PublicPayment,
};

/// Lists all invoices for the current company
#[tauri::command]
pub async fn list_invoices(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicInvoice>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let invoices = sqlx::query_as::<_, PublicInvoice>(
        r#"
        SELECT id, company_id, invoice_number, invoice_date, due_date,
               customer_id, status, subtotal, tax_total, discount_total,
               grand_total, fbr_invoice_number, po_number, reference_note,
               amount_paid, balance_due, created_by, finalized_at,
               created_at, updated_at,
               COALESCE(currency_code, '') AS currency_code,
               COALESCE(exchange_rate, 1.0) AS exchange_rate,
               irn, fbr_status
        FROM invoices
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(invoices)
}

/// Gets a full invoice with customer, items, and payments
#[tauri::command]
pub async fn get_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<InvoiceWithDetails, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Get invoice
    let invoice = sqlx::query_as::<_, PublicInvoice>(
        "SELECT * FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    // Get customer
    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&invoice.customer_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Customer lookup error: {e}")))?;

    // Get items
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Items lookup error: {e}")))?;

    // Get payments
    let payments = sqlx::query_as::<_, PublicPayment>(
        "SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY payment_date",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Payments lookup error: {e}")))?;

    Ok(InvoiceWithDetails {
        invoice,
        customer,
        items,
        payments,
    })
}
