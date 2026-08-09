// ==========================================
// INVOICE COMMANDS
// ==========================================
//
// Pakistani FBR-compliant invoice system.
//
// Lifecycle:
//   draft → finalized → paid (or cancelled)
//
//   draft:      Can edit everything, add/remove items
//   finalized:  Locked. Stock deducted. Can record payments.
//   paid:       All payments received. Read-only.
//   cancelled:  Reversed. Stock restored. Read-only.

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{check_permission, soft_delete};
use qrcode::render::svg;
use qrcode::QrCode;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

// ==========================================
// RETURN TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicCustomer {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub cnic: Option<String>,
    pub ntn: Option<String>,
    pub strn: Option<String>,
    pub buyer_type: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicInvoice {
    pub id: String,
    pub company_id: String,
    pub invoice_number: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub customer_id: String,
    pub status: String,
    pub subtotal: i64,
    pub tax_total: i64,
    pub discount_total: i64,
    pub grand_total: i64,
    pub fbr_invoice_number: Option<String>,
    pub po_number: Option<String>,
    pub reference_note: Option<String>,
    pub amount_paid: i64,
    pub balance_due: i64,
    pub created_by: String,
    pub finalized_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicInvoiceItem {
    pub id: String,
    pub invoice_id: String,
    pub company_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub tax_rate: i64,
    pub tax_amount: i64,
    pub discount_rate: i64,
    pub discount_amount: i64,
    pub discount_type: String,
    pub line_total: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicPayment {
    pub id: String,
    pub invoice_id: String,
    pub company_id: String,
    pub amount: i64,
    pub payment_method: String,
    pub payment_date: String,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub received_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceWithDetails {
    pub invoice: PublicInvoice,
    pub customer: PublicCustomer,
    pub items: Vec<PublicInvoiceItem>,
    pub payments: Vec<PublicPayment>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSettings {
    pub company_ntn: Option<String>,
    pub company_strn: Option<String>,
    pub company_cnic: Option<String>,
    pub invoice_prefix: String,
    pub next_number: i64,
    pub default_due_days: i64,
    pub invoice_footer: Option<String>,
    pub terms_conditions: Option<String>,
    pub invoice_design: String,
    pub design_accent_color: String,
    pub show_qr: bool,
    pub excel_template_base64: Option<String>,
    pub disclaimer: Option<String>,
    pub copyright: Option<String>,
    pub bank_details: Option<String>,
}

// ==========================================
// HELPERS
// ==========================================

fn clean_optional(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Rounds a paisa amount to the nearest whole rupee (100 paisa).
fn round_to_rupee(paisa: i64) -> i64 {
    let rem = paisa.rem_euclid(100);
    if rem >= 50 {
        paisa - rem + 100
    } else {
        paisa - rem
    }
}

/// Computes a line item's tax/discount/total from its inputs.
/// Returns (discount_rate_stored, tax_amount, discount_amount, line_total).
///
/// discount_type:
///   "percent" -> discount_value is the percentage * 100 (500 = 5%)
///   "amount"  -> discount_value is a fixed cash amount in paisa
fn compute_line_amounts(
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount_type: &str,
    discount_value: i64,
) -> (i64, i64, i64, i64) {
    let line_subtotal = quantity * unit_price;
    let (discount_rate, discount_amount) = if discount_type == "amount" {
        (0, discount_value.clamp(0, line_subtotal))
    } else {
        let rate = discount_value.max(0);
        (rate, (line_subtotal * rate) / 10000)
    };
    let after_discount = line_subtotal - discount_amount;
    let tax_amount = (after_discount * tax_rate) / 10000;
    let line_total = round_to_rupee(after_discount + tax_amount);
    (discount_rate, tax_amount, discount_amount, line_total)
}

/// Gets or creates invoice settings for a company
pub async fn get_or_create_settings(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<InvoiceSettings, String> {
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
    .map_err(|e| format!("Settings lookup error: {e}"))?;

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
    .map_err(|e| format!("Failed to create settings: {e}"))?;

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

/// Generates the next invoice number and increments the counter
// async fn generate_invoice_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
//     let settings = get_or_create_settings(pool, company_id).await?;

//     let number = settings.next_number;
//     let invoice_number = format!("{}-{:04}", settings.invoice_prefix, number);

//     // Increment the counter
//     sqlx::query(
//         "UPDATE company_invoice_settings SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?"
//     )
//     .bind(company_id)
//     .execute(pool)
//     .await
//     .map_err(|e| format!("Failed to update invoice counter: {e}"))?;

//     Ok(invoice_number)
// }

// ==========================================
// CUSTOMER COMMANDS
// ==========================================

#[tauri::command]
pub async fn list_customers(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicCustomer>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let customers = sqlx::query_as::<_, PublicCustomer>(
        r#"
        SELECT id, company_id, name, email, phone, address,
               cnic, ntn, strn, buyer_type, is_active,
               created_at, updated_at, version
        FROM customers
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(customers)
}

#[tauri::command]
pub async fn create_customer(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    email: String,
    phone: String,
    address: String,
    cnic: String,
    ntn: String,
    strn: String,
    buyer_type: String,
) -> Result<PublicCustomer, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Customer name cannot be empty".to_string());
    }

    let valid_buyer_types = ["registered", "unregistered"];
    if !valid_buyer_types.contains(&buyer_type.as_str()) {
        return Err("Buyer type must be 'registered' or 'unregistered'".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO customers
            (id, company_id, name, email, phone, address,
             cnic, ntn, strn, buyer_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&cnic))
    .bind(clean_optional(&ntn))
    .bind(clean_optional(&strn))
    .bind(&buyer_type)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "customer",
        Some(&id),
        &format!("Created customer '{}'", trimmed_name),
    )
    .await;

    Ok(customer)
}

#[tauri::command]
pub async fn delete_customer(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    customer_id: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows = soft_delete(pool.inner(), "customers", &customer_id, company_id).await?;

    if rows == 0 {
        return Err("Customer not found".to_string());
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "customer",
        Some(&customer_id),
        &format!("Deleted customer"),
    )
    .await;

    Ok(())
}

// ==========================================
// INVOICE COMMANDS
// ==========================================

/// Lists all invoices for the current company
#[tauri::command]
pub async fn list_invoices(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicInvoice>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let invoices = sqlx::query_as::<_, PublicInvoice>(
        r#"
        SELECT id, company_id, invoice_number, invoice_date, due_date,
               customer_id, status, subtotal, tax_total, discount_total,
               grand_total, fbr_invoice_number, po_number, reference_note,
               amount_paid, balance_due, created_by, finalized_at,
               created_at, updated_at
        FROM invoices
        WHERE company_id = ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(invoices)
}

/// Gets a full invoice with customer, items, and payments
#[tauri::command]
pub async fn get_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<InvoiceWithDetails, String> {
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
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    // Get customer
    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&invoice.customer_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Customer lookup error: {e}"))?;

    // Get items
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Items lookup error: {e}"))?;

    // Get payments
    let payments = sqlx::query_as::<_, PublicPayment>(
        "SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY payment_date",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Payments lookup error: {e}"))?;

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
) -> Result<PublicInvoice, String> {
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
        .map_err(|e| format!("Transaction error: {e}"))?;

    let invoice_number = generate_invoice_number(&mut tx, company_id).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let due = clean_optional(&due_date);

    sqlx::query(
        r#"
        INSERT INTO invoices
            (id, company_id, invoice_number, invoice_date, due_date,
             customer_id, status, po_number, reference_note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
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
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let invoice = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<Vec<PublicInvoiceItem>, String> {
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
        return Err("Can only add items to draft invoices".to_string());
    }

    if quantity <= 0 {
        return Err("Quantity must be positive".to_string());
    }

    if unit_price < 0 {
        return Err("Unit price cannot be negative".to_string());
    }

    if discount_value < 0 {
        return Err("Discount cannot be negative".to_string());
    }

    // Get product details (snapshot)
    let product = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, name, sku FROM products WHERE id = ? AND company_id = ?",
    )
    .bind(&product_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Product lookup error: {e}"))?
    .ok_or("Product not found")?;

    // Calculate amounts
    let (discount_rate, tax_amount, discount_amount, line_total) = compute_line_amounts(
        quantity,
        unit_price,
        tax_rate,
        &discount_type,
        discount_value,
    );

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO invoice_items
            (id, invoice_id, company_id, product_id, product_name, product_sku,
             quantity, unit_price, tax_rate, tax_amount,
             discount_rate, discount_amount, discount_type, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&invoice_id)
    .bind(company_id)
    .bind(&product_id)
    .bind(&product.1) // name
    .bind(&product.2) // sku (String)
    .bind(quantity)
    .bind(unit_price)
    .bind(tax_rate)
    .bind(tax_amount)
    .bind(discount_rate)
    .bind(discount_amount)
    .bind(&discount_type)
    .bind(line_total)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    // Recalculate invoice totals
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    // Return all items for this invoice
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

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
            quantity, product.1, unit_price, &discount_type
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
) -> Result<Vec<PublicInvoiceItem>, String> {
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
        return Err("Can only modify items on draft invoices".to_string());
    }

    if quantity <= 0 {
        return Err("Quantity must be positive".to_string());
    }

    if unit_price < 0 {
        return Err("Unit price cannot be negative".to_string());
    }

    if discount_value < 0 {
        return Err("Discount cannot be negative".to_string());
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
    .map_err(|e| format!("Item lookup error: {e}"))?;

    if belongs == 0 {
        return Err("Item not found on this invoice".to_string());
    }

    // Calculate amounts
    let (discount_rate, tax_amount, discount_amount, line_total) = compute_line_amounts(
        quantity,
        unit_price,
        tax_rate,
        &discount_type,
        discount_value,
    );

    sqlx::query(
        r#"
        UPDATE invoice_items
        SET quantity = ?, unit_price = ?, tax_rate = ?, tax_amount = ?,
            discount_rate = ?, discount_amount = ?, discount_type = ?, line_total = ?
        WHERE id = ? AND invoice_id = ?
        "#,
    )
    .bind(quantity)
    .bind(unit_price)
    .bind(tax_rate)
    .bind(tax_amount)
    .bind(discount_rate)
    .bind(discount_amount)
    .bind(&discount_type)
    .bind(line_total)
    .bind(&item_id)
    .bind(&invoice_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    // Recalculate invoice totals
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    // Return all items for this invoice
    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<Vec<PublicInvoiceItem>, String> {
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
        return Err("Can only remove items from draft invoices".to_string());
    }

    let rows = sqlx::query("DELETE FROM invoice_items WHERE id = ? AND invoice_id = ?")
        .bind(&item_id)
        .bind(&invoice_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("Item not found".to_string());
    }

    // Recalculate
    recalculate_invoice_totals(pool.inner(), &invoice_id, company_id).await?;

    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<PublicInvoice, String> {
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
        .map_err(|e| format!("Transaction error: {e}"))?;

    // Verify invoice is draft
    let invoice = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id, status, grand_total FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    if invoice.1 != "draft" {
        return Err("Invoice is not in draft status".to_string());
    }

    if invoice.2 == 0 {
        return Err("Cannot finalize an invoice with zero total. Add items first.".to_string());
    }

    // Get all items and deduct stock
    let items = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?",
    )
    .bind(&invoice_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("Items lookup error: {e}"))?;

    for (product_id, product_name, quantity) in &items {
        // Check stock
        let current_stock = sqlx::query_scalar::<_, i64>(
            "SELECT quantity_in_stock FROM products WHERE id = ? AND company_id = ?",
        )
        .bind(product_id)
        .bind(company_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("Stock check error: {e}"))?;

        if current_stock < *quantity {
            return Err(format!(
                "Insufficient stock for '{}': have {}, need {}",
                product_name, current_stock, quantity
            ));
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
        .map_err(|e| format!("Stock update error: {e}"))?;

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
        .map_err(|e| format!("Movement record error: {e}"))?;

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
    .map_err(|e| format!("Finalize error: {e}"))?;

    // Double-entry: Dr Accounts Receivable / Cr Sales Revenue.
    let (invoice_number, invoice_date) = sqlx::query_as::<_, (String, String)>(
        "SELECT invoice_number, invoice_date FROM invoices WHERE id = ?",
    )
    .bind(&invoice_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Invoice lookup error: {e}"))?;

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

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<PublicInvoice, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if amount <= 0 {
        return Err("Payment amount must be positive".to_string());
    }

    let valid_methods = ["cash", "bank_transfer", "card", "cheque", "online", "other"];
    if !valid_methods.contains(&payment_method.as_str()) {
        return Err("Invalid payment method".to_string());
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    // Get current invoice
    let invoice = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT status, grand_total, amount_paid FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    if invoice.0 == "draft" || invoice.0 == "cancelled" {
        return Err("Cannot record payment for draft or cancelled invoices".to_string());
    }

    let new_amount_paid = invoice.2 + amount;
    let new_balance = invoice.1 - new_amount_paid;

    if new_balance < 0 {
        return Err(format!(
            "Payment ({}) exceeds balance due ({}). Overpayment not allowed.",
            amount,
            invoice.1 - invoice.2
        ));
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
             payment_date, reference, notes, received_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment_id)
    .bind(&invoice_id)
    .bind(company_id)
    .bind(amount)
    .bind(&payment_method)
    .bind(&payment_date)
    .bind(clean_optional(&reference))
    .bind(clean_optional(&notes))
    .bind(&current_user.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Payment record error: {e}"))?;

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
    .map_err(|e| format!("Invoice update error: {e}"))?;

    // Double-entry: Dr Cash / Cr Accounts Receivable.
    let invoice_number =
        sqlx::query_scalar::<_, String>("SELECT invoice_number FROM invoices WHERE id = ?")
            .bind(&invoice_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Invoice lookup error: {e}"))?;

    crate::commands::ledger::post_payment_collection(
        &mut tx,
        company_id,
        &payment_id,
        &payment_date,
        &invoice_number,
        amount,
        &current_user.id,
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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

    Ok(updated)
}

/// Gets or updates invoice settings for the company
#[tauri::command]
pub async fn get_invoice_settings(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<InvoiceSettings, String> {
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
) -> Result<InvoiceSettings, String> {
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
    .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<(), String> {
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
    .map_err(|e| format!("Totals calculation error: {e}"))?;

    let subtotal = totals.0;
    let tax_total = totals.1;
    let discount_total = totals.2;
    let grand_total = round_to_rupee(subtotal - discount_total + tax_total);

    sqlx::query(
        r#"
        UPDATE invoices
        SET subtotal = ?, tax_total = ?, discount_total = ?,
            grand_total = ?, balance_due = grand_total - amount_paid,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(subtotal)
    .bind(tax_total)
    .bind(discount_total)
    .bind(grand_total)
    .bind(invoice_id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Invoice update error: {e}"))?;

    Ok(())
}

// ==========================================
// INVOICE RENDERING (HTML / EXCEL / PDF)
// ==========================================
//
// A single InvoiceDoc loader feeds three output paths:
//   - generate_invoice_html  → design-aware HTML, opened in the browser
//   - generate_invoice_pdf   → native PDF via the built-in generator
//   - generate_invoice_excel → fills a user-uploaded .xlsx template
//
// Placeholders are written as {{token}} and are shared across the HTML
// template and Excel templates. Item rows use items_<n>_<field>.

/// Formats a paisa amount as a two-decimal string (paisa / 100).
fn fmt_paisa(paisa: i64) -> String {
    format!("{:.2}", paisa as f64 / 100.0)
}

/// Escapes a value for safe insertion into HTML or XML text.
fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Replaces `{{token}}` placeholders in a template using values from `map`.
/// Unknown tokens are left untouched; missing known tokens become empty.
fn fill_template(template: &str, map: &HashMap<String, String>) -> String {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    let mut out = template.to_string();
    for k in keys {
        out = out.replace(&format!("{{{{{k}}}}}"), &map[k]);
    }
    out
}

/// All data required to render an invoice to any output format.
pub struct InvoiceDoc {
    pub invoice: PublicInvoice,
    pub customer: PublicCustomer,
    pub items: Vec<PublicInvoiceItem>,
    pub payments: Vec<PublicPayment>,
    pub company_name: String,
    pub company_email: Option<String>,
    pub company_phone: Option<String>,
    pub company_address: Option<String>,
    pub currency: String,
    pub settings: InvoiceSettings,
    pub logo_base64: Option<String>,
    pub company_tagline: Option<String>,
}

/// Loads every piece of data an invoice renderer needs, scoped to the
/// authenticated user's company.
pub async fn load_invoice_doc(
    pool: &SqlitePool,
    invoice_id: &str,
    company_id: &str,
) -> Result<InvoiceDoc, String> {
    let invoice = sqlx::query_as::<_, PublicInvoice>(
        "SELECT * FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(invoice_id)
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&invoice.customer_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Customer error: {e}"))?;

    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Items error: {e}"))?;

    let payments = sqlx::query_as::<_, PublicPayment>(
        "SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY payment_date",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Payments error: {e}"))?;

    let company =
        sqlx::query_as::<
            _,
            (
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                String,
            ),
        >("SELECT name, email, phone, address, currency_code FROM companies WHERE id = ?")
        .bind(company_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Company error: {e}"))?;

    let settings = get_or_create_settings(pool, company_id).await?;

    let (logo_base64, company_tagline) =
        sqlx::query_as::<_, (Option<String>, Option<String>)>(
            "SELECT logo_base64, company_tagline FROM company_theme WHERE company_id = ?",
        )
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Theme error: {e}"))?
        .unwrap_or((None, None));

    Ok(InvoiceDoc {
        invoice,
        customer,
        items,
        payments,
        company_name: company.0,
        company_email: company.1,
        company_phone: company.2,
        company_address: company.3,
        currency: company.4,
        settings,
        logo_base64,
        company_tagline,
    })
}

/// Builds the key/value map shared by the HTML renderer, Excel template
/// filler and (indirectly) the PDF renderer.
pub fn invoice_placeholder_values(doc: &InvoiceDoc) -> HashMap<String, String> {
    let i = &doc.invoice;
    let c = &doc.customer;
    let s = &doc.settings;

    let mut m = HashMap::new();
    m.insert("company_name".to_string(), doc.company_name.clone());
    m.insert(
        "company_address".to_string(),
        doc.company_address.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_phone".to_string(),
        doc.company_phone.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_email".to_string(),
        doc.company_email.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_tagline".to_string(),
        doc.company_tagline.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_ntn".to_string(),
        s.company_ntn.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_strn".to_string(),
        s.company_strn.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "company_cnic".to_string(),
        s.company_cnic.as_deref().unwrap_or("").to_string(),
    );
    m.insert("invoice_number".to_string(), i.invoice_number.clone());
    m.insert("invoice_date".to_string(), i.invoice_date.clone());
    m.insert(
        "due_date".to_string(),
        i.due_date.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "po_number".to_string(),
        i.po_number.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "reference_note".to_string(),
        i.reference_note.as_deref().unwrap_or("").to_string(),
    );
    m.insert("status".to_string(), i.status.clone());
    m.insert("customer_name".to_string(), c.name.clone());
    m.insert(
        "customer_address".to_string(),
        c.address.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "customer_phone".to_string(),
        c.phone.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "customer_email".to_string(),
        c.email.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "customer_cnic".to_string(),
        c.cnic.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "customer_ntn".to_string(),
        c.ntn.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "customer_strn".to_string(),
        c.strn.as_deref().unwrap_or("").to_string(),
    );
    m.insert("buyer_type".to_string(), c.buyer_type.clone());
    m.insert("subtotal".to_string(), fmt_paisa(i.subtotal));
    m.insert("discount_total".to_string(), fmt_paisa(i.discount_total));
    m.insert("tax_total".to_string(), fmt_paisa(i.tax_total));
    m.insert("grand_total".to_string(), fmt_paisa(i.grand_total));
    m.insert("amount_paid".to_string(), fmt_paisa(i.amount_paid));
    m.insert("balance_due".to_string(), fmt_paisa(i.balance_due));
    m.insert("currency".to_string(), doc.currency.clone());
    m.insert(
        "generated_at".to_string(),
        chrono::Utc::now().format("%Y-%m-%d %H:%M").to_string(),
    );
    m.insert(
        "invoice_footer".to_string(),
        s.invoice_footer
            .as_deref()
            .unwrap_or("Thank you for your business!")
            .to_string(),
    );
    m.insert(
        "terms_conditions".to_string(),
        s.terms_conditions.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "disclaimer".to_string(),
        s.disclaimer.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "copyright".to_string(),
        s.copyright.as_deref().unwrap_or("").to_string(),
    );
    m.insert(
        "bank_details".to_string(),
        s.bank_details.as_deref().unwrap_or("").to_string(),
    );

    for (idx, item) in doc.items.iter().enumerate() {
        let n = idx + 1;
        m.insert(format!("items_{n}_name"), item.product_name.clone());
        m.insert(format!("items_{n}_sku"), item.product_sku.clone());
        m.insert(format!("items_{n}_qty"), item.quantity.to_string());
        m.insert(format!("items_{n}_price"), fmt_paisa(item.unit_price));
        m.insert(format!("items_{n}_tax_rate"), item.tax_rate.to_string());
        m.insert(
            format!("items_{n}_tax_amount"),
            if item.tax_amount > 0 {
                fmt_paisa(item.tax_amount)
            } else {
                String::new()
            },
        );
        m.insert(
            format!("items_{n}_discount"),
            if item.discount_amount > 0 {
                format!("-{}", fmt_paisa(item.discount_amount))
            } else {
                String::new()
            },
        );
        m.insert(format!("items_{n}_line_total"), fmt_paisa(item.line_total));
    }

    m
}

/// Renders a full, standalone HTML document for an invoice using the
/// company's configured design (classic / modern / minimal) and accent color.
fn build_invoice_html(doc: &InvoiceDoc) -> String {
    let mut vals = invoice_placeholder_values(doc);

    let design = if doc.settings.invoice_design.is_empty() {
        "classic".to_string()
    } else {
        doc.settings.invoice_design.clone()
    };
    let accent = if doc.settings.design_accent_color.is_empty() {
        "#1d2b54".to_string()
    } else {
        doc.settings.design_accent_color.clone()
    };
    vals.insert("accent".to_string(), accent.clone());
    vals.insert("design".to_string(), design.clone());

    // Logo (if the company uploaded one).
    let logo_html = doc
        .logo_base64
        .as_deref()
        .map(|b| {
            let (mime, data) = if b.starts_with("data:image/") {
                let (m, d) = b.split_once(',').unwrap_or(("", b));
                (m.to_string(), d.to_string())
            } else {
                ("data:image/png;base64".to_string(), b.to_string())
            };
            format!(
                r#"<img class="logo" src="{mime},{data}" alt="logo">"#,
                mime = html_escape(&mime),
                data = html_escape(&data)
            )
        })
        .unwrap_or_default();
    vals.insert("logo_html".to_string(), logo_html);

    // FBR verification section (QR shown only when enabled AND tax info set).
    let mut fbr_section = String::new();
    let show_fbr = doc.settings.show_qr
        && (doc.settings.company_ntn.is_some() || doc.settings.company_strn.is_some());
    if show_fbr {
        let fbr_payload = serde_json::json!({
            "InvoiceNo": doc.invoice.invoice_number,
            "Date": doc.invoice.invoice_date,
            "Total": fmt_paisa(doc.invoice.grand_total),
            "Tax": fmt_paisa(doc.invoice.tax_total),
            "Type": "INVOICE",
        });
        let qr_svg = qr_svg(&serde_json::to_string(&fbr_payload).unwrap_or_default(), 100);
        if !qr_svg.is_empty() {
            fbr_section.push_str(
                r#"<div class="fbr-box"><div class="fbr-info"><strong>FBR Tax Information</strong><br>"#,
            );
            if let Some(ref ntn) = doc.settings.company_ntn {
                fbr_section.push_str(&format!("Company NTN: {}<br>", html_escape(ntn)));
            }
            if let Some(ref strn) = doc.settings.company_strn {
                fbr_section.push_str(&format!("STRN: {}<br>", html_escape(strn)));
            }
            fbr_section.push_str(&format!(
                "Buyer Type: {}<br>",
                html_escape(&doc.customer.buyer_type)
            ));
            if let Some(ref c) = doc.customer.ntn {
                fbr_section.push_str(&format!("Buyer NTN: {}<br>", html_escape(c)));
            }
            if let Some(ref c) = doc.customer.cnic {
                fbr_section.push_str(&format!("Buyer CNIC: {}<br>", html_escape(c)));
            }
            fbr_section.push_str("</div>");
            fbr_section.push_str(&format!(
                r#"<div class="fbr-qr">{qr_svg}<div>Verify with FBR</div></div>"#
            ));
            fbr_section.push_str("</div>");
        }
    }
    vals.insert("fbr_section".to_string(), fbr_section);

    // Items table.
    let mut items_html = String::new();
    for (idx, item) in doc.items.iter().enumerate() {
        items_html.push_str(&format!(
            r#"<tr>
                <td class="num">{}</td>
                <td><strong>{}</strong><br><small>SKU: {}</small></td>
                <td class="num">{}</td>
                <td class="num">{}</td>
                <td class="num">{}%</td>
                <td class="num">{}</td>
                <td class="num">{}</td>
                <td class="num"><strong>{}</strong></td>
            </tr>"#,
            idx + 1,
            html_escape(&item.product_name),
            html_escape(&item.product_sku),
            item.quantity,
            fmt_paisa(item.unit_price),
            item.tax_rate / 100,
            if item.tax_amount > 0 {
                fmt_paisa(item.tax_amount)
            } else {
                "—".to_string()
            },
            if item.discount_amount > 0 {
                format!("-{}", fmt_paisa(item.discount_amount))
            } else {
                "—".to_string()
            },
            fmt_paisa(item.line_total),
        ));
    }
    vals.insert("items_html".to_string(), items_html);

    // Payments history.
    let mut payments_html = String::new();
    if !doc.payments.is_empty() {
        payments_html.push_str(
            r#"<h3 class="section-title">Payment History</h3><table class="payments">
                <tr><th>Date</th><th>Method</th><th class="num">Amount</th><th>Reference</th></tr>"#,
        );
        for p in &doc.payments {
            payments_html.push_str(&format!(
                r#"<tr><td>{}</td><td>{}</td><td class="num">{}</td><td>{}</td></tr>"#,
                html_escape(&p.payment_date),
                html_escape(&p.payment_method),
                fmt_paisa(p.amount),
                html_escape(p.reference.as_deref().unwrap_or("—")),
            ));
        }
        payments_html.push_str("</table>");
    }
    vals.insert("payments_html".to_string(), payments_html);

    // Optional blocks.
    let discount_row = if doc.invoice.discount_total > 0 {
        format!(
            r#"<div class="totals-row"><span>Discount:</span><span>-{}</span></div>"#,
            fmt_paisa(doc.invoice.discount_total)
        )
    } else {
        String::new()
    };
    let tax_row = if doc.invoice.tax_total > 0 {
        format!(
            r#"<div class="totals-row"><span>Tax:</span><span>{}</span></div>"#,
            fmt_paisa(doc.invoice.tax_total)
        )
    } else {
        String::new()
    };
    let paid_row = if doc.invoice.amount_paid > 0 {
        format!(
            r#"<div class="totals-row"><span>Amount Paid:</span><span>{}</span></div>"#,
            fmt_paisa(doc.invoice.amount_paid)
        )
    } else {
        String::new()
    };
    let balance_row = if doc.invoice.balance_due > 0 {
        format!(
            r#"<div class="totals-row balance"><span>Balance Due:</span><span>{}</span></div>"#,
            fmt_paisa(doc.invoice.balance_due)
        )
    } else {
        String::new()
    };
    let terms_html = doc
        .settings
        .terms_conditions
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .map(|t| {
            format!(
                r#"<h3 class="section-title">Terms &amp; Conditions</h3><p class="terms">{}</p>"#,
                html_escape(t)
            )
        })
        .unwrap_or_default();
    let bank_html = doc
        .settings
        .bank_details
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!(r#"<div class="footer-line">{}</div>"#, html_escape(t)))
        .unwrap_or_default();
    let disclaimer_html = doc
        .settings
        .disclaimer
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!(r#"<div class="footer-line">{}</div>"#, html_escape(t)))
        .unwrap_or_default();
    let copyright_html = doc
        .settings
        .copyright
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!(r#"<div class="footer-line">{}</div>"#, html_escape(t)))
        .unwrap_or_default();

    vals.insert("discount_row".to_string(), discount_row);
    vals.insert("tax_row".to_string(), tax_row);
    vals.insert("paid_row".to_string(), paid_row);
    vals.insert("balance_row".to_string(), balance_row);
    vals.insert("terms_html".to_string(), terms_html);
    vals.insert("bank_html".to_string(), bank_html);
    vals.insert("disclaimer_html".to_string(), disclaimer_html);
    vals.insert("copyright_html".to_string(), copyright_html);

    let status_color = match doc.invoice.status.as_str() {
        "paid" => "#28a745",
        "finalized" => "#007bff",
        "cancelled" => "#dc3545",
        _ => "#ffc107",
    };
    let status_display = match doc.invoice.status.as_str() {
        "draft" => "Draft",
        "finalized" => "Finalized",
        "paid" => "Paid",
        "cancelled" => "Cancelled",
        other => other,
    };
    let status_html = format!(
        r#"<span class="status-badge" style="background:{status_color}">{status_display}</span>"#
    );
    vals.insert("status_html".to_string(), status_html);

    vals.insert("amount_paid_display".to_string(), fmt_paisa(doc.invoice.amount_paid));
    vals.insert("balance_due_display".to_string(), fmt_paisa(doc.invoice.balance_due));

    let template = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Invoice {{invoice_number}}</title>
    <style>
        :root { --accent: {{accent}}; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            color: #333;
            background: #f1f3f5;
        }
        .print-bar {
            position: sticky; top: 0; z-index: 50;
            background: var(--accent); color: #fff;
            display: flex; justify-content: center; gap: 10px; padding: 10px;
        }
        .print-bar button {
            font: inherit; border: 1px solid rgba(255,255,255,.6);
            background: rgba(255,255,255,.12); color: #fff;
            padding: 6px 18px; border-radius: 4px; cursor: pointer;
        }
        .print-bar button:hover { background: rgba(255,255,255,.25); }
        .sheet {
            background: #fff;
            max-width: 800px;
            margin: 16px auto;
            padding: 28px 32px;
            border-radius: 6px;
        }
        .inv-header {
            display: flex; justify-content: space-between; align-items: flex-start;
            gap: 20px; padding-bottom: 16px; margin-bottom: 18px;
        }
        .brand .logo { max-width: 140px; max-height: 60px; object-fit: contain; margin-bottom: 6px; display: block; }
        .company-name { font-size: 24px; font-weight: 700; }
        .tagline { font-size: 11px; color: #888; margin-bottom: 4px; }
        .invoice-title { font-size: 28px; font-weight: 700; text-align: right; }
        .invoice-meta { text-align: right; font-size: 11px; color: #666; }
        .status-badge { display: inline-block; margin-top: 5px; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 10px; }
        .fbr-box {
            display: flex; justify-content: space-between; align-items: center; gap: 14px;
            background: #fff8e1; border: 1px solid #f0c93f;
            padding: 10px 12px; margin-bottom: 18px; border-radius: 4px;
        }
        .fbr-box .fbr-qr { text-align: center; font-size: 9px; color: #8a7a2a; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
        .info-box { border: 1px solid #ddd; padding: 12px; border-radius: 4px; }
        .info-box h3 { font-size: 11px; text-transform: uppercase; color: #999; margin-bottom: 6px; }
        table.items { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        table.items th { background: var(--accent); color: #fff; padding: 9px 8px; text-align: left; font-size: 11px; }
        table.items td { padding: 8px; border-bottom: 1px solid #eee; }
        table.items tr:nth-child(even) { background: #f9f9f9; }
        .num { text-align: right; }
        .totals { display: flex; justify-content: flex-end; margin-bottom: 18px; }
        .totals-box { width: 300px; }
        .totals-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
        .totals-row.grand { border-top: 2px solid #333; border-bottom: none; font-size: 16px; font-weight: 700; color: var(--accent); }
        .totals-row.balance { font-weight: 700; color: #dc3545; }
        .section-title { font-size: 13px; margin: 14px 0 6px; }
        table.payments { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        table.payments th { background: #f5f5f5; text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
        table.payments td { padding: 6px 8px; border: 1px solid #ddd; }
        .terms { font-size: 11px; color: #555; white-space: pre-wrap; }
        .inv-footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
        .inv-footer .footer-line { margin-top: 4px; }

        /* design: modern */
        body.modern { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body.modern .sheet { padding: 0; overflow: hidden; border-radius: 8px; }
        body.modern .inv-header { background: var(--accent); color: #fff; padding: 24px 32px; margin: 0; align-items: center; }
        body.modern .company-name { color: #fff; }
        body.modern .tagline { color: rgba(255,255,255,.8); }
        body.modern .invoice-title { color: #fff; }
        body.modern .invoice-meta { color: rgba(255,255,255,.85); }
        body.modern .status-badge { background: rgba(255,255,255,.2) !important; border: 1px solid rgba(255,255,255,.6); }
        body.modern .inv-body { padding: 24px 32px; }
        body.modern table.items th { background: var(--accent); }
        body.modern .info-box { border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

        /* design: minimal */
        body.minimal .sheet { box-shadow: none; border: 1px solid #eee; border-radius: 0; }
        body.minimal .inv-header { border-bottom: 1px solid #e5e5e5; }
        body.minimal .company-name { color: #222; font-size: 22px; }
        body.minimal .invoice-title { color: #222; }
        body.minimal table.items th { background: transparent; color: #333; border-bottom: 2px solid #ccc; }
        body.minimal .info-box { border: none; border-bottom: 1px solid #eee; border-radius: 0; padding: 8px 2px; }
        body.minimal .totals-row.grand { color: #222; border-top: 1px solid #222; }
        body.minimal .status-badge { background: #333 !important; }

        @media print {
            body { background: #fff; padding: 0; }
            .sheet { margin: 0; border-radius: 0; box-shadow: none; }
            .no-print, .print-bar { display: none !important; }
        }
    </style>
</head>
<body class="{{design}}">
    <div class="print-bar no-print">
        <button onclick="window.print()">Print / Save PDF</button>
        <button onclick="window.close()">Close</button>
    </div>
    <div class="sheet">
        <div class="inv-header">
            <div class="brand">
                {{logo_html}}
                <div class="company-name">{{company_name}}</div>
                <div class="tagline">{{company_tagline}}</div>
                <div>{{company_address}}</div>
                <div>{{company_phone}}</div>
                <div>{{company_email}}</div>
            </div>
            <div>
                <div class="invoice-title">INVOICE</div>
                <div class="invoice-meta">
                    <div><strong>{{invoice_number}}</strong></div>
                    <div>Date: {{invoice_date}}</div>
                    <div>Due: {{due_date}}</div>
                    <div>PO: {{po_number}}</div>
                    {{status_html}}
                </div>
            </div>
        </div>

        {{fbr_section}}

        <div class="parties">
            <div class="info-box">
                <h3>Bill To</h3>
                <strong>{{customer_name}}</strong><br>
                <div>{{customer_address}}</div>
                <div>{{customer_phone}}</div>
                <div>{{customer_email}}</div>
            </div>
            <div class="info-box">
                <h3>Payment</h3>
                <div>Amount Paid: <strong>{{amount_paid_display}}</strong></div>
                <div>Balance Due: <strong>{{balance_due_display}}</strong></div>
                {{status_html}}
            </div>
        </div>

        <table class="items">
            <thead>
                <tr>
                    <th class="num">#</th>
                    <th>Product</th>
                    <th class="num">Qty</th>
                    <th class="num">Unit Price</th>
                    <th class="num">Tax</th>
                    <th class="num">Tax Amt</th>
                    <th class="num">Discount</th>
                    <th class="num">Total</th>
                </tr>
            </thead>
            <tbody>
                {{items_html}}
            </tbody>
        </table>

        <div class="totals">
            <div class="totals-box">
                <div class="totals-row"><span>Subtotal:</span><span>{{currency}} {{subtotal}}</span></div>
                {{discount_row}}
                {{tax_row}}
                {{paid_row}}
                {{balance_row}}
                <div class="totals-row grand"><span>Grand Total:</span><span>{{currency}} {{grand_total}}</span></div>
            </div>
        </div>

        {{payments_html}}

        <div class="terms-block">{{terms_html}}</div>

        <footer class="inv-footer">
            <div>{{invoice_footer}}</div>
            {{bank_html}}
            {{disclaimer_html}}
            {{copyright_html}}
            <div class="footer-line">Generated by Ijaz &amp; Company ERP — {{generated_at}}</div>
        </footer>
    </div>
</body>
</html>"#;

    fill_template(template, &vals)
}

/// Generates a design-aware HTML invoice and opens it in the default
/// browser. Returns the saved file path.
#[tauri::command]
pub async fn generate_invoice_html(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    app_handle: tauri::AppHandle,
    invoice_id: String,
) -> Result<String, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let doc = load_invoice_doc(pool.inner(), &invoice_id, company_id).await?;
    let html = build_invoice_html(&doc);

    let temp_dir = std::env::temp_dir();
    let filename = format!("invoice_{}.html", doc.invoice.invoice_number.replace('/', "_"));
    let file_path = temp_dir.join(&filename);
    std::fs::write(&file_path, &html).map_err(|e| format!("Failed to write HTML: {e}"))?;

    let path_str = file_path.to_string_lossy().to_string();
    open_with_default(&app_handle, &path_str, "invoice");

    Ok(path_str)
}

/// Opens a file in the system default application.
fn open_with_default(app: &tauri::AppHandle, path: &str, what: &str) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().open_path(path, None::<&str>) {
        eprintln!("Failed to open {what}: {e}");
    }
}

// ==========================================
// EXCEL TEMPLATE + PDF INVOICE COMMANDS
// ==========================================

/// All single-value placeholder tokens recognised by the template analyzer.
const CORE_PLACEHOLDERS: [&str; 35] = [
    "company_name",
    "company_address",
    "company_phone",
    "company_email",
    "company_tagline",
    "company_ntn",
    "company_strn",
    "company_cnic",
    "invoice_number",
    "invoice_date",
    "due_date",
    "po_number",
    "reference_note",
    "status",
    "customer_name",
    "customer_address",
    "customer_phone",
    "customer_email",
    "customer_cnic",
    "customer_ntn",
    "customer_strn",
    "buyer_type",
    "subtotal",
    "discount_total",
    "tax_total",
    "grand_total",
    "amount_paid",
    "balance_due",
    "currency",
    "generated_at",
    "invoice_footer",
    "terms_conditions",
    "disclaimer",
    "copyright",
    "bank_details",
];

const ITEM_FIELDS: [&str; 8] = [
    "name",
    "sku",
    "qty",
    "price",
    "tax_rate",
    "tax_amount",
    "discount",
    "line_total",
];

/// Recommended tokens a template should include.
const COMMON_PLACEHOLDERS: [&str; 8] = [
    "company_name",
    "customer_name",
    "invoice_number",
    "invoice_date",
    "subtotal",
    "tax_total",
    "grand_total",
    "status",
];

fn is_known_placeholder(tok: &str) -> bool {
    if CORE_PLACEHOLDERS.contains(&tok) {
        return true;
    }
    if let Some(rest) = tok.strip_prefix("items_") {
        if let Some((n, field)) = rest.split_once('_') {
            return n.chars().all(|c| c.is_ascii_digit()) && ITEM_FIELDS.contains(&field);
        }
    }
    false
}

fn extract_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(end) = text[i + 2..].find("}}") {
                let inner = &text[i + 2..i + 2 + end];
                let trimmed = inner.trim();
                if !trimmed.is_empty()
                    && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    tokens.push(trimmed.to_string());
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    tokens
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelTemplateAnalysis {
    pub has_template: bool,
    pub known_tokens: Vec<String>,
    pub unknown_tokens: Vec<String>,
    pub missing_common_tokens: Vec<String>,
}

/// Reads a template .xlsx, replaces every `{{token}}` placeholder inside
/// the XML parts and returns the filled file bytes.
fn fill_excel_template(template_bytes: &[u8], map: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    use std::io::{Cursor, Read, Write};

    let mut archive = zip::ZipArchive::new(Cursor::new(template_bytes.to_vec()))
        .map_err(|e| format!("Template is not a valid Excel file: {e}"))?;

    let mut out_zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Template read error: {e}"))?;
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Template read error: {e}"))?;

        let is_text = name.ends_with(".xml") || name.ends_with(".txt") || name.ends_with(".rels");
        let content = if is_text {
            let text = String::from_utf8_lossy(&bytes);
            fill_template(&text, map).into_bytes()
        } else {
            bytes
        };
        entries.push((name, content));
    }

    for (name, content) in &entries {
        out_zip
            .start_file(name.clone(), options)
            .map_err(|e| format!("Template write error: {e}"))?;
        out_zip
            .write_all(content)
            .map_err(|e| format!("Template write error: {e}"))?;
    }
    let writer = out_zip.finish().map_err(|e| format!("Template write error: {e}"))?;
    Ok(writer.into_inner())
}

/// Saves a base64-encoded Excel invoice template for the current company.
#[tauri::command]
pub async fn save_invoice_excel_template(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    template_base64: String,
) -> Result<InvoiceSettings, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate that the upload is really a base64 zip file before persisting.
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let bytes = BASE64
        .decode(&template_base64)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    if zip::ZipArchive::new(std::io::Cursor::new(bytes)).is_err() {
        return Err("Uploaded file is not a valid Excel (.xlsx) template".to_string());
    }

    sqlx::query(
        "UPDATE company_invoice_settings SET excel_template_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
    )
    .bind(&template_base64)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Failed to save template: {e}"))?;

    get_or_create_settings(pool.inner(), company_id).await
}

/// Analyses the stored Excel template and reports which placeholders it
/// recognises, which are unknown, and which recommended ones are missing.
#[tauri::command]
pub async fn analyze_invoice_excel_template(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<ExcelTemplateAnalysis, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let settings = get_or_create_settings(pool.inner(), company_id).await?;

    let missing_common_tokens: Vec<String> = COMMON_PLACEHOLDERS
        .iter()
        .map(|s| s.to_string())
        .collect();

    let Some(template) = settings.excel_template_base64.as_deref() else {
        return Ok(ExcelTemplateAnalysis {
            has_template: false,
            known_tokens: Vec::new(),
            unknown_tokens: Vec::new(),
            missing_common_tokens,
        });
    };

    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let bytes = BASE64
        .decode(template)
        .map_err(|e| format!("Template decode error: {e}"))?;

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Stored template is not a valid Excel file: {e}"))?;

    let mut found = std::collections::BTreeSet::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Template read error: {e}"))?;
        if entry.name().ends_with(".xml") {
            let mut text = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut text)
                .map_err(|e| format!("Template read error: {e}"))?;
            for t in extract_tokens(&text) {
                found.insert(t);
            }
        }
    }

    let mut known_tokens = Vec::new();
    let mut unknown_tokens = Vec::new();
    for t in &found {
        if is_known_placeholder(t) {
            known_tokens.push(t.clone());
        } else {
            unknown_tokens.push(t.clone());
        }
    }

    let mut missing = Vec::new();
    for c in COMMON_PLACEHOLDERS {
        if !found.contains(c) {
            missing.push(c.to_string());
        }
    }

    Ok(ExcelTemplateAnalysis {
        has_template: true,
        known_tokens,
        unknown_tokens,
        missing_common_tokens: missing,
    })
}

/// Fills the company's Excel template with invoice data.
/// When `save_path` is provided the filled .xlsx is written there and the
/// path is returned; otherwise the file is returned as base64.
#[tauri::command]
pub async fn generate_invoice_excel(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    save_path: Option<String>,
) -> Result<String, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let doc = load_invoice_doc(pool.inner(), &invoice_id, company_id).await?;

    let template = doc
        .settings
        .excel_template_base64
        .as_deref()
        .ok_or("No Excel template uploaded. Add one in Settings → Invoice Settings.")?;

    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let template_bytes = BASE64
        .decode(template)
        .map_err(|e| format!("Template decode error: {e}"))?;

    let map = invoice_placeholder_values(&doc);
    let filled = fill_excel_template(&template_bytes, &map)?;

    if let Some(path) = save_path {
        std::fs::write(&path, &filled).map_err(|e| format!("Failed to write Excel: {e}"))?;
        Ok(path)
    } else {
        Ok(BASE64.encode(filled))
    }
}

/// Renders an invoice to a real PDF file. When `save_path` is provided the
/// PDF is written there and returned without auto-opening; otherwise it is
/// written to a temp file and opened in the system viewer.
#[tauri::command]
pub async fn generate_invoice_pdf(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    app_handle: tauri::AppHandle,
    invoice_id: String,
    save_path: Option<String>,
) -> Result<String, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let doc = load_invoice_doc(pool.inner(), &invoice_id, company_id).await?;

    let mut pdf = crate::pdf::PdfDoc::new(
        &doc.invoice.invoice_number,
        &doc.company_name,
        doc.company_tagline.as_deref().unwrap_or(""),
    );

    pdf.add_title(&format!("INVOICE {}", doc.invoice.invoice_number));
    pdf.add_text(
        &format!(
            "Date: {}    Due: {}",
            doc.invoice.invoice_date,
            doc.invoice.due_date.as_deref().unwrap_or("—")
        ),
        10.0,
        false,
    );
    pdf.add_text(
        &format!("Status: {}", doc.invoice.status.to_uppercase()),
        10.0,
        false,
    );
    pdf.add_blank();
    pdf.add_text(&format!("Bill To: {}", doc.customer.name), 11.0, true);
    if let Some(a) = &doc.customer.address {
        pdf.add_text(a, 10.0, false);
    }
    if let Some(p) = &doc.customer.phone {
        pdf.add_text(&format!("Phone: {p}"), 10.0, false);
    }
    pdf.add_blank();

    let columns = vec![
        crate::pdf::PdfColumn { header: "#".to_string(), width: 0.6 },
        crate::pdf::PdfColumn { header: "Product".to_string(), width: 3.6 },
        crate::pdf::PdfColumn { header: "Qty".to_string(), width: 1.0 },
        crate::pdf::PdfColumn { header: "Unit Price".to_string(), width: 1.6 },
        crate::pdf::PdfColumn { header: "Tax".to_string(), width: 1.4 },
        crate::pdf::PdfColumn { header: "Line Total".to_string(), width: 1.8 },
    ];
    let rows: Vec<Vec<String>> = doc
        .items
        .iter()
        .enumerate()
        .map(|(idx, item)| {
            vec![
                (idx + 1).to_string(),
                item.product_name.clone(),
                item.quantity.to_string(),
                fmt_paisa(item.unit_price),
                if item.tax_amount > 0 {
                    fmt_paisa(item.tax_amount)
                } else {
                    "—".to_string()
                },
                fmt_paisa(item.line_total),
            ]
        })
        .collect();
    pdf.add_table(&columns, &rows);

    pdf.add_text(
        &format!("Subtotal: {} {}", doc.currency, fmt_paisa(doc.invoice.subtotal)),
        10.0,
        false,
    );
    if doc.invoice.discount_total > 0 {
        pdf.add_text(
            &format!(
                "Discount: -{} {}",
                doc.currency,
                fmt_paisa(doc.invoice.discount_total)
            ),
            10.0,
            false,
        );
    }
    if doc.invoice.tax_total > 0 {
        pdf.add_text(
            &format!("Tax: {} {}", doc.currency, fmt_paisa(doc.invoice.tax_total)),
            10.0,
            false,
        );
    }
    pdf.add_text(
        &format!(
            "GRAND TOTAL: {} {}",
            doc.currency,
            fmt_paisa(doc.invoice.grand_total)
        ),
        12.0,
        true,
    );
    if doc.invoice.amount_paid > 0 {
        pdf.add_text(
            &format!(
                "Amount Paid: {} {}",
                doc.currency,
                fmt_paisa(doc.invoice.amount_paid)
            ),
            10.0,
            false,
        );
    }
    if doc.invoice.balance_due > 0 {
        pdf.add_text(
            &format!(
                "Balance Due: {} {}",
                doc.currency,
                fmt_paisa(doc.invoice.balance_due)
            ),
            10.0,
            true,
        );
    }

    if !doc.payments.is_empty() {
        pdf.add_blank();
        let pcols = vec![
            crate::pdf::PdfColumn { header: "Date".to_string(), width: 2.2 },
            crate::pdf::PdfColumn { header: "Method".to_string(), width: 2.2 },
            crate::pdf::PdfColumn { header: "Amount".to_string(), width: 1.8 },
            crate::pdf::PdfColumn { header: "Reference".to_string(), width: 2.8 },
        ];
        let prows: Vec<Vec<String>> = doc
            .payments
            .iter()
            .map(|p| {
                vec![
                    p.payment_date.clone(),
                    p.payment_method.clone(),
                    fmt_paisa(p.amount),
                    p.reference.clone().unwrap_or_else(|| "—".to_string()),
                ]
            })
            .collect();
        pdf.add_table(&pcols, &prows);
    }

    if let Some(t) = &doc.settings.terms_conditions {
        if !t.trim().is_empty() {
            pdf.add_blank();
            pdf.add_text("Terms & Conditions", 10.0, true);
            pdf.add_text(t, 9.0, false);
        }
    }
    if let Some(f) = &doc.settings.invoice_footer {
        if !f.trim().is_empty() {
            pdf.add_blank();
            pdf.add_text(f, 9.0, false);
        }
    }

    let bytes = pdf.finish();

    if let Some(path) = save_path {
        std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write PDF: {e}"))?;
        return Ok(path);
    }

    let temp_dir = std::env::temp_dir();
    let filename = format!("invoice_{}.pdf", doc.invoice.invoice_number.replace('/', "_"));
    let file_path = temp_dir.join(&filename);
    std::fs::write(&file_path, &bytes).map_err(|e| format!("Failed to write PDF: {e}"))?;

    let path_str = file_path.to_string_lossy().to_string();
    open_with_default(&app_handle, &path_str, "PDF");

    Ok(path_str)
}


/// Renders a QR code payload as an inline SVG at least `size` pixels wide.
/// Returns an empty string if the payload cannot be encoded.
fn qr_svg(payload: &str, size: u32) -> String {
    match QrCode::new(payload.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(size, size)
            .quiet_zone(true)
            .build(),
        Err(_) => String::new(),
    }
}

/// Formats a Unix timestamp into a readable date string
#[cfg(test)]
fn format_timestamp(secs: u64) -> String {
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;

    // Days since epoch to Y-M-D (simplified)
    let mut y = 1970;
    let mut remaining_days = days;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }
    let leap = is_leap(y);
    let month_days = [
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
    let mut m = 0;
    for (i, &d) in month_days.iter().enumerate() {
        if remaining_days < d {
            m = i + 1;
            break;
        }
        remaining_days -= d;
    }
    let d = remaining_days + 1;
    format!("{:04}-{:02}-{:02} {:02}:{:02} UTC", y, m, d, hours, minutes)
}

#[cfg(test)]
fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Generates the next invoice number ATOMICALLY inside a transaction.
/// No two invoices can get the same number, even if created simultaneously.
async fn generate_invoice_number(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
) -> Result<String, String> {
    // Ensure settings row exists
    let exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("Settings check error: {e}"))?;

    if !exists {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_invoice_settings (id, company_id) VALUES (?, ?)")
            .bind(&id)
            .bind(company_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("Settings create error: {e}"))?;
    }

    // READ and INCREMENT in the SAME transaction (atomic)
    let (prefix, number): (String, i64) = sqlx::query_as(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("Settings read error: {e}"))?;

    // Increment immediately (within the same transaction)
    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?"
    )
    .bind(company_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Counter update error: {e}"))?;

    Ok(format!("{}-{:04}", prefix, number))
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

    /// Registers the owner and returns the app.
    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Creates a customer through the real command.
    async fn make_customer(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicCustomer {
        create_customer(
            app.state(),
            app.state(),
            name.to_string(),
            "cust@test.com".to_string(),
            "0300-111".to_string(),
            "Lahore".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create customer")
    }

    /// Creates a product with the given initial stock through the real command.
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
        stock: i64,
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
            stock,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    /// Creates a draft invoice for the given customer.
    async fn make_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
    ) -> PublicInvoice {
        create_invoice(
            app.state(),
            app.state(),
            customer_id.to_string(),
            "2026-01-15".to_string(),
            "2026-02-14".to_string(),
            "PO-1".to_string(),
            "note".to_string(),
        )
        .await
        .expect("create invoice")
    }

    /// Adds an item (qty, unit_price, tax) to a draft invoice.
    async fn add_item(
        app: &tauri::App<tauri::test::MockRuntime>,
        invoice_id: &str,
        product_id: &str,
        quantity: i64,
        unit_price: i64,
        tax_rate: i64,
    ) -> Vec<PublicInvoiceItem> {
        add_invoice_item(
            app.state(),
            app.state(),
            invoice_id.to_string(),
            product_id.to_string(),
            quantity,
            unit_price,
            tax_rate,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item")
    }

    /// Builds a finalized invoice with one item and returns (invoice, product).
    async fn finalized_invoice_with_stock(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> (PublicInvoice, crate::commands::inventory::PublicProduct) {
        let customer = make_customer(app, "Walk-in").await;
        let product = make_product(app, "Widget", 10).await;
        let invoice = make_invoice(app, &customer.id).await;
        add_item(app, &invoice.id, &product.id, 2, 1000, 0).await;
        let finalized = finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize");
        (finalized, product)
    }

    // ---------------------------------------------------------------
    // clean_optional (pure)
    // ---------------------------------------------------------------

    #[test]
    fn clean_optional_blank_is_none() {
        // Input: "".
        // Expected: None.
        assert_eq!(clean_optional(""), None);
    }

    // ---------------------------------------------------------------
    // qr_svg (pure)
    // ---------------------------------------------------------------

    #[test]
    fn qr_svg_renders_scalable_markup() {
        // Input: a short payload.
        // Expected: a non-empty SVG at least 100px wide with a viewBox.
        let svg = qr_svg("INV-0001:100.00", 100);
        assert!(svg.contains("<svg"), "got: {svg}");
        let width = svg
            .split(r#"width=""#)
            .nth(1)
            .and_then(|s| s.split('"').next())
            .and_then(|s| s.parse::<u32>().ok());
        assert!(width.is_some_and(|w| w >= 100), "got width: {width:?}");
        assert!(svg.contains("viewBox"), "got: {svg}");
    }

    #[test]
    fn qr_svg_handles_large_payload() {
        // Input: a payload larger than any QR version supports.
        // Expected: empty string, no panic.
        let huge = "x".repeat(10_000);
        assert_eq!(qr_svg(&huge, 100), "");
    }

    #[test]
    fn clean_optional_trims() {
        // Input: "  abc  ".
        // Expected: Some("abc").
        assert_eq!(clean_optional("  abc  "), Some("abc".to_string()));
    }

    // ---------------------------------------------------------------
    // round_to_rupee (pure)
    // ---------------------------------------------------------------

    #[test]
    fn round_down_when_rem_below_50() {
        // Input: 123 paisa.
        // Expected: 100.
        assert_eq!(round_to_rupee(123), 100);
    }

    #[test]
    fn round_up_when_rem_at_least_50() {
        // Input: 150 paisa.
        // Expected: 200.
        assert_eq!(round_to_rupee(150), 200);
    }

    #[test]
    fn round_handles_negative_with_euclid() {
        // Input: -140 paisa.
        // Expected: -100.
        assert_eq!(round_to_rupee(-140), -100);
    }

    // ---------------------------------------------------------------
    // compute_line_amounts (pure)
    // ---------------------------------------------------------------

    #[test]
    fn line_amounts_percent_discount() {
        // Input: qty 10, price 1000, tax 17%, percent discount 10%.
        // Expected: (discount_rate 1000, tax 1530, discount 1000, line_total 10500).
        assert_eq!(
            compute_line_amounts(10, 1000, 1700, "percent", 1000),
            (1000, 1530, 1000, 10500)
        );
    }

    #[test]
    fn line_amounts_fixed_amount_discount() {
        // Input: qty 2, price 5000, tax 0, amount discount 3000.
        // Expected: (0, 0, 3000, 7000).
        assert_eq!(
            compute_line_amounts(2, 5000, 0, "amount", 3000),
            (0, 0, 3000, 7000)
        );
    }

    #[test]
    fn line_amounts_clamps_amount_discount_to_subtotal() {
        // Input: amount discount bigger than the line subtotal.
        // Expected: discount capped at line subtotal, line_total 0.
        assert_eq!(
            compute_line_amounts(1, 1000, 0, "amount", 99999),
            (0, 0, 1000, 0)
        );
    }

    #[test]
    fn line_amounts_no_discount_no_tax() {
        // Input: qty 3, price 200, tax 0, no discount.
        // Expected: (0, 0, 0, 600).
        assert_eq!(
            compute_line_amounts(3, 200, 0, "percent", 0),
            (0, 0, 0, 600)
        );
    }

    // ---------------------------------------------------------------
    // format_timestamp / is_leap (pure)
    // ---------------------------------------------------------------

    #[test]
    fn timestamp_epoch_is_1970_epoch() {
        // Input: 0 seconds.
        // Expected: "1970-01-01 00:00 UTC".
        assert_eq!(format_timestamp(0), "1970-01-01 00:00 UTC");
    }

    #[test]
    fn is_leap_handles_century_rules() {
        // Inputs: 2000, 1900, 2024, 2023.
        // Expected: true, false, true, false.
        assert!(is_leap(2000));
        assert!(!is_leap(1900));
        assert!(is_leap(2024));
        assert!(!is_leap(2023));
    }

    // ---------------------------------------------------------------
    // invoice placeholder engine (pure)
    // ---------------------------------------------------------------

    #[test]
    fn fill_template_replaces_known_and_keeps_unknown() {
        // Input: template with one known and one unknown token.
        // Expected: known replaced, unknown untouched.
        let mut map = HashMap::new();
        map.insert("customer_name".to_string(), "Ali & Co".to_string());
        map.insert("grand_total".to_string(), "1,250.00".to_string());
        let out = fill_template(
            "Hi {{customer_name}} total {{grand_total}} {{unknown_token}}",
            &map,
        );
        assert_eq!(out, "Hi Ali & Co total 1,250.00 {{unknown_token}}");
    }

    #[test]
    fn fill_template_handles_longest_token_first() {
        // Input: a token that is a prefix of another.
        // Expected: longer token wins even when shorter one exists.
        let mut map = HashMap::new();
        map.insert("tax_total".to_string(), "100.00".to_string());
        map.insert("total".to_string(), "0.00".to_string());
        let out = fill_template("{{tax_total}} / {{total}}", &map);
        assert_eq!(out, "100.00 / 0.00");
    }

    #[test]
    fn extract_tokens_finds_double_braced_tokens() {
        // Input: mixed text.
        // Expected: only {{...}} alphanumeric/underscore tokens.
        let toks = extract_tokens("a {{invoice_number}} b {not} c {{items_1_name}} d");
        assert_eq!(toks, vec!["invoice_number", "items_1_name"]);
    }

    #[test]
    fn known_placeholder_matches_core_and_item_fields() {
        // Inputs: core token, item token, junk token.
        // Expected: core + item recognised, junk not.
        assert!(is_known_placeholder("customer_name"));
        assert!(is_known_placeholder("items_12_line_total"));
        assert!(is_known_placeholder("items_1_sku"));
        assert!(!is_known_placeholder("items_x_name"));
        assert!(!is_known_placeholder("totally_bogus"));
        assert!(!is_known_placeholder("items_1_"));
    }

    #[test]
    fn placeholder_values_covers_core_and_items() {
        // Input: a doc with one line item.
        // Expected: core keys present, per-item keys populated.
        let item = PublicInvoiceItem {
            id: "i1".to_string(),
            invoice_id: "inv1".to_string(),
            company_id: "c1".to_string(),
            product_id: "p1".to_string(),
            product_name: "Widget".to_string(),
            product_sku: "SKU-1".to_string(),
            quantity: 2,
            unit_price: 1500,
            tax_rate: 1700,
            tax_amount: 510,
            discount_rate: 0,
            discount_amount: 0,
            discount_type: "percent".to_string(),
            line_total: 3510,
            created_at: "2026-01-01".to_string(),
        };
        let doc = InvoiceDoc {
            invoice: PublicInvoice {
                id: "inv1".to_string(),
                company_id: "c1".to_string(),
                invoice_number: "INV-0001".to_string(),
                invoice_date: "2026-01-01".to_string(),
                due_date: None,
                customer_id: "cu1".to_string(),
                status: "finalized".to_string(),
                subtotal: 3000,
                tax_total: 510,
                discount_total: 0,
                grand_total: 3510,
                fbr_invoice_number: None,
                po_number: None,
                reference_note: None,
                amount_paid: 0,
                balance_due: 3510,
                created_by: "u1".to_string(),
                finalized_at: None,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
            },
            customer: PublicCustomer {
                id: "cu1".to_string(),
                company_id: "c1".to_string(),
                name: "Ali & Co".to_string(),
                email: Some("a@b.com".to_string()),
                phone: None,
                address: None,
                cnic: None,
                ntn: Some("1234567-8".to_string()),
                strn: None,
                buyer_type: "registered".to_string(),
                is_active: true,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                version: 1,
            },
            items: vec![item],
            payments: Vec::new(),
            company_name: "Ijaz & Co".to_string(),
            company_email: None,
            company_phone: None,
            company_address: None,
            currency: "Rs".to_string(),
            settings: InvoiceSettings {
                company_ntn: Some("1234567-8".to_string()),
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
            },
            logo_base64: None,
            company_tagline: None,
        };

        let map = invoice_placeholder_values(&doc);
        assert_eq!(map.get("invoice_number").unwrap(), "INV-0001");
        assert_eq!(map.get("customer_name").unwrap(), "Ali & Co");
        assert_eq!(map.get("subtotal").unwrap(), "30.00");
        assert_eq!(map.get("grand_total").unwrap(), "35.10");
        assert_eq!(map.get("currency").unwrap(), "Rs");
        assert_eq!(map.get("items_1_name").unwrap(), "Widget");
        assert_eq!(map.get("items_1_qty").unwrap(), "2");
        assert_eq!(map.get("items_1_price").unwrap(), "15.00");
        assert_eq!(map.get("items_1_line_total").unwrap(), "35.10");
        assert!(!map.contains_key("items_2_name"));
    }

    // ---------------------------------------------------------------
    // generate_invoice_number (transaction helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn invoice_numbers_increment() {
        // Input: two calls in separate transactions.
        // Expected: "INV-0001" then "INV-0002".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let cid = company_id(&app).await;

        let n1 = {
            let mut tx = pool.begin().await.unwrap();
            let n = generate_invoice_number(&mut tx, &cid).await.expect("n1");
            tx.commit().await.unwrap();
            n
        };
        let n2 = {
            let mut tx = pool.begin().await.unwrap();
            let n = generate_invoice_number(&mut tx, &cid).await.expect("n2");
            tx.commit().await.unwrap();
            n
        };
        assert_eq!(n1, "INV-0001");
        assert_eq!(n2, "INV-0002");
    }

    // ---------------------------------------------------------------
    // customers
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_customer_succeeds() {
        // Input: valid registered customer.
        // Expected: Ok with buyer_type "registered", trimmed name.
        let app = owner_app().await;
        let c = create_customer(
            app.state(),
            app.state(),
            "  Acme Ltd  ".to_string(),
            "acme@test.com".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(c.name, "Acme Ltd");
        assert_eq!(c.buyer_type, "registered");
        assert_eq!(c.email.as_deref(), Some("acme@test.com"));
    }

    #[tokio::test]
    async fn create_customer_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Customer name cannot be empty".
        let app = owner_app().await;
        let err = create_customer(
            app.state(),
            app.state(),
            "  ".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Customer name cannot be empty");
    }

    #[tokio::test]
    async fn create_customer_rejects_bad_buyer_type() {
        // Input: buyer_type "walk-in".
        // Expected: Err "Buyer type must be 'registered' or 'unregistered'".
        let app = owner_app().await;
        let err = create_customer(
            app.state(),
            app.state(),
            "Acme".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "walk-in".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Buyer type must be 'registered' or 'unregistered'");
    }

    #[tokio::test]
    async fn create_customer_denied_for_employee() {
        // Input: employee logged in (invoices/view only).
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

        let err = create_customer(
            app.state(),
            app.state(),
            "Acme".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn list_customers_and_delete() {
        // Input: create then delete a customer.
        // Expected: list reflects each state.
        let app = owner_app().await;
        let c = make_customer(&app, "Acme").await;

        let listed = list_customers(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(listed.len(), 1);

        delete_customer(app.state(), app.state(), c.id.clone())
            .await
            .expect("delete");

        let listed = list_customers(app.state(), app.state())
            .await
            .expect("list");
        assert!(listed.is_empty());
    }

    #[tokio::test]
    async fn delete_customer_not_found() {
        // Input: a random id.
        // Expected: Err "Customer not found".
        let app = owner_app().await;
        let err = delete_customer(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Customer not found");
    }

    #[tokio::test]
    async fn list_customers_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_customers(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_invoice
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_invoice_draft_with_number() {
        // Input: valid customer.
        // Expected: Ok, status "draft", number "INV-0001", due date stored.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;

        let inv = create_invoice(
            app.state(),
            app.state(),
            customer.id.clone(),
            "2026-01-15".to_string(),
            "2026-02-14".to_string(),
            "PO-9".to_string(),
            "hello".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(inv.status, "draft");
        assert_eq!(inv.invoice_number, "INV-0001");
        assert_eq!(inv.due_date.as_deref(), Some("2026-02-14"));
        assert_eq!(inv.po_number.as_deref(), Some("PO-9"));
    }

    #[tokio::test]
    async fn create_invoice_customer_not_found() {
        // Input: a random customer id.
        // Expected: Err "Customer not found".
        let app = owner_app().await;
        let err = create_invoice(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Customer not found");
    }

    #[tokio::test]
    async fn create_invoice_denied_for_employee() {
        // Input: employee logged in.
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

        let err = create_invoice(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // add / update / remove invoice items
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn add_item_recalculates_totals() {
        // Input: two items with known prices.
        // Expected: invoice totals reflect the items.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p1 = make_product(&app, "Widget", 10).await;
        let p2 = make_product(&app, "Gadget", 5).await;
        let inv = make_invoice(&app, &customer.id).await;

        add_item(&app, &inv.id, &p1.id, 2, 1000, 0).await; // 2000
        add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p2.id.clone(),
            1,
            3000,
            1700, // 17% tax on 3000 = 510
            "percent".to_string(),
            0,
        )
        .await
        .expect("add second item");

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.items.len(), 2);
        assert_eq!(details.invoice.subtotal, 5000);
        assert_eq!(details.invoice.tax_total, 510);
        // 5510 paisa = 55.10 PKR → rounded to 55.00 = 5500.
        assert_eq!(details.invoice.grand_total, 5500);
    }

    #[tokio::test]
    async fn add_item_rejects_zero_quantity() {
        // Input: quantity 0.
        // Expected: Err "Quantity must be positive".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p.id.clone(),
            0,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Quantity must be positive");
    }

    #[tokio::test]
    async fn add_item_rejects_negative_price() {
        // Input: unit_price -1.
        // Expected: Err "Unit price cannot be negative".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p.id.clone(),
            1,
            -1,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Unit price cannot be negative");
    }

    #[tokio::test]
    async fn add_item_product_not_found() {
        // Input: a random product id.
        // Expected: Err "Product not found".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product not found");
    }

    #[tokio::test]
    async fn update_and_remove_item() {
        // Input: add item, update its qty, then remove it.
        // Expected: totals follow each change; final item list empty.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        let items = add_item(&app, &inv.id, &p.id, 2, 1000, 0).await;

        let updated = update_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            items[0].id.clone(),
            5,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("update item");
        assert_eq!(updated[0].quantity, 5);

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.subtotal, 5000);

        let items = remove_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            items[0].id.clone(),
        )
        .await
        .expect("remove");
        assert!(items.is_empty());

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.grand_total, 0);
    }

    #[tokio::test]
    async fn update_item_not_on_invoice() {
        // Input: a random item id.
        // Expected: Err "Item not found on this invoice".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = update_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Item not found on this invoice");
    }

    #[tokio::test]
    async fn add_item_rejected_on_finalized_invoice() {
        // Input: adding an item to a finalized invoice.
        // Expected: Err "Can only add items to draft invoices".
        let app = owner_app().await;
        let (inv, product) = finalized_invoice_with_stock(&app).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            product.id.clone(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Can only add items to draft invoices");
    }

    #[tokio::test]
    async fn add_item_invoice_not_found() {
        // Input: a random invoice id.
        // Expected: Err "Invoice not found".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", 10).await;
        let err = add_invoice_item(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            p.id.clone(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invoice not found");
    }

    // ---------------------------------------------------------------
    // finalize_invoice
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn finalize_deducts_stock_and_locks() {
        // Input: draft invoice with 2× Widget; product has 10.
        // Expected: status "finalized"; product stock 8; sale movement recorded.
        let app = owner_app().await;
        let (inv, product) = finalized_invoice_with_stock(&app).await;

        assert_eq!(inv.status, "finalized");
        assert!(inv.finalized_at.is_some());

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 8);

        let movements = crate::commands::inventory::list_stock_movements(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("movements");
        assert!(movements.iter().any(|m| m.movement_type == "sale"));
    }

    #[tokio::test]
    async fn finalize_rejects_insufficient_stock() {
        // Input: item qty 50 but only 10 in stock.
        // Expected: Err "Insufficient stock".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let product = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            product.id.clone(),
            50,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Insufficient stock"), "got: {err}");
    }

    #[tokio::test]
    async fn finalize_rejects_zero_total() {
        // Input: draft invoice with no items.
        // Expected: Err "Cannot finalize an invoice with zero total".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("zero total"), "got: {err}");
    }

    #[tokio::test]
    async fn finalize_rejects_double_finalize() {
        // Input: finalize an already-finalized invoice.
        // Expected: Err "Invoice is not in draft status".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert_eq!(err, "Invoice is not in draft status");
    }

    #[tokio::test]
    async fn finalize_denied_for_employee() {
        // Input: employee logged in (no invoices/finalize).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_item(&app, &inv.id, &p.id, 1, 100, 0).await;

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

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // get_invoice / list_invoices
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_invoice_returns_full_details() {
        // Input: finalized invoice.
        // Expected: customer, 1 item, no payments.
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.id, inv.id);
        assert_eq!(details.customer.name, "Walk-in");
        assert_eq!(details.items.len(), 1);
        assert!(details.payments.is_empty());
    }

    #[tokio::test]
    async fn get_invoice_not_found() {
        // Input: a random id.
        // Expected: Err "Invoice not found".
        let app = owner_app().await;
        let err = get_invoice(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Invoice not found");
    }

    #[tokio::test]
    async fn list_invoices_returns_all() {
        // Input: two invoices.
        // Expected: 2 rows.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        make_invoice(&app, &customer.id).await;
        make_invoice(&app, &customer.id).await;

        let invoices = list_invoices(app.state(), app.state()).await.expect("list");
        assert_eq!(invoices.len(), 2);
    }

    // ---------------------------------------------------------------
    // record_payment
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn record_payment_partial_and_full() {
        // Input: finalized invoice total 2000; pay 800 then 1200.
        // Expected: status finalized (balance 1200) then paid (balance 0).
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_item(&app, &inv.id, &p.id, 2, 1000, 0).await; // 2000 total
        let finalized = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("finalize");

        let after_partial = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            800,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "ref-1".to_string(),
            "advance".to_string(),
        )
        .await
        .expect("partial");
        assert_eq!(after_partial.status, "finalized");
        assert_eq!(after_partial.balance_due, finalized.grand_total - 800);

        let after_full = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            1200,
            "bank_transfer".to_string(),
            "2026-01-25".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("full");
        assert_eq!(after_full.status, "paid");
        assert_eq!(after_full.amount_paid, finalized.grand_total);
        assert_eq!(after_full.balance_due, 0);
    }

    #[tokio::test]
    async fn record_payment_rejects_overpayment() {
        // Input: payment exceeding balance.
        // Expected: Err "Payment ... exceeds balance due".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            999999,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("exceeds balance due"), "got: {err}");
    }

    #[tokio::test]
    async fn record_payment_rejects_draft_invoice() {
        // Input: payment on a draft invoice.
        // Expected: Err "Cannot record payment for draft or cancelled invoices".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cannot record payment for draft or cancelled invoices");
    }

    #[tokio::test]
    async fn record_payment_rejects_invalid_method() {
        // Input: payment_method "bitcoin".
        // Expected: Err "Invalid payment method".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            100,
            "bitcoin".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid payment method");
    }

    #[tokio::test]
    async fn record_payment_rejects_non_positive_amount() {
        // Input: amount 0.
        // Expected: Err "Payment amount must be positive".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            0,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Payment amount must be positive");
    }

    // ---------------------------------------------------------------
    // invoice settings
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn settings_defaults_created() {
        // Input: fresh company.
        // Expected: prefix "INV", next_number 1, due 30.
        let app = owner_app().await;
        let s = get_invoice_settings(app.state(), app.state())
            .await
            .expect("settings");
        assert_eq!(s.invoice_prefix, "INV");
        assert_eq!(s.next_number, 1);
        assert_eq!(s.default_due_days, 30);
    }

    #[tokio::test]
    async fn settings_updated_and_upserted() {
        // Input: update settings twice (upsert must not duplicate).
        // Expected: latest values win, single row.
        let app = owner_app().await;

        let s = update_invoice_settings(
            app.state(),
            app.state(),
            "NTN-1".to_string(),
            "".to_string(),
            "".to_string(),
            "sale".to_string(),
            15,
            "footer".to_string(),
            "terms".to_string(),
            "modern".to_string(),
            "#2563eb".to_string(),
            true,
            "disclaimer".to_string(),
            "copyright".to_string(),
            "bank".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(s.invoice_prefix, "SALE");
        assert_eq!(s.default_due_days, 15);
        assert_eq!(s.company_ntn.as_deref(), Some("NTN-1"));
        assert_eq!(s.invoice_design, "modern");
        assert_eq!(s.design_accent_color, "#2563eb");
        assert!(s.show_qr);

        let s2 = update_invoice_settings(
            app.state(),
            app.state(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "   ".to_string(),
            0,
            "".to_string(),
            "".to_string(),
            "classic".to_string(),
            "#1d2b54".to_string(),
            true,
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("update again");
        assert_eq!(s2.invoice_prefix, "INV", "blank prefix falls back to INV");
        assert_eq!(s2.default_due_days, 30, "due days below 1 falls back to 30");
    }

    #[tokio::test]
    async fn update_settings_denied_for_employee() {
        // Input: employee logged in (no settings/edit).
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

        let err = update_invoice_settings(
            app.state(),
            app.state(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "INV".to_string(),
            30,
            "".to_string(),
            "".to_string(),
            "classic".to_string(),
            "#1d2b54".to_string(),
            true,
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // misc
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_or_create_settings_is_idempotent() {
        // Input: call twice.
        // Expected: same defaults, no error.
        let app = owner_app().await;
        let cid = company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        let a = get_or_create_settings(&pool, &cid).await.expect("first");
        let b = get_or_create_settings(&pool, &cid).await.expect("second");
        assert_eq!(a.invoice_prefix, b.invoice_prefix);
        assert_eq!(a.next_number, b.next_number);
    }

    /// Extracts the current user's company id from the DB.
    async fn company_id(app: &tauri::App<tauri::test::MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap()
    }
}
