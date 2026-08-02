-- ==========================================
-- EXPIRY TRACKING — STOCK BATCHES
-- ==========================================
--
-- Products that expire (medicines, food, cosmetics, etc.) are managed
-- in batches. Each batch is a quantity of a product received together
-- with one expiry date. Stock is sold First-In-First-Out (FIFO): the
-- batch expiring soonest is consumed first, so nothing lingers on the
-- shelf and expires into a loss.
--
-- A product becomes "expiry-tracked" the moment its first batch is
-- created (from an Excel/CSV import with an expiry column, or a stock
-- IN with an expiry date). Once tracked, ALL of its stock flows
-- through batches.
--
-- expiry_date is always a real date from the file/user — never
-- defaulted. Non-expiry products simply never have batches.

CREATE TABLE IF NOT EXISTS stock_batches (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    product_id  TEXT NOT NULL,

    quantity    INTEGER NOT NULL,             -- remaining units in this batch
    unit_cost   INTEGER NOT NULL DEFAULT 0,   -- paisa per unit at receipt
    expiry_date TEXT NOT NULL,                -- YYYY-MM-DD, from file/user only

    source      TEXT NOT NULL DEFAULT 'purchase',  -- 'purchase', 'import', 'return', 'adjustment'
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batches_product_expiry
ON stock_batches(product_id, expiry_date);

CREATE INDEX IF NOT EXISTS idx_batches_product_qty
ON stock_batches(product_id, quantity);

CREATE INDEX IF NOT EXISTS idx_batches_company_expiry
ON stock_batches(company_id, expiry_date);
