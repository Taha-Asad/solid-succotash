use super::types::*;
use super::templates::{create_product_custom_fields, save_import_template};
use super::jobs::{check_import_quotas, create_import_job, finish_import_job, update_import_progress};
use super::readers::{read_csv_rows, read_docx_rows, read_excel_rows, read_image_rows, read_pdf_rows};
use super::products::{import_one_opening_stock_row, import_one_row, validate_opening_stock_row, validate_product_row};
use super::parties::{import_one_customer_row, import_one_supplier_row, validate_customer_row, validate_supplier_row};
use super::historical::{import_one_invoice_row, import_one_purchase_bill_row, validate_invoice_row, validate_purchase_bill_row};
use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

// ==========================================
// STEP 2: CONFIRM, BACKGROUND WORKER & DRY RUN
// ==========================================

// Rust creates custom field definitions and imports data.

#[tauri::command]
pub async fn execute_import(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    request: ImportRequest,
) -> Result<ImportResult, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let target = request.target.as_str();
    let (all_rows, _data_rows) = prepare_import(pool.inner(), company_id, &request).await?;

    // ---- Dry-run preview: validate every row, write nothing ----
    if request.dry_run {
        return run_dry_run(pool.inner(), company_id, target, &request, &all_rows).await;
    }

    // ---- Setup-only run: custom fields + template, no data, no job ----
    // No rows are written so there is nothing to track or roll back; run
    // synchronously because it is effectively instant.
    if !request.import_data {
        let fields_created = create_product_custom_fields(pool.inner(), company_id, &request).await;
        save_import_template(pool.inner(), company_id, &request).await;
        return Ok(ImportResult {
            fields_created,
            products_imported: 0,
            customers_imported: 0,
            items_imported: 0,
            rows_with_errors: 0,
            rows_skipped: 0,
            job_id: None,
            errors: Vec::new(),
        });
    }

    // ---- Confirm gate (spec §23.3) ----
    // Data is only ever committed through `confirm_import`, after the user has
    // reviewed the preview and explicitly confirmed. Refusing a bare commit
    // here means the first action on a file (upload/analyze/preview) can never
    // start writing rows.
    Err(AppError::validation(
        "Import not confirmed. Preview the file first, then call confirm_import to commit.",
    ))
}

/// Shared validation + row reading used by both the preview (`execute_import`)
/// and the confirmed commit (`confirm_import`).
async fn prepare_import(
    _pool: &SqlitePool,
    _company_id: &str,
    request: &ImportRequest,
) -> Result<(Vec<Vec<String>>, usize), AppError> {
    let target = request.target.as_str();
    if !IMPORT_TARGETS.contains(&target) {
        return Err(AppError::internal(format!(
            "Unknown import target '{target}'. Supported: {}",
            IMPORT_TARGETS.join(", ")
        )));
    }

    // ---- Quotas (spec §23.10) ----
    if request.import_data && request.file_bytes.is_empty() {
        return Err(AppError::validation("Uploaded import file is empty."));
    }

    if request.file_bytes.len() > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::internal(format!(
            "File too large ({} bytes). Maximum allowed is {} MB.",
            request.file_bytes.len(),
            MAX_IMPORT_FILE_BYTES / (1024 * 1024)
        )));
    }

    // Read the rows once (used for the quota check, dry-run preview, and import).
    let all_rows = if request.import_data {
        match request.file_type.as_str() {
            "xlsx" | "xls" => read_excel_rows(&request.file_bytes)?,
            "csv" => read_csv_rows(&request.file_bytes)?,
            "docx" => read_docx_rows(&request.file_bytes)?,
            "pdf" => read_pdf_rows(&request.file_bytes)?,
            "png" | "jpg" | "jpeg" => read_image_rows(&request.file_bytes)?,
            _ => {
                return Err(AppError::internal("Unsupported file type".to_string()));
            }
        }
    } else {
        Vec::new()
    };

    let data_rows = all_rows.len().saturating_sub(1);
    if data_rows > MAX_IMPORT_ROWS {
        return Err(AppError::internal(format!(
            "File has {data_rows} data rows. Maximum allowed is {MAX_IMPORT_ROWS} per import."
        )));
    }

    Ok((all_rows, data_rows))
}

/// Commits an import after the user confirmed the preview (spec §23.3).
///
/// This is the only command that creates an `import_jobs` row and starts the
/// background worker. It is invoked from the wizard's dedicated "Confirm &
/// Import" action — never from the preview/analysis step, so a file is never
/// committed by the user's first action.
#[tauri::command]
pub async fn confirm_import(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    request: ImportRequest,
) -> Result<ImportResult, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if !request.import_data {
        return Err(AppError::validation(
            "confirm_import requires import_data = true (nothing to commit otherwise).",
        ));
    }
    if request.dry_run {
        return Err(AppError::validation(
            "confirm_import cannot run a preview. Use execute_import with dry_run = true to preview, then confirm here.",
        ));
    }

    let (all_rows, data_rows) = prepare_import(pool.inner(), company_id, &request).await?;

    // ---- Quotas (spec §23.10) ----
    // Concurrency + hourly caps are only checked at commit time — analyzing
    // and previewing a file never creates a job, so it is never blocked.
    check_import_quotas(pool.inner(), company_id).await?;

    // ---- Background job: create the job, spawn the worker, return now ----
    // The worker drives `pending -> processing -> completed|failed` and the
    // frontend polls `get_import_job` for live progress. Counts are unknown
    // at submit time, so the returned ImportResult carries only the job id.
    let job_id = create_import_job(pool.inner(), company_id, &current_user, &request, data_rows)
        .await?;

    let worker_pool = pool.inner().clone();
    let worker_company = company_id.clone();
    let user_id = current_user.id.clone();
    let user_email = current_user.email.clone();
    let user_role = current_user.role.clone();
    let worker_job_id = job_id.clone();
    // Push-progress channel (spec §23.8): the worker emits `import:progress`
    // / `import:complete` events through the app handle captured at setup.
    // None in unit tests, where the worker simply skips emissions.
    let app_handle = APP_HANDLE.get().cloned();

    tokio::spawn(async move {
        run_import_job(
            app_handle,
            worker_pool,
            worker_company,
            user_id,
            user_email,
            user_role,
            request,
            all_rows,
            worker_job_id,
        )
        .await;
    });

    Ok(ImportResult {
        fields_created: 0,
        products_imported: 0,
        customers_imported: 0,
        items_imported: 0,
        rows_with_errors: 0,
        rows_skipped: 0,
        job_id: Some(job_id),
        errors: Vec::new(),
    })
}

// ==========================================
// BACKGROUND IMPORT WORKER (spec §23.3 / §23.8)
// ==========================================
//
// confirm_import hands the file off to a tokio task. The worker:
//   1. flips the job to `processing` (started_at set),
//   2. creates product custom fields + saves the import template,
//   3. streams the rows, flushing `attempted_rows`/`processed_rows`/
//      `error_rows` every 10 rows so a polling client sees a moving bar,
//   4. finalizes to `completed` (or `failed` when every row errored),
//      storing the full ImportResult as `result_json`,
//   5. writes the audit trail.

#[allow(clippy::too_many_arguments)]
async fn run_import_job(
    app_handle: Option<AppHandle>,
    pool: SqlitePool,
    company_id: String,
    user_id: String,
    user_email: String,
    user_role: String,
    request: ImportRequest,
    all_rows: Vec<Vec<String>>,
    job_id: String,
) {
    // ---- 1. Mark the job as running ----
    let _ = sqlx::query(
        "UPDATE import_jobs SET status = 'processing', started_at = ? WHERE id = ?",
    )
    .bind(import_timestamp(now_unix()))
    .bind(&job_id)
    .execute(&pool)
    .await;

    let total_rows = all_rows.len().saturating_sub(1) as i64;

    // ---- 2. Custom field definitions (products only) ----
    // Customers, suppliers and opening stock have no free-form custom fields.
    let fields_created = create_product_custom_fields(&pool, &company_id, &request).await;

    // ---- 3. Save import template (if name provided) ----
    save_import_template(&pool, &company_id, &request).await;

    // ---- 4. Import data rows ----
    let strategy = request.conflict_strategy;
    let target = request.target.as_str();
    let mut products_imported = 0;
    let mut customers_imported = 0;
    let mut items_imported = 0;
    let mut rows_skipped = 0;
    let mut rows_with_errors = 0;
    let mut attempted = 0usize;
    let mut errors: Vec<ImportError> = Vec::new();

    for (row_index, row) in all_rows.iter().skip(1).enumerate() {
        let row_number = row_index + 2; // +2 because: skip header, 1-indexed
        attempted += 1;

        // Skip completely empty rows
        if row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }

        let outcome = match target {
            "customers" => {
                import_one_customer_row(
                    &pool,
                    &company_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            "opening_stock" => {
                import_one_opening_stock_row(
                    &pool,
                    &company_id,
                    &request.mappings,
                    row,
                    &job_id,
                )
                .await
            }
            "suppliers" => {
                import_one_supplier_row(
                    &pool,
                    &company_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            "invoices" => {
                import_one_invoice_row(
                    &pool,
                    &company_id,
                    &user_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            "purchase_bills" => {
                import_one_purchase_bill_row(
                    &pool,
                    &company_id,
                    &user_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            _ => {
                import_one_row(
                    &pool,
                    &company_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
        };

        match outcome {
            Ok(true) => match target {
                "customers" => customers_imported += 1,
                "opening_stock" | "suppliers" | "invoices" | "purchase_bills" => {
                    items_imported += 1
                }
                _ => products_imported += 1,
            },
            Ok(false) => rows_skipped += 1, // conflict strategy said skip
            Err(e) => {
                rows_with_errors += 1;
                errors.push(ImportError {
                    row_number,
                    reason: e.to_string(),
                });
                // Stop after 50 errors to avoid spam
                if errors.len() >= 50 {
                    errors.push(ImportError {
                        row_number: 0,
                        reason: format!(
                            "Stopped after 50 errors. {} rows remaining.",
                            all_rows.len() - row_index - 1
                        ),
                    });
                    break;
                }
            }
        }

        // Live progress: flush the counters every 10 rows so the frontend
        // sees a moving bar instead of a spinner. The final state is written
        // once by finish_import_job below.
        if attempted.is_multiple_of(10) {
            let processed = (products_imported + customers_imported + items_imported) as i64;
            update_import_progress(&pool, &job_id, attempted, processed, rows_with_errors as i64)
                .await;
            emit_import_progress(
                &app_handle,
                &job_id,
                "processing",
                progress_percent(total_rows, attempted as i64),
                attempted as i64,
                processed,
                rows_with_errors as i64,
                total_rows,
            );
        }
    }

    let imported = (products_imported + customers_imported + items_imported) as i64;

    // ---- 5. Finalize the job ----
    let result = ImportResult {
        fields_created,
        products_imported,
        customers_imported,
        items_imported,
        rows_with_errors,
        rows_skipped,
        job_id: Some(job_id.clone()),
        errors: errors.clone(),
    };
    finish_import_job(&pool, &job_id, &result, attempted).await;

    // ---- 5b. Push the terminal event (spec §23.8) ----
    let final_status = if result.rows_with_errors > 0 && imported == 0 {
        "failed"
    } else {
        "completed"
    };
    emit_import_complete(&app_handle, &job_id, final_status, &result, total_rows);

    // Notify the notification bell so low-stock / expiring alerts reflect the
    // freshly imported stock.
    if final_status == "completed" {
        crate::commands::notifications::emit_notifications_changed();
    }

    // ---- 6. Audit trail ----
    let entity = match target {
        "customers" => "customers",
        "opening_stock" => "opening stock rows",
        "suppliers" => "suppliers",
        "invoices" => "invoices",
        "purchase_bills" => "purchase bills",
        _ => "products",
    };
    log_audit(
        &pool,
        &company_id,
        &user_id,
        &user_email,
        &user_role,
        "import",
        entity,
        None,
        &format!(
            "Imported {imported} {entity}, {fields_created} custom fields ({} error(s), {} skipped)",
            rows_with_errors, rows_skipped
        ),
    )
    .await;
}



async fn run_dry_run(
    pool: &SqlitePool,
    company_id: &str,
    target: &str,
    request: &ImportRequest,
    all_rows: &[Vec<String>],
) -> Result<ImportResult, AppError> {
    let mut products_imported = 0usize;
    let mut customers_imported = 0usize;
    let mut items_imported = 0usize;
    let mut rows_skipped = 0usize;
    let mut rows_with_errors = 0usize;
    let mut errors: Vec<ImportError> = Vec::new();

    for (row_index, row) in all_rows.iter().skip(1).enumerate() {
        let row_number = row_index + 2;
        if row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }

        let validation = match target {
            "customers" => validate_customer_row(pool, company_id, request, row).await,
            "opening_stock" => validate_opening_stock_row(pool, company_id, request, row).await,
            "suppliers" => validate_supplier_row(pool, company_id, request, row).await,
            "invoices" => validate_invoice_row(pool, company_id, request, row).await,
            "purchase_bills" => validate_purchase_bill_row(pool, company_id, request, row).await,
            _ => validate_product_row(pool, company_id, request, row).await,
        };

        match validation {
            Ok(ValidationOutcome::Import) => match target {
                "customers" => customers_imported += 1,
                "opening_stock" | "suppliers" | "invoices" | "purchase_bills" => {
                    items_imported += 1
                }
                _ => products_imported += 1,
            },
            Ok(ValidationOutcome::Skip) => rows_skipped += 1,
            Err(e) => {
                rows_with_errors += 1;
                errors.push(ImportError {
                    row_number,
                    reason: e.to_string(),
                });
                if errors.len() >= 50 {
                    errors.push(ImportError {
                        row_number: 0,
                        reason: format!(
                            "Stopped after 50 errors. {} rows remaining.",
                            all_rows.len() - row_index - 1
                        ),
                    });
                    break;
                }
            }
        }
    }

    Ok(ImportResult {
        fields_created: 0,
        products_imported,
        customers_imported,
        items_imported,
        rows_with_errors,
        rows_skipped,
        job_id: None,
        errors,
    })
}

