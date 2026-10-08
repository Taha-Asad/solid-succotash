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

    let cloud_db = crate::db::neon::NeonCloudDb::global();
    if cloud_db.is_connected() {
        let _ = cloud_db
            .assign_company_subscription(
                &company_id,
                &package_id,
                &status,
                trial_ends_at.as_deref(),
                &start,
                &period_end,
            )
            .await;
    }

    // Synchronize company_modules with new package limits
    if let Ok(pkg) = fetch_package(pool.inner(), &package_id).await {
        let limits: serde_json::Value = serde_json::from_str(&pkg.module_limits).unwrap_or_default();
        let feats: serde_json::Value = serde_json::from_str(&pkg.features).unwrap_or_default();

        const ALL_MODULES: &[&str] = &[
            "dashboard", "inventory", "invoices", "customers", "purchase_orders",
            "pos", "fbr", "ledger", "reports", "settings", "import", "users"
        ];

        for &m in ALL_MODULES {
            let is_core = matches!(m, "dashboard" | "inventory" | "invoices" | "settings" | "users");
            if is_core {
                continue;
            }

            let limit_allowed = match limits.get(m) {
                Some(serde_json::Value::Bool(b)) => *b,
                Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) > 0,
                _ => true,
            };
            let feat_allowed = match m {
                "fbr" => feats.get("fbr").and_then(|v| v.as_bool()).unwrap_or(false),
                "import" => feats.get("data_import").or_else(|| feats.get("import")).and_then(|v| v.as_bool()).unwrap_or(true),
                "pos" => feats.get("pos").and_then(|v| v.as_bool()).unwrap_or(true),
                "ledger" => feats.get("ledger").or_else(|| feats.get("accounts")).and_then(|v| v.as_bool()).unwrap_or(true),
                "purchase_orders" => limits.get("purchases").or_else(|| limits.get("purchase_orders")).and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n > 0))).unwrap_or(true),
                _ => feats.get(m).and_then(|v| v.as_bool()).unwrap_or(true),
            };

            let allowed = limit_allowed && feat_allowed;
            if !allowed {
                let _ = sqlx::query("UPDATE company_modules SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND module_key = ?")
                    .bind(&company_id)
                    .bind(m)
                    .execute(pool.inner())
                    .await;
                if cloud_db.is_connected() {
                    let _ = cloud_db.set_company_module(&company_id, m, false).await;
                }
            }
        }
    }

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


