-- ==========================================
-- Migration 007: PURCHASE ORDERS
-- ==========================================
--
-- Tracks buying from suppliers.
-- Lifecycle: draft → ordered → received → paid
--
-- When items are received, stock goes UP.
-- When received with expiry date, a stock_batch is created.

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    supplier_id     TEXT NOT NULL,

    po_number       TEXT NOT NULL,
    po_date         TEXT NOT NULL,
    expected_date   TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ordered', 'received', 'paid', 'cancelled')),

    subtotal        INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    grand_total     INTEGER NOT NULL DEFAULT 0,

    amount_paid     INTEGER NOT NULL DEFAULT 0,
    balance_due     INTEGER NOT NULL DEFAULT 0,

    reference_note  TEXT,
    created_by      TEXT NOT NULL,
    received_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_company_number
ON purchase_orders(company_id, po_number COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_po_company
ON purchase_orders(company_id);

CREATE INDEX IF NOT EXISTS idx_po_supplier
ON purchase_orders(supplier_id);

CREATE INDEX IF NOT EXISTS idx_po_status
ON purchase_orders(company_id, status);


CREATE TABLE IF NOT EXISTS purchase_order_items (
    id              TEXT PRIMARY KEY,
    po_id           TEXT NOT NULL,
    company_id      TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    product_name    TEXT NOT NULL,
    product_sku     TEXT NOT NULL,

    quantity_ordered    INTEGER NOT NULL,
    quantity_received   INTEGER NOT NULL DEFAULT 0,
    unit_cost           INTEGER NOT NULL,
    tax_rate            INTEGER NOT NULL DEFAULT 0,
    tax_amount          INTEGER NOT NULL DEFAULT 0,
    line_total          INTEGER NOT NULL DEFAULT 0,

    expiry_date         TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_po_items_po
ON purchase_order_items(po_id);

CREATE INDEX IF NOT EXISTS idx_po_items_product
ON purchase_order_items(product_id);


CREATE TABLE IF NOT EXISTS purchase_payments (
    id              TEXT PRIMARY KEY,
    po_id           TEXT NOT NULL,
    company_id      TEXT NOT NULL,

    amount          INTEGER NOT NULL,
    payment_method  TEXT NOT NULL DEFAULT 'cash'
                        CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
    payment_date    TEXT NOT NULL,
    reference       TEXT,
    notes           TEXT,

    recorded_by     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_po_payments_po
ON purchase_payments(po_id);

-- Auto-increment PO number tracking
CREATE TABLE IF NOT EXISTS company_po_settings (
    company_id      TEXT PRIMARY KEY,
    po_prefix       TEXT NOT NULL DEFAULT 'PO',
    next_number     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
