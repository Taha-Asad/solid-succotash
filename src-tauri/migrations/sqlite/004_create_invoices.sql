-- ==========================================
-- Migration 004: INVOICES & BILLING
-- ==========================================
--
-- Pakistani FBR-compliant invoice system.
--
-- Flow:
--   1. Create invoice (draft)
--   2. Add line items (products from inventory)
--   3. Finalize invoice (locks it, deducts stock)
--   4. Record payments against the invoice
--   5. Generate PDF for printing/emailing
--
-- All amounts are in paisa (smallest currency unit).
-- 1500 paisa = 15.00 PKR

-- ==========================================
-- CUSTOMERS
-- ==========================================
-- Who the company sells to.

CREATE TABLE IF NOT EXISTS customers (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,

    name            TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    address         TEXT,

    -- FBR fields (Pakistani tax compliance)
    cnic            TEXT,          -- Customer CNIC (for individuals)
    ntn             TEXT,          -- National Tax Number (for businesses)
    strn            TEXT,          -- Sales Tax Registration Number
    buyer_type      TEXT NOT NULL DEFAULT 'unregistered'
                        CHECK (buyer_type IN ('registered', 'unregistered')),

    is_active       INTEGER NOT NULL DEFAULT 1
                        CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_company
ON customers(company_id);

CREATE INDEX IF NOT EXISTS idx_customers_company_name
ON customers(company_id, name COLLATE NOCASE);


-- ==========================================
-- INVOICES
-- ==========================================
-- The main invoice header.

CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,

    -- Invoice identification
    invoice_number  TEXT NOT NULL,          -- Sequential: INV-001, INV-002, ...
    invoice_date    TEXT NOT NULL,          -- Date of the invoice
    due_date        TEXT,                   -- Payment due date

    -- Customer reference
    customer_id     TEXT NOT NULL,

    -- Status
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'finalized', 'paid', 'cancelled')),

    -- Amounts (all in paisa)
    subtotal        INTEGER NOT NULL DEFAULT 0,      -- Sum of line items before tax
    tax_total       INTEGER NOT NULL DEFAULT 0,      -- Total tax amount
    discount_total  INTEGER NOT NULL DEFAULT 0,      -- Total discount
    grand_total     INTEGER NOT NULL DEFAULT 0,      -- Final amount

    -- FBR fields
    fbr_invoice_number TEXT,                -- FBR digital invoice number (for later integration)
    po_number       TEXT,                   -- Customer's Purchase Order number
    reference_note  TEXT,                   -- Any additional notes

    -- Payment tracking
    amount_paid     INTEGER NOT NULL DEFAULT 0,      -- How much customer has paid
    balance_due     INTEGER NOT NULL DEFAULT 0,      -- grand_total - amount_paid

    -- Audit
    created_by      TEXT NOT NULL,          -- User ID who created it
    finalized_at    TEXT,                   -- When it was finalized (locked)
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Invoice number must be unique per company
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_company_number
ON invoices(company_id, invoice_number COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_invoices_company
ON invoices(company_id);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
ON invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
ON invoices(company_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_date
ON invoices(company_id, invoice_date);


-- ==========================================
-- INVOICE ITEMS (line items)
-- ==========================================
-- Each row is one product on an invoice.

CREATE TABLE IF NOT EXISTS invoice_items (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL,
    company_id      TEXT NOT NULL,

    -- Product reference
    product_id      TEXT NOT NULL,
    product_name    TEXT NOT NULL,           -- Snapshot: name at time of invoice
    product_sku     TEXT NOT NULL,           -- Snapshot: SKU at time of invoice

    -- Quantities and pricing
    quantity        INTEGER NOT NULL,
    unit_price      INTEGER NOT NULL,        -- Price per unit in paisa
    tax_rate        INTEGER NOT NULL DEFAULT 0,  -- Tax rate in basis points (1700 = 17%)
    tax_amount      INTEGER NOT NULL DEFAULT 0,  -- Calculated tax in paisa
    discount_rate   INTEGER NOT NULL DEFAULT 0,  -- Discount % * 100 (500 = 5%)
    discount_amount INTEGER NOT NULL DEFAULT 0,  -- Calculated discount in paisa
    line_total      INTEGER NOT NULL DEFAULT 0,  -- (quantity * unit_price) - discount + tax

    -- Audit
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_invoice
ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_items_product
ON invoice_items(product_id);

CREATE INDEX IF NOT EXISTS idx_items_company
ON invoice_items(company_id);


-- ==========================================
-- PAYMENT RECORDS
-- ==========================================
-- Tracks payments received against invoices.

CREATE TABLE IF NOT EXISTS payment_records (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL,
    company_id      TEXT NOT NULL,

    amount          INTEGER NOT NULL,        -- Payment amount in paisa
    payment_method  TEXT NOT NULL DEFAULT 'cash'
                        CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'cheque', 'online', 'other')),
    payment_date    TEXT NOT NULL,
    reference       TEXT,                    -- Cheque number, transaction ID, etc.
    notes           TEXT,

    received_by     TEXT NOT NULL,           -- User ID who recorded the payment
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice
ON payment_records(invoice_id);

CREATE INDEX IF NOT EXISTS idx_payments_company
ON payment_records(company_id);

CREATE INDEX IF NOT EXISTS idx_payments_date
ON payment_records(company_id, payment_date);


-- ==========================================
-- COMPANY INVOICE SETTINGS
-- ==========================================
-- Per-company invoice configuration.

CREATE TABLE IF NOT EXISTS company_invoice_settings (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL UNIQUE,

    -- FBR fields
    company_ntn     TEXT,                    -- Company's National Tax Number
    company_strn    TEXT,                    -- Company's Sales Tax Registration Number
    company_cnic    TEXT,                    -- Company owner's CNIC

    -- Invoice numbering
    invoice_prefix  TEXT NOT NULL DEFAULT 'INV',    -- e.g. "INV", "BILL", "IJ"
    next_number     INTEGER NOT NULL DEFAULT 1,     -- Next invoice number

    -- Payment terms
    default_due_days INTEGER NOT NULL DEFAULT 30,   -- Default days until payment due

    -- Footer
    invoice_footer  TEXT,                    -- e.g. "Thank you for your business!"
    terms_conditions TEXT,                   -- Payment terms and conditions

    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- VALIDATION TRIGGERS
-- ==========================================

-- Prevent editing a finalized invoice's header
CREATE TRIGGER IF NOT EXISTS trg_invoices_prevent_edit_finalized
BEFORE UPDATE ON invoices
FOR EACH ROW
WHEN OLD.status IN ('finalized', 'paid')
AND (OLD.subtotal != NEW.subtotal
     OR OLD.grand_total != NEW.grand_total
     OR OLD.customer_id != NEW.customer_id)
BEGIN
    SELECT RAISE(ABORT, 'Cannot modify a finalized invoice');
END;

-- Prevent adding items to a finalized invoice
CREATE TRIGGER IF NOT EXISTS trg_items_prevent_add_finalized
BEFORE INSERT ON invoice_items
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM invoices
    WHERE id = NEW.invoice_id
    AND status IN ('finalized', 'paid')
)
BEGIN
    SELECT RAISE(ABORT, 'Cannot add items to a finalized invoice');
END;

-- Validate invoice_items.product_id references a real product
CREATE TRIGGER IF NOT EXISTS trg_items_validate_product
BEFORE INSERT ON invoice_items
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Product does not exist');
END;

-- Validate payment_records.invoice_id references a real invoice
CREATE TRIGGER IF NOT EXISTS trg_payments_validate_invoice
BEFORE INSERT ON payment_records
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.invoice_id
)
BEGIN
    SELECT RAISE(ABORT, 'Invoice does not exist');
END;
