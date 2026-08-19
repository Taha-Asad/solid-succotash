-- 019_fbr_integration.sql
-- FBR Digital Invoicing / PRAL Integration (spec §17)
--
-- Tables:
--   fbr_config           — per-company FBR credentials and environment settings
--   fbr_submission_queue — outbox pattern for invoice → PRAL submission

-- ============================================================
-- fbr_config: one row per company holding FBR connection details
-- ============================================================
CREATE TABLE IF NOT EXISTS fbr_config (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL UNIQUE REFERENCES companies(id),
    pral_token      TEXT,                  -- Bearer token for PRAL API
    token_expires_at TEXT,                 -- ISO timestamp when token expires
    environment     TEXT NOT NULL DEFAULT 'sandbox'
        CHECK (environment IN ('sandbox', 'production')),
    sandbox_url     TEXT NOT NULL DEFAULT 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata',
    production_url  TEXT NOT NULL DEFAULT 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata',
    is_active       INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    last_tested_at  TEXT,
    last_test_result TEXT,                -- JSON: {success, message, timestamp}
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbr_config_company ON fbr_config(company_id);

-- ============================================================
-- fbr_submission_queue: outbox pattern (§17.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS fbr_submission_queue (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL REFERENCES companies(id),
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    invoice_type    TEXT NOT NULL DEFAULT 'SI'
        CHECK (invoice_type IN ('SI', 'SC', 'SD')),  -- SI=Sales Invoice, SC=Sales Credit, SD=Sales Debit
    payload         TEXT NOT NULL,         -- JSON payload per §17.3
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    status          TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'submitting', 'validated', 'failed', 'dead')),
    scheduled_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempted_at TEXT,
    last_error      TEXT,
    irn             TEXT,                  -- Invoice Reference Number from FBR
    qr_data         TEXT,                  -- QR data string from FBR response
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fbr_queue_status
    ON fbr_submission_queue(status, scheduled_at)
    WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS idx_fbr_queue_company
    ON fbr_submission_queue(company_id);

-- ============================================================
-- invoices: add irn and fbr_status columns
-- ============================================================
-- fbr_invoice_number already exists (migration 004) but is never populated.
-- We add irn (the actual FBR Invoice Reference Number) and fbr_status.
-- These are handled by ensure_fbr_columns in Rust for idempotent upgrades.
