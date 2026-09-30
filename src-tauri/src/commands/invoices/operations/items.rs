use sqlx::SqlitePool;
use tauri::State;

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::error::AppError;

use super::super::math::{compute_line_amounts, round_to_rupee};
use super::super::types::PublicInvoiceItem;

/// Recalculates invoice totals based on current items
pub(crate) async fn recalculate_invoice_totals(
    pool: &SqlitePool,
    invoice_id: &str,
    company_id: &str,
) -> Result<(), AppError> {
    let totals = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        SELECT
            COALESCE(SUM(quantity * unit_price), 0),
            COALESCE(SUM(tax_amount), 0),
            COALESCE(SUM(discount_amount), 0)
        FROM invoice_items
        WHERE invoice_id = ?
        "#,
    )
    .bind(invoice_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Totals calculation error: {e}")))?;

    let subtotal = totals.0;
    let tax_total = totals.1;
    let discount_total = totals.2;
    let grand_total = round_to_rupee(subtotal - discount_total + tax_total);

    // Compute balance_due in Rust — do NOT use `balance_due = grand_total - amount_paid`
    // inside the same UPDATE that sets grand_total, because SQLite evaluates the
    // right-hand side with the OLD value of grand_total, not the new one.
    let balance_due = grand_total
        - sqlx::query_as::<_, (i64,)>("SELECT amount_paid FROM invoices WHERE id = ? AND company_id = ?")
            .bind(invoice_id)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::internal(format!("Amount paid lookup error: {e}")))?
            .0;

    sqlx::query(
        r#"
        UPDATE invoices
        SET subtotal = ?, tax_total = ?, discount_total = ?,
            grand_total = ?, balance_due = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(subtotal)
    .bind(tax_total)
    .bind(discount_total)
    .bind(grand_total)
    .bind(balance_due)
    .bind(invoice_id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Invoice update error: {e}")))?;

    Ok(())
}

/// Adds a line item to a draft invoice
#[tauri::command]
pub async fn add_invoice_item(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    product_id: String,
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount_type: String,
    discount_value: i64,
) -> Result<Vec<PublicInvoiceItem>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate invoice is draft
    let invoice_status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|_| "Invoice not found".to_string())?;

    if invoice_status != "draft" {
        return Err(AppError::internal("Can only add items to draft invoices".to_string()));
    }

    if quantity <= 0 {
        return Err(AppError::internal("Quantity must be positive".to_string()));
    }

    if unit_price < 0 {
        return Err(AppError::internal("Unit price cannot be negative".to_string()));
    }

    if discount_value < 0 {
        return Err(AppError::internal("Discount cannot be negative".to_string()));
    }

    // Get invoice currency info for conversion
    let invoice_info = sqlx::query_as::<_, (String, String, f64)>(
        "SELECT status, COALESCE(currency_code, ''), COALESCE(exchange_rate, 1.0) FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|_| "Invoice not found".to_string())?;

    if invoice_info.0 != "draft" {
        return Err(AppError::internal("Can only add items to draft invoices".to_string()));
    }

    let inv_currency = &invoice_info.1;
    let inv_rate = invoice_info.2;
    let has_foreign_currency = !inv_currency.is_empty() && inv_rate != 1.0;

    // When foreign currency: unit_price from user is in invoice currency
    // We store original (invoice currency) and compute base currency equivalent
    let (base_unit_price, original_unit_price) = if has_foreign_currency {
        let base = crate::commands::currency::convert_amount(unit_price, inv_rate, 2);
        (base, unit_price)
    } else {
        (unit_price, unit_price)
    };

    // Get product details (snapshot)
    let product = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, name, sku FROM products WHERE id = ? AND company_id = ?",
    )
    .bind(&product_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?
    .ok_or("Product not found")?;

    // Calculate amounts (using base currency unit_price for accounting)
    let (discount_rate, tax_amount, discount_amount, line_total) = compute_line_amounts(
        quantity,
        base_unit_price,
        tax_rate,
        &discount_type,
        discount_value,
    );

    // Calculate original amounts in invoice currency (for display)
    let (_, _, _, original_line_total) = if has_foreign_currency {
        compute_line_amounts(
            quantity,
            original_unit_price,
            tax_rate,
            &discount_type,
            discount_value,
        )
    } else {
        (discount_rate, tax_amount, discount_amount, line_total)
    };

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO invoice_items
            (id, invoice_id, company_id, product_id, product_name, product_sku,
             quantity, unit_price, tax_rate, tax_amount,
             discount_rate, discount_amount, discount_type, line_total,
             original_unit_price, original_line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&invoice_id)
    .bind(company_id)
    .bind(&product_id)
    .bind(&product.1) // name
    .bind(&product.2) // sku (String)
    .bind(quantity)
    .bind(base_unit_price)
    .bind(tax_rate)
    .bind(tax_amount)
    .bind(discount_rate)
    .bind(discount_amount)
    .bind(&discount_type)
    .bind(line_total)
    .bind(original_unit_price)
    .bind(original_line_total)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    // Recalculate invoice totals
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    // Return all items for this invoice
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "invoice_item",
        Some(&id),
        &format!(
            "Added item {}× '{}' ({} {})",
            quantity, product.1, unit_price, discount_type
        ),
    )
    .await;

    Ok(items)
}

/// Updates a line item on a draft invoice (quantity, price, tax, discount)
#[tauri::command]
pub async fn update_invoice_item(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    item_id: String,
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount_type: String,
    discount_value: i64,
) -> Result<Vec<PublicInvoiceItem>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate invoice is draft
    let invoice_status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|_| "Invoice not found".to_string())?;

    if invoice_status != "draft" {
        return Err(AppError::internal("Can only modify items on draft invoices".to_string()));
    }

    if quantity <= 0 {
        return Err(AppError::internal("Quantity must be positive".to_string()));
    }

    if unit_price < 0 {
        return Err(AppError::internal("Unit price cannot be negative".to_string()));
    }

    if discount_value < 0 {
        return Err(AppError::internal("Discount cannot be negative".to_string()));
    }

    // Validate the item belongs to this invoice
    let belongs = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM invoice_items WHERE id = ? AND invoice_id = ? AND company_id = ?",
    )
    .bind(&item_id)
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Item lookup error: {e}")))?;

    if belongs == 0 {
        return Err(AppError::internal("Item not found on this invoice".to_string()));
    }

    // Get invoice currency info for conversion
    let inv_info = sqlx::query_as::<_, (String, f64)>(
        "SELECT COALESCE(currency_code, ''), COALESCE(exchange_rate, 1.0) FROM invoices WHERE id = ?",
    )
    .bind(&invoice_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Invoice lookup error: {e}")))?;

    let has_foreign_currency = !inv_info.0.is_empty() && inv_info.1 != 1.0;
    let (base_unit_price, original_unit_price) = if has_foreign_currency {
        let base = crate::commands::currency::convert_amount(unit_price, inv_info.1, 2);
        (base, unit_price)
    } else {
        (unit_price, unit_price)
    };

    // Calculate amounts (using base currency for accounting)
    let (discount_rate, tax_amount, discount_amount, line_total) = compute_line_amounts(
        quantity,
        base_unit_price,
        tax_rate,
        &discount_type,
        discount_value,
    );

    let (_, _, _, original_line_total) = if has_foreign_currency {
        compute_line_amounts(quantity, original_unit_price, tax_rate, &discount_type, discount_value)
    } else {
        (discount_rate, tax_amount, discount_amount, line_total)
    };

    sqlx::query(
        r#"
        UPDATE invoice_items
        SET quantity = ?, unit_price = ?, tax_rate = ?, tax_amount = ?,
            discount_rate = ?, discount_amount = ?, discount_type = ?, line_total = ?,
            original_unit_price = ?, original_line_total = ?
        WHERE id = ? AND invoice_id = ?
        "#,
    )
    .bind(quantity)
    .bind(base_unit_price)
    .bind(tax_rate)
    .bind(tax_amount)
    .bind(discount_rate)
    .bind(discount_amount)
    .bind(&discount_type)
    .bind(line_total)
    .bind(original_unit_price)
    .bind(original_line_total)
    .bind(&item_id)
    .bind(&invoice_id)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    // Recalculate invoice totals
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    // Return all items for this invoice
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "invoice_item",
        Some(&item_id),
        &format!(
            "Updated item on invoice {} (qty {}, price {})",
            invoice_id, quantity, unit_price
        ),
    )
    .await;

    Ok(items)
}

/// Removes a line item from a draft invoice
#[tauri::command]
pub async fn remove_invoice_item(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    item_id: String,
) -> Result<Vec<PublicInvoiceItem>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate invoice is draft
    let invoice_status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|_| "Invoice not found".to_string())?;

    if invoice_status != "draft" {
        return Err(AppError::internal("Can only remove items from draft invoices".to_string()));
    }

    let rows = sqlx::query("DELETE FROM invoice_items WHERE id = ? AND invoice_id = ?")
        .bind(&item_id)
        .bind(&invoice_id)
        .execute(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Item not found".to_string()));
    }

    // Recalculate
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "invoice_item",
        Some(&item_id),
        &format!("Removed item from invoice {}", invoice_id),
    )
    .await;

    Ok(items)
}
