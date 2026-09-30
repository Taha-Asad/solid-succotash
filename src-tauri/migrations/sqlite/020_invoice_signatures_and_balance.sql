-- 020_invoice_signatures_and_balance.sql
-- Adds show_signatures and show_previous_balance toggle columns to company_invoice_settings.
-- Columns are also added idempotently via ensure_invoice_design_columns in sqlite_migrate.rs.
SELECT 1;
