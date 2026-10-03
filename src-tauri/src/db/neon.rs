use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
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
            WHERE is_active = TRUE
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
}

/// Initializes the connection to Neon PostgreSQL and runs cloud hub schema migrations.
pub async fn init_neon_pool() -> Option<PgPool> {
    dotenv::dotenv().ok();

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => url,
        _ => {
            warn!("DATABASE_URL not set; running in decoupled local-only mode");
            return None;
        }
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
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        "#,
    )
    .execute(pool)
    .await?;

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
