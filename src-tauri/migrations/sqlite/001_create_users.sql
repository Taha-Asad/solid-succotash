-- 001_create_users.sql
-- This migration creates the users table for SQLite

CREATE TABLE IF NOT EXISTS users (
    -- id: primary key. In SQLite we use TEXT to store UUIDs.
    -- Why TEXT? Because SQLite doesn't have a native UUID type.
    -- We'll generate UUIDs in Rust and store them as strings.
    id TEXT PRIMARY KEY,

    -- email: must be unique (no two users can have the same email)
    email TEXT UNIQUE NOT NULL,

    -- password_hash: we NEVER store plain passwords.
    -- We store a "hash" (scrambled version) of the password.
    -- Even we can't read it.
    password_hash TEXT NOT NULL,

    -- full_name: self-explanatory
    full_name TEXT NOT NULL,

    -- role: 'super_admin', 'company_admin', or 'employee'
    -- This determines what the user can see/do.
    role TEXT NOT NULL DEFAULT 'employee',

    -- company_id: which company this user belongs to
    -- Super admins have company_id = NULL (they belong to no company)
    company_id TEXT,

    -- is_active: soft delete. We don't delete users; we deactivate them.
    -- This preserves invoice history linked to this user.
    is_active INTEGER NOT NULL DEFAULT 1,  -- 1 = true, 0 = false (SQLite has no boolean)

    -- is_super_admin: cross-tenant admin flag (spec §3.11).
    -- Super admins have company_id = NULL and are not scoped to a company.
    -- Added for fresh databases by migration 017; existing databases get
    -- the column from `ensure_saas_columns` (db/sqlite_migrate.rs).
    is_super_admin INTEGER NOT NULL DEFAULT 0,  -- 1 = true, 0 = false

    -- must_change_password: forces a password change on next login
    -- (spec §7.3 first-login flow).
    must_change_password INTEGER NOT NULL DEFAULT 0,  -- 1 = true, 0 = false

    -- token_version: if a user changes password, we increment this.
    -- All old login tokens become invalid. Forces re-login.
    token_version INTEGER NOT NULL DEFAULT 0,

    -- Timestamps (stored as ISO8601 strings: "2026-05-21T10:30:00Z")
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index: speeds up "find user by email" queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);