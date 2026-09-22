use sqlx::SqlitePool;
use crate::error::AppError;

pub fn clean_optional(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Maps SQLite insert/update errors for products to friendly messages so
/// users never see a raw constraint string like "NOT NULL constraint failed".
pub fn map_product_db_error(e: sqlx::Error, sku: &str) -> String {
    let msg = e.to_string();
    if msg.contains("UNIQUE") {
        format!("SKU '{sku}' already exists")
    } else if msg.contains("NOT NULL") {
        "A required field is missing".to_string()
    } else if msg.contains("FOREIGN KEY") {
        "The selected category or supplier no longer exists".to_string()
    } else {
        format!("Database error: {msg}")
    }
}

/// Builds a short, uppercase, alphanumeric SKU prefix from a category name.
/// "Electronics" → "ELEC", "Mobile Phones" → "MOBI".
pub fn derive_sku_prefix(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let prefix: String = cleaned.chars().take(6).collect();
    if prefix.is_empty() {
        "CAT".to_string()
    } else {
        prefix
    }
}

/// Normalizes a user-supplied SKU prefix: uppercase, alphanumeric only.
/// Falls back to deriving one from the category name when blank.
pub fn normalize_sku_prefix(input: &str, category_name: &str) -> String {
    let cleaned: String = input
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let prefix: String = cleaned.chars().take(6).collect();
    if prefix.is_empty() {
        derive_sku_prefix(category_name)
    } else {
        prefix
    }
}

/// Builds the next automatic SKU for a company.
/// Uses the category's SKU prefix (or one derived from the product name)
/// and increments the highest existing number: ELEC-001, ELEC-002, ...
pub async fn generate_sku(
    pool: &SqlitePool,
    company_id: &str,
    cat_id: &Option<String>,
    product_name: &str,
) -> Result<String, AppError> {
    let prefix = match cat_id {
        Some(cid) => {
            let stored: Option<String> = sqlx::query_scalar(
                "SELECT sku_prefix FROM categories WHERE id = ? AND company_id = ?",
            )
            .bind(cid)
            .bind(company_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::internal(format!("Database error: {e}")))?;
            match stored {
                Some(p) if !p.trim().is_empty() => p
                    .trim()
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric())
                    .collect::<String>(),
                _ => derive_sku_prefix(product_name),
            }
        }
        None => derive_sku_prefix(product_name),
    };

    // Highest number already used for this prefix (suffix after "PREFIX-").
    let start: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(CAST(SUBSTR(sku, ?) AS INTEGER)), 0)
        FROM products
        WHERE company_id = ? AND sku LIKE ? || '-%'
        "#,
    )
    .bind((prefix.len() + 2) as i64)
    .bind(company_id)
    .bind(&prefix)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let mut next = start;
    loop {
        next += 1;
        let candidate = format!("{}-{:03}", prefix, next);
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE",
        )
        .bind(company_id)
        .bind(&candidate)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
}

