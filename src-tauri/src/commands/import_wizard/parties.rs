use super::types::*;
use super::adapters::{mapped_fields_note, mapping_value};
use crate::error::AppError;
use sqlx::SqlitePool;

// ==========================================
// CUSTOMER & SUPPLIER IMPORTS
// ==========================================


/// Dry-run customer validation: parse + required fields + duplicate check.
pub async fn validate_customer_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_customer_row(&request.mappings, row)?;
    let exists = customer_name_exists(pool, company_id, &parsed.name).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}

/// Dry-run supplier validation.
pub async fn validate_supplier_row(
    pool: &SqlitePool,
    company_id: &str,
    request: &ImportRequest,
    row: &[String],
) -> Result<ValidationOutcome, AppError> {
    let parsed = parse_supplier_row(&request.mappings, row)?;
    let exists = supplier_name_exists(pool, company_id, &parsed.name).await?;
    Ok(conflict_outcome(exists, request.conflict_strategy))
}


/// Parsed + validated customer row. Everything comes from the file.
pub struct ParsedCustomer {
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
pub fn parse_customer_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedCustomer, AppError> {
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
        return Err(AppError::internal(format!(
            "Row has no customer NAME. Map a 'Customer Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
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
pub async fn customer_name_exists(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<bool, AppError> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE)",
    )
    .bind(company_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Duplicate check error: {e}")))
}

/// Finds the next free customer name by appending -1, -2, … to the base.
async fn next_free_customer_name(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, AppError> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if !customer_name_exists(pool, company_id, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(AppError::internal(format!("Could not generate a free name for '{base}'")))
}

async fn insert_customer(
    pool: &SqlitePool,
    company_id: &str,
    parsed: &ParsedCustomer,
    job_id: &str,
) -> Result<String, AppError> {
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
    .map_err(|e| AppError::internal(format!("DB error: {e}")))?;

    Ok(id)
}

async fn overwrite_customer(
    pool: &SqlitePool,
    customer_id: &str,
    company_id: &str,
    parsed: &ParsedCustomer,
) -> Result<(), AppError> {
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
    .map_err(|e| AppError::internal(format!("Failed to overwrite customer: {e}")))?;

    Ok(())
}

/// Imports one row into the customers table.
/// Returns Ok(true) when imported, Ok(false) when skipped by strategy.
#[allow(clippy::too_many_arguments)]
pub async fn import_one_customer_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, AppError> {
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
pub async fn find_customer_id(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Customer lookup error: {e}")))
}

/// Imports one opening-stock row: looks up the product by SKU and adds
/// the opening quantity to stock, recording a movement and (when the
/// file supplies an expiry date) an expiry batch.


pub struct ParsedSupplier {
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
}

/// Extracts and validates a supplier row without touching the database.
pub fn parse_supplier_row(mappings: &[FieldMapping], row: &[String]) -> Result<ParsedSupplier, AppError> {
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
        return Err(AppError::internal(format!(
            "Row has no supplier NAME. Map a 'Supplier Name' column in your file — it is never auto-generated. Columns: [{}]",
            mapped_fields_note(mappings, row)
        )));
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
pub async fn supplier_name_exists(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<bool, AppError> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM suppliers WHERE company_id = ? AND name = ? COLLATE NOCASE)",
    )
    .bind(company_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::internal(format!("Supplier lookup error: {e}")))
}

/// Looks up an existing supplier id by name (company-scoped).
pub async fn find_supplier_id(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM suppliers WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::internal(format!("Supplier lookup error: {e}")))
}

/// Finds the next free supplier name by appending -1, -2, … to the base.
async fn next_free_supplier_name(
    pool: &SqlitePool,
    company_id: &str,
    base: &str,
) -> Result<String, AppError> {
    for n in 1..1000u32 {
        let candidate = format!("{base}-{n}");
        if !supplier_name_exists(pool, company_id, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(AppError::internal(format!("Could not generate a free name for '{base}'")))
}

async fn insert_supplier(
    pool: &SqlitePool,
    company_id: &str,
    parsed: &ParsedSupplier,
    job_id: &str,
) -> Result<String, AppError> {
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
    .map_err(|e| AppError::internal(format!("DB error: {e}")))?;

    Ok(id)
}

async fn overwrite_supplier(
    pool: &SqlitePool,
    supplier_id: &str,
    company_id: &str,
    parsed: &ParsedSupplier,
) -> Result<(), AppError> {
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
    .map_err(|e| AppError::internal(format!("Failed to overwrite supplier: {e}")))?;

    Ok(())
}

/// Imports one row into the suppliers table.
/// Returns Ok(true) when imported, Ok(false) when skipped by strategy.
#[allow(clippy::too_many_arguments)]
pub async fn import_one_supplier_row(
    pool: &SqlitePool,
    company_id: &str,
    mappings: &[FieldMapping],
    row: &[String],
    job_id: &str,
    strategy: ConflictStrategy,
) -> Result<bool, AppError> {
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


pub async fn resolve_or_create_supplier(
    pool: &SqlitePool,
    company_id: &str,
    name: &str,
    job_id: &str,
) -> Result<Option<String>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Supplier lookup error: {e}")))?;

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
        .map_err(|e| AppError::internal(format!("Failed to create supplier '{trimmed}': {e}")))?;

    Ok(Some(id))
}


