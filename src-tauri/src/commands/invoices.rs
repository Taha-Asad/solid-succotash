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
use serde::Serialize;
use sqlx::SqlitePool;
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
        ),
    >(
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
            "Updated invoice settings (prefix '{}', due {} days)",
            prefix, due_days
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
// PDF INVOICE GENERATION
// ==========================================
//
// Generates an HTML invoice and opens it in the default browser.
// The user can then print it (Ctrl+P → Save as PDF).
//
// ADD THIS FUNCTION TO YOUR invoices.rs FILE
// Then register in lib.rs:
//   commands::invoices::generate_invoice_html,

// ---- Add this function to invoices.rs ----

/// Generates an HTML invoice and opens it in the default browser.
/// Returns the file path where the HTML was saved.
#[tauri::command]
pub async fn generate_invoice_html(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    _app_handle: tauri::AppHandle,
    invoice_id: String,
) -> Result<String, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Get invoice with all details
    let invoice = sqlx::query_as::<_, PublicInvoice>(
        "SELECT * FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&invoice.customer_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Customer error: {e}"))?;

    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Items error: {e}"))?;

    let payments = sqlx::query_as::<_, PublicPayment>(
        "SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY payment_date",
    )
    .bind(&invoice_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Payments error: {e}"))?;

    // Get company info
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
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Company error: {e}"))?;

    // Get invoice settings
    let settings = get_or_create_settings(pool.inner(), company_id).await?;

    // Format helper
    fn fmt_paisa(paisa: i64) -> String {
        format!("{:.2}", paisa as f64 / 100.0)
    }

    // Build items HTML
    let mut items_html = String::new();
    for (idx, item) in items.iter().enumerate() {
        items_html.push_str(&format!(
            r#"
            <tr>
                <td style="text-align:center">{}</td>
                <td>
                    <strong>{}</strong><br>
                    <small style="color:#666">SKU: {}</small>
                </td>
                <td style="text-align:center">{}</td>
                <td style="text-align:right">{}</td>
                <td style="text-align:center">{}%</td>
                <td style="text-align:right">{}</td>
                <td style="text-align:right">{}</td>
                <td style="text-align:right"><strong>{}</strong></td>
            </tr>
            "#,
            idx + 1,
            item.product_name,
            item.product_sku,
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

    // Build payments HTML
    let mut payments_html = String::new();
    if !payments.is_empty() {
        payments_html.push_str(r#"<div style="margin-top:20px"><h3 style="border-bottom:2px solid #333;padding-bottom:5px">Payment History</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left;border:1px solid #ddd">Date</th><th style="padding:8px;text-align:left;border:1px solid #ddd">Method</th><th style="padding:8px;text-align:right;border:1px solid #ddd">Amount</th><th style="padding:8px;text-align:left;border:1px solid #ddd">Reference</th></tr>"#);
        for p in &payments {
            payments_html.push_str(&format!(
                r#"<tr><td style="padding:8px;border:1px solid #ddd">{}</td><td style="padding:8px;border:1px solid #ddd">{}</td><td style="padding:8px;border:1px solid #ddd;text-align:right">{}</td><td style="padding:8px;border:1px solid #ddd">{}</td></tr>"#,
                p.payment_date,
                p.payment_method,
                fmt_paisa(p.amount),
                p.reference.as_deref().unwrap_or("—"),
            ));
        }
        payments_html.push_str("</table></div>");
    }

    // Build FBR section
    let mut fbr_section = String::new();
    if settings.company_ntn.is_some() || settings.company_strn.is_some() {
        fbr_section.push_str(r#"<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px;margin:10px 0;border-radius:4px">"#);
        fbr_section.push_str("<strong>FBR Tax Information</strong><br>");
        if let Some(ref ntn) = settings.company_ntn {
            fbr_section.push_str(&format!("Company NTN: {}<br>", ntn));
        }
        if let Some(ref strn) = settings.company_strn {
            fbr_section.push_str(&format!("STRN: {}<br>", strn));
        }
        fbr_section.push_str(&format!("Buyer Type: {}<br>", customer.buyer_type));
        if let Some(ref c) = customer.ntn {
            fbr_section.push_str(&format!("Buyer NTN: {}<br>", c));
        }
        if let Some(ref c) = customer.cnic {
            fbr_section.push_str(&format!("Buyer CNIC: {}<br>", c));
        }
        fbr_section.push_str("</div>");
    }

    // Get current time for the footer
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let _generated_at = format_timestamp(now);

    // Generate the HTML
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Invoice {invoice_number}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            color: #333;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 15px;
            margin-bottom: 20px;
        }}
        .company-name {{
            font-size: 24px;
            font-weight: 700;
            color: #2563eb;
        }}
        .invoice-title {{
            font-size: 28px;
            font-weight: 700;
            color: #333;
            text-align: right;
        }}
        .invoice-meta {{
            text-align: right;
            font-size: 11px;
            color: #666;
        }}
        .info-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }}
        .info-box {{
            border: 1px solid #ddd;
            padding: 12px;
            border-radius: 4px;
        }}
        .info-box h3 {{
            font-size: 11px;
            text-transform: uppercase;
            color: #999;
            margin-bottom: 8px;
        }}
        table.items {{
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }}
        table.items th {{
            background: #2563eb;
            color: white;
            padding: 10px 8px;
            text-align: left;
            font-size: 11px;
        }}
        table.items td {{
            padding: 8px;
            border-bottom: 1px solid #eee;
        }}
        table.items tr:nth-child(even) {{
            background: #f9f9f9;
        }}
        .totals {{
            display: flex;
            justify-content: flex-end;
        }}
        .totals-box {{
            width: 300px;
        }}
        .totals-row {{
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid #eee;
        }}
        .totals-row.grand {{
            border-top: 2px solid #333;
            border-bottom: none;
            font-size: 16px;
            font-weight: 700;
            padding: 10px 0;
            color: #2563eb;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            font-size: 10px;
            color: #999;
            text-align: center;
        }}
        @media print {{
            body {{ padding: 0; }}
            .no-print {{ display: none; }}
        }}
    </style>
</head>
<body>
    <div class="no-print" style="background:#e3f2fd;padding:10px;margin-bottom:20px;border-radius:4px;text-align:center">
        <strong>Press Ctrl+P to print or save as PDF</strong>
    </div>

    <div class="header">
        <div>
            <div class="company-name">{company_name}</div>
            <div>{company_address}</div>
            <div>{company_phone}</div>
            <div>{company_email}</div>
        </div>
        <div>
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-meta">
                <div><strong>{invoice_number}</strong></div>
                <div>Date: {invoice_date}</div>
                {due_date_html}
                {po_html}
                <div style="margin-top:5px"><span style="background:{status_color};color:white;padding:2px 8px;border-radius:3px;font-size:10px">{status}</span></div>
            </div>
        </div>
    </div>

    {fbr_section}

    <div class="info-grid">
        <div class="info-box">
            <h3>Bill To</h3>
            <strong>{customer_name}</strong><br>
            {customer_phone_html}
            {customer_email_html}
            {customer_address_html}
        </div>
        <div class="info-box">
            <h3>Payment Details</h3>
            <div>Amount Paid: <strong>{amount_paid}</strong></div>
            <div>Balance Due: <strong style="color:{balance_color}">{balance_due}</strong></div>
            <div style="margin-top:5px">Status: <span style="background:{status_color};color:white;padding:1px 6px;border-radius:3px;font-size:10px">{status}</span></div>
        </div>
    </div>

    <table class="items">
        <thead>
            <tr>
                <th style="text-align:center">#</th>
                <th>Product</th>
                <th style="text-align:center">Qty</th>
                <th style="text-align:right">Unit Price</th>
                <th style="text-align:center">Tax</th>
                <th style="text-align:right">Tax Amt</th>
                <th style="text-align:right">Discount</th>
                <th style="text-align:right">Total</th>
            </tr>
        </thead>
        <tbody>
            {items_html}
        </tbody>
    </table>

    <div class="totals">
        <div class="totals-box">
            <div class="totals-row">
                <span>Subtotal:</span>
                <span>{currency} {subtotal}</span>
            </div>
            {discount_row}
            {tax_row}
            <div class="totals-row grand">
                <span>Grand Total:</span>
                <span>{currency} {grand_total}</span>
            </div>
        </div>
    </div>

    {payments_html}

    <div class="footer">
        {footer_html}
        <div>Generated by Ijaz & Company ERP — {generated_at}</div>
    </div>
</body>
</html>"#,
        invoice_number = invoice.invoice_number,
        company_name = company.0,
        company_address = company.3.as_deref().unwrap_or(""),
        company_phone = company.2.as_deref().unwrap_or(""),
        company_email = company.1.as_deref().unwrap_or(""),
        invoice_date = invoice.invoice_date,
        due_date_html = invoice
            .due_date
            .as_ref()
            .map(|d| format!("Due: {d}"))
            .unwrap_or_default(),
        po_html = invoice
            .po_number
            .as_ref()
            .map(|p| format!("PO: {p}"))
            .unwrap_or_default(),
        status_color = match invoice.status.as_str() {
            "paid" => "#28a745",
            "finalized" => "#007bff",
            "cancelled" => "#dc3545",
            _ => "#ffc107",
        },
        status = invoice.status.to_uppercase(),
        fbr_section = fbr_section,
        customer_name = customer.name,
        customer_phone_html = customer
            .phone
            .as_ref()
            .map(|p| format!("Phone: {p}<br>"))
            .unwrap_or_default(),
        customer_email_html = customer
            .email
            .as_ref()
            .map(|e| format!("Email: {e}<br>"))
            .unwrap_or_default(),
        customer_address_html = customer
            .address
            .as_ref()
            .map(|a| format!("{a}<br>"))
            .unwrap_or_default(),
        amount_paid = fmt_paisa(invoice.amount_paid),
        balance_due = fmt_paisa(invoice.balance_due),
        balance_color = if invoice.balance_due > 0 {
            "#dc3545"
        } else {
            "#28a745"
        },
        items_html = items_html,
        currency = company.4,
        subtotal = fmt_paisa(invoice.subtotal),
        discount_row = if invoice.discount_total > 0 {
            format!(
                r#"<div class="totals-row"><span style="color:#dc3545">Discount:</span><span style="color:#dc3545">-{}</span></div>"#,
                fmt_paisa(invoice.discount_total)
            )
        } else {
            String::new()
        },
        tax_row = if invoice.tax_total > 0 {
            format!(
                r#"<div class="totals-row"><span>Tax:</span><span>{}</span></div>"#,
                fmt_paisa(invoice.tax_total)
            )
        } else {
            String::new()
        },
        grand_total = fmt_paisa(invoice.grand_total),
        payments_html = payments_html,
        footer_html = settings
            .invoice_footer
            .as_deref()
            .unwrap_or("Thank you for your business!"),
        generated_at = chrono::Utc::now().format("%Y-%m-%d %H:%M"),
    );

    // Save to temp file
    let temp_dir = std::env::temp_dir();
    let filename = format!("invoice_{}.html", invoice.invoice_number.replace('/', "_"));
    let file_path = temp_dir.join(&filename);

    std::fs::write(&file_path, &html).map_err(|e| format!("Failed to write HTML: {e}"))?;

    // Open in default browser
    let path_str = file_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn();
    }

    Ok(path_str)
}

/// Formats a Unix timestamp into a readable date string
fn format_timestamp(secs: u64) -> String {
    // Simple date calculation (UTC)
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
    use crate::commands::test_helpers::{
        insert_user, register_owner, set_session_user, setup_app,
    };
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
        assert_eq!(compute_line_amounts(3, 200, 0, "percent", 0), (0, 0, 0, 600));
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
        assert_eq!(
            err,
            "Buyer type must be 'registered' or 'unregistered'"
        );
    }

    #[tokio::test]
    async fn create_customer_denied_for_employee() {
        // Input: employee logged in (invoices/view only).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(&app.state::<SqlitePool>(), &company_id(&app).await, "e@test.com", "Emp", "employee", true).await;
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

        let listed = list_customers(app.state(), app.state()).await.expect("list");
        assert_eq!(listed.len(), 1);

        delete_customer(app.state(), app.state(), c.id.clone())
            .await
            .expect("delete");

        let listed = list_customers(app.state(), app.state()).await.expect("list");
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
        let employee = insert_user(&app.state::<SqlitePool>(), &company_id(&app).await, "e@test.com", "Emp", "employee", true).await;
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

        let items = remove_invoice_item(app.state(), app.state(), inv.id.clone(), items[0].id.clone())
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

        let movements =
            crate::commands::inventory::list_stock_movements(app.state(), app.state(), product.id.clone())
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

        let employee = insert_user(&app.state::<SqlitePool>(), &company_id(&app).await, "e@test.com", "Emp", "employee", true).await;
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
        assert_eq!(
            err,
            "Cannot record payment for draft or cancelled invoices"
        );
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
        )
        .await
        .expect("update");
        assert_eq!(s.invoice_prefix, "SALE");
        assert_eq!(s.default_due_days, 15);
        assert_eq!(s.company_ntn.as_deref(), Some("NTN-1"));

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
        let employee = insert_user(&app.state::<SqlitePool>(), &company_id(&app).await, "e@test.com", "Emp", "employee", true).await;
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
