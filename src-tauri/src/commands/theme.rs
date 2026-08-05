// ==========================================
// THEME & BRANDING COMMANDS
// ==========================================

use crate::commands::auth::{require_current_user, SessionState};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

/// Platform copyright notice. Owned by the super admin / platform vendor.
/// Tenant companies can never change this — `update_theme` always forces it.
pub const PLATFORM_WATERMARK: &str = "Powered by Ijaz & Company ERP";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyTheme {
    pub primary_color: String,
    pub secondary_color: String,
    pub accent_color: String,
    pub color_scheme: String,
    pub logo_base64: Option<String>,
    pub company_tagline: Option<String>,
    pub erp_watermark: String,
}

/// Tenant-editable subset of the theme. Intentionally has NO watermark field —
/// the ERP watermark is platform-owned (super admin) and cannot be changed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThemeInput {
    pub primary_color: String,
    pub secondary_color: String,
    pub accent_color: String,
    pub color_scheme: String,
    pub logo_base64: Option<String>,
    pub company_tagline: Option<String>,
}

#[tauri::command]
pub async fn get_theme(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<CompanyTheme, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let existing = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, String)>(
        "SELECT primary_color, secondary_color, accent_color, color_scheme, logo_base64, company_tagline, erp_watermark FROM company_theme WHERE company_id = ?"
    )
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    if let Some((p, s, a, cs, logo, tag, wm)) = existing {
        return Ok(CompanyTheme {
            primary_color: p, secondary_color: s, accent_color: a,
            color_scheme: cs, logo_base64: logo, company_tagline: tag, erp_watermark: wm,
        });
    }

    // Return defaults
    Ok(CompanyTheme {
        primary_color: "#2563eb".to_string(),
        secondary_color: "#7c3aed".to_string(),
        accent_color: "#059669".to_string(),
        color_scheme: "light".to_string(),
        logo_base64: None,
        company_tagline: None,
        erp_watermark: "Powered by Ijaz & Company ERP".to_string(),
    })
}

#[tauri::command]
pub async fn update_theme(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    input: UpdateThemeInput,
) -> Result<CompanyTheme, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;

    if user.role == "employee" {
        return Err("Only owner/admin can change theme".to_string());
    }

    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    // The ERP watermark is platform-owned (super admin). Tenants can never
    // change it — there is no watermark field in UpdateThemeInput.
    let erp_watermark = PLATFORM_WATERMARK.to_string();

    // let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO company_theme
            (company_id, primary_color, secondary_color, accent_color,
             color_scheme, logo_base64, company_tagline, erp_watermark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
            primary_color = excluded.primary_color,
            secondary_color = excluded.secondary_color,
            accent_color = excluded.accent_color,
            color_scheme = excluded.color_scheme,
            logo_base64 = excluded.logo_base64,
            company_tagline = excluded.company_tagline,
            erp_watermark = excluded.erp_watermark,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(company_id)
    .bind(&input.primary_color)
    .bind(&input.secondary_color)
    .bind(&input.accent_color)
    .bind(&input.color_scheme)
    .bind(&input.logo_base64)
    .bind(&input.company_tagline)
    .bind(&erp_watermark)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    Ok(CompanyTheme {
        primary_color: input.primary_color,
        secondary_color: input.secondary_color,
        accent_color: input.accent_color,
        color_scheme: input.color_scheme,
        logo_base64: input.logo_base64,
        company_tagline: input.company_tagline,
        erp_watermark,
    })
}

/// Reads an image file and returns it as a base64 data URI (for logo upload).
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
    let mime = match path.to_lowercase().rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        BASE64.encode(bytes)
    ))
}
