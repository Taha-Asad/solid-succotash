use sqlx::{Row, SqlitePool};
use tauri::State;

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::error::AppError;

use super::super::math::clean_optional;
use super::super::types::InvoiceSettings;

/// Gets or creates invoice settings for a company
pub async fn get_or_create_settings(
    pool: &SqlitePool,
    company_id: &str,
) -> Result<InvoiceSettings, AppError> {
    // Try to get existing
    let existing = sqlx::query(
        r#"
        SELECT company_ntn, company_strn, company_cnic,
               invoice_prefix, next_number, default_due_days,
               invoice_footer, terms_conditions,
               invoice_design, design_accent_color, show_qr,
               excel_template_base64, disclaimer, copyright, bank_details,
               show_signatures, show_previous_balance
        FROM company_invoice_settings
        WHERE company_id = ?
        "#,
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Settings lookup error: {e}")))?;

    if let Some(row) = existing {
        return Ok(InvoiceSettings {
            company_ntn: row.get("company_ntn"),
            company_strn: row.get("company_strn"),
            company_cnic: row.get("company_cnic"),
            invoice_prefix: row.get("invoice_prefix"),
            next_number: row.get("next_number"),
            default_due_days: row.get("default_due_days"),
            invoice_footer: row.get("invoice_footer"),
            terms_conditions: row.get("terms_conditions"),
            invoice_design: row.get("invoice_design"),
            design_accent_color: row.get("design_accent_color"),
            show_qr: row.get::<i64, _>("show_qr") != 0,
            excel_template_base64: row.get("excel_template_base64"),
            disclaimer: row.get("disclaimer"),
            copyright: row.get("copyright"),
            bank_details: row.get("bank_details"),
            show_signatures: row
                .get::<Option<i64>, _>("show_signatures")
                .map(|v| v != 0)
                .unwrap_or(true),
            show_previous_balance: row
                .get::<Option<i64>, _>("show_previous_balance")
                .map(|v| v != 0)
                .unwrap_or(true),
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
        show_signatures: true,
        show_previous_balance: true,
    })
}

/// Gets invoice settings for the company
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
    show_signatures: Option<bool>,
    show_previous_balance: Option<bool>,
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

    let design = if matches!(
        invoice_design.as_str(),
        "classic" | "modern" | "minimal" | "excel" | "wholesale_a4" | "thermal_80mm" | "compact_a5"
    ) {
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

    let show_sigs = show_signatures.unwrap_or(true);
    let show_prev_bal = show_previous_balance.unwrap_or(true);

    // Upsert settings
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO company_invoice_settings
            (id, company_id, company_ntn, company_strn, company_cnic,
             invoice_prefix, default_due_days, invoice_footer, terms_conditions,
             invoice_design, design_accent_color, show_qr,
             disclaimer, copyright, bank_details, show_signatures, show_previous_balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            show_signatures = excluded.show_signatures,
            show_previous_balance = excluded.show_previous_balance,
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
    .bind(if show_sigs { 1i64 } else { 0i64 })
    .bind(if show_prev_bal { 1i64 } else { 0i64 })
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
