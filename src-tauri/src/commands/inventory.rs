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

use crate::commands::auth::{require_current_user, SessionState};
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
                Some(p) if !p.trim().is_empty() => {
                    p.trim().chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>()
                }
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
               created_at, updated_at
        FROM categories
        WHERE company_id = ?
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

    // Only owner and admin can create categories
    if current_user.role == "employee" {
        return Err("Employees cannot create categories".to_string());
    }

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

    Ok(category)
}

/// Updates a category's name, description and SKU prefix. Owner and admin only.
#[tauri::command]
pub async fn update_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
    name: String,
    description: String,
    sku_prefix: String,
) -> Result<PublicCategory, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role == "employee" {
        return Err("Employees cannot update categories".to_string());
    }

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

    let category = sqlx::query_as::<_, PublicCategory>("SELECT * FROM categories WHERE id = ?")
        .bind(&category_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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

    if current_user.role == "employee" {
        return Err("Employees cannot manage categories".to_string());
    }

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
               created_at, updated_at
        FROM suppliers
        WHERE company_id = ?
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

    if current_user.role == "employee" {
        return Err("Employees cannot create suppliers".to_string());
    }

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

    Ok(supplier)
}

/// Updates a supplier. Owner and admin only.
#[tauri::command]
pub async fn update_supplier(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    supplier_id: String,
    name: String,
    contact_person: String,
    email: String,
    phone: String,
    address: String,
    tax_number: String,
) -> Result<PublicSupplier, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role == "employee" {
        return Err("Employees cannot update suppliers".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Supplier name cannot be empty".to_string());
    }

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

    let supplier = sqlx::query_as::<_, PublicSupplier>("SELECT * FROM suppliers WHERE id = ?")
        .bind(&supplier_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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

    if current_user.role == "employee" {
        return Err("Employees cannot manage suppliers".to_string());
    }

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
               unit, custom_fields, is_active, created_at, updated_at,
               (SELECT expiry_date FROM stock_batches b
                WHERE b.product_id = products.id AND b.quantity > 0
                ORDER BY b.expiry_date ASC LIMIT 1) AS next_expiry_date
        FROM products
        WHERE company_id = ?
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

    if current_user.role == "employee" {
        return Err("Employees cannot create products".to_string());
    }

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
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("SKU '{}' already exists", final_sku)
        } else {
            format!("Database error: {msg}")
        }
    })?;

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

    Ok(product)
}

/// Updates an existing product. Owner and admin only.
/// Does NOT change quantity_in_stock — use adjust_stock for that.
#[tauri::command]
pub async fn update_product(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
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

    if current_user.role == "employee" {
        return Err("Employees cannot update products".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let mut final_sku = sku.trim().to_string();

    // If the user left SKU blank on edit, keep the current value.
    if final_sku.is_empty() {
        let existing_sku: Option<String> = sqlx::query_scalar(
            "SELECT sku FROM products WHERE id = ? AND company_id = ?",
        )
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
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("SKU '{}' already exists", final_sku)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    if rows.rows_affected() == 0 {
        return Err("Product not found".to_string());
    }

    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;

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
#[tauri::command]
pub async fn adjust_stock(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
    movement_type: String,
    quantity: i64,
    reference_note: String,
    expiry_date: Option<String>,
) -> Result<PublicProduct, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    // Only owner and admin can adjust stock
    if current_user.role == "employee" {
        return Err("Employees cannot adjust stock".to_string());
    }

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
            if quantity == 0 {
                return Err("Adjustment quantity cannot be zero".to_string());
            }
        }
        _ => unreachable!(),
    }

    let note = clean_optional(&reference_note);

    // Parse expiry date up front (if provided) so we never create a
    // partial transaction on bad input.
    let normalized_expiry: Option<String> = match &expiry_date {
        Some(value) if !value.trim().is_empty() => {
            Some(crate::commands::expiry::parse_expiry_date(value)?)
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

            crate::commands::expiry::add_batch(
                &mut tx,
                company_id,
                &product_id,
                quantity,
                unit_cost,
                expiry,
                &movement_type,
            )
            .await?;
        }
    }

    // 3b. Stock OUT → deduct FIFO from the soonest-expiring batches
    //     first (only matters for expiry-tracked products).
    if quantity < 0 {
        crate::commands::expiry::deduct_fifo(
            &mut tx,
            company_id,
            &product_id,
            -quantity,
        )
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
