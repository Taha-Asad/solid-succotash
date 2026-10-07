use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub hwid: String,
    pub device_name: String,
    pub os_info: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatusResponse {
    pub is_licensed: bool,
    pub is_blocked: bool,
    pub block_reason: Option<String>,
    pub license_key: Option<String>,
    pub client_name: Option<String>,
    pub license_type: Option<String>,
    pub days_remaining: Option<i64>,
    pub grace_days_remaining: Option<i64>,
    pub is_offline_grace: bool,
    pub device_hwid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateLicenseInput {
    pub license_key: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicLicense {
    pub id: String,
    pub company_id: Option<String>,
    pub license_key: String,
    pub client_name: String,
    pub license_type: String,
    pub status: String,
    pub max_devices: i64,
    pub active_devices_count: i64,
    pub offline_grace_days: i64,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicDeviceActivation {
    pub id: String,
    pub license_id: String,
    pub device_hwid: String,
    pub device_name: String,
    pub os_info: String,
    pub app_version: String,
    pub first_activated_at: String,
    pub last_heartbeat_at: String,
    pub ip_address: Option<String>,
    pub is_blocked: bool,
    pub block_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLicenseInput {
    pub client_name: String,
    pub license_type: String, // "trial", "beta_feedback", "commercial", "perpetual"
    pub max_devices: i64,
    pub validity_days: Option<i64>, // e.g. 7, 14, 30, 365, None
    pub offline_grace_days: Option<i64>, // default 7
    pub notes: Option<String>,
}
