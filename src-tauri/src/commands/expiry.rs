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

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

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
        quantity: raw.quantity,
        unit_cost: raw.unit_cost,
        expiry_date: raw.expiry_date,
        source: raw.source,
        status,
        created_at: raw.created_at,
    }
}

/// Creates a stock batch inside the caller's transaction.
/// Used by stock IN with an expiry date (manual adjustments, purchases).
pub async fn add_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
    product_id: &str,
    quantity: i64,
    unit_cost: i64,
    expiry_date: &str,
    source: &str,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO stock_batches
            (id, company_id, product_id, quantity, unit_cost, expiry_date, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(product_id)
    .bind(quantity)
    .bind(unit_cost)
    .bind(expiry_date)
    .bind(source)
    .execute(&mut **tx)
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
        return Err(format!("Cannot read expiry date '{v}'. Use YYYY-MM-DD or DD/MM/YYYY"));
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
               b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
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
               b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
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

    if user.role == "employee" {
        return Err("Employees cannot write off stock".to_string());
    }

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
               b.quantity, b.unit_cost, b.expiry_date, b.source, b.created_at
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
    Ok(to_public(updated, status))
}
