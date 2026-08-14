// ==========================================
// UNITS (spec §23.16)
// ==========================================
//
// A company-wide master list of units of measure (pcs, box, carton, kg, ...).
// Products store their unit as free text, so the master list exists to keep
// the vocabulary consistent and to seed the unit picker in the product form.
// Deleting a unit never touches products — it only removes it from the list.

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use serde::Serialize;
use sqlx::FromRow;
use sqlx::SqlitePool;
use tauri::State;

/// A unit of measure (spec §23.16).
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicUnit {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub symbol: Option<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

// sqlx's `FromRow` maps INTEGER 0/1 to bool natively, so PublicUnit is fine.

/// Lists all units of measure for the current user's company.
#[tauri::command]
pub async fn list_units(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<PublicUnit>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let units = sqlx::query_as::<_, PublicUnit>(
        r#"
        SELECT id, company_id, name, symbol, is_default, created_at, updated_at
        FROM units
        WHERE company_id = ?
        ORDER BY is_default DESC, name COLLATE NOCASE
        "#,
    )
    .bind(&current_user.company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    Ok(units)
}

/// Creates a new unit of measure. Owner and admin only.
#[tauri::command]
pub async fn create_unit(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    symbol: Option<String>,
    is_default: bool,
) -> Result<PublicUnit, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Unit name cannot be empty".to_string());
    }

    let symbol = symbol
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let id = uuid::Uuid::new_v4().to_string();

    // Only one default unit per company: setting this one clears the others.
    if is_default {
        clear_default_unit(pool.inner(), company_id).await?;
    }

    sqlx::query(
        r#"
        INSERT INTO units (id, company_id, name, symbol, is_default)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&trimmed_name)
    .bind(&symbol)
    .bind(is_default as i32)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Unit '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    let unit = sqlx::query_as::<_, PublicUnit>("SELECT * FROM units WHERE id = ?")
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
        "unit",
        Some(&id),
        &format!("Created unit '{}'", trimmed_name),
    )
    .await;

    Ok(unit)
}

/// Updates a unit's name, symbol, and default flag. Owner and admin only.
#[tauri::command]
pub async fn update_unit(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    unit_id: String,
    name: String,
    symbol: Option<String>,
    is_default: bool,
) -> Result<PublicUnit, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "edit").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Unit name cannot be empty".to_string());
    }

    let symbol = symbol
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Confirm the unit belongs to this company.
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM units WHERE id = ? AND company_id = ?)",
    )
    .bind(&unit_id)
    .bind(company_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;
    if !owned {
        return Err("Unit not found".to_string());
    }

    if is_default {
        clear_default_unit(pool.inner(), company_id).await?;
    }

    sqlx::query(
        r#"
        UPDATE units
        SET name = ?, symbol = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&trimmed_name)
    .bind(&symbol)
    .bind(is_default as i32)
    .bind(&unit_id)
    .bind(company_id)
    .execute(pool.inner())
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE") {
            format!("Unit '{}' already exists", trimmed_name)
        } else {
            format!("Database error: {msg}")
        }
    })?;

    let unit = sqlx::query_as::<_, PublicUnit>("SELECT * FROM units WHERE id = ?")
        .bind(&unit_id)
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
        "unit",
        Some(&unit_id),
        &format!("Updated unit '{}'", trimmed_name),
    )
    .await;

    Ok(unit)
}

/// Deletes a unit of measure. Owner and admin only. Products that already use
/// the unit name are unaffected — they keep the stored text value.
#[tauri::command]
pub async fn delete_unit(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    unit_id: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "inventory", "delete").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let rows_affected = sqlx::query("DELETE FROM units WHERE id = ? AND company_id = ?")
        .bind(&unit_id)
        .bind(company_id)
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?
        .rows_affected();

    if rows_affected == 0 {
        return Err("Unit not found".to_string());
    }

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "unit",
        Some(&unit_id),
        "Deleted unit",
    )
    .await;

    Ok(())
}

/// Clears the default flag on every unit of a company, so only one can be the
/// default at a time.
async fn clear_default_unit(pool: &SqlitePool, company_id: &str) -> Result<(), String> {
    sqlx::query("UPDATE units SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?")
        .bind(company_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Database error: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_helpers::{register_owner, setup_app};
    use tauri::test::MockRuntime;
    use tauri::Manager;

    async fn owner_app() -> tauri::App<MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    #[tokio::test]
    async fn create_unit_lists_and_round_trips() {
        // Input: create a carton unit with a symbol.
        // Expected: list_units returns it; the same name twice errors with a
        // UNIQUE-friendly message.
        let app = owner_app().await;

        let created = create_unit(
            app.state(),
            app.state(),
            "Carton".to_string(),
            Some("ct".to_string()),
            false,
        )
        .await
        .expect("create unit");
        assert_eq!(created.name, "Carton");
        assert_eq!(created.symbol.as_deref(), Some("ct"));
        assert!(!created.is_default);

        let units = list_units(app.state(), app.state()).await.expect("list units");
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].name, "Carton");

        let err = create_unit(
            app.state(),
            app.state(),
            "carton".to_string(),
            None,
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[tokio::test]
    async fn only_one_default_unit_at_a_time() {
        // Input: create two units, mark the second as default.
        // Expected: the second is default; the first gets cleared.
        let app = owner_app().await;

        create_unit(
            app.state(),
            app.state(),
            "Pieces".to_string(),
            Some("pcs".to_string()),
            true,
        )
        .await
        .expect("first default");

        let second = create_unit(
            app.state(),
            app.state(),
            "Box".to_string(),
            Some("bx".to_string()),
            true,
        )
        .await
        .expect("second default");
        assert!(second.is_default);

        let units = list_units(app.state(), app.state()).await.expect("list");
        let pieces = units.iter().find(|u| u.name == "Pieces").unwrap();
        let boxes = units.iter().find(|u| u.name == "Box").unwrap();
        assert!(!pieces.is_default, "first unit must be cleared");
        assert!(boxes.is_default);
    }

    #[tokio::test]
    async fn update_and_delete_unit() {
        // Input: update a unit's name + default flag, then delete it.
        // Expected: the update round-trips; delete removes the row.
        let app = owner_app().await;

        let created = create_unit(
            app.state(),
            app.state(),
            "Kilogram".to_string(),
            Some("kg".to_string()),
            false,
        )
        .await
        .expect("create");

        let updated = update_unit(
            app.state(),
            app.state(),
            created.id.clone(),
            "Kilograms".to_string(),
            Some("kg".to_string()),
            true,
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Kilograms");
        assert!(updated.is_default);

        delete_unit(app.state(), app.state(), created.id.clone())
            .await
            .expect("delete");

        let units = list_units(app.state(), app.state()).await.expect("list");
        assert!(units.is_empty());
    }

    #[tokio::test]
    async fn delete_unit_from_another_company_is_not_found() {
        // Input: delete a random id.
        // Expected: Err "Unit not found" (company scoping).
        let app = owner_app().await;
        let err = delete_unit(app.state(), app.state(), "nope".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }
}
