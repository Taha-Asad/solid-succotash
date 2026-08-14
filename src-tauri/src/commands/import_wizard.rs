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
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};

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

// ---------------------------------------------------------------------------
// PUSH PROGRESS EVENTS (spec §23.8, desktop-adapted)
//
// The background import worker pushes live progress to the frontend through
// the Tauri event system instead of the frontend polling `get_import_job`.
// This is the desktop analogue of the spec's SSE stream: one event per
// progress flush, one terminal event when the job finishes. The frontend
// still has a light `get_import_job` safety re-sync in case an event is
// missed (e.g. a tiny import that finished before the listener registered).
// ---------------------------------------------------------------------------

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
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Resolved bundle layout for the Tesseract OCR engine shipped with the app
/// (set during setup). When absent, OCR falls back to a `tesseract` on PATH.
static OCR_BUNDLE: OnceLock<Option<TesseractBundle>> = OnceLock::new();

/// Location of the Tesseract engine bundled as a Tauri resource.
#[derive(Debug, Clone)]
struct TesseractBundle {
    /// Path to the tesseract executable (resource dir).
    exe: PathBuf,
    /// Bundled `tessdata` directory — fed to the engine via `TESSDATA_PREFIX`.
    tessdata: Option<PathBuf>,
}

/// Initializes the app-wide services the import worker needs:
///  1. captures the AppHandle so background tasks can emit push events,
///  2. resolves the bundled Tesseract OCR engine (spec §23.2 Phase 2) so
///     image/scanned-document import works without Tesseract on PATH.
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

/// Result of rolling back an import job.
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
const MAX_IMPORT_FILE_BYTES: usize = 50 * 1024 * 1024; // 50 MB
const MAX_IMPORT_ROWS: usize = 100_000;
/// How long after completion an import can be rolled back.
const ROLLBACK_WINDOW_SECS: u64 = 24 * 60 * 60;

// Import quotas (spec §23.10). File size and row count are enforced inline;
// the concurrency and hourly caps are checked by `check_import_quotas`
// before a background job is created.
const MAX_CONCURRENT_JOBS_PER_COMPANY: i64 = 1;
const MAX_JOBS_PER_HOUR_PER_COMPANY: i64 = 5;
const QUOTA_HOUR_SECS: i64 = 3600;

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

// ==========================================
// ERP MIGRATION ADAPTERS (spec §23.11)
// ==========================================
//
// A pre-built registry of named ERP export formats. When a user picks an
// adapter, `propose_mappings` pre-fills the field mapping from the ERP's
// known column names so migration needs near-zero manual mapping work.

/// A named ERP adapter shown in the wizard's "ERP system" selector.
#[derive(Debug, Clone, Serialize)]
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
#[tauri::command]
pub async fn list_erp_adapters() -> Vec<ErpAdapterInfo> {
    vec![
        ErpAdapterInfo {
            key: "quickbooks_csv".to_string(),
            name: "QuickBooks Desktop".to_string(),
            description: "Items, customers, vendors and sales invoices (CSV / IIF)".to_string(),
        },
        ErpAdapterInfo {
            key: "quickbooks_online".to_string(),
            name: "QuickBooks Online".to_string(),
            description: "Products, customers and invoices exported as CSV".to_string(),
        },
        ErpAdapterInfo {
            key: "odoo_csv".to_string(),
            name: "Odoo".to_string(),
            description: "Product, partner (customer/vendor) and invoice CSV exports".to_string(),
        },
        ErpAdapterInfo {
            key: "erpnext_csv".to_string(),
            name: "ERPNext".to_string(),
            description: "Item, customer and sales-invoice CSV exports".to_string(),
        },
        ErpAdapterInfo {
            key: "excel_generic".to_string(),
            name: "MS Excel (generic)".to_string(),
            description: "Generic invoice spreadsheet — the spec's alias dictionary (§23.5)".to_string(),
        },
        ErpAdapterInfo {
            key: "tally_csv".to_string(),
            name: "Tally".to_string(),
            description: "Stock items / inventory master CSV exports".to_string(),
        },
    ]
}

/// The adapter's known column names for a target, as
/// `(target_field, alias column names)`. Column names are matched against
/// normalized headers, so casing/punctuation differences are tolerated.
fn erp_adapter_fields<'a>(
    adapter: &str,
    target: &str,
) -> Vec<(&'a str, &'a [&'a str])> {
    let fields: &[(&'a str, &'a [&'a str])] = match (adapter, target) {
        // ---- QuickBooks Desktop / Online: items, customers, vendors ----
        ("quickbooks_csv" | "quickbooks_online", "products") => &[
            ("name", &["name", "item", "item name", "product name"]),
            (
                "sku",
                &["part number", "partnumber", "sku", "item code", "code"],
            ),
            (
                "quantity_in_stock",
                &["qty on hand", "quantity on hand", "on hand", "qty"],
            ),
            ("cost_price", &["purchase cost", "cost price", "cost"]),
            (
                "sell_price",
                &["sales price", "selling price", "price", "rate"],
            ),
            ("unit", &["uom", "unit of measure", "unit"]),
            (
                "category",
                &["class", "category", "income account", "account"],
            ),
            ("supplier", &["preferred vendor", "vendor"]),
            ("tax_rate", &["tax rate", "tax percent", "tax"]),
        ],
        ("quickbooks_csv" | "quickbooks_online", "customers") => &[
            (
                "customer_name",
                &["name", "customer", "customer name", "company name"],
            ),
            ("email", &["email", "email address"]),
            (
                "phone",
                &["phone", "phone number", "phone no", "mobile"],
            ),
            (
                "address",
                &["bill address", "billing address", "address", "ship address"],
            ),
            ("ntn", &["tax id", "tax id number", "tax number", "vat reg"]),
            (
                "buyer_type",
                &["customer type", "customer status", "status"],
            ),
        ],
        ("quickbooks_csv" | "quickbooks_online", "suppliers") => &[
            (
                "supplier_name",
                &["name", "supplier", "vendor", "vendor name", "company name"],
            ),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "phone no"]),
            ("address", &["address", "billing address"]),
            ("tax_number", &["tax id", "tax id number", "tax number", "vat"]),
        ],
        ("quickbooks_csv" | "quickbooks_online", "invoices") => &[
            ("invoice_number", &["invoice no", "invoice number", "inv no", "inv number", "no"]),
            ("invoice_date", &["invoice date", "inv date", "transaction date", "date"]),
            ("customer_name", &["customer", "customer name", "buyer", "sold to"]),
            ("product_sku", &["item", "item name", "item description", "product", "product name"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price", "sales price"]),
            ("tax_rate", &["tax rate", "tax percent", "tax"]),
            ("total_amount", &["total", "grand total", "bill amount", "amount"]),
            ("amount_paid", &["amount paid", "paid amount", "received amount"]),
            ("status", &["status", "invoice status", "payment status"]),
        ],

        // ---- Odoo ----
        ("odoo_csv", "products") => &[
            ("name", &["name", "product name"]),
            (
                "sku",
                &["internal reference", "default code", "sku", "product code"],
            ),
            ("cost_price", &["cost", "standard price", "cost price"]),
            (
                "sell_price",
                &["list price", "sale price", "selling price"],
            ),
            (
                "quantity_in_stock",
                &["on hand quantity", "qty available", "quantity on hand", "stock quantity"],
            ),
            ("category", &["product category", "category", "categ"]),
            ("unit", &["uom", "unit of measure", "internal uom"]),
            ("supplier", &["vendor", "seller"]),
            ("tax_rate", &["taxes", "tax rate", "tax"]),
        ],
        ("odoo_csv", "customers") => &[
            ("customer_name", &["name", "customer", "customer name", "partner", "partner name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "mobile", "mobile number"]),
            ("address", &["street", "address", "street2", "billing address"]),
            ("ntn", &["tax id", "vat", "tax number", "vat number"]),
        ],
        ("odoo_csv", "suppliers") => &[
            ("supplier_name", &["name", "supplier", "vendor", "vendor name", "partner"]),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "mobile"]),
            ("address", &["street", "address", "billing address"]),
            ("tax_number", &["tax id", "vat", "tax number"]),
        ],
        ("odoo_csv", "invoices") => &[
            ("invoice_number", &["name", "number", "invoice number", "invoice no", "reference"]),
            ("invoice_date", &["invoice date", "date", "billing date", "invoice date invoice"]),
            ("customer_name", &["partner", "customer", "customer name", "partner name"]),
            ("product_sku", &["product", "product name", "item", "sku"]),
            ("quantity", &["quantity", "qty"]),
            ("unit_price", &["unit price", "price unit", "price", "rate"]),
            ("tax_rate", &["tax", "taxes", "tax rate"]),
            ("total_amount", &["amount total", "total", "grand total", "amount"]),
            ("amount_paid", &["amount paid", "paid amount", "residual", "amount due"]),
            ("status", &["status", "invoice status", "payment status"]),
        ],

        // ---- ERPNext ----
        ("erpnext_csv", "products") => &[
            ("sku", &["item code", "item_code", "sku", "item"]),
            ("name", &["item name", "item_name", "name", "item description"]),
            ("cost_price", &["valuation rate", "valuation_rate", "cost price", "cost"]),
            ("sell_price", &["standard rate", "standard_rate", "price", "selling rate", "sales rate"]),
            (
                "quantity_in_stock",
                &["actual quantity", "actual_qty", "quantity on hand", "on hand", "qty"],
            ),
            ("category", &["item group", "item_group", "category"]),
            ("unit", &["stock uom", "stock_uom", "uom", "unit of measure"]),
            ("supplier", &["supplier", "vendor"]),
        ],
        ("erpnext_csv", "customers") => &[
            ("customer_name", &["customer name", "customer_name", "name", "customer"]),
            ("email", &["email id", "email_id", "email", "email address"]),
            ("phone", &["mobile no", "mobile_no", "phone", "mobile number"]),
            ("address", &["address", "billing address", "territory"]),
        ],
        ("erpnext_csv", "suppliers") => &[
            ("supplier_name", &["supplier name", "supplier_name", "name", "supplier"]),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email id", "email_id", "email"]),
            ("phone", &["mobile no", "mobile_no", "phone"]),
            ("address", &["address", "billing address"]),
        ],
        ("erpnext_csv", "invoices") => &[
            ("invoice_number", &["name", "invoice number", "invoice no", "reference"]),
            ("invoice_date", &["posting date", "posting_date", "invoice date", "date"]),
            ("customer_name", &["customer", "customer name"]),
            ("product_sku", &["item code", "item_code", "item", "product"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price"]),
            ("tax_rate", &["tax", "tax rate", "taxes"]),
            ("total_amount", &["grand total", "total", "amount", "net total"]),
            ("amount_paid", &["amount paid", "paid amount", "outstanding amount"]),
            ("status", &["status", "invoice status"]),
        ],

        // ---- MS Excel generic invoice (spec §23.5 alias dictionary) ----
        ("excel_generic", "invoices") => &[
            (
                "customer_name",
                &["buyer", "client", "customer", "purchaser", "sold to", "customer name"],
            ),
            (
                "total_amount",
                &["amount", "total", "amt", "grand total", "bill amount", "total amount"],
            ),
            (
                "invoice_date",
                &["date", "inv date", "invoice date", "billing date"],
            ),
            (
                "invoice_number",
                &["inv #", "invoice no", "invoice number", "ref", "reference"],
            ),
        ],

        // ---- Tally ----
        ("tally_csv", "products") => &[
            ("name", &["name", "stock item", "item name", "item"]),
            ("sku", &["sku", "code", "item code", "part number"]),
            (
                "quantity_in_stock",
                &["opening quantity", "opening qty", "quantity", "closing quantity", "on hand"],
            ),
            ("cost_price", &["opening rate", "purchase price", "rate", "cost price", "valuation rate"]),
            ("sell_price", &["sales price", "selling price", "rate"]),
            ("unit", &["units", "uom", "unit", "unit of measure"]),
        ],
        ("tally_csv", "invoices") => &[
            ("invoice_number", &["invoice no", "invoice number", "voucher no", "voucher number", "ref"]),
            ("invoice_date", &["date", "invoice date", "voucher date", "billing date"]),
            ("customer_name", &["customer", "customer name", "party", "buyer", "sold to"]),
            ("product_sku", &["item", "item name", "product", "stock item", "sku"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price", "amount"]),
            ("tax_rate", &["tax rate", "tax", "gst", "vat"]),
            ("total_amount", &["total", "grand total", "bill amount", "amount"]),
            ("status", &["status", "voucher type", "type"]),
        ],

        _ => &[],
    };
    fields.to_vec()
}

/// Whether an adapter key is registered.
fn is_valid_adapter(adapter: &str) -> bool {
    ERP_ADAPTER_KEYS.contains(&adapter)
}

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
    adapter: Option<String>,
) -> Result<FileAnalysis, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let target = target.unwrap_or_else(|| "products".to_string());
    if !IMPORT_TARGETS.contains(&target.as_str()) {
        return Err(format!(
            "Unknown import target '{target}'. Supported: {}",
            IMPORT_TARGETS.join(", ")
        ));
    }

    if let Some(adapter) = adapter.as_deref() {
        if !adapter.is_empty() && !is_valid_adapter(adapter) {
            return Err(format!(
                "Unknown ERP adapter '{adapter}'. Supported: {}",
                ERP_ADAPTER_KEYS.join(", ")
            ));
        }
    }

    if file_bytes.is_empty() {
        return Err("File is empty".to_string());
    }

    if file_bytes.len() > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "File too large ({} bytes). Maximum allowed is {} MB.",
            file_bytes.len(),
            MAX_IMPORT_FILE_BYTES / (1024 * 1024)
        ));
    }

    let mut analysis = match file_type.as_str() {
        "xlsx" | "xls" => analyze_excel(file_bytes, &target, adapter.as_deref()).await?,
        "csv" => analyze_csv(file_bytes, &target, adapter.as_deref()).await?,
        "docx" => analyze_docx(file_bytes, &target, adapter.as_deref()).await?,
        "pdf" => analyze_pdf(file_bytes, &target, adapter.as_deref()).await?,
        "png" | "jpg" | "jpeg" => analyze_image(file_bytes, &target, adapter.as_deref()).await?,
        _ => {
            return Err(format!(
                "Unsupported file type: {file_type}. Supported: xlsx, xls, csv, docx, pdf, \
                 png, jpg"
            ));
        }
    };

    // Spec §23.5 auto-map: when no ERP adapter is pinned and a saved per-target
    // template matches this file's headers, reuse its mappings instead of the
    // generic proposals.
    let generic_mappings = analysis.proposed_mappings.clone();
    if adapter.as_deref().is_none_or(|a| a.is_empty()) {
        if let Some(template) = match_import_template(
            pool.inner(),
            current_user.company_id.as_deref().unwrap_or(""),
            &target,
            &analysis.headers,
        )
        .await?
        {
            analysis.auto_template_id = Some(template.id.clone());
            analysis.auto_template_name = Some(template.template_name.clone());
            analysis.proposed_mappings = template.column_mappings.clone();
            bump_template_usage(pool.inner(), &template.id).await;
        }
    }
    analysis.generic_mappings = generic_mappings;

    Ok(analysis)
}

/// Reads an Excel file and returns analysis
async fn analyze_excel(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(target, adapter, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "xlsx".to_string(),
        generic_mappings: proposed_mappings.clone(),
        proposed_mappings,
        auto_template_id: None,
        auto_template_name: None,
    })
}

/// Reads a CSV file and returns analysis
async fn analyze_csv(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(target, adapter, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "csv".to_string(),
        generic_mappings: proposed_mappings.clone(),
        proposed_mappings,
        auto_template_id: None,
        auto_template_name: None,
    })
}

/// Reads a .docx file and extracts the first table found.
///
/// A .docx file is actually a ZIP containing XML files.
/// The main content lives in word/document.xml.
/// Word tables use <w:tbl>, <w:tr> (row), <w:tc> (cell) tags.
async fn analyze_docx(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(target, adapter, &headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "docx".to_string(),
        generic_mappings: proposed_mappings.clone(),
        proposed_mappings,
        auto_template_id: None,
        auto_template_name: None,
    })
}

/// Analyzes a PDF file (spec §23.2 Phase 2). Text-based PDFs (PDFs with a
/// text layer, e.g. ERP/accounting exports) are extracted directly. Scanned
/// PDFs without a text layer are rejected with guidance — they need OCR.
async fn analyze_pdf(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, String> {
    let all_rows = read_pdf_rows(&file_bytes)?;
    Ok(build_text_analysis(all_rows, "pdf", target, adapter))
}

/// Analyzes an image file (spec §23.2 Phase 2) by running OCR over it.
/// Requires Tesseract OCR to be installed and reachable on PATH.
async fn analyze_image(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, String> {
    let all_rows = read_image_rows(&file_bytes)?;
    Ok(build_text_analysis(all_rows, "png", target, adapter))
}

/// Shared analysis for text-derived formats (pdf / images via OCR): first row
/// is the header, the rest are data rows, and mappings are proposed from the
/// headers.
fn build_text_analysis(
    all_rows: Vec<Vec<String>>,
    file_type: &str,
    target: &str,
    adapter: Option<&str>,
) -> FileAnalysis {
    let headers = all_rows[0].clone();
    let data_rows = all_rows[1..].to_vec();
    let total_rows = data_rows.len();
    let sample_rows: Vec<Vec<String>> = data_rows.iter().take(5).cloned().collect();
    let proposed_mappings = propose_mappings(target, adapter, &headers);

    FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: file_type.to_string(),
        generic_mappings: proposed_mappings.clone(),
        proposed_mappings,
        auto_template_id: None,
        auto_template_name: None,
    }
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
    Err(
        "Import not confirmed. Preview the file first, then call confirm_import to commit."
            .to_string(),
    )
}

/// Shared validation + row reading used by both the preview (`execute_import`)
/// and the confirmed commit (`confirm_import`).
async fn prepare_import(
    _pool: &SqlitePool,
    _company_id: &str,
    request: &ImportRequest,
) -> Result<(Vec<Vec<String>>, usize), String> {
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
            "pdf" => read_pdf_rows(&request.file_bytes)?,
            "png" | "jpg" | "jpeg" => read_image_rows(&request.file_bytes)?,
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
) -> Result<ImportResult, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if !request.import_data {
        return Err(
            "confirm_import requires import_data = true (nothing to commit otherwise)."
                .to_string(),
        );
    }
    if request.dry_run {
        return Err(
            "confirm_import cannot run a preview. Use execute_import with dry_run = true to preview, then confirm here."
                .to_string(),
        );
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

        // Live progress: flush the counters every 10 rows so the frontend
        // sees a moving bar instead of a spinner. The final state is written
        // once by finish_import_job below.
        if attempted % 10 == 0 {
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

/// 0–100 progress for a running job (`attempted` out of `total` rows).
fn progress_percent(total_rows: i64, attempted_rows: i64) -> i64 {
    if total_rows <= 0 {
        return 0;
    }
    ((attempted_rows * 100) / total_rows).clamp(0, 100)
}

/// Pushes a live progress event to the frontend (spec §23.8). No-op when the
/// app handle is unavailable (unit tests).
fn emit_import_progress(
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
fn emit_import_complete(
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

/// Creates/updates product custom-field settings (products target only).
async fn create_product_custom_fields(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
) -> usize {
    if request.target != "products" {
        return 0;
    }

    let custom_mappings: Vec<&FieldMapping> = request
        .mappings
        .iter()
        .filter(|m| m.field_category == "custom")
        .collect();

    let mut fields_created = 0;
    for mapping in &custom_mappings {
        // Extract the field name from "custom:<name>"
        let field_name = mapping
            .target_field
            .strip_prefix("custom:")
            .unwrap_or(&mapping.target_field);

        let field_label = mapping.source_column.clone();

        // Detect field type from sample data
        let field_type = detect_field_type(request, mapping);

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
        .execute(pool)
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

    fields_created
}

/// Saves the mapping as a reusable template (if a name was provided).
///
/// A template is scoped to (company, target, name): re-saving with the same
/// name overwrites the stored mappings instead of inserting a duplicate row
/// (the legacy table has no UNIQUE constraint we can add via ALTER, so the
/// upsert lives here). Reusing a name also bumps `use_count` (spec §23.5).
async fn save_import_template(pool: &SqlitePool, company_id: &str, request: &ImportRequest) {
    if request.template_name.is_empty() {
        return;
    }

    let mappings_json =
        serde_json::to_string(&request.mappings).unwrap_or_else(|_| "{}".to_string());

    // The legacy file_type column only allows 'xlsx' / 'csv' via CHECK.
    let file_type = match request.file_type.as_str() {
        "xlsx" | "csv" => request.file_type.clone(),
        _ => "csv".to_string(),
    };

    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM import_templates
         WHERE company_id = ? AND target = ? AND template_name = ?",
    )
    .bind(company_id)
    .bind(&request.target)
    .bind(&request.template_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let result = match existing {
        Some(template_id) => {
            sqlx::query(
                r#"
                UPDATE import_templates
                SET column_mappings = ?, file_type = ?, has_header_row = ?,
                    use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(&mappings_json)
            .bind(&file_type)
            .bind(request.has_header_row as i32)
            .bind(&template_id)
            .execute(pool)
            .await
        }
        None => {
            let template_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO import_templates
                    (id, company_id, template_name, file_type, column_mappings,
                     has_header_row, target)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&template_id)
            .bind(company_id)
            .bind(&request.template_name)
            .bind(&file_type)
            .bind(&mappings_json)
            .bind(request.has_header_row as i32)
            .bind(&request.target)
            .execute(pool)
            .await
        }
    };

    if let Err(e) = result {
        eprintln!("Warning: failed to save import template: {e}");
    }
}

/// Returns the saved per-target templates for a company, newest first.
/// `target` may be given to filter (usually the wizard's current import
/// target). Used to power the template picker in the import wizard.
#[tauri::command]
pub async fn list_import_templates(
    pool: tauri::State<'_, SqlitePool>,
    session: tauri::State<'_, SessionState>,
    target: Option<String>,
) -> Result<Vec<ImportTemplate>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_deref()
        .ok_or("You are not assigned to a company")?;

    let templates = if let Some(target) = target {
        sqlx::query_as::<_, ImportTemplateRow>(
            "SELECT id, company_id, template_name, file_type, column_mappings,
                    has_header_row, target, use_count, last_used_at, created_at, updated_at
             FROM import_templates
             WHERE company_id = ? AND target = ?
             ORDER BY updated_at DESC",
        )
        .bind(company_id)
        .bind(target)
        .fetch_all(pool.inner())
        .await
    } else {
        sqlx::query_as::<_, ImportTemplateRow>(
            "SELECT id, company_id, template_name, file_type, column_mappings,
                    has_header_row, target, use_count, last_used_at, created_at, updated_at
             FROM import_templates
             WHERE company_id = ?
             ORDER BY updated_at DESC",
        )
        .bind(company_id)
        .fetch_all(pool.inner())
        .await
    }
    .map_err(|e| format!("Failed to list import templates: {e}"))?;

    Ok(templates
        .into_iter()
        .map(ImportTemplateRow::into_model)
        .collect::<Vec<ImportTemplate>>())
}

/// Deletes a saved import template. Returns the number of rows removed.
#[tauri::command]
pub async fn delete_import_template(
    pool: tauri::State<'_, SqlitePool>,
    session: tauri::State<'_, SessionState>,
    template_id: String,
) -> Result<u64, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_deref()
        .ok_or("You are not assigned to a company")?;

    let result = sqlx::query("DELETE FROM import_templates WHERE id = ? AND company_id = ?")
        .bind(&template_id)
        .bind(company_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to delete import template: {e}"))?;
    Ok(result.rows_affected())
}

/// Finds the best saved per-target template for a file whose headers match
/// (spec §23.5 auto-map). A template matches when at least 2 of its mapped
/// source columns appear in the file's headers and the overlap covers 60% of
/// the template's columns. The strongest overlap wins; ties fall back to the
/// most recently used template.
async fn match_import_template(
    pool: &SqlitePool,
    company_id: &str,
    target: &str,
    headers: &[String],
) -> Result<Option<ImportTemplate>, String> {
    let rows = sqlx::query_as::<_, ImportTemplateRow>(
        "SELECT id, company_id, template_name, file_type, column_mappings,
                has_header_row, target, use_count, last_used_at, created_at, updated_at
         FROM import_templates
         WHERE company_id = ? AND target = ?",
    )
    .bind(company_id)
    .bind(target)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load import templates: {e}"))?;

    let norm = |h: &String| {
        h.trim()
            .to_lowercase()
            .replace([' ', '-', '_', '.'], "")
    };

    let file_headers: Vec<String> = headers.iter().map(norm).collect();
    let mut best: Option<(usize, f64, i64, String, ImportTemplate)> = None;

    for row in rows {
        let template = row.into_model();
        let mappings = template.column_mappings.clone();
        if mappings.is_empty() {
            continue;
        }
        let mapped: Vec<String> = mappings
            .iter()
            .map(|m| norm(&m.source_column))
            .collect();
        let hits = mapped
            .iter()
            .filter(|m| file_headers.iter().any(|h| h == *m))
            .count();
        if hits >= 2 {
            let ratio = hits as f64 / mapped.len() as f64;
            if ratio >= 0.6 {
                let freshness = template.last_used_at.clone().unwrap_or_default();
                let candidate = (hits, ratio, template.use_count, freshness, template);
                if best.as_ref().is_none_or(|(bh, br, bu, bf, _)| {
                    candidate.0 > *bh
                        || (candidate.0 == *bh && candidate.1 > *br)
                        || (candidate.0 == *bh
                            && (candidate.1 - *br).abs() < f64::EPSILON
                            && candidate.2 > *bu)
                        || (candidate.0 == *bh
                            && (candidate.1 - *br).abs() < f64::EPSILON
                            && candidate.2 == *bu
                            && candidate.3 > *bf)
                }) {
                    best = Some(candidate);
                }
            }
        }
    }

    Ok(best.map(|(_, _, _, _, t)| t))
}

/// Records a template reuse: bumps `use_count` and stamps `last_used_at`.
async fn bump_template_usage(pool: &SqlitePool, template_id: &str) {
    let _ = sqlx::query(
        "UPDATE import_templates
         SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
    )
    .bind(template_id)
    .execute(pool)
    .await;
}

/// Row mapper for `import_templates`. `column_mappings` is a JSON string that
/// `from_row` decodes into `Vec<FieldMapping>`.
struct ImportTemplateRow {
    id: String,
    company_id: String,
    template_name: String,
    file_type: String,
    column_mappings: String,
    has_header_row: bool,
    target: String,
    use_count: i64,
    last_used_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl ImportTemplateRow {
    fn into_model(self) -> ImportTemplate {
        let column_mappings = serde_json::from_str(&self.column_mappings)
            .unwrap_or_default();
        ImportTemplate {
            id: self.id,
            company_id: self.company_id,
            template_name: self.template_name,
            file_type: self.file_type,
            column_mappings,
            has_header_row: self.has_header_row,
            target: self.target,
            use_count: self.use_count,
            last_used_at: self.last_used_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> for ImportTemplateRow {
    fn from_row(row: &'r sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(ImportTemplateRow {
            id: row.try_get("id")?,
            company_id: row.try_get("company_id")?,
            template_name: row.try_get("template_name")?,
            file_type: row.try_get("file_type")?,
            column_mappings: row.try_get("column_mappings")?,
            has_header_row: row.try_get::<i64, _>("has_header_row")? != 0,
            target: row.try_get("target")?,
            use_count: row.try_get("use_count")?,
            last_used_at: row.try_get("last_used_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

// ==========================================
// IMPORT JOBS (spec §23.3 / §23.12)
// ==========================================

/// Creates an `import_jobs` row so the run can be rolled back later.
/// The row starts as `pending`; the background worker flips it to
/// `processing` when it starts and to `completed`/`failed` when it finishes.
async fn check_import_quotas(pool: &SqlitePool, company_id: &str) -> Result<(), String> {
    // Concurrent jobs: a company may only have ONE pending/processing import
    // at a time (spec §23.10).
    let running: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM import_jobs
         WHERE company_id = ? AND status IN ('pending', 'processing')",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Quota check error: {e}"))?;
    if running >= MAX_CONCURRENT_JOBS_PER_COMPANY {
        return Err(
            "Another import is still running for this company. Wait for it to finish \
             before starting a new one (concurrency limit: 1)."
                .to_string(),
        );
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
    .map_err(|e| format!("Quota check error: {e}"))?;
    if recent >= MAX_JOBS_PER_HOUR_PER_COMPANY {
        return Err(format!(
            "Hourly import quota reached ({MAX_JOBS_PER_HOUR_PER_COMPANY} jobs per hour). \
             Wait an hour or roll back an earlier import before continuing."
        ));
    }

    Ok(())
}

/// Creates an `import_jobs` row so the run can be rolled back later.
/// The row starts as `pending`; the background worker flips it to
/// `processing` when it starts and to `completed`/`failed` when it finishes.
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
    .map_err(|e| format!("Failed to create import job: {e}"))?;

    Ok(id)
}

/// Flushes live progress counters during a background import run.
async fn update_import_progress(
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
async fn finish_import_job(
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
) -> Result<Vec<ImportJob>, String> {
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
    .map_err(|e| format!("Database error: {e}"))?;

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
) -> Result<ImportJobStatus, String> {
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
    .map_err(|e| format!("Database error: {e}"))?
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

    // Invoices / purchase bills must be removed before their line items so
    // the trigger that blocks items on finalized/paid invoices cannot fire.
    let invoices_deleted =
        sqlx::query("DELETE FROM invoices WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete invoices: {e}"))?
            .rows_affected() as i64;

    let purchase_bills_deleted =
        sqlx::query("DELETE FROM purchase_orders WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete purchase bills: {e}"))?
            .rows_affected() as i64;

    let _invoice_items_deleted =
        sqlx::query("DELETE FROM invoice_items WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete invoice items: {e}"))?
            .rows_affected() as i64;

    let _po_items_deleted =
        sqlx::query("DELETE FROM purchase_order_items WHERE import_batch_id = ? AND company_id = ?")
            .bind(&job_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to delete purchase bill items: {e}"))?
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
        invoices_deleted,
        purchase_bills_deleted,
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

/// Reads all rows from a PDF file (including header row).
///
/// Only text-layer PDFs are supported here: the text is extracted with
/// `pdf-extract` and split into tabular rows by whitespace. Scanned PDFs that
/// carry no embedded text are rejected — they would need OCR (see
/// `read_image_rows` / `ocr_image_to_text`).
fn read_pdf_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let text = pdf_extract::extract_text_from_mem(file_bytes)
        .map_err(|e| format!("Failed to read PDF text: {e}"))?;

    let rows = parse_text_rows(&text);
    if rows.is_empty() {
        return Err(
            "No text found in this PDF. It may be a scanned document. \
             Use a PDF with a text layer (most accounting software exports have one), \
             or export to CSV/XLSX instead."
                .to_string(),
        );
    }
    Ok(rows)
}

/// Reads all rows from an image file (including header row) by running OCR.
///
/// Images always need OCR (spec §23.2). We shell out to the Tesseract OCR
/// command-line tool, so Tesseract must be installed and on PATH. The image is
/// decoded first so corrupt/non-image files fail with a clear message instead
/// of a confusing tesseract error.
fn read_image_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let text = ocr_image_to_text(file_bytes)?;

    let rows = parse_text_rows(&text);
    if rows.is_empty() {
        return Err(
            "OCR produced no readable text. Make sure the image is clear, in focus, \
             and shows the table legibly."
                .to_string(),
        );
    }
    Ok(rows)
}

/// Splits OCR/extracted text into rows, then cells. Empty lines are dropped
/// (headers of exported PDFs are usually separated by blank lines).
fn parse_text_rows(text: &str) -> Vec<Vec<String>> {
    text.lines()
        .map(|line| line.trim_end().to_string())
        .filter(|line| !line.trim().is_empty())
        .map(|line| split_text_line(&line))
        .filter(|cells| !cells.is_empty())
        .collect()
}

/// Splits one text line into cells. Tabs and runs of 2+ spaces separate
/// columns; single spaces are preserved so names like "Ijaz & Company" stay
/// in one cell.
fn split_text_line(line: &str) -> Vec<String> {
    let mut cells: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '\t' => {
                push_text_cell(&mut cells, &mut current);
                i += 1;
            }
            ' ' => {
                let mut j = i;
                while j < chars.len() && chars[j] == ' ' {
                    j += 1;
                }
                if j - i >= 2 {
                    push_text_cell(&mut cells, &mut current);
                } else {
                    current.push(' ');
                }
                i = j;
            }
            c => {
                current.push(c);
                i += 1;
            }
        }
    }
    push_text_cell(&mut cells, &mut current);
    cells
}

fn push_text_cell(cells: &mut Vec<String>, current: &mut String) {
    let cell = current.trim().to_string();
    if !cell.is_empty() {
        cells.push(cell);
    }
    current.clear();
}

/// Runs OCR over an image and returns the recognized text.
///
/// Prefers the Tesseract engine bundled with the app (spec §23.2 Phase 2,
/// resolved at setup into `OCR_BUNDLE`), falling back to a `tesseract` on
/// PATH. The image is decoded up front (so invalid files fail fast), written
/// to a temp file, and `--psm 6` is used because ERP/accounting documents are
/// uniform blocks.
fn ocr_image_to_text(file_bytes: &[u8]) -> Result<String, String> {
    let img = image::load_from_memory(file_bytes)
        .map_err(|e| format!("Not a valid image file: {e}"))?;

    let path = std::env::temp_dir().join(format!("ijaz_ocr_{}.png", uuid::Uuid::new_v4()));
    img.save(&path)
        .map_err(|e| format!("Failed to write temp image: {e}"))?;

    let bundle = OCR_BUNDLE.get().cloned().flatten();
    let mut command = if let Some(bundle) = &bundle {
        let mut cmd = std::process::Command::new(&bundle.exe);
        if let Some(tessdata) = &bundle.tessdata {
            cmd.env("TESSDATA_PREFIX", tessdata);
        }
        cmd
    } else {
        std::process::Command::new("tesseract")
    };

    let output = command
        .arg(&path)
        .arg("stdout")
        .arg("--psm")
        .arg("6")
        .output();

    let _ = std::fs::remove_file(&path);

    match output {
        Ok(output) if output.status.success() => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
        Ok(output) => Err(format!(
            "Tesseract OCR failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(e) => {
            let hint = if bundle.is_some() {
                "The bundled Tesseract engine could not run. \
                 Reinstall the app, or import a CSV/XLSX/text-PDF instead."
            } else {
                "Tesseract OCR is not bundled with this build. \
                 Install Tesseract OCR (https://github.com/tesseract-ocr/tesseract) and add it \
                 to your PATH, or import a CSV/XLSX/text-PDF instead."
            };
            Err(format!("Tesseract OCR is not available: {e}. {hint}"))
        }
    }
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
///
/// When an ERP adapter (§23.11) is supplied, its known column names are
/// tried first for every header and the fuzzy vocabulary is only used as a
/// fallback, so a named adapter pre-fills the mapping with near-zero manual
/// work.
fn propose_mappings(target: &str, adapter: Option<&str>, headers: &[String]) -> Vec<FieldMapping> {
    let adapter_hints: Vec<(&str, &[&str])> = adapter
        .filter(|a| is_valid_adapter(a))
        .map(|a| erp_adapter_fields(a, target))
        .unwrap_or_default();

    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let normalized = normalize_header(header);

            // 1. ERP adapter column name (pre-filled, high confidence).
            let adapter_hit = adapter_hints
                .iter()
                .find(|(_, aliases)| matches_any(&normalized, aliases))
                .map(|(field, _)| (field.to_string(), "core".to_string(), "high".to_string()));

            // 2. Fuzzy vocabulary per target.
            let (target_field, category, confidence) = match adapter_hit {
                Some(hit) => hit,
                None => match target {
                    "customers" => detect_customer_field(&normalized),
                    "suppliers" => detect_supplier_field(&normalized),
                    "opening_stock" => detect_opening_stock_field(&normalized),
                    "invoices" => detect_invoice_field(&normalized),
                    "purchase_bills" => detect_purchase_bill_field(&normalized),
                    _ => detect_field(&normalized),
                },
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

/// Header detector for the sales-invoice import target (spec §23.2).
/// Order matters: more specific patterns are checked first so e.g.
/// "reference note" is never captured by the generic "ref" alias.
fn detect_invoice_field(normalized: &str) -> (String, String, String) {
    // DISCOUNT (before total_amount — "discount amount" contains "amount")
    if matches_any(
        normalized,
        &["discount rate", "discount percent", "disc %", "discount"],
    ) {
        return (
            "discount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // AMOUNT PAID (before total_amount — "amount paid" contains "amount")
    if matches_any(
        normalized,
        &[
            "amount paid",
            "paid amount",
            "amount received",
            "received amount",
            "payment received",
        ],
    ) {
        return (
            "amount_paid".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX RATE (before total_amount — "tax amount" contains "amount")
    if matches_any(
        normalized,
        &["tax rate", "tax percent", "tax %", "sales tax", "gst", "vat", "tax"],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TOTAL AMOUNT
    if matches_any(
        normalized,
        &[
            "total amount",
            "grand total",
            "bill amount",
            "invoice total",
            "net amount",
            "net total",
            "total",
            "amount",
            "amt",
        ],
    ) {
        return (
            "total_amount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT PRICE (before quantity — "unit qty" contains "qty", not "price")
    if matches_any(
        normalized,
        &["unit price", "unit rate", "selling price", "sale price", "price", "rate"],
    ) {
        return (
            "unit_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &["no of units", "number of units", "quantity", "qty", "units", "unit count", "pieces"],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PRODUCT LINE (SKU)
    if matches_any(
        normalized,
        &[
            "product sku",
            "item sku",
            "product code",
            "item code",
            "barcode",
            "product",
            "item",
            "description",
        ],
    ) {
        return (
            "product_sku".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // CUSTOMER
    if matches_any(
        normalized,
        &[
            "customer name",
            "client name",
            "sold to",
            "billed to",
            "customer",
            "client",
            "buyer",
            "purchaser",
            "party",
            "name",
        ],
    ) {
        return (
            "customer_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // STATUS
    if matches_any(normalized, &["invoice status", "payment status", "status"]) {
        return (
            "status".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // DUE DATE
    if matches_any(normalized, &["due date", "payment due date", "payment terms date"]) {
        return (
            "due_date".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // CUSTOMER PO NUMBER
    if matches_any(
        normalized,
        &["po number", "po no", "customer po", "purchase order no", "order number"],
    ) {
        return (
            "po_number".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // REFERENCE NOTE (before the generic "ref"/"reference" below)
    if matches_any(normalized, &["reference note", "reference notes", "notes", "remarks", "remark", "note", "comment"]) {
        return (
            "reference_note".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // INVOICE DATE
    if matches_any(
        normalized,
        &["invoice date", "inv date", "billing date", "transaction date", "date"],
    ) {
        return (
            "invoice_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // INVOICE NUMBER
    if matches_any(
        normalized,
        &[
            "invoice number",
            "invoice no",
            "invoice num",
            "inv number",
            "inv no",
            "invoice #",
            "inv #",
            "reference number",
            "reference",
            "ref number",
            "ref no",
            "ref",
        ],
    ) {
        return (
            "invoice_number".to_string(),
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

/// Header detector for the purchase-bill import target (spec §23.2).
fn detect_purchase_bill_field(normalized: &str) -> (String, String, String) {
    // EXPECTED DATE (before expiry — "expected" contains "exp")
    if matches_any(
        normalized,
        &["expected date", "expected arrival", "delivery date", "arrival date"],
    ) {
        return (
            "expected_date".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EXPIRY DATE
    if matches_any(
        normalized,
        &["expiry date", "expiration date", "exp date", "expiry", "expiration", "best before", "use by", "sell by"],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // AMOUNT PAID
    if matches_any(
        normalized,
        &["amount paid", "paid amount", "amount paid to supplier", "payment made"],
    ) {
        return (
            "amount_paid".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX RATE
    if matches_any(
        normalized,
        &["tax rate", "tax percent", "tax %", "sales tax", "gst", "vat", "tax"],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TOTAL AMOUNT
    if matches_any(
        normalized,
        &["total amount", "grand total", "bill amount", "invoice total", "net total", "total", "amount", "amt"],
    ) {
        return (
            "total_amount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT COST
    if matches_any(
        normalized,
        &["unit cost", "unit price", "purchase price", "cost price", "cost", "rate"],
    ) {
        return (
            "unit_cost".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &["quantity", "qty", "units", "no of units", "number of units", "pieces"],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PRODUCT LINE (SKU)
    if matches_any(
        normalized,
        &["product sku", "item sku", "product code", "item code", "barcode", "product", "item", "description"],
    ) {
        return (
            "product_sku".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // SUPPLIER
    if matches_any(
        normalized,
        &[
            "supplier name",
            "vendor name",
            "supplier",
            "vendor",
            "party",
            "seller",
            "account name",
            "name",
        ],
    ) {
        return (
            "supplier_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // STATUS
    if matches_any(normalized, &["po status", "payment status", "status"]) {
        return (
            "status".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // REFERENCE NOTE
    if matches_any(normalized, &["reference note", "reference notes", "notes", "remarks", "remark", "note", "comment"]) {
        return (
            "reference_note".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // PO DATE
    if matches_any(
        normalized,
        &["po date", "bill date", "purchase date", "transaction date", "date"],
    ) {
        return (
            "po_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PO NUMBER
    if matches_any(
        normalized,
        &["po number", "po no", "bill number", "bill no", "purchase order no", "voucher number", "voucher no", "reference number", "reference", "ref"],
    ) {
        return (
            "po_number".to_string(),
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
        resolve_or_create_supplier(pool, company_id, &parsed.supplier_name, job_id).await?
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
    job_id: &str,
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
    sqlx::query("INSERT INTO suppliers (id, company_id, name, import_batch_id) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(company_id)
        .bind(trimmed)
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create supplier '{trimmed}': {e}"))?;

    Ok(Some(id))
}

// ==========================================
// SALES-INVOICE & PURCHASE-BILL IMPORTS (§23.2)
// ==========================================
//
// Both targets import "historical records": a header plus a line-item
// snapshot written exactly as the file describes. No stock, batch or ledger
// mutation happens — the opening-stock target owns the stock position and
// imported history is always safe to delete via rollback. Products and
// parties are resolved by name/SKU; a party that does not exist yet is
// created so the record has a valid foreign key.

/// Rounds paisa to the nearest rupee, matching the invoice module's
/// convention (50+ paisa rounds up).
fn round_to_rupee_paisa(paisa: i64) -> i64 {
    let rem = paisa.rem_euclid(100);
    if rem >= 50 {
        paisa - rem + 100
    } else {
        paisa - rem
    }
}

/// Parses a date to YYYY-MM-DD, erroring when it is missing or unparseable.
fn parse_import_date(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is missing. Map a date column in your file."));
    }
    crate::commands::inventory::parse_expiry_date(trimmed).map_err(|_| {
        format!(
            "{label} '{trimmed}' is not a valid date. Use YYYY-MM-DD, YYYY/MM/DD or DD/MM/YYYY."
        )
    })
}

/// Parsed + validated sales-invoice row. One row = one invoice.
struct ParsedInvoice {
    invoice_number: String,
    invoice_date: String,
    due_date: Option<String>,
    customer_name: String,
    product_sku: String,
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount: i64,
    total_amount: Option<i64>,
    amount_paid: i64,
    status: String,
    reference_note: String,
    po_number: String,
}

fn parse_invoice_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedInvoice, String> {
    let mut invoice_number = String::new();
    let mut invoice_date = String::new();
    let mut due_date = String::new();
    let mut customer_name = String::new();
    let mut product_sku = String::new();
    let mut quantity: i64 = 1;
    let mut unit_price: i64 = 0;
    let mut tax_rate: i64 = 0;
    let mut discount: i64 = 0;
    let mut total_amount: Option<i64> = None;
    let mut amount_paid: i64 = 0;
    let mut status = String::new();
    let mut reference_note = String::new();
    let mut po_number = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        match mapping.target_field.as_str() {
            "invoice_number" => invoice_number = value,
            "invoice_date" => invoice_date = value,
            "due_date" => due_date = value,
            "customer_name" => customer_name = value,
            "product_sku" => product_sku = value,
            "quantity" => quantity = (value.parse::<f64>().unwrap_or(0.0).max(0.0)) as i64,
            "unit_price" => unit_price = parse_price(&value),
            "tax_rate" => tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "discount" => discount = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "total_amount" => total_amount = Some(parse_price(&value)),
            "amount_paid" => amount_paid = parse_price(&value),
            "status" => status = value,
            "reference_note" => reference_note = value,
            "po_number" => po_number = value,
            _ => {}
        }
    }

    if invoice_number.trim().is_empty() {
        return Err(format!(
            "Row has no invoice number. Map an 'Invoice Number' column — one row is one invoice. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }
    if customer_name.trim().is_empty() {
        return Err(format!(
            "Row has no customer. Map a 'Customer Name' column. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }
    let invoice_date = parse_import_date(&invoice_date, "Invoice date")?;
    let due_date = if due_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&due_date, "Due date")?)
    };
    if quantity == 0 {
        quantity = 1;
    }

    Ok(ParsedInvoice {
        invoice_number: invoice_number.trim().to_string(),
        invoice_date,
        due_date,
        customer_name,
        product_sku: product_sku.trim().to_string(),
        quantity,
        unit_price,
        tax_rate,
        discount,
        total_amount,
        amount_paid,
        status: normalize_invoice_status(&status),
        reference_note,
        po_number,
    })
}

/// Normalizes a file's invoice status to one of the DB's allowed values.
fn normalize_invoice_status(raw: &str) -> String {
    let n = raw.trim().to_lowercase();
    if n.is_empty() || n == "finalized" || n == "final" {
        return "finalized".to_string();
    }
    if n == "paid" || n.contains("paid") {
        return "paid".to_string();
    }
    if n == "cancelled" || n == "canceled" || n == "void" {
        return "cancelled".to_string();
    }
    if n == "draft" || n == "pending" || n == "open" || n == "unpaid" || n == "due" {
        return "draft".to_string();
    }
    "finalized".to_string()
}

/// Computes (status, amount_paid, balance_due) for an imported invoice.
fn invoice_amounts(raw_status: &str, amount_paid: i64, grand_total: i64) -> (String, i64, i64) {
    let status = normalize_invoice_status(raw_status);
    match status.as_str() {
        "draft" | "cancelled" => (status, 0, grand_total),
        "paid" => (status, grand_total, 0),
        _ => {
            let paid = amount_paid.clamp(0, grand_total);
            (status, paid, grand_total - paid)
        }
    }
}

/// Parsed + validated purchase-bill row. One row = one purchase order.
struct ParsedPurchaseBill {
    po_number: String,
    po_date: String,
    expected_date: Option<String>,
    expiry_date: Option<String>,
    supplier_name: String,
    product_sku: String,
    quantity: i64,
    unit_cost: i64,
    tax_rate: i64,
    total_amount: Option<i64>,
    amount_paid: i64,
    status: String,
    reference_note: String,
}

fn parse_purchase_bill_row(
    mappings: &[FieldMapping],
    row: &[String],
) -> Result<ParsedPurchaseBill, String> {
    let mut po_number = String::new();
    let mut po_date = String::new();
    let mut expected_date = String::new();
    let mut expiry_date = String::new();
    let mut supplier_name = String::new();
    let mut product_sku = String::new();
    let mut quantity: i64 = 1;
    let mut unit_cost: i64 = 0;
    let mut tax_rate: i64 = 0;
    let mut total_amount: Option<i64> = None;
    let mut amount_paid: i64 = 0;
    let mut status = String::new();
    let mut reference_note = String::new();

    for mapping in mappings {
        let Some(value) = mapping_value(mapping, row) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        match mapping.target_field.as_str() {
            "po_number" => po_number = value,
            "po_date" => po_date = value,
            "expected_date" => expected_date = value,
            "expiry_date" => expiry_date = value,
            "supplier_name" => supplier_name = value,
            "product_sku" => product_sku = value,
            "quantity" => quantity = (value.parse::<f64>().unwrap_or(0.0).max(0.0)) as i64,
            "unit_cost" => unit_cost = parse_price(&value),
            "tax_rate" => tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64,
            "total_amount" => total_amount = Some(parse_price(&value)),
            "amount_paid" => amount_paid = parse_price(&value),
            "status" => status = value,
            "reference_note" => reference_note = value,
            _ => {}
        }
    }

    if po_number.trim().is_empty() {
        return Err(format!(
            "Row has no purchase order number. Map a 'PO Number' column — one row is one purchase bill. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }
    if supplier_name.trim().is_empty() {
        return Err(format!(
            "Row has no supplier. Map a 'Supplier Name' column. Columns: [{}]",
            mapped_fields_note(mappings, row)
        ));
    }
    let po_date = parse_import_date(&po_date, "PO date")?;
    let expected_date = if expected_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&expected_date, "Expected date")?)
    };
    let expiry_date = if expiry_date.trim().is_empty() {
        None
    } else {
        Some(parse_import_date(&expiry_date, "Expiry date")?)
    };
    if quantity == 0 {
        quantity = 1;
    }

    Ok(ParsedPurchaseBill {
        po_number: po_number.trim().to_string(),
        po_date,
        expected_date,
        expiry_date,
        supplier_name,
        product_sku: product_sku.trim().to_string(),
        quantity,
        unit_cost,
        tax_rate,
        total_amount,
        amount_paid,
        status: normalize_po_status(&status),
        reference_note,
    })
}

/// Normalizes a file's purchase-order status to one of the DB's allowed values.
fn normalize_po_status(raw: &str) -> String {
    let n = raw.trim().to_lowercase();
    if n.is_empty() || n == "received" || n == "complete" || n == "completed" || n == "delivered" {
        return "received".to_string();
    }
    if n == "paid" || n.contains("paid") {
        return "paid".to_string();
    }
    if n == "cancelled" || n == "canceled" || n == "void" {
        return "cancelled".to_string();
    }
    if n == "ordered" || n == "pending" || n == "open" || n == "processing" || n == "draft" {
        return "ordered".to_string();
    }
    "received".to_string()
}

/// Computes (status, amount_paid, balance_due) for an imported purchase order.
fn po_amounts(raw_status: &str, amount_paid: i64, grand_total: i64) -> (String, i64, i64) {
    let status = normalize_po_status(raw_status);
    match status.as_str() {
        "draft" | "cancelled" => (status, 0, grand_total),
        "paid" => (status, grand_total, 0),
        _ => {
            let paid = amount_paid.clamp(0, grand_total);
            (status, paid, grand_total - paid)
        }
    }
}

async fn invoice_number_exists(
    pool: &SqlitePool,
    company_id: &str,
    number: &str,
) -> Result<bool, String> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM invoices WHERE company_id = ? AND invoice_number = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(number)
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .map_err(|e| format!("Invoice lookup error: {e}"))
}

async fn po_number_exists(
    pool: &SqlitePool,
    company_id: &str,
    number: &str,
) -> Result<bool, String> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM purchase_orders WHERE company_id = ? AND po_number = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(number)
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .map_err(|e| format!("PO lookup error: {e}"))
}

/// Generates the next free invoice number from the company's invoice counter,
/// skipping numbers that already exist (e.g. imported with explicit numbers).
async fn next_free_invoice_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
    let (prefix, mut next): (String, i64) = sqlx::query_as(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Invoice settings error: {e}"))?;

    loop {
        let candidate = format!("{prefix}-{:03}", next);
        if !invoice_number_exists(pool, company_id, &candidate).await? {
            sqlx::query(
                "UPDATE company_invoice_settings SET next_number = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
            )
            .bind(next + 1)
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to advance invoice counter: {e}"))?;
            return Ok(candidate);
        }
        next += 1;
    }
}

/// Generates the next free PO number from the company's PO counter.
async fn next_free_po_number(pool: &SqlitePool, company_id: &str) -> Result<String, String> {
    let (prefix, mut next): (String, i64) = sqlx::query_as(
        "SELECT po_prefix, next_number FROM company_po_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("PO settings error: {e}"))?;

    loop {
        let candidate = format!("{prefix}-{:03}", next);
        if !po_number_exists(pool, company_id, &candidate).await? {
            sqlx::query(
                "UPDATE company_po_settings SET next_number = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
            )
            .bind(next + 1)
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to advance PO counter: {e}"))?;
            return Ok(candidate);
        }
        next += 1;
    }
}

/// Finds an existing customer by name, or creates one tagged with the job so
/// rollback can remove it again.
async fn resolve_or_create_customer(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
    job_id: &str,
) -> Result<String, String> {
    let trimmed = name.trim().to_string();
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE AND is_active = 1 LIMIT 1",
    )
    .bind(company_id)
    .bind(&trimmed)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Customer lookup error: {e}"))?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO customers (id, company_id, name, import_batch_id) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create customer '{trimmed}': {e}"))?;

    Ok(id)
}

/// Imports one sales-invoice row. Returns Ok(true) when a record was created,
/// Ok(false) when the conflict strategy skipped it.
///
/// The header is inserted as `draft` first because the database refuses to
/// add line items to a finalized/paid invoice; once the item is attached the
/// status flips to the file's value.
#[allow(clippy::too_many_arguments)]
async fn import_one_invoice_row(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, String> {
    let parsed = parse_invoice_row(mappings, row)?;
    let number = if parsed.invoice_number.is_empty() {
        next_free_invoice_number(pool, company_id).await?
    } else {
        parsed.invoice_number.clone()
    };

    let exists = invoice_number_exists(pool, company_id, &number).await?;
    if exists && strategy == ConflictStrategy::Skip {
        return Ok(false);
    }

    // Optional line item: summary rows carry no SKU.
    let mut product_id: Option<String> = None;
    let mut product_name = String::new();
    let mut product_sku_display = String::new();
    if !parsed.product_sku.is_empty() {
        let product = sqlx::query_as::<_, (String, String)>(
            "SELECT id, name FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1",
        )
        .bind(company_id)
        .bind(&parsed.product_sku)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Product lookup error: {e}"))?;
        match product {
            Some((id, name)) => {
                product_id = Some(id);
                product_name = name;
                product_sku_display = parsed.product_sku.clone();
            }
            None => {
                return Err(format!(
                    "No product with SKU '{}' was found. Import your products first.",
                    parsed.product_sku
                ));
            }
        }
    }

    // Line computation (paisa; rupee-rounded, matching the app's invoices).
    let qty = if product_id.is_some() {
        parsed.quantity.max(1)
    } else {
        0
    };
    let subtotal = qty.saturating_mul(parsed.unit_price);
    let discount_amount = subtotal.saturating_mul(parsed.discount) / 10_000;
    let after_discount = subtotal.saturating_sub(discount_amount);
    let tax_amount = after_discount.saturating_mul(parsed.tax_rate) / 10_000;
    let line_total = round_to_rupee_paisa(after_discount.saturating_add(tax_amount));

    let (subtotal_total, tax_total, discount_total, grand_total) = if product_id.is_some() {
        (subtotal, tax_amount, discount_amount, line_total)
    } else {
        let total = parsed.total_amount.unwrap_or(0);
        (total, 0, 0, total)
    };

    let (status, amount_paid, balance_due) =
        invoice_amounts(&parsed.status, parsed.amount_paid, grand_total);

    let customer_id = resolve_or_create_customer(pool, company_id, &parsed.customer_name, job_id)
        .await?;

    let invoice_id = uuid::Uuid::new_v4().to_string();
    let due_date = parsed.due_date.as_deref().unwrap_or("");
    sqlx::query(
        "INSERT INTO invoices (id, company_id, invoice_number, invoice_date, due_date, customer_id,
         status, subtotal, tax_total, discount_total, grand_total, po_number, reference_note,
         amount_paid, balance_due, created_by, import_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .bind(&number)
    .bind(&parsed.invoice_date)
    .bind(due_date)
    .bind(&customer_id)
    .bind(subtotal_total)
    .bind(tax_total)
    .bind(discount_total)
    .bind(grand_total)
    .bind(&parsed.po_number)
    .bind(&parsed.reference_note)
    .bind(grand_total)
    .bind(user_id)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create invoice '{number}': {e}"))?;

    if let Some(pid) = product_id {
        let item_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO invoice_items (id, invoice_id, company_id, product_id, product_name, product_sku,
             quantity, unit_price, tax_rate, tax_amount, discount_rate, discount_amount, discount_type,
             line_total, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'percent', ?, ?)",
        )
        .bind(&item_id)
        .bind(&invoice_id)
        .bind(company_id)
        .bind(&pid)
        .bind(&product_name)
        .bind(&product_sku_display)
        .bind(qty)
        .bind(parsed.unit_price)
        .bind(parsed.tax_rate)
        .bind(tax_amount)
        .bind(parsed.discount)
        .bind(discount_amount)
        .bind(line_total)
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to add item to invoice '{number}': {e}"))?;
    }

    // Flip the draft header to the file's real status + payment position.
    sqlx::query("UPDATE invoices SET status = ?, amount_paid = ?, balance_due = ? WHERE id = ? AND company_id = ?")
        .bind(&status)
        .bind(amount_paid)
        .bind(balance_due)
        .bind(&invoice_id)
        .bind(company_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to finalize imported invoice '{number}': {e}"))?;

    Ok(true)
}

/// Imports one purchase-bill row. Returns Ok(true) when a record was created,
/// Ok(false) when the conflict strategy skipped it.
#[allow(clippy::too_many_arguments)]
async fn import_one_purchase_bill_row(
    pool: &SqlitePool,
    company_id: &str,
    user_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, String> {
    let parsed = parse_purchase_bill_row(mappings, row)?;
    let number = if parsed.po_number.is_empty() {
        next_free_po_number(pool, company_id).await?
    } else {
        parsed.po_number.clone()
    };

    let exists = po_number_exists(pool, company_id, &number).await?;
    if exists && strategy == ConflictStrategy::Skip {
        return Ok(false);
    }

    let mut product_id: Option<String> = None;
    let mut product_name = String::new();
    let mut product_sku_display = String::new();
    if !parsed.product_sku.is_empty() {
        let product = sqlx::query_as::<_, (String, String)>(
            "SELECT id, name FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1",
        )
        .bind(company_id)
        .bind(&parsed.product_sku)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Product lookup error: {e}"))?;
        match product {
            Some((id, name)) => {
                product_id = Some(id);
                product_name = name;
                product_sku_display = parsed.product_sku.clone();
            }
            None => {
                return Err(format!(
                    "No product with SKU '{}' was found. Import your products first.",
                    parsed.product_sku
                ));
            }
        }
    }

    // Line computation (paisa, no discount on purchase lines).
    let qty = if product_id.is_some() {
        parsed.quantity.max(1)
    } else {
        0
    };
    let subtotal = qty.saturating_mul(parsed.unit_cost);
    let tax_amount = subtotal.saturating_mul(parsed.tax_rate) / 10_000;
    let line_total = subtotal.saturating_add(tax_amount);

    let (subtotal_total, tax_total, grand_total) = if product_id.is_some() {
        (subtotal, tax_amount, line_total)
    } else {
        let total = parsed.total_amount.unwrap_or(0);
        (total, 0, total)
    };

    let (status, amount_paid, balance_due) =
        po_amounts(&parsed.status, parsed.amount_paid, grand_total);

    let quantity_received = if status == "received" || status == "paid" {
        qty
    } else {
        0
    };

    let supplier_id = resolve_or_create_supplier(pool, company_id, &parsed.supplier_name, job_id)
        .await?
        .ok_or("Supplier is missing")?;

    let po_id = uuid::Uuid::new_v4().to_string();
    let expected_date = parsed.expected_date.as_deref().unwrap_or("");
    sqlx::query(
        "INSERT INTO purchase_orders (id, company_id, supplier_id, po_number, po_date, expected_date,
         status, subtotal, tax_total, grand_total, amount_paid, balance_due, reference_note,
         created_by, import_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&po_id)
    .bind(company_id)
    .bind(&supplier_id)
    .bind(&number)
    .bind(&parsed.po_date)
    .bind(expected_date)
    .bind(&status)
    .bind(subtotal_total)
    .bind(tax_total)
    .bind(grand_total)
    .bind(amount_paid)
    .bind(balance_due)
    .bind(&parsed.reference_note)
    .bind(user_id)
    .bind(job_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create purchase order '{number}': {e}"))?;

    if let Some(pid) = product_id {
        let item_id = uuid::Uuid::new_v4().to_string();
        let expiry_date = parsed.expiry_date.as_deref().unwrap_or("");
        sqlx::query(
            "INSERT INTO purchase_order_items (id, po_id, company_id, product_id, product_name, product_sku,
             quantity_ordered, quantity_received, unit_cost, tax_rate, tax_amount, line_total,
             expiry_date, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&item_id)
        .bind(&po_id)
        .bind(company_id)
        .bind(&pid)
        .bind(&product_name)
        .bind(&product_sku_display)
        .bind(qty)
        .bind(quantity_received)
        .bind(parsed.unit_cost)
        .bind(parsed.tax_rate)
        .bind(tax_amount)
        .bind(line_total)
        .bind(expiry_date)
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to add item to purchase order '{number}': {e}"))?;
    }

    Ok(true)
}

/// Dry-run invoice validation: parse + product-exists + duplicate number check.
async fn validate_invoice_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_invoice_row(&request.mappings, row)?;
    if !parsed.product_sku.is_empty() && !sku_exists(pool, company_id, &parsed.product_sku).await? {
        return Err(format!(
            "No product with SKU '{}' was found. Import your products first.",
            parsed.product_sku
        ));
    }
    // Empty invoice numbers get auto-generated, so they never collide.
    let exists = if parsed.invoice_number.is_empty() {
        false
    } else {
        invoice_number_exists(pool, company_id, &parsed.invoice_number).await?
    };
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run purchase-bill validation.
async fn validate_purchase_bill_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, String> {
    let parsed = parse_purchase_bill_row(&request.mappings, row)?;
    if !parsed.product_sku.is_empty() && !sku_exists(pool, company_id, &parsed.product_sku).await? {
        return Err(format!(
            "No product with SKU '{}' was found. Import your products first.",
            parsed.product_sku
        ));
    }
    let exists = if parsed.po_number.is_empty() {
        false
    } else {
        po_number_exists(pool, company_id, &parsed.po_number).await?
    };
    Ok(conflict_outcome(exists, request.conflict_strategy))
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

    /// Waits for a background import job to reach a terminal state, then
    /// returns the full `ImportResult` stored on the job. Mirrors what the
    /// frontend does by polling `get_import_job`.
    async fn finish_job(app: &tauri::App<MockRuntime>, job_id: &str) -> ImportResult {
        let pool = app.state::<SqlitePool>();
        for _ in 0..400 {
            let status: String = sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
                .bind(job_id)
                .fetch_one(&*pool)
                .await
                .expect("job status");
            if matches!(status.as_str(), "completed" | "failed" | "rolled_back") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let status = get_import_job(app.state(), app.state(), job_id.to_string())
            .await
            .expect("get job");
        status
            .result
            .expect("finished job should carry a result")
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
        let mapped = propose_mappings("products", None, &headers);
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
        let mapped = propose_mappings("products", None, &headers);
        assert_eq!(mapped[0].target_field, "custom:flavor");
        assert_eq!(mapped[0].field_category, "custom");
        assert_eq!(mapped[0].confidence, "unknown");
    }

    #[test]
    fn propose_mappings_preserves_source_column_and_index() {
        // Input: headers ["Name", "Price"].
        // Expected: source_column/source_index echo the file.
        let headers = vec!["Name".to_string(), "Price".to_string()];
        let mapped = propose_mappings("products", None, &headers);
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
        let mapped = propose_mappings("customers", None, &headers);
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
        let mapped = propose_mappings("customers", None, &headers);
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
        let mapped = propose_mappings("opening_stock", None, &headers);
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
        );        assert_eq!(cell_to_string(&Data::Int(42)), "42");
        assert_eq!(cell_to_string(&Data::Float(5.0)), "5");
        assert_eq!(cell_to_string(&Data::Float(5.5)), "5.5");
        assert_eq!(cell_to_string(&Data::Bool(true)), "true");
        assert_eq!(cell_to_string(&Data::Error(CellErrorType::NA)), "");
        assert_eq!(cell_to_string(&Data::Empty), "");
    }

    #[test]
    fn split_text_line_uses_tabs_and_double_spaces_as_column_separators() {
        // Input: a tab-separated line and a double-space-separated line.
        // Expected: single spaces inside a cell are preserved, column runs split.
        assert_eq!(
            split_text_line("SKU\tProduct Name\tQty"),
            vec!["SKU", "Product Name", "Qty"]
        );
        assert_eq!(
            split_text_line("A-1  Widget  10"),
            vec!["A-1", "Widget", "10"]
        );
        // Single spaces inside a name must NOT split the cell.
        assert_eq!(
            split_text_line("C-2  Ijaz & Company  5"),
            vec!["C-2", "Ijaz & Company", "5"]
        );
        assert_eq!(split_text_line("   "), Vec::<String>::new());
    }

    #[test]
    fn parse_text_rows_drops_blank_lines_and_pads_cells() {
        // Input: lines with an empty line in the middle and a short cell.
        // Expected: blank lines removed, every line still becomes a row.
        let text = "SKU  Product Name  Qty\nA-1  Widget  10\n\nB-2  Gadget  20\n";
        let rows = parse_text_rows(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], vec!["SKU", "Product Name", "Qty"]);
        assert_eq!(rows[2], vec!["B-2", "Gadget", "20"]);
    }

    #[test]
    fn read_pdf_rows_rejects_bytes_that_are_not_a_pdf() {
        // Input: garbage bytes for a "PDF".
        // Expected: Err with guidance, since the text layer cannot be parsed.
        let err = read_pdf_rows(b"definitely not a pdf").unwrap_err();
        assert!(err.contains("PDF"), "got: {err}");
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
            has_header_row: true,
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
            has_header_row: true,
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
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "File is empty");
    }

    #[tokio::test]
    async fn execute_import_refuses_to_commit_without_confirm_gate() {
        // Input: import_data = true, dry_run = false on execute_import.
        // Expected: Err telling the caller to preview + confirm_import, and no
        //           rows or import_jobs written (the §23.3 confirm gate).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n";

        let err = execute_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect_err("execute_import must not commit directly");

        assert!(
            err.contains("confirm_import"),
            "expected confirm-gate error, got: {err}"
        );

        let pool = app.state::<SqlitePool>();
        let products: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
            .fetch_one(&*pool)
            .await
            .expect("products");
        assert_eq!(products, 0, "no rows may be written before confirmation");
        let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*pool)
            .await
            .expect("jobs");
        assert_eq!(jobs, 0, "no import job may be created before confirmation");
    }

    #[tokio::test]
    async fn analyze_import_file_rejects_unsupported_type() {
        // Input: file_type "txt".
        // Expected: Err listing supported types.
        let app = owner_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            b"data".to_vec(),
            "txt".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unsupported file type"), "got: {err}");
        assert!(err.contains("xlsx"));
        assert!(err.contains("pdf"));
    }

    #[tokio::test]
    async fn analyze_auto_reuses_matching_target_template() {
        // Setup: save a "Medicines" template for the products target that maps
        // SKU + Product Name.
        // Expected: analyzing a file with those headers auto-detects the
        // template, applies its mappings, and bumps its use_count.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        save_import_template(
            &*pool,
            &company_id,
            &ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    FieldMapping {
                        source_column: "SKU".to_string(),
                        source_index: 0,
                        target_field: "sku".to_string(),
                        field_category: "core".to_string(),
                        confidence: "high".to_string(),
                        manual_value: None,
                    },
                    FieldMapping {
                        source_column: "Product Name".to_string(),
                        source_index: 1,
                        target_field: "name".to_string(),
                        field_category: "core".to_string(),
                        confidence: "high".to_string(),
                        manual_value: None,
                    },
                ],
                file_bytes: Vec::new(),
                file_type: "csv".to_string(),
                template_name: "Medicines".to_string(),
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::Skip,
                dry_run: true,
                file_name: None,
            },
        )
        .await;

        let csv = "SKU,Product Name\nA-1,Widget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            Some("products".to_string()),
            None,
        )
        .await
        .expect("analyze");

        assert_eq!(analysis.auto_template_name.as_deref(), Some("Medicines"));
        assert!(
            analysis.auto_template_id.is_some(),
            "template id should be attached"
        );
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");

        let template_id = analysis.auto_template_id.unwrap();
        let use_count: i64 = sqlx::query_scalar(
            "SELECT use_count FROM import_templates WHERE id = ?",
        )
        .bind(&template_id)
        .fetch_one(&*pool)
        .await
        .expect("use_count");
        assert_eq!(use_count, 1, "auto-reuse must bump use_count");
    }

    #[tokio::test]
    async fn analyze_does_not_auto_apply_template_from_other_target() {
        // Setup: save a template for the "customers" target only.
        // Expected: analyzing a products file does NOT match it.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        save_import_template(
            &*pool,
            &company_id,
            &ImportRequest {
                target: "customers".to_string(),
                mappings: vec![FieldMapping {
                    source_column: "Name".to_string(),
                    source_index: 0,
                    target_field: "name".to_string(),
                    field_category: "core".to_string(),
                    confidence: "high".to_string(),
                    manual_value: None,
                }],
                file_bytes: Vec::new(),
                file_type: "csv".to_string(),
                template_name: "CustomerList".to_string(),
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::Skip,
                dry_run: true,
                file_name: None,
            },
        )
        .await;

        let csv = "SKU,Product Name\nA-1,Widget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            Some("products".to_string()),
            None,
        )
        .await
        .expect("analyze");

        assert!(analysis.auto_template_id.is_none());
        assert!(analysis.auto_template_name.is_none());
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
            analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None, None)
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
        let err = analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None, None)
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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::Overwrite,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::Suffix,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
    }

    #[tokio::test]
    async fn execute_import_bad_expiry_reports_row_error() {
        // Input: an unparseable expiry date in one row.
        // Expected: that row fails; others still import.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Expiry Date\nA-1,Widget,not-a-date\nA-2,Gadget,\n";
        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
                has_header_row: true,
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
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.into_bytes(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
                has_header_row: true,
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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
        let product_result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("product import");
        let product_job_id = product_result.job_id.expect("product job id");
        let product_result = finish_job(&app, &product_job_id).await;
        assert_eq!(product_result.products_imported, 1);

        let stock_csv = concat!(
            "SKU,Opening Qty,Cost Price,Expiry Date\n",
            "A-1,10,850.00,2026-12-31\n",
        );
        let stock_result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("stock import");

        let stock_job_id = stock_result.job_id.expect("stock job id");
        let stock_result = finish_job(&app, &stock_job_id).await;

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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

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
                has_header_row: true,
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

        let result = confirm_import(
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
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: Some("products.csv".to_string()),
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job id");
        // Wait for the background import to finish before checking state.
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.products_imported, 1);

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

    // ---------------------------------------------------------------
    // import job metadata: target / failed status / no job on setup
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn import_job_records_target_and_is_listed() {
        // Input: import customers.
        // Expected: the created job lists target "customers" and the
        //           list_import_jobs command returns it with counts.
        let app = owner_app().await;
        let csv = "Customer Name,Email\nAcme Corp,a@b.com\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Email", 1, "customer_email", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: Some("customers.csv".to_string()),
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job created");
        // Wait for the background import to finish so the job is "completed".
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.customers_imported, 1);

        let jobs = list_import_jobs(app.state(), app.state()).await.expect("list");
        let job = jobs.into_iter().find(|j| j.id == job_id).expect("job found");
        assert_eq!(job.target, "customers");
        assert_eq!(job.file_name.as_deref(), Some("customers.csv"));
        assert_eq!(job.status, "completed");
        assert_eq!(job.imported_records, 1);
        assert_eq!(job.error_rows, 0);
        assert!(job.rollback_available, "fresh job should be rollback-able");
    }

    #[tokio::test]
    async fn import_job_marked_failed_when_all_rows_error() {
        // Input: every row is missing a required field (no name mapping).
        // Expected: job status "failed" (not completed).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    // Only SKU mapped; required "name" is missing so the row
                    // fails validation.
                    mapping("SKU", 0, "sku", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job created");
        // Wait for the background import to finish (job will be "failed").
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.products_imported, 0);
        assert!(result.rows_with_errors >= 1);

        let status: String = sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
            .bind(&job_id)
            .fetch_one(&*app.state::<SqlitePool>())
            .await
            .expect("status");
        assert_eq!(status, "failed");
    }

    #[tokio::test]
    async fn setup_only_import_creates_no_job() {
        // Input: import_data = false (field/template setup only).
        // Expected: result.job_id is None and no import_jobs row exists.
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
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");
        assert!(result.job_id.is_none());

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*app.state::<SqlitePool>())
            .await
            .expect("count");
        assert_eq!(count, 0);
    }
}
