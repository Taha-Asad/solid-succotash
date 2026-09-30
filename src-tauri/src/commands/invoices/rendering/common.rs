use qrcode::render::svg;
use qrcode::QrCode;
use sqlx::SqlitePool;
use std::collections::HashMap;

use crate::error::AppError;
use super::super::operations::get_or_create_settings;
use super::super::types::{
    InvoiceDoc, PublicCustomer, PublicInvoice, PublicInvoiceItem, PublicPayment,
};

/// Formats a paisa amount as a two-decimal string (paisa / 100).
pub fn fmt_paisa(paisa: i64) -> String {
    format!("{:.2}", paisa as f64 / 100.0)
}

/// Escapes a value for safe insertion into HTML or XML text.
pub fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Replaces `{{token}}` placeholders in a template using values from `map`.
pub fn fill_template(template: &str, map: &HashMap<String, String>) -> String {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    let mut out = template.to_string();
    for k in keys {
        out = out.replace(&format!("{{{{{k}}}}}"), &map[k]);
    }
    out
}

/// Renders a QR code payload as an inline SVG at least `size` pixels wide.
pub fn qr_svg(payload: &str, size: u32) -> String {
    match QrCode::new(payload.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(size, size)
            .quiet_zone(true)
            .build(),
        Err(_) => String::new(),
    }
}

/// Opens a file in the system default application.
pub fn open_with_default(app: &tauri::AppHandle, path: &str, what: &str) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().open_path(path, None::<&str>) {
        eprintln!("Failed to open {what}: {e}");
    }
}

/// Loads every piece of data an invoice renderer needs, scoped to the
/// authenticated user's company.
pub async fn load_invoice_doc(
    pool: &SqlitePool,
    invoice_id: &str,
    company_id: &str,
) -> Result<InvoiceDoc, AppError> {
    let invoice = sqlx::query_as::<_, PublicInvoice>(
        "SELECT * FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(invoice_id)
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&invoice.customer_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::internal(format!("Customer error: {e}")))?;

    let items = sqlx::query_as::<_, PublicInvoiceItem>(
        "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::internal(format!("Items error: {e}")))?;

    let payments = sqlx::query_as::<_, PublicPayment>(
        "SELECT * FROM payment_records WHERE invoice_id = ? ORDER BY payment_date",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::internal(format!("Payments error: {e}")))?;

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
        .map_err(|e| AppError::internal(format!("Company error: {e}")))?;

    let settings = get_or_create_settings(pool, company_id).await?;

    let (logo_base64, company_tagline) =
        sqlx::query_as::<_, (Option<String>, Option<String>)>(
            "SELECT logo_base64, company_tagline FROM company_theme WHERE company_id = ?",
        )
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Theme error: {e}")))?
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
