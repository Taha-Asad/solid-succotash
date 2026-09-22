-- ==========================================
-- 014_import_batches_and_units.sql
-- ==========================================
--
-- 1. Units of measurement (spec §23.16 "Units").
--    A small, company-scoped list of units used by products.
-- 2. Import rollback support. The `import_batch_id` columns that back
--    import_jobs rollback live on the tables ALTERed by
--    `ensure_import_columns` in db/sqlite_migrate.rs — plain
--    ALTER TABLE ADD COLUMN cannot live in a .sql file here because the
--    migration runner re-executes every file on startup.
--
-- The units table is created idempotently like every other table.

CREATE TABLE IF NOT EXISTS units (
    id         TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    symbol     TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
                    CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_units_company
ON units(company_id);
