use super::types::*;
use super::helpers::{audit_for, fetch_package, fetch_subscription_for_company, now_iso, require_super_admin};
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// SUBSCRIPTIONS COMMANDS
// ==========================================

// ==========================================
// SUBSCRIPTIONS
// ==========================================

#[tauri::command]
pub async fn get_current_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Option<PublicSubscription>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .clone()
        .ok_or_else(|| AppError::internal("User is not assigned to a company".to_string()))?;

    fetch_subscription_for_company(pool.inner(), &company_id).await
}

#[tauri::command]
pub async fn get_company_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
) -> Result<Option<PublicSubscription>, AppError> {
    require_super_admin(pool.inner(), session.inner()).await?;
    fetch_subscription_for_company(pool.inner(), &company_id).await
}

#[tauri::command]
pub async fn assign_company_subscription(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: String,
    package_id: String,
    status: Option<String>,
    trial_days: Option<i64>,
) -> Result<PublicSubscription, AppError> {
    let actor = require_super_admin(pool.inner(), session.inner()).await?;

    // Ensure package + company exist.
    fetch_package(pool.inner(), &package_id).await?;
    let company_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM companies WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;
    if company_exists == 0 {
        return Err(AppError::internal("Company not found".to_string()));
    }

    let status = status.unwrap_or_else(|| "active".to_string());
    if !["active", "trial", "past_due", "suspended", "cancelled", "ended"].contains(&status.as_str())
    {
        return Err(AppError::internal("Invalid subscription status".to_string()));
    }

    let start = now_iso();
    let trial_ends_at = trial_days.map(|days| {
        (chrono::Utc::now() + chrono::Duration::days(days))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string()
    });
    let period_end = (chrono::Utc::now() + chrono::Duration::days(30))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let existing_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM company_subscriptions WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|error| format!("Database error: {error}"))?;

    let subscription_id = match existing_id {
        Some(id) => {
            sqlx::query(
                r#"
                UPDATE company_subscriptions
                SET package_id = ?, status = ?, trial_ends_at = ?,
                    current_period_start = ?, current_period_end = ?,
                    canceled_at = NULL, ended_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(&package_id)
            .bind(&status)
            .bind(&trial_ends_at)
            .bind(&start)
            .bind(&period_end)
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
                INSERT INTO company_subscriptions (
                    id, company_id, package_id, status, trial_ends_at,
                    current_period_start, current_period_end, metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
                "#,
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&package_id)
            .bind(&status)
            .bind(&trial_ends_at)
            .bind(&start)
            .bind(&period_end)
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
        "subscription",
        Some(&subscription_id),
        &format!("Assigned package {package_id} ({status}) to company {company_id}"),
    )
    .await;

    fetch_subscription_for_company(pool.inner(), &company_id)
        .await?
        .ok_or_else(|| AppError::internal("Subscription not found".to_string()))
}


