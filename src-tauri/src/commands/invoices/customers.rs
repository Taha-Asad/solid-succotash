use sqlx::SqlitePool;
use tauri::State;

use crate::commands::audit::log_audit;
use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{check_permission, soft_delete};

use super::math::clean_optional;
use super::types::PublicCustomer;

#[tauri::command]
pub async fn list_customers(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicCustomer>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let customers = sqlx::query_as::<_, PublicCustomer>(
        r#"
        SELECT id, company_id, name, email, phone, address,
               cnic, ntn, strn, buyer_type, is_active,
               created_at, updated_at, version
        FROM customers
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(customers)
}

#[tauri::command]
pub async fn create_customer(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    email: String,
    phone: String,
    address: String,
    cnic: String,
    ntn: String,
    strn: String,
    buyer_type: String,
) -> Result<PublicCustomer, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Customer name cannot be empty".to_string()));
    }

    let valid_buyer_types = ["registered", "unregistered"];
    if !valid_buyer_types.contains(&buyer_type.as_str()) {
        return Err(AppError::internal("Buyer type must be 'registered' or 'unregistered'".to_string()));
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO customers
            (id, company_id, name, email, phone, address,
             cnic, ntn, strn, buyer_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&cnic))
    .bind(clean_optional(&ntn))
    .bind(clean_optional(&strn))
    .bind(&buyer_type)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let customer = sqlx::query_as::<_, PublicCustomer>("SELECT * FROM customers WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "customer",
        Some(&id),
        &format!("Created customer '{}'", trimmed_name),
    )
    .await;

    Ok(customer)
}

#[tauri::command]
pub async fn delete_customer(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    customer_id: String,
) -> Result<(), AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows = soft_delete(pool.inner(), "customers", &customer_id, company_id).await?;

    if rows == 0 {
        return Err(AppError::internal("Customer not found".to_string()));
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "customer",
        Some(&customer_id),
        "Deleted customer",
    )
    .await;

    Ok(())
}
