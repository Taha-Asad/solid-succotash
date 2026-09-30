use sqlx::SqlitePool;
use tauri::State;

use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;

use super::common::{fmt_paisa, load_invoice_doc, open_with_default};

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
) -> Result<String, AppError> {
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
        std::fs::write(&path, &bytes).map_err(|e| AppError::internal(format!("Failed to write PDF: {e}")))?;
        return Ok(path);
    }

    let temp_dir = std::env::temp_dir();
    let filename = format!("invoice_{}.pdf", doc.invoice.invoice_number.replace('/', "_"));
    let file_path = temp_dir.join(&filename);
    std::fs::write(&file_path, &bytes).map_err(|e| AppError::internal(format!("Failed to write PDF: {e}")))?;

    let path_str = file_path.to_string_lossy().to_string();
    open_with_default(&app_handle, &path_str, "PDF");

    Ok(path_str)
}

