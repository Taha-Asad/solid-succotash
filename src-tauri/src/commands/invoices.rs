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

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// RETURN TYPES
// ==========================================

#[derive(Debug, Clone, Serialize)]
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
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
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
    pub line_total: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceWithDetails {
    pub invoice: PublicInvoice,
    pub customer: PublicCustomer,
    pub items: Vec<PublicInvoiceItem>,
    pub payments: Vec<PublicPayment>,
}

#[derive(Debug, Clone, Serialize)]
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

/// Gets or creates invoice settings for a company
async fn get_or_create_settings(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<InvoiceSettings, String> {
    // Try to get existing
    let existing = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, String, i64, i64, Option<String>, Option<String>)>(
        r#"
        SELECT company_ntn, company_strn, company_cnic,
               invoice_prefix, next_number, default_due_days,
               invoice_footer, terms_conditions
        FROM company_invoice_settings
        WHERE company_id = ?
        "#,
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Settings lookup error: {e}"))?;

    if let Some((ntn, strn, cnic, prefix, next, due_days, footer, terms)) = existing {
        return Ok(InvoiceSettings {
            company_ntn: ntn,
            company_strn: strn,
            company_cnic: cnic,
            invoice_prefix: prefix,
            next_number: next,
            default_due_days: due_days,
            invoice_footer: footer,
            terms_conditions: terms,
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
    })
}

/// Generates the next invoice number and increments the counter
async fn generate_invoice_number(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<String, String> {
    let settings = get_or_create_settings(pool, company_id).await?;

    let number = settings.next_number;
    let invoice_number = format!("{}-{:04}", settings.invoice_prefix, number);

    // Increment the counter
    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?"
    )
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to update invoice counter: {e}"))?;

    Ok(invoice_number)
}

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
               created_at, updated_at
        FROM customers
        WHERE company_id = ?
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

    let customer = sqlx::query_as::<_, PublicCustomer>(
        "SELECT * FROM customers WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(customer)
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
    let customer = sqlx::query_as::<_, PublicCustomer>(
        "SELECT * FROM customers WHERE id = ?",
    )
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

    if current_user.role == "employee" {
        return Err("Employees cannot create invoices".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate customer exists
    let _customer = sqlx::query_scalar::<_, String>(
        "SELECT name FROM customers WHERE id = ? AND company_id = ?",
    )
    .bind(&customer_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|_| "Customer not found".to_string())?;

    let invoice_number = generate_invoice_number(pool.inner(), company_id).await?;

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
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let invoice = sqlx::query_as::<_, PublicInvoice>(
        "SELECT * FROM invoices WHERE id = ?",
    )
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
    discount_rate: i64,
) -> Result<Vec<PublicInvoiceItem>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role == "employee" {
        return Err("Employees cannot modify invoices".to_string());
    }

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
    let line_subtotal = quantity * unit_price;
    let discount_amount = (line_subtotal * discount_rate) / 10000;
    let after_discount = line_subtotal - discount_amount;
    let tax_amount = (after_discount * tax_rate) / 10000;
    let line_total = after_discount + tax_amount;

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO invoice_items
            (id, invoice_id, company_id, product_id, product_name, product_sku,
             quantity, unit_price, tax_rate, tax_amount,
             discount_rate, discount_amount, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    if current_user.role == "employee" {
        return Err("Employees cannot modify invoices".to_string());
    }

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

    if current_user.role == "employee" {
        return Err("Employees cannot finalize invoices".to_string());
    }

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
    }

    // Mark invoice as finalized
    sqlx::query(
        r#"
        UPDATE invoices
        SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&invoice_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Finalize error: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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

    if current_user.role == "employee" {
        return Err("Employees cannot record payments".to_string());
    }

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
            amount, invoice.1 - invoice.2
        ));
    }

    let new_status = if new_balance == 0 { "paid" } else { "finalized" };

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

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<InvoiceSettings, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" {
        return Err("Only the owner can update invoice settings".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let prefix = if invoice_prefix.trim().is_empty() {
        "INV".to_string()
    } else {
        invoice_prefix.trim().to_uppercase()
    };

    let due_days = if default_due_days < 1 { 30 } else { default_due_days };

    // Upsert settings
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO company_invoice_settings
            (id, company_id, company_ntn, company_strn, company_cnic,
             invoice_prefix, default_due_days, invoice_footer, terms_conditions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
            company_ntn = excluded.company_ntn,
            company_strn = excluded.company_strn,
            company_cnic = excluded.company_cnic,
            invoice_prefix = excluded.invoice_prefix,
            default_due_days = excluded.default_due_days,
            invoice_footer = excluded.invoice_footer,
            terms_conditions = excluded.terms_conditions,
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
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

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
    let grand_total = subtotal - discount_total + tax_total;

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
