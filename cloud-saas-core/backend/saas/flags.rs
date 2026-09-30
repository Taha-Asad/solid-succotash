use super::types::*;
use super::helpers::{audit_for, clean_optional_text, require_super_admin, resolve_company_id, validate_feature_key};
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// FEATURE FLAGS COMMANDS
// ==========================================

// ==========================================
// FEATURE FLAGS (Super Admin only, spec §3.16)
// ==========================================

#[tauri::command]
pub async fn list_feature_flags(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: Option<String>,
) -> Result<Vec<PublicFeatureFlag>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let target = resolve_company_id(&current_user, company_id)?;

    let rows = sqlx::query_as::<_, FeatureFlagRow>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
               expires_at, created_at, updated_at
        FROM tenant_feature_flags
        WHERE company_id = ?
        ORDER BY feature_key
        "#,
    )
    .bind(&target)
    .fetch_all(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

#[tauri::command]
pub async fn set_feature_flag(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    feature_key: String,
    is_enabled: bool,
    reason: Option<String>,
) -> Result<PublicFeatureFlag, AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;
    let feature_key = validate_feature_key(&feature_key)?;
    let reason = clean_optional_text(reason, "Reason", 500)?;

    let existing_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM tenant_feature_flags WHERE company_id = ? AND feature_key = ?",
    )
    .bind(&company_id)
    .bind(&feature_key)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let flag_id = match existing_id {
        Some(id) => {
            sqlx::query(
                r#"
                UPDATE tenant_feature_flags
                SET is_enabled = ?, enabled_by = ?, reason = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(is_enabled)
            .bind(&actor.id)
            .bind(&reason)
            .bind(&id)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO tenant_feature_flags
                    (id, company_id, feature_key, is_enabled, enabled_by, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&feature_key)
            .bind(is_enabled)
            .bind(&actor.id)
            .bind(&reason)
            .execute(pool.inner())
            .await
            .map_err(|error| format!("Database error: {error}"))?;
            id
        }
    };

    audit_for(
        pool.inner(),
        &actor,
        &company_id,
        "update",
        "feature_flag",
        Some(&flag_id),
        &format!("Set feature flag {feature_key} = {is_enabled}"),
    )
    .await;

    sqlx::query_as::<_, FeatureFlagRow>(
        r#"
        SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
               expires_at, created_at, updated_at
        FROM tenant_feature_flags WHERE id = ?
        "#,
    )
    .bind(&flag_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| AppError::database(format!("Database error: {error}")))
    .map(|r| r.to_public())
}


