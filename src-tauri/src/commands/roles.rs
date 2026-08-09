// ==========================================
// CUSTOM ROLES & PERMISSIONS
// ==========================================
//
// Built-in roles (owner / admin / employee) plus company-defined
// custom roles. Every role's permissions live in the shared
// `role_permissions` table keyed by role name; check_permission
// (permissions.rs) already resolves them dynamically.
//
// Permission matrix per module:
//   inventory, invoices, purchase_orders, reports, ledger, users, settings
//   (view / create / edit / delete / finalize / export / post)

use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

pub const BUILTIN_ROLES: [&str; 3] = ["owner", "admin", "employee"];

/// Canonical module → permission matrix surfaced in the UI and used to
/// seed default permissions for new custom roles.
pub const MODULE_PERMISSIONS: &[(&str, &[&str])] = &[
    ("inventory", &["view", "create", "edit", "delete"]),
    (
        "invoices",
        &["view", "create", "edit", "finalize", "delete"],
    ),
    ("purchase_orders", &["view", "create", "edit", "finalize"]),
    ("reports", &["view", "export"]),
    ("ledger", &["view", "post"]),
    ("users", &["view", "create", "edit"]),
    ("settings", &["view", "edit"]),
];

pub const ALL_MODULES: [&str; 7] = [
    "inventory",
    "invoices",
    "purchase_orders",
    "reports",
    "ledger",
    "users",
    "settings",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePermission {
    pub module: String,
    pub permission: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub role: String,
    pub description: String,
    pub is_custom: bool,
    pub permissions: Vec<RolePermission>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePermissionInput {
    pub module: String,
    pub permission: String,
    pub allowed: bool,
}

/// Returns true if the role name is a built-in role.
pub fn is_builtin_role(role: &str) -> bool {
    BUILTIN_ROLES.contains(&role)
}

/// Resolves a role name against built-ins + the company's custom roles.
/// Used by the users module so custom roles can be assigned to users.
pub async fn resolve_role(
    pool: &SqlitePool,
    company_id: &str,
    role: &str,
) -> Result<String, String> {
    let normalized = role.trim();
    if is_builtin_role(&normalized.to_lowercase()) {
        return Ok(normalized.to_lowercase());
    }

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM custom_roles WHERE company_id = ? AND name = ? COLLATE NOCASE AND is_active = 1)",
    )
    .bind(company_id)
    .bind(normalized)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Role lookup error: {e}"))?;

    if exists {
        Ok(normalized.to_string())
    } else {
        Err(format!(
            "Unknown role '{normalized}'. Choose a built-in role or an existing custom role."
        ))
    }
}

/// Fetches the permissions for a role as a matrix (all modules × permissions).
async fn permissions_for(pool: &SqlitePool, role: &str) -> Result<Vec<RolePermission>, String> {
    let mut out = Vec::new();
    for (module, perms) in MODULE_PERMISSIONS {
        for permission in *perms {
            let allowed: bool = sqlx::query_scalar(
                "SELECT COALESCE(allowed, 0) FROM role_permissions WHERE role = ? AND module = ? AND permission = ?",
            )
            .bind(role)
            .bind(module)
            .bind(permission)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Permission lookup error: {e}"))?
            .unwrap_or(false);
            out.push(RolePermission {
                module: module.to_string(),
                permission: permission.to_string(),
                allowed,
            });
        }
    }
    Ok(out)
}

/// Description strings for the built-in roles.
fn builtin_description(role: &str) -> &'static str {
    match role {
        "owner" => "Company owner — full access, cannot be changed",
        "admin" => "Manager — most access, cannot change roles",
        _ => "Staff — read-mostly access",
    }
}

/// Lists every role (built-in + custom) with its permission matrix.
#[tauri::command]
pub async fn list_roles(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<RoleInfo>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "users", "view").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let mut roles = Vec::new();
    for role in BUILTIN_ROLES {
        roles.push(RoleInfo {
            role: role.to_string(),
            description: builtin_description(role).to_string(),
            is_custom: false,
            permissions: permissions_for(pool.inner(), role).await?,
        });
    }

    let custom = sqlx::query_as::<_, (String, Option<String>, bool)>(
        "SELECT name, description, is_active FROM custom_roles WHERE company_id = ? AND is_active = 1 ORDER BY name",
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    for (name, description, _active) in custom {
        let permissions = permissions_for(pool.inner(), &name).await?;
        roles.push(RoleInfo {
            role: name.clone(),
            description: description.unwrap_or_default(),
            is_custom: true,
            permissions,
        });
    }

    Ok(roles)
}

/// Creates a new custom role seeded with view-only permissions.
#[tauri::command]
pub async fn create_custom_role(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
    description: Option<String>,
) -> Result<RoleInfo, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" {
        return Err("Only the company owner can create roles".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 30 {
        return Err("Role name must be 1-30 characters".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_')
    {
        return Err(
            "Role name may only contain letters, numbers, spaces, dashes and underscores"
                .to_string(),
        );
    }
    if is_builtin_role(&name.to_lowercase()) {
        return Err("That name is reserved for a built-in role".to_string());
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM custom_roles WHERE company_id = ? AND name = ? COLLATE NOCASE",
    )
    .bind(company_id)
    .bind(&name)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if exists > 0 {
        return Err("A role with that name already exists".to_string());
    }

    sqlx::query("INSERT INTO custom_roles (id, company_id, name, description) VALUES (?, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(&name)
        .bind(description.as_deref().unwrap_or(""))
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Create role error: {e}"))?;

    // Seed view-only permissions for every module.
    for module in ALL_MODULES {
        sqlx::query(
            "INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES (?, ?, ?, 'view', 1)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&name)
        .bind(module)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Seed permission error: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    Ok(RoleInfo {
        role: name.clone(),
        description: description.unwrap_or_default(),
        is_custom: true,
        permissions: permissions_for(pool.inner(), &name).await?,
    })
}

/// Upserts a role's permission matrix (owner only).
#[tauri::command]
pub async fn update_role_permissions(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    role: String,
    permissions: Vec<UpdatePermissionInput>,
) -> Result<RoleInfo, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" {
        return Err("Only the company owner can change permissions".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if role == "owner" {
        return Err("The owner role always has full access and cannot be edited".to_string());
    }

    if !is_builtin_role(&role) {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM custom_roles WHERE company_id = ? AND name = ? AND is_active = 1)",
        )
        .bind(company_id)
        .bind(&role)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| format!("Database error: {e}"))?;
        if !exists {
            return Err("Unknown role".to_string());
        }
    }

    // Validate module/permission pairs against the canonical matrix.
    for p in &permissions {
        let valid = MODULE_PERMISSIONS
            .iter()
            .any(|(m, perms)| m == &p.module && perms.contains(&p.permission.as_str()));
        if !valid {
            return Err(format!("Unknown permission {}:{}", p.module, p.permission));
        }
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    for p in &permissions {
        sqlx::query(
            r#"
            INSERT INTO role_permissions (id, role, module, permission, allowed)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(role, module, permission)
            DO UPDATE SET allowed = excluded.allowed
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&role)
        .bind(&p.module)
        .bind(&p.permission)
        .bind(p.allowed as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Update permission error: {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    Ok(RoleInfo {
        role: role.clone(),
        description: "".to_string(),
        is_custom: !is_builtin_role(&role),
        permissions: permissions_for(pool.inner(), &role).await?,
    })
}

/// Deletes a custom role. Rejected while any user is assigned to it.
#[tauri::command]
pub async fn delete_custom_role(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    name: String,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    if current_user.role != "owner" {
        return Err("Only the company owner can delete roles".to_string());
    }

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if is_builtin_role(&name) {
        return Err("Built-in roles cannot be deleted".to_string());
    }

    let assigned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE company_id = ? AND role = ? AND deleted_at IS NULL",
    )
    .bind(company_id)
    .bind(&name)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    if assigned > 0 {
        return Err(format!(
            "Cannot delete this role: {assigned} user(s) are still assigned to it"
        ));
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    sqlx::query("DELETE FROM custom_roles WHERE company_id = ? AND name = ?")
        .bind(company_id)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete role error: {e}"))?;

    sqlx::query("DELETE FROM role_permissions WHERE role = ?")
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Delete permissions error: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    Ok(())
}

/// Returns the current user's role + allowed permissions. Used by the
/// frontend to filter navigation and disable actions.
#[tauri::command]
pub async fn get_my_permissions(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<RoleInfo, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let permissions = if current_user.role == "owner" {
        // Owner: everything allowed.
        MODULE_PERMISSIONS
            .iter()
            .flat_map(|(m, perms)| {
                perms.iter().map(move |p| RolePermission {
                    module: m.to_string(),
                    permission: p.to_string(),
                    allowed: true,
                })
            })
            .collect()
    } else {
        permissions_for(pool.inner(), &current_user.role).await?
    };

    Ok(RoleInfo {
        role: current_user.role.clone(),
        description: "".to_string(),
        is_custom: !is_builtin_role(&current_user.role),
        permissions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::auth::PublicUser;
    use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
    use tauri::Manager;

    async fn owner_app() -> (tauri::App<tauri::test::MockRuntime>, PublicUser) {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        (app, owner)
    }

    #[tokio::test]
    async fn create_role_seeds_view_only_permissions() {
        let (app, _owner) = owner_app().await;
        let role = create_custom_role(
            app.state(),
            app.state(),
            "Sales Manager".to_string(),
            Some("Handles sales".to_string()),
        )
        .await
        .expect("create role");

        assert_eq!(role.role, "Sales Manager");
        assert!(role.is_custom);
        let views: Vec<&RolePermission> = role
            .permissions
            .iter()
            .filter(|p| p.permission == "view")
            .collect();
        assert_eq!(views.len(), ALL_MODULES.len(), "view on every module");
        assert!(views.iter().all(|p| p.allowed));

        let creates: Vec<&RolePermission> = role
            .permissions
            .iter()
            .filter(|p| p.permission == "create")
            .collect();
        assert!(!creates.is_empty());
        assert!(creates.iter().all(|p| !p.allowed), "no create by default");
    }

    #[tokio::test]
    async fn update_permissions_toggles_grant() {
        let (app, _owner) = owner_app().await;
        create_custom_role(app.state(), app.state(), "Editor".to_string(), None)
            .await
            .expect("create role");

        let updated = update_role_permissions(
            app.state(),
            app.state(),
            "Editor".to_string(),
            vec![
                UpdatePermissionInput {
                    module: "invoices".to_string(),
                    permission: "edit".to_string(),
                    allowed: true,
                },
                UpdatePermissionInput {
                    module: "invoices".to_string(),
                    permission: "finalize".to_string(),
                    allowed: true,
                },
            ],
        )
        .await
        .expect("update permissions");

        let edit = updated
            .permissions
            .iter()
            .find(|p| p.module == "invoices" && p.permission == "edit")
            .expect("edit row");
        assert!(edit.allowed);

        let finalize = updated
            .permissions
            .iter()
            .find(|p| p.module == "invoices" && p.permission == "finalize")
            .expect("finalize row");
        assert!(finalize.allowed);
    }

    #[tokio::test]
    async fn employee_role_permissions_are_respected() {
        let (app, _owner) = owner_app().await;
        create_custom_role(app.state(), app.state(), "Viewer".to_string(), None)
            .await
            .expect("create role");

        // Custom role is view-only: can view invoices, cannot edit.
        assert!(check_permission(
            app.state::<SqlitePool>().inner(),
            "Viewer",
            "invoices",
            "view"
        )
        .await
        .is_ok());
        assert!(check_permission(
            app.state::<SqlitePool>().inner(),
            "Viewer",
            "invoices",
            "edit"
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn delete_role_rejects_when_assigned() {
        let (app, owner) = owner_app().await;
        create_custom_role(app.state(), app.state(), "Guard".to_string(), None)
            .await
            .expect("create role");

        let company_id = owner.company_id.clone().unwrap();
        insert_user(
            app.state::<SqlitePool>().inner(),
            &company_id,
            "staff@test.com",
            "Staff",
            "Guard",
            true,
        )
        .await;

        let err = delete_custom_role(app.state(), app.state(), "Guard".to_string())
            .await
            .expect_err("delete should fail while assigned");
        assert!(err.contains("assigned"));
    }

    #[tokio::test]
    async fn non_owner_cannot_create_role() {
        let (app, owner) = owner_app().await;
        let company_id = owner.company_id.clone().unwrap();
        let admin = insert_user(
            app.state::<SqlitePool>().inner(),
            &company_id,
            "admin@test.com",
            "Admin",
            "admin",
            true,
        )
        .await;
        set_session_user(&app, admin).await;

        let err = create_custom_role(app.state(), app.state(), "Sneaky".to_string(), None)
            .await
            .expect_err("admin cannot create roles");
        assert!(err.contains("owner"));
    }
}
