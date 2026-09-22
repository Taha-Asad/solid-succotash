use super::types::*;
use super::adapters::propose_mappings;
use super::templates::{bump_template_usage, match_import_template};
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use calamine::{open_workbook_auto_from_rs, Data, Reader};
use sqlx::SqlitePool;
use std::io::Cursor;
use tauri::State;

// ==========================================
// STEP 1: ANALYZE THE FILE & FILE PARSING READERS
// ==========================================

#[tauri::command]
pub async fn analyze_import_file(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    file_bytes: Vec<u8>,
    file_type: String,
    target: Option<String>,
    adapter: Option<String>,
) -> Result<FileAnalysis, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let target = target.unwrap_or_else(|| "products".to_string());
    if !IMPORT_TARGETS.contains(&target.as_str()) {
        return Err(AppError::internal(format!(
            "Unknown import target '{target}'. Supported: {}",
            IMPORT_TARGETS.join(", ")
        )));
    }

    if let Some(adapter) = adapter.as_deref() {
        if !adapter.is_empty() && !is_valid_adapter(adapter) {
            return Err(AppError::internal(format!(
                "Unknown ERP adapter '{adapter}'. Supported: {}",
                ERP_ADAPTER_KEYS.join(", ")
            )));
        }
    }

    if file_bytes.is_empty() {
        return Err(AppError::internal("File is empty".to_string()));
    }

    if file_bytes.len() > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::internal(format!(
            "File too large ({} bytes). Maximum allowed is {} MB.",
            file_bytes.len(),
            MAX_IMPORT_FILE_BYTES / (1024 * 1024)
        )));
    }

    let mut analysis = match file_type.as_str() {
        "xlsx" | "xls" => analyze_excel(file_bytes, &target, adapter.as_deref()).await?,
        "csv" => analyze_csv(file_bytes, &target, adapter.as_deref()).await?,
        "docx" => analyze_docx(file_bytes, &target, adapter.as_deref()).await?,
        "pdf" => analyze_pdf(file_bytes, &target, adapter.as_deref()).await?,
        "png" | "jpg" | "jpeg" => analyze_image(file_bytes, &target, adapter.as_deref()).await?,
        _ => {
            return Err(AppError::internal(format!(
                "Unsupported file type: {file_type}. Supported: xlsx, xls, csv, docx, pdf, \
                 png, jpg"
            )));
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
) -> Result<FileAnalysis, AppError> {
    let cursor = Cursor::new(file_bytes);
    let mut workbook = open_workbook_auto_from_rs(cursor)
        .map_err(|e| AppError::internal(format!("Failed to read Excel file: {e}")))?;

    // Get the first sheet
    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err(AppError::internal("Excel file has no sheets".to_string()));
    }

    let range = workbook
        .worksheet_range(&sheet_names[0])
        .map_err(|e| AppError::internal(format!("Failed to read sheet: {e}")))?;

    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let row_data: Vec<String> = row.iter().map(cell_to_string).collect();
        rows.push(row_data);
    }

    if rows.is_empty() {
        return Err(AppError::internal("Excel file is empty (no rows)".to_string()));
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
) -> Result<FileAnalysis, AppError> {
    let cursor = Cursor::new(file_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(cursor);

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| AppError::internal(format!("Failed to read CSV headers: {e}")))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    let mut data_rows: Vec<Vec<String>> = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| AppError::internal(format!("Failed to read CSV row: {e}")))?;
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
) -> Result<FileAnalysis, AppError> {
    // Unused here — the XML parsing was extracted into parse_docx_table().
    // use quick_xml::events::Event;
    // use quick_xml::Reader as XmlReader;
    use std::io::Read;

    // 1. Open the .docx as a ZIP archive
    let cursor = Cursor::new(file_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| AppError::internal(format!("Failed to open docx file: {e}")))?;

    // 2. Find and read word/document.xml
    let mut document_xml = String::new();
    {
        let mut file = archive.by_name("word/document.xml").map_err(|_| {
            "This .docx file appears to be corrupted (no word/document.xml found)".to_string()
        })?;
        file.read_to_string(&mut document_xml)
            .map_err(|e| AppError::internal(format!("Failed to read document content: {e}")))?;
    }

    // 3. Parse the XML to extract table data
    let all_rows = parse_docx_table(&document_xml)?;

    if all_rows.is_empty() {
        return Err(AppError::validation(
            "No table found in this .docx file. The document must contain a Word table. \
             If your data is plain text, please copy it into a .csv or .xlsx file instead.",
        ));
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
) -> Result<FileAnalysis, AppError> {
    let all_rows = read_pdf_rows(&file_bytes)?;
    Ok(build_text_analysis(all_rows, "pdf", target, adapter))
}

/// Analyzes an image file (spec §23.2 Phase 2) by running OCR over it.
/// Requires Tesseract OCR to be installed and reachable on PATH.
async fn analyze_image(
    file_bytes: Vec<u8>,
    target: &str,
    adapter: Option<&str>,
) -> Result<FileAnalysis, AppError> {
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



/// Converts a calamine cell to a string
pub fn cell_to_string(cell: &Data) -> String {
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
pub fn read_excel_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let cursor = Cursor::new(file_bytes.to_vec());
    let mut workbook =
        open_workbook_auto_from_rs(cursor).map_err(|e| AppError::internal(format!("Failed to read Excel: {e}")))?;

    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err(AppError::internal("No sheets found".to_string()));
    }

    let range = workbook
        .worksheet_range(&sheet_names[0])
        .map_err(|e| AppError::internal(format!("Failed to read sheet: {e}")))?;

    let mut rows = Vec::new();
    for row in range.rows() {
        rows.push(row.iter().map(cell_to_string).collect());
    }
    Ok(rows)
}

/// Reads all rows from a CSV file (including header)
pub fn read_csv_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let cursor = Cursor::new(file_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false) // we want ALL rows including header
        .from_reader(cursor);

    let mut rows = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| AppError::internal(format!("CSV error: {e}")))?;
        rows.push(record.iter().map(|f| f.to_string()).collect());
    }
    Ok(rows)
}

/// Reads all rows from a .docx file (including header row)
pub fn read_docx_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    use std::io::Read;

    let cursor = Cursor::new(file_bytes.to_vec());
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| AppError::internal(format!("Failed to open docx: {e}")))?;

    let mut document_xml = String::new();
    {
        let mut file = archive
            .by_name("word/document.xml")
            .map_err(|_| AppError::internal("No word/document.xml found".to_string()))?;
        file.read_to_string(&mut document_xml)
            .map_err(|e| AppError::internal(format!("Read error: {e}")))?;
    }

    parse_docx_table(&document_xml)
}

/// Reads all rows from a PDF file (including header row).
///
/// Only text-layer PDFs are supported here: the text is extracted with
/// `pdf-extract` and split into tabular rows by whitespace. Scanned PDFs that
/// carry no embedded text are rejected — they would need OCR (see
/// `read_image_rows` / `ocr_image_to_text`).
pub fn read_pdf_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let text = pdf_extract::extract_text_from_mem(file_bytes)
        .map_err(|e| AppError::internal(format!("Failed to read PDF text: {e}")))?;

    let rows = parse_text_rows(&text);
    if rows.is_empty() {
        return Err(AppError::validation(
            "No text found in this PDF. It may be a scanned document. \
             Use a PDF with a text layer (most accounting software exports have one), \
             or export to CSV/XLSX instead.",
        ));
    }
    Ok(rows)
}

/// Reads all rows from an image file (including header row) by running OCR.
///
/// Images always need OCR (spec §23.2). We shell out to the Tesseract OCR
/// command-line tool, so Tesseract must be installed and on PATH. The image is
/// decoded first so corrupt/non-image files fail with a clear message instead
/// of a confusing tesseract error.
pub fn read_image_rows(file_bytes: &[u8]) -> Result<Vec<Vec<String>>, AppError> {
    let text = ocr_image_to_text(file_bytes)?;

    let rows = parse_text_rows(&text);
    if rows.is_empty() {
        return Err(AppError::validation(
            "OCR produced no readable text. Make sure the image is clear, in focus, \
             and shows the table legibly.",
        ));
    }
    Ok(rows)
}

/// Splits OCR/extracted text into rows, then cells. Empty lines are dropped
/// (headers of exported PDFs are usually separated by blank lines).
pub(crate) fn parse_text_rows(text: &str) -> Vec<Vec<String>> {
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
pub(crate) fn split_text_line(line: &str) -> Vec<String> {
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
fn ocr_image_to_text(file_bytes: &[u8]) -> Result<String, AppError> {
    let img = image::load_from_memory(file_bytes)
        .map_err(|e| AppError::internal(format!("Not a valid image file: {e}")))?;

    let path = std::env::temp_dir().join(format!("ijaz_ocr_{}.png", uuid::Uuid::new_v4()));
    img.save(&path)
        .map_err(|e| AppError::internal(format!("Failed to write temp image: {e}")))?;

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
        Ok(output) => Err(AppError::internal(format!(
            "Tesseract OCR failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))),
        Err(e) => {
            let hint = if bundle.is_some() {
                "The bundled Tesseract engine could not run. \
                 Reinstall the app, or import a CSV/XLSX/text-PDF instead."
            } else {
                "Tesseract OCR is not bundled with this build. \
                 Install Tesseract OCR (https://github.com/tesseract-ocr/tesseract) and add it \
                 to your PATH, or import a CSV/XLSX/text-PDF instead."
            };
            Err(AppError::internal(format!("Tesseract OCR is not available: {e}. {hint}")))
        }
    }
}

/// Shared XML parser for .docx tables.
/// Used by both analyze_docx and read_docx_rows.
pub(crate) fn parse_docx_table(document_xml: &str) -> Result<Vec<Vec<String>>, AppError> {
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
            Err(e) => return Err(AppError::internal(format!("XML parsing error: {e}"))),
            _ => {}
        }
    }

    Ok(all_rows)
}
