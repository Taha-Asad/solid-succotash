// ==========================================
// UPDATER COMMANDS
// ==========================================
//
// These commands check for and install updates from GitHub Releases.
// The database is NEVER touched — updates only replace program files.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub available: bool,
    pub current_version: String,
    pub update: Option<UpdateInfo>,
    pub error: Option<String>,
}

/// Checks if a new version is available from GitHub Releases.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateResult, String> {
    let updater = app.updater().map_err(|e| format!("Updater error: {e}"))?;

    let current_version = app.package_info().version.to_string();

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateResult {
            available: true,
            current_version,
            update: Some(UpdateInfo {
                version: update.version.to_string(),
                date: update.date.map(|d| d.to_string()),
                body: update.body.clone(),
            }),
            error: None,
        }),
        Ok(None) => Ok(UpdateResult {
            available: false,
            current_version,
            update: None,
            error: None,
        }),
        Err(e) => {
            // Not a critical failure — but classify the cause so the frontend
            // can react differently to a network error vs. a missing config.
            let error = match &e {
                UpdaterError::EmptyEndpoints => {
                    "Updater is not configured (no update endpoints set).".to_string()
                }
                UpdaterError::Reqwest(_) | UpdaterError::Network(_) => {
                    format!("Network error while checking for updates: {e}")
                }
                _ => format!("Update check failed: {e}"),
            };
            Ok(UpdateResult {
                available: false,
                current_version,
                update: None,
                error: Some(error),
            })
        }
    }
}

/// Downloads and installs the update.
/// The app will restart automatically after installation.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("Updater error: {e}"))?;

    match updater.check().await {
        Ok(Some(update)) => {
            let mut downloaded = 0;

            // Download and install
            update
                .download_and_install(
                    |chunk_length, _content_length| {
                        downloaded += chunk_length;
                        // Progress callback — could send to frontend later
                    },
                    || {
                        // Download complete callback
                    },
                )
                .await
                .map_err(|e| format!("Update install error: {e}"))?;

            Ok(())
        }
        Ok(None) => Err("No update available".to_string()),
        Err(e) => Err(format!("Update check error: {e}")),
    }
}
