// ==========================================
// INVENTORY COMMANDS
// ==========================================
//
// This file handles all inventory-related Tauri commands:
//   - Categories (CRUD)
//   - Suppliers (CRUD)
//   - Products (CRUD)
//   - Stock adjustments (with audit trail)
//
// Every command:
//   1. Gets the current user from session (authentication)
//   2. Gets the user's company_id (authorization)
//   3. Operates ONLY on that company's data (tenant isolation)
//
// Prices are stored as INTEGERS (cents/paisa) to avoid
// floating-point rounding errors. The frontend divides by 100
// for display: 1500 → "15.00" PKR.

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{bump_version, check_permission, check_version, soft_delete};
use serde::Serialize;
use sqlx::FromRow;
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// RETURN TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicCategory {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub description: Option<String>,
    pub sku_prefix: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicSupplier {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub contact_person: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub tax_number: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicProduct {
    pub id: String,
    pub company_id: String,
    pub sku: String,
    pub name: String,
    pub category_id: Option<String>,
    pub supplier_id: Option<String>,
    pub cost_price: i64,
    pub sell_price: i64,
    pub tax_rate: i64,
    pub quantity_in_stock: i64,
    pub unit: String,
    pub custom_fields: Option<String>, // JSON blob for company-specific fields
    /// Expiry date of the soonest-expiring live batch (if any).
    /// None = this product has no expiry batches.
    #[sqlx(default)]
    pub next_expiry_date: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicStockMovement {
    pub id: String,
    pub company_id: String,
    pub product_id: String,
    pub movement_type: String,
    pub quantity: i64,
    pub reference_note: Option<String>,
    pub performed_by: Option<String>,
    pub created_at: String,
}

// ==========================================
// HELPERS
// ==========================================

fn clean_optional(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Maps SQLite insert/update errors for products to friendly messages so
/// users never see a raw constraint string like "NOT NULL constraint failed".
fn map_product_db_error(e: sqlx::Error, sku: &str) -> String {
    let msg = e.to_string();
    if msg.contains("UNIQUE") {
        format!("SKU '{sku}' already exists")
    } else if msg.contains("NOT NULL") {
        "A required field is missing".to_string()
    } else if msg.contains("FOREIGN KEY") {
        "The selected category or supplier no longer exists".to_string()
    } else {
        format!("Database error: {msg}")
    }
}

/// Builds a short, uppercase, alphanumeric SKU prefix from a category name.
/// "Electronics" → "ELEC", "Mobile Phones" → "MOBI".
fn derive_sku_prefix(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let prefix: String = cleaned.chars().take(6).collect();
    if prefix.is_empty() {
        "CAT".to_string()
    } else {
        prefix
    }
}

/// Normalizes a user-supplied SKU prefix: uppercase, alphanumeric only.
/// Falls back to deriving one from the category name when blank.
fn normalize_sku_prefix(input: &str, category_name: &str) -> String {
    let cleaned: String = input
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let prefix: String = cleaned.chars().take(6).collect();
    if prefix.is_empty() {
        derive_sku_prefix(category_name)
    } else {
        prefix
    }
}

/// Builds the next automatic SKU for a company.
/// Uses the category's SKU prefix (or one derived from the product name)
/// and increments the highest existing number: ELEC-001, ELEC-002, ...
async fn generate_sku(
    pool: &SqlitePool,
    company_id: &str,
    cat_id: &Option<String>,
    product_name: &str,
) -> Result<String, String> {
    let prefix = match cat_id {
        Some(cid) => {
            let stored: Option<String> = sqlx::query_scalar(
                "SELECT sku_prefix FROM categories WHERE id = ? AND company_id = ?",
            )
            .bind(cid)
            .bind(company_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Database error: {e}"))?;
            match stored {
                Some(p) if !p.trim().is_empty() => p
                    .trim()
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric())
                    .collect::<String>(),
                _ => derive_sku_prefix(product_name),
            }
        }
        None => derive_sku_prefix(product_name),
    };

    // Highest number already used for this prefix (suffix after "PREFIX-").
    let start: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(CAST(SUBSTR(sku, ?) AS INTEGER)), 0)
        FROM products
        WHERE company_id = ? AND sku LIKE ? || '-%'
        "#,
    )
    .bind((prefix.len() + 2) as i64)
    .bind(company_id)
    .bind(&prefix)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let mut next = start;
    loop {
        next += 1;
        let candidate = format!("{}-{:03}", prefix, next);
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM products WHERE company_id = ? AND sku = ? COLLATE NOCASE",
        )
        .bind(company_id)
        .bind(&candidate)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Database error: {e}"))?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
}

// ==========================================
// CATEGORY COMMANDS
// ==========================================

/// Lists all categories for the current user's company.
#[tauri::command]
pub async fn list_categories(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicCategory>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let categories = sqlx::query_as::<_, PublicCategory>(
        r#"
        SELECT id, company_id, name, description, sku_prefix, is_active,
               created_at, updated_at, version
        FROM categories
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(categories)
}

/// Creates a new category. Owner and admin only.
#[tauri::command]
pub async fn create_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    description: String,
    sku_prefix: String,
) -> Result<PublicCategory, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    let prefix = normalize_sku_prefix(&sku_prefix, &trimmed_name);

    let id = uuid::Uuid::new_v4().to_string();
    let desc = clean_optional(&description);

    sqlx::query(
        r#"
        INSERT INTO categories (id, company_id, name, description, sku_prefix)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(&desc)
    .bind(&prefix)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Category '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    // Fetch and return the created category
    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "category",
        Some(&id),
        &format!("Created category '{}'", trimmed_name),
    )
    .await;

    Ok(category)
}

/// Updates a category's name, description and SKU prefix. Owner and admin only.
#[tauri::command]
pub async fn update_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    expected_version: i64,
    category_id: String,
    name: String,
    description: String,
    sku_prefix: String,
) -> Result<PublicCategory, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Category name cannot be empty".to_string());
    }

    let desc = clean_optional(&description);

    // If the user cleared the prefix, keep whatever it was before
    // (falling back to one derived from the new name for old records).
    let existing_prefix: Option<String> =
        sqlx::query_scalar("SELECT sku_prefix FROM categories WHERE id = ? AND company_id = ?")
            .bind(&category_id)
            .bind(company_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| format!("Database error: {e}"))?;

    let prefix = if sku_prefix.trim().is_empty() {
        match existing_prefix {
            Some(p) if !p.is_empty() => p,
            _ => derive_sku_prefix(&trimmed_name),
        }
    } else {
        normalize_sku_prefix(&sku_prefix, &trimmed_name)
    };

    check_version(pool.inner(), "categories", &category_id, expected_version).await?;

    let rows = sqlx::query(
        r#"
        UPDATE categories
        SET name = ?, description = ?, sku_prefix = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(&desc)
    .bind(&prefix)
    .bind(&category_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Category '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    if rows.rows_affected() == 0 {
        return Err("Category not found".to_string());
    }

    bump_version(pool.inner(), "categories", &category_id).await?;

    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ?")
        .bind(&category_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "category",
        Some(&category_id),
        &format!("Updated category '{}'", trimmed_name),
    )
    .await;

    Ok(category)
}

/// Deactivates a category (soft delete). Owner and admin only.
#[tauri::command]
pub async fn set_category_active(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
    active: bool,
) -> Result<PublicCategory, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let active_int: i32 = if active { 1 } else { 0 };

    let rows = sqlx::query(
        r#"
        UPDATE categories
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(active_int)
    .bind(&category_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("Category not found".to_string());
    }

    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ?")
        .bind(&category_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        if active { "activate" } else { "deactivate" },
        "category",
        Some(&category_id),
        if active {
            "Activated category"
        } else {
            "Deactivated category"
        },
    )
    .await;

    Ok(category)
}

// ==========================================
// SUPPLIER COMMANDS
// ==========================================

/// Lists all suppliers for the current user's company.
#[tauri::command]
pub async fn list_suppliers(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicSupplier>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let suppliers = sqlx::query_as::<_, PublicSupplier>(
        r#"
        SELECT id, company_id, name, contact_person, email,
               phone, address, tax_number, is_active,
               created_at, updated_at, version
        FROM suppliers
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(suppliers)
}

/// Creates a new supplier. Owner and admin only.
#[tauri::command]
pub async fn create_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
) -> Result<PublicSupplier, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Supplier name cannot be empty".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO suppliers
            (id, company_id, name, contact_person, email, phone, address, tax_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(clean_optional(&contact_person))
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&tax_number))
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "supplier",
        Some(&id),
        &format!("Created supplier '{}'", trimmed_name),
    )
    .await;

    Ok(supplier)
}

/// Updates a supplier. Owner and admin only.
#[tauri::command]
pub async fn update_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    expected_version: i64,
    supplier_id: String,
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
) -> Result<PublicSupplier, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Supplier name cannot be empty".to_string());
    }

    check_version(pool.inner(), "suppliers", &supplier_id, expected_version).await?;

    let rows = sqlx::query(
        r#"
        UPDATE suppliers
        SET name = ?, contact_person = ?, email = ?, phone = ?,
            address = ?, tax_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(clean_optional(&contact_person))
    .bind(clean_optional(&email))
    .bind(clean_optional(&phone))
    .bind(clean_optional(&address))
    .bind(clean_optional(&tax_number))
    .bind(&supplier_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("Supplier not found".to_string());
    }

    bump_version(pool.inner(), "suppliers", &supplier_id).await?;

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ?")
        .bind(&supplier_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "supplier",
        Some(&supplier_id),
        &format!("Updated supplier '{}'", trimmed_name),
    )
    .await;

    Ok(supplier)
}

/// Deactivates a supplier (soft delete). Owner and admin only.
#[tauri::command]
pub async fn set_supplier_active(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
    active: bool,
) -> Result<PublicSupplier, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let active_int: i32 = if active { 1 } else { 0 };

    let rows = sqlx::query(
        r#"
        UPDATE suppliers
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(active_int)
    .bind(&supplier_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("Supplier not found".to_string());
    }

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ?")
        .bind(&supplier_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        if active { "activate" } else { "deactivate" },
        "supplier",
        Some(&supplier_id),
        if active {
            "Activated supplier"
        } else {
            "Deactivated supplier"
        },
    )
    .await;

    Ok(supplier)
}

// ==========================================
// PRODUCT COMMANDS
// ==========================================

/// Lists all products for the current user's company.
/// Returns products sorted by name.
#[tauri::command]
pub async fn list_products(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicProduct>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let products = sqlx::query_as::<_, PublicProduct>(
        r#"
        SELECT id, company_id, sku, name, category_id, supplier_id,
               cost_price, sell_price, tax_rate, quantity_in_stock,
               unit, custom_fields, is_active, created_at, updated_at, version,
               (SELECT expiry_date FROM stock_batches b
                WHERE b.product_id = products.id AND b.quantity > 0
                ORDER BY b.expiry_date ASC LIMIT 1) AS next_expiry_date
        FROM products
        WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(products)
}

/// Creates a new product. Owner and admin only.
///
/// Prices are in the smallest currency unit (paisa/cents).
/// Example: 1500 means 15.00 PKR.
/// tax_rate is percentage * 100: 1700 means 17.00%.
#[tauri::command]
pub async fn create_product(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    sku: String,
    name: String,
    category_id: String,
    supplier_id: String,
    cost_price: i64,
    sell_price: i64,
    tax_rate: i64,
    quantity_in_stock: i64,
    unit: String,
) -> Result<PublicProduct, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // ---- Validation ----
    let mut final_sku = sku.trim().to_string();

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Product name cannot be empty".to_string());
    }

    if cost_price < 0 {
        return Err("Cost price cannot be negative".to_string());
    }

    if sell_price < 0 {
        return Err("Sell price cannot be negative".to_string());
    }

    if quantity_in_stock < 0 {
        return Err("Initial stock cannot be negative".to_string());
    }

    let trimmed_unit = if unit.trim().is_empty() {
        "pcs".to_string()
    } else {
        unit.trim().to_string()
    };

    let cat_id = clean_optional(&category_id);
    let sup_id = clean_optional(&supplier_id);

    // If the user left SKU blank, generate one from the category's
    // SKU prefix plus the next sequential number (ELEC-001, ELEC-002, ...).
    if final_sku.is_empty() {
        final_sku = generate_sku(pool.inner(), company_id, &cat_id, &trimmed_name).await?;
    }

    let id = uuid::Uuid::new_v4().to_string();

    // ---- Insert product ----
    sqlx::query(
        r#"
        INSERT INTO products
            (id, company_id, sku, name, category_id, supplier_id,
             cost_price, sell_price, tax_rate, quantity_in_stock, unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&final_sku)
    .bind(&trimmed_name)
    .bind(&cat_id)
    .bind(&sup_id)
    .bind(cost_price)
    .bind(sell_price)
    .bind(tax_rate)
    .bind(quantity_in_stock)
    .bind(&trimmed_unit)
    .execute(pool.inner())
    .await
    .map_err(|e| map_product_db_error(e, &final_sku))?;

    // ---- Record initial stock as a movement (if > 0) ----
    if quantity_in_stock > 0 {
        let movement_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO stock_movements
                (id, company_id, product_id, movement_type, quantity,
                 reference_note, performed_by)
            VALUES (?, ?, ?, 'adjustment', ?, 'Initial stock', ?)
            "#,
        )
        .bind(&movement_id)
        .bind(company_id)
        .bind(&id)
        .bind(quantity_in_stock)
        .bind(&current_user.id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Failed to record stock movement: {e}"))?;
    }

    // ---- Return created product ----
    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "create",
        "product",
        Some(&id),
        &format!("Created product {} — '{}'", final_sku, trimmed_name),
    )
    .await;

    Ok(product)
}

/// Updates an existing product. Owner and admin only.
/// Does NOT change quantity_in_stock — use adjust_stock for that.
#[tauri::command]
pub async fn update_product(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    expected_version: i64,
    product_id: String,
    sku: String,
    name: String,
    category_id: String,
    supplier_id: String,
    cost_price: i64,
    sell_price: i64,
    tax_rate: i64,
    unit: String,
) -> Result<PublicProduct, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let mut final_sku = sku.trim().to_string();

    // If the user left SKU blank on edit, keep the current value.
    if final_sku.is_empty() {
        let existing_sku: Option<String> =
            sqlx::query_scalar("SELECT sku FROM products WHERE id = ? AND company_id = ?")
                .bind(&product_id)
                .bind(company_id)
                .fetch_optional(pool.inner())
                .await
                .map_err(|e| format!("Database error: {e}"))?;
        final_sku = existing_sku.ok_or("Product not found")?;
    }

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Product name cannot be empty".to_string());
    }

    if cost_price < 0 || sell_price < 0 {
        return Err("Prices cannot be negative".to_string());
    }

    let trimmed_unit = if unit.trim().is_empty() {
        "pcs".to_string()
    } else {
        unit.trim().to_string()
    };

    let cat_id = clean_optional(&category_id);
    let sup_id = clean_optional(&supplier_id);

    check_version(pool.inner(), "products", &product_id, expected_version).await?;

    let rows = sqlx::query(
        r#"
        UPDATE products
        SET sku = ?, name = ?, category_id = ?, supplier_id = ?,
            cost_price = ?, sell_price = ?, tax_rate = ?, unit = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&final_sku)
    .bind(&trimmed_name)
    .bind(&cat_id)
    .bind(&sup_id)
    .bind(cost_price)
    .bind(sell_price)
    .bind(tax_rate)
    .bind(&trimmed_unit)
    .bind(&product_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| map_product_db_error(e, &final_sku))?;

    if rows.rows_affected() == 0 {
        return Err("Product not found".to_string());
    }

    bump_version(pool.inner(), "products", &product_id).await?;

    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "update",
        "product",
        Some(&product_id),
        &format!("Updated product {} — '{}'", final_sku, trimmed_name),
    )
    .await;

    Ok(product)
}

/// Adjusts stock for a product and records the movement.
///
/// This is the ONLY way to change quantity_in_stock.
/// It creates an audit trail in stock_movements.
///
/// movement_type: 'purchase', 'sale', 'adjustment', 'return', 'damage'
/// quantity: positive for stock IN, negative for stock OUT
///
/// Example: Received 50 units from supplier
///   movement_type = "purchase", quantity = 50
///
/// Example: Sold 5 units to customer
///   movement_type = "sale", quantity = -5
///
/// expiry_date (optional, stock IN only):
///   When provided, the incoming stock becomes an expiry batch.
///   This makes the product "expiry-tracked". Subsequent stock OUT
///   is deducted FIFO (soonest-expiring batch first).
///   Never defaulted — leave null when you don't track expiry.
///
/// batch_number (optional, stock IN only):
///   Labels the batch being created. Blank auto-generates "B-0001",
///   "B-0002", … so every batch has a human-readable number.
#[tauri::command]
pub async fn adjust_stock(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
    movement_type: String,
    quantity: i64,
    reference_note: String,
    expiry_date: Option<String>,
    batch_number: Option<String>,
) -> Result<PublicProduct, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate movement type
    let valid_types = ["purchase", "sale", "adjustment", "return", "damage"];
    if !valid_types.contains(&movement_type.as_str()) {
        return Err(format!(
            "Invalid movement type '{}'. Must be one of: {}",
            movement_type,
            valid_types.join(", ")
        ));
    }

    // Validate quantity direction
    // purchase, return, adjustment → positive (stock IN)
    // sale, damage → negative (stock OUT)
    match movement_type.as_str() {
        "purchase" | "return" => {
            if quantity <= 0 {
                return Err(format!(
                    "{} quantity must be positive (stock coming IN)",
                    movement_type
                ));
            }
        }
        "sale" | "damage" => {
            if quantity >= 0 {
                return Err(format!(
                    "{} quantity must be negative (stock going OUT)",
                    movement_type
                ));
            }
        }
        "adjustment" => {
            if quantity == 0
                && expiry_date
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
            {
                return Err(
                    "Adjustment quantity cannot be zero — set an Expiry Date to attach it to current stock without changing quantity".to_string(),
                );
            }
        }
        _ => unreachable!(),
    }

    let note = clean_optional(&reference_note);

    // Parse expiry date up front (if provided) so we never create a
    // partial transaction on bad input.
    let normalized_expiry: Option<String> = match &expiry_date {
        Some(value) if !value.trim().is_empty() => {
            Some(crate::commands::inventory::parse_expiry_date(value)?)
        }
        _ => None,
    };

    // Use a transaction so both the movement record and stock update
    // succeed or fail together
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    // 1. Record the movement
    let movement_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO stock_movements
            (id, company_id, product_id, movement_type, quantity,
             reference_note, performed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&movement_id)
    .bind(company_id)
    .bind(&product_id)
    .bind(&movement_type)
    .bind(quantity)
    .bind(&note)
    .bind(&current_user.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to record movement: {e}"))?;

    // 2. Update the product's stock quantity
    let rows = sqlx::query(
        r#"
        UPDATE products
        SET quantity_in_stock = quantity_in_stock + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(quantity)
    .bind(&product_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to update stock: {e}"))?;

    if rows.rows_affected() == 0 {
        return Err("Product not found".to_string());
    }

    // 3a. Stock IN with an expiry date → create an expiry batch.
    //     This makes the product expiry-tracked.
    if quantity > 0 {
        if let Some(expiry) = &normalized_expiry {
            let unit_cost: i64 = sqlx::query_scalar(
                "SELECT cost_price FROM products WHERE id = ? AND company_id = ?",
            )
            .bind(&product_id)
            .bind(company_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Product lookup error: {e}"))?;

            crate::commands::inventory::add_batch(
                &mut tx,
                company_id,
                &product_id,
                quantity,
                unit_cost,
                expiry,
                &movement_type,
                batch_number.as_deref(),
            )
            .await?;
        }
    }

    // 3a.2 Expiry-only adjustment (quantity 0): attach the expiry to the
    //      product's current UNBATCHED stock without changing quantity.
    //      The unbatched portion becomes a single expiry batch, so the
    //      product becomes expiry-tracked and future stock OUT is FIFO.
    if quantity == 0 {
        if let Some(expiry) = &normalized_expiry {
            let unbatched: i64 = sqlx::query_scalar(
                r#"
                SELECT p.quantity_in_stock - COALESCE(
                    (SELECT SUM(quantity) FROM stock_batches
                     WHERE company_id = ? AND product_id = ?),
                    0
                )
                FROM products p
                WHERE p.id = ? AND p.company_id = ?
                "#,
            )
            .bind(company_id)
            .bind(&product_id)
            .bind(&product_id)
            .bind(company_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Product lookup error: {e}"))?;

            if unbatched <= 0 {
                return Err(
                    "All current stock already has an expiry date — nothing left to attach it to"
                        .to_string(),
                );
            }

            let unit_cost: i64 = sqlx::query_scalar(
                "SELECT cost_price FROM products WHERE id = ? AND company_id = ?",
            )
            .bind(&product_id)
            .bind(company_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Product lookup error: {e}"))?;

            crate::commands::inventory::add_batch(
                &mut tx,
                company_id,
                &product_id,
                unbatched,
                unit_cost,
                expiry,
                "adjustment",
                batch_number.as_deref(),
            )
            .await?;
        }
    }

    // 3b. Stock OUT → deduct FIFO from the soonest-expiring batches
    //     first (only matters for expiry-tracked products).
    if quantity < 0 {
        crate::commands::inventory::deduct_fifo(&mut tx, company_id, &product_id, -quantity)
            .await?;
    }

    // 4. Commit the transaction
    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    // 4. Return updated product
    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

    // 5. Warn if stock went negative (shouldn't happen but safety check)
    if product.quantity_in_stock < 0 {
        // Stock is negative — this is a warning, not an error.
        // In a real ERP you'd prevent this, but for MVP we allow it
        // and let the user fix it with an adjustment.
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    let mut details = if quantity == 0 && normalized_expiry.is_some() {
        format!("Set expiry on existing stock ({movement_type})")
    } else {
        format!("{} {} unit(s)", quantity, movement_type)
    };
    if let Some(n) = note.as_deref() {
        if !n.is_empty() {
            details.push_str(&format!(" — {n}"));
        }
    }
    if let Some(exp) = &normalized_expiry {
        details.push_str(&format!(" (expiry {exp})"));
    }
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        &movement_type,
        "stock",
        Some(&product_id),
        &details,
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(product)
}

/// Lists the company's custom field definitions.
/// These were created by the Import Wizard and drive dynamic forms.
#[tauri::command]
pub async fn list_custom_fields(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<serde_json::Value>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            String,
            bool,
            i64,
            Option<String>,
            Option<String>,
        ),
    >(
        r#"
        SELECT id, field_name, field_label, field_type,
               is_visible, field_order, validation_rules, default_value
        FROM company_field_settings
        WHERE company_id = ?
        ORDER BY field_order
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let fields: Vec<serde_json::Value> = rows
        .iter()
        .map(|(id, name, label, ftype, visible, order, rules, default)| {
            serde_json::json!({
                "id": id,
                "fieldName": name,
                "fieldLabel": label,
                "fieldType": ftype,
                "isVisible": visible,
                "fieldOrder": order,
                "validationRules": rules,
                "defaultValue": default,
            })
        })
        .collect();

    Ok(fields)
}

/// Lists stock movements for a specific product (audit trail).
#[tauri::command]
pub async fn list_stock_movements(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
) -> Result<Vec<PublicStockMovement>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let movements = sqlx::query_as::<_, PublicStockMovement>(
        r#"
        SELECT id, company_id, product_id, movement_type, quantity,
               reference_note, performed_by, created_at
        FROM stock_movements
        WHERE company_id = ? AND product_id = ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(&current_user.company_id)
    .bind(&product_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(movements)
}

// ==========================================
// EXPIRY COMMANDS — stock_batches + FIFO
// ==========================================
//
// Products that expire (medicines, food, cosmetics, etc.) are managed
// in batches. Each batch is a quantity received together with one
// expiry date. Stock is sold FIRST-IN-FIRST-OUT (FIFO): the batch
// expiring soonest is consumed first, so nothing lingers on the shelf
// and expires into a loss.
//
// A product becomes "expiry-tracked" the moment its first batch is
// created (from an Excel/CSV import with an expiry column, or a stock
// IN with an expiry date). Once tracked, ALL stock OUT flows through
// the batches FIFO.
//
// expiry_date is ALWAYS a real date from the file/user — never
// defaulted or invented. Non-expiry products simply have no batches.
//
// NOTE: stock_batches.quantity is a sub-ledger of
// products.quantity_in_stock. FIFO drains the batches first; any
// remainder of a deduction is taken from unbatched stock (stock that
// was recorded before the product became expiry-tracked), which is why
// deduct_fifo never hard-fails on shortage — the caller's product-level
// check (quantity_in_stock) already guards against over-selling.

// ==========================================
// RETURN TYPES
// ==========================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicStockBatch {
    pub id: String,
    pub company_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    /// Human-readable identifier for this batch (e.g. "B-0001").
    /// Auto-generated on creation when the user does not supply one.
    pub batch_number: Option<String>,
    pub quantity: i64,
    pub unit_cost: i64,
    pub expiry_date: String,
    pub source: String,
    /// "ok" | "expiring" | "expired" | "depleted"
    pub status: String,
    pub created_at: String,
}

/// DB row before status is computed (status is not a stored column).
#[derive(Debug, Clone, sqlx::FromRow)]
struct RawBatch {
    id: String,
    company_id: String,
    product_id: String,
    product_name: String,
    product_sku: String,
    batch_number: Option<String>,
    quantity: i64,
    unit_cost: i64,
    expiry_date: String,
    source: String,
    created_at: String,
}

fn today() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}

/// Human status for a batch row (no warn-window context).
fn batch_status(expiry_date: &str, quantity: i64) -> String {
    if quantity <= 0 {
        return "depleted".to_string();
    }
    match chrono::NaiveDate::parse_from_str(expiry_date, "%Y-%m-%d") {
        Ok(d) if d < today() => "expired".to_string(),
        Ok(_) => "ok".to_string(),
        Err(_) => "ok".to_string(),
    }
}

fn to_public(raw: RawBatch, status: String) -> PublicStockBatch {
    PublicStockBatch {
        id: raw.id,
        company_id: raw.company_id,
        product_id: raw.product_id,
        product_name: raw.product_name,
        product_sku: raw.product_sku,
        batch_number: raw.batch_number,
        quantity: raw.quantity,
        unit_cost: raw.unit_cost,
        expiry_date: raw.expiry_date,
        source: raw.source,
        status,
        created_at: raw.created_at,
    }
}

/// Builds the next sequential batch number for a company: "B-0001",
/// "B-0002", … Works against any connection (a transaction or a pooled
/// connection), so stock-ins and file imports never hand out the same number.
pub async fn generate_batch_number(
    conn: &mut sqlx::SqliteConnection,
    company_id: &str,
) -> Result<String, String> {
    let start: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(CAST(SUBSTR(batch_number, 3) AS INTEGER)), 0)
        FROM stock_batches
        WHERE company_id = ? AND batch_number LIKE 'B-%'
        "#,
    )
    .bind(company_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| format!("Batch number lookup error: {e}"))?;

    let mut next = start;
    loop {
        next += 1;
        let candidate = format!("B-{:04}", next);
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM stock_batches WHERE company_id = ? AND batch_number = ?",
        )
        .bind(company_id)
        .bind(&candidate)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| format!("Batch number lookup error: {e}"))?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
}

/// Creates a stock batch inside the caller's transaction.
/// Used by stock IN with an expiry date (manual adjustments, purchases).
///
/// All stock of a product received with the same expiry date accumulates
/// into ONE batch — repeated additions merge into the existing batch
/// instead of fragmenting into many rows.
///
/// When `batch_number` is blank/None a sequential "B-XXXX" number is
/// generated for the company; a supplied number is validated for
/// uniqueness within the company before insert.
pub async fn add_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
    product_id: &str,
    quantity: i64,
    unit_cost: i64,
    expiry_date: &str,
    source: &str,
    batch_number: Option<&str>,
) -> Result<(), String> {
    upsert_batch(
        &mut **tx,
        company_id,
        product_id,
        quantity,
        unit_cost,
        expiry_date,
        source,
        batch_number,
    )
    .await
}

/// Connection-level version of [`add_batch`] — works against a
/// transaction or a pooled connection. If a batch already exists for the
/// product at the same expiry date, the new stock is added to it
/// (quantity accumulates, unit cost becomes the weighted average) so the
/// product keeps a single batch for everything received together.
/// Otherwise a new batch row is inserted.
pub async fn upsert_batch(
    conn: &mut sqlx::SqliteConnection,
    company_id: &str,
    product_id: &str,
    quantity: i64,
    unit_cost: i64,
    expiry_date: &str,
    source: &str,
    batch_number: Option<&str>,
) -> Result<(), String> {
    let existing: Option<(String, i64, i64)> = sqlx::query_as(
        r#"
        SELECT id, quantity, unit_cost
        FROM stock_batches
        WHERE company_id = ? AND product_id = ? AND expiry_date = ?
        LIMIT 1
        "#,
    )
    .bind(company_id)
    .bind(product_id)
    .bind(expiry_date)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| format!("Batch lookup error: {e}"))?;

    if let Some((batch_id, old_qty, old_cost)) = existing {
        let new_qty = old_qty + quantity;
        let new_cost = if new_qty > 0 {
            (old_cost * old_qty + unit_cost * quantity) / new_qty
        } else {
            unit_cost
        };
        sqlx::query("UPDATE stock_batches SET quantity = ?, unit_cost = ? WHERE id = ?")
            .bind(new_qty)
            .bind(new_cost)
            .bind(&batch_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("Batch update error: {e}"))?;
        return Ok(());
    }

    let final_number = match batch_number.map(str::trim).filter(|s| !s.is_empty()) {
        Some(provided) => {
            let exists: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM stock_batches WHERE company_id = ? AND batch_number = ?",
            )
            .bind(company_id)
            .bind(provided)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| format!("Batch number lookup error: {e}"))?;
            if exists.is_some() {
                return Err(format!("A batch with number '{provided}' already exists"));
            }
            provided.to_string()
        }
        None => generate_batch_number(&mut *conn, company_id).await?,
    };

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO stock_batches
            (id, company_id, product_id, quantity, unit_cost, expiry_date, source, batch_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(product_id)
    .bind(quantity)
    .bind(unit_cost)
    .bind(expiry_date)
    .bind(source)
    .bind(&final_number)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Failed to create stock batch: {e}"))?;
    Ok(())
}

/// Deducts `quantity_out` units from a tracked product's batches,
/// expiring-soonest first (FIFO). If the product has no batches, this
/// is a no-op. Only batch-level quantity is touched here; the caller
/// must already have decremented products.quantity_in_stock.
pub async fn deduct_fifo(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
    product_id: &str,
    quantity_out: i64,
) -> Result<(), String> {
    if quantity_out <= 0 {
        return Ok(());
    }

    let batch_sum: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(quantity), 0) FROM stock_batches WHERE company_id = ? AND product_id = ?",
    )
    .bind(company_id)
    .bind(product_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("Batch lookup error: {e}"))?;

    if batch_sum <= 0 {
        return Ok(()); // not expiry-tracked — plain stock
    }

    let mut remaining = quantity_out.min(batch_sum);

    while remaining > 0 {
        let batch: Option<(String, i64)> = sqlx::query_as(
            r#"
            SELECT id, quantity
            FROM stock_batches
            WHERE company_id = ? AND product_id = ? AND quantity > 0
            ORDER BY expiry_date ASC, created_at ASC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .bind(product_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("Batch lookup error: {e}"))?;

        let Some((batch_id, batch_qty)) = batch else {
            break;
        };

        let take = remaining.min(batch_qty);
        sqlx::query("UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?")
            .bind(take)
            .bind(&batch_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("Batch update error: {e}"))?;

        remaining -= take;
    }

    Ok(())
}

/// Parses a user/file-supplied expiry value into "YYYY-MM-DD".
/// Blank or unparseable values are an error — nothing is defaulted.
pub fn parse_expiry_date(value: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err("Expiry date is empty".to_string());
    }

    // Already ISO: 2024-01-15
    if let Ok(d) = chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d") {
        return Ok(d.to_string());
    }

    let sep = if v.contains('/') { '/' } else { '-' };
    let parts: Vec<&str> = v.split(sep).map(str::trim).collect();
    if parts.len() != 3 {
        return Err(format!(
            "Cannot read expiry date '{v}'. Use YYYY-MM-DD or DD/MM/YYYY"
        ));
    }

    let (year, month, day): (i32, u32, u32);
    if parts[0].len() == 4 {
        // YYYY/MM/DD
        year = parts[0].parse().map_err(|_| bad_date(v))?;
        month = parts[1].parse().map_err(|_| bad_date(v))?;
        day = parts[2].parse().map_err(|_| bad_date(v))?;
    } else {
        // DD/MM/YYYY (Pakistan convention). Disambiguate MM/DD:
        //   first part > 12  → day first
        //   second part > 12 → month first (MM/DD/YYYY)
        //   both ≤ 12         → day first (DD/MM/YYYY)
        let a: u32 = parts[0].parse().map_err(|_| bad_date(v))?;
        let b: u32 = parts[1].parse().map_err(|_| bad_date(v))?;
        let (day_part, month_part) = if a > 12 {
            (a, b)
        } else if b > 12 {
            (b, a)
        } else {
            (a, b)
        };
        year = parts[2].parse().map_err(|_| bad_date(v))?;
        month = month_part;
        day = day_part;
    }

    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .map(|d| d.to_string())
        .ok_or_else(|| bad_date(v))
}

fn bad_date(value: &str) -> String {
    format!("Cannot read date '{value}'. Use YYYY-MM-DD or DD/MM/YYYY")
}

// ==========================================
// COMMANDS
// ==========================================

/// Lists all batches for one product (live + depleted), oldest expiry first.
#[tauri::command]
pub async fn list_product_batches(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
) -> Result<Vec<PublicStockBatch>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows = sqlx::query_as::<_, RawBatch>(
        r#"
        SELECT b.id, b.company_id, b.product_id,
               p.name AS product_name, p.sku AS product_sku,
               b.batch_number, b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
        FROM stock_batches b
        JOIN products p ON p.id = b.product_id AND p.company_id = b.company_id
        WHERE b.company_id = ? AND b.product_id = ?
        ORDER BY b.expiry_date ASC, b.created_at ASC
        "#,
    )
    .bind(company_id)
    .bind(&product_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let status = batch_status(&r.expiry_date, r.quantity);
            to_public(r, status)
        })
        .collect())
}

/// Lists batches that have expired or expire within `warn_days`.
/// This is the expiry-warning feed for the inventory dashboard.
#[tauri::command]
pub async fn list_expiring_batches(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    warn_days: i64,
) -> Result<Vec<PublicStockBatch>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let cutoff = today() + chrono::Duration::days(warn_days.max(0));
    let cutoff_str = cutoff.format("%Y-%m-%d").to_string();

    let rows = sqlx::query_as::<_, RawBatch>(
        r#"
        SELECT b.id, b.company_id, b.product_id,
               p.name AS product_name, p.sku AS product_sku,
               b.batch_number, b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
        FROM stock_batches b
        JOIN products p ON p.id = b.product_id AND p.company_id = b.company_id
        WHERE b.company_id = ? AND b.quantity > 0 AND b.expiry_date <= ?
        ORDER BY b.expiry_date ASC
        "#,
    )
    .bind(company_id)
    .bind(&cutoff_str)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let today_naive = today();
    Ok(rows
        .into_iter()
        .map(|r| {
            let status = match chrono::NaiveDate::parse_from_str(&r.expiry_date, "%Y-%m-%d") {
                Ok(d) if d < today_naive => "expired".to_string(),
                _ => "expiring".to_string(),
            };
            to_public(r, status)
        })
        .collect())
}

/// Writes off stock from a batch (expired goods).
/// Reduces the batch, reduces the product's total stock, and records
/// a 'damage' stock movement. Owner and admin only.
#[tauri::command]
pub async fn write_off_batch(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    batch_id: String,
    quantity: i64,
    reason: String,
) -> Result<PublicStockBatch, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &user.role, "inventory", "edit").await?;

    let company_id = user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    let batch = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id, product_id, quantity FROM stock_batches WHERE id = ? AND company_id = ?",
    )
    .bind(&batch_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Batch lookup error: {e}"))?
    .ok_or("Batch not found")?;

    let (_, product_id, current_qty) = batch;

    if current_qty <= 0 {
        return Err(
            "This batch is already depleted (0 units left) — nothing to write off.".to_string(),
        );
    }

    if quantity <= 0 || quantity > current_qty {
        return Err(format!(
            "Invalid write-off quantity. Must be between 1 and {current_qty}."
        ));
    }

    // 1. Reduce the batch
    sqlx::query("UPDATE stock_batches SET quantity = quantity - ? WHERE id = ?")
        .bind(quantity)
        .bind(&batch_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Batch update error: {e}"))?;

    // 2. Reduce the product's total stock
    let product_rows = sqlx::query(
        "UPDATE products SET quantity_in_stock = quantity_in_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
    )
    .bind(quantity)
    .bind(&product_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Product update error: {e}"))?;

    if product_rows.rows_affected() == 0 {
        return Err("Product not found".to_string());
    }

    // 3. Audit trail
    let note_prefix = "Expired stock — written off";
    let reference = if reason.trim().is_empty() {
        note_prefix.to_string()
    } else {
        format!("{note_prefix}: {}", reason.trim())
    };
    let movement_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO stock_movements
            (id, company_id, product_id, movement_type, quantity, reference_note, performed_by)
        VALUES (?, ?, ?, 'damage', ?, ?, ?)
        "#,
    )
    .bind(&movement_id)
    .bind(company_id)
    .bind(&product_id)
    .bind(-quantity)
    .bind(&reference)
    .bind(&user.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Movement record error: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    let updated = sqlx::query_as::<_, RawBatch>(
        r#"
        SELECT b.id, b.company_id, b.product_id,
               p.name AS product_name, p.sku AS product_sku,
               b.batch_number, b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
        FROM stock_batches b
        JOIN products p ON p.id = b.product_id AND p.company_id = b.company_id
        WHERE b.id = ? AND b.company_id = ?
        "#,
    )
    .bind(&batch_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let status = batch_status(&updated.expiry_date, updated.quantity);
    let company_id = user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &user.id,
        &user.email,
        &user.role,
        "write_off",
        "stock_batch",
        Some(&batch_id),
        &format!("Wrote off {quantity} unit(s): {}", reference),
    )
    .await;
    crate::commands::notifications::emit_notifications_changed();
    Ok(to_public(updated, status))
}

// ==========================================
// DELETE COMMANDS
// ==========================================

/// Soft-deletes a category. Owner and admin only.
#[tauri::command]
pub async fn delete_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "categories", &category_id, company_id).await?;

    if rows_affected == 0 {
        return Err("Category not found".to_string());
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "category",
        Some(&category_id),
        &format!("Deleted category"),
    )
    .await;

    Ok(())
}

/// Soft-deletes a supplier. Owner and admin only.
#[tauri::command]
pub async fn delete_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "suppliers", &supplier_id, company_id).await?;

    if rows_affected == 0 {
        return Err("Supplier not found".to_string());
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "supplier",
        Some(&supplier_id),
        &format!("Deleted supplier"),
    )
    .await;

    Ok(())
}

/// Soft-deletes a product. Owner and admin only.
#[tauri::command]
pub async fn delete_product(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "products", &product_id, company_id).await?;

    if rows_affected == 0 {
        return Err("Product not found".to_string());
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "product",
        Some(&product_id),
        &format!("Deleted product"),
    )
    .await;

    Ok(())
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
    use tauri::Manager;
    use uuid::Uuid;

    /// Registers the owner and returns the app.
    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Creates a category through the real command.
    async fn make_category(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicCategory {
        create_category(
            app.state(),
            app.state(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create category")
    }

    /// Creates a supplier through the real command.
    async fn make_supplier(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicSupplier {
        create_supplier(
            app.state(),
            app.state(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create supplier")
    }

    /// Creates a product through the real command (blank SKU → auto-generated).
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
        category_id: Option<&str>,
    ) -> PublicProduct {
        create_product(
            app.state(),
            app.state(),
            "".to_string(),
            name.to_string(),
            category_id.unwrap_or("").to_string(),
            "".to_string(),
            1000,
            1500,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    // ---------------------------------------------------------------
    // clean_optional (pure)
    // ---------------------------------------------------------------

    #[test]
    fn clean_optional_blank_is_none() {
        // Input: "".
        // Expected: None.
        assert_eq!(clean_optional(""), None);
    }

    #[test]
    fn clean_optional_whitespace_is_none() {
        // Input: "   ".
        // Expected: None.
        assert_eq!(clean_optional("   "), None);
    }

    #[test]
    fn clean_optional_trims_value() {
        // Input: "  Lahore  ".
        // Expected: Some("Lahore").
        assert_eq!(clean_optional("  Lahore  "), Some("Lahore".to_string()));
    }

    // ---------------------------------------------------------------
    // map_product_db_error (DB-backed)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_product_allows_optional_category_and_supplier() {
        // Input: empty category + supplier.
        // Expected: product saved with NULL category/supplier — no "null" error.
        let app = owner_app().await;
        let p = make_product(&app, "No Category Product", None).await;
        assert_eq!(p.category_id, None);
        assert_eq!(p.supplier_id, None);
    }

    #[tokio::test]
    async fn create_product_duplicate_sku_gets_friendly_message() {
        // Input: the same SKU twice.
        // Expected: "SKU 'X' already exists", not a raw constraint string.
        let app = owner_app().await;
        create_product(
            app.state(),
            app.state(),
            "DUP-001".to_string(),
            "First".to_string(),
            "".to_string(),
            "".to_string(),
            1,
            1,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("first insert");

        let err = create_product(
            app.state(),
            app.state(),
            "DUP-001".to_string(),
            "Second".to_string(),
            "".to_string(),
            "".to_string(),
            1,
            1,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "SKU 'DUP-001' already exists");
    }

    #[tokio::test]
    async fn map_product_db_error_not_null_is_friendly() {
        // Input: a real NOT NULL constraint error.
        // Expected: generic missing-field message, not a raw SQL string.
        let app = owner_app().await;
        let pool: &SqlitePool = app.state::<SqlitePool>().inner();
        sqlx::query("CREATE TABLE tmp_required (id TEXT NOT NULL)")
            .execute(pool)
            .await
            .expect("create table");
        let err = sqlx::query("INSERT INTO tmp_required (id) VALUES (NULL)")
            .execute(pool)
            .await
            .unwrap_err();
        assert_eq!(
            map_product_db_error(err, "X"),
            "A required field is missing"
        );
    }

    #[tokio::test]
    async fn map_product_db_error_other_is_wrapped() {
        // Input: a generic failure.
        // Expected: raw error preserved under a prefix.
        let app = owner_app().await;
        let pool: &SqlitePool = app.state::<SqlitePool>().inner();
        let err = sqlx::query("INSERT INTO does_not_exist (x) VALUES (1)")
            .execute(pool)
            .await
            .unwrap_err();
        assert!(map_product_db_error(err, "X").starts_with("Database error:"));
    }

    // ---------------------------------------------------------------
    // derive_sku_prefix (pure)
    // ---------------------------------------------------------------

    #[test]
    fn sku_prefix_derives_short_words() {
        // Input: "Electronics".
        // Expected: "ELEC" (first 6 alphanumeric, uppercased).
        assert_eq!(derive_sku_prefix("Electronics"), "ELECTR");
    }

    #[test]
    fn sku_prefix_handles_spaces() {
        // Input: "Mobile Phones".
        // Expected: "MOBILE".
        assert_eq!(derive_sku_prefix("Mobile Phones"), "MOBILE");
    }

    #[test]
    fn sku_prefix_caps_at_six_chars() {
        // Input: "abcdefghij".
        // Expected: "ABCDEF".
        assert_eq!(derive_sku_prefix("abcdefghij"), "ABCDEF");
    }

    #[test]
    fn sku_prefix_falls_back_to_cat() {
        // Input: "!!!".  (no alphanumeric chars)
        // Expected: "CAT".
        assert_eq!(derive_sku_prefix("!!!"), "CAT");
    }

    // ---------------------------------------------------------------
    // normalize_sku_prefix (pure)
    // ---------------------------------------------------------------

    #[test]
    fn sku_prefix_normalize_strips_noise() {
        // Input: " my-prefix!! ".
        // Expected: "MYPREF".
        assert_eq!(normalize_sku_prefix(" my-prefix!! ", "X"), "MYPREF");
    }

    #[test]
    fn sku_prefix_normalize_falls_back_to_category() {
        // Input: blank prefix + category "Laptops".
        // Expected: "LAPTOP".
        assert_eq!(normalize_sku_prefix("   ", "Laptops"), "LAPTOP");
    }

    // ---------------------------------------------------------------
    // batch_status (pure)
    // ---------------------------------------------------------------

    #[test]
    fn batch_status_zero_qty_is_depleted() {
        // Input: qty 0, any date.
        // Expected: "depleted".
        assert_eq!(batch_status("2026-01-01", 0), "depleted");
    }

    #[test]
    fn batch_status_past_date_is_expired() {
        // Input: qty 5, date 2000-01-01.
        // Expected: "expired".
        assert_eq!(batch_status("2000-01-01", 5), "expired");
    }

    #[test]
    fn batch_status_future_date_is_ok() {
        // Input: qty 5, date 2099-01-01.
        // Expected: "ok".
        assert_eq!(batch_status("2099-01-01", 5), "ok");
    }

    #[test]
    fn batch_status_garbage_date_is_ok() {
        // Input: qty 5, date "nonsense".
        // Expected: "ok" (parse failure is not treated as expired).
        assert_eq!(batch_status("nonsense", 5), "ok");
    }

    // ---------------------------------------------------------------
    // parse_expiry_date (pure)
    // ---------------------------------------------------------------

    #[test]
    fn expiry_parses_iso() {
        // Input: "2024-01-15".
        // Expected: Ok("2024-01-15").
        assert_eq!(parse_expiry_date("2024-01-15").unwrap(), "2024-01-15");
    }

    #[test]
    fn expiry_parses_dmy() {
        // Input: "15/01/2024".
        // Expected: Ok("2024-01-15").
        assert_eq!(parse_expiry_date("15/01/2024").unwrap(), "2024-01-15");
    }

    #[test]
    fn expiry_disambiguates_day_first() {
        // Input: "20/01/2024" — first part > 12 → day first.
        // Expected: Ok("2024-01-20").
        assert_eq!(parse_expiry_date("20/01/2024").unwrap(), "2024-01-20");
    }

    #[test]
    fn expiry_disambiguates_month_first() {
        // Input: "01/20/2024" — second part > 12 → month first.
        // Expected: Ok("2024-01-20").
        assert_eq!(parse_expiry_date("01/20/2024").unwrap(), "2024-01-20");
    }

    #[test]
    fn expiry_rejects_empty() {
        // Input: "   ".
        // Expected: Err "Expiry date is empty".
        assert_eq!(
            parse_expiry_date("   ").unwrap_err(),
            "Expiry date is empty"
        );
    }

    #[test]
    fn expiry_rejects_wrong_parts() {
        // Input: "2024-01".
        // Expected: Err about format.
        assert!(parse_expiry_date("2024-01").is_err());
    }

    #[test]
    fn expiry_rejects_impossible_date() {
        // Input: "31/02/2024" (Feb 31).
        // Expected: Err about format.
        assert!(parse_expiry_date("31/02/2024").is_err());
    }

    // ---------------------------------------------------------------
    // list_categories
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_categories_empty_before_create() {
        // Input: fresh company.
        // Expected: Ok([]).
        let app = owner_app().await;
        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert!(cats.is_empty());
    }

    #[tokio::test]
    async fn list_categories_returns_created() {
        // Input: one created category.
        // Expected: the category is returned.
        let app = owner_app().await;
        make_category(&app, "Electronics").await;
        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].name, "Electronics");
    }

    #[tokio::test]
    async fn list_categories_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_categories(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_category_generates_prefix() {
        // Input: name "Electronics", blank prefix.
        // Expected: Ok with sku_prefix "ELEC".
        let app = owner_app().await;
        let cat = create_category(
            app.state(),
            app.state(),
            "Electronics".to_string(),
            "Gadgets".to_string(),
            "".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(cat.name, "Electronics");
        assert_eq!(cat.sku_prefix.as_deref(), Some("ELECTR"));
        assert_eq!(cat.description.as_deref(), Some("Gadgets"));
    }

    #[tokio::test]
    async fn create_category_rejects_empty_name() {
        // Input: name "   ".
        // Expected: Err "Category name cannot be empty".
        let app = owner_app().await;
        let err = create_category(
            app.state(),
            app.state(),
            "   ".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category name cannot be empty");
    }

    #[tokio::test]
    async fn create_category_rejects_duplicate() {
        // Input: two categories with the same name.
        // Expected: second Err "Category 'X' already exists".
        let app = owner_app().await;
        make_category(&app, "Tools").await;
        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category 'Tools' already exists");
    }

    #[tokio::test]
    async fn create_category_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied: employee cannot create inventory".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(
            &pool,
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn create_category_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_category_succeeds_and_bumps_version() {
        // Input: owner updates name with matching expected_version.
        // Expected: Ok, new name, version incremented.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let updated = update_category(
            app.state(),
            app.state(),
            cat.version,
            cat.id.clone(),
            "Power Tools".to_string(),
            "".to_string(),
            "PWR".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Power Tools");
        assert_eq!(updated.sku_prefix.as_deref(), Some("PWR"));
        assert!(updated.version > cat.version);
    }

    #[tokio::test]
    async fn update_category_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let err = update_category(
            app.state(),
            app.state(),
            cat.version + 5,
            cat.id.clone(),
            "Renamed".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_category_not_found() {
        // Input: a random id.
        // Expected: Err "Record not found or deleted".
        let app = owner_app().await;
        let err = update_category(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "X".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Record not found"), "got: {err}");
    }

    #[tokio::test]
    async fn update_category_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Category name cannot be empty".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;
        let err = update_category(
            app.state(),
            app.state(),
            cat.version,
            cat.id.clone(),
            "  ".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category name cannot be empty");
    }

    // ---------------------------------------------------------------
    // set_category_active
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_category_active_deactivate_reactivate() {
        // Input: owner deactivates then reactivates a category.
        // Expected: is_active false then true.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let off = set_category_active(app.state(), app.state(), cat.id.clone(), false)
            .await
            .expect("deactivate");
        assert!(!off.is_active);

        let on = set_category_active(app.state(), app.state(), cat.id.clone(), true)
            .await
            .expect("reactivate");
        assert!(on.is_active);
    }

    #[tokio::test]
    async fn set_category_active_not_found() {
        // Input: a random id.
        // Expected: Err "Category not found".
        let app = owner_app().await;
        let err = set_category_active(app.state(), app.state(), Uuid::new_v4().to_string(), false)
            .await
            .unwrap_err();
        assert_eq!(err, "Category not found");
    }

    // ---------------------------------------------------------------
    // delete_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn delete_category_soft_deletes() {
        // Input: owner deletes an existing category.
        // Expected: Ok; subsequent list omits it.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        delete_category(app.state(), app.state(), cat.id.clone())
            .await
            .expect("delete");

        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert!(cats.is_empty(), "deleted category must disappear");
    }

    #[tokio::test]
    async fn delete_category_not_found() {
        // Input: a random id.
        // Expected: Err "Category not found".
        let app = owner_app().await;
        let err = delete_category(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Category not found");
    }

    #[tokio::test]
    async fn delete_category_denied_for_employee() {
        // Input: employee logged in (no inventory/delete).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = delete_category(app.state(), app.state(), cat.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_supplier / list_suppliers / update / set_active / delete
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn supplier_full_crud_cycle() {
        // Input: create → list → update → deactivate → delete.
        // Expected: each step reflects its state.
        let app = owner_app().await;

        let sup = create_supplier(
            app.state(),
            app.state(),
            "Acme Ltd".to_string(),
            "John".to_string(),
            "john@acme.com".to_string(),
            "0300-000".to_string(),
            "Lahore".to_string(),
            "NTN-1".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(sup.email.as_deref(), Some("john@acme.com"));

        let listed = list_suppliers(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(listed.len(), 1);

        let updated = update_supplier(
            app.state(),
            app.state(),
            sup.version,
            sup.id.clone(),
            "Acme Corp".to_string(),
            "Jane".to_string(),
            "jane@acme.com".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Acme Corp");
        assert_eq!(updated.contact_person.as_deref(), Some("Jane"));

        let off = set_supplier_active(app.state(), app.state(), sup.id.clone(), false)
            .await
            .expect("deactivate");
        assert!(!off.is_active);

        delete_supplier(app.state(), app.state(), sup.id.clone())
            .await
            .expect("delete");
        let listed = list_suppliers(app.state(), app.state())
            .await
            .expect("list");
        assert!(listed.is_empty());
    }

    #[tokio::test]
    async fn create_supplier_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Supplier name cannot be empty".
        let app = owner_app().await;
        let err = create_supplier(
            app.state(),
            app.state(),
            " ".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Supplier name cannot be empty");
    }

    #[tokio::test]
    async fn update_supplier_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let sup = make_supplier(&app, "Acme").await;
        let err = update_supplier(
            app.state(),
            app.state(),
            sup.version + 1,
            sup.id.clone(),
            "Renamed".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_supplier_not_found() {
        // Input: a random id.
        // Expected: Err "Record not found or deleted".
        let app = owner_app().await;
        let err = update_supplier(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "X".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Record not found"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // generate_sku (via create_product)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_product_auto_sku_sequences() {
        // Input: blank SKU with a category that has prefix ELEC.
        // Expected: first product "ELEC-001", second "ELEC-002".
        let app = owner_app().await;
        let cat = make_category(&app, "Electronics").await;

        let p1 = make_product(&app, "Bolt", Some(&cat.id)).await;
        let p2 = make_product(&app, "Nut", Some(&cat.id)).await;
        assert_eq!(p1.sku, "ELECTR-001");
        assert_eq!(p2.sku, "ELECTR-002");
    }

    #[tokio::test]
    async fn create_product_uses_explicit_sku() {
        // Input: explicit SKU "CUSTOM-9".
        // Expected: Ok with sku "CUSTOM-9".
        let app = owner_app().await;
        let p = create_product(
            app.state(),
            app.state(),
            "CUSTOM-9".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(p.sku, "CUSTOM-9");
    }

    #[tokio::test]
    async fn create_product_records_initial_stock_movement() {
        // Input: quantity_in_stock = 25.
        // Expected: product stock = 25; one stock movement row.
        let app = owner_app().await;
        let p = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            25,
            "pcs".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(p.quantity_in_stock, 25);

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert_eq!(movements.len(), 1);
        assert_eq!(movements[0].movement_type, "adjustment");
    }

    #[tokio::test]
    async fn create_product_rejects_negative_price() {
        // Input: cost_price = -1.
        // Expected: Err "Cost price cannot be negative".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            -1,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cost price cannot be negative");
    }

    #[tokio::test]
    async fn create_product_rejects_negative_stock() {
        // Input: quantity_in_stock = -5.
        // Expected: Err "Initial stock cannot be negative".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            -5,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Initial stock cannot be negative");
    }

    #[tokio::test]
    async fn create_product_rejects_duplicate_sku() {
        // Input: same explicit SKU twice.
        // Expected: second Err "SKU 'DUP' already exists".
        let app = owner_app().await;
        create_product(
            app.state(),
            app.state(),
            "DUP".to_string(),
            "One".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("first create");

        let err = create_product(
            app.state(),
            app.state(),
            "dup".to_string(),
            "Two".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[tokio::test]
    async fn create_product_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Product name cannot be empty".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "  ".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product name cannot be empty");
    }

    #[tokio::test]
    async fn create_product_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_product
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_product_succeeds_and_bumps_version() {
        // Input: owner updates with matching version.
        // Expected: Ok, new name/sku, version bumped.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let updated = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "NEW-SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            900,
            1300,
            5,
            "box".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Gadget");
        assert_eq!(updated.sku, "NEW-SKU");
        assert_eq!(updated.cost_price, 900);
        assert_eq!(updated.unit, "box");
        assert!(updated.version > p.version);
    }

    #[tokio::test]
    async fn update_product_keeps_sku_when_blank() {
        // Input: blank SKU on edit.
        // Expected: existing SKU retained.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let updated = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            900,
            1300,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.sku, p.sku);
    }

    #[tokio::test]
    async fn update_product_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = update_product(
            app.state(),
            app.state(),
            p.version + 3,
            p.id.clone(),
            "NEW-SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_product_rejects_negative_price() {
        // Input: sell_price = -1.
        // Expected: Err "Prices cannot be negative".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            -1,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Prices cannot be negative");
    }

    #[tokio::test]
    async fn update_product_not_found() {
        // Input: a random id with a non-blank SKU.
        // Expected: Err "Record not found or deleted" (check_version guard).
        let app = owner_app().await;
        let err = update_product(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Record not found or deleted");
    }

    // ---------------------------------------------------------------
    // adjust_stock
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn adjust_stock_purchase_and_sale() {
        // Input: purchase +10 then sale -3.
        // Expected: stock 7; two movements.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let in_p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "from supplier".to_string(),
            None,
            None,
        )
        .await
        .expect("purchase");
        assert_eq!(in_p.quantity_in_stock, 10);

        let out_p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            -3,
            "walk-in".to_string(),
            None,
            None,
        )
        .await
        .expect("sale");
        assert_eq!(out_p.quantity_in_stock, 7);

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert_eq!(movements.len(), 2);
    }

    #[tokio::test]
    async fn adjust_stock_rejects_invalid_type() {
        // Input: movement_type "launch".
        // Expected: Err "Invalid movement type".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "launch".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid movement type"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_positive_sale() {
        // Input: sale with +5.
        // Expected: Err "sale quantity must be negative".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("must be negative"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_zero_adjustment() {
        // Input: adjustment with 0 and no expiry date.
        // Expected: Err — zero quantity is only meaningful as an expiry-only
        // adjustment, which requires an expiry date.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("Adjustment quantity cannot be zero"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn adjust_stock_expiry_only_attaches_to_unbatched_stock() {
        // Input: product has 10 unbatched units; adjustment 0 with expiry.
        // Expected: quantity stays 10; one batch covering the 10 units exists.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "first batch".to_string(),
            None,
            None,
        )
        .await
        .expect("plain stock in");

        let p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "attach expiry".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("expiry-only adjustment");
        assert_eq!(
            p.quantity_in_stock, 10,
            "expiry-only must not change quantity"
        );

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert_eq!(batches[0].quantity, 10);
    }

    #[tokio::test]
    async fn adjust_stock_expiry_only_rejected_when_all_batched() {
        // Input: product already fully batched (10 units with an expiry);
        // adjustment 0 with another expiry.
        // Expected: Err — there is no unbatched stock left to attach it to.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("batched stock in");

        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("already has an expiry date"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn adjust_stock_same_expiry_merges_into_single_batch() {
        // Input: +5 then +5 for the same product with the same expiry date.
        // Expected: ONE batch of 10 (not two batches), with a stable batch
        // number and weighted-average unit cost.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "first lot".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("first stock in");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "second lot".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("second stock in");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1, "same expiry must stay one batch");
        assert_eq!(batches[0].quantity, 10);
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert!(
            batches[0].batch_number.as_deref().unwrap_or("").starts_with("B-"),
            "batch number should be generated"
        );
    }

    #[tokio::test]
    async fn adjust_stock_different_expiry_keeps_separate_batches() {
        // Input: +5 expiring 2026-12-31 then +5 expiring 2027-06-30.
        // Expected: two batches — different expiries must stay apart for FIFO.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("first expiry");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2027-06-30".to_string()),
            None,
        )
        .await
        .expect("second expiry");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 2, "different expiries stay separate");
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert_eq!(batches[1].expiry_date, "2027-06-30");
    }

    #[tokio::test]
    async fn adjust_stock_product_not_found() {
        // Input: a random product id.
        // Expected: Err — the DB FK trigger aborts with "Product does not exist".
        let app = owner_app().await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "purchase".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Product does not exist"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_bad_expiry_date() {
        // Input: expiry_date "not-a-date".
        // Expected: Err about date format.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("not-a-date".to_string()),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Cannot read"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // expiry batches + FIFO
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn expiry_batch_created_on_stock_in() {
        // Input: purchase +10 with expiry 2026-01-01.
        // Expected: product gets next_expiry_date; one batch row.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "batch 1".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("stock in with expiry");

        let products = list_products(app.state(), app.state()).await.expect("list");
        assert_eq!(
            products[0].next_expiry_date.as_deref(),
            Some("2026-01-01"),
            "next_expiry_date must be exposed"
        );

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-01-01");
        assert_eq!(batches[0].quantity, 10);
        assert_eq!(
            batches[0].batch_number.as_deref(),
            Some("B-0001"),
            "blank batch number must auto-generate B-0001"
        );
    }

    #[tokio::test]
    async fn adjust_stock_accepts_user_batch_number() {
        // Input: purchase +10 with expiry AND an explicit batch number.
        // Expected: the supplied number is stored on the batch.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "LOT A".to_string(),
            Some("2026-01-01".to_string()),
            Some("LOT-2026-A".to_string()),
        )
        .await
        .expect("stock in with named batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches[0].batch_number.as_deref(), Some("LOT-2026-A"));
    }

    #[tokio::test]
    async fn adjust_stock_rejects_duplicate_batch_number() {
        // Input: two purchases with the same explicit batch number.
        // Expected: second Err "A batch with number 'X' already exists".
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            Some("DUP-1".to_string()),
        )
        .await
        .expect("first named batch");

        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2026-06-01".to_string()),
            Some("DUP-1".to_string()),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "A batch with number 'DUP-1' already exists");
    }

    #[tokio::test]
    async fn fifo_deducts_soonest_batch_first() {
        // Input: batch A (2026-01-01, 10) and batch B (2026-06-01, 10);
        // then a sale of -5.
        // Expected: batch A drops to 5, batch B stays 10.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("batch a");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-06-01".to_string()),
            None,
        )
        .await
        .expect("batch b");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            -5,
            "".to_string(),
            None,
            None,
        )
        .await
        .expect("sale");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].expiry_date, "2026-01-01", "soonest batch first");
        assert_eq!(batches[0].quantity, 5, "FIFO drained from batch A");
        assert_eq!(batches[1].quantity, 10, "batch B untouched");
    }

    #[tokio::test]
    async fn list_expiring_batches_flags_expired_and_expiring() {
        // Input: one expired batch (yesterday) and one expiring soon (tomorrow).
        // Expected: warn window includes both; window 0 only the expired one.
        let today = today();
        let yesterday = (today - chrono::Duration::days(1)).to_string();
        let tomorrow = (today + chrono::Duration::days(1)).to_string();

        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some(yesterday.clone()),
            None,
        )
        .await
        .expect("expired batch");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some(tomorrow.clone()),
            None,
        )
        .await
        .expect("expiring batch");

        let all = list_expiring_batches(app.state(), app.state(), 30)
            .await
            .expect("warn 30d");
        assert_eq!(all.len(), 2, "both batches inside warn window");
        assert!(all.iter().any(|b| b.status == "expired"));
        assert!(all.iter().any(|b| b.status == "expiring"));

        let strict = list_expiring_batches(app.state(), app.state(), 0)
            .await
            .expect("warn 0d");
        assert_eq!(strict.len(), 1, "only truly expired today or before");
        assert_eq!(strict[0].expiry_date, yesterday);
    }

    #[tokio::test]
    async fn write_off_batch_reduces_batch_and_stock() {
        // Input: batch qty 10, write off 4.
        // Expected: batch qty 6, product stock reduced by 4, damage movement.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;
        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2025-01-01".to_string()),
            None,
        )
        .await
        .expect("batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        let batch = &batches[0];

        let updated = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            4,
            "mouldy".to_string(),
        )
        .await
        .expect("write off");
        assert_eq!(updated.quantity, 6);

        let products = list_products(app.state(), app.state()).await.expect("list");
        assert_eq!(products[0].quantity_in_stock, 6, "product stock reduced");

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert!(
            movements.iter().any(|m| m.movement_type == "damage"),
            "damage movement must be recorded"
        );
    }

    #[tokio::test]
    async fn write_off_batch_rejects_invalid_quantity() {
        // Input: quantity 0 and quantity > batch qty.
        // Expected: Err "Invalid write-off quantity".
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;
        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2025-01-01".to_string()),
            None,
        )
        .await
        .expect("batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        let batch = &batches[0];

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            0,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid write-off quantity"), "got: {err}");

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            99,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid write-off quantity"), "got: {err}");
    }

    #[tokio::test]
    async fn write_off_batch_not_found() {
        // Input: a random batch id.
        // Expected: Err "Batch not found".
        let app = owner_app().await;
        let err = write_off_batch(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            1,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Batch not found");
    }

    #[tokio::test]
    async fn list_stock_movements_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_stock_movements(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // deduct_fifo / add_batch (private helpers, direct)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn deduct_fifo_noop_without_batches() {
        // Input: product with no batches, deduct 5.
        // Expected: Ok(()), nothing changes.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Widget", None).await;

        let mut tx = pool.begin().await.unwrap();
        deduct_fifo(&mut tx, "company-x", &p.id, 5)
            .await
            .expect("noop");
        tx.commit().await.unwrap();
    }

    #[tokio::test]
    async fn deduct_fifo_noop_on_zero_quantity() {
        // Input: quantity_out = 0.
        // Expected: Ok(()) immediately.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let mut tx = pool.begin().await.unwrap();
        deduct_fifo(&mut tx, "company-x", "product-x", 0)
            .await
            .expect("noop");
        tx.commit().await.unwrap();
    }

    #[tokio::test]
    async fn add_batch_inserts_row() {
        // Input: add_batch for a company/product.
        // Expected: Ok; the row exists afterwards with a generated number.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(&mut tx, &cid, &p.id, 7, 500, "2026-03-01", "purchase", None)
            .await
            .expect("add batch");
        tx.commit().await.unwrap();

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].quantity, 7);
        assert_eq!(batches[0].unit_cost, 500);
        assert_eq!(
            batches[0].batch_number.as_deref(),
            Some("B-0001"),
            "blank number must auto-generate a sequential batch number"
        );
    }

    #[tokio::test]
    async fn add_batch_keeps_user_supplied_number() {
        // Input: add_batch with an explicit "LOT-7".
        // Expected: the supplied number is stored verbatim.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(
            &mut tx,
            &cid,
            &p.id,
            7,
            500,
            "2026-03-01",
            "purchase",
            Some("LOT-7"),
        )
        .await
        .expect("add batch");
        tx.commit().await.unwrap();

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches[0].batch_number.as_deref(), Some("LOT-7"));
    }

    #[tokio::test]
    async fn add_batch_rejects_duplicate_number() {
        // Input: two add_batch calls with the same explicit number.
        // Expected: second Err "A batch with number 'X' already exists".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(
            &mut tx,
            &cid,
            &p.id,
            5,
            500,
            "2026-03-01",
            "purchase",
            Some("DUP"),
        )
        .await
        .expect("first add batch");
        let err = add_batch(
            &mut tx,
            &cid,
            &p.id,
            3,
            500,
            "2026-03-02",
            "purchase",
            Some("DUP"),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "A batch with number 'DUP' already exists");
        tx.rollback().await.unwrap();
    }

    /// Extracts the current user's company id from the DB (owner registered).
    async fn register_owner_company_id(app: &tauri::App<tauri::test::MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn write_off_depleted_batch_is_rejected() {
        // Input: a batch already at 0 units.
        // Expected: a clear "already depleted" error, NOT "between 1 and 0".
        let app = owner_app().await;
        let company_id = register_owner_company_id(&app).await;
        let product = make_product(&app, "Depleted Item", None).await;
        let pool = app.state::<SqlitePool>();
        let batch_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO stock_batches
                (id, company_id, product_id, quantity, unit_cost, expiry_date, batch_number, source)
            VALUES (?, ?, ?, 0, 0, '2030-01-01', 'DPL', 'adjustment')
            "#,
        )
        .bind(&batch_id)
        .bind(&company_id)
        .bind(&product.id)
        .execute(&*pool)
        .await
        .unwrap();

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch_id.clone(),
            1,
            "test".to_string(),
        )
        .await
        .expect_err("write-off of a depleted batch must fail");

        assert!(
            err.contains("already depleted"),
            "expected a clear depleted message, got: {err}"
        );
    }
}
