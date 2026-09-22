-- ==========================================
-- Migration 012: ACCOUNTING LEDGER
-- ==========================================
--
-- Double-entry bookkeeping (spec §19.2).
--
-- Chart of accounts is seeded per company (see ledger.rs
-- ensure_chart_of_accounts) with the default accounts:
--   1000 Cash                (asset)
--   1200 Accounts Receivable (asset)
--   2000 Accounts Payable    (liability)
--   3000 Owner's Equity      (equity)
--   4000 Sales Revenue       (revenue)
--   5000 Cost of Goods Sold  (expense)
--   6000 Operating Expenses  (expense)
--
-- All amounts are in paisa.
--
-- Every business event (invoice finalized, payment recorded,
-- manual adjustment, opening balance) posts a balanced journal
-- entry: SUM(debit) == SUM(credit) per journal entry. Balance is
-- enforced in application code (post_journal_entry) because SQLite
-- cannot defer a BEFORE INSERT trigger across multi-line entries.

CREATE TABLE IF NOT EXISTS accounts (
    id           TEXT PRIMARY KEY,
    company_id   TEXT NOT NULL,
    code         TEXT NOT NULL,             -- e.g. "1000"
    name         TEXT NOT NULL,             -- e.g. "Cash"
    account_type TEXT NOT NULL
                     CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    is_system    INTEGER NOT NULL DEFAULT 0
                     CHECK (is_system IN (0, 1)),
    is_active    INTEGER NOT NULL DEFAULT 1
                     CHECK (is_active IN (0, 1)),
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounts_company
ON accounts(company_id);

CREATE INDEX IF NOT EXISTS idx_accounts_company_type
ON accounts(company_id, account_type);

CREATE TABLE IF NOT EXISTS journal_entries (
    id             TEXT PRIMARY KEY,
    company_id     TEXT NOT NULL,
    entry_date     TEXT NOT NULL,           -- business date (ISO yyyy-mm-dd)
    reference_type TEXT NOT NULL,           -- invoice | payment | adjustment | opening_balance
    reference_id   TEXT,                    -- invoice id / payment id / import batch id
    description    TEXT,
    created_by     TEXT,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_journal_company_date
ON journal_entries(company_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_journal_company_ref
ON journal_entries(company_id, reference_type, reference_id);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id               TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    debit            INTEGER NOT NULL DEFAULT 0
                         CHECK (debit >= 0),
    credit           INTEGER NOT NULL DEFAULT 0
                         CHECK (credit >= 0),
    description      TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry
ON journal_entry_lines(journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account
ON journal_entry_lines(account_id);
