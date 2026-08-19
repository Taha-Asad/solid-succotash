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

    let threshold = if low_stock_threshold <= 0 {
        10
    } else {
        low_stock_threshold
    };

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
        WHERE p.company_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
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
        if is_low {
            low_stock_count += 1;
        }
        if is_out {
            out_of_stock_count += 1;
        }

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

    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            i64,
            i64,
            i64,
            Option<String>,
            Option<String>,
        ),
    >(
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
        WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL
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

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::create_product;
    use crate::commands::invoices::{
        add_invoice_item, create_customer, create_invoice, finalize_invoice, record_payment,
    };
    use crate::commands::test_helpers::{register_owner, setup_app};
    use tauri::Manager;

    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    async fn make_customer(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> crate::commands::invoices::PublicCustomer {
        create_customer(
            app.state(),
            app.state(),
            name.to_string(),
            "cust@test.com".to_string(),
            "0300-111".to_string(),
            "Lahore".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create customer")
    }

    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
        stock: i64,
    ) -> crate::commands::inventory::PublicProduct {
        create_product(
            app.state(),
            app.state(),
            "".to_string(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            stock,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    async fn make_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
        date: &str,
    ) -> crate::commands::invoices::PublicInvoice {
        create_invoice(
            app.state(),
            app.state(),
            customer_id.to_string(),
            date.to_string(),
            "2026-02-14".to_string(),
            "PO-1".to_string(),
            "note".to_string(),
            None,
            None,
        )
        .await
        .expect("create invoice")
    }

    async fn add_item(
        app: &tauri::App<tauri::test::MockRuntime>,
        invoice_id: &str,
        product_id: &str,
        quantity: i64,
        unit_price: i64,
        tax_rate: i64,
    ) {
        add_invoice_item(
            app.state(),
            app.state(),
            invoice_id.to_string(),
            product_id.to_string(),
            quantity,
            unit_price,
            tax_rate,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");
    }

    async fn finalized_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
        product_id: &str,
        quantity: i64,
        unit_price: i64,
        tax_rate: i64,
    ) -> crate::commands::invoices::PublicInvoice {
        let invoice = make_invoice(app, customer_id, "2026-01-15").await;
        add_item(app, &invoice.id, product_id, quantity, unit_price, tax_rate).await;
        finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize")
    }

    async fn cash_payment(
        app: &tauri::App<tauri::test::MockRuntime>,
        invoice_id: &str,
        amount: i64,
    ) -> crate::commands::invoices::PublicInvoice {
        record_payment(
            app.state(),
            app.state(),
            invoice_id.to_string(),
            amount,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .expect("record payment")
    }

    // ---------------------------------------------------------------
    // report_sales_summary
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn sales_summary_empty_company() {
        // Input: fresh company with no invoices.
        // Expected: all counts and amounts are zero.
        let app = owner_app().await;
        let summary = report_sales_summary(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(summary.total_invoices, 0);
        assert_eq!(summary.total_revenue, 0);
        assert_eq!(summary.total_paid, 0);
        assert_eq!(summary.total_outstanding, 0);
        assert_eq!(summary.finalized_count, 0);
    }

    #[tokio::test]
    async fn sales_summary_aggregates_finalized_and_paid() {
        // Input: one finalized invoice (2×1000) plus a partial 500 payment.
        // Expected: revenue 2000, paid 500, outstanding 1500, finalized count 1.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        let invoice = finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;
        cash_payment(&app, &invoice.id, 500).await;

        let summary = report_sales_summary(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(summary.total_invoices, 1);
        assert_eq!(summary.total_revenue, 2000);
        assert_eq!(summary.total_tax, 0);
        assert_eq!(summary.total_discount, 0);
        assert_eq!(summary.total_paid, 500);
        assert_eq!(summary.total_outstanding, 1500);
        assert_eq!(summary.draft_count, 0);
        assert_eq!(summary.finalized_count, 1);
        assert_eq!(summary.paid_count, 0);
        assert_eq!(summary.cancelled_count, 0);
    }

    #[tokio::test]
    async fn sales_summary_counts_draft_invoices() {
        // Input: one draft invoice alongside one finalized invoice.
        // Expected: total_invoices 2, draft_count 1, finalized_count 1.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;
        make_invoice(&app, &customer.id, "2026-01-15").await;

        let summary = report_sales_summary(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(summary.total_invoices, 2);
        assert_eq!(summary.draft_count, 1);
        assert_eq!(summary.finalized_count, 1);
    }

    #[tokio::test]
    async fn sales_summary_requires_login() {
        // Input: no user logged in.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = report_sales_summary(app.state(), app.state())
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    // ---------------------------------------------------------------
    // report_sales_by_month
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn sales_by_month_empty_company() {
        // Input: no invoices.
        // Expected: empty vec.
        let app = owner_app().await;
        let rows = report_sales_by_month(app.state(), app.state())
            .await
            .expect("report");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn sales_by_month_groups_by_month() {
        // Input: two invoices dated 2026-01-15 and 2026-01-31.
        // Expected: one period "2026-01" with invoice_count 2, revenue sum.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        finalized_invoice(&app, &customer.id, &product.id, 1, 1000, 0).await;

        let invoice2 = make_invoice(&app, &customer.id, "2026-01-31").await;
        add_item(&app, &invoice2.id, &product.id, 1, 500, 0).await;
        finalize_invoice(app.state(), app.state(), invoice2.id.clone())
            .await
            .expect("finalize 2");

        let rows = report_sales_by_month(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].period, "2026-01");
        assert_eq!(rows[0].invoice_count, 2);
        assert_eq!(rows[0].revenue, 1500);
    }

    #[tokio::test]
    async fn sales_by_month_excludes_cancelled() {
        // Input: a finalized invoice and a cancelled invoice in the same month.
        // Expected: cancelled is excluded from both count and revenue.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;

        let cancelled = make_invoice(&app, &customer.id, "2026-01-20").await;
        add_item(&app, &cancelled.id, &product.id, 1, 9999, 0).await;
        let pool = app.state::<SqlitePool>();
        sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = ?")
            .bind(&cancelled.id)
            .execute(&*pool)
            .await
            .expect("cancel invoice");

        let rows = report_sales_by_month(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].invoice_count, 1);
        assert_eq!(rows[0].revenue, 2000);
    }

    // ---------------------------------------------------------------
    // report_top_products
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn top_products_empty_company() {
        // Input: no invoice items.
        // Expected: empty vec.
        let app = owner_app().await;
        let rows = report_top_products(app.state(), app.state())
            .await
            .expect("report");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn top_products_orders_by_revenue() {
        // Input: product A sold 2×1000, product B sold 1×1000.
        // Expected: A first with quantity 2 and revenue 2000.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let a = make_product(&app, "Alpha", 10).await;
        let b = make_product(&app, "Beta", 10).await;
        finalized_invoice(&app, &customer.id, &a.id, 2, 1000, 0).await;

        let invoice_b = make_invoice(&app, &customer.id, "2026-01-16").await;
        add_item(&app, &invoice_b.id, &b.id, 1, 1000, 0).await;
        finalize_invoice(app.state(), app.state(), invoice_b.id.clone())
            .await
            .expect("finalize B");

        let rows = report_top_products(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].product_id, a.id);
        assert_eq!(rows[0].total_quantity_sold, 2);
        assert_eq!(rows[0].total_revenue, 2000);
        assert_eq!(rows[1].product_id, b.id);
    }

    // ---------------------------------------------------------------
    // report_top_customers
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn top_customers_empty_company() {
        // Input: no customers.
        // Expected: empty vec.
        let app = owner_app().await;
        let rows = report_top_customers(app.state(), app.state())
            .await
            .expect("report");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn top_customers_aggregates_invoice_totals() {
        // Input: one customer with a finalized invoice (2×1000) + 500 payment.
        // Expected: 1 invoice, revenue 2000, paid 500, balance 1500.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        let invoice = finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;
        cash_payment(&app, &invoice.id, 500).await;

        let rows = report_top_customers(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].customer_id, customer.id);
        assert_eq!(rows[0].total_invoices, 1);
        assert_eq!(rows[0].total_revenue, 2000);
        assert_eq!(rows[0].total_paid, 500);
        assert_eq!(rows[0].balance_due, 1500);
    }

    #[tokio::test]
    async fn top_customers_includes_customer_without_invoices() {
        // Input: a customer that has never been invoiced.
        // Expected: still listed with zero totals (LEFT JOIN).
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;

        let rows = report_top_customers(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].customer_id, customer.id);
        assert_eq!(rows[0].total_invoices, 0);
        assert_eq!(rows[0].total_revenue, 0);
    }

    // ---------------------------------------------------------------
    // report_stock
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn stock_report_empty_company() {
        // Input: no products.
        // Expected: all zeros and no items.
        let app = owner_app().await;
        let summary = report_stock(app.state(), app.state(), 10)
            .await
            .expect("report");
        assert_eq!(summary.total_products, 0);
        assert_eq!(summary.total_stock_units, 0);
        assert!(summary.items.is_empty());
    }

    #[tokio::test]
    async fn stock_report_flags_low_and_out_of_stock() {
        // Input: products with stock 5, 15 and 0; threshold 10.
        // Expected: 2 low (5, 0), 1 out of stock (0), totals summed.
        let app = owner_app().await;
        make_product(&app, "Low", 5).await;
        make_product(&app, "Ok", 15).await;
        make_product(&app, "Empty", 0).await;

        let summary = report_stock(app.state(), app.state(), 10)
            .await
            .expect("report");
        assert_eq!(summary.total_products, 3);
        assert_eq!(summary.total_stock_units, 20);
        assert_eq!(summary.low_stock_count, 2);
        assert_eq!(summary.out_of_stock_count, 1);
        assert_eq!(summary.total_value_at_cost, 5 * 500 + 15 * 500);
        assert_eq!(summary.total_value_at_sell, 5 * 700 + 15 * 700);

        let low = summary
            .items
            .iter()
            .find(|i| i.product_name == "Low")
            .unwrap();
        assert!(low.is_low_stock);
        let ok = summary
            .items
            .iter()
            .find(|i| i.product_name == "Ok")
            .unwrap();
        assert!(!ok.is_low_stock);
        let empty = summary
            .items
            .iter()
            .find(|i| i.product_name == "Empty")
            .unwrap();
        assert!(empty.is_low_stock);
        assert_eq!(empty.stock_value_at_cost, 0);
    }

    #[tokio::test]
    async fn stock_report_defaults_threshold_to_ten() {
        // Input: product with stock 10 and threshold 0.
        // Expected: threshold falls back to 10, so stock 10 IS low.
        let app = owner_app().await;
        make_product(&app, "Edge", 10).await;

        let summary = report_stock(app.state(), app.state(), 0)
            .await
            .expect("report");
        assert_eq!(summary.low_stock_count, 1);
        assert!(summary.items[0].is_low_stock);
    }

    #[tokio::test]
    async fn stock_report_excludes_soft_deleted_products() {
        // Input: two products, one soft-deleted.
        // Expected: only the live product is counted — deleted stock must
        // not leak into reports (matches the inventory list).
        let app = owner_app().await;
        let live = make_product(&app, "Live", 40).await;
        let gone = make_product(&app, "Gone", 999).await;

        crate::commands::inventory::delete_product(app.state(), app.state(), gone.id.clone())
            .await
            .expect("delete product");

        let summary = report_stock(app.state(), app.state(), 10)
            .await
            .expect("report");
        assert_eq!(summary.total_products, 1);
        assert_eq!(summary.total_stock_units, 40);
        assert_eq!(summary.items.len(), 1);
        assert_eq!(summary.items[0].product_id, live.id);

        let movements = report_product_movements(app.state(), app.state())
            .await
            .expect("movements");
        assert_eq!(movements.len(), 1);
        assert_eq!(movements[0].product_id, live.id);
        assert_eq!(movements[0].current_stock, 40);
    }

    // ---------------------------------------------------------------
    // report_profit_loss
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn profit_loss_empty_company() {
        // Input: no finalized/paid invoices.
        // Expected: all zero, margin 0.
        let app = owner_app().await;
        let report = report_profit_loss(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(report.total_revenue, 0);
        assert_eq!(report.total_cost, 0);
        assert_eq!(report.gross_profit, 0);
        assert_eq!(report.profit_margin_pct, 0.0);
    }

    #[tokio::test]
    async fn profit_loss_computes_margin() {
        // Input: finalized invoice 2×1000 sold (revenue 2000); cost price 500/unit.
        // Expected: cost 1000, gross profit 1000, margin 50%.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;

        let report = report_profit_loss(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(report.total_revenue, 2000);
        assert_eq!(report.total_cost, 1000);
        assert_eq!(report.gross_profit, 1000);
        assert_eq!(report.profit_margin_pct, 50.0);
        assert_eq!(report.total_tax_collected, 0);
        assert_eq!(report.total_discounts_given, 0);
    }

    #[tokio::test]
    async fn profit_loss_ignores_drafts() {
        // Input: a draft invoice with items (not finalized).
        // Expected: revenue stays 0 — drafts are excluded.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        let invoice = make_invoice(&app, &customer.id, "2026-01-15").await;
        add_item(&app, &invoice.id, &product.id, 2, 1000, 0).await;

        let report = report_profit_loss(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(report.total_revenue, 0);
    }

    // ---------------------------------------------------------------
    // report_customer_ledger
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn customer_ledger_empty_company() {
        // Input: a customer with no invoices.
        // Expected: excluded by HAVING SUM(grand_total) > 0.
        let app = owner_app().await;
        make_customer(&app, "Walk-in").await;

        let rows = report_customer_ledger(app.state(), app.state())
            .await
            .expect("report");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn customer_ledger_lists_balances() {
        // Input: customer with a finalized 2×1000 invoice and 500 payment.
        // Expected: invoiced 2000, paid 500, balance 1500, invoice_count 1.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        let invoice = finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;
        cash_payment(&app, &invoice.id, 500).await;

        let rows = report_customer_ledger(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].customer_id, customer.id);
        assert_eq!(rows[0].total_invoiced, 2000);
        assert_eq!(rows[0].total_paid, 500);
        assert_eq!(rows[0].balance_due, 1500);
        assert_eq!(rows[0].invoice_count, 1);
        assert_eq!(rows[0].last_invoice_date.as_deref(), Some("2026-01-15"));
    }

    // ---------------------------------------------------------------
    // report_product_movements
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn product_movements_empty_company() {
        // Input: no products.
        // Expected: empty vec.
        let app = owner_app().await;
        let rows = report_product_movements(app.state(), app.state())
            .await
            .expect("report");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn product_movements_sums_purchases_and_sales() {
        // Input: product with a 2-unit sale (finalized invoice) and a 5-unit
        // purchase (adjust_stock).
        // Expected: total_sold 2, total_purchased 5, current_stock 13.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        finalized_invoice(&app, &customer.id, &product.id, 2, 1000, 0).await;

        crate::commands::inventory::adjust_stock(
            app.state(),
            app.state(),
            product.id.clone(),
            "purchase".to_string(),
            5,
            "restock".to_string(),
            None,
            None,
        )
        .await
        .expect("adjust stock");

        let rows = report_product_movements(app.state(), app.state())
            .await
            .expect("report");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].product_id, product.id);
        assert_eq!(rows[0].total_sold, 2);
        assert_eq!(rows[0].total_purchased, 5);
        assert_eq!(rows[0].current_stock, 13);
    }
}
