// ==========================================
// PERMISSION CHECKING + SOFT-DELETE HELPERS
// ==========================================
//
// Usage in any command:
//   check_permission(pool, &user, "invoices", "create").await?;
//   soft_delete(pool, "products", &product_id, company_id).await?;
//   check_version(pool, "products", &product_id, expected_version).await?;

use sqlx::SqlitePool;

/// Checks if a user's role has a specific permission.
/// Returns Ok(()) if allowed, Err(message) if denied.
pub async fn check_permission(
    pool: &SqlitePool,
    role: &str,
    module: &str,
    permission: &str,
) -> Result<(), String> {
    // Owner always has all permissions
    if role == "owner" {
        return Ok(());
    }

    let allowed: bool = sqlx::query_scalar(
        "SELECT COALESCE(allowed, 0) FROM role_permissions WHERE role = ? AND module = ? AND permission = ?"
    )
    .bind(role)
    .bind(module)
    .bind(permission)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Permission check error: {e}"))?
    .unwrap_or(false);

    if allowed {
        Ok(())
    } else {
        Err(format!(
            "Access denied: {role} cannot {permission} {module}"
        ))
    }
}

/// Soft-deletes a record by setting deleted_at.
/// Returns the number of rows affected.
pub async fn soft_delete(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    company_id: &str,
) -> Result<u64, String> {
    // Only allow known tables (prevent SQL injection)
    let valid_tables = [
        "products",
        "customers",
        "categories",
        "suppliers",
        "invoices",
        "purchase_orders",
        "users",
    ];
    if !valid_tables.contains(&table) {
        return Err(format!("Cannot soft-delete table: {table}"));
    }

    let query = format!(
        "UPDATE {table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND deleted_at IS NULL"
    );

    let rows = sqlx::query(sqlx::AssertSqlSafe(&*query))
        .bind(id)
        .bind(company_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Soft-delete error: {e}"))?;

    Ok(rows.rows_affected())
}

/// Checks optimistic lock version before an update.
/// Returns Ok(()) if version matches, Err if conflict.
pub async fn check_version(
    pool: &SqlitePool,
    table: &str,
    id: &str,
    expected_version: i64,
) -> Result<(), String> {
    let valid_tables = [
        "products",
        "customers",
        "categories",
        "suppliers",
        "invoices",
        "purchase_orders",
        "users",
    ];
    if !valid_tables.contains(&table) {
        return Err(format!("Cannot check version for table: {table}"));
    }

    let query = format!("SELECT version FROM {table} WHERE id = ? AND deleted_at IS NULL");
    let current: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(&*query))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Version check error: {e}"))?
        .ok_or("Record not found or deleted")?;

    if current != expected_version {
        Err(format!(
            "Conflict: record was modified by another user (expected v{expected_version}, found v{current}). Please refresh and try again."
        ))
    } else {
        Ok(())
    }
}

/// Increments the version column after a successful update.
pub async fn bump_version(pool: &SqlitePool, table: &str, id: &str) -> Result<(), String> {
    let valid_tables = [
        "products",
        "customers",
        "categories",
        "suppliers",
        "invoices",
        "purchase_orders",
        "users",
    ];
    if !valid_tables.contains(&table) {
        return Err(format!("Cannot bump version for table: {table}"));
    }

    let query = format!(
        "UPDATE {table} SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    sqlx::query(sqlx::AssertSqlSafe(&*query))
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Version bump error: {e}"))?;

    Ok(())
}

// ==========================================
// TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::setup_pool;

    /// Inserts a minimal product row so soft-delete / version tests have data.
    async fn insert_product(pool: &SqlitePool, company_id: &str, sku: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock)
            VALUES (?, ?, ?, ?, 100, 150, 5)
            "#,
        )
        .bind(&id)
        .bind(company_id)
        .bind(sku)
        .bind(sku)
        .execute(pool)
        .await
        .expect("insert_product should succeed");
        id
    }

    // ---------------------------------------------------------------
    // check_permission
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn check_permission_owner_always_allowed() {
        // Input: role "owner" with a permission that has NO seeded row.
        // Expected: Ok — the owner short-circuit grants everything.
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "owner", "settings", "edit").await;
        assert!(result.is_ok(), "owner must pass any permission check");
    }

    #[tokio::test]
    async fn check_permission_admin_allowed_seeded() {
        // Input: role "admin", module "inventory", permission "view" (seeded rp-20).
        // Expected: Ok.
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "admin", "inventory", "view").await;
        assert!(result.is_ok(), "admin inventory view is seeded and must pass");
    }

    #[tokio::test]
    async fn check_permission_admin_denied_unseeded() {
        // Input: role "admin", module "users", permission "edit" (no admin row).
        // Expected: Err with "Access denied".
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "admin", "users", "edit").await;
        assert!(result.is_err(), "admin must NOT have users/edit");
        let msg = result.unwrap_err();
        assert!(msg.contains("Access denied"), "got: {msg}");
    }

    #[tokio::test]
    async fn check_permission_employee_allowed_view_only() {
        // Input: role "employee", module "inventory", permission "view" (seeded rp-40).
        // Expected: Ok.
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "employee", "inventory", "view").await;
        assert!(result.is_ok(), "employee inventory view is seeded and must pass");
    }

    #[tokio::test]
    async fn check_permission_employee_denied_edit() {
        // Input: role "employee", module "inventory", permission "edit" (no row).
        // Expected: Err.
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "employee", "inventory", "edit").await;
        assert!(result.is_err(), "employee must NOT have inventory/edit");
    }

    #[tokio::test]
    async fn check_permission_unknown_role_denied() {
        // Input: role "superuser" (not a seeded role), inventory/view.
        // Expected: Err — no row exists for the role.
        let (pool, _p) = setup_pool().await;
        let result = check_permission(&pool, "superuser", "inventory", "view").await;
        assert!(result.is_err(), "unknown roles must be denied");
    }

    #[tokio::test]
    async fn check_permission_disallowed_row_denied() {
        // Input: the seeded admin reports/export row is flipped to allowed=0.
        // Expected: Err — the stored `allowed` value is 0.
        let (pool, _p) = setup_pool().await;
        sqlx::query(
            "UPDATE role_permissions SET allowed = 0 WHERE role = 'admin' AND module = 'reports' AND permission = 'export'",
        )
        .execute(&pool)
        .await
        .expect("flip row to disallowed");
        let result = check_permission(&pool, "admin", "reports", "export").await;
        assert!(result.is_err(), "allowed=0 must be treated as denied");
    }

    // ---------------------------------------------------------------
    // soft_delete
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn soft_delete_marks_existing_row() {
        // Input: existing product in company A.
        // Expected: returns 1 row affected, deleted_at becomes non-null.
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-1").await;
        let rows = soft_delete(&pool, "products", &pid, "company-a")
            .await
            .expect("soft_delete should succeed");
        assert_eq!(rows, 1);
        let deleted: Option<String> = sqlx::query_scalar(
            "SELECT deleted_at FROM products WHERE id = ?",
        )
        .bind(&pid)
        .fetch_one(&pool)
        .await
        .expect("fetch deleted_at");
        assert!(deleted.is_some(), "deleted_at should be set");
    }

    #[tokio::test]
    async fn soft_delete_twice_second_is_noop() {
        // Input: same product soft-deleted twice.
        // Expected: first call affects 1 row, second call affects 0 (guard deleted_at IS NULL).
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-2").await;
        assert_eq!(soft_delete(&pool, "products", &pid, "company-a").await.unwrap(), 1);
        assert_eq!(soft_delete(&pool, "products", &pid, "company-a").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn soft_delete_missing_id_affects_zero_rows() {
        // Input: nonexistent product id.
        // Expected: Ok(0) — no rows matched, no error.
        let (pool, _p) = setup_pool().await;
        let rows = soft_delete(&pool, "products", "no-such-id", "company-a")
            .await
            .expect("soft_delete of missing row should be Ok");
        assert_eq!(rows, 0);
    }

    #[tokio::test]
    async fn soft_delete_wrong_company_affects_zero_rows() {
        // Input: product belongs to company-a, caller is company-b.
        // Expected: Ok(0) — company_id guard prevents cross-company delete.
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-3").await;
        let rows = soft_delete(&pool, "products", &pid, "company-b")
            .await
            .expect("soft_delete should be Ok");
        assert_eq!(rows, 0);
        let deleted: Option<String> =
            sqlx::query_scalar("SELECT deleted_at FROM products WHERE id = ?")
                .bind(&pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(deleted.is_none(), "row must remain undeleted");
    }

    #[tokio::test]
    async fn soft_delete_invalid_table_rejected() {
        // Input: table "passwords" (not in the allow-list).
        // Expected: Err — the allow-list prevents SQL injection.
        let (pool, _p) = setup_pool().await;
        let result = soft_delete(&pool, "passwords", "id-1", "company-a").await;
        assert!(result.is_err(), "unknown table must be rejected");
    }

    // ---------------------------------------------------------------
    // check_version
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn check_version_matching_passes() {
        // Input: row at version 1 (default), expected_version = 1.
        // Expected: Ok.
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-4").await;
        check_version(&pool, "products", &pid, 1)
            .await
            .expect("matching version must pass");
    }

    #[tokio::test]
    async fn check_version_conflict_fails() {
        // Input: row at version 1, expected_version = 2.
        // Expected: Err mentioning "Conflict".
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-5").await;
        let err = check_version(&pool, "products", &pid, 2).await.unwrap_err();
        assert!(err.contains("Conflict"), "got: {err}");
    }

    #[tokio::test]
    async fn check_version_deleted_record_fails() {
        // Input: soft-deleted product.
        // Expected: Err "Record not found or deleted" (query guards deleted_at IS NULL).
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-6").await;
        soft_delete(&pool, "products", &pid, "company-a").await.unwrap();
        let err = check_version(&pool, "products", &pid, 1).await.unwrap_err();
        assert!(err.contains("Record not found"), "got: {err}");
    }

    #[tokio::test]
    async fn check_version_invalid_table_fails() {
        // Input: table "secrets".
        // Expected: Err.
        let (pool, _p) = setup_pool().await;
        let result = check_version(&pool, "secrets", "id-1", 1).await;
        assert!(result.is_err());
    }

    // ---------------------------------------------------------------
    // bump_version
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn bump_version_increments() {
        // Input: product at version 1.
        // Expected: version becomes 2 after bump.
        let (pool, _p) = setup_pool().await;
        let pid = insert_product(&pool, "company-a", "SKU-7").await;
        bump_version(&pool, "products", &pid).await.expect("bump succeeds");
        let version: i64 = sqlx::query_scalar("SELECT version FROM products WHERE id = ?")
            .bind(&pid)
            .fetch_one(&pool)
            .await
            .expect("fetch version");
        assert_eq!(version, 2);
    }

    #[tokio::test]
    async fn bump_version_invalid_table_fails() {
        // Input: table "passwords".
        // Expected: Err.
        let (pool, _p) = setup_pool().await;
        let result = bump_version(&pool, "passwords", "id-1").await;
        assert!(result.is_err());
    }
}

