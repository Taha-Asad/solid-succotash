// ==========================================
// MULTI-CURRENCY SUPPORT
// ==========================================
//
// Handles currency configuration, exchange rate
// fetching/caching, and formatting utilities.

use crate::commands::auth::{require_current_user, SessionState};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyConfig {
    pub code: String,
    pub symbol: String,
    pub name: String,
    pub decimal_places: i32,
    pub thousands_sep: String,
    pub decimal_sep: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRate {
    pub base_currency: String,
    pub target_currency: String,
    pub rate: f64,
    pub source: String,
    pub fetched_at: String,
}

// ==========================================
// HELPER FUNCTIONS (used by other modules)
// ==========================================

/// Fetches the currency config for a given code from the database.
pub async fn get_currency_config(
    pool: &SqlitePool,
    code: &str,
) -> Result<CurrencyConfig, String> {
    let config = sqlx::query_as::<_, CurrencyConfig>(
        "SELECT code, symbol, name, decimal_places, thousands_sep, decimal_sep FROM currency_config WHERE code = ?",
    )
    .bind(code)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Currency lookup error: {e}"))?
    .unwrap_or_else(|| CurrencyConfig {
        code: code.to_string(),
        symbol: code.to_string(),
        name: code.to_string(),
        decimal_places: 2,
        thousands_sep: ",".to_string(),
        decimal_sep: ".".to_string(),
    });
    Ok(config)
}

/// Formats a paisa amount (smallest currency unit) using the currency config.
/// E.g., format_currency(123456, USD config) -> "1,234.56"
#[allow(dead_code)]
pub fn format_currency(paisa: i64, config: &CurrencyConfig) -> String {
    let value = paisa as f64 / 10.0_f64.powi(config.decimal_places);
    format_with_config(value, config)
}

/// Formats a raw f64 value using the currency config (no division by 100).
#[allow(dead_code)]
pub fn format_raw_amount(amount: f64, config: &CurrencyConfig) -> String {
    format_with_config(amount, config)
}

#[allow(dead_code)]
fn format_with_config(value: f64, config: &CurrencyConfig) -> String {
    let precision = config.decimal_places.max(0) as usize;
    let abs_val = value.abs();
    let sign = if value < 0. { "-" } else { "" };

    // Format with fixed precision first
    let formatted = format!("{:.prec$}", abs_val, prec = precision);

    // Split integer and decimal parts
    let parts: Vec<&str> = formatted.split('.').collect();
    let int_part = parts[0];
    let dec_part = if parts.len() > 1 { parts[1] } else { "" };

    // Add thousands separators
    let mut result = String::new();
    for (i, ch) in int_part.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push_str(&config.thousands_sep);
        }
        result.push(ch);
    }
    let int_formatted: String = result.chars().rev().collect();

    if precision > 0 {
        format!("{}{}{}{}", sign, int_formatted, config.decimal_sep, dec_part)
    } else {
        format!("{}{}", sign, int_formatted)
    }
}

/// Formats a paisa amount with currency symbol.
/// E.g., format_currency_with_symbol(123456, USD config) -> "$1,234.56"
#[allow(dead_code)]
pub fn format_currency_with_symbol(paisa: i64, config: &CurrencyConfig) -> String {
    let formatted = format_currency(paisa, config);
    format!("{} {}", config.symbol, formatted)
}

/// Converts a display string (e.g., "1,234.56") back to paisa/smallest unit.
#[allow(dead_code)]
pub fn parse_display_to_paisa(display: &str, config: &CurrencyConfig) -> Result<i64, String> {
    // Remove currency symbols and whitespace
    let cleaned: String = display
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == config.decimal_sep.chars().next().unwrap_or('.') || *c == '-' || *c == config.thousands_sep.chars().next().unwrap_or(','))
        .collect();

    // Remove thousands separators
    let without_thousands: String = cleaned.split(config.thousands_sep.as_str()).collect();

    // Replace decimal separator with dot
    let normalized = without_thousands.replace(config.decimal_sep.as_str(), ".");

    let value: f64 = normalized
        .parse()
        .map_err(|_| format!("Invalid amount: {}", display))?;

    let multiplier = 10.0_f64.powi(config.decimal_places);
    Ok((value * multiplier).round() as i64)
}

/// Rounds a paisa amount to the nearest whole currency unit.
#[allow(dead_code)]
pub fn round_to_currency(paisa: i64, decimal_places: i32) -> i64 {
    if decimal_places >= 2 {
        // Round to nearest 100 paisa (whole unit)
        let rem = paisa.rem_euclid(100);
        if rem >= 50 {
            paisa - rem + 100
        } else {
            paisa - rem
        }
    } else if decimal_places == 0 {
        // JPY-style: no decimals, amounts are already in whole units
        paisa
    } else {
        paisa
    }
}

/// Converts an amount from one currency to another using the given rate.
/// rate = how many units of `to_currency` per 1 unit of `from_currency`.
pub fn convert_amount(amount: i64, rate: f64, decimal_places: i32) -> i64 {
    let multiplier = 10.0_f64.powi(decimal_places);
    let value = (amount as f64 / multiplier) * rate * multiplier;
    value.round() as i64
}

// ==========================================
// TAURI COMMANDS
// ==========================================

/// Returns all available currencies.
#[tauri::command]
pub async fn get_all_currencies(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<CurrencyConfig>, String> {
    let _user = require_current_user(pool.inner(), session.inner()).await?;

    let currencies = sqlx::query_as::<_, CurrencyConfig>(
        "SELECT code, symbol, name, decimal_places, thousands_sep, decimal_sep FROM currency_config ORDER BY code",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Currency list error: {e}"))?;

    Ok(currencies)
}

/// Returns the currency config for the current company's currency.
#[tauri::command]
pub async fn get_company_currency(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<CurrencyConfig, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let code: String = sqlx::query_scalar("SELECT currency_code FROM companies WHERE id = ?")
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Company lookup error: {e}"))?;

    get_currency_config(pool.inner(), &code).await
}

/// Fetches exchange rates from the free exchangerate-api.com API and caches them.
/// If the API is unavailable, falls back to the last cached rate.
#[tauri::command]
pub async fn fetch_exchange_rates(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    base_currency: String,
    target_currencies: Vec<String>,
) -> Result<Vec<ExchangeRate>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let _company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if target_currencies.is_empty() {
        return Ok(vec![]);
    }

    // Build the API URL
    let url = format!(
        "https://api.exchangerate-api.com/v4/latest/{}",
        base_currency.to_uppercase()
    );

    // Try to fetch from API
    let api_result = fetch_rates_from_api(&url).await;

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    match api_result {
        Ok(api_rates) => {
            let mut rates = Vec::new();
            for target in &target_currencies {
                let target_upper = target.to_uppercase();
                if let Some(rate) = api_rates.get(&target_upper) {
                    // Cache in database
                    sqlx::query(
                        "INSERT INTO exchange_rates (base_currency, target_currency, rate, source, fetched_at) VALUES (?, ?, ?, 'api', ?)",
                    )
                    .bind(&base_currency)
                    .bind(&target_upper)
                    .bind(rate)
                    .bind(&now)
                    .execute(pool.inner())
                    .await
                    .ok(); // Ignore cache errors

                    rates.push(ExchangeRate {
                        base_currency: base_currency.clone(),
                        target_currency: target_upper,
                        rate: *rate,
                        source: "api".to_string(),
                        fetched_at: now.clone(),
                    });
                }
            }
            Ok(rates)
        }
        Err(_) => {
            // Fallback to last cached rates
            get_cached_rates(pool.inner(), &base_currency, &target_currencies).await
        }
    }
}

/// Gets the latest cached exchange rate for a currency pair.
#[tauri::command]
pub async fn get_exchange_rate(
    pool: State<'_, SqlitePool>,
    _session: State<'_, SessionState>,
    base_currency: String,
    target_currency: String,
) -> Result<ExchangeRate, String> {
    let rates = get_cached_rates(pool.inner(), &base_currency, &[target_currency]).await?;
    rates.into_iter().next().ok_or_else(|| "No exchange rate found. Please fetch rates first.".to_string())
}

/// Gets exchange rate history for display (last N days).
#[tauri::command]
pub async fn get_exchange_rate_history(
    pool: State<'_, SqlitePool>,
    _session: State<'_, SessionState>,
    base_currency: String,
    target_currency: String,
    days: Option<i64>,
) -> Result<Vec<ExchangeRate>, String> {
    let limit = days.unwrap_or(30).clamp(1, 365);

    let rates = sqlx::query_as::<_, ExchangeRate>(
        r#"
        SELECT base_currency, target_currency, rate, source, fetched_at
        FROM exchange_rates
        WHERE base_currency = ? AND target_currency = ?
        ORDER BY fetched_at DESC
        LIMIT ?
        "#,
    )
    .bind(&base_currency)
    .bind(&target_currency)
    .bind(limit)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Rate history error: {e}"))?;

    Ok(rates)
}

// ==========================================
// INTERNAL HELPERS
// ==========================================

/// Fetches rates from the exchangerate-api.com API.
async fn fetch_rates_from_api(url: &str) -> Result<std::collections::HashMap<String, f64>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(url)
        .header("User-Agent", "IjazAndCompany-ERP/1.0")
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct ApiResponse {
        rates: std::collections::HashMap<String, f64>,
    }

    let body: ApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("API response parse error: {e}"))?;

    Ok(body.rates)
}

/// Gets the most recently cached rates for the given targets.
async fn get_cached_rates(
    pool: &SqlitePool,
    base_currency: &str,
    target_currencies: &[String],
) -> Result<Vec<ExchangeRate>, String> {
    let mut rates = Vec::new();
    for target in target_currencies {
        let rate = sqlx::query_as::<_, ExchangeRate>(
            r#"
            SELECT base_currency, target_currency, rate, source, fetched_at
            FROM exchange_rates
            WHERE base_currency = ? AND target_currency = ?
            ORDER BY fetched_at DESC
            LIMIT 1
            "#,
        )
        .bind(base_currency)
        .bind(target)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Rate lookup error: {e}"))?;

        if let Some(r) = rate {
            rates.push(r);
        }
    }
    Ok(rates)
}
