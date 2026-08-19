// ==========================================
// REPORT EXPORT — CSV / PDF
// ==========================================
//
// Exports report data as CSV files that can be opened in Excel.
// The frontend calls saveFileDialog() to let the user pick where to save.

use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::pdf::{PdfColumn, PdfDoc};
use sqlx::SqlitePool;
use tauri::State;

/// Loads company name + tagline for PDF branding.
async fn company_branding(pool: &SqlitePool, company_id: &str) -> (String, String) {
    let name = sqlx::query_scalar::<_, String>("SELECT name FROM companies WHERE id = ?")
        .bind(company_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "My Company".to_string());

    let tagline = sqlx::query_scalar::<_, String>(
        "SELECT company_tagline FROM company_theme WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    (name, tagline)
}

fn format_currency(paisa: i64, symbol: &str) -> String {
    format!("{symbol} {:.2}", paisa as f64 / 100.0)
}

/// Exports the stock report as CSV
#[tauri::command]
pub async fn export_stock_csv(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    save_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "reports", "export").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, i64, i64, i64)>(
        r#"
        SELECT p.sku, p.name, COALESCE(c.name, ''), cat.name,
               p.quantity_in_stock, p.cost_price, p.sell_price
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.company_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
        ORDER BY p.name
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    let mut csv =
        String::from("SKU,Product Name,Category,Stock,Cost Price,Sell Price,Stock Value (Cost)\n");
    for (sku, name, cat, _, qty, cost, sell) in &rows {
        let value = qty * cost;
        csv.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            escape_csv(sku),
            escape_csv(name),
            escape_csv(cat),
            qty,
            cost,
            sell,
            value
        ));
    }

    std::fs::write(&save_path, &csv).map_err(|e| format!("Write error: {e}"))?;
    Ok(save_path)
}

/// Exports the customer ledger as CSV
#[tauri::command]
pub async fn export_customer_ledger_csv(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    save_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "reports", "export").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query_as::<_, (String, String, i64, i64, i64)>(
        r#"
        SELECT c.name, COALESCE(c.phone, ''),
               COALESCE(SUM(i.grand_total), 0),
               COALESCE(SUM(i.amount_paid), 0),
               COALESCE(SUM(i.balance_due), 0)
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
        WHERE c.company_id = ? AND c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY SUM(i.balance_due) DESC
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    let mut csv = String::from("Customer Name,Phone,Total Invoiced,Total Paid,Balance Due\n");
    for (name, phone, invoiced, paid, balance) in &rows {
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            escape_csv(name),
            escape_csv(phone),
            invoiced,
            paid,
            balance
        ));
    }

    std::fs::write(&save_path, &csv).map_err(|e| format!("Write error: {e}"))?;
    Ok(save_path)
}

/// Exports the sales report as CSV
#[tauri::command]
pub async fn export_sales_csv(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    save_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "reports", "export").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let rows = sqlx::query_as::<_, (String, String, String, i64, i64, i64, String)>(
        r#"
        SELECT i.invoice_number, i.invoice_date, c.name,
               i.grand_total, i.amount_paid, i.balance_due, i.status
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE i.company_id = ? AND i.deleted_at IS NULL
        ORDER BY i.invoice_date DESC
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Error: {e}"))?;

    let mut csv = String::from("Invoice #,Date,Customer,Total,Paid,Balance,Status\n");
    for (num, date, cust, total, paid, balance, status) in &rows {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            escape_csv(num),
            escape_csv(date),
            escape_csv(cust),
            total,
            paid,
            balance,
            status
        ));
    }

    std::fs::write(&save_path, &csv).map_err(|e| format!("Write error: {e}"))?;
    Ok(save_path)
}

fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Exports a report as a formatted PDF.
/// `report` is one of "sales" | "stock" | "ledger".
#[tauri::command]
pub async fn export_report_pdf(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    report: String,
    save_path: String,
) -> Result<String, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    check_permission(pool.inner(), &user.role, "reports", "export").await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let (company_name, tagline) = company_branding(pool.inner(), company_id).await;

    let currency_symbol = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(cc.symbol, 'Rs') FROM companies c LEFT JOIN currency_config cc ON cc.code = c.currency_code WHERE c.id = ?",
    )
    .bind(company_id)
    .fetch_optional(pool.inner())
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "Rs".to_string());

    let title = match report.as_str() {
        "sales" => "Sales Report",
        "stock" => "Stock Report",
        "ledger" => "Customer Ledger",
        _ => return Err("Unknown report type".to_string()),
    };

    let mut doc = PdfDoc::new(title, &company_name, &tagline);
    doc.add_title(title);
    doc.add_text(
        &format!(
            "Generated on {} for {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M"),
            company_name
        ),
        9.0,
        false,
    );
    doc.add_blank();

    match report.as_str() {
        "sales" => {
            let rows = sqlx::query_as::<_, (String, String, String, i64, i64, i64, String)>(
                r#"
                SELECT i.invoice_number, i.invoice_date, c.name,
                       i.grand_total, i.amount_paid, i.balance_due, i.status
                FROM invoices i
                JOIN customers c ON c.id = i.customer_id
                WHERE i.company_id = ? AND i.deleted_at IS NULL
                ORDER BY i.invoice_date DESC
                "#,
            )
            .bind(company_id)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Error: {e}"))?;

            let cols = vec![
                PdfColumn {
                    header: "Invoice #".into(),
                    width: 1.1,
                },
                PdfColumn {
                    header: "Date".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Customer".into(),
                    width: 1.6,
                },
                PdfColumn {
                    header: "Total".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Paid".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Balance".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Status".into(),
                    width: 1.0,
                },
            ];
            let data: Vec<Vec<String>> = rows
                .iter()
                .map(|(n, d, c, t, p, b, s)| {
                    vec![
                        n.clone(),
                        d.clone(),
                        c.clone(),
                        format_currency(*t, &currency_symbol),
                        format_currency(*p, &currency_symbol),
                        format_currency(*b, &currency_symbol),
                        s.clone(),
                    ]
                })
                .collect();
            doc.add_table(&cols, &data);
        }
        "stock" => {
            let rows = sqlx::query_as::<_, (String, String, Option<String>, i64, i64, i64)>(
                r#"
                SELECT p.sku, p.name, cat.name,
                       p.quantity_in_stock, p.cost_price, p.sell_price
                FROM products p
                LEFT JOIN categories cat ON cat.id = p.category_id
                WHERE p.company_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
                ORDER BY p.name
                "#,
            )
            .bind(company_id)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Error: {e}"))?;

            let cols = vec![
                PdfColumn {
                    header: "SKU".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Product".into(),
                    width: 1.8,
                },
                PdfColumn {
                    header: "Category".into(),
                    width: 1.2,
                },
                PdfColumn {
                    header: "Stock".into(),
                    width: 0.8,
                },
                PdfColumn {
                    header: "Cost".into(),
                    width: 1.0,
                },
                PdfColumn {
                    header: "Sell".into(),
                    width: 1.0,
                },
            ];
            let data: Vec<Vec<String>> = rows
                .iter()
                .map(|(s, n, c, q, cost, sell)| {
                    vec![
                        s.clone(),
                        n.clone(),
                        c.clone().unwrap_or_default(),
                        q.to_string(),
                        format_currency(*cost, &currency_symbol),
                        format_currency(*sell, &currency_symbol),
                    ]
                })
                .collect();
            doc.add_table(&cols, &data);
        }
        "ledger" => {
            let rows = sqlx::query_as::<_, (String, String, i64, i64, i64)>(
                r#"
                SELECT c.name, COALESCE(c.phone, ''),
                       COALESCE(SUM(i.grand_total), 0),
                       COALESCE(SUM(i.amount_paid), 0),
                       COALESCE(SUM(i.balance_due), 0)
                FROM customers c
                LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'cancelled'
                WHERE c.company_id = ? AND c.deleted_at IS NULL
                GROUP BY c.id
                ORDER BY SUM(i.balance_due) DESC
                "#,
            )
            .bind(company_id)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Error: {e}"))?;

            let cols = vec![
                PdfColumn {
                    header: "Customer".into(),
                    width: 1.8,
                },
                PdfColumn {
                    header: "Phone".into(),
                    width: 1.2,
                },
                PdfColumn {
                    header: "Invoiced".into(),
                    width: 1.1,
                },
                PdfColumn {
                    header: "Paid".into(),
                    width: 1.1,
                },
                PdfColumn {
                    header: "Balance".into(),
                    width: 1.1,
                },
            ];
            let data: Vec<Vec<String>> = rows
                .iter()
                .map(|(n, p, inv, paid, bal)| {
                    vec![n.clone(), p.clone(), format_currency(*inv, &currency_symbol), format_currency(*paid, &currency_symbol), format_currency(*bal, &currency_symbol)]
                })
                .collect();
            doc.add_table(&cols, &data);
        }
        _ => unreachable!(),
    }

    let bytes = doc.finish();
    std::fs::write(&save_path, bytes).map_err(|e| format!("Write error: {e}"))?;
    Ok(save_path)
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::create_product;
    use crate::commands::invoices::{
        add_invoice_item, create_customer, create_invoice, finalize_invoice,
    };
    use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
    use tauri::Manager;

    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Unique writable temp file path for an export.
    fn temp_csv() -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("export_test_{}.csv", uuid::Uuid::new_v4()));
        path
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

    async fn make_finalized_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
        product_id: &str,
    ) -> crate::commands::invoices::PublicInvoice {
        let invoice = create_invoice(
            app.state(),
            app.state(),
            customer_id.to_string(),
            "2026-01-15".to_string(),
            "2026-02-14".to_string(),
            "PO-1".to_string(),
            "note".to_string(),
            None,
            None,
        )
        .await
        .expect("create invoice");
        add_invoice_item(
            app.state(),
            app.state(),
            invoice.id.clone(),
            product_id.to_string(),
            2,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");
        finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize")
    }

    // ---------------------------------------------------------------
    // escape_csv (pure)
    // ---------------------------------------------------------------

    #[test]
    fn escape_csv_plain_value_unchanged() {
        // Input: "Widget".
        // Expected: "Widget" (no quoting needed).
        assert_eq!(escape_csv("Widget"), "Widget");
    }

    #[test]
    fn escape_csv_quotes_comma_value() {
        // Input: `Smith, John`.
        // Expected: quoted, inner quotes doubled.
        assert_eq!(escape_csv("Smith, John"), "\"Smith, John\"");
        assert_eq!(escape_csv("Say \"hi\""), "\"Say \"\"hi\"\"\"");
    }

    #[test]
    fn escape_csv_handles_newline() {
        // Input: "line1\nline2".
        // Expected: wrapped in quotes.
        assert_eq!(escape_csv("line1\nline2"), "\"line1\nline2\"");
    }

    // ---------------------------------------------------------------
    // export_stock_csv
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn stock_csv_writes_header_and_rows() {
        // Input: one active product with stock 5 (cost 500, sell 700).
        // Expected: file contains the header and a row with computed value 2500.
        let app = owner_app().await;
        make_product(&app, "Widget", 5).await;
        let path = temp_csv();

        let returned =
            export_stock_csv(app.state(), app.state(), path.to_string_lossy().to_string())
                .await
                .expect("export");
        assert_eq!(returned, path.to_string_lossy());

        let content = std::fs::read_to_string(&path).expect("read file");
        assert!(content.starts_with(
            "SKU,Product Name,Category,Stock,Cost Price,Sell Price,Stock Value (Cost)\n"
        ));
        assert!(content.contains("Widget"));
        assert!(content.contains(",5,500,700,2500"), "got:\n{content}");
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn stock_csv_empty_company_writes_header_only() {
        // Input: no products.
        // Expected: header line only.
        let app = owner_app().await;
        let path = temp_csv();

        export_stock_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .expect("export");
        let content = std::fs::read_to_string(&path).expect("read file");
        assert_eq!(
            content,
            "SKU,Product Name,Category,Stock,Cost Price,Sell Price,Stock Value (Cost)\n"
        );
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn stock_csv_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let path = temp_csv();
        let err = export_stock_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn stock_csv_denied_for_employee() {
        // Input: employee (reports/view only, no export permission).
        // Expected: Err "Access denied: employee cannot export reports".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let company_id: String =
            sqlx::query_scalar("SELECT company_id FROM users WHERE email = 'owner@test.com'")
                .fetch_one(&*pool)
                .await
                .expect("company id");
        let employee = insert_user(&pool, &company_id, "e@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let path = temp_csv();
        let err = export_stock_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn stock_csv_invalid_path_returns_write_error() {
        // Input: path inside a non-existent directory.
        // Expected: Err containing "Write error".
        let app = owner_app().await;
        let path = std::path::PathBuf::from("/nonexistent-dir-xyz/out.csv");
        let err = export_stock_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert!(err.contains("Write error"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // export_customer_ledger_csv
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn customer_ledger_csv_writes_rows() {
        // Input: customer with a finalized 2×1000 invoice.
        // Expected: header + row with invoiced 2000, paid 0, balance 2000.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        make_finalized_invoice(&app, &customer.id, &product.id).await;
        let path = temp_csv();

        export_customer_ledger_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .expect("export");
        let content = std::fs::read_to_string(&path).expect("read file");
        assert!(content.starts_with("Customer Name,Phone,Total Invoiced,Total Paid,Balance Due\n"));
        assert!(
            content.contains("Walk-in,0300-111,2000,0,2000"),
            "got:\n{content}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn customer_ledger_csv_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let path = temp_csv();
        let err = export_customer_ledger_csv(
            app.state(),
            app.state(),
            path.to_string_lossy().to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    // ---------------------------------------------------------------
    // export_sales_csv
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn sales_csv_writes_rows() {
        // Input: a finalized invoice for a customer.
        // Expected: header + row with invoice number and totals.
        let app = owner_app().await;
        let customer = make_customer(&app, "Walk-in").await;
        let product = make_product(&app, "Widget", 10).await;
        let invoice = make_finalized_invoice(&app, &customer.id, &product.id).await;
        let path = temp_csv();

        export_sales_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .expect("export");
        let content = std::fs::read_to_string(&path).expect("read file");
        assert!(content.starts_with("Invoice #,Date,Customer,Total,Paid,Balance,Status\n"));
        assert!(
            content.contains(&format!(
                "{},2026-01-15,Walk-in,2000,0,2000,finalized",
                invoice.invoice_number
            )),
            "got:\n{content}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[tokio::test]
    async fn sales_csv_denied_for_employee() {
        // Input: employee session (no reports/export permission).
        // Expected: Err containing "Access denied".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let company_id: String =
            sqlx::query_scalar("SELECT company_id FROM users WHERE email = 'owner@test.com'")
                .fetch_one(&*pool)
                .await
                .expect("company id");
        let employee =
            insert_user(&pool, &company_id, "e2@test.com", "Emp", "employee", true).await;
        set_session_user(&app, employee).await;

        let path = temp_csv();
        let err = export_sales_csv(app.state(), app.state(), path.to_string_lossy().to_string())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }
}
