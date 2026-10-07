use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row, SqlitePool};
use std::sync::OnceLock;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::commands::auth::PublicUser;
use crate::commands::company::PublicCompany;
use crate::commands::saas::analytics::{MonthlyCount, PackageCount, PlatformAnalytics, StatusCount};
use crate::commands::saas::types::{
    CompanyModuleRow, FeatureFlagRow, PackageRow, PublicPackage, RegisterTenantResult,
    SubscriptionRow, TenantCompanyDetail, TenantCompanySummary,
};
use crate::error::AppError;
use crate::licensing::types::{IssueLicenseInput, PublicDeviceActivation, PublicLicense};

#[derive(Debug, Clone)]
pub struct CloudHeartbeatResult {
    pub is_blocked: bool,
    pub reason: Option<String>,
    pub license_type: Option<String>,
    pub days_remaining: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct CloudActivationResult {
    pub client_name: String,
    pub license_type: String,
    pub expires_at: Option<String>,
    pub days_remaining: Option<i64>,
}

static GLOBAL_CLOUD_DB: OnceLock<NeonCloudDb> = OnceLock::new();

/// Holds the PostgreSQL connection pool for the SaaS / Super Admin control plane.
/// When DATABASE_URL is available and reachable, `pool` contains the live PgPool.
#[derive(Clone)]
pub struct NeonCloudDb {
    pool: Option<PgPool>,
}

impl NeonCloudDb {
    pub fn new(pool: Option<PgPool>) -> Self {
        Self { pool }
    }

    pub fn global() -> Self {
        GLOBAL_CLOUD_DB
            .get()
            .cloned()
            .unwrap_or_else(|| NeonCloudDb::new(None))
    }

    pub fn set_global(cloud_db: NeonCloudDb) {
        let _ = GLOBAL_CLOUD_DB.set(cloud_db);
    }

    pub fn pool(&self) -> Option<&PgPool> {
        self.pool.as_ref()
    }

    pub fn is_connected(&self) -> bool {
        self.pool.is_some()
    }

    // ==========================================
    // SAAS SUPER ADMIN: TENANTS
    // ==========================================

    pub async fn list_tenant_companies(&self) -> Result<Vec<TenantCompanySummary>, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let rows = sqlx::query_as::<_, TenantCompanySummary>(
            r#"
            SELECT
                c.id,
                c.name,
                c.email,
                c.phone,
                c.is_active,
                TO_CHAR(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                s.status AS subscription_status,
                p.name AS package_name,
                (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count
            FROM companies AS c
            LEFT JOIN company_subscriptions AS s ON s.id = (
                SELECT cs.id FROM company_subscriptions cs WHERE cs.company_id = c.id ORDER BY cs.created_at DESC LIMIT 1
            )
            LEFT JOIN packages AS p ON p.id = s.package_id
            WHERE c.deleted_at IS NULL
            ORDER BY c.created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        Ok(rows)
    }

    pub async fn get_tenant_company_detail(
        &self,
        company_id: &str,
    ) -> Result<TenantCompanyDetail, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let company_row = sqlx::query(
            r#"
            SELECT
                id, name, email, phone, address, tax_number,
                currency_code, is_active,
                TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
                ntn, strn, fbr_registered,
                TO_CHAR(fbr_registration_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fbr_registration_date,
                province
            FROM companies
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?
        .ok_or_else(|| AppError::internal("Company not found".to_string()))?;

        let company = PublicCompany {
            id: company_row.get("id"),
            name: company_row.get("name"),
            email: company_row.get("email"),
            phone: company_row.get("phone"),
            address: company_row.get("address"),
            tax_number: company_row.get("tax_number"),
            currency_code: company_row.get("currency_code"),
            is_active: company_row.get("is_active"),
            created_at: company_row.get("created_at"),
            updated_at: company_row.get("updated_at"),
            ntn: company_row.get("ntn"),
            strn: company_row.get("strn"),
            fbr_registered: company_row.get("fbr_registered"),
            fbr_registration_date: company_row.get("fbr_registration_date"),
            province: company_row.get("province"),
        };

        let sub_row = sqlx::query(
            r#"
            SELECT
                id, company_id, package_id, status,
                TO_CHAR(trial_ends_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS trial_ends_at,
                TO_CHAR(current_period_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS current_period_start,
                TO_CHAR(current_period_end, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS current_period_end,
                TO_CHAR(canceled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS canceled_at,
                TO_CHAR(ended_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ended_at,
                metadata::text AS metadata,
                TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
            FROM company_subscriptions
            WHERE company_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let (subscription, package) = match sub_row {
            Some(row) => {
                let sub = SubscriptionRow {
                    id: row.get("id"),
                    company_id: row.get("company_id"),
                    package_id: row.get("package_id"),
                    status: row.get("status"),
                    trial_ends_at: row.get("trial_ends_at"),
                    current_period_start: row.get("current_period_start"),
                    current_period_end: row.get("current_period_end"),
                    canceled_at: row.get("canceled_at"),
                    ended_at: row.get("ended_at"),
                    metadata: row.get("metadata"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
                .to_public();

                let pkg_row = sqlx::query(
                    r#"
                    SELECT id, name, description, price::float8 as price, billing_cycle,
                           module_limits::text as module_limits, max_users, max_branches,
                           max_storage_mb, features::text as features, is_active, sort_order,
                           TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                           TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
                    FROM packages WHERE id = $1
                    "#,
                )
                .bind(&sub.package_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

                let pkg = pkg_row.map(|pr| {
                    PackageRow {
                        id: pr.get("id"),
                        name: pr.get("name"),
                        description: pr.get("description"),
                        price: pr.get("price"),
                        billing_cycle: pr.get("billing_cycle"),
                        module_limits: pr.get("module_limits"),
                        max_users: pr.get("max_users"),
                        max_branches: pr.get("max_branches"),
                        max_storage_mb: pr.get("max_storage_mb"),
                        features: pr.get("features"),
                        is_active: pr.get("is_active"),
                        sort_order: pr.get("sort_order"),
                        created_at: pr.get("created_at"),
                        updated_at: pr.get("updated_at"),
                    }
                    .to_public()
                });

                (Some(sub), pkg)
            }
            None => (None, None),
        };

        let mod_rows = sqlx::query(
            r#"
            SELECT id, company_id, module_key, is_enabled, settings::text as settings,
                   TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                   TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
            FROM company_modules
            WHERE company_id = $1
            ORDER BY module_key
            "#,
        )
        .bind(company_id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let modules = mod_rows
            .into_iter()
            .map(|r| {
                CompanyModuleRow {
                    id: r.get("id"),
                    company_id: r.get("company_id"),
                    module_key: r.get("module_key"),
                    is_enabled: r.get("is_enabled"),
                    settings: r.get("settings"),
                    created_at: r.get("created_at"),
                    updated_at: r.get("updated_at"),
                }
                .to_public()
            })
            .collect();

        let flag_rows = sqlx::query(
            r#"
            SELECT id, company_id, feature_key, is_enabled, enabled_by, reason,
                   TO_CHAR(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at,
                   TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                   TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
            FROM tenant_feature_flags
            WHERE company_id = $1
            ORDER BY feature_key
            "#,
        )
        .bind(company_id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let feature_flags = flag_rows
            .into_iter()
            .map(|r| {
                FeatureFlagRow {
                    id: r.get("id"),
                    company_id: r.get("company_id"),
                    feature_key: r.get("feature_key"),
                    is_enabled: r.get("is_enabled"),
                    enabled_by: r.get("enabled_by"),
                    reason: r.get("reason"),
                    expires_at: r.get("expires_at"),
                    created_at: r.get("created_at"),
                    updated_at: r.get("updated_at"),
                }
                .to_public()
            })
            .collect();

        let user_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE company_id = $1")
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        Ok(TenantCompanyDetail {
            company,
            subscription,
            package,
            modules,
            feature_flags,
            user_count: user_count.0,
            ntn: company_row.get("ntn"),
            strn: company_row.get("strn"),
            province: company_row.get("province"),
        })
    }

    pub async fn register_tenant(
        &self,
        company_name: &str,
        admin_full_name: &str,
        admin_email: &str,
        password_hash: &str,
        package_id: &str,
        phone: Option<&str>,
        address: Option<&str>,
        tax_number: Option<&str>,
        currency_code: &str,
        ntn: Option<&str>,
        strn: Option<&str>,
        province: Option<&str>,
    ) -> Result<RegisterTenantResult, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let company_id = Uuid::new_v4().to_string();
        let admin_id = Uuid::new_v4().to_string();
        let subscription_id = Uuid::new_v4().to_string();

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::database(format!("Neon DB tx error: {e}")))?;

        sqlx::query(
            r#"
            INSERT INTO companies (
                id, name, email, phone, address, tax_number, currency_code,
                ntn, strn, province, version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
            "#,
        )
        .bind(&company_id)
        .bind(company_name)
        .bind(admin_email)
        .bind(phone)
        .bind(address)
        .bind(tax_number)
        .bind(currency_code)
        .bind(ntn)
        .bind(strn)
        .bind(province)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Could not create cloud company: {e}")))?;

        sqlx::query(
            r#"
            INSERT INTO users (
                id, email, password_hash, full_name, role, company_id,
                is_active, is_super_admin, must_change_password
            ) VALUES ($1, $2, $3, $4, 'owner', $5, TRUE, FALSE, TRUE)
            "#,
        )
        .bind(&admin_id)
        .bind(admin_email)
        .bind(password_hash)
        .bind(admin_full_name)
        .bind(&company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("duplicate key") || msg.contains("unique") {
                AppError::internal("Email address is already registered in cloud".to_string())
            } else {
                AppError::database(format!("Could not create cloud user: {e}"))
            }
        })?;

        sqlx::query(
            r#"
            INSERT INTO company_subscriptions (
                id, company_id, package_id, status, trial_ends_at,
                current_period_start, current_period_end, metadata
            ) VALUES ($1, $2, $3, 'active', NULL, NOW(), NOW() + INTERVAL '30 days', '{}'::jsonb)
            "#,
        )
        .bind(&subscription_id)
        .bind(&company_id)
        .bind(package_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Could not create cloud subscription: {e}")))?;

        // Default modules
        let default_modules = [
            "dashboard",
            "inventory",
            "invoices",
            "customers",
            "pos",
            "reports",
            "users",
            "settings",
        ];
        for mod_key in default_modules {
            let mod_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO company_modules (id, company_id, module_key, is_enabled, settings)
                VALUES ($1, $2, $3, TRUE, '{}'::jsonb)
                ON CONFLICT (company_id, module_key) DO NOTHING
                "#,
            )
            .bind(&mod_id)
            .bind(&company_id)
            .bind(mod_key)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::database(format!("Could not create cloud module: {e}")))?;
        }

        tx.commit()
            .await
            .map_err(|e| AppError::database(format!("Could not commit cloud tenant: {e}")))?;

        let detail = self.get_tenant_company_detail(&company_id).await?;

        let admin_user = PublicUser {
            id: admin_id,
            email: admin_email.to_string(),
            full_name: admin_full_name.to_string(),
            role: "owner".to_string(),
            company_id: Some(company_id),
            is_active: true,
            created_at: detail.company.created_at.clone(),
            is_super_admin: false,
            must_change_password: true,
        };

        Ok(RegisterTenantResult {
            company: detail.company,
            admin_user,
            subscription: detail
                .subscription
                .expect("Subscription should have been created"),
            modules: detail.modules,
        })
    }

    pub async fn archive_company(&self, company_id: &str) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        sqlx::query("UPDATE companies SET is_active = FALSE, updated_at = NOW() WHERE id = $1")
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        Ok(())
    }

    pub async fn activate_company(&self, company_id: &str) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        sqlx::query("UPDATE companies SET is_active = TRUE, updated_at = NOW() WHERE id = $1")
            .bind(company_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        Ok(())
    }

    // ==========================================
    // SAAS SUPER ADMIN: PACKAGES
    // ==========================================

    pub async fn list_packages(
        &self,
        include_inactive: bool,
    ) -> Result<Vec<PublicPackage>, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let sql = if include_inactive {
            r#"
            SELECT id, name, description, price::float8 as price, billing_cycle,
                   module_limits::text as module_limits, max_users, max_branches,
                   max_storage_mb, features::text as features, is_active, sort_order,
                   TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                   TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
            FROM packages
            WHERE deleted_at IS NULL
            ORDER BY sort_order
            "#
        } else {
            r#"
            SELECT id, name, description, price::float8 as price, billing_cycle,
                   module_limits::text as module_limits, max_users, max_branches,
                   max_storage_mb, features::text as features, is_active, sort_order,
                   TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                   TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
            FROM packages
            WHERE is_active = TRUE AND deleted_at IS NULL
            ORDER BY sort_order
            "#
        };

        let rows = sqlx::query(sql)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let packages = rows
            .into_iter()
            .map(|pr| {
                PackageRow {
                    id: pr.get("id"),
                    name: pr.get("name"),
                    description: pr.get("description"),
                    price: pr.get("price"),
                    billing_cycle: pr.get("billing_cycle"),
                    module_limits: pr.get("module_limits"),
                    max_users: pr.get("max_users"),
                    max_branches: pr.get("max_branches"),
                    max_storage_mb: pr.get("max_storage_mb"),
                    features: pr.get("features"),
                    is_active: pr.get("is_active"),
                    sort_order: pr.get("sort_order"),
                    created_at: pr.get("created_at"),
                    updated_at: pr.get("updated_at"),
                }
                .to_public()
            })
            .collect();

        Ok(packages)
    }

    // ==========================================
    // SAAS SUPER ADMIN: ANALYTICS
    // ==========================================

    pub async fn get_platform_analytics(&self) -> Result<PlatformAnalytics, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let total_tenants: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL")
                .fetch_one(pool)
                .await
                .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let active_tenants: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM companies WHERE is_active = TRUE AND deleted_at IS NULL",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let total_users: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_active = TRUE")
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let mrr: (f64,) = sqlx::query_as(
            r#"
            SELECT COALESCE(SUM(
                CASE WHEN p.billing_cycle = 'yearly' THEN (p.price / 12.0)::float8
                     ELSE p.price::float8
                END
            ), 0.0::float8)
            FROM company_subscriptions s
            JOIN packages p ON p.id = s.package_id
            WHERE s.status IN ('active', 'trial')
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let status_rows = sqlx::query(
            r#"
            SELECT COALESCE(status, 'none') AS status, COUNT(*) AS count
            FROM company_subscriptions
            GROUP BY status
            ORDER BY count DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let subscriptions_by_status = status_rows
            .into_iter()
            .map(|r| StatusCount {
                status: r.get("status"),
                count: r.get("count"),
            })
            .collect();

        let pkg_rows = sqlx::query(
            r#"
            SELECT p.id AS package_id, p.name AS package_name, COUNT(s.company_id) AS count
            FROM packages p
            LEFT JOIN company_subscriptions s ON s.package_id = p.id AND s.status IN ('active', 'trial')
            GROUP BY p.id, p.name
            ORDER BY count DESC, p.name ASC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let tenants_by_package = pkg_rows
            .into_iter()
            .map(|r| PackageCount {
                package_id: r.get("package_id"),
                package_name: r.get("package_name"),
                count: r.get("count"),
            })
            .collect();

        let month_rows = sqlx::query(
            r#"
            SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS count
            FROM companies
            GROUP BY TO_CHAR(created_at, 'YYYY-MM')
            ORDER BY month DESC
            LIMIT 6
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let mut monthly_growth: Vec<MonthlyCount> = month_rows
            .into_iter()
            .map(|r| MonthlyCount {
                month: r.get("month"),
                count: r.get("count"),
            })
            .collect();
        monthly_growth.reverse();

        Ok(PlatformAnalytics {
            mrr: mrr.0,
            total_tenants: total_tenants.0,
            active_tenants: active_tenants.0,
            total_users: total_users.0,
            subscriptions_by_status,
            tenants_by_package,
            monthly_growth,
        })
    }

    // ==========================================
    // MULTI-MACHINE ONBOARDING & EMPLOYEE LOGIN
    // ==========================================

    /// Syncs a company and owner account created on a desktop machine up to Neon PostgreSQL
    pub async fn sync_company_and_owner_to_cloud(
        &self,
        company: &PublicCompany,
        owner: &PublicUser,
        password_hash: &str,
    ) -> Result<(), AppError> {
        let pool = match self.pool() {
            Some(p) => p,
            None => return Ok(()), // offline fallback, do nothing
        };

        info!("Syncing company '{}' to Neon PostgreSQL cloud...", company.name);

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        sqlx::query(
            r#"
            INSERT INTO companies (
                id, name, email, phone, address, tax_number, currency_code,
                ntn, strn, province, is_active, version
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                address = EXCLUDED.address,
                tax_number = EXCLUDED.tax_number,
                currency_code = EXCLUDED.currency_code,
                updated_at = NOW();
            "#,
        )
        .bind(&company.id)
        .bind(&company.name)
        .bind(&company.email)
        .bind(&company.phone)
        .bind(&company.address)
        .bind(&company.tax_number)
        .bind(&company.currency_code)
        .bind(&company.ntn)
        .bind(&company.strn)
        .bind(&company.province)
        .bind(company.is_active)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Could not sync company to cloud: {e}")))?;

        sqlx::query(
            r#"
            INSERT INTO users (
                id, email, password_hash, full_name, role, company_id,
                is_active, is_super_admin, must_change_password
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (email) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                company_id = EXCLUDED.company_id,
                is_active = EXCLUDED.is_active,
                updated_at = NOW();
            "#,
        )
        .bind(&owner.id)
        .bind(&owner.email)
        .bind(password_hash)
        .bind(&owner.full_name)
        .bind(&owner.role)
        .bind(&owner.company_id)
        .bind(owner.is_active)
        .bind(owner.is_super_admin)
        .bind(owner.must_change_password)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Could not sync owner to cloud: {e}")))?;

        // Attach default Starter subscription if not present
        let sub_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO company_subscriptions (
                id, company_id, package_id, status, trial_ends_at,
                current_period_start, current_period_end, metadata
            ) VALUES ($1, $2, 'pkg-starter', 'active', NULL, NOW(), NOW() + INTERVAL '30 days', '{}'::jsonb)
            ON CONFLICT (id) DO NOTHING;
            "#,
        )
        .bind(&sub_id)
        .bind(&company.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Could not create cloud subscription: {e}")))?;

        tx.commit()
            .await
            .map_err(|e| AppError::database(format!("Could not commit cloud sync: {e}")))?;

        info!("Successfully synced company '{}' to Neon PostgreSQL", company.name);
        Ok(())
    }

    /// Syncs an employee / company user created by an admin up to Neon PostgreSQL
    pub async fn sync_user_to_cloud(
        &self,
        user: &PublicUser,
        password_hash: &str,
    ) -> Result<(), AppError> {
        let pool = match self.pool() {
            Some(p) => p,
            None => return Ok(()),
        };

        info!("Syncing user '{}' to Neon PostgreSQL cloud...", user.email);

        sqlx::query(
            r#"
            INSERT INTO users (
                id, email, password_hash, full_name, role, company_id,
                is_active, is_super_admin, must_change_password
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (email) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                company_id = EXCLUDED.company_id,
                is_active = EXCLUDED.is_active,
                updated_at = NOW();
            "#,
        )
        .bind(&user.id)
        .bind(&user.email)
        .bind(password_hash)
        .bind(&user.full_name)
        .bind(&user.role)
        .bind(&user.company_id)
        .bind(user.is_active)
        .bind(user.is_super_admin)
        .bind(user.must_change_password)
        .execute(pool)
        .await
        .map_err(|e| AppError::database(format!("Could not sync user to cloud: {e}")))?;

        info!("Successfully synced user '{}' to Neon PostgreSQL", user.email);
        Ok(())
    }

    /// Checks Neon PostgreSQL for a user when logging in on a machine where local SQLite is empty
    pub async fn find_cloud_user_by_email(
        &self,
        email: &str,
    ) -> Result<Option<(PublicUser, String, Option<PublicCompany>)>, AppError> {
        let pool = match self.pool() {
            Some(p) => p,
            None => return Ok(None),
        };

        let user_row = sqlx::query(
            r#"
            SELECT
                id, email, password_hash, full_name, role, company_id,
                is_active, is_super_admin, must_change_password,
                TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
            FROM users
            WHERE LOWER(email) = LOWER($1) AND is_active = TRUE
            "#,
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

        let user_row = match user_row {
            Some(r) => r,
            None => return Ok(None),
        };

        let user = PublicUser {
            id: user_row.get("id"),
            email: user_row.get("email"),
            full_name: user_row.get("full_name"),
            role: user_row.get("role"),
            company_id: user_row.get("company_id"),
            is_active: user_row.get("is_active"),
            created_at: user_row.get("created_at"),
            is_super_admin: user_row.get("is_super_admin"),
            must_change_password: user_row.get("must_change_password"),
        };
        let password_hash: String = user_row.get("password_hash");

        let company = if let Some(ref cid) = user.company_id {
            let crow = sqlx::query(
                r#"
                SELECT
                    id, name, email, phone, address, tax_number,
                    currency_code, is_active,
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
                    ntn, strn, fbr_registered,
                    TO_CHAR(fbr_registration_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fbr_registration_date,
                    province
                FROM companies
                WHERE id = $1 AND is_active = TRUE
                "#,
            )
            .bind(cid)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::database(format!("Neon DB error: {e}")))?;

            crow.map(|r| PublicCompany {
                id: r.get("id"),
                name: r.get("name"),
                email: r.get("email"),
                phone: r.get("phone"),
                address: r.get("address"),
                tax_number: r.get("tax_number"),
                currency_code: r.get("currency_code"),
                is_active: r.get("is_active"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
                ntn: r.get("ntn"),
                strn: r.get("strn"),
                fbr_registered: r.get("fbr_registered"),
                fbr_registration_date: r.get("fbr_registration_date"),
                province: r.get("province"),
            })
        } else {
            None
        };

        Ok(Some((user, password_hash, company)))
    }

    /// Automatically syncs local SQLite companies, users, and packages with Neon PostgreSQL
    pub async fn sync_local_state_to_cloud(&self, sqlite_pool: &SqlitePool) {
        let pg_pool = match self.pool() {
            Some(p) => p,
            None => return,
        };

        // 1. Sync all local non-deleted companies up to Neon
        let local_companies = match sqlx::query_as::<_, PublicCompany>(
            r#"
            SELECT id, name, email, phone, address, tax_number,
                   currency_code, is_active, created_at, updated_at,
                   ntn, strn, fbr_registered, fbr_registration_date, province
            FROM companies
            WHERE deleted_at IS NULL
            "#,
        )
        .fetch_all(sqlite_pool)
        .await
        {
            Ok(c) => c,
            Err(e) => {
                warn!("Could not fetch local companies for cloud sync: {e}");
                return;
            }
        };

        for company in local_companies {
            // Check if company already exists in Neon
            let exists: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM companies WHERE id = $1")
                .bind(&company.id)
                .fetch_one(pg_pool)
                .await
                .unwrap_or((0,));

            if exists.0 == 0 {
                info!("Auto-syncing company '{}' to Neon PostgreSQL cloud...", company.name);
                let _ = sqlx::query(
                    r#"
                    INSERT INTO companies (
                        id, name, email, phone, address, tax_number, currency_code,
                        ntn, strn, province, is_active, version
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        email = EXCLUDED.email,
                        phone = EXCLUDED.phone,
                        address = EXCLUDED.address,
                        tax_number = EXCLUDED.tax_number,
                        currency_code = EXCLUDED.currency_code,
                        updated_at = NOW();
                    "#,
                )
                .bind(&company.id)
                .bind(&company.name)
                .bind(&company.email)
                .bind(&company.phone)
                .bind(&company.address)
                .bind(&company.tax_number)
                .bind(&company.currency_code)
                .bind(&company.ntn)
                .bind(&company.strn)
                .bind(&company.province)
                .bind(company.is_active)
                .execute(pg_pool)
                .await;

                // Ensure subscription exists in Neon
                let sub_id = Uuid::new_v4().to_string();
                let _ = sqlx::query(
                    r#"
                    INSERT INTO company_subscriptions (
                        id, company_id, package_id, status, trial_ends_at,
                        current_period_start, current_period_end, metadata
                    ) VALUES ($1, $2, 'pkg-starter', 'active', NULL, NOW(), NOW() + INTERVAL '30 days', '{}'::jsonb)
                    ON CONFLICT (id) DO NOTHING;
                    "#,
                )
                .bind(&sub_id)
                .bind(&company.id)
                .execute(pg_pool)
                .await;
            }
        }

        // 2. Sync all local users up to Neon (including password hashes so employees can log in on any machine!)
        let local_users = sqlx::query(
            r#"
            SELECT id, email, password_hash, full_name, role, company_id,
                   is_active, is_super_admin, must_change_password
            FROM users
            WHERE is_active = 1
            "#,
        )
        .fetch_all(sqlite_pool)
        .await
        .unwrap_or_default();

        for u in local_users {
            let uid: String = u.get("id");
            let email: String = u.get("email");
            let pw_hash: String = u.get("password_hash");
            let full_name: String = u.get("full_name");
            let role: String = u.get("role");
            let company_id: Option<String> = u.get("company_id");
            let is_active: bool = u.get::<i64, _>("is_active") == 1;
            let is_super_admin: bool = u.get::<i64, _>("is_super_admin") == 1;
            let must_change: bool = u.get::<i64, _>("must_change_password") == 1;

            let _ = sqlx::query(
                r#"
                INSERT INTO users (
                    id, email, password_hash, full_name, role, company_id,
                    is_active, is_super_admin, must_change_password
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (email) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    password_hash = EXCLUDED.password_hash,
                    role = EXCLUDED.role,
                    company_id = EXCLUDED.company_id,
                    is_active = EXCLUDED.is_active,
                    updated_at = NOW();
                "#,
            )
            .bind(&uid)
            .bind(&email)
            .bind(&pw_hash)
            .bind(&full_name)
            .bind(&role)
            .bind(&company_id)
            .bind(is_active)
            .bind(is_super_admin)
            .bind(must_change)
            .execute(pg_pool)
            .await;
        }

        // 3. Sync packages from Neon down into local SQLite so offline & local checks work smoothly
        if let Ok(cloud_pkgs) = self.list_packages(true).await {
            for p in cloud_pkgs {
                let _ = sqlx::query(
                    r#"
                    INSERT OR REPLACE INTO packages (
                        id, name, description, price, billing_cycle,
                        module_limits, max_users, max_branches, max_storage_mb,
                        features, is_active, sort_order, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    "#,
                )
                .bind(&p.id)
                .bind(&p.name)
                .bind(&p.description)
                .bind(p.price)
                .bind(&p.billing_cycle)
                .bind(serde_json::to_string(&p.module_limits).unwrap_or_else(|_| "{}".to_string()))
                .bind(p.max_users)
                .bind(p.max_branches)
                .bind(p.max_storage_mb)
                .bind(serde_json::to_string(&p.features).unwrap_or_else(|_| "[]".to_string()))
                .bind(p.is_active)
                .bind(p.sort_order)
                .bind(&p.created_at)
                .bind(&p.updated_at)
                .execute(sqlite_pool)
                .await;
            }
        }
    }

    // ==========================================
    // SAAS SUPER ADMIN: LICENSING & DEVICE GOVERNANCE
    // ==========================================

    pub async fn issue_tenant_license(&self, input: IssueLicenseInput) -> Result<PublicLicense, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let id = Uuid::new_v4().to_string();
        let key_raw = Uuid::new_v4().to_string().replace('-', "").to_uppercase();
        let license_key = format!("CRBL-{}-{}-{}", &key_raw[0..4], &key_raw[4..8], &key_raw[8..12]);
        let grace_days = input.offline_grace_days.unwrap_or(7);

        let row = sqlx::query_as::<_, PublicLicense>(
            r#"
            INSERT INTO tenant_licenses (
                id, license_key, client_name, license_type, status,
                max_devices, offline_grace_days, expires_at, notes,
                issued_by, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, 'active',
                $5, $6,
                CASE WHEN $7::bigint IS NOT NULL THEN NOW() + ($7 || ' days')::interval ELSE NULL END,
                $8, 'Taha Asadullah', NOW(), NOW()
            )
            RETURNING
                id, company_id, license_key, client_name, license_type,
                status, max_devices, 0::bigint as active_devices_count,
                offline_grace_days,
                TO_CHAR(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires_at,
                TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                notes
            "#,
        )
        .bind(&id)
        .bind(&license_key)
        .bind(&input.client_name)
        .bind(&input.license_type)
        .bind(input.max_devices)
        .bind(grace_days)
        .bind(input.validity_days)
        .bind(&input.notes)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to issue license: {e}")))?;

        Ok(row)
    }

    pub async fn list_tenant_licenses(&self) -> Result<Vec<PublicLicense>, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let rows = sqlx::query_as::<_, PublicLicense>(
            r#"
            SELECT 
                l.id, l.company_id, l.license_key, l.client_name, l.license_type,
                l.status, l.max_devices,
                COALESCE(da.active_count, 0)::bigint as active_devices_count,
                l.offline_grace_days,
                TO_CHAR(l.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires_at,
                TO_CHAR(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                l.notes
            FROM tenant_licenses l
            LEFT JOIN (
                SELECT license_id, COUNT(*)::bigint as active_count
                FROM device_activations
                WHERE is_blocked = FALSE
                GROUP BY license_id
            ) da ON da.license_id = l.id
            ORDER BY l.created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to list licenses: {e}")))?;

        Ok(rows)
    }

    pub async fn list_all_device_activations(&self) -> Result<Vec<PublicDeviceActivation>, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let rows = sqlx::query_as::<_, PublicDeviceActivation>(
            r#"
            SELECT 
                d.id, d.license_id, d.device_hwid, d.device_name, d.os_info, d.app_version,
                TO_CHAR(d.first_activated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as first_activated_at,
                TO_CHAR(d.last_heartbeat_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_heartbeat_at,
                d.ip_address, d.is_blocked, d.block_reason
            FROM device_activations d
            ORDER BY d.last_heartbeat_at DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to list device activations: {e}")))?;

        Ok(rows)
    }

    pub async fn revoke_tenant_license(&self, license_id: &str, reason: Option<&str>) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let block_reason = reason.unwrap_or("License revoked by administrator");

        sqlx::query("UPDATE tenant_licenses SET status = 'revoked', updated_at = NOW() WHERE id = $1")
            .bind(license_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to revoke license: {e}")))?;

        sqlx::query("UPDATE device_activations SET is_blocked = TRUE, block_reason = $1, updated_at = NOW() WHERE license_id = $2")
            .bind(block_reason)
            .bind(license_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to block devices under license: {e}")))?;

        Ok(())
    }

    pub async fn revoke_device_activation(&self, device_id: &str, reason: Option<&str>) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let block_reason = reason.unwrap_or("Device access revoked by administrator");

        sqlx::query("UPDATE device_activations SET is_blocked = TRUE, block_reason = $1, updated_at = NOW() WHERE id = $2")
            .bind(block_reason)
            .bind(device_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to revoke device: {e}")))?;

        Ok(())
    }

    pub async fn unblock_device_activation(&self, device_id: &str) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        sqlx::query("UPDATE device_activations SET is_blocked = FALSE, block_reason = NULL, updated_at = NOW() WHERE id = $1")
            .bind(device_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to unblock device: {e}")))?;

        Ok(())
    }

    pub async fn extend_tenant_license(&self, license_id: &str, additional_days: i64) -> Result<(), AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let interval_str = format!("{additional_days} days");

        sqlx::query(
            r#"
            UPDATE tenant_licenses
            SET expires_at = COALESCE(expires_at, NOW()) + ($1)::interval,
                status = 'active',
                updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(&interval_str)
        .bind(license_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::internal(format!("Failed to extend license: {e}")))?;

        Ok(())
    }

    pub async fn cloud_activate_device(
        &self,
        license_key: &str,
        hwid: &str,
        device_name: &str,
        os_info: &str,
        app_version: &str,
    ) -> Result<CloudActivationResult, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        let clean_key = license_key.trim();

        // 1. Validate license
        let license_row = sqlx::query(
            r#"
            SELECT id, client_name, license_type, status, max_devices,
                   TO_CHAR(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expires_at,
                   CASE WHEN expires_at IS NOT NULL THEN (expires_at > NOW()) ELSE TRUE END as is_not_expired,
                   CASE WHEN expires_at IS NOT NULL THEN EXTRACT(DAY FROM (expires_at - NOW()))::bigint ELSE NULL END as days_remaining
            FROM tenant_licenses
            WHERE license_key = $1
            "#,
        )
        .bind(clean_key)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Database error querying license: {e}")))?;

        let lic = license_row.ok_or_else(|| AppError::not_found("Invalid license key. Check key and try again."))?;

        let license_id: String = lic.get("id");
        let client_name: String = lic.get("client_name");
        let license_type: String = lic.get("license_type");
        let status: String = lic.get("status");
        let max_devices: i64 = lic.get("max_devices");
        let expires_at: Option<String> = lic.get("expires_at");
        let is_not_expired: bool = lic.get("is_not_expired");
        let days_remaining: Option<i64> = lic.get("days_remaining");

        if status != "active" {
            return Err(AppError::validation(format!("License is {status}. Contact support.")));
        }

        if !is_not_expired {
            return Err(AppError::validation("This license has expired. Contact support to renew."));
        }

        // 2. Check if device is already registered under this license
        let dev_row = sqlx::query("SELECT id, is_blocked, block_reason FROM device_activations WHERE license_id = $1 AND device_hwid = $2")
            .bind(&license_id)
            .bind(hwid)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::internal(format!("Database error checking device: {e}")))?;

        if let Some(dev) = dev_row {
            let dev_id: String = dev.get("id");
            let is_blocked: bool = dev.get("is_blocked");
            if is_blocked {
                let reason: Option<String> = dev.get("block_reason");
                return Err(AppError::validation(
                    reason.unwrap_or_else(|| "This physical device has been blocked by administrator.".to_string()),
                ));
            }

            // Refresh device details
            let _ = sqlx::query(
                "UPDATE device_activations SET device_name = $1, os_info = $2, app_version = $3, last_heartbeat_at = NOW() WHERE id = $4"
            )
            .bind(device_name)
            .bind(os_info)
            .bind(app_version)
            .bind(&dev_id)
            .execute(pool)
            .await;
        } else {
            // New device: check device limit
            let count_row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM device_activations WHERE license_id = $1 AND is_blocked = FALSE")
                .bind(&license_id)
                .fetch_one(pool)
                .await
                .map_err(|e| AppError::internal(format!("Database error checking active count: {e}")))?;

            if count_row.0 >= max_devices {
                return Err(AppError::validation(format!(
                    "Device limit exceeded! This license only permits {} registered device(s).",
                    max_devices
                )));
            }

            let new_dev_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO device_activations (
                    id, license_id, device_hwid, device_name, os_info,
                    app_version, first_activated_at, last_heartbeat_at, is_blocked
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), FALSE)
                "#,
            )
            .bind(&new_dev_id)
            .bind(&license_id)
            .bind(hwid)
            .bind(device_name)
            .bind(os_info)
            .bind(app_version)
            .execute(pool)
            .await
            .map_err(|e| AppError::internal(format!("Failed to register device activation: {e}")))?;
        }

        Ok(CloudActivationResult {
            client_name,
            license_type,
            expires_at,
            days_remaining,
        })
    }

    pub async fn cloud_heartbeat(
        &self,
        license_key: &str,
        hwid: &str,
        app_version: &str,
    ) -> Result<CloudHeartbeatResult, AppError> {
        let pool = self
            .pool()
            .ok_or_else(|| AppError::internal("Cloud database not connected".to_string()))?;

        // 1. Check license
        let license_row = sqlx::query(
            r#"
            SELECT id, status, license_type,
                   CASE WHEN expires_at IS NOT NULL THEN (expires_at > NOW()) ELSE TRUE END as is_not_expired,
                   CASE WHEN expires_at IS NOT NULL THEN EXTRACT(DAY FROM (expires_at - NOW()))::bigint ELSE NULL END as days_remaining
            FROM tenant_licenses
            WHERE license_key = $1
            "#,
        )
        .bind(license_key)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::internal(format!("Heartbeat error checking license: {e}")))?;

        let lic = match license_row {
            Some(l) => l,
            None => {
                return Ok(CloudHeartbeatResult {
                    is_blocked: true,
                    reason: Some("License key does not exist.".to_string()),
                    license_type: None,
                    days_remaining: None,
                });
            }
        };

        let license_id: String = lic.get("id");
        let status: String = lic.get("status");
        let license_type: String = lic.get("license_type");
        let is_not_expired: bool = lic.get("is_not_expired");
        let days_remaining: Option<i64> = lic.get("days_remaining");

        if status != "active" {
            return Ok(CloudHeartbeatResult {
                is_blocked: true,
                reason: Some(format!("License is {status}.")),
                license_type: Some(license_type),
                days_remaining,
            });
        }

        if !is_not_expired {
            return Ok(CloudHeartbeatResult {
                is_blocked: true,
                reason: Some("License has expired.".to_string()),
                license_type: Some(license_type),
                days_remaining: Some(0),
            });
        }

        // 2. Check device activation
        let dev_row = sqlx::query("SELECT id, is_blocked, block_reason FROM device_activations WHERE license_id = $1 AND device_hwid = $2")
            .bind(&license_id)
            .bind(hwid)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::internal(format!("Heartbeat error checking device: {e}")))?;

        if let Some(dev) = dev_row {
            let dev_id: String = dev.get("id");
            let is_blocked: bool = dev.get("is_blocked");
            if is_blocked {
                let reason: Option<String> = dev.get("block_reason");
                return Ok(CloudHeartbeatResult {
                    is_blocked: true,
                    reason: reason.or(Some("Device blocked by administrator.".to_string())),
                    license_type: Some(license_type),
                    days_remaining,
                });
            }

            // Update heartbeat timestamp & app version
            let _ = sqlx::query("UPDATE device_activations SET last_heartbeat_at = NOW(), app_version = $1 WHERE id = $2")
                .bind(app_version)
                .bind(&dev_id)
                .execute(pool)
                .await;
        }

        Ok(CloudHeartbeatResult {
            is_blocked: false,
            reason: None,
            license_type: Some(license_type),
            days_remaining,
        })
    }
}

pub const DEFAULT_NEON_DATABASE_URL: &str =
    "postgresql://neondb_owner:npg_kCdPHpZ30hut@ep-restless-surf-ayvdfezf-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

/// Initializes the connection to Neon PostgreSQL and runs cloud hub schema migrations.
pub async fn init_neon_pool() -> Option<PgPool> {
    dotenv::dotenv().ok();

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => url,
        _ => match option_env!("DATABASE_URL") {
            Some(url) if !url.trim().is_empty() => url.to_string(),
            _ => DEFAULT_NEON_DATABASE_URL.to_string(),
        },
    };

    info!("Connecting to Neon PostgreSQL...");

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await
    {
        Ok(p) => {
            info!("Successfully connected to Neon PostgreSQL");
            p
        }
        Err(e) => {
            error!("Failed to connect to Neon PostgreSQL: {e}");
            return None;
        }
    };

    // Run SaaS / Multi-tenant migrations on Neon
    if let Err(e) = run_neon_migrations(&pool).await {
        error!("Failed to run Neon PostgreSQL migrations: {e}");
    }

    let cloud_db = NeonCloudDb::new(Some(pool.clone()));
    NeonCloudDb::set_global(cloud_db);

    Some(pool)
}

/// Idempotent schema migration for Neon PostgreSQL cloud hub
pub async fn run_neon_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    info!("Running Neon PostgreSQL schema migrations...");

    // 1. Companies table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS companies (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            phone VARCHAR(50),
            address TEXT,
            tax_number VARCHAR(100),
            currency_code VARCHAR(10) NOT NULL DEFAULT 'PKR',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            ntn VARCHAR(50),
            strn VARCHAR(50),
            fbr_registered BOOLEAN NOT NULL DEFAULT FALSE,
            fbr_registration_date TIMESTAMPTZ,
            province VARCHAR(100),
            version INT NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(pool)
    .await?;

    // 2. Users table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(64) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'cashier',
            company_id VARCHAR(64) REFERENCES companies(id) ON DELETE CASCADE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
            must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        "#,
    )
    .execute(pool)
    .await?;

    // 3. SaaS Packages
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS packages (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
            module_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
            max_users BIGINT NOT NULL DEFAULT 5,
            max_branches BIGINT NOT NULL DEFAULT 1,
            max_storage_mb BIGINT NOT NULL DEFAULT 1024,
            features JSONB NOT NULL DEFAULT '[]'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        );
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE packages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
        .execute(pool)
        .await;

    // 4. Company Subscriptions
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS company_subscriptions (
            id VARCHAR(64) PRIMARY KEY,
            company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            package_id VARCHAR(64) NOT NULL REFERENCES packages(id),
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            trial_ends_at TIMESTAMPTZ,
            current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            current_period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
            canceled_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        "#,
    )
    .execute(pool)
    .await?;

    // 5. Company Modules
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS company_modules (
            id VARCHAR(64) PRIMARY KEY,
            company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            module_key VARCHAR(100) NOT NULL,
            is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(company_id, module_key)
        );
        "#,
    )
    .execute(pool)
    .await?;

    // 6. Tenant Feature Flags
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tenant_feature_flags (
            id VARCHAR(64) PRIMARY KEY,
            company_id VARCHAR(64) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            feature_key VARCHAR(100) NOT NULL,
            is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            enabled_by VARCHAR(64),
            reason TEXT,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(company_id, feature_key)
        );
        "#,
    )
    .execute(pool)
    .await?;

    // 7. Tenant Licenses
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tenant_licenses (
            id VARCHAR(64) PRIMARY KEY,
            company_id VARCHAR(64) REFERENCES companies(id) ON DELETE SET NULL,
            license_key VARCHAR(64) NOT NULL UNIQUE,
            client_name VARCHAR(255) NOT NULL,
            license_type VARCHAR(32) NOT NULL DEFAULT 'trial',
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            max_devices BIGINT NOT NULL DEFAULT 1,
            offline_grace_days BIGINT NOT NULL DEFAULT 7,
            expires_at TIMESTAMPTZ,
            features JSONB NOT NULL DEFAULT '{}'::jsonb,
            notes TEXT,
            issued_by VARCHAR(128) NOT NULL DEFAULT 'Taha Asadullah',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 8. Device Activations
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS device_activations (
            id VARCHAR(64) PRIMARY KEY,
            license_id VARCHAR(64) NOT NULL REFERENCES tenant_licenses(id) ON DELETE CASCADE,
            device_hwid VARCHAR(64) NOT NULL,
            device_name VARCHAR(128) NOT NULL,
            os_info VARCHAR(128) NOT NULL,
            app_version VARCHAR(32) NOT NULL DEFAULT '1.3.1',
            first_activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ip_address VARCHAR(64),
            is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
            block_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(license_id, device_hwid)
        )
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_device_activations_hwid ON device_activations(device_hwid)")
        .execute(pool)
        .await;

    // Seed default packages if empty
    seed_default_packages(pool).await?;

    // Seed default super admin user if empty
    seed_super_admin(pool).await?;

    info!("Neon PostgreSQL migrations and seeds completed successfully");
    Ok(())
}

async fn seed_default_packages(pool: &PgPool) -> Result<(), sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM packages")
        .fetch_one(pool)
        .await?;

    if count.0 > 0 {
        return Ok(());
    }

    info!("Seeding default SaaS packages in Neon PostgreSQL...");

    let packages = [
        (
            "pkg-starter",
            "Starter",
            "Ideal for single shops and small retailers",
            2500.00,
            "monthly",
            r#"{"inventory": true, "invoicing": true, "reports": true, "customers": true}"#,
            3,
            1,
            512,
            r#"["Point of Sale", "Thermal Receipts", "Basic Reports", "Offline First"]"#,
            1,
        ),
        (
            "pkg-pro",
            "Professional",
            "Perfect for growing businesses with FBR fiscalization",
            6500.00,
            "monthly",
            r#"{"inventory": true, "invoicing": true, "reports": true, "customers": true, "fbr": true, "multi_currency": true}"#,
            10,
            3,
            2048,
            r#"["Everything in Starter", "FBR Real-Time Integration", "Multi-Currency", "Advanced Ledger", "Role Permissions"]"#,
            2,
        ),
        (
            "pkg-enterprise",
            "Enterprise",
            "Full-scale ERP for multi-branch distribution & wholesale",
            15000.00,
            "monthly",
            r#"{"inventory": true, "invoicing": true, "reports": true, "customers": true, "fbr": true, "multi_currency": true, "custom_roles": true, "audit_trail": true}"#,
            50,
            10,
            10240,
            r#"["Everything in Pro", "Unlimited Branches", "Full Audit Trail", "Custom Roles", "Priority SRE Support"]"#,
            3,
        ),
    ];

    for pkg in packages {
        sqlx::query(
            r#"
            INSERT INTO packages (
                id, name, description, price, billing_cycle, module_limits,
                max_users, max_branches, max_storage_mb, features, is_active, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, TRUE, $11)
            ON CONFLICT (id) DO NOTHING;
            "#,
        )
        .bind(pkg.0)
        .bind(pkg.1)
        .bind(pkg.2)
        .bind(pkg.3)
        .bind(pkg.4)
        .bind(pkg.5)
        .bind(pkg.6)
        .bind(pkg.7)
        .bind(pkg.8)
        .bind(pkg.9)
        .bind(pkg.10)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn seed_super_admin(pool: &PgPool) -> Result<(), sqlx::Error> {
    let super_admin_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_super_admin = TRUE")
            .fetch_one(pool)
            .await?;

    if super_admin_count.0 > 0 {
        return Ok(());
    }

    info!("Seeding platform Super Admin in Neon PostgreSQL...");

    // Password hash for admin: 'Admin123!'
    let password_hash = "$2b$12$e0M20v3H0N8Vl6t/P4Yhge7U0zVv2rG.8V.J5S5cI5dJj.2n7s0vO";

    sqlx::query(
        r#"
        INSERT INTO users (
            id, email, password_hash, full_name, role, company_id,
            is_active, is_super_admin, must_change_password
        ) VALUES (
            'usr-super-admin-01',
            'admin@corbel.local',
            $1,
            'Super Administrator',
            'super_admin',
            NULL,
            TRUE,
            TRUE,
            FALSE
        ) ON CONFLICT (email) DO NOTHING;
        "#,
    )
    .bind(password_hash)
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_neon_connectivity_and_schema() {
        dotenv::dotenv().ok();
        let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set in .env");
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .acquire_timeout(std::time::Duration::from_secs(45))
            .connect(&db_url)
            .await
            .expect("Failed to connect to Neon PostgreSQL");

        run_neon_migrations(&pool)
            .await
            .expect("Failed to run Neon migrations");

        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM packages")
            .fetch_one(&pool)
            .await
            .expect("Query failed");

        assert!(count >= 3);
    }
}
