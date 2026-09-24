use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

// ==========================================
// TYPES & CONSTANTS
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
    /// "xlsx", "csv", "docx", "pdf", "png", "jpg", or "jpeg"
    pub file_type: String,
    /// Rust's proposed mapping for each column
    pub proposed_mappings: Vec<FieldMapping>,
    /// The mapping Rust would have proposed WITHOUT an auto-matched template.
    /// `proposed_mappings` may have been replaced by a template's mappings
    /// (spec §23.5); this keeps the generic proposals so the frontend can let
    /// the user "clear the template" and go back to header detection.
    pub generic_mappings: Vec<FieldMapping>,
    /// When a saved per-target template matched this file's headers, its id.
    /// The frontend uses this to show "auto-detected template" and to skip
    /// asking the user to re-map (spec §23.5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_template_id: Option<String>,
    /// Name of the auto-matched template (same as `auto_template_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_template_name: Option<String>,
}

/// A reusable per-target mapping template (spec §23.5).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTemplate {
    pub id: String,
    pub company_id: String,
    pub template_name: String,
    /// Stored value ("xlsx" or "csv" — other formats are normalised on save
    /// because the legacy `import_templates.file_type` column has a CHECK
    /// constraint that only allows those two).
    pub file_type: String,
    pub column_mappings: Vec<FieldMapping>,
    pub has_header_row: bool,
    /// What import target this template maps ("products", "customers", ...).
    #[serde(default)]
    pub target: String,
    /// How many times this template has been auto-reused.
    #[serde(default)]
    pub use_count: i64,
    /// ISO timestamp of the most recent reuse (NULL until used).
    #[serde(default)]
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
#[derive(Default)]
pub enum ConflictStrategy {
    /// Skip the row silently (re-imports are idempotent).
    #[default]
    Skip,
    /// Update the existing record with the file's values.
    Overwrite,
    /// Insert as a new record with a suffixed SKU / name (e.g. `SKU-1`).
    Suffix,
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
    /// Whether the file has a header row (defaults to true).
    #[serde(default = "default_has_header_row")]
    pub has_header_row: bool,
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

fn default_has_header_row() -> bool {
    true
}

/// Result of the import operation
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub row_number: usize,
    pub reason: String,
}

/// A persisted import job (migration 009 `import_jobs`). Written by
/// `execute_import`, read by `list_import_jobs` / `get_import_job`, and rolled
/// back by `rollback_import`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub file_type: String,
    pub file_name: Option<String>,
    /// "products" | "customers" | "opening_stock" | "suppliers"
    pub target: String,
    /// "pending" | "processing" | "completed" | "failed" | "rolled_back"
    pub status: String,
    pub total_rows: i64,
    /// Rows successfully imported (products + customers + items).
    pub processed_rows: i64,
    /// Rows processed so far — numerator of the live progress bar.
    pub attempted_rows: i64,
    pub error_rows: i64,
    /// 0–100 progress estimate based on `attempted_rows` / `total_rows`.
    pub progress: i64,
    pub error_details: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    /// True when the job finished less than 24h ago and can still be rolled back.
    pub rollback_available: bool,
    /// Records imported by this job (products + customers + items).
    pub imported_records: i64,
}

/// A polled snapshot of a running (or finished) import job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobStatus {
    pub job: ImportJob,
    /// The full result once the job reaches a terminal state, else `None`.
    /// Lets the frontend render the same result screen as the old
    /// synchronous `execute_import` flow.
    pub result: Option<ImportResult>,
}


/// Event payload emitted on `import:progress` (live) and `import:complete`
/// (terminal). Serialized camelCase to match the frontend types.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressEvent {
    pub job_id: String,
    /// "processing" | "completed" | "failed"
    pub status: String,
    /// 0–100 estimate based on `attempted_rows` / `total_rows`.
    pub progress: i64,
    pub attempted_rows: i64,
    pub processed_rows: i64,
    pub error_rows: i64,
    pub total_rows: i64,
    pub errors: Vec<ImportError>,
    /// Present on the terminal `import:complete` event.
    pub result: Option<ImportResult>,
}

/// Global handle captured during app setup. The background worker uses it to
/// emit progress events; it is `None` in unit tests (mock apps never run
/// `.setup()`), where emissions are simply skipped.
pub static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Resolved bundle layout for the Tesseract OCR engine shipped with the app
/// (set during setup). When absent, OCR falls back to a `tesseract` on PATH.
pub static OCR_BUNDLE: OnceLock<Option<TesseractBundle>> = OnceLock::new();

/// Location of the Tesseract engine bundled as a Tauri resource.
#[derive(Debug, Clone)]
pub struct TesseractBundle {
    /// Path to the tesseract executable (resource dir).
    pub exe: PathBuf,
    /// Bundled `tessdata` directory — fed to the engine via `TESSDATA_PREFIX`.
    pub tessdata: Option<PathBuf>,
}

/// Initializes the app-wide services the import worker needs:
/// 1. captures the AppHandle so background tasks can emit push events,
/// 2. resolves the bundled Tesseract OCR engine (spec §23.2 Phase 2) so
///    image/scanned-document import works without Tesseract on PATH.
///
/// Called once from the Tauri setup hook in `lib.rs`.
pub fn init_app_services(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    let _ = OCR_BUNDLE.set(resolve_tesseract_bundle(app));
}

fn resolve_tesseract_bundle(app: &AppHandle) -> Option<TesseractBundle> {
    let resource_dir = app.path().resource_dir().ok()?;
    let bundle_dir = resource_dir.join("tesseract");
    let exe_name = if cfg!(target_os = "windows") {
        "tesseract.exe"
    } else {
        "tesseract"
    };
    let exe = bundle_dir.join(exe_name);
    if !exe.is_file() {
        return None;
    }
    let tessdata = bundle_dir.join("tessdata");
    Some(TesseractBundle {
        exe,
        tessdata: if tessdata.is_dir() {
            Some(tessdata)
        } else {
            None
        },
    })
}



#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub products_deleted: i64,
    pub customers_deleted: i64,
    pub suppliers_deleted: i64,
    /// Invoices + their line items removed (sales-invoice imports).
    pub invoices_deleted: i64,
    /// Purchase bills + their line items removed (purchase-bill imports).
    pub purchase_bills_deleted: i64,
    pub movements_deleted: i64,
    pub batches_deleted: i64,
    pub quantity_reverted: i64,
}

// Import quotas (spec §23.10, desktop-adapted)
pub const MAX_IMPORT_FILE_BYTES: usize = 50 * 1024 * 1024; // 50 MB
pub const MAX_IMPORT_ROWS: usize = 100_000;
/// How long after completion an import can be rolled back.
pub const ROLLBACK_WINDOW_SECS: u64 = 24 * 60 * 60;

// Import quotas (spec §23.10). File size and row count are enforced inline;
// the concurrency and hourly caps are checked by `check_import_quotas`
// before a background job is created.
pub const MAX_CONCURRENT_JOBS_PER_COMPANY: i64 = 1;
pub const MAX_JOBS_PER_HOUR_PER_COMPANY: i64 = 5;
pub const QUOTA_HOUR_SECS: i64 = 3600;

/// Local unix-timestamp string, matching the project's other timestamp helpers.
pub fn import_timestamp(secs: u64) -> String {
    secs.to_string()
}

pub fn now_unix() -> u64 {
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
///
/// `invoices` / `purchase_bills` are the spec's primary historical-data
/// targets (§23.2). They are imported as **records**: headers + line-item
/// snapshots are written exactly as the file describes, but no stock,
/// batch or ledger mutation happens — the opening-stock target owns the
/// stock position, and imported history is always safe to roll back.
pub const IMPORT_TARGETS: [&str; 6] = [
    "products",
    "customers",
    "opening_stock",
    "suppliers",
    "invoices",
    "purchase_bills",
];


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpAdapterInfo {
    pub key: String,
    pub name: String,
    pub description: String,
}

pub const ERP_ADAPTER_KEYS: [&str; 6] = [
    "quickbooks_csv",
    "quickbooks_online",
    "odoo_csv",
    "erpnext_csv",
    "excel_generic",
    "tally_csv",
];

/// Lists the pre-built ERP adapters (spec §23.11) the wizard can pre-fill
/// mappings from. Adapters are stored as static definitions here and are
/// applied at analyze time; no deployment is needed to adjust the alias
/// vocabulary.


pub fn is_valid_adapter(adapter: &str) -> bool {
    ERP_ADAPTER_KEYS.contains(&adapter)
}



/// 0–100 progress for a running job (`attempted` out of `total` rows).
pub fn progress_percent(total_rows: i64, attempted_rows: i64) -> i64 {
    if total_rows <= 0 {
        return 0;
    }
    ((attempted_rows * 100) / total_rows).clamp(0, 100)
}


/// Pushes a live progress event to the frontend (spec §23.8). No-op when the
/// app handle is unavailable (unit tests).
pub fn emit_import_progress(
    app_handle: &Option<AppHandle>,
    job_id: &str,
    status: &str,
    progress: i64,
    attempted_rows: i64,
    processed_rows: i64,
    error_rows: i64,
    total_rows: i64,
) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "import:progress",
            ImportProgressEvent {
                job_id: job_id.to_string(),
                status: status.to_string(),
                progress,
                attempted_rows,
                processed_rows,
                error_rows,
                total_rows,
                errors: Vec::new(),
                result: None,
            },
        );
    }
}


/// Pushes the terminal event carrying the full result (spec §23.8). No-op when
/// the app handle is unavailable (unit tests).
pub fn emit_import_complete(
    app_handle: &Option<AppHandle>,
    job_id: &str,
    status: &str,
    result: &ImportResult,
    total_rows: i64,
) {
    if let Some(app) = app_handle {
        let _ = app.emit(
            "import:complete",
            ImportProgressEvent {
                job_id: job_id.to_string(),
                status: status.to_string(),
                progress: 100,
                attempted_rows: result.products_imported as i64
                    + result.customers_imported as i64
                    + result.items_imported as i64
                    + result.rows_skipped as i64
                    + result.rows_with_errors as i64,
                processed_rows: (result.products_imported
                    + result.customers_imported
                    + result.items_imported) as i64,
                error_rows: result.rows_with_errors as i64,
                total_rows,
                errors: result.errors.clone(),
                result: Some(result.clone()),
            },
        );
    }
}


#[allow(dead_code)]
pub fn job_progress(status: &str, total_rows: i64, attempted_rows: i64) -> i64 {
    if matches!(status, "completed" | "failed" | "rolled_back") {
        return 100;
    }
    if total_rows <= 0 {
        return 0;
    }
    ((attempted_rows * 100) / total_rows).clamp(0, 100)
}

/// Lists recent import jobs for the current company.


pub 
enum ValidationOutcome {
    Import,
    Skip,
}


pub fn conflict_outcome(exists: bool, strategy: ConflictStrategy) -> ValidationOutcome {
    if exists && strategy == ConflictStrategy::Skip {
        ValidationOutcome::Skip
    } else {
        ValidationOutcome::Import
    }
}


pub fn clean_optional_import(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}



pub fn parse_price(value: &str) -> i64 {
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
