-- ==========================================
-- Migration 009: SOFT-DELETE + VERSIONING
-- ==========================================
--
-- Adds deleted_at (archive) and version (optimistic locking)
-- to all major tables.
--
-- NOTE: the columns themselves are added by the Rust helper
-- `ensure_soft_delete_columns` in db/sqlite_migrate.rs (PRAGMA
-- table_info check + conditional ALTER). The migration runner
-- re-executes every .sql file on each startup, and SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so plain ALTER statements here would
-- fail on the second run.

-- ==========================================
-- IMPORT JOBS (Issue 9: import safety)
-- ==========================================

CREATE TABLE IF NOT EXISTS import_jobs (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    file_type       TEXT NOT NULL,
    file_name       TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rolled_back')),
    total_rows      INTEGER NOT NULL DEFAULT 0,
    processed_rows  INTEGER NOT NULL DEFAULT 0,
    error_rows      INTEGER NOT NULL DEFAULT 0,
    error_details   TEXT,           -- JSON array of errors
    column_mappings TEXT,           -- JSON of the mappings used
    created_by      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_company
ON import_jobs(company_id, created_at);

-- ==========================================
-- PERMISSION MODULES (Issue 8: granular permissions)
-- ==========================================

CREATE TABLE IF NOT EXISTS role_permissions (
    id          TEXT PRIMARY KEY,
    role        TEXT NOT NULL,          -- 'owner', 'admin', 'employee'
    module      TEXT NOT NULL,          -- 'inventory', 'invoices', 'reports', 'users', 'settings', 'purchase_orders'
    permission  TEXT NOT NULL,          -- 'view', 'create', 'edit', 'delete', 'finalize', 'export'
    allowed     INTEGER NOT NULL DEFAULT 1
                    CHECK (allowed IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perms_unique
ON role_permissions(role, module, permission);

-- Default permissions
-- Owner: everything
-- Admin: everything except user role changes and settings
-- Employee: view only on most modules

INSERT OR IGNORE INTO role_permissions (id, role, module, permission, allowed) VALUES
-- Owner permissions (all allowed)
('rp-01', 'owner', 'inventory', 'view', 1),
('rp-02', 'owner', 'inventory', 'create', 1),
('rp-03', 'owner', 'inventory', 'edit', 1),
('rp-04', 'owner', 'inventory', 'delete', 1),
('rp-05', 'owner', 'invoices', 'view', 1),
('rp-06', 'owner', 'invoices', 'create', 1),
('rp-07', 'owner', 'invoices', 'edit', 1),
('rp-08', 'owner', 'invoices', 'finalize', 1),
('rp-09', 'owner', 'reports', 'view', 1),
('rp-10', 'owner', 'reports', 'export', 1),
('rp-11', 'owner', 'users', 'view', 1),
('rp-12', 'owner', 'users', 'create', 1),
('rp-13', 'owner', 'users', 'edit', 1),
('rp-14', 'owner', 'settings', 'view', 1),
('rp-15', 'owner', 'settings', 'edit', 1),
('rp-16', 'owner', 'purchase_orders', 'view', 1),
('rp-17', 'owner', 'purchase_orders', 'create', 1),
('rp-18', 'owner', 'purchase_orders', 'finalize', 1),

-- Admin permissions (no settings, no user role changes)
('rp-20', 'admin', 'inventory', 'view', 1),
('rp-21', 'admin', 'inventory', 'create', 1),
('rp-22', 'admin', 'inventory', 'edit', 1),
('rp-23', 'admin', 'invoices', 'view', 1),
('rp-24', 'admin', 'invoices', 'create', 1),
('rp-25', 'admin', 'invoices', 'finalize', 1),
('rp-26', 'admin', 'reports', 'view', 1),
('rp-27', 'admin', 'users', 'view', 1),
('rp-28', 'admin', 'users', 'create', 1),
('rp-29', 'admin', 'purchase_orders', 'view', 1),
('rp-30', 'admin', 'purchase_orders', 'create', 1),
('rp-31', 'admin', 'purchase_orders', 'finalize', 1),
-- Admin additions: edit/delete inventory, edit invoices, manage customers,
-- edit purchase orders, and export reports.
('rp-32', 'admin', 'inventory', 'delete', 1),
('rp-33', 'admin', 'invoices', 'edit', 1),
('rp-34', 'admin', 'invoices', 'delete', 1),
('rp-35', 'admin', 'purchase_orders', 'edit', 1),
('rp-36', 'admin', 'reports', 'export', 1),
('rp-37', 'admin', 'settings', 'view', 1),
('rp-38', 'admin', 'settings', 'edit', 1),

-- Employee permissions (view only, except inventory view)
('rp-40', 'employee', 'inventory', 'view', 1),
('rp-41', 'employee', 'invoices', 'view', 1),
('rp-42', 'employee', 'reports', 'view', 1),
('rp-43', 'employee', 'purchase_orders', 'view', 1);
