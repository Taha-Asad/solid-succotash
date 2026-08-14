-- ==========================================
-- Migration 017: SAAS INFRASTRUCTURE (Phase 1)
-- ==========================================
--
-- Multi-tenant building blocks (SAAS_SPECIFICATION.md §3):
--   packages, company_subscriptions, company_modules,
--   tenant_feature_flags, user_activity_logs, company_storage_usage
--
-- The user/company column additions (is_super_admin, must_change_password,
-- ntn, strn, ...) live in the Rust helper `ensure_saas_columns`
-- (db/sqlite_migrate.rs) because SQLite has no `ADD COLUMN IF NOT EXISTS`
-- and the runner re-executes every .sql file on startup. For fresh
-- databases the columns are also declared in the original CREATE TABLE
-- statements (migrations 001/002), exactly like migration 006 does for
-- stock_batches.batch_number.

-- ==========================================
-- SUPER ADMIN ROLE
-- ==========================================
-- Migration 002's triggers only allow owner/admin/employee (plus custom
-- roles from migration 013). The spec's role tree (§2.1) adds a
-- cross-tenant `super_admin` role, so the triggers are replaced here.
-- DROP + CREATE is idempotent: the runner re-runs on every startup and
-- migration 002's CREATE ... IF NOT EXISTS is a no-op once the
-- (replaced) trigger exists.

DROP TRIGGER IF EXISTS trg_users_validate_role_insert;

CREATE TRIGGER trg_users_validate_role_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.role NOT IN ('owner', 'admin', 'employee', 'super_admin')
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
WHEN NEW.role NOT IN ('owner', 'admin', 'employee', 'super_admin')
AND NOT EXISTS (
    SELECT 1 FROM custom_roles
    WHERE company_id = NEW.company_id
      AND name = NEW.role COLLATE NOCASE
      AND is_active = 1
)
BEGIN
    SELECT RAISE(ABORT, 'Invalid user role');
END;

-- ==========================================
-- PACKAGES (spec §3.1)
-- ==========================================
-- JSON-typed columns (module_limits, features) are stored as TEXT
-- because SQLite has no JSONB; the Rust layer parses them.

CREATE TABLE IF NOT EXISTS packages (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    price          REAL NOT NULL DEFAULT 0,
    billing_cycle  TEXT NOT NULL DEFAULT 'monthly',
    module_limits  TEXT NOT NULL DEFAULT '{}',      -- JSON: {module_key: limit}
    max_users      INTEGER NOT NULL DEFAULT 5,
    max_branches   INTEGER NOT NULL DEFAULT 1,
    max_storage_mb INTEGER NOT NULL DEFAULT 100,
    features       TEXT NOT NULL DEFAULT '{}',      -- JSON: {feature_key: true}
    is_active      INTEGER NOT NULL DEFAULT 1
                       CHECK (is_active IN (0, 1)),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    deleted_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packages_active
ON packages(is_active, sort_order);

-- ==========================================
-- COMPANY SUBSCRIPTIONS (spec §3.2)
-- ==========================================
-- One active subscription per company (SQLite adaptation of the
-- "current subscription" invariant; status history lives in metadata).

CREATE TABLE IF NOT EXISTS company_subscriptions (
    id                  TEXT PRIMARY KEY,
    company_id          TEXT NOT NULL UNIQUE,
    package_id          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'trial', 'past_due', 'suspended', 'cancelled', 'ended')),
    trial_ends_at       TEXT,
    current_period_start TEXT NOT NULL,
    current_period_end  TEXT NOT NULL,
    canceled_at         TEXT,
    ended_at            TEXT,
    metadata            TEXT NOT NULL DEFAULT '{}',  -- JSON
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_package
ON company_subscriptions(package_id, status);

-- ==========================================
-- COMPANY MODULES (spec §3.3 / §4.2)
-- ==========================================
-- Which modules a company has enabled. Sidebar rendering and module
-- enforcement read this table.

CREATE TABLE IF NOT EXISTS company_modules (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    module_key  TEXT NOT NULL,
    is_enabled  INTEGER NOT NULL DEFAULT 1
                    CHECK (is_enabled IN (0, 1)),
    settings    TEXT NOT NULL DEFAULT '{}',          -- JSON
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_company_modules_company
ON company_modules(company_id, is_enabled);

-- ==========================================
-- TENANT FEATURE FLAGS (spec §3.16)
-- ==========================================
-- Per-tenant rollout of new capabilities (e.g. `ai_insights`). Kept as
-- a zero-cost placeholder until features that use it ship.

CREATE TABLE IF NOT EXISTS tenant_feature_flags (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled  INTEGER NOT NULL DEFAULT 0
                    CHECK (is_enabled IN (0, 1)),
    enabled_by  TEXT,
    reason      TEXT,
    expires_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, feature_key)
);

-- ==========================================
-- USER ACTIVITY LOGS (spec §3.8)
-- ==========================================
-- Event stream per user (login, logout, failed login, ...). Kept
-- separate from audit_logs (admin actions) — this is telemetry.

CREATE TABLE IF NOT EXISTS user_activity_logs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    company_id TEXT,
    event_type TEXT NOT NULL,
    metadata   TEXT NOT NULL DEFAULT '{}',           -- JSON
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_user
ON user_activity_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_activity_created
ON user_activity_logs(created_at);

-- ==========================================
-- COMPANY STORAGE USAGE (spec §3.9 / §9.3)
-- ==========================================
-- Denormalized counter for per-package storage enforcement.

CREATE TABLE IF NOT EXISTS company_storage_usage (
    id                     TEXT PRIMARY KEY,
    company_id             TEXT NOT NULL UNIQUE,
    used_storage_bytes     INTEGER NOT NULL DEFAULT 0,
    file_count             INTEGER NOT NULL DEFAULT 0,
    last_recalculated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- DEFAULT PACKAGE SEEDS (spec §14.1.6)
-- ==========================================
-- INSERT OR IGNORE keeps this idempotent across startups. Module limits
-- are JSON maps keyed by the module keys from §4.1.

INSERT OR IGNORE INTO packages
    (id, name, description, price, billing_cycle, module_limits,
     max_users, max_branches, max_storage_mb, features, is_active, sort_order)
VALUES
    ('pkg-basic',
     'Basic',
     'Single branch, 5 users, core ERP modules.',
     0,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":0,"invoices":1,"import":0}',
     5, 1, 100,
     '{"fbr":false,"data_import":false}',
     1, 1),

    ('pkg-standard',
     'Standard',
     'Up to 3 branches, 15 users, import + invoice customization.',
     1499,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":1,"invoices":1,"import":1,"data_import":1}',
     15, 3, 500,
     '{"fbr":false,"data_import":true}',
     1, 2),

    ('pkg-premium',
     'Premium',
     'Unlimited branches and users, FBR compliance, priority support.',
     4999,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":1,"invoices":1,"import":1,"data_import":1}',
     100, 100, 2048,
     '{"fbr":true,"data_import":true}',
     1, 3);
