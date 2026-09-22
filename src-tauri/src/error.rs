// ==========================================
// UNIFIED ERROR SCHEMA (§18.6)
// ==========================================
// Every Tauri command returns Result<T, AppError>. The frontend receives
// structured JSON: { code, message, details?, timestamp }.

use chrono::Utc;
use serde::Serialize;
use std::fmt;

/// Machine-readable error code. The frontend maps these to user-friendly
/// messages and can branch on them (e.g. redirect on UNAUTHORIZED).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Client errors (4xx equivalent)
    Validation,
    NotFound,
    Unauthorized,
    Forbidden,
    Conflict,
    RateLimited,

    // Server errors (5xx equivalent)
    Database,
    Internal,
}

/// Structured error returned by all Tauri commands.
///
/// Serialized to IPC as:
/// ```json
/// {
///   "code": "NOT_FOUND",
///   "message": "Invoice not found",
///   "details": [{ "field": "invoice_id", "issue": "No row with this ID" }],
///   "timestamp": "2026-08-20T12:00:00Z"
/// }
/// ```
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<ErrorDetail>,
    pub timestamp: String,
}

/// Optional field-level detail for validation errors.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorDetail {
    pub field: String,
    pub issue: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: Vec::new(),
            timestamp: Utc::now().to_rfc3339(),
        }
    }

    pub fn with_detail(mut self, field: impl Into<String>, issue: impl Into<String>) -> Self {
        self.details.push(ErrorDetail {
            field: field.into(),
            issue: issue.into(),
        });
        self
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unauthorized, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Forbidden, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Database, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::RateLimited, message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for AppError {}

/// Allow `assert_eq!(err, "message text")` in tests.
/// Compares against the error's `.message` field.
impl PartialEq<&str> for AppError {
    fn eq(&self, other: &&str) -> bool {
        self.message == *other
    }
}

impl AppError {
    /// Check if the error message contains a substring (test helper).
    pub fn message_contains(&self, needle: &str) -> bool {
        self.message.contains(needle)
    }

    /// Alias for backwards-compatible test assertions: `err.contains("text")`
    pub fn contains(&self, needle: &str) -> bool {
        self.message.contains(needle)
    }
}

// ── Conversions ──────────────────────────────────────────────

/// Bare string → INTERNAL (backward-compat for unmigrated commands).
impl From<String> for AppError {
    fn from(msg: String) -> Self {
        Self::internal(msg)
    }
}

impl From<&str> for AppError {
    fn from(msg: &str) -> Self {
        Self::internal(msg)
    }
}

/// sqlx database error → DATABASE with the sqlx message.
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => Self::not_found("Record not found"),
            sqlx::Error::Database(db_err) => {
                let msg = db_err.message();
                if msg.contains("UNIQUE constraint failed") {
                    Self::conflict("A record with this value already exists")
                } else if msg.contains("FOREIGN KEY constraint failed") {
                    Self::conflict("Referenced record does not exist")
                } else {
                    Self::database(msg)
                }
            }
            _ => Self::database(e.to_string()),
        }
    }
}

/// sqlx::Error::RowNotFound helper — for cases where we want a custom
/// not-found message instead of the generic "Record not found".
impl AppError {
    pub fn from_row_not_found(entity: &str) -> Self {
        Self::not_found(format!("{entity} not found"))
    }
}

// ── Error code as string ─────────────────────────────────────

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::Validation => "VALIDATION",
            ErrorCode::NotFound => "NOT_FOUND",
            ErrorCode::Unauthorized => "UNAUTHORIZED",
            ErrorCode::Forbidden => "FORBIDDEN",
            ErrorCode::Conflict => "CONFLICT",
            ErrorCode::RateLimited => "RATE_LIMITED",
            ErrorCode::Database => "DATABASE",
            ErrorCode::Internal => "INTERNAL",
        }
    }
}

// ── Tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_structured_json() {
        let err = AppError::not_found("Invoice #42 not found")
            .with_detail("invoice_id", "No row with this ID");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "NOT_FOUND");
        assert_eq!(json["message"], "Invoice #42 not found");
        assert!(json["timestamp"].is_string());
        let details = json["details"].as_array().unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0]["field"], "invoice_id");
    }

    #[test]
    fn error_details_omitted_when_empty() {
        let err = AppError::internal("oops");
        let json = serde_json::to_value(&err).unwrap();
        assert!(json.get("details").is_none());
    }

    #[test]
    fn string_converts_to_internal_error() {
        let err: AppError = "something broke".into();
        assert_eq!(err.code, ErrorCode::Internal);
        assert_eq!(err.message, "something broke");
    }

    #[test]
    fn sqlx_row_not_found_maps_to_not_found() {
        let err: AppError = sqlx::Error::RowNotFound.into();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn from_row_not_found_custom_message() {
        let err = AppError::from_row_not_found("Customer");
        assert_eq!(err.code, ErrorCode::NotFound);
        assert_eq!(err.message, "Customer not found");
    }

    #[test]
    fn display_format_includes_code() {
        let err = AppError::validation("bad input");
        assert_eq!(err.to_string(), "[VALIDATION] bad input");
    }

    #[test]
    fn error_codes_are_screaming_snake_case() {
        let json = serde_json::to_value(&AppError::new(ErrorCode::NotFound, "x")).unwrap();
        assert_eq!(json["code"], "NOT_FOUND");
    }
}
