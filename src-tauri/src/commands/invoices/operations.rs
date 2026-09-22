use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{check_permission, soft_delete};

use super::math::{clean_optional, compute_line_amounts, round_to_rupee};
use super::types::{
    InvoiceSettings, InvoiceWithDetails, PublicCustomer, PublicInvoice, PublicInvoiceItem,
    PublicPayment,
};

/// Gets or creates invoice settings for a company
pub async fn get_or_create_settings(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<InvoiceSettings, AppError> {
    // Try to get existing
    let existing = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            i64,
            i64,
            Option<String>,
            Option<String>,
            String,
            String,
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
    >(
        r#"
        SELECT company_ntn, company_strn, company_cnic,
               invoice_prefix, next_number, default_due_days,
               invoice_footer, terms_conditions,
               invoice_design, design_accent_color, show_qr,
               excel_template_base64, disclaimer, copyright, bank_details
        FROM company_invoice_settings
        WHERE company_id = ?
        "#,
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Settings lookup error: {e}")))?;

    if let Some((
        ntn,
        strn,
        cnic,
        prefix,
        next,
        due_days,
        footer,
        terms,
        design,
        accent,
        show_qr,
        excel_template,
        disclaimer,
        copyright,
        bank_details,
    )) = existing
    {
        return Ok(InvoiceSettings {
            company_ntn: ntn,
            company_strn: strn,
            company_cnic: cnic,
            invoice_prefix: prefix,
            next_number: next,
            default_due_days: due_days,
            invoice_footer: footer,
            terms_conditions: terms,
            invoice_design: design,
            design_accent_color: accent,
            show_qr: show_qr != 0,
            excel_template_base64: excel_template,
            disclaimer,
            copyright,
            bank_details,
        });
    }

    // Create default settings
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO company_invoice_settings (id, company_id)
        VALUES (?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to create settings: {e}")))?;

    Ok(InvoiceSettings {
        company_ntn: None,
        company_strn: None,
        company_cnic: None,
        invoice_prefix: "INV".to_string(),
        next_number: 1,
        default_due_days: 30,
        invoice_footer: None,
        terms_conditions: None,
        invoice_design: "classic".to_string(),
        design_accent_color: "#1d2b54".to_string(),
        show_qr: true,
        excel_template_base64: None,
        disclaimer: None,
        copyright: None,
        bank_details: None,
    })
}

/// Generates the next invoice number ATOMICALLY inside a transaction.
pub(crate) async fn generate_invoice_number(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
) -> Result<String, AppError> {
    // Ensure settings row exists
    let exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Settings check error: {e}")))?;

    if !exists {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_invoice_settings (id, company_id) VALUES (?, ?)")
            .bind(&id)
            .bind(company_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::internal(format!("Settings create error: {e}")))?;
    }

    // READ and INCREMENT in the SAME transaction (atomic)
    let (prefix, number): (String, i64) = sqlx::query_as(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Settings read error: {e}")))?;

    // Increment immediately (within the same transaction)
    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?"
    )
    .bind(company_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Counter update error: {e}")))?;

    Ok(format!("{}-{:04}", prefix, number))
}

// ==========================================

// ==========================================
// INVOICE COMMANDS
// ==========================================

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
        WHERE company_id = ?
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

/// Creates a new draft invoice
#[tauri::command]
pub async fn create_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    customer_id: String,
    invoice_date: String,
    due_date: String,
    po_number: String,
    reference_note: String,
    currency_code: Option<String>,
    exchange_rate: Option<f64>,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate customer exists
    sqlx::query_scalar::<_, String>("SELECT name FROM customers WHERE id = ? AND company_id = ?")
        .bind(&customer_id)
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|_| "Customer not found".to_string())?;

    // Use a transaction for atomic invoice number generation
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    let invoice_number = generate_invoice_number(&mut tx, company_id).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let due = clean_optional(&due_date);
    let cur_code = currency_code.unwrap_or_default();
    let ex_rate = exchange_rate.unwrap_or(1.0);

    sqlx::query(
        r#"
        INSERT INTO invoices
            (id, company_id, invoice_number, invoice_date, due_date,
             customer_id, status, po_number, reference_note, created_by,
             currency_code, exchange_rate)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&invoice_number)
    .bind(&invoice_date)
    .bind(&due)
    .bind(&customer_id)
    .bind(clean_optional(&po_number))
    .bind(clean_optional(&reference_note))
    .bind(&current_user.id)
    .bind(&cur_code)
    .bind(ex_rate)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let invoice = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(invoice)
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

/// Finalizes a draft invoice (locks it and deducts stock)
#[tauri::command]
pub async fn finalize_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "finalize").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Use a transaction
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    // Verify invoice is draft
    let invoice = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id, status, grand_total FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    if invoice.1 != "draft" {
        return Err(AppError::internal("Invoice is not in draft status".to_string()));
    }

    if invoice.2 == 0 {
        return Err(AppError::internal("Cannot finalize an invoice with zero total. Add items first.".to_string()));
    }

    // Get all items and deduct stock
    let items = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?",
    )
    .bind(&invoice_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Items lookup error: {e}")))?;

    for (product_id, product_name, quantity) in &items {
        // Check stock
        let current_stock = sqlx::query_scalar::<_, i64>(
            "SELECT quantity_in_stock FROM products WHERE id = ? AND company_id = ?",
        )
        .bind(product_id)
        .bind(company_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Stock check error: {e}")))?;

        if current_stock < *quantity {
            return Err(AppError::internal(format!(
                "Insufficient stock for '{}': have {}, need {}",
                product_name, current_stock, quantity
            )));
        }

        // Deduct stock
        sqlx::query(
            "UPDATE products SET quantity_in_stock = quantity_in_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?"
        )
        .bind(quantity)
        .bind(product_id)
        .bind(company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Stock update error: {e}")))?;

        // Record stock movement
        let movement_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO stock_movements
                (id, company_id, product_id, movement_type, quantity, reference_note, performed_by)
            VALUES (?, ?, ?, 'sale', ?, ?, ?)
            "#,
        )
        .bind(&movement_id)
        .bind(company_id)
        .bind(product_id)
        .bind(-quantity) // negative for stock OUT
        .bind(format!("Invoice {}", invoice_id))
        .bind(&current_user.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Movement record error: {e}")))?;

        // Deduct FIFO from expiry batches (soonest-expiring first).
        // No-op for products that have no batches.
        crate::commands::inventory::deduct_fifo(&mut tx, company_id, product_id, *quantity).await?;
    }

    // Mark invoice as finalized
    sqlx::query(
        r#"
        UPDATE invoices
        SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
            balance_due = grand_total
        WHERE id = ?
        "#,
    )
    .bind(&invoice_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Finalize error: {e}")))?;

    // Double-entry: Dr Accounts Receivable / Cr Sales Revenue.
    let (invoice_number, invoice_date) = sqlx::query_as::<_, (String, String)>(
        "SELECT invoice_number, invoice_date FROM invoices WHERE id = ?",
    )
    .bind(&invoice_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Invoice lookup error: {e}")))?;

    crate::commands::ledger::post_invoice_sale(
        &mut tx,
        company_id,
        &invoice_id,
        &invoice_date,
        &invoice_number,
        invoice.2,
        &current_user.id,
    )
    .await?;

    // FBR outbox: enqueue for PRAL submission (spec section 17.4).
    // Inserted inside the same transaction so the queue row is committed atomically.
    if let Err(e) = crate::commands::fbr::enqueue_fbr_submission(&mut tx, pool.inner(), company_id, &invoice_id).await {
        // Non-fatal: FBR submission failure should not block invoice finalization.
        // The error is logged but the invoice is still finalized.
        eprintln!("FBR enqueue warning: {e}");
    }

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "finalize",
        "invoice",
        Some(&invoice_id),
        &format!("Finalized invoice (total {})", invoice.2),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(updated)
}

/// Records a payment against an invoice
#[tauri::command]
pub async fn record_payment(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    amount: i64,
    payment_method: String,
    payment_date: String,
    reference: String,
    notes: String,
    payment_currency_code: Option<String>,
    payment_exchange_rate: Option<f64>,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if amount <= 0 {
        return Err(AppError::internal("Payment amount must be positive".to_string()));
    }

    let valid_methods = ["cash", "bank_transfer", "card", "cheque", "online", "other"];
    if !valid_methods.contains(&payment_method.as_str()) {
        return Err(AppError::internal("Invalid payment method".to_string()));
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    // Get current invoice + its currency info
    let invoice = sqlx::query_as::<_, (String, i64, i64, String, f64)>(
        "SELECT status, grand_total, amount_paid, COALESCE(currency_code, ''), COALESCE(exchange_rate, 1.0) FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    if invoice.0 == "draft" || invoice.0 == "cancelled" {
        return Err(AppError::internal("Cannot record payment for draft or cancelled invoices".to_string()));
    }

    // Compute base currency amount for accounting
    let pay_currency = payment_currency_code.unwrap_or_else(|| invoice.3.clone());
    let pay_rate = payment_exchange_rate.unwrap_or(invoice.4);
    let base_currency_amount = crate::commands::currency::convert_amount(amount, pay_rate, 2);

    let new_amount_paid = invoice.2 + base_currency_amount;
    let new_balance = invoice.1 - new_amount_paid;

    if new_balance < 0 {
        return Err(AppError::internal(format!(
            "Payment ({}) exceeds balance due ({}). Overpayment not allowed.",
            base_currency_amount,
            invoice.1 - invoice.2
        )));
    }

    let new_status = if new_balance == 0 {
        "paid"
    } else {
        "finalized"
    };

    // Record payment
    let payment_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO payment_records
            (id, invoice_id, company_id, amount, payment_method,
             payment_date, reference, notes, received_by,
             currency_code, exchange_rate, base_currency_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment_id)
    .bind(&invoice_id)
    .bind(company_id)
    .bind(base_currency_amount)
    .bind(&payment_method)
    .bind(&payment_date)
    .bind(clean_optional(&reference))
    .bind(clean_optional(&notes))
    .bind(&current_user.id)
    .bind(&pay_currency)
    .bind(pay_rate)
    .bind(base_currency_amount)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Payment record error: {e}")))?;

    // Update invoice
    sqlx::query(
        r#"
        UPDATE invoices
        SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(new_amount_paid)
    .bind(new_balance)
    .bind(new_status)
    .bind(&invoice_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Invoice update error: {e}")))?;

    // Double-entry: Dr Cash / Cr Accounts Receivable.
    let invoice_number =
        sqlx::query_scalar::<_, String>("SELECT invoice_number FROM invoices WHERE id = ?")
            .bind(&invoice_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Invoice lookup error: {e}")))?;

    crate::commands::ledger::post_payment_collection(
        &mut tx,
        company_id,
        &payment_id,
        &payment_date,
        &invoice_number,
        base_currency_amount,
        &current_user.id,
    )
    .await?;

    // Post FX gain/loss if payment currency differs from invoice currency
    // or if the payment rate differs from the invoice rate
    let expected_base = crate::commands::currency::convert_amount(amount, invoice.4, 2);
    let fx_gain_loss = expected_base - base_currency_amount;

    if fx_gain_loss.abs() > 1 {
        let (debit_code, credit_code, description) = if fx_gain_loss > 0 {
            // We received LESS than expected → FX Loss
            ("7100", "1000", format!("FX loss on payment for invoice {invoice_number}"))
        } else {
            // We received MORE than expected → FX Gain
            ("1000", "7000", format!("FX gain on payment for invoice {invoice_number}"))
        };
        let abs_diff = fx_gain_loss.abs() as i64;

        crate::commands::ledger::post_journal_entry(
            &mut tx,
            company_id,
            &payment_date,
            "fx_adjustment",
            Some(&payment_id),
            &description,
            vec![
                crate::commands::ledger::JournalLineInput {
                    account_code: debit_code.to_string(),
                    debit: abs_diff,
                    credit: 0,
                    description: Some(format!("Payment {payment_id}")),
                },
                crate::commands::ledger::JournalLineInput {
                    account_code: credit_code.to_string(),
                    debit: 0,
                    credit: abs_diff,
                    description: Some(format!("Payment {payment_id}")),
                },
            ],
            Some(&current_user.id),
        )
        .await?;
    }

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "payment",
        "invoice",
        Some(&invoice_id),
        &format!(
            "Recorded payment of {} via {} (invoice now {})",
            amount, payment_method, new_status
        ),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(updated)
}

/// Gets or updates invoice settings for the company
#[tauri::command]
pub async fn get_invoice_settings(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<InvoiceSettings, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    get_or_create_settings(pool.inner(), company_id).await
}

#[tauri::command]
pub async fn update_invoice_settings(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_ntn: String,
    company_strn: String,
    company_cnic: String,
    invoice_prefix: String,
    default_due_days: i64,
    invoice_footer: String,
    terms_conditions: String,
    invoice_design: String,
    design_accent_color: String,
    show_qr: bool,
    disclaimer: String,
    copyright: String,
    bank_details: String,
) -> Result<InvoiceSettings, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "settings", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let prefix = if invoice_prefix.trim().is_empty() {
        "INV".to_string()
    } else {
        invoice_prefix.trim().to_uppercase()
    };

    let due_days = if default_due_days < 1 {
        30
    } else {
        default_due_days
    };

    let design = if matches!(invoice_design.as_str(), "classic" | "modern" | "minimal" | "excel") {
        invoice_design
    } else {
        "classic".to_string()
    };

    let accent = if design_accent_color.trim().starts_with('#')
        && design_accent_color.trim().len() == 7
    {
        design_accent_color.trim().to_string()
    } else {
        "#1d2b54".to_string()
    };

    // Upsert settings
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO company_invoice_settings
            (id, company_id, company_ntn, company_strn, company_cnic,
             invoice_prefix, default_due_days, invoice_footer, terms_conditions,
             invoice_design, design_accent_color, show_qr,
             disclaimer, copyright, bank_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
            company_ntn = excluded.company_ntn,
            company_strn = excluded.company_strn,
            company_cnic = excluded.company_cnic,
            invoice_prefix = excluded.invoice_prefix,
            default_due_days = excluded.default_due_days,
            invoice_footer = excluded.invoice_footer,
            terms_conditions = excluded.terms_conditions,
            invoice_design = excluded.invoice_design,
            design_accent_color = excluded.design_accent_color,
            show_qr = excluded.show_qr,
            disclaimer = excluded.disclaimer,
            copyright = excluded.copyright,
            bank_details = excluded.bank_details,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(clean_optional(&company_ntn))
    .bind(clean_optional(&company_strn))
    .bind(clean_optional(&company_cnic))
    .bind(&prefix)
    .bind(due_days)
    .bind(clean_optional(&invoice_footer))
    .bind(clean_optional(&terms_conditions))
    .bind(&design)
    .bind(&accent)
    .bind(show_qr as i64)
    .bind(clean_optional(&disclaimer))
    .bind(clean_optional(&copyright))
    .bind(clean_optional(&bank_details))
    .execute(pool.inner())
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
        "invoice_settings",
        None,
        &format!(
            "Updated invoice settings (prefix '{}', due {} days, design '{}')",
            prefix, due_days, design
        ),
    )
    .await;

    get_or_create_settings(pool.inner(), company_id).await
}

// ==========================================
// INTERNAL: Recalculate invoice totals
// ==========================================

async fn recalculate_invoice_totals(
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
        - sqlx::query_as::<_, (i64,)>("SELECT amount_paid FROM invoices WHERE id = ?")
            .bind(invoice_id)
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
