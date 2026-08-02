// ==========================================
// REPORTS COMMANDS
// ==========================================
//
// All reports are read-only queries against existing data.
// No new tables needed — reports aggregate what's already there.
//
// Every report:
//   1. Authenticates the user
//   2. Filters by the user's company
//   3. Returns structured data for the frontend to display

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

// ==========================================
// REPORT TYPES
// ==========================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesSummary {
    pub total_invoices: i64,
    pub total_revenue: i64,
    pub total_tax: i64,
    pub total_discount: i64,
    pub total_paid: i64,
    pub total_outstanding: i64,
    pub draft_count: i64,
    pub finalized_count: i64,
    pub paid_count: i64,
    pub cancelled_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesByPeriod {
    pub period: String, // "2024-01" or "2024-01-15"
    pub invoice_count: i64,
    pub revenue: i64,
    pub tax: i64,
    pub paid: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopProduct {
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub total_quantity_sold: i64,
    pub total_revenue: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopCustomer {
    pub customer_id: String,
    pub customer_name: String,
    pub total_invoices: i64,
    pub total_revenue: i64,
    pub total_paid: i64,
    pub balance_due: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockReportItem {
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub category_name: Option<String>,
    pub quantity_in_stock: i64,
    pub cost_price: i64,
    pub sell_price: i64,
    pub stock_value_at_cost: i64,
    pub stock_value_at_sell: i64,
    pub is_low_stock: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSummary {
    pub total_products: i64,
    pub total_stock_units: i64,
    pub total_value_at_cost: i64,
    pub total_value_at_sell: i64,
    pub low_stock_count: i64,
    pub out_of_stock_count: i64,
    pub items: Vec<StockReportItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitLossSummary {
    pub total_revenue: i64,
    pub total_cost: i64,
    pub gross_profit: i64,
    pub profit_margin_pct: f64,
    pub total_tax_collected: i64,
    pub total_discounts_given: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerLedgerEntry {
    pub customer_id: String,
    pub customer_name: String,
    pub total_invoiced: i64,
    pub total_paid: i64,
    pub balance_due: i64,
    pub invoice_count: i64,
    pub last_invoice_date: Option<String>,
    pub last_payment_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductMovement {
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub total_purchased: i64,
    pub total_sold: i64,
    pub total_adjusted: i64,
    pub total_returned: i64,
    pub total_damaged: i64,
    pub current_stock: i64,
}

// ==========================================
// REPORT COMMANDS
// ==========================================

/// Sales summary for the company
#[tauri::command]
pub async fn report_sales_summary(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<SalesSummary, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let row = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64)>(
        r#"
        SELECT
            COUNT(*),
            COALESCE(SUM(grand_total), 0),
            COALESCE(SUM(tax_total), 0),
            COALESCE(SUM(discount_total), 0),
            COALESCE(SUM(amount_paid), 0),
            COALESCE(SUM(balance_due), 0),
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)
        FROM invoices
        WHERE company_id = ?
        "#,
    )
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    Ok(SalesSummary {
        total_invoices: row.0,
        total_revenue: row.1,
        total_tax: row.2,
        total_discount: row.3,
        total_paid: row.4,
        total_outstanding: row.5,
        draft_count: row.6,
        finalized_count: row.7,
        paid_count: row.8,
        cancelled_count: row.9,
    })
}

/// Sales broken down by month
#[tauri::command]
pub async fn report_sales_by_month(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<SalesByPeriod>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(
        r#"
        SELECT
            SUBSTR(invoice_date, 1, 7) as month,
            COUNT(*),
            COALESCE(SUM(grand_total), 0),
            COALESCE(SUM(tax_total), 0),
            COALESCE(SUM(amount_paid), 0)
        FROM invoices
        WHERE company_id = ? AND status != 'cancelled'
        GROUP BY SUBSTR(invoice_date, 1, 7)
        ORDER BY month DESC
        LIMIT 12
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(period, count, revenue, tax, paid)| SalesByPeriod {
            period,
            invoice_count: count,
            revenue,
            tax,
            paid,
        })
        .collect())
}

/// Top selling products
#[tauri::command]
pub async fn report_top_products(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<TopProduct>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, (String, String, String, i64, i64)>(
        r#"
        SELECT
            ii.product_id,
            ii.product_name,
            ii.product_sku,
            SUM(ii.quantity),
            SUM(ii.line_total)
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.company_id = ? AND i.status != 'cancelled'
        GROUP BY ii.product_id
        ORDER BY SUM(ii.line_total) DESC
        LIMIT 20
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(id, name, sku, qty, revenue)| TopProduct {
            product_id: id,
            product_name: name,
            product_sku: sku,
            total_quantity_sold: qty,
            total_revenue: revenue,
        })
        .collect())
}

/// Top customers by revenue
#[tauri::command]
pub async fn report_top_customers(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<TopCustomer>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(
        r#"
        SELECT
            c.id,
            c.name,
            COUNT(i.id),
            COALESCE(SUM(i.grand_total), 0),
            COALESCE(SUM(i.amount_paid), 0),
            COALESCE(SUM(i.balance_due), 0)
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
        WHERE c.company_id = ?
        GROUP BY c.id
        ORDER BY SUM(i.grand_total) DESC
        LIMIT 20
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(id, name, count, revenue, paid, balance)| TopCustomer {
            customer_id: id,
            customer_name: name,
            total_invoices: count,
            total_revenue: revenue,
            total_paid: paid,
            balance_due: balance,
        })
        .collect())
}

/// Stock report — current inventory levels
#[tauri::command]
pub async fn report_stock(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    low_stock_threshold: i64,
) -> Result<StockSummary, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let threshold = if low_stock_threshold <= 0 { 10 } else { low_stock_threshold };

    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, i64, i64, i64)>(
        r#"
        SELECT
            p.id, p.name, p.sku,
            c.name,
            p.quantity_in_stock,
            p.cost_price,
            p.sell_price
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.company_id = ? AND p.is_active = 1
        ORDER BY p.name
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    let mut items: Vec<StockReportItem> = Vec::new();
    let mut total_units: i64 = 0;
    let mut total_cost_value: i64 = 0;
    let mut total_sell_value: i64 = 0;
    let mut low_stock_count: i64 = 0;
    let mut out_of_stock_count: i64 = 0;

    for (id, name, sku, cat, qty, cost, sell) in &rows {
        let is_low = *qty <= threshold;
        let is_out = *qty <= 0;
        let value_cost = qty * cost;
        let value_sell = qty * sell;

        total_units += qty;
        total_cost_value += value_cost;
        total_sell_value += value_sell;
        if is_low { low_stock_count += 1; }
        if is_out { out_of_stock_count += 1; }

        items.push(StockReportItem {
            product_id: id.clone(),
            product_name: name.clone(),
            product_sku: sku.clone(),
            category_name: cat.clone(),
            quantity_in_stock: *qty,
            cost_price: *cost,
            sell_price: *sell,
            stock_value_at_cost: value_cost,
            stock_value_at_sell: value_sell,
            is_low_stock: is_low,
        });
    }

    Ok(StockSummary {
        total_products: rows.len() as i64,
        total_stock_units: total_units,
        total_value_at_cost: total_cost_value,
        total_value_at_sell: total_sell_value,
        low_stock_count,
        out_of_stock_count,
        items,
    })
}

/// Profit & Loss report
#[tauri::command]
pub async fn report_profit_loss(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<ProfitLossSummary, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    // Revenue from finalized/paid invoices
    let revenue_row = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        r#"
        SELECT
            COALESCE(SUM(ii.line_total), 0),
            COALESCE(SUM(ii.quantity * p.cost_price), 0),
            COALESCE(SUM(i.tax_total), 0),
            COALESCE(SUM(i.discount_total), 0)
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        JOIN products p ON p.id = ii.product_id
        WHERE i.company_id = ? AND i.status IN ('finalized', 'paid')
        "#,
    )
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    let total_revenue = revenue_row.0;
    let total_cost = revenue_row.1;
    let gross_profit = total_revenue - total_cost;
    let profit_margin = if total_revenue > 0 {
        (gross_profit as f64 / total_revenue as f64) * 100.0
    } else {
        0.0
    };

    Ok(ProfitLossSummary {
        total_revenue,
        total_cost,
        gross_profit,
        profit_margin_pct: (profit_margin * 100.0).round() / 100.0,
        total_tax_collected: revenue_row.2,
        total_discounts_given: revenue_row.3,
    })
}

/// Customer ledger — who owes what
#[tauri::command]
pub async fn report_customer_ledger(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<CustomerLedgerEntry>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, (String, String, i64, i64, i64, Option<String>, Option<String>)>(
        r#"
        SELECT
            c.id,
            c.name,
            COALESCE(SUM(i.grand_total), 0),
            COALESCE(SUM(i.amount_paid), 0),
            COALESCE(SUM(i.balance_due), 0),
            MAX(i.invoice_date),
            NULL
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
        WHERE c.company_id = ?
        GROUP BY c.id
        HAVING SUM(i.grand_total) > 0
        ORDER BY SUM(i.balance_due) DESC
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    // Get last payment date for each customer
    let mut entries: Vec<CustomerLedgerEntry> = Vec::new();
    for (id, name, invoiced, paid, balance, last_inv, _) in &rows {
        let last_payment = sqlx::query_scalar::<_, String>(
            r#"
            SELECT MAX(pr.payment_date)
            FROM payment_records pr
            JOIN invoices i ON i.id = pr.invoice_id
            WHERE i.customer_id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(pool.inner())
        .await
        .unwrap_or(None);

        let invoice_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM invoices WHERE customer_id = ? AND status != 'cancelled'",
        )
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .unwrap_or(0);

        entries.push(CustomerLedgerEntry {
            customer_id: id.clone(),
            customer_name: name.clone(),
            total_invoiced: *invoiced,
            total_paid: *paid,
            balance_due: *balance,
            invoice_count,
            last_invoice_date: last_inv.clone(),
            last_payment_date: last_payment,
        });
    }

    Ok(entries)
}

/// Product movement report — stock in/out per product
#[tauri::command]
pub async fn report_product_movements(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<ProductMovement>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("Not assigned to a company")?;

    let rows = sqlx::query_as::<_, (String, String, String, i64)>(
        r#"
        SELECT id, name, sku, quantity_in_stock
        FROM products
        WHERE company_id = ? AND is_active = 1
        ORDER BY name
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Report error: {e}"))?;

    let mut movements: Vec<ProductMovement> = Vec::new();

    for (id, name, sku, current_stock) in &rows {
        let stock_data = sqlx::query_as::<_, (String, i64)>(
            r#"
            SELECT movement_type, SUM(quantity)
            FROM stock_movements
            WHERE product_id = ? AND company_id = ?
            GROUP BY movement_type
            "#,
        )
        .bind(id)
        .bind(company_id)
        .fetch_all(pool.inner())
        .await
        .unwrap_or_default();

        let mut purchased: i64 = 0;
        let mut sold: i64 = 0;
        let mut adjusted: i64 = 0;
        let mut returned: i64 = 0;
        let mut damaged: i64 = 0;

        for (mtype, qty) in &stock_data {
            match mtype.as_str() {
                "purchase" => purchased += qty.abs(),
                "sale" => sold += qty.abs(),
                "adjustment" => adjusted += *qty,
                "return" => returned += qty.abs(),
                "damage" => damaged += qty.abs(),
                _ => {}
            }
        }

        movements.push(ProductMovement {
            product_id: id.clone(),
            product_name: name.clone(),
            product_sku: sku.clone(),
            total_purchased: purchased,
            total_sold: sold,
            total_adjusted: adjusted,
            total_returned: returned,
            total_damaged: damaged,
            current_stock: *current_stock,
        });
    }

    Ok(movements)
}
