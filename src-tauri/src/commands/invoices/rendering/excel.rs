use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;

use super::common::{fill_template, invoice_placeholder_values, load_invoice_doc};
use super::super::operations::get_or_create_settings;
use super::super::types::{ExcelTemplateAnalysis, InvoiceSettings};

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
pub(crate) const COMMON_PLACEHOLDERS: [&str; 8] = [
    "company_name",
    "customer_name",
    "invoice_number",
    "invoice_date",
    "subtotal",
    "tax_total",
    "grand_total",
    "status",
];

pub(crate) fn is_known_placeholder(tok: &str) -> bool {
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

pub(crate) fn extract_tokens(text: &str) -> Vec<String> {
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


/// Reads a template .xlsx, replaces every `{{token}}` placeholder inside
/// the XML parts and returns the filled file bytes.
pub(crate) fn fill_excel_template(template_bytes: &[u8], map: &HashMap<String, String>) -> Result<Vec<u8>, AppError> {
    use std::io::{Cursor, Read, Write};

    let mut archive = zip::ZipArchive::new(Cursor::new(template_bytes.to_vec()))
        .map_err(|e| AppError::internal(format!("Template is not a valid Excel file: {e}")))?;

    let mut out_zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::internal(format!("Template read error: {e}")))?;
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| AppError::internal(format!("Template read error: {e}")))?;

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
            .map_err(|e| AppError::internal(format!("Template write error: {e}")))?;
        out_zip
            .write_all(content)
            .map_err(|e| AppError::internal(format!("Template write error: {e}")))?;
    }
    let writer = out_zip.finish().map_err(|e| AppError::internal(format!("Template write error: {e}")))?;
    Ok(writer.into_inner())
}

/// Saves a base64-encoded Excel invoice template for the current company.
#[tauri::command]
pub async fn save_invoice_excel_template(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    template_base64: String,
) -> Result<InvoiceSettings, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate that the upload is really a base64 zip file before persisting.
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    let bytes = BASE64
        .decode(&template_base64)
        .map_err(|e| AppError::internal(format!("Invalid base64 data: {e}")))?;
    if zip::ZipArchive::new(std::io::Cursor::new(bytes)).is_err() {
        return Err(AppError::internal("Uploaded file is not a valid Excel (.xlsx) template".to_string()));
    }

    sqlx::query(
        "INSERT INTO company_invoice_settings (id, company_id, excel_template_base64, updated_at) \
         VALUES (?, ?, ?, CURRENT_TIMESTAMP) \
         ON CONFLICT(company_id) DO UPDATE SET \
           excel_template_base64 = excluded.excel_template_base64, \
           updated_at = CURRENT_TIMESTAMP",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(company_id)
    .bind(&template_base64)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Failed to save template: {e}")))?;

    get_or_create_settings(pool.inner(), company_id).await
}

/// Analyses the stored Excel template and reports which placeholders it
/// recognises, which are unknown, and which recommended ones are missing.
#[tauri::command]
pub async fn analyze_invoice_excel_template(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<ExcelTemplateAnalysis, AppError> {
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
        .map_err(|e| AppError::internal(format!("Template decode error: {e}")))?;

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| AppError::internal(format!("Stored template is not a valid Excel file: {e}")))?;

    let mut found = std::collections::BTreeSet::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::internal(format!("Template read error: {e}")))?;
        if entry.name().ends_with(".xml") {
            let mut text = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut text)
                .map_err(|e| AppError::internal(format!("Template read error: {e}")))?;
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
) -> Result<String, AppError> {
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
        .map_err(|e| AppError::internal(format!("Template decode error: {e}")))?;

    let map = invoice_placeholder_values(&doc);
    let filled = fill_excel_template(&template_bytes, &map)?;

    if let Some(path) = save_path {
        std::fs::write(&path, &filled).map_err(|e| AppError::internal(format!("Failed to write Excel: {e}")))?;
        Ok(path)
    } else {
        Ok(BASE64.encode(filled))
    }
}

/// Writes the bundled starter .xlsx invoice template to `save_path` so users
/// have a ready-made, placeholder-filled layout to edit in Excel.
#[tauri::command]
pub fn download_sample_invoice_template(save_path: String) -> Result<String, AppError> {
    static SAMPLE: &[u8] =
        include_bytes!("../../../../../src/assets/sample-invoice-template.xlsx");
    std::fs::write(&save_path, SAMPLE)
        .map_err(|e| AppError::internal(format!("Failed to write sample template: {e}")))?;
    Ok(save_path)
}

