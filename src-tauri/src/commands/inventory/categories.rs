use sqlx::SqlitePool;
use tauri::State;

use crate::commands::audit::log_audit;
use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{bump_version, check_permission, check_version, soft_delete};

use super::helpers::{clean_optional, derive_sku_prefix, normalize_sku_prefix};
use super::types::PublicCategory;

// CATEGORY COMMANDS
// ==========================================

/// Lists all categories for the current user's company.
#[tauri::command]
pub async fn list_categories(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicCategory>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let categories = sqlx::query_as::<_, PublicCategory>(
        r#"
        SELECT id, company_id, name, description, sku_prefix, is_active,
               created_at, updated_at, version
        FROM categories
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(categories)
}

/// Creates a new category. Owner and admin only.
#[tauri::command]
pub async fn create_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    description: Option<String>,
    sku_prefix: Option<String>,
) -> Result<PublicCategory, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Category name cannot be empty".to_string()));
    }

    let prefix_raw = sku_prefix.as_deref().unwrap_or("");
    let prefix = normalize_sku_prefix(prefix_raw, &trimmed_name);

    let id = uuid::Uuid::new_v4().to_string();
    let desc = description.as_deref().and_then(clean_optional);

    sqlx::query(
        r#"
        INSERT INTO categories (id, company_id, name, description, sku_prefix)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(&desc)
    .bind(&prefix)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Category '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    // Fetch and return the created category
    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ?")
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
        "category",
        Some(&id),
        &format!("Created category '{}'", trimmed_name),
    )
    .await;

    Ok(category)
}

/// Updates a category's name, description and SKU prefix. Owner and admin only.
#[tauri::command]
pub async fn update_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    expected_version: i64,
    category_id: String,
    name: String,
    description: Option<String>,
    sku_prefix: Option<String>,
) -> Result<PublicCategory, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Category name cannot be empty".to_string()));
    }

    let desc = description.as_deref().and_then(clean_optional);

    // If the user cleared the prefix, keep whatever it was before
    // (falling back to one derived from the new name for old records).
    let existing_prefix: Option<String> =
        sqlx::query_scalar("SELECT sku_prefix FROM categories WHERE id = ? AND company_id = ?")
            .bind(&category_id)
            .bind(company_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let prefix_raw = sku_prefix.as_deref().unwrap_or("").trim();
    let prefix = if prefix_raw.is_empty() {
        match existing_prefix {
            Some(p) if !p.is_empty() => p,
            _ => derive_sku_prefix(&trimmed_name),
        }
    } else {
        normalize_sku_prefix(prefix_raw, &trimmed_name)
    };

    check_version(pool.inner(), "categories", &category_id, expected_version).await?;

    let rows = sqlx::query(
        r#"
        UPDATE categories
        SET name = ?, description = ?, sku_prefix = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(&desc)
    .bind(&prefix)
    .bind(&category_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Category '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Category not found".to_string()));
    }

    bump_version(pool.inner(), "categories", &category_id).await?;

    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ? AND company_id = ?")
        .bind(&category_id)
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
        "category",
        Some(&category_id),
        &format!("Updated category '{}'", trimmed_name),
    )
    .await;

    Ok(category)
}

/// Deactivates a category (soft delete). Owner and admin only.
#[tauri::command]
pub async fn set_category_active(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
    active: bool,
) -> Result<PublicCategory, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let active_int: i32 = if active { 1 } else { 0 };

    let rows = sqlx::query(
        r#"
        UPDATE categories
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(active_int)
    .bind(&category_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Category not found".to_string()));
    }

    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ? AND company_id = ?")
        .bind(&category_id)
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
        "category",
        Some(&category_id),
        if active {
            "Activated category"
        } else {
            "Deactivated category"
        },
    )
    .await;

    Ok(category)
}

// ==========================================

/// Soft-deletes a category. Owner and admin only.
#[tauri::command]
pub async fn delete_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
) -> Result<(), AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "categories", &category_id, company_id).await?;

    if rows_affected == 0 {
        return Err(AppError::internal("Category not found".to_string()));
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "category",
        Some(&category_id),
        "Deleted category",
    )
    .await;

    Ok(())
}

