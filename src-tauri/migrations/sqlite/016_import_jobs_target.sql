-- 016_import_jobs_target.sql
-- Import job metadata is added idempotently from Rust after the migration
-- list runs (PRAGMA table_info guard in sqlite_migrate.rs), because SQLite
-- does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
--
-- Columns added (import_jobs):
--   target TEXT   -- "products" | "customers" | "opening_stock" | "suppliers"
--
-- Indexes added (idempotent here):
--   idx_import_batch_products   ON products(import_batch_id)
--   idx_import_batch_customers  ON customers(import_batch_id)
--   idx_import_batch_suppliers  ON suppliers(import_batch_id)
--   idx_import_batch_movements  ON stock_movements(import_batch_id)
--   idx_import_batch_batches    ON stock_batches(import_batch_id)
--
-- Speeds up rollback deletes which filter on import_batch_id.

CREATE INDEX IF NOT EXISTS idx_import_batch_products   ON products(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_customers  ON customers(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_suppliers  ON suppliers(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_movements  ON stock_movements(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_batches    ON stock_batches(import_batch_id);

SELECT 1;
