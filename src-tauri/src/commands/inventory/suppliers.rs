use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{bump_version, check_permission, check_version, soft_delete};

use super::helpers::clean_optional;
use super::types::PublicSupplier;

// ==========================================
// SUPPLIER COMMANDS
// ==========================================

/// Lists all suppliers for the current user's company.
#[tauri::command]
pub async fn list_suppliers(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicSupplier>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let suppliers = sqlx::query_as::<_, PublicSupplier>(
        r#"
        SELECT id, company_id, name, contact_person, email,
               phone, address, tax_number, is_active,
               created_at, updated_at, version
        FROM suppliers
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(suppliers)
}

/// Creates a new supplier. Owner and admin only.
#[tauri::command]
pub async fn create_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
) -> Result<PublicSupplier, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Supplier name cannot be empty".to_string()));
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO suppliers
            (id, company_id, name, contact_person, email, phone, address, tax_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(clean_optional(&contact_person))
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&tax_number))
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "supplier",
        Some(&id),
        &format!("Created supplier '{}'", trimmed_name),
    )
    .await;

    Ok(supplier)
}

/// Updates a supplier. Owner and admin only.
#[tauri::command]
pub async fn update_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    expected_version: i64,
    supplier_id: String,
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
) -> Result<PublicSupplier, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Supplier name cannot be empty".to_string()));
    }

    check_version(pool.inner(), "suppliers", &supplier_id, expected_version).await?;

    let rows = sqlx::query(
        r#"
        UPDATE suppliers
        SET name = ?, contact_person = ?, email = ?, phone = ?,
            address = ?, tax_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(clean_optional(&contact_person))
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&tax_number))
    .bind(&supplier_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Supplier not found".to_string()));
    }

    bump_version(pool.inner(), "suppliers", &supplier_id).await?;

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ? AND company_id = ?")
        .bind(&supplier_id)
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "supplier",
        Some(&supplier_id),
        &format!("Updated supplier '{}'", trimmed_name),
    )
    .await;

    Ok(supplier)
}

/// Deactivates a supplier (soft delete). Owner and admin only.
#[tauri::command]
pub async fn set_supplier_active(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
    active: bool,
) -> Result<PublicSupplier, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let active_int: i32 = if active { 1 } else { 0 };

    let rows = sqlx::query(
        r#"
        UPDATE suppliers
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(active_int)
    .bind(&supplier_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Supplier not found".to_string()));
    }

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ? AND company_id = ?")
        .bind(&supplier_id)
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        if active { "activate" } else { "deactivate" },
        "supplier",
        Some(&supplier_id),
        if active {
            "Activated supplier"
        } else {
            "Deactivated supplier"
        },
    )
    .await;

    Ok(supplier)
}

/// Soft-deletes a supplier. Owner and admin only.
#[tauri::command]
pub async fn delete_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
) -> Result<(), AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "suppliers", &supplier_id, company_id).await?;

    if rows_affected == 0 {
        return Err(AppError::internal("Supplier not found".to_string()));
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "supplier",
        Some(&supplier_id),
        "Deleted supplier",
    )
    .await;

    Ok(())
}
