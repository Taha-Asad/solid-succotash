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
        SELECT id, company_id, name, description, is_active,
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

    let id = uuid::Uuid::new_v4().to_string();
    let desc = clean_optional(&description);

    sqlx::query(
        r#"
        INSERT INTO categories (id, company_id, name, description)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(&desc)
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

/// Updates a category's name and description. Owner and admin only.
#[tauri::command]
pub async fn update_category(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    category_id: String,
    name: String,
    description: String,
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

    let rows = sqlx::query(
        r#"
        UPDATE categories
        SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(&desc)
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
               unit, custom_fields, is_active, created_at, updated_at
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
    let trimmed_sku = sku.trim().to_string();
    if trimmed_sku.is_empty() {
        return Err("SKU cannot be empty".to_string());
    }

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
    .bind(&trimmed_sku)
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
            format!("SKU '{}' already exists", trimmed_sku)
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

    let trimmed_sku = sku.trim().to_string();
    if trimmed_sku.is_empty() {
        return Err("SKU cannot be empty".to_string());
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
    .bind(&trimmed_sku)
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
            format!("SKU '{}' already exists", trimmed_sku)
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
#[tauri::command]
pub async fn adjust_stock(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
    movement_type: String,
    quantity: i64,
    reference_note: String,
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

    // 3. Commit the transaction
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
