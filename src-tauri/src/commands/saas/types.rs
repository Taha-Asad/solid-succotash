use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use crate::commands::auth::PublicUser;
use crate::commands::company::PublicCompany;

// ==========================================
// SAAS TYPES & DATA MODELS
// ==========================================

// ==========================================
// PUBLIC API TYPES (SERIALIZABLE FOR TAURI IPC)
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPackage {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub billing_cycle: String,
    pub module_limits: serde_json::Value,
    pub max_users: i64,
    pub max_branches: i64,
    pub max_storage_mb: i64,
    pub features: serde_json::Value,
    pub is_active: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSubscription {
    pub id: String,
    pub company_id: String,
    pub package_id: String,
    pub status: String,
    pub trial_ends_at: Option<String>,
    pub current_period_start: String,
    pub current_period_end: String,
    pub canceled_at: Option<String>,
    pub ended_at: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCompanyModule {
    pub id: String,
    pub company_id: String,
    pub module_key: String,
    pub is_enabled: bool,
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicFeatureFlag {
    pub id: String,
    pub company_id: String,
    pub feature_key: String,
    pub is_enabled: bool,
    pub enabled_by: Option<String>,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantCompanySummary {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub subscription_status: Option<String>,
    pub package_name: Option<String>,
    pub user_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantCompanyDetail {
    pub company: PublicCompany,
    pub subscription: Option<PublicSubscription>,
    pub package: Option<PublicPackage>,
    pub modules: Vec<PublicCompanyModule>,
    pub feature_flags: Vec<PublicFeatureFlag>,
    pub user_count: i64,
    pub ntn: Option<String>,
    pub strn: Option<String>,
    pub province: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTenantResult {
    pub company: PublicCompany,
    pub admin_user: PublicUser,
    pub subscription: PublicSubscription,
    pub modules: Vec<PublicCompanyModule>,
}

// ==========================================
// DB ROW TYPES
// ==========================================

#[derive(Debug, FromRow)]
pub struct PackageRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub billing_cycle: String,
    pub module_limits: String,
    pub max_users: i64,
    pub max_branches: i64,
    pub max_storage_mb: i64,
    pub features: String,
    pub is_active: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl PackageRow {
    pub fn to_public(&self) -> PublicPackage {
        PublicPackage {
            module_limits: serde_json::from_str(&self.module_limits).unwrap_or_default(),
            features: serde_json::from_str(&self.features).unwrap_or_default(),
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            price: self.price,
            billing_cycle: self.billing_cycle.clone(),
            max_users: self.max_users,
            max_branches: self.max_branches,
            max_storage_mb: self.max_storage_mb,
            is_active: self.is_active,
            sort_order: self.sort_order,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
pub struct SubscriptionRow {
    pub id: String,
    pub company_id: String,
    pub package_id: String,
    pub status: String,
    pub trial_ends_at: Option<String>,
    pub current_period_start: String,
    pub current_period_end: String,
    pub canceled_at: Option<String>,
    pub ended_at: Option<String>,
    pub metadata: String,
    pub created_at: String,
    pub updated_at: String,
}

impl SubscriptionRow {
    pub fn to_public(&self) -> PublicSubscription {
        PublicSubscription {
            metadata: serde_json::from_str(&self.metadata).unwrap_or_default(),
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            package_id: self.package_id.clone(),
            status: self.status.clone(),
            trial_ends_at: self.trial_ends_at.clone(),
            current_period_start: self.current_period_start.clone(),
            current_period_end: self.current_period_end.clone(),
            canceled_at: self.canceled_at.clone(),
            ended_at: self.ended_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
pub struct CompanyModuleRow {
    pub id: String,
    pub company_id: String,
    pub module_key: String,
    pub is_enabled: bool,
    pub settings: String,
    pub created_at: String,
    pub updated_at: String,
}

impl CompanyModuleRow {
    pub fn to_public(&self) -> PublicCompanyModule {
        PublicCompanyModule {
            settings: serde_json::from_str(&self.settings).unwrap_or_default(),
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            module_key: self.module_key.clone(),
            is_enabled: self.is_enabled,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

#[derive(Debug, FromRow)]
pub struct FeatureFlagRow {
    pub id: String,
    pub company_id: String,
    pub feature_key: String,
    pub is_enabled: bool,
    pub enabled_by: Option<String>,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl FeatureFlagRow {
    pub fn to_public(&self) -> PublicFeatureFlag {
        PublicFeatureFlag {
            id: self.id.clone(),
            company_id: self.company_id.clone(),
            feature_key: self.feature_key.clone(),
            is_enabled: self.is_enabled,
            enabled_by: self.enabled_by.clone(),
            reason: self.reason.clone(),
            expires_at: self.expires_at.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}
