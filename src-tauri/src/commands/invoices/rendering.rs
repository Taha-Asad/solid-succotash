use qrcode::render::svg;
use qrcode::QrCode;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tauri::State;

use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};

use super::operations::get_or_create_settings;
use super::types::{
    ExcelTemplateAnalysis, InvoiceDoc, InvoiceSettings, PublicCustomer, PublicInvoice,
    PublicInvoiceItem, PublicPayment,
};

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
pub(crate) fn fill_template(template: &str, map: &HashMap<String, String>) -> String {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    let mut out = template.to_string();
    for k in keys {
        out = out.replace(&format!("{{{{{k}}}}}"), &map[k]);
    }
    out
}

/// All data required to render an invoice to any output format.

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

    // FBR verification section (QR shown whenever show_qr is enabled in settings).
    let mut fbr_section = String::new();
    let show_fbr = doc.settings.show_qr;
    if show_fbr {
        // FBR-compliant QR: {IRN}|{InvoiceDate}|{STRN}|{TotalBillAmount} (spec section 17.5)
        // Falls back to local JSON payload when no IRN is available yet.
        let qr_content = if let Some(ref irn) = doc.invoice.irn {
            let strn = doc.settings.company_strn.as_deref().unwrap_or("");
            crate::commands::fbr::fbr_qr_content(
                irn,
                &doc.invoice.invoice_date,
                strn,
                doc.invoice.grand_total as f64 / 100.0,
            )
        } else {
            let fbr_payload = serde_json::json!({
                "InvoiceNo": doc.invoice.invoice_number,
                "Date": doc.invoice.invoice_date,
                "Total": fmt_paisa(doc.invoice.grand_total),
                "Tax": fmt_paisa(doc.invoice.tax_total),
                "Type": "INVOICE",
            });
            serde_json::to_string(&fbr_payload).unwrap_or_default()
        };
        let qr_svg = qr_svg(&qr_content, 100);
        if !qr_svg.is_empty() {
            fbr_section.push_str(
                r#"<div class="fbr-box"><div class="fbr-info"><strong>Digital Verification Box</strong><br>"#,
            );
            if let Some(ref irn) = doc.invoice.irn {
                fbr_section.push_str(&format!("IRN: {}<br>", html_escape(irn)));
            }
            if let Some(ref ntn) = doc.settings.company_ntn {
                if !ntn.trim().is_empty() {
                    fbr_section.push_str(&format!("Company NTN: {}<br>", html_escape(ntn)));
                }
            }
            if let Some(ref strn) = doc.settings.company_strn {
                if !strn.trim().is_empty() {
                    fbr_section.push_str(&format!("STRN: {}<br>", html_escape(strn)));
                }
            }
            if !doc.customer.buyer_type.trim().is_empty() {
                fbr_section.push_str(&format!(
                    "Buyer Type: {}<br>",
                    html_escape(&doc.customer.buyer_type)
                ));
            }
            if let Some(ref c) = doc.customer.ntn {
                if !c.trim().is_empty() {
                    fbr_section.push_str(&format!("Buyer NTN: {}<br>", html_escape(c)));
                }
            }
            if let Some(ref c) = doc.customer.cnic {
                if !c.trim().is_empty() {
                    fbr_section.push_str(&format!("Buyer CNIC: {}<br>", html_escape(c)));
                }
            }
            fbr_section.push_str("</div>");
            fbr_section.push_str(&format!(
                r#"<div class="fbr-qr">{qr_svg}<div>Verify Invoice</div></div>"#
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

    let signature_box_html = r#"<div class="signature-box">
        <div class="signature-line">Customer Signature</div>
        <div class="signature-line">Authorized Signature</div>
    </div>"#.to_string();
    vals.insert("signature_box_html".to_string(), signature_box_html);

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
        .signature-box {
            display: flex;
            justify-content: space-between;
            margin-top: 36px;
            padding-top: 8px;
            font-size: 11px;
        }
        .signature-line {
            border-top: 1px dashed #777;
            width: 180px;
            text-align: center;
            padding-top: 4px;
            color: #555;
        }

        /* design: wholesale_a4 */
        body.wholesale_a4 { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body.wholesale_a4 .sheet { max-width: 860px; padding: 24px 32px; border: 1px solid #ddd; }
        body.wholesale_a4 table.items th { background: var(--accent); color: #fff; font-size: 11px; text-transform: uppercase; }

        /* design: thermal_80mm (POS slip) */
        body.thermal_80mm, body.thermal {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 11px;
            color: #000;
            background: #e5e7eb;
        }
        body.thermal_80mm .sheet, body.thermal .sheet {
            max-width: 80mm;
            width: 80mm;
            padding: 6mm 4mm;
            margin: 10px auto;
            border-radius: 0;
            border: 1px dashed #999;
            box-shadow: none;
            background: #fff;
        }
        body.thermal_80mm .inv-header, body.thermal .inv-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            border-bottom: 1px dashed #000;
            padding-bottom: 8px;
            gap: 4px;
        }
        body.thermal_80mm .brand .company-name, body.thermal .brand .company-name { font-size: 16px; font-weight: 900; }
        body.thermal_80mm .invoice-title, body.thermal .invoice-title { font-size: 13px; text-align: center; margin-top: 4px; }
        body.thermal_80mm .invoice-meta, body.thermal .invoice-meta { text-align: center; font-size: 10px; }
        body.thermal_80mm .parties, body.thermal .parties { grid-template-columns: 1fr; gap: 6px; }
        body.thermal_80mm .info-box, body.thermal .info-box { border: 1px dashed #aaa; padding: 6px; font-size: 10px; border-radius: 0; }
        body.thermal_80mm table.items, body.thermal table.items { font-size: 10px; }
        body.thermal_80mm table.items th, body.thermal table.items th { background: transparent; color: #000; border-bottom: 1px solid #000; padding: 4px 2px; }
        body.thermal_80mm table.items td, body.thermal table.items td { padding: 4px 2px; border-bottom: 1px dotted #ccc; }
        body.thermal_80mm .totals-box, body.thermal .totals-box { width: 100%; font-size: 11px; }
        body.thermal_80mm .signature-box, body.thermal .signature-box { display: flex; justify-content: space-between; margin-top: 24px; font-size: 9px; }
        body.thermal_80mm .signature-line, body.thermal .signature-line { width: 100px; font-size: 9px; }

        /* design: compact_a5 */
        body.compact_a5 { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; }
        body.compact_a5 .sheet { max-width: 620px; padding: 16px 22px; }
        body.compact_a5 .inv-header { padding-bottom: 8px; margin-bottom: 10px; }
        body.compact_a5 .company-name { font-size: 18px; }
        body.compact_a5 table.items th { padding: 5px 6px; font-size: 10px; }
        body.compact_a5 table.items td { padding: 5px 6px; font-size: 10px; }
        body.compact_a5 .totals-box { width: 220px; font-size: 11px; }

        @media print {
            body { background: #fff; padding: 0; }
            .sheet { margin: 0; border: none; border-radius: 0; box-shadow: none; }
            .no-print, .print-bar { display: none !important; }
            body.thermal_80mm .sheet, body.thermal .sheet {
                width: 100% !important;
                max-width: 100% !important;
                padding: 0 !important;
                border: none !important;
            }
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

        {{signature_box_html}}

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
) -> Result<String, AppError> {
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
    std::fs::write(&file_path, &html).map_err(|e| AppError::internal(format!("Failed to write HTML: {e}")))?;

    let path_str = file_path.to_string_lossy().to_string();
    open_with_default(&app_handle, &path_str, "invoice");

    Ok(html)
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
        include_bytes!("../../../../src/assets/sample-invoice-template.xlsx");
    std::fs::write(&save_path, SAMPLE)
        .map_err(|e| AppError::internal(format!("Failed to write sample template: {e}")))?;
    Ok(save_path)
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


/// Renders a QR code payload as an inline SVG at least `size` pixels wide.
pub(crate) fn qr_svg(payload: &str, size: u32) -> String {
    match QrCode::new(payload.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(size, size)
            .quiet_zone(true)
            .build(),
        Err(_) => String::new(),
    }
}

// / Formats a Unix timestamp into a readable date string
