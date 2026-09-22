use super::helpers::require_super_admin;
use super::types::*;
use crate::commands::auth::{require_current_user, SessionState};
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// PLATFORM ANALYTICS COMMANDS
// ==========================================

// ==========================================
// PLATFORM ANALYTICS
// ==========================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAnalytics {
    pub mrr: f64,
    pub total_tenants: i64,
    pub active_tenants: i64,
    pub total_users: i64,
    pub subscriptions_by_status: Vec<StatusCount>,
    pub tenants_by_package: Vec<PackageCount>,
    pub monthly_growth: Vec<MonthlyCount>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatusCount {
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PackageCount {
    pub package_id: String,
    pub package_name: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyCount {
    pub month: String,
    pub count: i64,
}

/// Aggregate platform KPIs for the Super Admin analytics view.
/// Requires super admin. Read-only (no audit entries written).
#[tauri::command]
pub async fn get_platform_analytics(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<PlatformAnalytics, AppError> {
    require_super_admin(pool.inner(), &session).await?;

    let total_tenants: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM companies")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let active_tenants: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM companies WHERE is_active = 1",
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let mrr: f64 = sqlx::query_scalar(
        r#"
        SELECT CAST(COALESCE(SUM(CAST(
            CASE WHEN p.billing_cycle = 'yearly' THEN p.price / 12.0 ELSE p.price END
        AS REAL)), 0) AS REAL)
        FROM company_subscriptions s
        JOIN packages p ON p.id = s.package_id
        WHERE s.status IN ('active', 'trial')
        "#,
    )
    .fetch_one(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let subscriptions_by_status: Vec<StatusCount> = sqlx::query_as(
        r#"
        SELECT COALESCE(status, 'none') AS status, COUNT(*) AS count
        FROM company_subscriptions
        GROUP BY status
        ORDER BY count DESC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let tenants_by_package: Vec<PackageCount> = sqlx::query_as(
        r#"
        SELECT p.id AS package_id, p.name AS package_name,
               COUNT(s.company_id) AS count
        FROM packages p
        LEFT JOIN company_subscriptions s
               ON s.package_id = p.id AND s.status IN ('active', 'trial')
        GROUP BY p.id, p.name
        ORDER BY count DESC, p.name ASC
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let mut monthly_growth: Vec<MonthlyCount> = sqlx::query_as(
        r#"
        SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
        FROM companies
        GROUP BY month
        ORDER BY month DESC
        LIMIT 6
        "#,
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;
    monthly_growth.reverse();

    Ok(PlatformAnalytics {
        mrr,
        total_tenants,
        active_tenants,
        total_users,
        subscriptions_by_status,
        tenants_by_package,
        monthly_growth,
    })
}


