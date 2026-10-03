use super::types::*;
use super::helpers::{audit_for, clean_optional_text, fetch_package, require_super_admin, PACKAGE_SELECT};
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// PACKAGES COMMANDS
// ==========================================

// ==========================================
// PACKAGES
// ==========================================

#[tauri::command]
pub async fn list_packages(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    include_inactive: Option<bool>,
) -> Result<Vec<PublicPackage>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let sql = if include_inactive.unwrap_or(false) && current_user.is_super_admin {
        format!("{PACKAGE_SELECT} WHERE deleted_at IS NULL ORDER BY sort_order")
    } else {
        format!("{PACKAGE_SELECT} WHERE deleted_at IS NULL AND is_active = 1 ORDER BY sort_order")
    };

    let local_rows = sqlx::query_as::<_, PackageRow>(sqlx::AssertSqlSafe(&*sql))
        .fetch_all(pool.inner())
        .await
        .map_err(|error| format!("Database error: {error}"))?;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        if let Ok(cloud_rows) = cloud_db
            .list_packages(include_inactive.unwrap_or(false) && current_user.is_super_admin)
            .await
        {
            use std::collections::HashSet;
            let mut seen = HashSet::new();
            let mut combined = Vec::new();
            for p in cloud_rows {
                seen.insert(p.id.clone());
                combined.push(p);
            }
            for r in local_rows {
                let p = r.to_public();
                if !seen.contains(&p.id) {
                    seen.insert(p.id.clone());
                    combined.push(p);
                }
            }
            return Ok(combined);
        }
    }

    Ok(local_rows.into_iter().map(|r| r.to_public()).collect())
}

fn validate_json_arg(value: &str, field_name: &str) -> Result<serde_json::Value, AppError> {
    serde_json::from_str(value)
        .map_err(|_| AppError::internal(format!("{field_name} must be valid JSON, for example {{\"sales\":1}}")))
}

#[tauri::command]
pub async fn create_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    description: Option<String>,
    price: Option<f64>,
    billing_cycle: Option<String>,
    module_limits: Option<String>,
    max_users: Option<i64>,
    max_branches: Option<i64>,
    max_storage_mb: Option<i64>,
    features: Option<String>,
    sort_order: Option<i64>,
) -> Result<PublicPackage, AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let name = name.trim();
    if name.chars().count() < 2 || name.chars().count() > 80 {
        return Err(AppError::internal("Package name must be between 2 and 80 characters".to_string()));
    }

    let description = clean_optional_text(description, "Description", 500)?;
    let price = price.unwrap_or(0.0).max(0.0);
    let billing_cycle = billing_cycle
        .unwrap_or_else(|| "monthly".to_string())
        .trim()
        .to_lowercase();
    let module_limits_json = module_limits.unwrap_or_else(|| "{}".to_string());
    validate_json_arg(&module_limits_json, "module_limits")?;
    let features_json = features.unwrap_or_else(|| "{}".to_string());
    validate_json_arg(&features_json, "features")?;
    let max_users = max_users.unwrap_or(5).max(0);
    let max_branches = max_branches.unwrap_or(1).max(0);
    let max_storage_mb = max_storage_mb.unwrap_or(100).max(0);
    let sort_order = sort_order.unwrap_or(0);

    let package_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO packages (
            id, name, description, price, billing_cycle, module_limits,
            max_users, max_branches, max_storage_mb, features, is_active, sort_order
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        "#,
    )
    .bind(&package_id)
    .bind(name)
    .bind(&description)
    .bind(price)
    .bind(&billing_cycle)
    .bind(&module_limits_json)
    .bind(max_users)
    .bind(max_branches)
    .bind(max_storage_mb)
    .bind(&features_json)
    .bind(sort_order)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "create",
        "package",
        Some(&package_id),
        &format!("Created package {name}"),
    )
    .await;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        if let Some(pg_pool) = cloud_db.pool() {
            let _ = sqlx::query(
                r#"
                INSERT INTO packages (
                    id, name, description, price, billing_cycle, module_limits,
                    max_users, max_branches, max_storage_mb, features, is_active, sort_order, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, TRUE, $11, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    price = EXCLUDED.price,
                    billing_cycle = EXCLUDED.billing_cycle,
                    module_limits = EXCLUDED.module_limits,
                    max_users = EXCLUDED.max_users,
                    max_branches = EXCLUDED.max_branches,
                    max_storage_mb = EXCLUDED.max_storage_mb,
                    features = EXCLUDED.features,
                    is_active = EXCLUDED.is_active,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = NOW();
                "#,
            )
            .bind(&package_id)
            .bind(name)
            .bind(&description)
            .bind(price)
            .bind(&billing_cycle)
            .bind(&module_limits_json)
            .bind(max_users)
            .bind(max_branches)
            .bind(max_storage_mb)
            .bind(&features_json)
            .bind(sort_order)
            .execute(pg_pool)
            .await;
        }
    }

    fetch_package(pool.inner(), &package_id).await.map(|r| r.to_public())
}

#[tauri::command]
pub async fn update_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    package_id: String,
    name: Option<String>,
    description: Option<String>,
    price: Option<f64>,
    billing_cycle: Option<String>,
    module_limits: Option<String>,
    max_users: Option<i64>,
    max_branches: Option<i64>,
    max_storage_mb: Option<i64>,
    features: Option<String>,
    is_active: Option<bool>,
    sort_order: Option<i64>,
) -> Result<PublicPackage, AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let mut current = fetch_package(pool.inner(), &package_id).await?;

    if let Some(name) = name {
        let name = name.trim();
        if name.chars().count() < 2 || name.chars().count() > 80 {
            return Err(AppError::internal("Package name must be between 2 and 80 characters".to_string()));
        }
        current.name = name.to_string();
    }
    if let Some(description) = description {
        current.description = clean_optional_text(Some(description), "Description", 500)?;
    }
    if let Some(price) = price {
        current.price = price.max(0.0);
    }
    if let Some(billing_cycle) = billing_cycle {
        current.billing_cycle = billing_cycle.trim().to_lowercase();
    }
    if let Some(module_limits) = module_limits {
        validate_json_arg(&module_limits, "module_limits")?;
        current.module_limits = module_limits;
    }
    if let Some(features) = features {
        validate_json_arg(&features, "features")?;
        current.features = features;
    }
    if let Some(max_users) = max_users {
        current.max_users = max_users.max(0);
    }
    if let Some(max_branches) = max_branches {
        current.max_branches = max_branches.max(0);
    }
    if let Some(max_storage_mb) = max_storage_mb {
        current.max_storage_mb = max_storage_mb.max(0);
    }
    if let Some(is_active) = is_active {
        current.is_active = is_active;
    }
    if let Some(sort_order) = sort_order {
        current.sort_order = sort_order;
    }

    sqlx::query(
        r#"
        UPDATE packages
        SET name = ?, description = ?, price = ?, billing_cycle = ?,
            module_limits = ?, max_users = ?, max_branches = ?, max_storage_mb = ?,
            features = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&current.name)
    .bind(&current.description)
    .bind(current.price)
    .bind(&current.billing_cycle)
    .bind(&current.module_limits)
    .bind(current.max_users)
    .bind(current.max_branches)
    .bind(current.max_storage_mb)
    .bind(&current.features)
    .bind(current.is_active)
    .bind(current.sort_order)
    .bind(&package_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "update",
        "package",
        Some(&package_id),
        &format!("Updated package {}", current.name),
    )
    .await;

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        if let Some(pg_pool) = cloud_db.pool() {
            let _ = sqlx::query(
                r#"
                INSERT INTO packages (
                    id, name, description, price, billing_cycle, module_limits,
                    max_users, max_branches, max_storage_mb, features, is_active, sort_order, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    price = EXCLUDED.price,
                    billing_cycle = EXCLUDED.billing_cycle,
                    module_limits = EXCLUDED.module_limits,
                    max_users = EXCLUDED.max_users,
                    max_branches = EXCLUDED.max_branches,
                    max_storage_mb = EXCLUDED.max_storage_mb,
                    features = EXCLUDED.features,
                    is_active = EXCLUDED.is_active,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = NOW();
                "#,
            )
            .bind(&package_id)
            .bind(&current.name)
            .bind(&current.description)
            .bind(current.price)
            .bind(&current.billing_cycle)
            .bind(&current.module_limits)
            .bind(current.max_users)
            .bind(current.max_branches)
            .bind(current.max_storage_mb)
            .bind(&current.features)
            .bind(current.is_active)
            .bind(current.sort_order)
            .execute(pg_pool)
            .await;
        }
    }

    fetch_package(pool.inner(), &package_id).await.map(|r| r.to_public())
}

#[tauri::command]
pub async fn delete_package(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    package_id: String,
) -> Result<(), AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    let result = sqlx::query(
        r#"
        UPDATE packages
        SET deleted_at = CURRENT_TIMESTAMP, is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&package_id)
    .execute(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    if result.rows_affected() == 0 {
        return Err(AppError::internal("Package not found".to_string()));
    }

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        if let Some(pg_pool) = cloud_db.pool() {
            let _ = sqlx::query(
                "UPDATE packages SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1",
            )
            .bind(&package_id)
            .execute(pg_pool)
            .await;
        }
    }

    audit_for(
        pool.inner(),
        &actor,
        "system",
        "delete",
        "package",
        Some(&package_id),
        "Soft-deleted package",
    )
    .await;

    Ok(())
}


