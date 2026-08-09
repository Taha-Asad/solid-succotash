-- ==========================================
-- Migration 013: CUSTOM ROLES
-- ==========================================
--
-- Extends the role_permissions table (from migration 009) with
-- company-defined roles. Custom role names are stored in
-- `custom_roles` and their permissions live in the shared
-- `role_permissions` table keyed by role name, exactly like the
-- built-in owner/admin/employee roles.
--
-- The default view-only permission set is seeded when a role is
-- created (see roles.rs create_custom_role).

CREATE TABLE IF NOT EXISTS custom_roles (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,              -- role name used in users.role
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_company
ON custom_roles(company_id);

-- Ledger module permissions for the built-in roles (added after
-- migration 012 introduced the ledger). INSERT OR IGNORE keeps this
-- idempotent across startups.
INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES
('rp-50', 'owner',    'ledger', 'view', 1),
('rp-51', 'owner',    'ledger', 'post', 1),
('rp-52', 'admin',    'ledger', 'view', 1),
('rp-53', 'admin',    'ledger', 'post', 1),
('rp-54', 'employee', 'ledger', 'view', 1),

-- Owner gets view/create/edit/delete on every module (defensive:
-- check_permission short-circuits owner anyway, but keep the matrix
-- complete so the UI renders correctly).
('rp-55', 'owner',    'inventory', 'view', 1),
('rp-56', 'owner',    'reports', 'export', 1),
('rp-57', 'owner',    'users', 'view', 1),
('rp-58', 'owner',    'purchase_orders', 'view', 1);

-- ==========================================
-- ROLE VALIDATION (relax for custom roles)
-- ==========================================
-- Migration 002 created triggers that only allow the built-in roles
-- ('owner'/'admin'/'employee'). Custom roles stored in `custom_roles`
-- must also be assignable, so the triggers are replaced here.
-- DROP + CREATE is idempotent: migrations re-run on every startup and
-- migration 002's CREATE ... IF NOT EXISTS is a no-op once the
-- (replaced) trigger exists.

DROP TRIGGER IF EXISTS trg_users_validate_role_insert;

CREATE TRIGGER trg_users_validate_role_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.role NOT IN ('owner', 'admin', 'employee')
AND NOT EXISTS (
    SELECT 1 FROM custom_roles
    WHERE company_id = NEW.company_id
      AND name = NEW.role COLLATE NOCASE
      AND is_active = 1
)
BEGIN
    SELECT RAISE(ABORT, 'Invalid user role');
END;

DROP TRIGGER IF EXISTS trg_users_validate_role_update;

CREATE TRIGGER trg_users_validate_role_update
BEFORE UPDATE OF role ON users
FOR EACH ROW
WHEN NEW.role NOT IN ('owner', 'admin', 'employee')
AND NOT EXISTS (
    SELECT 1 FROM custom_roles
    WHERE company_id = NEW.company_id
      AND name = NEW.role COLLATE NOCASE
      AND is_active = 1
)
BEGIN
    SELECT RAISE(ABORT, 'Invalid user role');
END;
