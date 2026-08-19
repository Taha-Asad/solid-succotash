#![allow(clippy::too_many_arguments)]

// ==========================================
// FBR DIGITAL INVOICING / PRAL INTEGRATION
// ==========================================
//
// spec section 17 -- FBR Digital Invoicing / PRAL Integration
//
// Lifecycle:
//   1. Invoice finalized -> outbox row inserted (same transaction)
//   2. Background worker picks up queued rows
//   3. POST payload to PRAL DI API
//   4. Success: store IRN + QR data -> status = 'validated'
//   5. Failure: exponential backoff (0 -> 2m -> 10m -> 30m -> 2h)
//   6. 5 failures: status = 'dead'

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::invoices::PublicInvoice;
use crate::commands::permissions::check_permission;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FbrConfigRow {
    pub id: String,
    pub company_id: String,
    pub pral_token: Option<String>,
    pub token_expires_at: Option<String>,
    pub environment: String,
    pub sandbox_url: String,
    pub production_url: String,
    pub is_active: bool,
    pub last_tested_at: Option<String>,
    pub last_test_result: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FbrQueueItem {
    pub id: String,
    pub company_id: String,
    pub invoice_id: String,
    pub invoice_type: String,
    pub payload: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub status: String,
    pub scheduled_at: String,
    pub last_attempted_at: Option<String>,
    pub last_error: Option<String>,
    pub irn: Option<String>,
    pub qr_data: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct FbrInvoiceHeader {
    pub strn: Option<String>,
    pub ntn: Option<String>,
    pub business_name: String,
    pub invoice_date: String,
    pub invoice_ref_no: String,
    pub invoice_type: String,
    pub province: Option<String>,
    pub buyer_ntn: Option<String>,
    pub buyer_cnic: Option<String>,
    pub buyer_name: String,
    pub total_bill_amount: f64,
    pub total_sale_value: f64,
    pub total_tax_charged: f64,
    pub total_quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct FbrInvoiceItem {
    pub item_serial_no: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hs_code: Option<String>,
    pub product_code: String,
    pub item_description: String,
    pub quantity: i64,
    pub unit_price: f64,
    pub total_amount: f64,
    pub tax_rate: f64,
    pub tax_category: String,
    pub tax_charged: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct FbrInvoicePayload {
    pub invoice_header: FbrInvoiceHeader,
    pub invoice_items: Vec<FbrInvoiceItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FbrApiResponse {
    pub status: String,
    pub irn: Option<String>,
    pub qr_data: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicFbrQueueItem {
    pub id: String,
    pub invoice_id: String,
    pub invoice_type: String,
    pub status: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub scheduled_at: String,
    pub last_attempted_at: Option<String>,
    pub last_error: Option<String>,
    pub irn: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbrQueueStatus {
    pub total: i64,
    pub queued: i64,
    pub submitting: i64,
    pub validated: i64,
    pub failed: i64,
    pub dead: i64,
    pub items: Vec<PublicFbrQueueItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceFbrStatus {
    pub fbr_status: String,
    pub irn: Option<String>,
    pub fbr_invoice_number: Option<String>,
    pub queue_item: Option<PublicFbrQueueItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FbrConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub timestamp: String,
}

// ==========================================
// HELPERS
// ==========================================

/// paisa to FBR decimal (e.g. 11800000 -> 118000.00)
fn paisa_to_fbr_decimal(paisa: i64) -> f64 {
    paisa as f64 / 100.0
}

/// Map company province name to FBR province string.
fn province_code(province: &str) -> Option<String> {
    match province.trim().to_lowercase().as_str() {
        "punjab" => Some("Punjab".to_string()),
        "sindh" => Some("Sindh".to_string()),
        "khyber pakhtunkhwa" | "kpk" | "nwfp" => Some("Khyber Pakhtunkhwa".to_string()),
        "balochistan" => Some("Balochistan".to_string()),
        "islamabad" | "ict" => Some("ICT".to_string()),
        _ => None,
    }
}

/// Build the FBR JSON payload for an invoice (spec section 17.3).
async fn build_fbr_payload(
    pool: &SqlitePool,
    company_id: &str,
    invoice_id: &str,
    invoice_type: &str,
) -> Result<String, String> {
    let company: (Option<String>, Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT ntn, strn, province, name FROM companies WHERE id = ?",
        )
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Company lookup error: {e}"))?
        .ok_or("Company not found")?;

    let company_ntn = company.0;
    let company_strn = company.1;
    let company_province = company.2.and_then(|p| province_code(&p));
    let company_name = company.3.unwrap_or_default();

    let settings: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT company_ntn, company_strn FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Settings lookup error: {e}"))?
    .unwrap_or((None, None));

    let ntn = company_ntn.or(settings.0);
    let strn = company_strn.or(settings.1);

    let invoice: (String, String, String, i64, i64, i64) = sqlx::query_as(
        "SELECT invoice_number, invoice_date, customer_id, subtotal, tax_total, grand_total \
         FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(invoice_id)
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Invoice lookup error: {e}"))?
    .ok_or("Invoice not found")?;

    let customer: (Option<String>, Option<String>, Option<String>, String) = sqlx::query_as(
        "SELECT name, ntn, cnic, buyer_type FROM customers WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice.2)
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Customer lookup error: {e}"))?
    .ok_or("Customer not found")?;

    let raw_items: Vec<(Option<String>, String, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT product_sku, product_name, quantity, unit_price, tax_rate, tax_amount \
         FROM invoice_items WHERE invoice_id = ?",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Items lookup error: {e}"))?;

    let mut total_quantity: i64 = 0;
    let items: Vec<FbrInvoiceItem> = raw_items
        .into_iter()
        .enumerate()
        .map(|(idx, item)| {
            total_quantity += item.2;
            let unit_price = paisa_to_fbr_decimal(item.3);
            let tax_rate = item.4 as f64 / 100.0;
            let tax_charged = paisa_to_fbr_decimal(item.5);
            let total_amount = unit_price * item.2 as f64 + tax_charged;

            FbrInvoiceItem {
                item_serial_no: (idx + 1) as i64,
                hs_code: None,
                product_code: item.0.unwrap_or_default(),
                item_description: item.1,
                quantity: item.2,
                unit_price,
                total_amount,
                tax_rate,
                tax_category: if tax_rate > 0.0 {
                    "Standard Rate".to_string()
                } else {
                    "Exempt".to_string()
                },
                tax_charged,
            }
        })
        .collect();

    let payload = FbrInvoicePayload {
        invoice_header: FbrInvoiceHeader {
            strn,
            ntn,
            business_name: company_name,
            invoice_date: invoice.1,
            invoice_ref_no: invoice.0,
            invoice_type: invoice_type.to_string(),
            province: company_province,
            buyer_ntn: customer.1,
            buyer_cnic: customer.2,
            buyer_name: customer.0.unwrap_or_default(),
            total_bill_amount: paisa_to_fbr_decimal(invoice.5),
            total_sale_value: paisa_to_fbr_decimal(invoice.3),
            total_tax_charged: paisa_to_fbr_decimal(invoice.4),
            total_quantity,
        },
        invoice_items: items,
    };

    serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Payload serialization error: {e}"))
}

/// POST invoice payload to the FBR PRAL DI API.
async fn submit_to_fbr(
    url: &str,
    payload: &str,
    token: &Option<String>,
) -> Result<FbrApiResponse, String> {
    let client = reqwest::Client::new();

    let mut builder = client
        .post(url)
        .header("Content-Type", "application/json");

    if let Some(tok) = token {
        if !tok.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {tok}"));
        }
    }

    let response = builder
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("FBR API request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read FBR response body: {e}"))?;

    if !status.is_success() {
        return Err(format!("FBR API returned HTTP {status}: {body}"));
    }

    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
    match parsed {
        Ok(val) => {
            let status_str = val
                .get("status")
                .or_else(|| val.get("Status"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let irn = val
                .get("irn")
                .or_else(|| val.get("IRN"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let qr_data = val
                .get("qr_data")
                .or_else(|| val.get("qrData"))
                .or_else(|| val.get("QRData"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let message = val
                .get("message")
                .or_else(|| val.get("Message"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            Ok(FbrApiResponse {
                status: status_str,
                irn,
                qr_data,
                message,
            })
        }
        Err(_) => Ok(FbrApiResponse {
            status: "unknown".to_string(),
            irn: None,
            qr_data: None,
            message: Some(body),
        }),
    }
}

/// Mark a queue item as failed with exponential backoff, or mark dead.
async fn mark_queue_failed(
    pool: &SqlitePool,
    queue_id: &str,
    _company_id: &str,
    invoice_id: &str,
    item: &FbrQueueItem,
    error: &str,
) -> Result<(), String> {
    let new_attempt = item.attempt_count + 1;

    if new_attempt >= item.max_attempts {
        sqlx::query(
            "UPDATE fbr_submission_queue SET status = 'dead', attempt_count = ?, last_error = ? WHERE id = ?",
        )
        .bind(new_attempt)
        .bind(error)
        .bind(queue_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Queue update error: {e}"))?;

        sqlx::query(
            "UPDATE invoices SET fbr_status = 'dead', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(invoice_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Invoice update error: {e}"))?;
    } else {
        let backoff_seconds: i64 = match new_attempt {
            1 => 0,
            2 => 120,
            3 => 600,
            4 => 1800,
            _ => 7200,
        };

        let scheduled_at = chrono::Utc::now()
            .checked_add_signed(chrono::Duration::seconds(backoff_seconds))
            .unwrap_or_else(chrono::Utc::now)
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();

        sqlx::query(
            "UPDATE fbr_submission_queue \
             SET status = 'failed', attempt_count = ?, scheduled_at = ?, last_error = ? \
             WHERE id = ?",
        )
        .bind(new_attempt)
        .bind(&scheduled_at)
        .bind(error)
        .bind(queue_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Queue update error: {e}"))?;
    }

    Ok(())
}

// ==========================================
// QUEUE PROCESSOR
// ==========================================

/// Process queued FBR submissions. Returns number of items processed.
pub async fn process_fbr_queue(pool: &SqlitePool) -> Result<u32, String> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let items: Vec<FbrQueueItem> = sqlx::query_as::<_, FbrQueueItem>(
        "SELECT * FROM fbr_submission_queue \
         WHERE status IN ('queued', 'failed') AND scheduled_at <= ? \
         ORDER BY scheduled_at ASC LIMIT 10",
    )
    .bind(&now)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Queue fetch error: {e}"))?;

    let mut processed: u32 = 0;

    for item in items {
        sqlx::query(
            "UPDATE fbr_submission_queue SET status = 'submitting', last_attempted_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&item.id)
        .execute(pool)
        .await
        .map_err(|e| format!("Queue update error: {e}"))?;

        let config: Option<(String, String, Option<String>, bool)> = sqlx::query_as(
            "SELECT environment, sandbox_url, pral_token, is_active FROM fbr_config WHERE company_id = ?",
        )
        .bind(&item.company_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("FBR config lookup error: {e}"))?;

        let (env_type, api_url, token, is_active) = match config {
            Some(c) => c,
            None => {
                mark_queue_failed(pool, &item.id, &item.company_id, &item.invoice_id, &item, "No FBR configuration found").await?;
                processed += 1;
                continue;
            }
        };

        if !is_active {
            mark_queue_failed(pool, &item.id, &item.company_id, &item.invoice_id, &item, "FBR integration is not active").await?;
            processed += 1;
            continue;
        }

        let _ = env_type;
        let result = submit_to_fbr(&api_url, &item.payload, &token).await;

        match result {
            Ok(response) => {
                let success = response.status == "valid"
                    || response.status == "Valid"
                    || response.status == "success";
                if success {
                    sqlx::query(
                        "UPDATE fbr_submission_queue \
                         SET status = 'validated', irn = ?, qr_data = ?, last_error = NULL WHERE id = ?",
                    )
                    .bind(&response.irn)
                    .bind(&response.qr_data)
                    .bind(&item.id)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Queue update error: {e}"))?;

                    sqlx::query(
                        "UPDATE invoices \
                         SET irn = ?, fbr_status = 'validated', fbr_invoice_number = ?, \
                             updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    )
                    .bind(&response.irn)
                    .bind(&response.irn)
                    .bind(&item.invoice_id)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Invoice update error: {e}"))?;
                } else {
                    let msg = response.message.unwrap_or_else(|| "Unknown FBR error".to_string());
                    mark_queue_failed(pool, &item.id, &item.company_id, &item.invoice_id, &item, &msg).await?;
                }
            }
            Err(err) => {
                mark_queue_failed(pool, &item.id, &item.company_id, &item.invoice_id, &item, &err).await?;
            }
        }

        processed += 1;
    }

    Ok(processed)
}

/// Build FBR-compliant QR content: {IRN}|{InvoiceDate}|{STRN}|{TotalBillAmount}
pub fn fbr_qr_content(irn: &str, invoice_date: &str, strn: &str, total_bill: f64) -> String {
    format!("{irn}|{invoice_date}|{strn}|{total_bill:.2}")
}

// ==========================================
// TAURI COMMANDS
// ==========================================

/// Get FBR configuration for the current company.
#[tauri::command]
pub async fn get_fbr_config(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Option<FbrConfigRow>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let config = sqlx::query_as::<_, FbrConfigRow>(
        "SELECT * FROM fbr_config WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(config)
}

/// Save (create or update) FBR configuration for the current company.
#[tauri::command]
pub async fn save_fbr_config(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    environment: String,
    is_active: bool,
    pral_token: Option<String>,
) -> Result<FbrConfigRow, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "settings", "edit").await?;

    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    if environment != "sandbox" && environment != "production" {
        return Err("Environment must be 'sandbox' or 'production'".to_string());
    }

    let sandbox_url = "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata".to_string();
    let production_url = "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata".to_string();

    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM fbr_config WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let id = match existing {
        Some(id) => {
            sqlx::query(
                "UPDATE fbr_config \
                 SET environment = ?, is_active = ?, pral_token = ?, updated_at = CURRENT_TIMESTAMP \
                 WHERE company_id = ?",
            )
            .bind(&environment)
            .bind(is_active)
            .bind(&pral_token)
            .bind(&company_id)
            .execute(pool.inner())
            .await
            .map_err(|e| format!("Database error: {e}"))?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO fbr_config (id, company_id, environment, sandbox_url, production_url, is_active, pral_token) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&company_id)
            .bind(&environment)
            .bind(&sandbox_url)
            .bind(&production_url)
            .bind(is_active)
            .bind(&pral_token)
            .execute(pool.inner())
            .await
            .map_err(|e| format!("Database error: {e}"))?;
            id
        }
    };

    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "fbr_config",
        Some(&id),
        &format!("Updated FBR config (environment: {environment}, active: {is_active})"),
    )
    .await;

    sqlx::query_as::<_, FbrConfigRow>("SELECT * FROM fbr_config WHERE company_id = ?")
        .bind(&company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))
}

/// Test the FBR sandbox connection by submitting a test payload.
#[tauri::command]
pub async fn test_fbr_connection(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<FbrConnectionTestResult, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "settings", "edit").await?;

    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let config = sqlx::query_as::<_, FbrConfigRow>(
        "SELECT * FROM fbr_config WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("FBR configuration not found. Save configuration first.")?;

    let url = if config.environment == "production" {
        &config.production_url
    } else {
        &config.sandbox_url
    };

    let test_payload = serde_json::json!({
        "InvoiceHeader": {
            "STRN": "",
            "NTN": "0000000",
            "BusinessName": "TEST CONNECTION",
            "InvoiceDate": chrono::Utc::now().format("%Y-%m-%d").to_string(),
            "InvoiceRefNo": "TEST-000",
            "InvoiceType": "SI",
            "Province": "Punjab",
            "BuyerNTN": "",
            "BuyerCNIC": "",
            "BuyerName": "TEST BUYER",
            "TotalBillAmount": 0.0,
            "TotalSaleValue": 0.0,
            "TotalTaxCharged": 0.0,
            "TotalQuantity": 0
        },
        "InvoiceItems": []
    });

    let timestamp = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let result = submit_to_fbr(url, &test_payload.to_string(), &config.pral_token).await;

    let test_result = match result {
        Ok(response) => {
            let success = response.status == "valid"
                || response.status == "Valid"
                || response.status == "success"
                || response.status == "unknown";
            FbrConnectionTestResult {
                success,
                message: response
                    .message
                    .unwrap_or_else(|| format!("Status: {}", response.status)),
                timestamp,
            }
        }
        Err(e) => FbrConnectionTestResult {
            success: false,
            message: e,
            timestamp,
        },
    };

    let result_json = serde_json::to_string(&test_result).unwrap_or_default();
    sqlx::query(
        "UPDATE fbr_config SET last_tested_at = ?, last_test_result = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?",
    )
    .bind(&test_result.timestamp)
    .bind(&result_json)
    .bind(&company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(test_result)
}

/// Get FBR submission queue status for the current company.
#[tauri::command]
pub async fn get_fbr_queue_status(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<FbrQueueStatus, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT \
            COUNT(*) as total, \
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued, \
            SUM(CASE WHEN status = 'submitting' THEN 1 ELSE 0 END) as submitting, \
            SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) as validated, \
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed, \
            SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) as dead \
        FROM fbr_submission_queue WHERE company_id = ?",
    )
    .bind(&company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let raw_items: Vec<FbrQueueItem> = sqlx::query_as::<_, FbrQueueItem>(
        "SELECT * FROM fbr_submission_queue WHERE company_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let items: Vec<PublicFbrQueueItem> = raw_items
        .into_iter()
        .map(|i| PublicFbrQueueItem {
            id: i.id,
            invoice_id: i.invoice_id,
            invoice_type: i.invoice_type,
            status: i.status,
            attempt_count: i.attempt_count,
            max_attempts: i.max_attempts,
            scheduled_at: i.scheduled_at,
            last_attempted_at: i.last_attempted_at,
            last_error: i.last_error,
            irn: i.irn,
            created_at: i.created_at,
        })
        .collect();

    Ok(FbrQueueStatus {
        total: counts.0,
        queued: counts.1,
        submitting: counts.2,
        validated: counts.3,
        failed: counts.4,
        dead: counts.5,
        items,
    })
}

/// Manually retry a failed/dead FBR submission.
#[tauri::command]
pub async fn retry_fbr_submission(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    queue_id: String,
) -> Result<FbrQueueItem, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "invoices", "finalize").await?;

    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let item = sqlx::query_as::<_, FbrQueueItem>(
        "SELECT * FROM fbr_submission_queue WHERE id = ? AND company_id = ?",
    )
    .bind(&queue_id)
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Queue item not found")?;

    if item.status != "failed" && item.status != "dead" {
        return Err("Can only retry failed or dead submissions".to_string());
    }

    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    sqlx::query(
        "UPDATE fbr_submission_queue \
         SET status = 'queued', attempt_count = 0, scheduled_at = ?, last_error = NULL \
         WHERE id = ?",
    )
    .bind(&now)
    .bind(&queue_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    sqlx::query(
        "UPDATE invoices SET fbr_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(&item.invoice_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    log_audit(
        pool.inner(),
        &company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "retry",
        "fbr_submission",
        Some(&queue_id),
        &format!("Retried FBR submission for invoice {}", item.invoice_id),
    )
    .await;

    sqlx::query_as::<_, FbrQueueItem>("SELECT * FROM fbr_submission_queue WHERE id = ?")
        .bind(&queue_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))
}

/// Get FBR status for a specific invoice.
#[tauri::command]
pub async fn get_invoice_fbr_status(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<InvoiceFbrStatus, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .ok_or_else(|| "User is not assigned to a company".to_string())?;

    let invoice: (Option<String>, String, Option<String>) = sqlx::query_as(
        "SELECT irn, fbr_status, fbr_invoice_number FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(&company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Invoice not found")?;

    let queue_item: Option<FbrQueueItem> = sqlx::query_as::<_, FbrQueueItem>(
        "SELECT * FROM fbr_submission_queue WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&invoice_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let public_queue = queue_item.map(|i| PublicFbrQueueItem {
        id: i.id,
        invoice_id: i.invoice_id,
        invoice_type: i.invoice_type,
        status: i.status,
        attempt_count: i.attempt_count,
        max_attempts: i.max_attempts,
        scheduled_at: i.scheduled_at,
        last_attempted_at: i.last_attempted_at,
        last_error: i.last_error,
        irn: i.irn,
        created_at: i.created_at,
    });

    Ok(InvoiceFbrStatus {
        fbr_status: invoice.1,
        irn: invoice.0,
        fbr_invoice_number: invoice.2,
        queue_item: public_queue,
    })
}

/// Process FBR queue on demand (called from UI button).
#[tauri::command]
pub async fn process_fbr_queue_now(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<u32, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "settings", "edit").await?;

    process_fbr_queue(pool.inner()).await
}

// ==========================================
// ENQUEUE HELPER (called from finalize_invoice)
// ==========================================

/// Enqueue an invoice for FBR submission (outbox pattern).
pub async fn enqueue_fbr_submission(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    pool: &SqlitePool,
    company_id: &str,
    invoice_id: &str,
) -> Result<(), String> {
    let config: Option<bool> = sqlx::query_scalar(
        "SELECT is_active FROM fbr_config WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("FBR config lookup error: {e}"))?;

    let is_active = config.unwrap_or(false);
    if !is_active {
        return Ok(());
    }

    let payload = build_fbr_payload(pool, company_id, invoice_id, "SI").await?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    sqlx::query(
        "INSERT INTO fbr_submission_queue (id, company_id, invoice_id, invoice_type, payload, status, scheduled_at) \
         VALUES (?, ?, ?, 'SI', ?, 'queued', ?)",
    )
    .bind(&id)
    .bind(company_id)
    .bind(invoice_id)
    .bind(&payload)
    .bind(&now)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Queue insert error: {e}"))?;

    sqlx::query(
        "UPDATE invoices SET fbr_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(invoice_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Invoice update error: {e}"))?;

    Ok(())
}

// ==========================================
// CREDIT NOTE / DEBIT NOTE
// ==========================================

/// Create a credit note referencing an original invoice's IRN (spec section 17.6).
#[tauri::command]
pub async fn create_credit_note(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    original_invoice_id: String,
    reason: String,
    credit_amount: i64,
    items_json: Option<String>,
) -> Result<PublicInvoice, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "invoices", "finalize").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let orig: (String, String, String, Option<String>, i64, String) = sqlx::query_as(
        "SELECT id, invoice_number, invoice_date, irn, grand_total, customer_id \
         FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&original_invoice_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Original invoice not found")?;

    let orig_irn = orig.3;
    let orig_total = orig.4;
    let customer_id = orig.5;

    if credit_amount <= 0 {
        return Err("Credit amount must be positive".to_string());
    }
    if credit_amount > orig_total {
        return Err("Credit amount cannot exceed original invoice total".to_string());
    }

    let orig_date = chrono::NaiveDate::parse_from_str(&orig.2, "%Y-%m-%d")
        .map_err(|e| format!("Invalid original invoice date: {e}"))?;
    let today = chrono::Utc::now().date_naive();
    let days_diff = (today - orig_date).num_days();
    if days_diff > 180 {
        return Err(format!(
            "Credit note window exceeded. Original invoice is {days_diff} days old (limit: 180 days)"
        ));
    }

    let settings = sqlx::query_as::<_, (String, i64)>(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .unwrap_or(("INV-CN".to_string(), 1));

    let invoice_number = format!("{}-{:05}", settings.0, settings.1);

    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1 WHERE company_id = ?",
    )
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let cn_id = Uuid::new_v4().to_string();
    let today_str = today.format("%Y-%m-%d").to_string();

    sqlx::query(
        "INSERT INTO invoices (id, company_id, invoice_number, invoice_date, due_date, \
         customer_id, status, subtotal, tax_total, discount_total, \
         grand_total, amount_paid, balance_due, created_by, irn, fbr_status) \
         VALUES (?, ?, ?, ?, ?, ?, 'finalized', ?, 0, 0, ?, 0, ?, ?, ?, 'pending')",
    )
    .bind(&cn_id)
    .bind(company_id)
    .bind(&invoice_number)
    .bind(&today_str)
    .bind(&today_str)
    .bind(&customer_id)
    .bind(-credit_amount)
    .bind(-credit_amount)
    .bind(&current_user.id)
    .bind(&orig_irn)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if let Some(items_str) = items_json {
        if let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(&items_str) {
            for item in items {
                let item_id = Uuid::new_v4().to_string();
                let product_id = item["product_id"].as_str().unwrap_or("");
                let product_name = item["product_name"].as_str().unwrap_or("Credit Item");
                let product_sku = item["product_sku"].as_str().unwrap_or("");
                let quantity = item["quantity"].as_i64().unwrap_or(1).abs();
                let unit_price = item["unit_price"].as_i64().unwrap_or(0);
                let line_total = quantity * unit_price;

                sqlx::query(
                    "INSERT INTO invoice_items (id, invoice_id, company_id, product_id, product_name, product_sku, \
                     quantity, unit_price, tax_rate, tax_amount, discount_rate, discount_amount, discount_type, line_total) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'percent', ?)",
                )
                .bind(&item_id)
                .bind(&cn_id)
                .bind(company_id)
                .bind(product_id)
                .bind(product_name)
                .bind(product_sku)
                .bind(-quantity)
                .bind(unit_price)
                .bind(-line_total)
                .execute(pool.inner())
                .await
                .map_err(|e| format!("Database error: {e}"))?;
            }
        }
    }

    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "credit_note",
        Some(&cn_id),
        &format!(
            "Created credit note {invoice_number} for invoice {original_invoice_id} (amount: {credit_amount} paisa, reason: {reason})"
        ),
    )
    .await;

    sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&cn_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))
}

/// Create a debit note referencing an original invoice's IRN (spec section 17.6).
#[tauri::command]
pub async fn create_debit_note(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    original_invoice_id: String,
    reason: String,
    debit_amount: i64,
    items_json: Option<String>,
) -> Result<PublicInvoice, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &current_user.role, "invoices", "finalize").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let orig: (String, String, String, Option<String>, i64, String) = sqlx::query_as(
        "SELECT id, invoice_number, invoice_date, irn, grand_total, customer_id \
         FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&original_invoice_id)
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .ok_or("Original invoice not found")?;

    let orig_irn = orig.3;
    let customer_id = orig.5;

    if debit_amount <= 0 {
        return Err("Debit amount must be positive".to_string());
    }

    let orig_date = chrono::NaiveDate::parse_from_str(&orig.2, "%Y-%m-%d")
        .map_err(|e| format!("Invalid original invoice date: {e}"))?;
    let today = chrono::Utc::now().date_naive();
    let days_diff = (today - orig_date).num_days();
    if days_diff > 180 {
        return Err(format!(
            "Debit note window exceeded. Original invoice is {days_diff} days old (limit: 180 days)"
        ));
    }

    let settings = sqlx::query_as::<_, (String, i64)>(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?
    .unwrap_or(("INV-DN".to_string(), 1));

    let invoice_number = format!("{}-{:05}", settings.0, settings.1);

    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1 WHERE company_id = ?",
    )
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let dn_id = Uuid::new_v4().to_string();
    let today_str = today.format("%Y-%m-%d").to_string();

    sqlx::query(
        "INSERT INTO invoices (id, company_id, invoice_number, invoice_date, due_date, \
         customer_id, status, subtotal, tax_total, discount_total, \
         grand_total, amount_paid, balance_due, created_by, irn, fbr_status) \
         VALUES (?, ?, ?, ?, ?, ?, 'finalized', ?, 0, 0, ?, 0, ?, ?, ?, 'pending')",
    )
    .bind(&dn_id)
    .bind(company_id)
    .bind(&invoice_number)
    .bind(&today_str)
    .bind(&today_str)
    .bind(&customer_id)
    .bind(debit_amount)
    .bind(debit_amount)
    .bind(&current_user.id)
    .bind(&orig_irn)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if let Some(items_str) = items_json {
        if let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(&items_str) {
            for item in items {
                let item_id = Uuid::new_v4().to_string();
                let product_id = item["product_id"].as_str().unwrap_or("");
                let product_name = item["product_name"].as_str().unwrap_or("Debit Item");
                let product_sku = item["product_sku"].as_str().unwrap_or("");
                let quantity = item["quantity"].as_i64().unwrap_or(1).abs();
                let unit_price = item["unit_price"].as_i64().unwrap_or(0);
                let line_total = quantity * unit_price;

                sqlx::query(
                    "INSERT INTO invoice_items (id, invoice_id, company_id, product_id, product_name, product_sku, \
                     quantity, unit_price, tax_rate, tax_amount, discount_rate, discount_amount, discount_type, line_total) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'percent', ?)",
                )
                .bind(&item_id)
                .bind(&dn_id)
                .bind(company_id)
                .bind(product_id)
                .bind(product_name)
                .bind(product_sku)
                .bind(quantity)
                .bind(unit_price)
                .bind(line_total)
                .execute(pool.inner())
                .await
                .map_err(|e| format!("Database error: {e}"))?;
            }
        }
    }

    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "debit_note",
        Some(&dn_id),
        &format!(
            "Created debit note {invoice_number} for invoice {original_invoice_id} (amount: {debit_amount} paisa, reason: {reason})"
        ),
    )
    .await;

    sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&dn_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))
}
