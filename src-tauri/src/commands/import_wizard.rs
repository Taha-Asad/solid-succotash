// ==========================================
// IMPORT WIZARD — Schema Discovery Engine
// ==========================================
//
// This is not just "import products from Excel."
// This is the system that ONBOARDS a company by learning
// how they currently organize their business data.
//
// Flow:
//   1. User uploads their existing Excel/CSV/DOCX
//   2. Rust reads the file, extracts headers + sample rows
//   3. Frontend proposes field mappings (core vs custom)
//   4. User confirms/overrides
//   5. Rust saves custom field definitions (metadata, not schema)
//   6. Rust imports the data rows
//   7. From now on, every product form shows that company's fields
//
// The database schema NEVER changes. Only metadata changes.

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use calamine::{open_workbook_auto_from_rs, Data, Reader};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::io::Cursor;
use tauri::State;

// ==========================================
// TYPES
// ==========================================

/// What Rust sends back after analyzing a file
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysis {
    /// Column headers found in the file
    pub headers: Vec<String>,
    /// First N rows of data (for preview)
    pub sample_rows: Vec<Vec<String>>,
    /// Total data rows (excluding header)
    pub total_rows: usize,
    /// "xlsx", "csv", or "docx"
    pub file_type: String,
    /// Rust's proposed mapping for each column
    pub proposed_mappings: Vec<FieldMapping>,
}

/// A proposed mapping for one column
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    /// The column header from the Excel file
    pub source_column: String,
    /// Column index (0-based)
    pub source_index: usize,
    /// What it maps to: "name", "sku", "cost_price", "sell_price",
    /// "quantity_in_stock", "unit", "category", "supplier",
    /// or "custom:<field_name>" for custom fields
    pub target_field: String,
    /// "core" or "custom"
    pub field_category: String,
    /// Confidence: "high", "medium", "low", "unknown"
    pub confidence: String,
    /// When set, this mapping does NOT read from the file — the same
    /// constant value is applied to every row. This is how the Import
    /// Wizard lets you add fields that aren't columns in your spreadsheet
    /// (e.g. "set Category = Medicines" for the whole file).
    #[serde(default)]
    pub manual_value: Option<String>,
}

/// Conflict resolution strategy for rows that collide with existing records
/// (products are matched by SKU, customers by name). Defaults to Skip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictStrategy {
    /// Skip the row silently (re-imports are idempotent).
    Skip,
    /// Update the existing record with the file's values.
    Overwrite,
    /// Insert as a new record with a suffixed SKU / name (e.g. `SKU-1`).
    Suffix,
}

impl Default for ConflictStrategy {
    fn default() -> Self {
        ConflictStrategy::Skip
    }
}

/// What the frontend sends back when user confirms the mapping
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    /// Import target: "products" (default), "customers", "opening_stock",
    /// or "suppliers"
    #[serde(default = "default_import_target")]
    pub target: String,
    /// The confirmed/adjusted mappings
    pub mappings: Vec<FieldMapping>,
    /// File bytes (re-sent because we don't store the file between calls)
    pub file_bytes: Vec<u8>,
    /// "xlsx", "csv", or "docx"
    pub file_type: String,
    /// Optional template name to save
    pub template_name: String,
    /// Should we import the data rows too?
    pub import_data: bool,
    /// How existing SKU / name collisions are handled.
    #[serde(default)]
    pub conflict_strategy: ConflictStrategy,
    /// When true, validate every row and return a preview summary without
    /// writing any records or creating an import job.
    #[serde(default)]
    pub dry_run: bool,
    /// Optional original file name (recorded on the import job).
    #[serde(default)]
    pub file_name: Option<String>,
}

fn default_import_target() -> String {
    "products".to_string()
}

/// Result of the import operation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// How many custom field definitions were created (products only)
    pub fields_created: usize,
    /// How many products were imported
    pub products_imported: usize,
    /// How many customers were imported
    pub customers_imported: usize,
    /// Generic count (opening stock rows, future targets)
    pub items_imported: usize,
    /// How many rows had errors
    pub rows_with_errors: usize,
    /// Rows that were skipped by the conflict strategy (duplicates)
    pub rows_skipped: usize,
    /// Import job id (None for dry-runs)
    pub job_id: Option<String>,
    /// Error details (row number + reason)
    pub errors: Vec<ImportError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub row_number: usize,
    pub reason: String,
}

/// A persisted import job (migration 009 `import_jobs`). Written by
/// `execute_import`, read by `list_import_jobs`, and rolled back by
/// `rollback_import`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub file_type: String,
    pub file_name: Option<String>,
    pub status: String,
    pub total_rows: i64,
    pub processed_rows: i64,
    pub error_rows: i64,
    pub error_details: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    /// True when the job finished less than 24h ago and can still be rolled back.
    pub rollback_available: bool,
    /// Records imported by this job (products + customers + items).
    pub imported_records: i64,
}

/// Result of rolling back an import job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub products_deleted: i64,
    pub customers_deleted: i64,
    pub suppliers_deleted: i64,
    pub movements_deleted: i64,
    pub batches_deleted: i64,
    pub quantity_reverted: i64,
}

// Import quotas (spec §23.10, desktop-adapted)
const MAX_IMPORT_FILE_BYTES: usize = 50 * 1024 * 1024; // 50 MB
const MAX_IMPORT_ROWS: usize = 100_000;
/// How long after completion an import can be rolled back.
const ROLLBACK_WINDOW_SECS: u64 = 24 * 60 * 60;

/// Local unix-timestamp string, matching the project's other timestamp helpers.
fn import_timestamp(secs: u64) -> String {
    secs.to_string()
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ==========================================
// IMPORT TARGETS
// ==========================================

/// Supported import targets. The frontend lets the user pick one before
/// uploading a file; each target has its own field mapping vocabulary.
pub const IMPORT_TARGETS: [&str; 4] = ["products", "customers", "opening_stock", "suppliers"];

// ==========================================
// STEP 1: ANALYZE THE FILE
// ==========================================
//
// Frontend sends the file bytes.
// Rust reads them, extracts headers + sample data,
// and proposes field mappings using pattern matching.

#[tauri::command]
pub async fn analyze_import_file(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    file_bytes: Vec<u8>,
    file_type: String,
    target: Option<String>,
) -> Result<FileAnalysis, String> {
    let _current_user = require_current_user(pool.inner(), session.inner()).await?;

    let target = target.unwrap_or_else(|| "products".to_string());
    if !IMPORT_TARGETS.contains(&target.as_str()) {
        return Err(format!(
            "Unknown import target '{target}'. Supported: {}",
            IMPORT_TARGETS.join(", ")
        ));
    }

    if file_bytes.is_empty() {
        return Err("File is empty".to_string());
    }

    match file_type.as_str() {
        "xlsx" | "xls" => analyze_excel(file_bytes, &target).await,
        "csv" => analyze_csv(file_bytes, &target).await,
        "docx" => analyze_docx(file_bytes, &target).await,
        _ => Err(format!(
            "Unsupported file type: {file_type}. Supported: xlsx, xls, csv, docx"
        )),
    }
}

/// Reads an Excel file and returns analysis
async fn analyze_excel(file_bytes: Vec<u8>, target: &str) -> Result<FileAnalysis, String> {
    let cursor = Cursor::new(file_bytes);
    let mut workbook = open_workbook_auto_from_rs(cursor)
        .map_err(|e| format!("Failed to read Excel file: {e}"))?;

    // Get the first sheet
    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("Excel file has no sheets".to_string());
    }

    let range = workbook
        .worksheet_range(&sheet_names[0])
        .map_err(|e| format!("Failed to read sheet: {e}"))?;

    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let row_data: Vec<String> = row.iter().map(|cell| cell_to_string(cell)).collect();
        rows.push(row_data);
    }

    if rows.is_empty() {
        return Err("Excel file is empty (no rows)".to_string());
    }

    // First row = headers
    let headers = rows[0].clone();
    // Remaining rows = data
    let data_rows = rows[1..].to_vec();
    let total_rows = data_rows.len();

    // Take first 5 rows as sample
    let sample_rows: Vec<Vec<String>> = data_rows.iter().take(5).cloned().collect();

    // Propose mappings
    let proposed_mappings = propose_mappings(target, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "xlsx".to_string(),
        proposed_mappings,
    })
}

/// Reads a CSV file and returns analysis
async fn analyze_csv(file_bytes: Vec<u8>, target: &str) -> Result<FileAnalysis, String> {
    let cursor = Cursor::new(file_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(cursor);

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("Failed to read CSV headers: {e}"))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    let mut data_rows: Vec<Vec<String>> = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| format!("Failed to read CSV row: {e}"))?;
        let row: Vec<String> = record.iter().map(|f| f.to_string()).collect();
        data_rows.push(row);
    }

    let total_rows = data_rows.len();
    let sample_rows: Vec<Vec<String>> = data_rows.iter().take(5).cloned().collect();
    let proposed_mappings = propose_mappings(target, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "csv".to_string(),
        proposed_mappings,
    })
}

/// Reads a .docx file and extracts the first table found.
///
/// A .docx file is actually a ZIP containing XML files.
/// The main content lives in word/document.xml.
/// Word tables use <w:tbl>, <w:tr> (row), <w:tc> (cell) tags.
async fn analyze_docx(file_bytes: Vec<u8>, target: &str) -> Result<FileAnalysis, String> {
    // Unused here — the XML parsing was extracted into parse_docx_table().
    // use quick_xml::events::Event;
    // use quick_xml::Reader as XmlReader;
    use std::io::Read;

    // 1. Open the .docx as a ZIP archive
    let cursor = Cursor::new(file_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open docx file: {e}"))?;

    // 2. Find and read word/document.xml
    let mut document_xml = String::new();
    {
        let mut file = archive.by_name("word/document.xml").map_err(|_| {
            "This .docx file appears to be corrupted (no word/document.xml found)".to_string()
        })?;
        file.read_to_string(&mut document_xml)
            .map_err(|e| format!("Failed to read document content: {e}"))?;
    }

    // 3. Parse the XML to extract table data
    let all_rows = parse_docx_table(&document_xml)?;

    if all_rows.is_empty() {
        return Err(
            "No table found in this .docx file. The document must contain a Word table. \
             If your data is plain text, please copy it into a .csv or .xlsx file instead."
                .to_string(),
        );
    }

    // 4. First row = headers, rest = data
    let headers = all_rows[0].clone();
    let data_rows = all_rows[1..].to_vec();
    let total_rows = data_rows.len();
    let sample_rows: Vec<Vec<String>> = data_rows.iter().take(5).cloned().collect();
    let proposed_mappings = propose_mappings(target, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "docx".to_string(),
        proposed_mappings,
    })
}

// ==========================================
// STEP 2: CONFIRM AND IMPORT
// ==========================================
//
// Frontend sends back the confirmed mappings + file bytes.
// Rust creates custom field definitions and imports data.

#[tauri::command]
pub async fn execute_import(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    request: ImportRequest,
) -> Result<ImportResult, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let target = request.target.as_str();
    if !IMPORT_TARGETS.contains(&target) {
        return Err(format!(
            "Unknown import target '{target}'. Supported: {}",
            IMPORT_TARGETS.join(", ")
        ));
    }

    // ---- Quotas (spec §23.10) ----
    if request.file_bytes.len() > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "File too large ({} bytes). Maximum allowed is {} MB.",
            request.file_bytes.len(),
            MAX_IMPORT_FILE_BYTES / (1024 * 1024)
        ));
    }

    // Read the rows once (used for the quota check, dry-run preview, and import).
    let all_rows = if request.import_data {
        match request.file_type.as_str() {
            "xlsx" | "xls" => read_excel_rows(&request.file_bytes)?,
            "csv" => read_csv_rows(&request.file_bytes)?,
            "docx" => read_docx_rows(&request.file_bytes)?,
            _ => {
                return Err("Unsupported file type".to_string());
            }
        }
    } else {
        Vec::new()
    };

    let data_rows = all_rows.len().saturating_sub(1);
    if data_rows > MAX_IMPORT_ROWS {
        return Err(format!(
            "File has {data_rows} data rows. Maximum allowed is {MAX_IMPORT_ROWS} per import."
        ));
    }

    // ---- Dry-run preview: validate every row, write nothing ----
    if request.dry_run {
        return run_dry_run(pool.inner(), company_id, target, &request, &all_rows).await;
    }

    let strategy = request.conflict_strategy;

    // ---- 1. Create the import job (enables rollback) ----
    let job_id = create_import_job(
        pool.inner(),
        company_id,
        &current_user,
        &request,
        data_rows,
    )
    .await?;

    // ---- 2. Create custom field definitions (products only) ----
    // Customers, suppliers and opening stock have no free-form custom fields.
    let mut fields_created = 0;
    if target == "products" {
        let custom_mappings: Vec<&FieldMapping> = request
            .mappings
            .iter()
            .filter(|m| m.field_category == "custom")
            .collect();

        for mapping in &custom_mappings {
            // Extract the field name from "custom:<name>"
            let field_name = mapping
                .target_field
                .strip_prefix("custom:")
                .unwrap_or(&mapping.target_field);

            let field_label = mapping.source_column.clone();

            // Detect field type from sample data
            let field_type = detect_field_type(&request, mapping);

            let id = uuid::Uuid::new_v4().to_string();
            let order = fields_created as i64;

            // Insert or update the field setting
            let result = sqlx::query(
                r#"
                INSERT INTO company_field_settings
                    (id, company_id, field_name, field_label, field_type,
                     is_visible, field_order)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(company_id, field_name) DO UPDATE SET
                    field_label = excluded.field_label,
                    field_type = excluded.field_type,
                    field_order = excluded.field_order,
                    updated_at = CURRENT_TIMESTAMP
                "#,
            )
            .bind(&id)
            .bind(company_id)
            .bind(field_name)
            .bind(&field_label)
            .bind(&field_type)
            .bind(order)
            .execute(pool.inner())
            .await;

            match result {
                Ok(_) => {
                    fields_created += 1;
                }
                Err(e) => {
                    // Log but don't fail the whole import
                    eprintln!("Warning: failed to create field '{field_name}': {e}");
                }
            }
        }
    }

    // ---- 3. Save import template (if name provided) ----
    if !request.template_name.is_empty() {
        let template_id = uuid::Uuid::new_v4().to_string();
        let mappings_json =
            serde_json::to_string(&request.mappings).unwrap_or_else(|_| "{}".to_string());

        let _ = sqlx::query(
            r#"
            INSERT INTO import_templates
                (id, company_id, template_name, file_type, column_mappings)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&template_id)
        .bind(company_id)
        .bind(&request.template_name)
        .bind(&request.file_type)
        .bind(&mappings_json)
        .execute(pool.inner())
        .await;
    }

    // ---- 4. Import data rows ----
    let mut products_imported = 0;
    let mut customers_imported = 0;
    let mut items_imported = 0;
    let mut rows_skipped = 0;
    let mut rows_with_errors = 0;
    let mut errors: Vec<ImportError> = Vec::new();

    for (row_index, row) in all_rows.iter().skip(1).enumerate() {
        let row_number = row_index + 2; // +2 because: skip header, 1-indexed

        // Skip completely empty rows
        if row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }

        let outcome = match target {
            "customers" => {
                import_one_customer_row(
                    pool.inner(),
                    company_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            "opening_stock" => {
                import_one_opening_stock_row(
                    pool.inner(),
                    company_id,
                    &request.mappings,
                    row,
                    &job_id,
                )
                .await
            }
            "suppliers" => {
                import_one_supplier_row(
                    pool.inner(),
                    company_id,
                    &request.mappings,
                    row,
                    &job_id,
                    strategy,
                )
                .await
            }
            _ => {
                import_one_row(
                    pool.inner(),
                    company_id,
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
                "opening_stock" => items_imported += 1,
                "suppliers" => items_imported += 1,
                _ => products_imported += 1,
            },
            Ok(false) => rows_skipped += 1, // conflict strategy said skip
            Err(e) => {
                rows_with_errors += 1;
                errors.push(ImportError {
                    row_number,
                    reason: e,
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
    }

    // ---- 5. Finalize the job ----
    finish_import_job(
        pool.inner(),
        &job_id,
        (products_imported + customers_imported + items_imported) as i64,
        rows_with_errors as i64,
        &errors,
    )
    .await;

    let entity = match target {
        "customers" => "customers",
        "opening_stock" => "opening stock rows",
        "suppliers" => "suppliers",
        _ => "products",
    };
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "import",
        entity,
        None,
        &format!(
            "Imported {} {entity}, {} custom fields ({} error(s), {} skipped)",
            products_imported + customers_imported + items_imported,
            fields_created,
            rows_with_errors,
            rows_skipped
        ),
    )
    .await;

    Ok(ImportResult {
        fields_created,
        products_imported,
        customers_imported,
        items_imported,
        rows_with_errors,
        rows_skipped,
        job_id: Some(job_id),
        errors,
    })
}

// ==========================================
// IMPORT JOBS (spec §23.3 / §23.12)
// ==========================================

/// Creates an `import_jobs` row so the run can be rolled back later.
async fn create_import_job(
    pool: &SqlitePool,
    company_id: &str,
    user: &crate::commands::auth::PublicUser,
    request: &ImportRequest,
    data_rows: usize,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = import_timestamp(now_unix());
    let file_name = request.file_name.clone().unwrap_or_default();

    sqlx::query(
        r#"
        INSERT INTO import_jobs
            (id, company_id, file_type, file_name, status,
             total_rows, processed_rows, error_rows,
             created_by, started_at, created_at)
        VALUES (?, ?, ?, ?, 'processing', ?, 0, 0, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&request.file_type)
    .bind(&file_name)
    .bind(data_rows as i64)
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create import job: {e}"))?;

    Ok(id)
}

/// Marks a finished import job as completed (or failed) with its row counts.
async fn finish_import_job(
    pool: &SqlitePool,
    job_id: &str,
    processed_rows: i64,
    error_rows: i64,
    errors: &[ImportError],
) {
    let error_details = if errors.is_empty() {
        None
    } else {
        serde_json::to_string(
            &errors
                .iter()
                .map(|e| serde_json::json!({ "rowNumber": e.row_number, "reason": e.reason }))
                .collect::<Vec<_>>(),
        )
        .ok()
    };
    let now = import_timestamp(now_unix());
    let status = if error_rows > 0 { "completed" } else { "completed" };

    let _ = sqlx::query(
        r#"
        UPDATE import_jobs
        SET status = ?, processed_rows = ?, error_rows = ?,
            error_details = ?, completed_at = ?
        WHERE id = ?
        "#,
    )
    .bind(status)
    .bind(processed_rows)
    .bind(error_rows)
    .bind(&error_details)
    .bind(&now)
    .bind(job_id)
    .execute(pool)
    .await;
}

/// Lists recent import jobs for the current company.
#[tauri::command]
pub async fn list_import_jobs(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<ImportJob>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("You are not assigned to a company")?;

    let now = now_unix();
    let rows = sqlx::query_as::<_, (String, String, Option<String>, String, i64, i64, i64, Option<String>, String, Option<String>, String)>(
        r#"
        SELECT id, file_type, file_name, status, total_rows, processed_rows,
               error_rows, error_details, created_by, completed_at, created_at
        FROM import_jobs
        WHERE company_id = ?
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(id, file_type, file_name, status, total_rows, processed_rows, error_rows, error_details, created_by, completed_at, created_at)| {
            let rollback_available = status == "completed"
                && completed_at
                    .as_deref()
                    .and_then(|t| t.parse::<u64>().ok())
                    .map(|t| now.saturating_sub(t) <= ROLLBACK_WINDOW_SECS)
                    .unwrap_or(false);
            let imported_records = processed_rows - error_rows;
            ImportJob {
                id,
                file_type,
                file_name,
                status,
                total_rows,
                processed_rows,
                error_rows,
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

/// Rolls back a completed import: removes the tagged records and reverts
/// opening-stock quantity changes. Only available within 24h of completion.
#[tauri::command]
pub async fn rollback_import(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    job_id: String,
) -> Result<RollbackResult, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("You are not assigned to a company")?;

    let job = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT status, company_id, completed_at FROM import_jobs WHERE id = ?",
    )
    .bind(&job_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Import job not found")?;

    let (status, job_company, completed_at) = job;
    if job_company != *company_id {
        return Err("Import job does not belong to your company".to_string());
    }
    if status == "rolled_back" {
        return Err("This import has already been rolled back".to_string());
    }
    if status != "completed" {
        return Err(format!("Only completed imports can be rolled back (status: {status})"));
    }
    let completed_secs = completed_at
        .as_deref()
        .and_then(|t| t.parse::<u64>().ok())
        .ok_or("Import job has no completion time")?;
    if now_unix().saturating_sub(completed_secs) > ROLLBACK_WINDOW_SECS {
        return Err("Rollback window (24 hours) has expired".to_string());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

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
    .map_err(|e| format!("Failed to read movements: {e}"))?;

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
        .map_err(|e| format!("Failed to revert stock: {e}"))?;
        quantity_reverted += quantity;
    }

    let movements_deleted = sqlx::query("DELETE FROM stock_movements WHERE import_batch_id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete movements: {e}"))?
        .rows_affected() as i64;

    let batches_deleted = sqlx::query("DELETE FROM stock_batches WHERE import_batch_id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete batches: {e}"))?
        .rows_affected() as i64;

    let customers_deleted =
        sqlx::query("DELETE FROM customers WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete customers: {e}"))?
            .rows_affected() as i64;

    let products_deleted =
        sqlx::query("DELETE FROM products WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete products: {e}"))?
            .rows_affected() as i64;

    let suppliers_deleted =
        sqlx::query("DELETE FROM suppliers WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete suppliers: {e}"))?
            .rows_affected() as i64;

    sqlx::query("UPDATE import_jobs SET status = 'rolled_back' WHERE id = ?")
        .bind(&job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update job: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit rollback: {e}"))?;

    Ok(RollbackResult {
        products_deleted,
        customers_deleted,
        suppliers_deleted,
        movements_deleted,
        batches_deleted,
        quantity_reverted,
    })
}

/// Validation-only pass used for the preview/confirm step. Writes nothing.
async fn run_dry_run(
    pool: &SqlitePool,
    company_id: &str,
    target: &str,
    request: &ImportRequest,
    all_rows: &[Vec<String>],
) -> Result<ImportResult, String> {
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
            _ => validate_product_row(pool, company_id, request, row).await,
        };

        match validation {
            Ok(ValidationOutcome::Import) => match target {
                "customers" => customers_imported += 1,
                "opening_stock" | "suppliers" => items_imported += 1,
                _ => products_imported += 1,
            },
            Ok(ValidationOutcome::Skip) => rows_skipped += 1,
            Err(e) => {
                rows_with_errors += 1;
                errors.push(ImportError {
                    row_number,
                    reason: e,
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

enum ValidationOutcome {
    Import,
    Skip,
}

/// Dry-run product validation: parse + required fields + duplicate check.
async fn validate_product_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_product_row(&request.mappings, row)?;
    let exists = sku_exists(pool, company_id, &parsed.sku).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run customer validation: parse + required fields + duplicate check.
async fn validate_customer_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_customer_row(&request.mappings, row)?;
    let exists = customer_name_exists(pool, company_id, &parsed.name).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run supplier validation.
async fn validate_supplier_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_supplier_row(&request.mappings, row)?;
    let exists = supplier_name_exists(pool, company_id, &parsed.name).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run opening-stock validation: parse + product-exists check.
async fn validate_opening_stock_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_opening_stock_row(&request.mappings, row)?;
    let product_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(&parsed.sku)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Product lookup error: {e}"))?;
    if product_exists == 0 {
        let hint = if parsed.name.is_empty() {
            String::new()
        } else {
            format!(" (file says '{}')", parsed.name)
        };
        return Err(format!(
            "No product with SKU '{}'{hint} was found. Import your products first.",
            parsed.sku
        ));
    }
    Ok(ValidationOutcome::Import)
}

fn conflict_outcome(exists: bool, strategy: ConflictStrategy) -> ValidationOutcome {
    if exists && strategy == ConflictStrategy::Skip {
        ValidationOutcome::Skip
    } else {
        ValidationOutcome::Import
    }
}

// ==========================================
// INTERNAL HELPERS
// ==========================================

/// Converts a calamine cell to a string
fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        // Format Excel date cells as YYYY-MM-DD (the previous code
        // emitted "true"/"false", which corrupted date columns).
        Data::DateTime(dt) => match dt.as_datetime() {
            Some(d) => d.format("%Y-%m-%d").to_string(),
            None => String::new(),
        },
        Data::DateTimeIso(b) => b.to_string(),
        Data::DurationIso(b) => b.to_string(),
        Data::Error(_) => String::new(),
        Data::Empty => String::new(),
    }
}

/// Reads all rows from an Excel file (including header)
fn read_excel_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let cursor = Cursor::new(file_bytes.to_vec());
    let mut workbook =
        open_workbook_auto_from_rs(cursor).map_err(|e| format!("Failed to read Excel: {e}"))?;

    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("No sheets found".to_string());
    }

    let range = workbook
        .worksheet_range(&sheet_names[0])
        .map_err(|e| format!("Failed to read sheet: {e}"))?;

    let mut rows = Vec::new();
    for row in range.rows() {
        rows.push(row.iter().map(cell_to_string).collect());
    }
    Ok(rows)
}

/// Reads all rows from a CSV file (including header)
fn read_csv_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let cursor = Cursor::new(file_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false) // we want ALL rows including header
        .from_reader(cursor);

    let mut rows = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| format!("CSV error: {e}"))?;
        rows.push(record.iter().map(|f| f.to_string()).collect());
    }
    Ok(rows)
}

/// Reads all rows from a .docx file (including header row)
fn read_docx_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    use std::io::Read;

    let cursor = Cursor::new(file_bytes.to_vec());
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open docx: {e}"))?;

    let mut document_xml = String::new();
    {
        let mut file = archive
            .by_name("word/document.xml")
            .map_err(|_| "No word/document.xml found".to_string())?;
        file.read_to_string(&mut document_xml)
            .map_err(|e| format!("Read error: {e}"))?;
    }

    parse_docx_table(&document_xml)
}

/// Shared XML parser for .docx tables.
/// Used by both analyze_docx and read_docx_rows.
fn parse_docx_table(document_xml: &str) -> Result<Vec<Vec<String>>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader as XmlReader;

    let mut reader = XmlReader::from_str(document_xml);
    reader.config_mut().trim_text(true);

    let mut all_rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut current_cell_text = String::new();
    let mut in_table = false;
    let mut in_row = false;
    let mut in_cell = false;
    let mut cell_paragraphs: Vec<String> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "w:tbl" => {
                        in_table = true;
                    }
                    "w:tr" if in_table => {
                        in_row = true;
                        current_row = Vec::new();
                    }
                    "w:tc" if in_row => {
                        in_cell = true;
                        cell_paragraphs = Vec::new();
                        current_cell_text = String::new();
                    }
                    "w:p" if in_cell => {
                        // Start of a paragraph inside a cell
                    }
                    "w:t" if in_cell => {
                        // Text run — we'll capture it in the Text event
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_cell {
                    if let Ok(decoded) = e.decode() {
                        let text = match quick_xml::escape::unescape(&decoded) {
                            Ok(unescaped) => unescaped.into_owned(),
                            Err(_) => decoded.into_owned(),
                        };
                        current_cell_text.push_str(&text);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag.as_str() {
                    "w:p" if in_cell => {
                        // End of paragraph in cell — save accumulated text
                        if !current_cell_text.trim().is_empty() {
                            cell_paragraphs.push(current_cell_text.trim().to_string());
                        }
                        current_cell_text = String::new();
                    }
                    "w:tc" if in_cell => {
                        // End of cell — join all paragraphs with space
                        let cell_text = cell_paragraphs.join(" ");
                        current_row.push(cell_text);
                        in_cell = false;
                        cell_paragraphs = Vec::new();
                    }
                    "w:tr" if in_row => {
                        // End of row
                        if !current_row.is_empty() {
                            all_rows.push(current_row.clone());
                        }
                        in_row = false;
                        current_row = Vec::new();
                    }
                    "w:tbl" => {
                        // End of table — we only take the FIRST table
                        // in_table = false; // dead assignment — we break immediately after
                        break;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parsing error: {e}")),
            _ => {}
        }
    }

    Ok(all_rows)
}

/// Pattern-matching engine that proposes field mappings
/// based on column header names.
///
/// This is the "AI/rule engine" from your spec.
/// It recognizes common patterns across industries.
/// The vocabulary depends on the import target.
fn propose_mappings(target: &str, headers: &[String]) -> Vec<FieldMapping> {
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let normalized = normalize_header(header);
            let (target_field, category, confidence) = match target {
                "customers" => detect_customer_field(&normalized),
                "suppliers" => detect_supplier_field(&normalized),
                "opening_stock" => detect_opening_stock_field(&normalized),
                _ => detect_field(&normalized),
            };
            FieldMapping {
                source_column: header.clone(),
                source_index: index,
                target_field,
                field_category: category,
                confidence,
                manual_value: None,
            }
        })
        .collect()
}

/// Normalizes a header for matching:
/// lowercase, remove special chars, collapse spaces
fn normalize_header(header: &str) -> String {
    header
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Returns (target_field, field_category, confidence)
fn detect_field(normalized: &str) -> (String, String, String) {
    // ---- CORE FIELD PATTERNS ----

    // SKU
    if matches_any(
        normalized,
        &[
            "sku",
            "code",
            "item code",
            "product code",
            "barcode",
            "item no",
            "item number",
            "product id",
            "item id",
            "article no",
            "article number",
            "hs code",
            "hscode",
        ],
    ) {
        return ("sku".to_string(), "core".to_string(), "high".to_string());
    }

    // NAME
    if matches_any(
        normalized,
        &[
            "product name",
            "item name",
            "name",
            "item",
            "product",
            "description",
            "product description",
            "item description",
            "title",
            "product title",
        ],
    ) {
        return ("name".to_string(), "core".to_string(), "high".to_string());
    }

    // COST PRICE
    if matches_any(
        normalized,
        &[
            "cost price",
            "buying price",
            "purchase price",
            "buy price",
            "buying rate",
            "purchase rate",
            "cost rate",
            "landed cost",
            "unit cost",
            "base cost",
            "cost",
        ],
    ) {
        return (
            "cost_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX
    // Checked before SELL PRICE because SELL PRICE's broad "rate" pattern
    // would otherwise swallow "tax rate" / "gst rate" via substring match.
    if matches_any(
        normalized,
        &[
            "tax",
            "tax rate",
            "gst",
            "vat",
            "sales tax",
            "tax percentage",
        ],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // SELL PRICE
    if matches_any(
        normalized,
        &[
            "sell price",
            "selling price",
            "sale price",
            "retail price",
            "mrp",
            "selling rate",
            "sale rate",
            "unit price",
            "price",
            "rate",
            "amount",
        ],
    ) {
        return (
            "sell_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &[
            "qty",
            "quantity",
            "stock",
            "stock qty",
            "quantity in stock",
            "stock quantity",
            "count",
            "on hand",
            "onhand",
            "available",
            "balance",
            "opening stock",
            "opening qty",
        ],
    ) {
        return (
            "quantity_in_stock".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT
    if matches_any(
        normalized,
        &["unit", "uom", "unit of measure", "measure", "measurement"],
    ) {
        return ("unit".to_string(), "core".to_string(), "high".to_string());
    }

    // CATEGORY
    if matches_any(
        normalized,
        &[
            "category",
            "group",
            "type",
            "product type",
            "item type",
            "classification",
            "class",
            "product group",
            "item group",
        ],
    ) {
        return (
            "category".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // SUPPLIER
    if matches_any(
        normalized,
        &[
            "supplier",
            "vendor",
            "brand",
            "manufacturer",
            "supplier name",
            "vendor name",
            "brand name",
        ],
    ) {
        return (
            "supplier".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EXPIRY DATE
    // When a column matches, the imported stock is tracked as an
    // expiry batch and sold FIFO. Dates always come from the file —
    // never defaulted.
    if matches_any(
        normalized,
        &[
            "expiry date",
            "expiration date",
            "exp date",
            "expiry",
            "expiration",
            "exp",
            "best before",
            "best by",
            "use by",
            "sell by",
        ],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // ---- Everything else = CUSTOM FIELD ----
    // Use the normalized header as the field name
    let custom_name = normalized.replace(' ', "_");
    (
        format!("custom:{custom_name}"),
        "custom".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "customers" import target.
/// Unknown columns are skipped (customers have no custom fields).
fn detect_customer_field(normalized: &str) -> (String, String, String) {
    // BUYER TYPE
    // Checked first: "buyer"/"customer" also appear as NAME substrings,
    // so "buyer type" / "customer type" must win over the name patterns.
    if matches_any(
        normalized,
        &[
            "buyer type",
            "customer type",
            "buyer status",
            "registration status",
            "registered",
            "tax status",
        ],
    ) {
        return (
            "buyer_type".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // NAME
    if matches_any(
        normalized,
        &[
            "customer name",
            "customer full name",
            "customer",
            "client name",
            "client",
            "full name",
            "name",
            "buyer",
            "party",
            "account name",
            "account holder",
        ],
    ) {
        return (
            "customer_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // EMAIL
    if matches_any(
        normalized,
        &["email address", "e mail", "e-mail", "email", "mail"],
    ) {
        return ("email".to_string(), "core".to_string(), "high".to_string());
    }

    // PHONE
    if matches_any(
        normalized,
        &[
            "phone number",
            "mobile number",
            "contact number",
            "phone",
            "mobile",
            "contact",
            "telephone",
            "tel",
            "cell",
            "whatsapp",
        ],
    ) {
        return ("phone".to_string(), "core".to_string(), "high".to_string());
    }

    // ADDRESS
    if matches_any(
        normalized,
        &[
            "shipping address",
            "billing address",
            "full address",
            "address line",
            "address",
            "location",
            "address1",
        ],
    ) {
        return (
            "address".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // CNIC
    if matches_any(
        normalized,
        &[
            "cnic",
            "national id",
            "national identity",
            "id card",
            "identity",
            "nic",
        ],
    ) {
        return ("cnic".to_string(), "core".to_string(), "medium".to_string());
    }

    // NTN
    if matches_any(
        normalized,
        &[
            "national tax number",
            "ntn number",
            "ntn",
            "tax number",
            "tax no",
            "tax id",
        ],
    ) {
        return ("ntn".to_string(), "core".to_string(), "medium".to_string());
    }

    // STRN
    if matches_any(
        normalized,
        &[
            "strn number",
            "strn",
            "sales tax registration",
            "sales tax reg",
        ],
    ) {
        return ("strn".to_string(), "core".to_string(), "medium".to_string());
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "suppliers" import target.
fn detect_supplier_field(normalized: &str) -> (String, String, String) {
    // NAME (checked first: "supplier" appears as a substring of many labels)
    if matches_any(
        normalized,
        &[
            "supplier name",
            "supplier full name",
            "supplier",
            "vendor name",
            "vendor",
            "party",
            "full name",
            "name",
            "account name",
            "account holder",
        ],
    ) {
        return (
            "supplier_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // CONTACT PERSON
    if matches_any(
        normalized,
        &[
            "contact person",
            "contact name",
            "person",
            "poc",
            "representative",
            "contact",
        ],
    ) {
        return (
            "contact_person".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EMAIL
    if matches_any(
        normalized,
        &["email address", "e mail", "e-mail", "email", "mail"],
    ) {
        return ("email".to_string(), "core".to_string(), "high".to_string());
    }

    // PHONE
    if matches_any(
        normalized,
        &[
            "phone number",
            "mobile number",
            "contact number",
            "phone",
            "mobile",
            "telephone",
            "tel",
            "cell",
            "whatsapp",
        ],
    ) {
        return ("phone".to_string(), "core".to_string(), "high".to_string());
    }

    // ADDRESS
    if matches_any(
        normalized,
        &[
            "shipping address",
            "billing address",
            "full address",
            "address line",
            "address",
            "location",
        ],
    ) {
        return (
            "address".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // TAX NUMBER
    if matches_any(
        normalized,
        &[
            "national tax number",
            "ntn number",
            "ntn",
            "tax number",
            "tax no",
            "tax id",
            "strn",
            "sales tax registration",
        ],
    ) {
        return (
            "tax_number".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "opening_stock" import target.
/// Rows reference products by SKU (the products import runs first).
fn detect_opening_stock_field(normalized: &str) -> (String, String, String) {
    // SKU
    if matches_any(
        normalized,
        &[
            "sku",
            "code",
            "item code",
            "product code",
            "barcode",
            "item no",
            "item number",
            "product id",
            "item id",
            "article no",
            "article number",
            "hs code",
            "hscode",
        ],
    ) {
        return ("sku".to_string(), "core".to_string(), "high".to_string());
    }

    // NAME (optional; used for friendly error messages only)
    if matches_any(
        normalized,
        &[
            "product name",
            "item name",
            "product description",
            "name",
            "item",
            "product",
            "description",
        ],
    ) {
        return ("name".to_string(), "core".to_string(), "medium".to_string());
    }

    // QUANTITY
    if matches_any(
        normalized,
        &[
            "opening stock",
            "opening qty",
            "quantity in stock",
            "stock quantity",
            "stock qty",
            "on hand",
            "onhand",
            "qty",
            "quantity",
            "stock",
            "balance",
            "count",
            "available",
            "units",
        ],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // COST PRICE (unit cost carried into expiry batches)
    if matches_any(
        normalized,
        &[
            "cost price",
            "unit cost",
            "buying price",
            "purchase price",
            "buy price",
            "landed cost",
            "base cost",
            "cost",
        ],
    ) {
        return (
            "cost_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // EXPIRY DATE
    if matches_any(
        normalized,
        &[
            "expiry date",
            "expiration date",
            "exp date",
            "expiry",
            "expiration",
            "best before",
            "best by",
            "use by",
            "sell by",
        ],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Check if a normalized header matches any of the patterns
fn matches_any(normalized: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|p| normalized == *p || normalized.contains(p))
}

/// Detect the data type of a custom field from sample data
fn detect_field_type(request: &ImportRequest, mapping: &FieldMapping) -> String {
    // Manual fields have a fixed value for every row — classify from that.
    if let Some(manual) = mapping
        .manual_value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if manual.parse::<f64>().is_ok() {
            return "number".to_string();
        }
        if looks_like_date(manual) {
            return "date".to_string();
        }
        return "text".to_string();
    }

    let source_index = mapping.source_index;

    // Try to read the file again to get sample data
    let rows = match request.file_type.as_str() {
        "xlsx" | "xls" => read_excel_rows(&request.file_bytes).unwrap_or_default(),
        "csv" => read_csv_rows(&request.file_bytes).unwrap_or_default(),
        "docx" => read_docx_rows(&request.file_bytes).unwrap_or_default(),
        _ => return "text".to_string(),
    };

    let mut numeric_count = 0;
    let mut date_count = 0;
    let mut sample_count = 0;

    for row in rows.iter().skip(1).take(10) {
        if source_index >= row.len() {
            continue;
        }

        let value = &row[source_index];
        if value.is_empty() {
            continue;
        }

        sample_count += 1;

        // Check if numeric
        if value.parse::<f64>().is_ok() {
            numeric_count += 1;
            continue;
        }

        // Check if date-like (simple pattern)
        if looks_like_date(value) {
            date_count += 1;
        }
    }

    if sample_count == 0 {
        return "text".to_string();
    }

    // If >70% of values are numeric → number
    if (numeric_count as f64) / (sample_count as f64) > 0.7 {
        return "number".to_string();
    }

    // If >70% of values look like dates → date
    if (date_count as f64) / (sample_count as f64) > 0.7 {
        return "date".to_string();
    }

    "text".to_string()
}

/// Simple date pattern check
fn looks_like_date(value: &str) -> bool {
    let v = value.trim();
    // Common patterns: 2024-01-15, 15/01/2024, 01-15-2024
    let has_dash = v.len() >= 8
        && v.len() <= 12
        && v.contains('-')
        && v.chars().filter(|c| *c == '-').count() == 2;
    let has_slash = v.len() >= 8
        && v.len() <= 12
        && v.contains('/')
        && v.chars().filter(|c| *c == '/').count() == 2;
    has_dash || has_slash
}

/// Value a mapping contributes for a row. Manually-added fields (added in
/// the wizard's Map step, e.g. "Category = Medicines for every row")
/// return their constant value; everything else reads from the file's
/// column. Returns None when the mapping has nothing for this row.
fn mapping_value(mapping: &FieldMapping, row: &[String]) -> Option<String> {
    if let Some(manual) = mapping
        .manual_value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(manual.to_string());
    }
    if mapping.source_index >= row.len() {
        return None;
    }
    Some(row[mapping.source_index].trim().to_string())
}

/// Imports one row of data into the products table.
/// Returns Ok(true) when a row was imported, Ok(false) when it was
/// intentionally skipped (e.g. duplicate).
/// Formats the mapped-column note used in "missing required field" errors.
fn mapped_fields_note(mappings: &[FieldMapping], row: &[String]) -> String {
    mappings
        .iter()
        .filter(|m| m.target_field != "skip")
        .filter_map(|m| {
            mapping_value(m, row).map(|value| {
                format!(
                    "'{}' → {} = '{}'",
                    m.source_column, m.target_field, value
                )
            })
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Parsed + validated product row. Everything here comes from the file.
struct ParsedProduct {
    name: String,
    sku: String,
    cost_price: i64,
    sell_price: i64,
    quantity: i64,
    unit: String,
    tax_rate: i64,
    category_name: String,
    supplier_name: String,
    expiry: Option<String>,
    custom_json: Option<String>,
}

/// Extracts and validates a product row without touching the database.
fn parse_product_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedProduct, String> {
    let mut name = String::new();
    let mut sku = String::new();
    let mut cost_price: i64 = 0;
    let mut sell_price: i64 = 0;
    let mut quantity: i64 = 0;
    let mut unit = String::new();
    let mut tax_rate: i64 = 0;
    let mut category_name = String::new();
    let mut supplier_name = String::new();
    let mut expiry_raw = String::new();
    let mut custom_fields = serde_json::Map::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }

        match mapping.target_field.as_str() {
            "name" => name = value,
            "sku" => sku = value,
            "cost_price" => cost_price = parse_price(&value),
            "sell_price" => sell_price = parse_price(&value),
            "quantity_in_stock" => quantity = value.parse::<f64>().unwrap_or(0.0) as i64,
            "unit" => unit = value,
            "expiry_date" => expiry_raw = value,
            "tax_rate" => {
                // Convert percentage to basis points: 17.00 → 1700
                tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64;
            }
            "category" => category_name = value,
            "supplier" => supplier_name = value,
            field if field.starts_with("custom:") => {
                let field_name = field.strip_prefix("custom:").unwrap_or(field);
                custom_fields.insert(field_name.to_string(), serde_json::Value::String(value));
            }
            "skip" => {}
            _ => {}
        }
    }

    // ---- Required fields: name and SKU must come from the file ----
    if name.is_empty() {
        return Err(format!(
            "Row has no product NAME. Map a 'Product Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }

    if sku.is_empty() {
        return Err(format!(
            "Row has no SKU. Map a 'SKU / Code' column in your file — SKUs are never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }

    let parsed_expiry: Option<String> = if expiry_raw.trim().is_empty() {
        None
    } else {
        match crate::commands::inventory::parse_expiry_date(&expiry_raw) {
            Ok(d) => Some(d),
            Err(e) => return Err(e),
        }
    };

    let custom_json = if custom_fields.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&custom_fields).unwrap_or_default())
    };

    Ok(ParsedProduct {
        name,
        sku,
        cost_price,
        sell_price,
        quantity,
        unit,
        tax_rate,
        category_name,
        supplier_name,
        expiry: parsed_expiry,
        custom_json,
    })
}

/// Looks up an existing product by SKU (case-insensitive, company-scoped).
async fn find_product_by_sku(
    pool: &SqlitePool,
    company_id: &str,
    sku: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL",
    )
    .bind(company_id)
    .bind(sku)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Product lookup error: {e}"))
}

/// Finds the next free SKU by appending -1, -2, … to the base.
async fn next_free_sku(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, String> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if find_product_by_sku(pool, company_id, &candidate).await?.is_none() {
            return Ok(candidate);
        }
    }
    Err(format!("Could not generate a free SKU for '{base}'"))
}

/// Grabs the next sequential batch number for the company from the pool.
/// Imports run row-by-row (not inside one big transaction), so this is a
/// small acquire → generate → release; the sequence itself is computed by
/// `inventory::generate_batch_number`.
async fn next_batch_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| format!("Batch number lookup error: {e}"))?;
    crate::commands::inventory::generate_batch_number(&mut conn, company_id).await
}

/// Inserts a product plus its opening movement and expiry batch, all tagged
/// with the import batch id so the run can be rolled back.
#[allow(clippy::too_many_arguments)]
async fn insert_product(
    pool: &SqlitePool,
    company_id: &str,
    parsed: &ParsedProduct,
    category_id: &Option<String>,
    supplier_id: &Option<String>,
    job_id: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO products
            (id, company_id, sku, name, category_id, supplier_id,
             cost_price, sell_price, tax_rate, quantity_in_stock,
             unit, custom_fields, import_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&parsed.sku)
    .bind(&parsed.name)
    .bind(category_id)
    .bind(supplier_id)
    .bind(parsed.cost_price)
    .bind(parsed.sell_price)
    .bind(parsed.tax_rate)
    .bind(parsed.quantity)
    .bind(&parsed.unit)
    .bind(&parsed.custom_json)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Duplicate SKU '{}'", parsed.sku)
        } else {
            format!("DB error: {msg}")
        }
    })?;

    // Record initial stock movement if quantity > 0
    if parsed.quantity > 0 {
        let movement_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            r#"
            INSERT INTO stock_movements
                (id, company_id, product_id, movement_type, quantity,
                 reference_note, import_batch_id)
            VALUES (?, ?, ?, 'adjustment', ?, 'Imported from file', ?)
            "#,
        )
        .bind(&movement_id)
        .bind(company_id)
        .bind(&id)
        .bind(parsed.quantity)
        .bind(job_id)
        .execute(pool)
        .await;
    }

    // Create an expiry batch when the file provides an expiry date.
    if parsed.quantity > 0 {
        if let Some(expiry) = &parsed.expiry {
            let batch_id = uuid::Uuid::new_v4().to_string();
            let batch_number = next_batch_number(pool, company_id).await?;
            sqlx::query(
                r#"
                INSERT INTO stock_batches
                    (id, company_id, product_id, quantity, unit_cost, expiry_date, source, import_batch_id, batch_number)
                VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?)
                "#,
            )
            .bind(&batch_id)
            .bind(company_id)
            .bind(&id)
            .bind(parsed.quantity)
            .bind(parsed.cost_price)
            .bind(expiry)
            .bind(job_id)
            .bind(batch_number)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to create expiry batch: {e}"))?;
        }
    }

    Ok(id)
}

/// Overwrites an existing product with the file's values.
async fn overwrite_product(
    pool: &SqlitePool,
    product_id: &str,
    company_id: &str,
    parsed: &ParsedProduct,
    category_id: &Option<String>,
    supplier_id: &Option<String>,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE products
        SET sku = ?, name = ?, category_id = ?, supplier_id = ?,
            cost_price = ?, sell_price = ?, tax_rate = ?,
            quantity_in_stock = ?, unit = ?, custom_fields = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&parsed.sku)
    .bind(&parsed.name)
    .bind(category_id)
    .bind(supplier_id)
    .bind(parsed.cost_price)
    .bind(parsed.sell_price)
    .bind(parsed.tax_rate)
    .bind(parsed.quantity)
    .bind(&parsed.unit)
    .bind(&parsed.custom_json)
    .bind(product_id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to overwrite product: {e}"))?;

    Ok(())
}

/// Imports one row of data into the products table.
/// Returns Ok(true) when a row was imported, Ok(false) when it was
/// intentionally skipped (conflict strategy).
#[allow(clippy::too_many_arguments)]
async fn import_one_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, String> {
    let parsed = parse_product_row(mappings, row)?;

    // ---- Resolve category_id / supplier_id ----
    let category_id = if !parsed.category_name.is_empty() {
        resolve_or_create_category(pool, company_id, &parsed.category_name).await?
    } else {
        None
    };
    let supplier_id = if !parsed.supplier_name.is_empty() {
        resolve_or_create_supplier(pool, company_id, &parsed.supplier_name).await?
    } else {
        None
    };

    // ---- Conflict resolution by SKU ----
    if let Some(existing_id) = find_product_by_sku(pool, company_id, &parsed.sku).await? {
        match strategy {
            ConflictStrategy::Skip => return Ok(false),
            ConflictStrategy::Overwrite => {
                overwrite_product(pool, &existing_id, company_id, &parsed, &category_id, &supplier_id)
                    .await?;
                if parsed.quantity > 0 {
                    if let Some(expiry) = &parsed.expiry {
                        let batch_id = uuid::Uuid::new_v4().to_string();
                        let batch_number = next_batch_number(pool, company_id).await?;
                        sqlx::query(
                            r#"
                            INSERT INTO stock_batches
                                (id, company_id, product_id, quantity, unit_cost, expiry_date, source, import_batch_id, batch_number)
                            VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?)
                            "#,
                        )
                        .bind(&batch_id)
                        .bind(company_id)
                        .bind(&existing_id)
                        .bind(parsed.quantity)
                        .bind(parsed.cost_price)
                        .bind(expiry)
                        .bind(job_id)
                        .bind(batch_number)
                        .execute(pool)
                        .await
                        .map_err(|e| format!("Failed to create expiry batch: {e}"))?;
                    }
                }
                return Ok(true);
            }
            ConflictStrategy::Suffix => {
                let free_sku = next_free_sku(pool, company_id, &parsed.sku).await?;
                let mut suffixed = parsed;
                suffixed.sku = free_sku;
                insert_product(pool, company_id, &suffixed, &category_id, &supplier_id, job_id)
                    .await?;
                return Ok(true);
            }
        }
    }

    insert_product(pool, company_id, &parsed, &category_id, &supplier_id, job_id).await?;
    Ok(true)
}

/// Imports one row into the customers table.
/// Duplicate names (case-insensitive, per company) are skipped so
/// re-imports are idempotent. Returns Ok(false) for duplicates.
/// Parsed + validated customer row. Everything comes from the file.
struct ParsedCustomer {
    name: String,
    email: String,
    phone: String,
    address: String,
    cnic: String,
    ntn: String,
    strn: String,
    buyer_type: String,
}

/// Extracts and validates a customer row without touching the database.
fn parse_customer_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedCustomer, String> {
    let mut name = String::new();
    let mut email = String::new();
    let mut phone = String::new();
    let mut address = String::new();
    let mut cnic = String::new();
    let mut ntn = String::new();
    let mut strn = String::new();
    let mut buyer_type = "unregistered".to_string();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }

        match mapping.target_field.as_str() {
            "customer_name" => name = value,
            "email" => email = value,
            "phone" => phone = value,
            "address" => address = value,
            "cnic" => cnic = value,
            "ntn" => ntn = value,
            "strn" => strn = value,
            "buyer_type" => buyer_type = value.to_lowercase(),
            _ => {}
        }
    }

    if name.is_empty() {
        return Err(format!(
            "Row has no customer NAME. Map a 'Customer Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }

    if buyer_type != "registered" && buyer_type != "unregistered" {
        buyer_type = "unregistered".to_string();
    }

    Ok(ParsedCustomer {
        name,
        email,
        phone,
        address,
        cnic,
        ntn,
        strn,
        buyer_type,
    })
}

/// Checks whether a customer with the given name already exists
/// (case-insensitive, company-scoped).
async fn customer_name_exists(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<bool, String> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE)",
    )
    .bind(company_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Duplicate check error: {e}"))
}

/// Finds the next free customer name by appending -1, -2, … to the base.
async fn next_free_customer_name(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, String> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if !customer_name_exists(pool, company_id, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(format!("Could not generate a free name for '{base}'"))
}

async fn insert_customer(
    pool: &SqlitePool,
    company_id: &str,
    parsed: &ParsedCustomer,
    job_id: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO customers
            (id, company_id, name, email, phone, address,
             cnic, ntn, strn, buyer_type, import_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&parsed.name)
    .bind(clean_optional_import(&parsed.email))
    .bind(clean_optional_import(&parsed.phone))
    .bind(clean_optional_import(&parsed.address))
    .bind(clean_optional_import(&parsed.cnic))
    .bind(clean_optional_import(&parsed.ntn))
    .bind(clean_optional_import(&parsed.strn))
    .bind(&parsed.buyer_type)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    Ok(id)
}

async fn overwrite_customer(
    pool: &SqlitePool,
    customer_id: &str,
    company_id: &str,
    parsed: &ParsedCustomer,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE customers
        SET name = ?, email = ?, phone = ?, address = ?,
            cnic = ?, ntn = ?, strn = ?, buyer_type = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&parsed.name)
    .bind(clean_optional_import(&parsed.email))
    .bind(clean_optional_import(&parsed.phone))
    .bind(clean_optional_import(&parsed.address))
    .bind(clean_optional_import(&parsed.cnic))
    .bind(clean_optional_import(&parsed.ntn))
    .bind(clean_optional_import(&parsed.strn))
    .bind(&parsed.buyer_type)
    .bind(customer_id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to overwrite customer: {e}"))?;

    Ok(())
}

/// Imports one row into the customers table.
/// Returns Ok(true) when imported, Ok(false) when skipped by strategy.
#[allow(clippy::too_many_arguments)]
async fn import_one_customer_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, String> {
    let parsed = parse_customer_row(mappings, row)?;

    if let Some(existing_id) = find_customer_id(pool, company_id, &parsed.name).await? {
        match strategy {
            ConflictStrategy::Skip => return Ok(false),
            ConflictStrategy::Overwrite => {
                overwrite_customer(pool, &existing_id, company_id, &parsed).await?;
                return Ok(true);
            }
            ConflictStrategy::Suffix => {
                let free_name = next_free_customer_name(pool, company_id, &parsed.name).await?;
                let mut suffixed = parsed;
                suffixed.name = free_name;
                insert_customer(pool, company_id, &suffixed, job_id).await?;
                return Ok(true);
            }
        }
    }

    insert_customer(pool, company_id, &parsed, job_id).await?;
    Ok(true)
}

/// Looks up an existing customer by name (company-scoped, case-insensitive).
async fn find_customer_id(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Customer lookup error: {e}"))
}

/// Imports one opening-stock row: looks up the product by SKU and adds
/// the opening quantity to stock, recording a movement and (when the
/// file supplies an expiry date) an expiry batch.
async fn import_one_opening_stock_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
) -> Result<bool, String> {
    let parsed = parse_opening_stock_row(mappings, row)?;
    let sku = &parsed.sku;
    let name = &parsed.name;

    // Products must exist (run the Products import first).
    let product = sqlx::query_as::<_, (String, i64)>(
        "SELECT id, cost_price FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(sku)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Product lookup error: {e}"))?;

    let Some((product_id, product_cost)) = product else {
        let hint = if name.is_empty() {
            String::new()
        } else {
            format!(" (file says '{name}')")
        };
        return Err(format!(
            "No product with SKU '{sku}'{hint} was found. Import your products first."
        ));
    };

    let parsed_expiry: Option<String> = if parsed.expiry_raw.trim().is_empty() {
        None
    } else {
        match crate::commands::inventory::parse_expiry_date(&parsed.expiry_raw) {
            Ok(d) => Some(d),
            Err(e) => return Err(e),
        }
    };

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    // 1. Add the opening quantity to the product
    sqlx::query(
        r#"
        UPDATE products
        SET quantity_in_stock = quantity_in_stock + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(parsed.quantity)
    .bind(&product_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update stock: {e}"))?;

    // 2. Record the movement (tagged for rollback)
    let movement_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO stock_movements
            (id, company_id, product_id, movement_type, quantity, reference_note, import_batch_id)
        VALUES (?, ?, ?, 'adjustment', ?, 'Opening stock from import', ?)
        "#,
    )
    .bind(&movement_id)
    .bind(company_id)
    .bind(&product_id)
    .bind(parsed.quantity)
    .bind(job_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to record movement: {e}"))?;

    // 3. Create an expiry batch when the file provides an expiry date.
    //    The unit cost comes from the file when given, otherwise the
    //    product's current cost price.
    if parsed.quantity > 0 {
        if let Some(expiry) = &parsed_expiry {
            let unit_cost = if parsed.has_cost {
                parsed.cost_price
            } else {
                product_cost
            };
            let batch_id = uuid::Uuid::new_v4().to_string();
            let batch_number =
                crate::commands::inventory::generate_batch_number(&mut tx, company_id).await?;
            sqlx::query(
                r#"
                INSERT INTO stock_batches
                    (id, company_id, product_id, quantity, unit_cost, expiry_date, source, import_batch_id, batch_number)
                VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?)
                "#,
            )
            .bind(&batch_id)
            .bind(company_id)
            .bind(&product_id)
            .bind(parsed.quantity)
            .bind(unit_cost)
            .bind(expiry)
            .bind(job_id)
            .bind(batch_number)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to create expiry batch: {e}"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    Ok(true)
}

/// Trims and nullifies empty optional strings (email, phone, …).
fn clean_optional_import(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Checks whether a SKU already exists for the company.
async fn sku_exists(pool: &SqlitePool, company_id: &str, sku: &str) -> Result<bool, String> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL)",
    )
    .bind(company_id)
    .bind(sku)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("SKU lookup error: {e}"))
}

/// Parsed + validated opening-stock row.
struct ParsedOpeningStock {
    sku: String,
    name: String,
    quantity: i64,
    cost_price: i64,
    has_cost: bool,
    expiry_raw: String,
}

/// Extracts and validates an opening-stock row without touching the database.
fn parse_opening_stock_row(
    mappings: &[FieldMapping],
    row: &[String],
) -> Result<ParsedOpeningStock, String> {
    let mut sku = String::new();
    let mut name = String::new();
    let mut quantity: i64 = 0;
    let mut cost_price: i64 = 0;
    let mut has_cost = false;
    let mut expiry_raw = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }

        match mapping.target_field.as_str() {
            "sku" => sku = value,
            "name" => name = value,
            "quantity" => quantity = value.parse::<f64>().unwrap_or(0.0) as i64,
            "cost_price" => {
                cost_price = parse_price(&value);
                has_cost = true;
            }
            "expiry_date" => expiry_raw = value,
            _ => {}
        }
    }

    if sku.is_empty() {
        return Err(format!(
            "Row has no SKU. Map a 'SKU / Code' column in your file — opening stock rows are matched to products by SKU. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }

    if quantity < 0 {
        return Err(format!(
            "Opening quantity for SKU '{sku}' cannot be negative"
        ));
    }

    Ok(ParsedOpeningStock {
        sku,
        name,
        quantity,
        cost_price,
        has_cost,
        expiry_raw,
    })
}

/// Parsed + validated supplier row.
struct ParsedSupplier {
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
}

/// Extracts and validates a supplier row without touching the database.
fn parse_supplier_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedSupplier, String> {
    let mut name = String::new();
    let mut contact_person = String::new();
    let mut email = String::new();
    let mut phone = String::new();
    let mut address = String::new();
    let mut tax_number = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }

        match mapping.target_field.as_str() {
            "supplier_name" => name = value,
            "contact_person" => contact_person = value,
            "email" => email = value,
            "phone" => phone = value,
            "address" => address = value,
            "tax_number" => tax_number = value,
            _ => {}
        }
    }

    if name.is_empty() {
        return Err(format!(
            "Row has no supplier NAME. Map a 'Supplier Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }

    Ok(ParsedSupplier {
        name,
        contact_person,
        email,
        phone,
        address,
        tax_number,
    })
}

/// Checks whether a supplier with the given name already exists
/// (case-insensitive, company-scoped).
async fn supplier_name_exists(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<bool, String> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM suppliers WHERE company_id = ? AND name = ? COLLATE NOCASE)",
    )
    .bind(company_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Supplier lookup error: {e}"))
}

/// Looks up an existing supplier id by name (company-scoped).
async fn find_supplier_id(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM suppliers WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Supplier lookup error: {e}"))
}

/// Finds the next free supplier name by appending -1, -2, … to the base.
async fn next_free_supplier_name(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, String> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if !supplier_name_exists(pool, company_id, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(format!("Could not generate a free name for '{base}'"))
}

async fn insert_supplier(
    pool: &SqlitePool,
    company_id: &str,
    parsed: &ParsedSupplier,
    job_id: &str,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO suppliers
            (id, company_id, name, contact_person, email, phone, address, tax_number, import_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&parsed.name)
    .bind(clean_optional_import(&parsed.contact_person))
    .bind(clean_optional_import(&parsed.email))
    .bind(clean_optional_import(&parsed.phone))
    .bind(clean_optional_import(&parsed.address))
    .bind(clean_optional_import(&parsed.tax_number))
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    Ok(id)
}

async fn overwrite_supplier(
    pool: &SqlitePool,
    supplier_id: &str,
    company_id: &str,
    parsed: &ParsedSupplier,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE suppliers
        SET name = ?, contact_person = ?, email = ?, phone = ?,
            address = ?, tax_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&parsed.name)
    .bind(clean_optional_import(&parsed.contact_person))
    .bind(clean_optional_import(&parsed.email))
    .bind(clean_optional_import(&parsed.phone))
    .bind(clean_optional_import(&parsed.address))
    .bind(clean_optional_import(&parsed.tax_number))
    .bind(supplier_id)
    .bind(company_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to overwrite supplier: {e}"))?;

    Ok(())
}

/// Imports one row into the suppliers table.
/// Returns Ok(true) when imported, Ok(false) when skipped by strategy.
#[allow(clippy::too_many_arguments)]
async fn import_one_supplier_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, String> {
    let parsed = parse_supplier_row(mappings, row)?;

    if let Some(existing_id) = find_supplier_id(pool, company_id, &parsed.name).await? {
        match strategy {
            ConflictStrategy::Skip => return Ok(false),
            ConflictStrategy::Overwrite => {
                overwrite_supplier(pool, &existing_id, company_id, &parsed).await?;
                return Ok(true);
            }
            ConflictStrategy::Suffix => {
                let free_name = next_free_supplier_name(pool, company_id, &parsed.name).await?;
                let mut suffixed = parsed;
                suffixed.name = free_name;
                insert_supplier(pool, company_id, &suffixed, job_id).await?;
                return Ok(true);
            }
        }
    }

    insert_supplier(pool, company_id, &parsed, job_id).await?;
    Ok(true)
}

/// Parses a price string to paisa (integer).
/// "15.00" → 1500, "1500" → 1500, "1,500.00" → 150000
fn parse_price(value: &str) -> i64 {
    let cleaned: String = value
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();

    if cleaned.contains('.') {
        // Has decimal point
        let parts: Vec<&str> = cleaned.split('.').collect();
        let whole: i64 = parts[0].parse().unwrap_or(0);
        let decimal_str = if parts.len() > 1 { parts[1] } else { "0" };
        // Pad or truncate to 2 decimal places
        let decimal = if decimal_str.len() >= 2 {
            decimal_str[..2].parse::<i64>().unwrap_or(0)
        } else {
            decimal_str.parse::<i64>().unwrap_or(0) * 10
        };
        whole * 100 + decimal
    } else {
        // No decimal — assume it's already in smallest unit
        cleaned.parse::<i64>().unwrap_or(0)
    }
}

/// Finds an existing category by name, or creates a new one.
async fn resolve_or_create_category(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // Try to find existing
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM categories WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(trimmed)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Category lookup error: {e}"))?;

    if let Some(id) = existing {
        return Ok(Some(id));
    }

    // Create new
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, company_id, name) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(company_id)
        .bind(trimmed)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create category '{trimmed}': {e}"))?;

    Ok(Some(id))
}

/// Finds an existing supplier by name, or creates a new one.
async fn resolve_or_create_supplier(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM suppliers WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(trimmed)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Supplier lookup error: {e}"))?;

    if let Some(id) = existing {
        return Ok(Some(id));
    }

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO suppliers (id, company_id, name) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(company_id)
        .bind(trimmed)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create supplier '{trimmed}': {e}"))?;

    Ok(Some(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{register_owner, register_owner_full, setup_app};
    use calamine::{CellErrorType, Data};
    use tauri::test::MockRuntime;
    use tauri::Manager;

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    async fn owner_app() -> tauri::App<MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    async fn current_company_id(app: &tauri::App<MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .expect("company id")
    }

    fn mapping(
        source: &str,
        index: usize,
        target: &str,
        category: &str,
        confidence: &str,
    ) -> FieldMapping {
        FieldMapping {
            source_column: source.to_string(),
            source_index: index,
            target_field: target.to_string(),
            field_category: category.to_string(),
            confidence: confidence.to_string(),
            manual_value: None,
        }
    }

    /// Builds a minimal but valid .docx (ZIP + word/document.xml) in memory.
    fn make_docx(document_xml: &str) -> Vec<u8> {
        use std::io::Write;
        let cursor = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .expect("start file");
        zip.write_all(document_xml.as_bytes()).expect("write xml");
        zip.finish().expect("finish zip").into_inner()
    }

    // ---------------------------------------------------------------
    // normalize_header (pure)
    // ---------------------------------------------------------------

    #[test]
    fn normalize_header_lowercases_and_collapses_spaces() {
        // Input: "Product Name!", "  SKU # ", "unit__price".
        // Expected: lowercase, non-alphanumerics dropped, spaces collapsed.
        assert_eq!(normalize_header("Product Name!"), "product name");
        assert_eq!(normalize_header("  SKU # "), "sku");
        assert_eq!(normalize_header("Unit__Price"), "unit price");
        assert_eq!(normalize_header("Cost Price"), "cost price");
    }

    // ---------------------------------------------------------------
    // propose_mappings / detect_field (pure)
    // ---------------------------------------------------------------

    #[test]
    fn propose_mappings_matches_core_fields() {
        // Input: common ERP headers.
        // Expected: sku/name/sell_price/quantity/unit/category/supplier/tax/expiry mapped.
        let headers = vec![
            "SKU".to_string(),
            "Product Name".to_string(),
            "Selling Price".to_string(),
            "Qty".to_string(),
            "Unit".to_string(),
            "Category".to_string(),
            "Supplier".to_string(),
            "Tax Rate".to_string(),
            "Expiry Date".to_string(),
        ];
        let mapped = propose_mappings("products", &headers);
        assert_eq!(mapped[0].target_field, "sku");
        assert_eq!(mapped[0].field_category, "core");
        assert_eq!(mapped[0].confidence, "high");
        assert_eq!(mapped[1].target_field, "name");
        assert_eq!(mapped[2].target_field, "sell_price");
        assert_eq!(mapped[3].target_field, "quantity_in_stock");
        assert_eq!(mapped[4].target_field, "unit");
        assert_eq!(mapped[5].target_field, "category");
        assert_eq!(mapped[5].confidence, "medium");
        assert_eq!(mapped[6].target_field, "supplier");
        assert_eq!(mapped[7].target_field, "tax_rate");
        assert_eq!(mapped[8].target_field, "expiry_date");
        assert_eq!(mapped[8].confidence, "high");
    }

    #[test]
    fn propose_mappings_custom_fallback_for_unknown_column() {
        // Input: a header with no known pattern.
        // Expected: custom:<normalized> field, category "custom", confidence "unknown".
        let headers = vec!["Flavor".to_string()];
        let mapped = propose_mappings("products", &headers);
        assert_eq!(mapped[0].target_field, "custom:flavor");
        assert_eq!(mapped[0].field_category, "custom");
        assert_eq!(mapped[0].confidence, "unknown");
    }

    #[test]
    fn propose_mappings_preserves_source_column_and_index() {
        // Input: headers ["Name", "Price"].
        // Expected: source_column/source_index echo the file.
        let headers = vec!["Name".to_string(), "Price".to_string()];
        let mapped = propose_mappings("products", &headers);
        assert_eq!(mapped[0].source_column, "Name");
        assert_eq!(mapped[0].source_index, 0);
        assert_eq!(mapped[1].source_column, "Price");
        assert_eq!(mapped[1].source_index, 1);
        assert_eq!(mapped[1].target_field, "sell_price");
    }

    #[test]
    fn propose_mappings_matches_customer_fields() {
        // Input: FBR-focused customer headers.
        // Expected: customer_name/email/phone/address/cnic/ntn/strn/buyer_type mapped.
        let headers = vec![
            "Customer Name".to_string(),
            "Email".to_string(),
            "Phone Number".to_string(),
            "Address".to_string(),
            "CNIC".to_string(),
            "NTN".to_string(),
            "STRN".to_string(),
            "Buyer Type".to_string(),
        ];
        let mapped = propose_mappings("customers", &headers);
        let fields: Vec<&str> = mapped.iter().map(|m| m.target_field.as_str()).collect();
        assert_eq!(
            fields,
            vec![
                "customer_name",
                "email",
                "phone",
                "address",
                "cnic",
                "ntn",
                "strn",
                "buyer_type"
            ]
        );
        assert!(mapped.iter().all(|m| m.field_category == "core"));
        assert_eq!(mapped[0].confidence, "high");
    }

    #[test]
    fn propose_mappings_skips_unknown_customer_column() {
        // Input: a column the customer vocabulary does not know.
        // Expected: mapped as "skip".
        let headers = vec!["Customer Name".to_string(), "Notes".to_string()];
        let mapped = propose_mappings("customers", &headers);
        assert_eq!(mapped[0].target_field, "customer_name");
        assert_eq!(mapped[1].target_field, "skip");
        assert_eq!(mapped[1].field_category, "skip");
    }

    #[test]
    fn propose_mappings_matches_opening_stock_fields() {
        // Input: opening-stock headers.
        // Expected: sku/name/quantity/cost_price/expiry_date mapped.
        let headers = vec![
            "SKU".to_string(),
            "Product Name".to_string(),
            "Opening Qty".to_string(),
            "Cost Price".to_string(),
            "Expiry Date".to_string(),
        ];
        let mapped = propose_mappings("opening_stock", &headers);
        let fields: Vec<&str> = mapped.iter().map(|m| m.target_field.as_str()).collect();
        assert_eq!(
            fields,
            vec!["sku", "name", "quantity", "cost_price", "expiry_date"]
        );
        assert_eq!(mapped[0].confidence, "high");
        assert_eq!(mapped[2].confidence, "high");
    }

    // ---------------------------------------------------------------
    // parse_price (pure)
    // ---------------------------------------------------------------

    #[test]
    fn parse_price_converts_to_paisa() {
        // Input: "15.00", "1500", "1,500.00", "0".
        // Expected: 1500, 1500 (already paisa), 150000, 0.
        assert_eq!(parse_price("15.00"), 1500);
        assert_eq!(parse_price("1500"), 1500);
        assert_eq!(parse_price("1,500.00"), 150000);
        assert_eq!(parse_price("0"), 0);
    }

    #[test]
    fn parse_price_truncates_to_two_decimals() {
        // Input: "5.999", "1.2", "7".
        // Expected: 599, 120, 7.
        assert_eq!(parse_price("5.999"), 599);
        assert_eq!(parse_price("1.2"), 120);
        assert_eq!(parse_price("7"), 7);
    }

    // ---------------------------------------------------------------
    // cell_to_string (pure)
    // ---------------------------------------------------------------

    #[test]
    fn cell_to_string_converts_common_variants() {
        // Input: String/Int/Float/Bool/Error/Empty cells.
        // Expected: trimmed strings, whole floats without decimal, errors/empty = "".
        assert_eq!(
            cell_to_string(&Data::String("  Widget  ".to_string())),
            "Widget"
        );
        assert_eq!(cell_to_string(&Data::Int(42)), "42");
        assert_eq!(cell_to_string(&Data::Float(5.0)), "5");
        assert_eq!(cell_to_string(&Data::Float(5.5)), "5.5");
        assert_eq!(cell_to_string(&Data::Bool(true)), "true");
        assert_eq!(cell_to_string(&Data::Error(CellErrorType::NA)), "");
        assert_eq!(cell_to_string(&Data::Empty), "");
    }

    // ---------------------------------------------------------------
    // parse_docx_table (pure)
    // ---------------------------------------------------------------

    #[test]
    fn parse_docx_table_extracts_first_table() {
        // Input: minimal WordprocessingML with a 2x2 table.
        // Expected: two rows, multi-paragraph cell joined with a space.
        let xml = concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:tbl>",
            "<w:tr><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Product</w:t></w:r></w:p><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Widget</w:t></w:r></w:p></w:tc></w:tr>",
            "</w:tbl></w:body></w:document>",
        );
        let rows = parse_docx_table(xml).expect("parse");
        assert_eq!(
            rows,
            vec![
                vec!["SKU".to_string(), "Product Name".to_string()],
                vec!["A-1".to_string(), "Widget".to_string()],
            ]
        );
    }

    #[test]
    fn parse_docx_table_rejects_malformed_xml() {
        // Input: invalid XML.
        // Expected: Err containing "XML parsing error".
        let err = parse_docx_table("<w:tbl").unwrap_err();
        assert!(err.contains("XML parsing error"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // detect_field_type / looks_like_date
    // ---------------------------------------------------------------

    #[test]
    fn looks_like_date_recognizes_common_formats() {
        // Input: ISO, slash and non-date strings.
        // Expected: date-like patterns true, others false.
        assert!(looks_like_date("2024-01-15"));
        assert!(looks_like_date("15/01/2024"));
        assert!(!looks_like_date("not a date"));
        assert!(!looks_like_date("2024"));
        assert!(!looks_like_date("Widget"));
    }

    #[tokio::test]
    async fn detect_field_type_classifies_numeric_and_text_columns() {
        // Input: CSV with a Price column of numbers and a Name column of text.
        // Expected: "number" for the price column, "text" for the name column.
        let req = ImportRequest {
            target: "products".to_string(),
            mappings: Vec::new(),
            file_bytes: b"Name,Price\nAlpha,10.50\nBeta,20.25\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            import_data: false,
        conflict_strategy: ConflictStrategy::default(),
        dry_run: false,
        file_name: None,
        };
        assert_eq!(detect_field_type(&req, &mapping("Price", 1, "skip", "core", "high")), "number");
        assert_eq!(detect_field_type(&req, &mapping("Name", 0, "skip", "core", "high")), "text");
    }

    #[tokio::test]
    async fn detect_field_type_returns_text_for_unknown_type() {
        // Input: CSV whose sampled column is neither numeric nor date-like.
        // Expected: "text".
        let req = ImportRequest {
            target: "products".to_string(),
            mappings: Vec::new(),
            file_bytes: b"Header\none\ntwo\nthree\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            import_data: false,
        conflict_strategy: ConflictStrategy::default(),
        dry_run: false,
        file_name: None,
        };
        assert_eq!(detect_field_type(&req, &mapping("Header", 0, "skip", "core", "high")), "text");
    }

    #[test]
    fn manual_field_applies_constant_value_to_every_row() {
        // Input: a manually-added mapping (no file column, fixed value)
        // plus a normal file column mapping.
        // Expected: the fixed value is used for every row even though the
        // source_index points nowhere.
        let mappings = vec![
            mapping("Name", 0, "name", "core", "high"),
            mapping("SKU", 1, "sku", "core", "high"),
            FieldMapping {
                source_column: "Category".to_string(),
                source_index: 99,
                target_field: "category".to_string(),
                field_category: "core".to_string(),
                confidence: "manual".to_string(),
                manual_value: Some("Medicines".to_string()),
            },
        ];
        let row = vec!["Aspirin".to_string(), "A-1".to_string()];
        let parsed = parse_product_row(&mappings, &row).expect("row parses");
        assert_eq!(parsed.name, "Aspirin");
        assert_eq!(parsed.sku, "A-1");
        assert_eq!(parsed.category_name, "Medicines");
    }

    // ---------------------------------------------------------------
    // analyze_import_file (integration)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn analyze_csv_returns_headers_rows_and_mappings() {
        // Input: a 2-column, 2-data-row CSV through analyze_import_file.
        // Expected: headers extracted, total_rows = 2, sku/name mappings proposed.
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\nA-2,Gadget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            None,
        )
        .await
        .expect("analyze");
        assert_eq!(
            analysis.headers,
            vec!["SKU".to_string(), "Product Name".to_string()]
        );
        assert_eq!(analysis.total_rows, 2);
        assert_eq!(analysis.sample_rows.len(), 2);
        assert_eq!(analysis.file_type, "csv");
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");
    }

    #[tokio::test]
    async fn analyze_csv_with_header_row_only_has_zero_total_rows() {
        // Input: CSV with only a header line.
        // Expected: total_rows = 0, empty sample, headers still parsed.
        let app = owner_app().await;
        let csv = "SKU,Product Name\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            None,
        )
        .await
        .expect("analyze");
        assert_eq!(analysis.total_rows, 0);
        assert!(analysis.sample_rows.is_empty());
    }

    #[tokio::test]
    async fn analyze_import_file_rejects_empty_bytes() {
        // Input: empty byte vector.
        // Expected: Err "File is empty".
        let app = owner_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            Vec::new(),
            "csv".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "File is empty");
    }

    #[tokio::test]
    async fn analyze_import_file_rejects_unsupported_type() {
        // Input: file_type "pdf".
        // Expected: Err listing supported types.
        let app = owner_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            b"data".to_vec(),
            "pdf".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unsupported file type"), "got: {err}");
        assert!(err.contains("xlsx"));
    }

    #[tokio::test]
    async fn analyze_import_file_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            b"a,b\n1,2".to_vec(),
            "csv".to_string(),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn analyze_docx_extracts_table_from_real_zip() {
        // Input: an in-memory .docx (ZIP) containing one table.
        // Expected: headers/rows/mappings extracted; file_type "docx".
        let app = owner_app().await;
        let xml = concat!(
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:tbl>",
            "<w:tr><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Product Name</w:t></w:r></w:p></w:tc></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Widget</w:t></w:r></w:p></w:tc></w:tr>",
            "</w:tbl></w:body></w:document>",
        );
        let bytes = make_docx(xml);

        let analysis =
            analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None)
                .await
                .expect("analyze");
        assert_eq!(analysis.file_type, "docx");
        assert_eq!(
            analysis.headers,
            vec!["SKU".to_string(), "Product Name".to_string()]
        );
        assert_eq!(analysis.total_rows, 1);
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");
    }

    #[tokio::test]
    async fn analyze_docx_rejects_file_without_table() {
        // Input: a valid .docx whose XML has no <w:tbl>.
        // Expected: Err about no table found.
        let app = owner_app().await;
        let xml = concat!(
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:p><w:r><w:t>Just text</w:t></w:r></w:p></w:body></w:document>",
        );
        let bytes = make_docx(xml);
        let err = analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None)
            .await
            .unwrap_err();
        assert!(err.contains("No table found"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // execute_import (integration)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn execute_import_creates_products_relations_and_batches() {
        // Input: CSV with sku/name/category/supplier/qty/prices/tax/expiry/custom columns.
        // Expected: 2 products imported, 1 custom field, category+supplier created,
        //           stock movement + expiry batch recorded, tax as basis points.
        let app = setup_app().await;
        let company = register_owner_full(&app, "owner@test.com").await;
        let company_id = &company.company.id;

        let csv = concat!(
            "SKU,Product Name,Category,Supplier,Quantity,Sell Price,Cost Price,Tax Rate,Expiry Date,Flavor\n",
            "A-1,Widget One,Gadgets,Acme Supplies,10,1500.00,800.00,17.00,2026-12-31,Vanilla\n",
            "A-2,Widget Two,Gadgets,Acme Supplies,5,2000.00,1000.00,0,,\n",
        );

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Category", 2, "category", "core", "medium"),
                    mapping("Supplier", 3, "supplier", "core", "medium"),
                    mapping("Quantity", 4, "quantity_in_stock", "core", "high"),
                    mapping("Sell Price", 5, "sell_price", "core", "high"),
                    mapping("Cost Price", 6, "cost_price", "core", "high"),
                    mapping("Tax Rate", 7, "tax_rate", "core", "medium"),
                    mapping("Expiry Date", 8, "expiry_date", "core", "high"),
                    mapping("Flavor", 9, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: "default".to_string(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.fields_created, 1);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.errors.is_empty());

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 2);

        let (name, cost, sell, tax, qty, category, supplier): (
            String,
            i64,
            i64,
            i64,
            i64,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT p.name, p.cost_price, p.sell_price, p.tax_rate, p.quantity_in_stock,
                        COALESCE(c.name, ''), COALESCE(s.name, '')
                 FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 LEFT JOIN suppliers s ON s.id = p.supplier_id
                 WHERE p.sku = 'A-1'",
        )
        .fetch_one(&*pool)
        .await
        .expect("product");
        assert_eq!(name, "Widget One");
        assert_eq!(cost, 80000);
        assert_eq!(sell, 150000);
        assert_eq!(tax, 1700);
        assert_eq!(qty, 10);
        assert_eq!(category, "Gadgets");
        assert_eq!(supplier, "Acme Supplies");

        let custom: Option<String> =
            sqlx::query_scalar("SELECT custom_fields FROM products WHERE sku = 'A-1'")
                .fetch_one(&*pool)
                .await
                .expect("custom");
        assert!(
            custom
                .as_ref()
                .unwrap_or(&String::new())
                .contains("Vanilla"),
            "got: {custom:?}"
        );

        let category_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&*pool)
            .await
            .expect("categories");
        assert_eq!(
            category_count, 1,
            "categories should be shared between rows"
        );
        let supplier_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM suppliers")
            .fetch_one(&*pool)
            .await
            .expect("suppliers");
        assert_eq!(supplier_count, 1);

        let movement_note: String = sqlx::query_scalar(
            "SELECT reference_note FROM stock_movements WHERE movement_type = 'adjustment' LIMIT 1",
        )
        .fetch_one(&*pool)
        .await
        .expect("movement");
        assert_eq!(movement_note, "Imported from file");

        let (batch_qty, batch_expiry, batch_source): (i64, String, String) =
            sqlx::query_as("SELECT quantity, expiry_date, source FROM stock_batches")
                .fetch_one(&*pool)
                .await
                .expect("batch");
        assert_eq!(batch_qty, 10);
        assert_eq!(batch_expiry, "2026-12-31");
        assert_eq!(batch_source, "import");

        let (field_name, field_label, field_type): (String, String, String) = sqlx::query_as(
            "SELECT field_name, field_label, field_type FROM company_field_settings",
        )
        .fetch_one(&*pool)
        .await
        .expect("field");
        assert_eq!(field_name, "flavor");
        assert_eq!(field_label, "Flavor");
        assert_eq!(field_type, "text");

        let (tpl_name, tpl_type): (String, String) =
            sqlx::query_as("SELECT template_name, file_type FROM import_templates")
                .fetch_one(&*pool)
                .await
                .expect("template");
        assert_eq!(tpl_name, "default");
        assert_eq!(tpl_type, "csv");

        let audit_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'import'")
                .fetch_one(&*pool)
                .await
                .expect("audit");
        assert_eq!(audit_count, 1);
    }

    #[tokio::test]
    async fn execute_import_skips_duplicate_sku_by_default() {
        // Input: two rows sharing the same SKU.
        // Expected (spec §23.7): default conflict strategy = skip,
        // so 1 product imported and 1 row skipped (not an error).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\nA-1,Widget Dup\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_skipped, 1);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.job_id.is_some());
    }

    #[tokio::test]
    async fn execute_import_overwrite_strategy_updates_existing_sku() {
        // Input: a pre-existing product with SKU A-1, then a CSV that
        // updates it. Expected: overwrite keeps one product, changes name.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        sqlx::query(
            "INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock, unit) VALUES (?, ?, 'A-1', 'Old Name', 0, 0, 0, '')",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .expect("seed product");

        let csv = "SKU,Product Name\nA-1,New Name\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::Overwrite,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(pool.inner())
            .await
            .expect("count");
        assert_eq!(count, 1);
        let name: String = sqlx::query_scalar(
            "SELECT name FROM products WHERE company_id = ? AND sku = 'A-1'",
        )
        .bind(&company_id)
        .fetch_one(pool.inner())
        .await
        .expect("name");
        assert_eq!(name, "New Name");
    }

    #[tokio::test]
    async fn execute_import_suffix_strategy_creates_new_sku() {
        // Input: a pre-existing product with SKU A-1, then a CSV importing
        // the same SKU. Expected: suffix strategy creates A-1-1.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        sqlx::query(
            "INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock, unit) VALUES (?, ?, 'A-1', 'Existing', 0, 0, 0, '')",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .expect("seed product");

        let csv = "SKU,Product Name\nA-1,Another\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::Suffix,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(pool.inner())
            .await
            .expect("count");
        assert_eq!(count, 2);
        let suffixed: Option<String> = sqlx::query_scalar(
            "SELECT sku FROM products WHERE company_id = ? AND sku = 'A-1-1'",
        )
        .bind(&company_id)
        .fetch_one(pool.inner())
        .await
        .expect("lookup");
        assert_eq!(suffixed.as_deref(), Some("A-1-1"));
    }

    #[tokio::test]
    async fn execute_import_errors_when_name_column_missing() {
        // Input: only an SKU column mapped, no name source.
        // Expected: every row errors with the "no product NAME" message.
        let app = owner_app().await;
        let csv = "SKU\nA-1\nA-2\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.rows_with_errors, 2);
        assert!(
            result.errors[0].reason.contains("Row has no product NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_skips_blank_rows() {
        // Input: CSV with an empty line between two data rows.
        // Expected: blank row skipped, both products imported.
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n\nA-2,Gadget\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");
        assert_eq!(result.products_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
    }

    #[tokio::test]
    async fn execute_import_bad_expiry_reports_row_error() {
        // Input: an unparseable expiry date in one row.
        // Expected: that row fails; others still import.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Expiry Date\nA-1,Widget,not-a-date\nA-2,Gadget,\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Expiry Date", 2, "expiry_date", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0]
                .reason
                .contains("Cannot read date 'not-a-date'"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_without_import_data_creates_no_products() {
        // Input: same mappings but import_data = false.
        // Expected: custom field still created, 0 products imported.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Flavor\nA-1,Widget,Vanilla\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Flavor", 2, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: false,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.fields_created, 1);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn execute_import_stops_after_fifty_errors() {
        // Input: 55 rows that all fail (no name mapping).
        // Expected: 50 counted errors + a "Stopped after 50 errors" cap entry.
        let app = owner_app().await;
        let mut csv = String::from("SKU\n");
        for i in 0..55 {
            csv.push_str(&format!("SKU-{i}\n"));
        }
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.into_bytes(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.rows_with_errors, 50);
        assert_eq!(result.errors.len(), 51);
        assert_eq!(result.errors.last().unwrap().row_number, 0);
        assert!(
            result
                .errors
                .last()
                .unwrap()
                .reason
                .contains("Stopped after 50 errors"),
            "got: {}",
            result.errors.last().unwrap().reason
        );
    }

    #[tokio::test]
    async fn execute_import_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: Vec::new(),
                file_bytes: b"a,b\n1,2".to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn execute_import_creates_customers() {
        // Input: CSV with FBR customer columns.
        // Expected: 2 customers inserted with all fields populated.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Customer Name,Email,Phone,Address,CNIC,NTN,STRN,Buyer Type\n",
            "Ahmed Khan,ahmed@mail.com,03001234567,Lahore,42101-1234567-1,NTN-001,STRN-001,registered\n",
            "Zainab Ali,zainab@mail.com,03111234567,Karachi,,NTN-002,STRN-002,unregistered\n",
        );

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Email", 1, "email", "core", "high"),
                    mapping("Phone", 2, "phone", "core", "high"),
                    mapping("Address", 3, "address", "core", "medium"),
                    mapping("CNIC", 4, "cnic", "core", "medium"),
                    mapping("NTN", 5, "ntn", "core", "medium"),
                    mapping("STRN", 6, "strn", "core", "medium"),
                    mapping("Buyer Type", 7, "buyer_type", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.customers_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.errors.is_empty());

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 2);

        let (_name, email, phone, address, cnic, ntn, strn, buyer_type): (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT name, COALESCE(email, ''), COALESCE(phone, ''), COALESCE(address, ''),
                    COALESCE(cnic, ''), COALESCE(ntn, ''), COALESCE(strn, ''), buyer_type
             FROM customers WHERE company_id = ? AND name = 'Ahmed Khan'",
        )
        .bind(company_id)
        .fetch_one(&*pool)
        .await
        .expect("customer");
        assert_eq!(email, "ahmed@mail.com");
        assert_eq!(phone, "03001234567");
        assert_eq!(address, "Lahore");
        assert_eq!(cnic, "42101-1234567-1");
        assert_eq!(ntn, "NTN-001");
        assert_eq!(strn, "STRN-001");
        assert_eq!(buyer_type, "registered");
    }

    #[tokio::test]
    async fn execute_import_customers_skip_duplicates() {
        // Input: the same customer name twice.
        // Expected: 1 inserted, 1 silently skipped, no errors.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Customer Name,Phone\n",
            "Ahmed Khan,03001234567\n",
            "Ahmed Khan,03111234567\n",
        );

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.customers_imported, 1);
        assert_eq!(result.rows_with_errors, 0);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn execute_import_customer_missing_name_reports_error() {
        // Input: a row with only a phone, no name.
        // Expected: row error, 0 customers imported.
        let app = owner_app().await;
        let csv = "Customer Name,Phone\n,03001234567\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.customers_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert_eq!(result.errors[0].row_number, 2);
        assert!(
            result.errors[0].reason.contains("no customer NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_opening_stock_adds_quantity_and_batch() {
        // Input: a product imported first, then an opening-stock CSV.
        // Expected: product quantity increases, movement + expiry batch recorded.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;

        // Seed the product via the products import path.
        let product_csv = "SKU,Product Name,Quantity\nA-1,Widget One,5\n";
        let product_result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: product_csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("product import");
        assert_eq!(product_result.products_imported, 1);

        let stock_csv = concat!(
            "SKU,Opening Qty,Cost Price,Expiry Date\n",
            "A-1,10,850.00,2026-12-31\n",
        );
        let stock_result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "opening_stock".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Opening Qty", 1, "quantity", "core", "high"),
                    mapping("Cost Price", 2, "cost_price", "core", "high"),
                    mapping("Expiry Date", 3, "expiry_date", "core", "high"),
                ],
                file_bytes: stock_csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("stock import");

        assert_eq!(stock_result.items_imported, 1);
        assert_eq!(stock_result.rows_with_errors, 0);

        let pool = app.state::<SqlitePool>();
        let qty: i64 = sqlx::query_scalar(
            "SELECT quantity_in_stock FROM products WHERE company_id = ? AND sku = 'A-1'",
        )
        .bind(company_id)
        .fetch_one(&*pool)
        .await
        .expect("qty");
        assert_eq!(qty, 15);

        let movement: String = sqlx::query_scalar(
            "SELECT reference_note FROM stock_movements
             WHERE movement_type = 'adjustment' AND reference_note = 'Opening stock from import'",
        )
        .fetch_one(&*pool)
        .await
        .expect("movement");
        assert_eq!(movement, "Opening stock from import");

        let (batch_qty, batch_cost, batch_expiry): (i64, i64, String) =
            sqlx::query_as("SELECT quantity, unit_cost, expiry_date FROM stock_batches")
                .fetch_one(&*pool)
                .await
                .expect("batch");
        assert_eq!(batch_qty, 10);
        assert_eq!(batch_cost, 85000);
        assert_eq!(batch_expiry, "2026-12-31");
    }

    #[tokio::test]
    async fn execute_import_opening_stock_unknown_sku_reports_error() {
        // Input: opening stock row for a SKU that does not exist.
        // Expected: row error, no movement created.
        let app = owner_app().await;
        let csv = "SKU,Opening Qty\nMISSING-1,10\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "opening_stock".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Opening Qty", 1, "quantity", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.items_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0]
                .reason
                .contains("No product with SKU 'MISSING-1'"),
            "got: {}",
            result.errors[0].reason
        );

        let pool = app.state::<SqlitePool>();
        let movement_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_movements")
            .fetch_one(&*pool)
            .await
            .expect("movements");
        assert_eq!(movement_count, 0);
    }

    #[tokio::test]
    async fn execute_import_suppliers_creates_suppliers() {
        // Input: a supplier CSV. Expected: 2 suppliers with contact details.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Supplier Name,Contact Person,Phone,Email,NTN\n",
            "Acme Supplies,Raza Ali,03001234567,raza@acme.pk,1234567-8\n",
            "Global Traders,Sana,03111234567,sana@global.pk,7654321-0\n",
        );

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "suppliers".to_string(),
                mappings: vec![
                    mapping("Supplier Name", 0, "supplier_name", "core", "high"),
                    mapping("Contact Person", 1, "contact_person", "core", "medium"),
                    mapping("Phone", 2, "phone", "core", "high"),
                    mapping("Email", 3, "email", "core", "high"),
                    mapping("NTN", 4, "tax_number", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.items_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.job_id.is_some());

        let pool = app.state::<SqlitePool>();
        let (name, tax): (String, String) = sqlx::query_as(
            "SELECT name, tax_number FROM suppliers WHERE company_id = ? AND name = 'Acme Supplies'",
        )
        .bind(&company_id)
        .fetch_one(&*pool)
        .await
        .expect("supplier");
        assert_eq!(name, "Acme Supplies");
        assert_eq!(tax, "1234567-8");
    }

    #[tokio::test]
    async fn execute_import_supplier_missing_name_reports_error() {
        // Input: a supplier row with no name. Expected: row error.
        let app = owner_app().await;
        let csv = "Supplier Name,Phone\n,03001234567\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "suppliers".to_string(),
                mappings: vec![
                    mapping("Supplier Name", 0, "supplier_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.items_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0].reason.contains("no supplier NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_dry_run_writes_nothing() {
        // Input: a valid products CSV with dry_run = true.
        // Expected: counts reported, but zero rows actually written.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = "SKU,Product Name,Quantity\nA-1,Widget,5\nA-2,Widget Two,3\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: true,
                file_name: None,
            },
        )
        .await
        .expect("dry run");

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert_eq!(result.job_id, None);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 0);
        let job_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*pool)
            .await
            .expect("job count");
        assert_eq!(job_count, 0);
    }

    #[tokio::test]
    async fn rollback_import_reverts_imported_records() {
        // Input: products imported, then rollback_import on the job.
        // Expected: products/movements removed, job marked rolled_back.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = "SKU,Product Name,Quantity\nA-1,Widget,5\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: Some("products.csv".to_string()),
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job id");

        let pool = app.state::<SqlitePool>();
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(before, 1);

        let rollback = rollback_import(
            app.state(),
            app.state(),
            job_id.clone(),
        )
        .await
        .expect("rollback");

        assert_eq!(rollback.products_deleted, 1);
        assert!(rollback.movements_deleted >= 1);

        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(after, 0);

        let status: String =
            sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
                .bind(&job_id)
                .fetch_one(&*pool)
                .await
                .expect("status");
        assert_eq!(status, "rolled_back");

        // A second rollback must be rejected.
        let err = rollback_import(app.state(), app.state(), job_id)
            .await
            .expect_err("second rollback should fail");
        assert!(err.contains("already been rolled back"), "got: {err}");
    }
}
