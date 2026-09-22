use super::types::*;
use super::adapters::{mapped_fields_note, mapping_value};
use super::products::sku_exists;
use super::parties::resolve_or_create_supplier;
use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// SALES-INVOICE & PURCHASE-BILL IMPORTS (§23.2)
// ==========================================

// ==========================================
// SALES-INVOICE & PURCHASE-BILL IMPORTS (§23.2)
// ==========================================
//
// Both targets import "historical records": a header plus a line-item
// snapshot written exactly as the file describes. No stock, batch or ledger
// mutation happens — the opening-stock target owns the stock position and
// imported history is always safe to delete via rollback. Products and
// parties are resolved by name/SKU; a party that does not exist yet is
// created so the record has a valid foreign key.

/// Rounds paisa to the nearest rupee, matching the invoice module's
/// convention (50+ paisa rounds up).
pub fn round_to_rupee_paisa(paisa: i64) -> i64 {
    let rem = paisa.rem_euclid(100);
    if rem >= 50 {
        paisa - rem + 100
    } else {
        paisa - rem
    }
}

/// Parses a date to YYYY-MM-DD, erroring when it is missing or unparseable.
pub fn parse_import_date(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::internal(format!("{label} is missing. Map a date column in your file.")));
    }
    crate::commands::inventory::parse_expiry_date(trimmed).map_err(|_| {
        AppError::validation(format!(
            "{label} '{trimmed}' is not a valid date. Use YYYY-MM-DD, YYYY/MM/DD or DD/MM/YYYY."
        ))
    })
}

/// Parsed + validated sales-invoice row. One row = one invoice.
pub struct ParsedInvoice {
    invoice_number: String,
    invoice_date: String,
    due_date: Option<String>,
    customer_name: String,
    product_sku: String,
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount: i64,
    total_amount: Option<i64>,
    amount_paid: i64,
    status: String,
    reference_note: String,
    po_number: String,
}

pub fn parse_invoice_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedInvoice, AppError> {
    let mut invoice_number = String::new();
    let mut invoice_date = String::new();
    let mut due_date = String::new();
    let mut customer_name = String::new();
    let mut product_sku = String::new();
    let mut quantity: i64 = 1;
    let mut unit_price: i64 = 0;
    let mut tax_rate: i64 = 0;
    let mut discount: i64 = 0;
    let mut total_amount: Option<i64> = None;
    let mut amount_paid: i64 = 0;
    let mut status = String::new();
    let mut reference_note = String::new();
    let mut po_number = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        match mapping.target_field.as_str() {
            "invoice_number" => invoice_number = value,
            "invoice_date" => invoice_date = value,
            "due_date" => due_date = value,
            "customer_name" => customer_name = value,
            "product_sku" => product_sku = value,
            "quantity" => quantity = (value.parse::<f64>().unwrap_or(0.0).max(0.0)) as i64,
            "unit_price" => unit_price = parse_price(&value),
            "tax_rate" => tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "discount" => discount = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "total_amount" => total_amount = Some(parse_price(&value)),
            "amount_paid" => amount_paid = parse_price(&value),
            "status" => status = value,
            "reference_note" => reference_note = value,
            "po_number" => po_number = value,
            _ => {}
        }
    }

    if invoice_number.trim().is_empty() {
        return Err(AppError::internal(format!(
            "Row has no invoice number. Map an 'Invoice Number' column — one row is one invoice. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }
    if customer_name.trim().is_empty() {
        return Err(AppError::internal(format!(
            "Row has no customer. Map a 'Customer Name' column. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }
    let invoice_date = parse_import_date(&invoice_date, "Invoice date")?;
    let due_date = if due_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&due_date, "Due date")?)
    };
    if quantity == 0 {
        quantity = 1;
    }

    Ok(ParsedInvoice {
        invoice_number: invoice_number.trim().to_string(),
        invoice_date,
        due_date,
        customer_name,
        product_sku: product_sku.trim().to_string(),
        quantity,
        unit_price,
        tax_rate,
        discount,
        total_amount,
        amount_paid,
        status: normalize_invoice_status(&status),
        reference_note,
        po_number,
    })
}

/// Normalizes a file's invoice status to one of the DB's allowed values.
fn normalize_invoice_status(raw: &str) -> String {
    let n = raw.trim().to_lowercase();
    if n.is_empty() || n == "finalized" || n == "final" {
        return "finalized".to_string();
    }
    if n == "paid" || n.contains("paid") {
        return "paid".to_string();
    }
    if n == "cancelled" || n == "canceled" || n == "void" {
        return "cancelled".to_string();
    }
    if n == "draft" || n == "pending" || n == "open" || n == "unpaid" || n == "due" {
        return "draft".to_string();
    }
    "finalized".to_string()
}

/// Computes (status, amount_paid, balance_due) for an imported invoice.
fn invoice_amounts(raw_status: &str, amount_paid: i64, grand_total: i64) -> (String, i64, i64) {
    let status = normalize_invoice_status(raw_status);
    match status.as_str() {
        "draft" | "cancelled" => (status, 0, grand_total),
        "paid" => (status, grand_total, 0),
        _ => {
            let paid = amount_paid.clamp(0, grand_total);
            (status, paid, grand_total - paid)
        }
    }
}

/// Parsed + validated purchase-bill row. One row = one purchase order.
pub struct ParsedPurchaseBill {
    po_number: String,
    po_date: String,
    expected_date: Option<String>,
    expiry_date: Option<String>,
    supplier_name: String,
    product_sku: String,
    quantity: i64,
    unit_cost: i64,
    tax_rate: i64,
    total_amount: Option<i64>,
    amount_paid: i64,
    status: String,
    reference_note: String,
}

pub fn parse_purchase_bill_row(
    mappings: &[FieldMapping],
    row: &[String],
) -> Result<ParsedPurchaseBill, AppError> {
    let mut po_number = String::new();
    let mut po_date = String::new();
    let mut expected_date = String::new();
    let mut expiry_date = String::new();
    let mut supplier_name = String::new();
    let mut product_sku = String::new();
    let mut quantity: i64 = 1;
    let mut unit_cost: i64 = 0;
    let mut tax_rate: i64 = 0;
    let mut total_amount: Option<i64> = None;
    let mut amount_paid: i64 = 0;
    let mut status = String::new();
    let mut reference_note = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        match mapping.target_field.as_str() {
            "po_number" => po_number = value,
            "po_date" => po_date = value,
            "expected_date" => expected_date = value,
            "expiry_date" => expiry_date = value,
            "supplier_name" => supplier_name = value,
            "product_sku" => product_sku = value,
            "quantity" => quantity = (value.parse::<f64>().unwrap_or(0.0).max(0.0)) as i64,
            "unit_cost" => unit_cost = parse_price(&value),
            "tax_rate" => tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "total_amount" => total_amount = Some(parse_price(&value)),
            "amount_paid" => amount_paid = parse_price(&value),
            "status" => status = value,
            "reference_note" => reference_note = value,
            _ => {}
        }
    }

    if po_number.trim().is_empty() {
        return Err(AppError::internal(format!(
            "Row has no purchase order number. Map a 'PO Number' column — one row is one purchase bill. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }
    if supplier_name.trim().is_empty() {
        return Err(AppError::internal(format!(
            "Row has no supplier. Map a 'Supplier Name' column. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }
    let po_date = parse_import_date(&po_date, "PO date")?;
    let expected_date = if expected_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&expected_date, "Expected date")?)
    };
    let expiry_date = if expiry_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&expiry_date, "Expiry date")?)
    };
    if quantity == 0 {
        quantity = 1;
    }

    Ok(ParsedPurchaseBill {
        po_number: po_number.trim().to_string(),
        po_date,
        expected_date,
        expiry_date,
        supplier_name,
        product_sku: product_sku.trim().to_string(),
        quantity,
        unit_cost,
        tax_rate,
        total_amount,
        amount_paid,
        status: normalize_po_status(&status),
        reference_note,
    })
}

/// Normalizes a file's purchase-order status to one of the DB's allowed values.
fn normalize_po_status(raw: &str) -> String {
    let n = raw.trim().to_lowercase();
    if n.is_empty() || n == "received" || n == "complete" || n == "completed" || n == "delivered" {
        return "received".to_string();
    }
    if n == "paid" || n.contains("paid") {
        return "paid".to_string();
    }
    if n == "cancelled" || n == "canceled" || n == "void" {
        return "cancelled".to_string();
    }
    if n == "ordered" || n == "pending" || n == "open" || n == "processing" || n == "draft" {
        return "ordered".to_string();
    }
    "received".to_string()
}

/// Computes (status, amount_paid, balance_due) for an imported purchase order.
fn po_amounts(raw_status: &str, amount_paid: i64, grand_total: i64) -> (String, i64, i64) {
    let status = normalize_po_status(raw_status);
    match status.as_str() {
        "draft" | "cancelled" => (status, 0, grand_total),
        "paid" => (status, grand_total, 0),
        _ => {
            let paid = amount_paid.clamp(0, grand_total);
            (status, paid, grand_total - paid)
        }
    }
}

async fn invoice_number_exists(
    pool: &SqlitePool,
    company_id: &str,
    number: &str,
) -> Result<bool, AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM invoices WHERE company_id = ? AND invoice_number = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(number)
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .map_err(|e| AppError::internal(format!("Invoice lookup error: {e}")))
}

async fn po_number_exists(
    pool: &SqlitePool,
    company_id: &str,
    number: &str,
) -> Result<bool, AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM purchase_orders WHERE company_id = ? AND po_number = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(number)
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .map_err(|e| AppError::internal(format!("PO lookup error: {e}")))
}

/// Generates the next free invoice number from the company's invoice counter,
/// skipping numbers that already exist (e.g. imported with explicit numbers).
async fn next_free_invoice_number(pool: &SqlitePool, company_id: &str) -> Result<String, AppError> {
    let (prefix, mut next): (String, i64) = sqlx::query_as(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Invoice settings error: {e}")))?;

    loop {
        let candidate = format!("{prefix}-{:03}", next);
        if !invoice_number_exists(pool, company_id, &candidate).await? {
            sqlx::query(
                "UPDATE company_invoice_settings SET next_number = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
            )
            .bind(next + 1)
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to advance invoice counter: {e}")))?;
            return Ok(candidate);
        }
        next += 1;
    }
}

/// Generates the next free PO number from the company's PO counter.
async fn next_free_po_number(pool: &SqlitePool, company_id: &str) -> Result<String, AppError> {
    let (prefix, mut next): (String, i64) = sqlx::query_as(
        "SELECT po_prefix, next_number FROM company_po_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("PO settings error: {e}")))?;

    loop {
        let candidate = format!("{prefix}-{:03}", next);
        if !po_number_exists(pool, company_id, &candidate).await? {
            sqlx::query(
                "UPDATE company_po_settings SET next_number = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
            )
            .bind(next + 1)
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to advance PO counter: {e}")))?;
            return Ok(candidate);
        }
        next += 1;
    }
}

/// Finds an existing customer by name, or creates one tagged with the job so
/// rollback can remove it again.
async fn resolve_or_create_customer(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
    job_id: &str,
) -> Result<String, AppError> {
    let trimmed = name.trim().to_string();
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE AND is_active = 1 LIMIT 1",
    )
    .bind(company_id)
    .bind(&trimmed)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Customer lookup error: {e}")))?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO customers (id, company_id, name, import_batch_id) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to create customer '{trimmed}': {e}")))?;

    Ok(id)
}

/// Imports one sales-invoice row. Returns Ok(true) when a record was created,
/// Ok(false) when the conflict strategy skipped it.
///
/// The header is inserted as `draft` first because the database refuses to
/// add line items to a finalized/paid invoice; once the item is attached the
/// status flips to the file's value.
#[allow(clippy::too_many_arguments)]
pub async fn import_one_invoice_row(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, AppError> {
    let parsed = parse_invoice_row(mappings, row)?;
    let number = if parsed.invoice_number.is_empty() {
        next_free_invoice_number(pool, company_id).await?
    } else {
        parsed.invoice_number.clone()
    };

    let exists = invoice_number_exists(pool, company_id, &number).await?;
    if exists && strategy == ConflictStrategy::Skip {
        return Ok(false);
    }

    // Optional line item: summary rows carry no SKU.
    let mut product_id: Option<String> = None;
    let mut product_name = String::new();
    let mut product_sku_display = String::new();
    if !parsed.product_sku.is_empty() {
        let product = sqlx::query_as::<_, (String, String)>(
            "SELECT id, name FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1",
        )
        .bind(company_id)
        .bind(&parsed.product_sku)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;
        match product {
            Some((id, name)) => {
                product_id = Some(id);
                product_name = name;
                product_sku_display = parsed.product_sku.clone();
            }
            None => {
                return Err(AppError::internal(format!(
                    "No product with SKU '{}' was found. Import your products first.",
                    parsed.product_sku
                )));
            }
        }
    }

    // Line computation (paisa; rupee-rounded, matching the app's invoices).
    let qty = if product_id.is_some() {
        parsed.quantity.max(1)
    } else {
        0
    };
    let subtotal = qty.saturating_mul(parsed.unit_price);
    let discount_amount = subtotal.saturating_mul(parsed.discount) / 10_000;
    let after_discount = subtotal.saturating_sub(discount_amount);
    let tax_amount = after_discount.saturating_mul(parsed.tax_rate) / 10_000;
    let line_total = round_to_rupee_paisa(after_discount.saturating_add(tax_amount));

    let (subtotal_total, tax_total, discount_total, grand_total) = if product_id.is_some() {
        (subtotal, tax_amount, discount_amount, line_total)
    } else {
        let total = parsed.total_amount.unwrap_or(0);
        (total, 0, 0, total)
    };

    let (status, amount_paid, balance_due) =
        invoice_amounts(&parsed.status, parsed.amount_paid, grand_total);

    let customer_id = resolve_or_create_customer(pool, company_id, &parsed.customer_name, job_id)
        .await?;

    let invoice_id = uuid::Uuid::new_v4().to_string();
    let due_date = parsed.due_date.as_deref().unwrap_or("");
    sqlx::query(
        "INSERT INTO invoices (id, company_id, invoice_number, invoice_date, due_date, customer_id,
         status, subtotal, tax_total, discount_total, grand_total, po_number, reference_note,
         amount_paid, balance_due, created_by, import_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .bind(&number)
    .bind(&parsed.invoice_date)
    .bind(due_date)
    .bind(&customer_id)
    .bind(subtotal_total)
    .bind(tax_total)
    .bind(discount_total)
    .bind(grand_total)
    .bind(&parsed.po_number)
    .bind(&parsed.reference_note)
    .bind(grand_total)
    .bind(user_id)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to create invoice '{number}': {e}")))?;

    if let Some(pid) = product_id {
        let item_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO invoice_items (id, invoice_id, company_id, product_id, product_name, product_sku,
             quantity, unit_price, tax_rate, tax_amount, discount_rate, discount_amount, discount_type,
             line_total, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'percent', ?, ?)",
        )
        .bind(&item_id)
        .bind(&invoice_id)
        .bind(company_id)
        .bind(&pid)
        .bind(&product_name)
        .bind(&product_sku_display)
        .bind(qty)
        .bind(parsed.unit_price)
        .bind(parsed.tax_rate)
        .bind(tax_amount)
        .bind(parsed.discount)
        .bind(discount_amount)
        .bind(line_total)
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to add item to invoice '{number}': {e}")))?;
    }

    // Flip the draft header to the file's real status + payment position.
    sqlx::query("UPDATE invoices SET status = ?, amount_paid = ?, balance_due = ? WHERE id = ? AND company_id = ?")
        .bind(&status)
        .bind(amount_paid)
        .bind(balance_due)
        .bind(&invoice_id)
        .bind(company_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to finalize imported invoice '{number}': {e}")))?;

    Ok(true)
}

/// Imports one purchase-bill row. Returns Ok(true) when a record was created,
/// Ok(false) when the conflict strategy skipped it.
#[allow(clippy::too_many_arguments)]
pub async fn import_one_purchase_bill_row(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, AppError> {
    let parsed = parse_purchase_bill_row(mappings, row)?;
    let number = if parsed.po_number.is_empty() {
        next_free_po_number(pool, company_id).await?
    } else {
        parsed.po_number.clone()
    };

    let exists = po_number_exists(pool, company_id, &number).await?;
    if exists && strategy == ConflictStrategy::Skip {
        return Ok(false);
    }

    let mut product_id: Option<String> = None;
    let mut product_name = String::new();
    let mut product_sku_display = String::new();
    if !parsed.product_sku.is_empty() {
        let product = sqlx::query_as::<_, (String, String)>(
            "SELECT id, name FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1",
        )
        .bind(company_id)
        .bind(&parsed.product_sku)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;
        match product {
            Some((id, name)) => {
                product_id = Some(id);
                product_name = name;
                product_sku_display = parsed.product_sku.clone();
            }
            None => {
                return Err(AppError::internal(format!(
                    "No product with SKU '{}' was found. Import your products first.",
                    parsed.product_sku
                )));
            }
        }
    }

    // Line computation (paisa, no discount on purchase lines).
    let qty = if product_id.is_some() {
        parsed.quantity.max(1)
    } else {
        0
    };
    let subtotal = qty.saturating_mul(parsed.unit_cost);
    let tax_amount = subtotal.saturating_mul(parsed.tax_rate) / 10_000;
    let line_total = subtotal.saturating_add(tax_amount);

    let (subtotal_total, tax_total, grand_total) = if product_id.is_some() {
        (subtotal, tax_amount, line_total)
    } else {
        let total = parsed.total_amount.unwrap_or(0);
        (total, 0, total)
    };

    let (status, amount_paid, balance_due) =
        po_amounts(&parsed.status, parsed.amount_paid, grand_total);

    let quantity_received = if status == "received" || status == "paid" {
        qty
    } else {
        0
    };

    let supplier_id = resolve_or_create_supplier(pool, company_id, &parsed.supplier_name, job_id)
        .await?
        .ok_or("Supplier is missing")?;

    let po_id = uuid::Uuid::new_v4().to_string();
    let expected_date = parsed.expected_date.as_deref().unwrap_or("");
    sqlx::query(
        "INSERT INTO purchase_orders (id, company_id, supplier_id, po_number, po_date, expected_date,
         status, subtotal, tax_total, grand_total, amount_paid, balance_due, reference_note,
         created_by, import_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&po_id)
    .bind(company_id)
    .bind(&supplier_id)
    .bind(&number)
    .bind(&parsed.po_date)
    .bind(expected_date)
    .bind(&status)
    .bind(subtotal_total)
    .bind(tax_total)
    .bind(grand_total)
    .bind(amount_paid)
    .bind(balance_due)
    .bind(&parsed.reference_note)
    .bind(user_id)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to create purchase order '{number}': {e}")))?;

    if let Some(pid) = product_id {
        let item_id = uuid::Uuid::new_v4().to_string();
        let expiry_date = parsed.expiry_date.as_deref().unwrap_or("");
        sqlx::query(
            "INSERT INTO purchase_order_items (id, po_id, company_id, product_id, product_name, product_sku,
             quantity_ordered, quantity_received, unit_cost, tax_rate, tax_amount, line_total,
             expiry_date, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&item_id)
        .bind(&po_id)
        .bind(company_id)
        .bind(&pid)
        .bind(&product_name)
        .bind(&product_sku_display)
        .bind(qty)
        .bind(quantity_received)
        .bind(parsed.unit_cost)
        .bind(parsed.tax_rate)
        .bind(tax_amount)
        .bind(line_total)
        .bind(expiry_date)
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to add item to purchase order '{number}': {e}")))?;
    }

    Ok(true)
}

/// Dry-run invoice validation: parse + product-exists + duplicate number check.
pub async fn validate_invoice_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_invoice_row(&request.mappings, row)?;
    if !parsed.product_sku.is_empty() && !sku_exists(pool, company_id, &parsed.product_sku).await? {
        return Err(AppError::internal(format!(
            "No product with SKU '{}' was found. Import your products first.",
            parsed.product_sku
        )));
    }
    // Empty invoice numbers get auto-generated, so they never collide.
    let exists = if parsed.invoice_number.is_empty() {
        false
    } else {
        invoice_number_exists(pool, company_id, &parsed.invoice_number).await?
    };
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run purchase-bill validation.
pub async fn validate_purchase_bill_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_purchase_bill_row(&request.mappings, row)?;
    if !parsed.product_sku.is_empty() && !sku_exists(pool, company_id, &parsed.product_sku).await? {
        return Err(AppError::internal(format!(
            "No product with SKU '{}' was found. Import your products first.",
            parsed.product_sku
        )));
    }
    let exists = if parsed.po_number.is_empty() {
        false
    } else {
        po_number_exists(pool, company_id, &parsed.po_number).await?
    };
    Ok(conflict_outcome(exists, request.conflict_strategy))
}
