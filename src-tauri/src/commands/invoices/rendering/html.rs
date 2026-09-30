use sqlx::SqlitePool;
use tauri::State;

use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;

use super::common::{
    fill_template, fmt_paisa, html_escape, invoice_placeholder_values, load_invoice_doc,
    open_with_default, qr_svg,
};
use super::super::types::InvoiceDoc;

/// Renders a full, standalone HTML document for an invoice using the
/// company's configured design (classic / modern / minimal) and accent color.
fn build_invoice_html(doc: &InvoiceDoc) -> String {
    let mut vals = invoice_placeholder_values(doc);

    // Safely HTML-escape all raw text fields specifically for HTML rendering
    for (k, v) in vals.iter_mut() {
        if !k.ends_with("_html") && !k.ends_with("_row") && k != "accent" && k != "design" {
            *v = html_escape(v);
        }
    }

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

    let signature_box_html = if doc.settings.show_signatures {
        r#"<div class="signature-box">
        <div class="signature-line">Customer Signature</div>
        <div class="signature-line">Authorized Signature</div>
    </div>"#
            .to_string()
    } else {
        String::new()
    };
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

        /* design: thermal_80mm (Standard POS Slip) */
        body.thermal_80mm, body.thermal {
            font-family: 'Courier New', Courier, Consolas, monospace, sans-serif;
            font-size: 11px;
            line-height: 1.3;
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
            gap: 3px;
        }
        body.thermal_80mm .brand .company-name, body.thermal .brand .company-name { font-size: 17px; font-weight: 900; letter-spacing: -0.5px; }
        body.thermal_80mm .invoice-title, body.thermal .invoice-title { font-size: 12px; font-weight: 700; text-align: center; margin-top: 4px; }
        body.thermal_80mm .invoice-meta, body.thermal .invoice-meta { text-align: center; font-size: 10px; }
        body.thermal_80mm .parties, body.thermal .parties { grid-template-columns: 1fr; gap: 4px; margin-bottom: 8px; }
        body.thermal_80mm .info-box, body.thermal .info-box { border: 1px dashed #888; padding: 6px; font-size: 10px; border-radius: 0; }
        body.thermal_80mm table.items, body.thermal table.items { font-size: 10px; width: 100%; border-collapse: collapse; }
        body.thermal_80mm table.items th, body.thermal table.items th { background: transparent; color: #000; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 2px; }
        body.thermal_80mm table.items td, body.thermal table.items td { padding: 4px 2px; border-bottom: 1px dotted #ccc; }
        body.thermal_80mm table.items tr:nth-child(even), body.thermal table.items tr:nth-child(even) { background: transparent; }
        body.thermal_80mm .totals, body.thermal .totals { justify-content: stretch; width: 100%; margin-bottom: 12px; }
        body.thermal_80mm .totals-box, body.thermal .totals-box { width: 100%; font-size: 11px; }
        body.thermal_80mm .totals-row.grand, body.thermal .totals-row.grand { font-size: 15px; font-weight: 900; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 4px 0; }
        body.thermal_80mm .signature-box, body.thermal .signature-box { display: flex; justify-content: space-between; margin-top: 20px; font-size: 9px; }
        body.thermal_80mm .signature-line, body.thermal .signature-line { width: 100px; font-size: 9px; }
        body.thermal_80mm .fbr-box, body.thermal .fbr-box { border: 1px dashed #000; background: #fff; padding: 6px; flex-direction: column; align-items: center; text-align: center; }

        /* In thermal 80mm receipts, hide column 1 (#), 5 (tax %), 6 (tax amt), 7 (discount) for 4-column receipt table */
        body.thermal_80mm table.items th:nth-child(1), body.thermal_80mm table.items td:nth-child(1),
        body.thermal_80mm table.items th:nth-child(5), body.thermal_80mm table.items td:nth-child(5),
        body.thermal_80mm table.items th:nth-child(6), body.thermal_80mm table.items td:nth-child(6),
        body.thermal_80mm table.items th:nth-child(7), body.thermal_80mm table.items td:nth-child(7),
        body.thermal table.items th:nth-child(1), body.thermal table.items td:nth-child(1),
        body.thermal table.items th:nth-child(5), body.thermal table.items td:nth-child(5),
        body.thermal table.items th:nth-child(6), body.thermal table.items td:nth-child(6),
        body.thermal table.items th:nth-child(7), body.thermal table.items td:nth-child(7) {
            display: none;
        }

        /* design: thermal_58mm (Compact 2-inch POS Slip) */
        body.thermal_58mm {
            font-family: 'Courier New', Courier, Consolas, monospace, sans-serif;
            font-size: 9.5px;
            line-height: 1.25;
            color: #000;
            background: #e5e7eb;
        }
        body.thermal_58mm .sheet {
            max-width: 58mm;
            width: 58mm;
            padding: 4mm 2mm;
            margin: 8px auto;
            border-radius: 0;
            border: 1px dashed #999;
            box-shadow: none;
            background: #fff;
        }
        body.thermal_58mm .inv-header {
            flex-direction: column;
            align-items: center;
            text-align: center;
            border-bottom: 1px dashed #000;
            padding-bottom: 6px;
            gap: 2px;
        }
        body.thermal_58mm .brand .company-name { font-size: 14px; font-weight: 900; }
        body.thermal_58mm .invoice-title { font-size: 11px; font-weight: 700; text-align: center; margin-top: 2px; }
        body.thermal_58mm .invoice-meta { text-align: center; font-size: 8.5px; }
        body.thermal_58mm .parties { grid-template-columns: 1fr; gap: 4px; margin-bottom: 6px; }
        body.thermal_58mm .info-box { border: 1px dashed #888; padding: 4px; font-size: 8.5px; border-radius: 0; }
        body.thermal_58mm table.items { font-size: 8.5px; width: 100%; border-collapse: collapse; }
        body.thermal_58mm table.items th { background: transparent; color: #000; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 1px; font-size: 8.5px; }
        body.thermal_58mm table.items td { padding: 3px 1px; border-bottom: 1px dotted #ccc; font-size: 8.5px; }
        body.thermal_58mm table.items tr:nth-child(even) { background: transparent; }
        body.thermal_58mm .totals { justify-content: stretch; width: 100%; margin-bottom: 8px; }
        body.thermal_58mm .totals-box { width: 100%; font-size: 9.5px; }
        body.thermal_58mm .totals-row.grand { font-size: 13px; font-weight: 900; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 3px 0; }
        body.thermal_58mm .signature-box { display: flex; justify-content: space-between; margin-top: 14px; font-size: 8px; }
        body.thermal_58mm .signature-line { width: 70px; font-size: 8px; }
        body.thermal_58mm .fbr-box { border: 1px dashed #000; background: #fff; padding: 4px; flex-direction: column; align-items: center; text-align: center; font-size: 8px; }
        body.thermal_58mm table.items th:nth-child(1), body.thermal_58mm table.items td:nth-child(1),
        body.thermal_58mm table.items th:nth-child(5), body.thermal_58mm table.items td:nth-child(5),
        body.thermal_58mm table.items th:nth-child(6), body.thermal_58mm table.items td:nth-child(6),
        body.thermal_58mm table.items th:nth-child(7), body.thermal_58mm table.items td:nth-child(7) {
            display: none;
        }

        /* design: compact_a5 */
        body.compact_a5 { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; }
        body.compact_a5 .sheet { max-width: 620px; padding: 16px 22px; }
        body.compact_a5 .inv-header { padding-bottom: 8px; margin-bottom: 10px; }
        body.compact_a5 .company-name { font-size: 18px; }
        body.compact_a5 table.items th { padding: 5px 6px; font-size: 10px; }
        body.compact_a5 table.items td { padding: 5px 6px; font-size: 10px; }
        body.compact_a5 .totals-box { width: 220px; font-size: 11px; }

        @media print {
            @page { margin: 0; size: auto; }
            body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
            .sheet { margin: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; }
            .no-print, .print-bar { display: none !important; }
            body.thermal_80mm, body.thermal {
                width: 80mm !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            body.thermal_80mm .sheet, body.thermal .sheet {
                width: 80mm !important;
                max-width: 80mm !important;
                padding: 3mm 2mm !important;
                margin: 0 !important;
                border: none !important;
            }
            body.thermal_58mm {
                width: 58mm !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            body.thermal_58mm .sheet {
                width: 58mm !important;
                max-width: 58mm !important;
                padding: 2mm 1mm !important;
                margin: 0 !important;
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
            <div class="footer-line">Generated by Corbel ERP — {{generated_at}}</div>
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
    design_override: Option<String>,
    open_in_browser: Option<bool>,
) -> Result<String, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let mut doc = load_invoice_doc(pool.inner(), &invoice_id, company_id).await?;
    if let Some(ref override_design) = design_override {
        if !override_design.trim().is_empty() {
            doc.settings.invoice_design = override_design.clone();
        }
    }
    let html = build_invoice_html(&doc);

    let temp_dir = std::env::temp_dir();
    let filename = format!("invoice_{}.html", doc.invoice.invoice_number.replace('/', "_"));
    let file_path = temp_dir.join(&filename);
    std::fs::write(&file_path, &html).map_err(|e| AppError::internal(format!("Failed to write HTML: {e}")))?;

    if open_in_browser.unwrap_or(false) {
        let path_str = file_path.to_string_lossy().to_string();
        open_with_default(&app_handle, &path_str, "invoice");
    }

    Ok(html)
}
