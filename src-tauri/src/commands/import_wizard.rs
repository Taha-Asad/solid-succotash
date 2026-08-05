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
}

/// What the frontend sends back when user confirms the mapping
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
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
}

/// Result of the import operation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// How many custom field definitions were created
    pub fields_created: usize,
    /// How many products were imported
    pub products_imported: usize,
    /// How many rows had errors
    pub rows_with_errors: usize,
    /// Error details (row number + reason)
    pub errors: Vec<ImportError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportError {
    pub row_number: usize,
    pub reason: String,
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
) -> Result<FileAnalysis, String> {
    let _current_user = require_current_user(pool.inner(), session.inner()).await?;

    if file_bytes.is_empty() {
        return Err("File is empty".to_string());
    }

    match file_type.as_str() {
        "xlsx" | "xls" => analyze_excel(file_bytes).await,
        "csv" => analyze_csv(file_bytes).await,
        "docx" => analyze_docx(file_bytes).await,
        _ => Err(format!(
            "Unsupported file type: {file_type}. Supported: xlsx, xls, csv, docx"
        )),
    }
}

/// Reads an Excel file and returns analysis
async fn analyze_excel(file_bytes: Vec<u8>) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(&headers);

    Ok(FileAnalysis {
        headers,
        sample_rows,
        total_rows,
        file_type: "xlsx".to_string(),
        proposed_mappings,
    })
}

/// Reads a CSV file and returns analysis
async fn analyze_csv(file_bytes: Vec<u8>) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(&headers);

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
async fn analyze_docx(file_bytes: Vec<u8>) -> Result<FileAnalysis, String> {
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
    let proposed_mappings = propose_mappings(&headers);

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

    // ---- 1. Create custom field definitions ----
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
        let field_type = detect_field_type(&request, &mapping.source_index);

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

    // ---- 2. Save import template (if name provided) ----
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

    // ---- 3. Import data rows ----
    let mut products_imported = 0;
    let mut rows_with_errors = 0;
    let mut errors: Vec<ImportError> = Vec::new();

    if request.import_data {
        // Re-read the file to get data rows
        let all_rows = match request.file_type.as_str() {
            "xlsx" | "xls" => read_excel_rows(&request.file_bytes)?,
            "csv" => read_csv_rows(&request.file_bytes)?,
            "docx" => read_docx_rows(&request.file_bytes)?,
            _ => {
                return Err("Unsupported file type".to_string());
            }
        };

        // Skip header row
        for (row_index, row) in all_rows.iter().skip(1).enumerate() {
            let row_number = row_index + 2; // +2 because: skip header, 1-indexed

            // Skip completely empty rows
            if row.iter().all(|cell| cell.trim().is_empty()) {
                continue;
            }

            match import_one_row(pool.inner(), company_id, &request.mappings, row).await {
                Ok(_) => {
                    products_imported += 1;
                }
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
    }

    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "import",
        "products",
        None,
        &format!(
            "Imported {} products, {} custom fields ({} error(s))",
            products_imported, fields_created, rows_with_errors
        ),
    )
    .await;

    Ok(ImportResult {
        fields_created,
        products_imported,
        rows_with_errors,
        errors,
    })
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
fn propose_mappings(headers: &[String]) -> Vec<FieldMapping> {
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let normalized = normalize_header(header);
            let (target, category, confidence) = detect_field(&normalized);
            FieldMapping {
                source_column: header.clone(),
                source_index: index,
                target_field: target,
                field_category: category,
                confidence,
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

/// Check if a normalized header matches any of the patterns
fn matches_any(normalized: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|p| normalized == *p || normalized.contains(p))
}

/// Detect the data type of a custom field from sample data
fn detect_field_type(request: &ImportRequest, source_index: &usize) -> String {
    // Look at the first few rows to guess the type
    // This is called during import, so we re-read and check

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
        if *source_index >= row.len() {
            continue;
        }

        let value = &row[*source_index];
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

/// Imports one row of data into the products table
async fn import_one_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
) -> Result<(), String> {
    // Extract values from the row using the mapping.
    // EVERY field comes from the uploaded file — nothing is defaulted,
    // fabricated, or auto-generated.
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
        if mapping.source_index >= row.len() {
            continue;
        }

        let value = row[mapping.source_index].trim().to_string();
        if value.is_empty() {
            continue;
        }

        match mapping.target_field.as_str() {
            "name" => {
                name = value;
            }
            "sku" => {
                sku = value;
            }
            "cost_price" => {
                cost_price = parse_price(&value);
            }
            "sell_price" => {
                sell_price = parse_price(&value);
            }
            "quantity_in_stock" => {
                quantity = value.parse::<f64>().unwrap_or(0.0) as i64;
            }
            "unit" => {
                unit = value;
            }
            "expiry_date" => {
                expiry_raw = value;
            }
            "tax_rate" => {
                // Convert percentage to basis points: 17.00 → 1700
                tax_rate = (value.parse::<f64>().unwrap_or(0.0) * 100.0) as i64;
            }
            "category" => {
                category_name = value;
            }
            "supplier" => {
                supplier_name = value;
            }
            field if field.starts_with("custom:") => {
                let field_name = field.strip_prefix("custom:").unwrap_or(field);
                custom_fields.insert(field_name.to_string(), serde_json::Value::String(value));
            }
            "skip" => {
                // User chose to skip this column
            }
            _ => {} // unmapped, skip
        }
    }

    // ---- Required fields: name and SKU must come from the file ----
    // We never default or auto-generate them. If the file lacks a
    // column, every row fails here so the user maps the right column.
    if name.is_empty() {
        let mapped_fields: Vec<String> = mappings
            .iter()
            .filter(|m| m.target_field != "skip" && m.source_index < row.len())
            .map(|m| {
                format!(
                    "'{}' → {} = '{}'",
                    m.source_column, m.target_field, &row[m.source_index]
                )
            })
            .collect();
        return Err(format!(
            "Row has no product NAME. Map a 'Product Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields.join(", ")
        ));
    }

    if sku.is_empty() {
        let mapped_fields: Vec<String> = mappings
            .iter()
            .filter(|m| m.target_field != "skip" && m.source_index < row.len())
            .map(|m| {
                format!(
                    "'{}' → {} = '{}'",
                    m.source_column, m.target_field, &row[m.source_index]
                )
            })
            .collect();
        return Err(format!(
            "Row has no SKU. Map a 'SKU / Code' column in your file — SKUs are never auto-generated. Columns: [{}]",
            mapped_fields.join(", ")
        ));
    }

    // ---- Expiry date (only when the file provides one) ----
    // Empty cell → the row simply has no expiry (stock stays unbatched).
    // Non-empty but unreadable → loud error, nothing is guessed.
    let parsed_expiry: Option<String> = if expiry_raw.trim().is_empty() {
        None
    } else {
        match crate::commands::inventory::parse_expiry_date(&expiry_raw) {
            Ok(d) => Some(d),
            Err(e) => return Err(e),
        }
    };

    // ---- Resolve category_id ----
    let category_id = if !category_name.is_empty() {
        resolve_or_create_category(pool, company_id, &category_name).await?
    } else {
        None
    };

    // ---- Resolve supplier_id ----
    let supplier_id = if !supplier_name.is_empty() {
        resolve_or_create_supplier(pool, company_id, &supplier_name).await?
    } else {
        None
    };

    // ---- Build custom_fields JSON ----
    let custom_json = if custom_fields.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&custom_fields).unwrap_or_default())
    };

    // ---- Insert product ----
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO products
            (id, company_id, sku, name, category_id, supplier_id,
             cost_price, sell_price, tax_rate, quantity_in_stock,
             unit, custom_fields)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&sku)
    .bind(&name)
    .bind(&category_id)
    .bind(&supplier_id)
    .bind(cost_price)
    .bind(sell_price)
    .bind(tax_rate)
    .bind(quantity)
    .bind(&unit)
    .bind(&custom_json)
    .execute(pool)
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Duplicate SKU '{sku}'")
        } else {
            format!("DB error: {msg}")
        }
    })?;

    // Record initial stock movement if quantity > 0
    if quantity > 0 {
        let movement_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            r#"
            INSERT INTO stock_movements
                (id, company_id, product_id, movement_type, quantity,
                 reference_note)
            VALUES (?, ?, ?, 'adjustment', ?, 'Imported from file')
            "#,
        )
        .bind(&movement_id)
        .bind(company_id)
        .bind(&id)
        .bind(quantity)
        .execute(pool)
        .await;
    }

    // Create an expiry batch when the file provides an expiry date.
    // This is what makes the product "expiry-tracked" (FIFO on sale).
    if quantity > 0 {
        if let Some(expiry) = &parsed_expiry {
            let batch_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO stock_batches
                    (id, company_id, product_id, quantity, unit_cost, expiry_date, source)
                VALUES (?, ?, ?, ?, ?, ?, 'import')
                "#,
            )
            .bind(&batch_id)
            .bind(company_id)
            .bind(&id)
            .bind(quantity)
            .bind(cost_price)
            .bind(expiry)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to create expiry batch: {e}"))?;
        }
    }

    Ok(())
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
        }
    }

    /// Builds a minimal but valid .docx (ZIP + word/document.xml) in memory.
    fn make_docx(document_xml: &str) -> Vec<u8> {
        use std::io::Write;
        let cursor = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default())
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
        let mapped = propose_mappings(&headers);
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
        let mapped = propose_mappings(&headers);
        assert_eq!(mapped[0].target_field, "custom:flavor");
        assert_eq!(mapped[0].field_category, "custom");
        assert_eq!(mapped[0].confidence, "unknown");
    }

    #[test]
    fn propose_mappings_preserves_source_column_and_index() {
        // Input: headers ["Name", "Price"].
        // Expected: source_column/source_index echo the file.
        let headers = vec!["Name".to_string(), "Price".to_string()];
        let mapped = propose_mappings(&headers);
        assert_eq!(mapped[0].source_column, "Name");
        assert_eq!(mapped[0].source_index, 0);
        assert_eq!(mapped[1].source_column, "Price");
        assert_eq!(mapped[1].source_index, 1);
        assert_eq!(mapped[1].target_field, "sell_price");
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
        assert_eq!(cell_to_string(&Data::String("  Widget  ".to_string())), "Widget");
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
            mappings: Vec::new(),
            file_bytes: b"Name,Price\nAlpha,10.50\nBeta,20.25\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            import_data: false,
        };
        assert_eq!(detect_field_type(&req, &1), "number");
        assert_eq!(detect_field_type(&req, &0), "text");
    }

    #[tokio::test]
    async fn detect_field_type_returns_text_for_unknown_type() {
        // Input: CSV whose sampled column is neither numeric nor date-like.
        // Expected: "text".
        let req = ImportRequest {
            mappings: Vec::new(),
            file_bytes: b"Header\none\ntwo\nthree\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            import_data: false,
        };
        assert_eq!(detect_field_type(&req, &0), "text");
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
        let err = analyze_import_file(app.state(), app.state(), Vec::new(), "csv".to_string())
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

        let analysis = analyze_import_file(app.state(), app.state(), bytes, "docx".to_string())
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
        let err = analyze_import_file(app.state(), app.state(), bytes, "docx".to_string())
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
            .bind(company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 2);

        let (name, cost, sell, tax, qty, category, supplier): (String, i64, i64, i64, i64, String, String) =
            sqlx::query_as(
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
            custom.as_ref().unwrap_or(&String::new()).contains("Vanilla"),
            "got: {custom:?}"
        );

        let category_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&*pool)
            .await
            .expect("categories");
        assert_eq!(category_count, 1, "categories should be shared between rows");
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

        let (tpl_name, tpl_type): (String, String) = sqlx::query_as(
            "SELECT template_name, file_type FROM import_templates",
        )
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
    async fn execute_import_reports_duplicate_sku_error() {
        // Input: two rows sharing the same SKU.
        // Expected: 1 product imported, 1 error mentioning "Duplicate SKU".
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\nA-1,Widget Dup\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_with_errors, 1);
        assert_eq!(result.errors[0].row_number, 3);
        assert!(
            result.errors[0].reason.contains("Duplicate SKU 'A-1'"),
            "got: {}",
            result.errors[0].reason
        );
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
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
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
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
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
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Expiry Date", 2, "expiry_date", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0].reason.contains("Cannot read date 'not-a-date'"),
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
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Flavor", 2, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: false,
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
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.into_bytes(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.rows_with_errors, 50);
        assert_eq!(result.errors.len(), 51);
        assert_eq!(result.errors.last().unwrap().row_number, 0);
        assert!(
            result.errors.last().unwrap().reason.contains("Stopped after 50 errors"),
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
                mappings: Vec::new(),
                file_bytes: b"a,b\n1,2".to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                import_data: true,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }
}
