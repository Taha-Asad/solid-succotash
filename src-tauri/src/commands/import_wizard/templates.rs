use super::types::*;
use super::adapters::detect_field_type;
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// IMPORT TEMPLATES & CUSTOM FIELDS
// ==========================================

/// Creates/updates product custom-field settings (products target only).
pub async fn create_product_custom_fields(
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
pub async fn save_import_template(pool: &SqlitePool, company_id: &str, request: &ImportRequest) {
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
) -> Result<Vec<ImportTemplate>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Failed to list import templates: {e}")))?;

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
) -> Result<u64, AppError> {
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
        .map_err(|e| AppError::internal(format!("Failed to delete import template: {e}")))?;
    Ok(result.rows_affected())
}

/// Finds the best saved per-target template for a file whose headers match
/// (spec §23.5 auto-map). A template matches when at least 2 of its mapped
/// source columns appear in the file's headers and the overlap covers 60% of
/// the template's columns. The strongest overlap wins; ties fall back to the
/// most recently used template.
pub async fn match_import_template(
    pool: &SqlitePool,
    company_id: &str,
    target: &str,
    headers: &[String],
) -> Result<Option<ImportTemplate>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Failed to load import templates: {e}")))?;

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
pub async fn bump_template_usage(pool: &SqlitePool, template_id: &str) {
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
pub struct ImportTemplateRow {
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
    pub fn into_model(self) -> ImportTemplate {
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


