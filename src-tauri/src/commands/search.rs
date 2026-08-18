// ==========================================
// FULL-TEXT SEARCH (FTS5)
// ==========================================
//
// Fast search across products and customers.
// Replaces LIKE '%...%' with SQLite FTS5.

use crate::commands::auth::{require_current_user, SessionState};
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub result_type: String, // "product" or "customer"
    pub id: String,
    pub name: String,
    pub subtitle: String, // SKU, email, etc.
    pub detail: String,   // stock, phone, etc.
}

/// Searches products and customers by text query.
#[tauri::command]
pub async fn search_all(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    let user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = user.company_id.as_ref().ok_or("Not assigned")?;

    let trimmed = query.trim();
    if trimmed.is_empty() || trimmed.len() < 2 {
        return Ok(Vec::new());
    }

    // FTS5 query: wrap each word in quotes for safety
    let fts_query: String = trimmed
        .split_whitespace()
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" ");

    let mut results: Vec<SearchResult> = Vec::new();

    // Search products
    let products = sqlx::query_as::<_, (String, String, String, i64)>(
        r#"
        SELECT p.id, p.name, p.sku, p.quantity_in_stock
        FROM products p
        JOIN products_fts fts ON fts.rowid = p.rowid
        WHERE products_fts MATCH ?
        AND p.company_id = ? AND p.deleted_at IS NULL
        ORDER BY rank
        LIMIT 10
        "#,
    )
    .bind(&fts_query)
    .bind(company_id)
    .fetch_all(pool.inner())
    .await;

    if let Ok(rows) = products {
        for (id, name, sku, stock) in rows {
            results.push(SearchResult {
                result_type: "product".to_string(),
                id,
                name,
                subtitle: format!("SKU: {sku}"),
                detail: format!("Stock: {stock}"),
            });
        }
    }

    // Search customers
    let customers = sqlx::query_as::<_, (String, String, Option<String>, Option<String>)>(
        r#"
        SELECT c.id, c.name, c.email, c.phone
        FROM customers c
        JOIN customers_fts fts ON fts.rowid = c.rowid
        WHERE customers_fts MATCH ?
        AND c.company_id = ? AND c.deleted_at IS NULL
        ORDER BY rank
        LIMIT 10
        "#,
    )
    .bind(&fts_query)
    .bind(company_id)
    .fetch_all(pool.inner())
    .await;

    if let Ok(rows) = customers {
        for (id, name, email, phone) in rows {
            results.push(SearchResult {
                result_type: "customer".to_string(),
                id,
                name,
                subtitle: email.unwrap_or_default(),
                detail: phone.unwrap_or_default(),
            });
        }
    }

    // Fallback to LIKE if FTS returns nothing
    if results.is_empty() {
        let like_pattern = format!("%{trimmed}%");

        let products = sqlx::query_as::<_, (String, String, String, i64)>(
            "SELECT id, name, sku, quantity_in_stock FROM products WHERE company_id = ? AND deleted_at IS NULL AND (name LIKE ? OR sku LIKE ?) LIMIT 5"
        )
        .bind(company_id).bind(&like_pattern).bind(&like_pattern)
        .fetch_all(pool.inner()).await.unwrap_or_default();

        for (id, name, sku, stock) in products {
            results.push(SearchResult {
                result_type: "product".to_string(),
                id,
                name,
                subtitle: format!("SKU: {sku}"),
                detail: format!("Stock: {stock}"),
            });
        }

        let customers = sqlx::query_as::<_, (String, String, Option<String>, Option<String>)>(
            "SELECT id, name, email, phone FROM customers WHERE company_id = ? AND deleted_at IS NULL AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) LIMIT 5"
        )
        .bind(company_id).bind(&like_pattern).bind(&like_pattern).bind(&like_pattern)
        .fetch_all(pool.inner()).await.unwrap_or_default();

        for (id, name, email, phone) in customers {
            results.push(SearchResult {
                result_type: "customer".to_string(),
                id,
                name,
                subtitle: email.unwrap_or_default(),
                detail: phone.unwrap_or_default(),
            });
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{register_owner_full, setup_app, state_of};
    use tauri::Manager;

    async fn insert_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        company_id: &str,
        name: &str,
        sku: &str,
    ) {
        let pool = state_of::<SqlitePool>(app);
        sqlx::query(
            r#"
            INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock, unit)
            VALUES (?, ?, ?, ?, 100, 200, 50, 'pcs')
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(sku)
        .bind(name)
        .execute(pool.inner())
        .await
        .expect("insert product");
    }

    async fn insert_customer(
        app: &tauri::App<tauri::test::MockRuntime>,
        company_id: &str,
        name: &str,
        email: Option<&str>,
        phone: Option<&str>,
    ) {
        let pool = state_of::<SqlitePool>(app);
        sqlx::query(
            r#"
            INSERT INTO customers (id, company_id, name, email, phone)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(name)
        .bind(email)
        .bind(phone)
        .execute(pool.inner())
        .await
        .expect("insert customer");
    }

    #[tokio::test]
    async fn empty_query_returns_no_results() {
        let app = setup_app().await;
        let _owner = register_owner_full(&app, "owner@test.com").await;

        let results = search_all(app.state(), app.state(), "".to_string())
            .await
            .expect("should succeed");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn single_char_query_returns_no_results() {
        let app = setup_app().await;
        let _owner = register_owner_full(&app, "owner@test.com").await;

        let results = search_all(app.state(), app.state(), "a".to_string())
            .await
            .expect("should succeed");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn search_finds_product_by_name() {
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;

        insert_product(&app, &owner.company.id, "Widget Premium", "WDG-001").await;

        let results = search_all(app.state(), app.state(), "Widget".to_string())
            .await
            .expect("should succeed");
        assert!(!results.is_empty());
        assert_eq!(results[0].result_type, "product");
        assert_eq!(results[0].name, "Widget Premium");
    }

    #[tokio::test]
    async fn search_finds_product_by_sku() {
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;

        insert_product(&app, &owner.company.id, "Widget", "SKU-XYZ-123").await;

        let results = search_all(app.state(), app.state(), "SKU-XYZ".to_string())
            .await
            .expect("should succeed");
        assert!(!results.is_empty());
        assert_eq!(results[0].result_type, "product");
    }

    #[tokio::test]
    async fn search_finds_customer_by_name() {
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;

        insert_customer(&app, &owner.company.id, "Acme Corp", Some("info@acme.com"), Some("0300-123")).await;

        let results = search_all(app.state(), app.state(), "Acme".to_string())
            .await
            .expect("should succeed");
        assert!(!results.is_empty());
        assert_eq!(results[0].result_type, "customer");
        assert_eq!(results[0].name, "Acme Corp");
    }

    #[tokio::test]
    async fn search_returns_both_products_and_customers() {
        let app = setup_app().await;
        let owner = register_owner_full(&app, "owner@test.com").await;

        insert_product(&app, &owner.company.id, "Test Item", "TST-001").await;
        insert_customer(&app, &owner.company.id, "Test Customer", None, None).await;

        let results = search_all(app.state(), app.state(), "Test".to_string())
            .await
            .expect("should succeed");
        let product_hits = results.iter().filter(|r| r.result_type == "product").count();
        let customer_hits = results.iter().filter(|r| r.result_type == "customer").count();
        assert!(product_hits > 0, "should find product");
        assert!(customer_hits > 0, "should find customer");
    }
}
