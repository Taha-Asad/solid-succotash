// ==========================================
// RETENTION POLICY & ARCHIVAL
// ==========================================
//
// ETO 5-year retention: data older than 5 years is archived,
// not deleted. Archived records are moved to archive tables
// and excluded from normal queries.
//
// For desktop v1.0: we create the archive infrastructure
// and provide a manual "Archive Old Data" button.
// Automatic scheduling comes later.

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionSummary {
    pub invoices_archivable: i64,
    pub po_archivable: i64,
    pub movements_archivable: i64,
    pub oldest_invoice_date: Option<String>,
    pub oldest_movement_date: Option<String>,
}

/// Counts records eligible for archival (older than cutoff years).
#[tauri::command]
pub async fn get_retention_summary(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    retention_years: i64,
) -> Result<RetentionSummary, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    if user.role != "owner" {
        return Err("Only owner can manage retention".to_string());
    }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let years = if retention_years < 1 { 5 } else { retention_years };

    // Calculate cutoff date
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let cutoff_days = now - (years as u64 * 365 * 86400);
    let cutoff = format_timestamp(cutoff_days);

    let inv_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoices WHERE company_id = ? AND status IN ('paid','cancelled') AND invoice_date < ? AND deleted_at IS NULL"
    )
    .bind(company_id).bind(&cutoff)
    .fetch_one(pool.inner()).await.unwrap_or(0);

    let po_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM purchase_orders WHERE company_id = ? AND status IN ('paid','cancelled') AND po_date < ? AND deleted_at IS NULL"
    )
    .bind(company_id).bind(&cutoff)
    .fetch_one(pool.inner()).await.unwrap_or(0);

    let mov_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM stock_movements WHERE company_id = ? AND created_at < ?"
    )
    .bind(company_id).bind(&cutoff)
    .fetch_one(pool.inner()).await.unwrap_or(0);

    let oldest_inv: Option<String> = sqlx::query_scalar(
        "SELECT MIN(invoice_date) FROM invoices WHERE company_id = ? AND deleted_at IS NULL"
    )
    .bind(company_id).fetch_one(pool.inner()).await.unwrap_or(None);

    let oldest_mov: Option<String> = sqlx::query_scalar(
        "SELECT MIN(created_at) FROM stock_movements WHERE company_id = ?"
    )
    .bind(company_id).fetch_one(pool.inner()).await.unwrap_or(None);

    Ok(RetentionSummary {
        invoices_archivable: inv_count,
        po_archivable: po_count,
        movements_archivable: mov_count,
        oldest_invoice_date: oldest_inv,
        oldest_movement_date: oldest_mov,
    })
}

/// Archives old paid/cancelled invoices by soft-deleting them.
/// Returns how many were archived.
#[tauri::command]
pub async fn archive_old_records(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    retention_years: i64,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    if user.role != "owner" {
        return Err("Only owner can archive data".to_string());
    }
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let years = if retention_years < 1 { 5 } else { retention_years };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let cutoff_days = now - (years as u64 * 365 * 86400);
    let cutoff = format_timestamp(cutoff_days);

    // Soft-delete old paid/cancelled invoices
    let inv = sqlx::query(
        "UPDATE invoices SET deleted_at = CURRENT_TIMESTAMP WHERE company_id = ? AND status IN ('paid','cancelled') AND invoice_date < ? AND deleted_at IS NULL"
    )
    .bind(company_id).bind(&cutoff)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    // Soft-delete old paid/cancelled POs
    let po = sqlx::query(
        "UPDATE purchase_orders SET deleted_at = CURRENT_TIMESTAMP WHERE company_id = ? AND status IN ('paid','cancelled') AND po_date < ? AND deleted_at IS NULL"
    )
    .bind(company_id).bind(&cutoff)
    .execute(pool.inner()).await.map_err(|e| format!("Error: {e}"))?;

    Ok(format!(
        "Archived {} invoices and {} purchase orders older than {} years.",
        inv.rows_affected(), po.rows_affected(), years
    ))
}

fn format_timestamp(secs: u64) -> String {
    let days = secs / 86400;
    let mut y = 1970u64;
    let mut rem = days;
    loop {
        let d = if (y%4==0&&y%100!=0)||(y%400==0) {366} else {365};
        if rem < d { break; }
        rem -= d; y += 1;
    }
    let leap = (y%4==0&&y%100!=0)||(y%400==0);
    let md = [31,if leap{29}else{28},31,30,31,30,31,31,30,31,30,31];
    let mut mo = 1u64;
    for &d in &md { if rem < d { break; } rem -= d; mo += 1; }
    format!("{:04}-{:02}-{:02}", y, mo, rem + 1)
}
