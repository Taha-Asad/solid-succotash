-- ==========================================
-- COMPANIES
-- ==========================================

CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    tax_number TEXT,
    currency_code TEXT NOT NULL DEFAULT 'PKR',
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    -- SaaS / FBR columns. Added for fresh databases by migration 017;
    -- existing databases get them from `ensure_saas_columns`
    -- (db/sqlite_migrate.rs). See SAAS_SPECIFICATION.md §3.10.
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,     -- optimistic locking
    ntn TEXT,                               -- National Tax Number (FBR)
    strn TEXT,                              -- Sales Tax Registration Number (FBR)
    fbr_registered INTEGER NOT NULL DEFAULT 0
        CHECK (fbr_registered IN (0, 1)),
    fbr_registration_date TEXT,
    province TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_name
ON companies(name);

CREATE INDEX IF NOT EXISTS idx_companies_tax_number
ON companies(tax_number);


-- ==========================================
-- USER DATA INTEGRITY
-- ==========================================

-- The original email UNIQUE constraint is case-sensitive.
-- This prevents Test@example.com and test@example.com
-- from becoming two separate accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
ON users(email COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_users_company_role
ON users(company_id, role);

-- For the MVP, each company can have only one owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_owner_per_company
ON users(company_id)
WHERE company_id IS NOT NULL AND role = 'owner';


-- ==========================================
-- ROLE VALIDATION
-- ==========================================

CREATE TRIGGER IF NOT EXISTS trg_users_validate_role_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.role NOT IN ('owner', 'admin', 'employee')
BEGIN
    SELECT RAISE(ABORT, 'Invalid user role');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_validate_role_update
BEFORE UPDATE OF role ON users
FOR EACH ROW
WHEN NEW.role NOT IN ('owner', 'admin', 'employee')
BEGIN
    SELECT RAISE(ABORT, 'Invalid user role');
END;


-- ==========================================
-- COMPANY VALIDATION
-- ==========================================

-- Migration 001 created users before companies existed, so company_id
-- could not originally have a foreign key. These triggers enforce the
-- relationship without dangerously rebuilding the users table.

CREATE TRIGGER IF NOT EXISTS trg_users_validate_company_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.company_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.company_id
)
BEGIN
    SELECT RAISE(ABORT, 'Company does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_validate_company_update
BEFORE UPDATE OF company_id ON users
FOR EACH ROW
WHEN NEW.company_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = NEW.company_id
)
BEGIN
    SELECT RAISE(ABORT, 'Company does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_companies_prevent_delete_with_users
BEFORE DELETE ON companies
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM users WHERE company_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'Cannot delete a company that still has users');
END;