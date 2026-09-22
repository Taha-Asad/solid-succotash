use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::commands::audit::log_audit;
use crate::error::AppError;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::{bump_version, check_permission, check_version, soft_delete};

use super::helpers::{clean_optional, generate_sku, map_product_db_error};
use super::types::{PublicProduct, PublicStockMovement};

// ==========================================

/// Lists all products for the current user's company.
/// Returns products sorted by name.
#[tauri::command]
pub async fn list_products(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicProduct>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

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
) -> Result<PublicProduct, AppError> {
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
        return Err(AppError::internal("Product name cannot be empty".to_string()));
    }

    if cost_price < 0 {
        return Err(AppError::internal("Cost price cannot be negative".to_string()));
    }

    if sell_price < 0 {
        return Err(AppError::internal("Sell price cannot be negative".to_string()));
    }

    if quantity_in_stock < 0 {
        return Err(AppError::internal("Initial stock cannot be negative".to_string()));
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
        .map_err(|e| AppError::internal(format!("Failed to record stock movement: {e}")))?;
    }

    // ---- Return created product ----
    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
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
) -> Result<PublicProduct, AppError> {
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
                .map_err(|e| AppError::internal(format!("Database error: {e}")))?;
        final_sku = existing_sku.ok_or("Product not found")?;
    }

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::internal("Product name cannot be empty".to_string()));
    }

    if cost_price < 0 || sell_price < 0 {
        return Err(AppError::internal("Prices cannot be negative".to_string()));
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
        return Err(AppError::internal("Product not found".to_string()));
    }

    bump_version(pool.inner(), "products", &product_id).await?;

    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&product_id)
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
) -> Result<PublicProduct, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate movement type
    let valid_types = ["purchase", "sale", "adjustment", "return", "damage"];
    if !valid_types.contains(&movement_type.as_str()) {
        return Err(AppError::internal(format!(
            "Invalid movement type '{}'. Must be one of: {}",
            movement_type,
            valid_types.join(", ")
        )));
    }

    // Validate quantity direction
    // purchase, return, adjustment → positive (stock IN)
    // sale, damage → negative (stock OUT)
    match movement_type.as_str() {
        "purchase" | "return" => {
            if quantity <= 0 {
                return Err(AppError::internal(format!(
                    "{} quantity must be positive (stock coming IN)",
                    movement_type
                )));
            }
        }
        "sale" | "damage" => {
            if quantity >= 0 {
                return Err(AppError::internal(format!(
                    "{} quantity must be negative (stock going OUT)",
                    movement_type
                )));
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
                return Err(AppError::validation(
                    "Adjustment quantity cannot be zero — set an Expiry Date to attach it to current stock without changing quantity",
                ));
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
        .map_err(|e| AppError::internal(format!("Failed to start transaction: {e}")))?;

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
    .map_err(|e| AppError::internal(format!("Failed to record movement: {e}")))?;

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
    .map_err(|e| AppError::internal(format!("Failed to update stock: {e}")))?;

    if rows.rows_affected() == 0 {
        return Err(AppError::internal("Product not found".to_string()));
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
            .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;

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
            .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;

            if unbatched <= 0 {
                return Err(AppError::validation(
                    "All current stock already has an expiry date — nothing left to attach it to",
                ));
            }

            let unit_cost: i64 = sqlx::query_scalar(
                "SELECT cost_price FROM products WHERE id = ? AND company_id = ?",
            )
            .bind(&product_id)
            .bind(company_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Product lookup error: {e}")))?;

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
        .map_err(|e| AppError::internal(format!("Failed to commit transaction: {e}")))?;

    // 4. Return updated product
    let product = sqlx::query_as::<_, PublicProduct>("SELECT * FROM products WHERE id = ?")
        .bind(&product_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

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
) -> Result<Vec<serde_json::Value>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

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
) -> Result<Vec<PublicStockMovement>, AppError> {
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
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(movements)
}

// ==========================================

/// Soft-deletes a product. Owner and admin only.
#[tauri::command]
pub async fn delete_product(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    product_id: String,
) -> Result<(), AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = soft_delete(pool.inner(), "products", &product_id, company_id).await?;

    if rows_affected == 0 {
        return Err(AppError::internal("Product not found".to_string()));
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
        "Deleted product",
    )
    .await;

    Ok(())
}

// ==========================================
// TESTS
// ==========================================

