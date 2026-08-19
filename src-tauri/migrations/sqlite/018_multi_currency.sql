-- Migration 018: Multi-Currency Support
-- Adds currency configuration, exchange rate cache, and invoice-level currency fields.

-- Currency reference table (seeded with common currencies)
CREATE TABLE IF NOT EXISTS currency_config (
    code TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimal_places INTEGER NOT NULL DEFAULT 2,
    thousands_sep TEXT NOT NULL DEFAULT ',',
    decimal_sep TEXT NOT NULL DEFAULT '.'
);

INSERT OR IGNORE INTO currency_config (code, symbol, name, decimal_places, thousands_sep, decimal_sep) VALUES
    ('PKR', 'Rs', 'Pakistani Rupee', 2, ',', '.'),
    ('USD', '$', 'US Dollar', 2, ',', '.'),
    ('EUR', '€', 'Euro', 2, ',', '.'),
    ('GBP', '£', 'British Pound', 2, ',', '.'),
    ('AED', 'د.إ', 'UAE Dirham', 2, ',', '.'),
    ('SAR', 'ر.س', 'Saudi Riyal', 2, ',', '.'),
    ('INR', '₹', 'Indian Rupee', 2, ',', '.'),
    ('JPY', '¥', 'Japanese Yen', 0, ',', '.'),
    ('CNY', '¥', 'Chinese Yuan', 2, ',', '.'),
    ('TRY', '₺', 'Turkish Lira', 2, '.', ','),
    ('CAD', 'C$', 'Canadian Dollar', 2, ',', '.'),
    ('AUD', 'A$', 'Australian Dollar', 2, ',', '.'),
    ('CHF', 'CHF', 'Swiss Franc', 2, ',', '.'),
    ('QAR', 'ر.ق', 'Qatari Riyal', 2, ',', '.'),
    ('KWD', 'د.ك', 'Kuwaiti Dinar', 3, ',', '.'),
    ('BHD', 'د.ب', 'Bahraini Dinar', 3, ',', '.'),
    ('OMR', 'ر.ع', 'Omani Rial', 3, ',', '.'),
    ('MYR', 'RM', 'Malaysian Ringgit', 2, ',', '.'),
    ('THB', '฿', 'Thai Baht', 2, ',', '.'),
    ('PHP', '₱', 'Philippine Peso', 2, ',', '.');

-- Exchange rate cache (stores rates fetched from API)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_currency TEXT NOT NULL,
    target_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
    ON exchange_rates (base_currency, target_currency, fetched_at DESC);

-- FX gain/loss GL accounts (added to chart of accounts seed)
-- 7000 = Foreign Exchange Gain (revenue)
-- 7100 = Foreign Exchange Loss (expense)
-- These are seeded via Rust ensure_currency_accounts() on first use.

-- Seed FX accounts for existing companies
INSERT OR IGNORE INTO accounts (id, company_id, code, name, account_type, is_system, is_active)
SELECT
    hex(randomblob(16)),
    c.id,
    '7000',
    'Foreign Exchange Gain',
    'revenue',
    1,
    1
FROM companies c
WHERE c.is_active = 1
AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '7000'
);

INSERT OR IGNORE INTO accounts (id, company_id, code, name, account_type, is_system, is_active)
SELECT
    hex(randomblob(16)),
    c.id,
    '7100',
    'Foreign Exchange Loss',
    'expense',
    1,
    1
FROM companies c
WHERE c.is_active = 1
AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '7100'
);
