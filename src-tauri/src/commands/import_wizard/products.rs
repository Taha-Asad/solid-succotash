use super::types::*;
use super::adapters::{mapped_fields_note, mapping_value};
use super::parties::resolve_or_create_supplier;
use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// PRODUCT & OPENING STOCK IMPORTS
// ==========================================

/// Dry-run product validation: parse + required fields + duplicate check.
pub async fn validate_product_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_product_row(&request.mappings, row)?;
    let exists = sku_exists(pool, company_id, &parsed.sku).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}


/// Dry-run opening-stock validation: parse + product-exists check.
pub async fn validate_opening_stock_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_opening_stock_row(&request.mappings, row)?;
    let product_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(&parsed.sku)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;
    if product_exists == 0 {
        let hint = if parsed.name.is_empty() {
            String::new()
        } else {
            format!(" (file says '{}')", parsed.name)
        };
        return Err(AppError::internal(format!(
            "No product with SKU '{}'{hint} was found. Import your products first.",
            parsed.sku
        )));
    }
    Ok(ValidationOutcome::Import)
}


pub struct ParsedProduct {
    pub name: String,
    pub sku: String,
    pub cost_price: i64,
    pub sell_price: i64,
    pub quantity: i64,
    pub unit: String,
    pub tax_rate: i64,
    pub category_name: String,
    pub supplier_name: String,
    pub expiry: Option<String>,
    pub custom_json: Option<String>,
}

/// Extracts and validates a product row without touching the database.
pub fn parse_product_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedProduct, AppError> {
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
        return Err(AppError::internal(format!(
            "Row has no product NAME. Map a 'Product Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }

    if sku.is_empty() {
        return Err(AppError::internal(format!(
            "Row has no SKU. Map a 'SKU / Code' column in your file — SKUs are never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }

    let parsed_expiry: Option<String> = if expiry_raw.trim().is_empty() {
        None
    } else {
        {
            let d = crate::commands::inventory::parse_expiry_date(&expiry_raw)?;
            Some(d)
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
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL",
    )
    .bind(company_id)
    .bind(sku)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))
}

/// Finds the next free SKU by appending -1, -2, … to the base.
async fn next_free_sku(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, AppError> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if find_product_by_sku(pool, company_id, &candidate).await?.is_none() {
            return Ok(candidate);
        }
    }
    Err(AppError::internal(format!("Could not generate a free SKU for '{base}'")))
}

/// Grabs the next sequential batch number for the company from the pool.
/// Imports run row-by-row (not inside one big transaction), so this is a
/// small acquire → generate → release; the sequence itself is computed by
/// `inventory::generate_batch_number`.
async fn next_batch_number(pool: &SqlitePool, company_id: &str) -> Result<String, AppError> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::internal(format!("Batch number lookup error: {e}")))?;
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
) -> Result<String, AppError> {
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
            .map_err(|e| AppError::internal(format!("Failed to create expiry batch: {e}")))?;
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
) -> Result<(), AppError> {
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
    .map_err(|e| AppError::internal(format!("Failed to overwrite product: {e}")))?;

    Ok(())
}

/// Imports one row of data into the products table.
/// Returns Ok(true) when a row was imported, Ok(false) when it was
/// intentionally skipped (conflict strategy).
#[allow(clippy::too_many_arguments)]
pub async fn import_one_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, AppError> {
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
                        .map_err(|e| AppError::internal(format!("Failed to create expiry batch: {e}")))?;
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



pub async fn import_one_opening_stock_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
) -> Result<bool, AppError> {
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
    .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;

    let Some((product_id, product_cost)) = product else {
        let hint = if name.is_empty() {
            String::new()
        } else {
            format!(" (file says '{name}')")
        };
        return Err(AppError::internal(format!(
            "No product with SKU '{sku}'{hint} was found. Import your products first."
        )));
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
        .map_err(|e| AppError::internal(format!("Failed to start transaction: {e}")))?;

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
    .map_err(|e| AppError::internal(format!("Failed to update stock: {e}")))?;

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
    .map_err(|e| AppError::internal(format!("Failed to record movement: {e}")))?;

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
            .map_err(|e| AppError::internal(format!("Failed to create expiry batch: {e}")))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Failed to commit transaction: {e}")))?;

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
pub async fn sku_exists(pool: &SqlitePool, company_id: &str, sku: &str) -> Result<bool, AppError> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE AND deleted_at IS NULL)",
    )
    .bind(company_id)
    .bind(sku)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("SKU lookup error: {e}")))
}

/// Parsed + validated opening-stock row.
pub struct ParsedOpeningStock {
    sku: String,
    name: String,
    quantity: i64,
    cost_price: i64,
    has_cost: bool,
    expiry_raw: String,
}

/// Extracts and validates an opening-stock row without touching the database.
pub fn parse_opening_stock_row(
    mappings: &[FieldMapping],
    row: &[String],
) -> Result<ParsedOpeningStock, AppError> {
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
        return Err(AppError::internal(format!(
            "Row has no SKU. Map a 'SKU / Code' column in your file — opening stock rows are matched to products by SKU. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
    }

    if quantity < 0 {
        return Err(AppError::internal(format!(
            "Opening quantity for SKU '{sku}' cannot be negative"
        )));
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



pub async fn resolve_or_create_category(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Category lookup error: {e}")))?;

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
        .map_err(|e| AppError::internal(format!("Failed to create category '{trimmed}': {e}")))?;

    Ok(Some(id))
}
