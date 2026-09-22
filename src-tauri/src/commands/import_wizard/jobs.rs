use super::types::*;
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// IMPORT JOBS, QUOTAS & ROLLBACK
// ==========================================

// ==========================================
// IMPORT JOBS (spec §23.3 / §23.12)
// ==========================================

/// Creates an `import_jobs` row so the run can be rolled back later.
/// The row starts as `pending`; the background worker flips it to
/// `processing` when it starts and to `completed`/`failed` when it finishes.
pub async fn check_import_quotas(pool: &SqlitePool, company_id: &str) -> Result<(), AppError> {
    // Concurrent jobs: a company may only have ONE pending/processing import
    // at a time (spec §23.10).
    let running: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM import_jobs
         WHERE company_id = ? AND status IN ('pending', 'processing')",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Quota check error: {e}")))?;
    if running >= MAX_CONCURRENT_JOBS_PER_COMPANY {
        return Err(AppError::validation(
            "Another import is still running for this company. Wait for it to finish \
             before starting a new one (concurrency limit: 1).",
        ));
    }

    // Hourly cap: at most N import jobs per hour per company (spec §23.10).
    let since = now_unix() as i64 - QUOTA_HOUR_SECS;
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM import_jobs
         WHERE company_id = ? AND CAST(created_at AS INTEGER) >= ?",
    )
    .bind(company_id)
    .bind(since)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Quota check error: {e}")))?;
    if recent >= MAX_JOBS_PER_HOUR_PER_COMPANY {
        return Err(AppError::internal(format!(
            "Hourly import quota reached ({MAX_JOBS_PER_HOUR_PER_COMPANY} jobs per hour). \
             Wait an hour or roll back an earlier import before continuing."
        )));
    }

    Ok(())
}

/// Creates an `import_jobs` row so the run can be rolled back later.
/// The row starts as `pending`; the background worker flips it to
/// `processing` when it starts and to `completed`/`failed` when it finishes.
pub async fn create_import_job(
    pool: &SqlitePool,
    company_id: &str,
    user: &crate::commands::auth::PublicUser,
    request: &ImportRequest,
    data_rows: usize,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = import_timestamp(now_unix());
    let file_name = request.file_name.clone().unwrap_or_default();
    let mappings_json =
        serde_json::to_string(&request.mappings).unwrap_or_else(|_| "[]".to_string());

    sqlx::query(
        r#"
        INSERT INTO import_jobs
            (id, company_id, file_type, file_name, status, target,
             total_rows, processed_rows, attempted_rows, error_rows, column_mappings,
             created_by, started_at, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, 0, 0, ?, ?, NULL, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&request.file_type)
    .bind(&file_name)
    .bind(&request.target)
    .bind(data_rows as i64)
    .bind(&mappings_json)
    .bind(&user.id)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| AppError::internal(format!("Failed to create import job: {e}")))?;

    Ok(id)
}

/// Flushes live progress counters during a background import run.
pub async fn update_import_progress(
    pool: &SqlitePool,
    job_id: &str,
    attempted_rows: usize,
    processed_rows: i64,
    error_rows: i64,
) {
    let _ = sqlx::query(
        r#"
        UPDATE import_jobs
        SET attempted_rows = ?, processed_rows = ?, error_rows = ?
        WHERE id = ?
        "#,
    )
    .bind(attempted_rows as i64)
    .bind(processed_rows)
    .bind(error_rows)
    .bind(job_id)
    .execute(pool)
    .await;
}

/// Marks a finished import job as completed (or failed) with its full result.
pub async fn finish_import_job(
    pool: &SqlitePool,
    job_id: &str,
    result: &ImportResult,
    attempted_rows: usize,
) {
    let error_details = if result.errors.is_empty() {
        None
    } else {
        serde_json::to_string(
            &result
                .errors
                .iter()
                .map(|e| serde_json::json!({ "rowNumber": e.row_number, "reason": e.reason }))
                .collect::<Vec<_>>(),
        )
        .ok()
    };
    let now = import_timestamp(now_unix());
    let imported = (result.products_imported + result.customers_imported + result.items_imported)
        as i64;
    // Mark the job as failed when nothing was imported but errors occurred
    // (e.g. every row rejected). Any successful import counts as completed.
    let status = if result.rows_with_errors > 0 && imported == 0 {
        "failed"
    } else {
        "completed"
    };
    // Persist the full result so a polling client can render the same
    // result screen as the old synchronous flow.
    let result_json = serde_json::to_string(result).ok();

    let _ = sqlx::query(
        r#"
        UPDATE import_jobs
        SET status = ?, processed_rows = ?, attempted_rows = ?, error_rows = ?,
            error_details = ?, result_json = ?, completed_at = ?
        WHERE id = ?
        "#,
    )
    .bind(status)
    .bind(imported)
    .bind(attempted_rows as i64)
    .bind(result.rows_with_errors as i64)
    .bind(&error_details)
    .bind(&result_json)
    .bind(&now)
    .bind(job_id)
    .execute(pool)
    .await;
}

/// 0–100 progress for a job. Terminal jobs report 100; running jobs report
/// how many rows have been attempted against the total.
fn job_progress(status: &str, total_rows: i64, attempted_rows: i64) -> i64 {
    if matches!(status, "completed" | "failed" | "rolled_back") {
        return 100;
    }
    if total_rows <= 0 {
        return 0;
    }
    ((attempted_rows * 100) / total_rows).clamp(0, 100)
}

/// Lists recent import jobs for the current company.
#[tauri::command]
pub async fn list_import_jobs(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<ImportJob>, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("You are not assigned to a company")?;

    let now = now_unix();
    let rows = sqlx::query_as::<_, (String, String, Option<String>, String, String, i64, i64, i64, i64, Option<String>, Option<String>, String, Option<String>, String)>(
        r#"
        SELECT id, file_type, file_name, target, status, total_rows, processed_rows,
               attempted_rows, error_rows, error_details, result_json, created_by,
               completed_at, created_at
        FROM import_jobs
        WHERE company_id = ?
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(rows
        .into_iter()
        .map(|(id, file_type, file_name, target, status, total_rows, processed_rows, attempted_rows, error_rows, error_details, result_json, created_by, completed_at, created_at)| {
            let rollback_available = status == "completed"
                && completed_at
                    .as_deref()
                    .and_then(|t| t.parse::<u64>().ok())
                    .map(|t| now.saturating_sub(t) <= ROLLBACK_WINDOW_SECS)
                    .unwrap_or(false);
            let progress = job_progress(&status, total_rows, attempted_rows);
            let imported_records = result_json
                .as_deref()
                .and_then(|j| serde_json::from_str::<ImportResult>(j).ok())
                .map(|r| {
                    (r.products_imported + r.customers_imported + r.items_imported) as i64
                })
                .unwrap_or_else(|| (processed_rows - error_rows).max(0));
            ImportJob {
                id,
                file_type,
                file_name,
                target,
                status,
                total_rows,
                processed_rows,
                attempted_rows,
                error_rows,
                progress,
                error_details,
                created_by,
                created_at,
                completed_at,
                rollback_available,
                imported_records,
            }
        })
        .collect())
}

/// Polls a single import job (live progress + final result). The frontend
/// calls this every few hundred ms after `execute_import` returns.
#[tauri::command]
pub async fn get_import_job(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    job_id: String,
) -> Result<ImportJobStatus, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("You are not assigned to a company")?;

    let row = sqlx::query_as::<_, (String, String, Option<String>, String, String, i64, i64, i64, i64, Option<String>, Option<String>, String, Option<String>, String)>(
        r#"
        SELECT id, file_type, file_name, target, status, total_rows, processed_rows,
               attempted_rows, error_rows, error_details, result_json, created_by,
               completed_at, created_at
        FROM import_jobs
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&job_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Import job not found")?;

    let (id, file_type, file_name, target, status, total_rows, processed_rows, attempted_rows, error_rows, error_details, result_json, created_by, completed_at, created_at) = row;

    let now = now_unix();
    let rollback_available = status == "completed"
        && completed_at
            .as_deref()
            .and_then(|t| t.parse::<u64>().ok())
            .map(|t| now.saturating_sub(t) <= ROLLBACK_WINDOW_SECS)
            .unwrap_or(false);
    let progress = job_progress(&status, total_rows, attempted_rows);
    let result = result_json
        .as_deref()
        .and_then(|j| serde_json::from_str::<ImportResult>(j).ok());
    let imported_records = result
        .as_ref()
        .map(|r| (r.products_imported + r.customers_imported + r.items_imported) as i64)
        .unwrap_or_else(|| (processed_rows - error_rows).max(0));

    Ok(ImportJobStatus {
        job: ImportJob {
            id,
            file_type,
            file_name,
            target,
            status,
            total_rows,
            processed_rows,
            attempted_rows,
            error_rows,
            progress,
            error_details,
            created_by,
            created_at,
            completed_at,
            rollback_available,
            imported_records,
        },
        result,
    })
}

/// Rolls back a completed import: removes the tagged records and reverts
/// opening-stock quantity changes. Only available within 24h of completion.
#[tauri::command]
pub async fn rollback_import(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    job_id: String,
) -> Result<RollbackResult, AppError> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("You are not assigned to a company")?;

    let job = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT status, company_id, completed_at FROM import_jobs WHERE id = ?",
    )
    .bind(&job_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Import job not found")?;

    let (status, job_company, completed_at) = job;
    if job_company != *company_id {
        return Err(AppError::internal("Import job does not belong to your company".to_string()));
    }
    if status == "rolled_back" {
        return Err(AppError::internal("This import has already been rolled back".to_string()));
    }
    if status != "completed" {
        return Err(AppError::internal(format!("Only completed imports can be rolled back (status: {status})")));
    }
    let completed_secs = completed_at
        .as_deref()
        .and_then(|t| t.parse::<u64>().ok())
        .ok_or("Import job has no completion time")?;
    if now_unix().saturating_sub(completed_secs) > ROLLBACK_WINDOW_SECS {
        return Err(AppError::internal("Rollback window (24 hours) has expired".to_string()));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Failed to start transaction: {e}")))?;

    // 1. Revert opening-stock quantity increments first (movements tagged
    //    with the 'Opening stock from import' note).
    let mut quantity_reverted: i64 = 0;
    let movements: Vec<(String, i64)> = sqlx::query_as(
        "SELECT product_id, quantity FROM stock_movements
         WHERE import_batch_id = ? AND reference_note = 'Opening stock from import'",
    )
    .bind(&job_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Failed to read movements: {e}")))?;

    for (product_id, quantity) in movements {
        sqlx::query(
            "UPDATE products SET quantity_in_stock = MAX(quantity_in_stock - ?, 0),
             updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
        )
        .bind(quantity)
        .bind(&product_id)
        .bind(company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Failed to revert stock: {e}")))?;
        quantity_reverted += quantity;
    }

    let movements_deleted = sqlx::query("DELETE FROM stock_movements WHERE import_batch_id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Failed to delete movements: {e}")))?
        .rows_affected() as i64;

    let batches_deleted = sqlx::query("DELETE FROM stock_batches WHERE import_batch_id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Failed to delete batches: {e}")))?
        .rows_affected() as i64;

    let customers_deleted =
        sqlx::query("DELETE FROM customers WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete customers: {e}")))?
            .rows_affected() as i64;

    let products_deleted =
        sqlx::query("DELETE FROM products WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete products: {e}")))?
            .rows_affected() as i64;

    let suppliers_deleted =
        sqlx::query("DELETE FROM suppliers WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete suppliers: {e}")))?
            .rows_affected() as i64;

    // Invoices / purchase bills must be removed before their line items so
    // the trigger that blocks items on finalized/paid invoices cannot fire.
    let invoices_deleted =
        sqlx::query("DELETE FROM invoices WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete invoices: {e}")))?
            .rows_affected() as i64;

    let purchase_bills_deleted =
        sqlx::query("DELETE FROM purchase_orders WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete purchase bills: {e}")))?
            .rows_affected() as i64;

    let _invoice_items_deleted =
        sqlx::query("DELETE FROM invoice_items WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete invoice items: {e}")))?
            .rows_affected() as i64;

    let _po_items_deleted =
        sqlx::query("DELETE FROM purchase_order_items WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Failed to delete purchase bill items: {e}")))?
            .rows_affected() as i64;

    sqlx::query("UPDATE import_jobs SET status = 'rolled_back' WHERE id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Failed to update job: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Failed to commit rollback: {e}")))?;

    Ok(RollbackResult {
        products_deleted,
        customers_deleted,
        suppliers_deleted,
        invoices_deleted,
        purchase_bills_deleted,
        movements_deleted,
        batches_deleted,
        quantity_reverted,
    })
}
