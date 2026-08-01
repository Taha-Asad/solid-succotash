-- ==========================================
-- Migration 003: INVENTORY (Core Tables)
-- ==========================================
--
-- Design principle:
--   Core ERP fields → real columns (relational, your contract)
--   Company-specific fields → JSON column + metadata table
--   Database schema NEVER changes per-company
--   Only metadata changes

-- ==========================================
-- CATEGORIES
-- ==========================================

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
                    CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_company_name
ON categories(company_id, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_categories_company
ON categories(company_id);


-- ==========================================
-- SUPPLIERS
-- ==========================================

CREATE TABLE IF NOT EXISTS suppliers (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    contact_person  TEXT,
    email           TEXT,
    phone           TEXT,
    address         TEXT,
    tax_number      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1
                        CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_company
ON suppliers(company_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_company_name
ON suppliers(company_id, name COLLATE NOCASE);


-- ==========================================
-- PRODUCTS (the heart of inventory)
-- ==========================================
--
-- Core fields = your contract. Always exist. Always relational.
-- custom_fields = JSON blob for company-specific data.
--   Example: { "color": "Red", "warranty": "24 months", "shelf": "A3" }
--
-- The JSON column is NOT a dumping ground for everything.
-- SKU, price, quantity, etc. stay as real columns.
-- Only company-discovered fields go in JSON.

CREATE TABLE IF NOT EXISTS products (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,

    -- ---- Core identifiers ----
    sku             TEXT NOT NULL,
    name            TEXT NOT NULL,

    -- ---- Relationships ----
    category_id     TEXT,
    supplier_id     TEXT,

    -- ---- Pricing (integers = paisa/cents to avoid floating-point errors) ----
    cost_price      INTEGER NOT NULL DEFAULT 0,
    sell_price      INTEGER NOT NULL DEFAULT 0,
    tax_rate        INTEGER NOT NULL DEFAULT 0,

    -- ---- Stock ----
    quantity_in_stock INTEGER NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL DEFAULT 'pcs',

    -- ---- Flexible fields (discovered by Import Wizard) ----
    -- Stores JSON like: {"color":"Red","warranty":"2 years","shelf":"A3"}
    -- NULL means no custom fields set for this product
    custom_fields   TEXT,

    -- ---- Status ----
    is_active       INTEGER NOT NULL DEFAULT 1
                        CHECK (is_active IN (0, 1)),

    -- ---- Timestamps ----
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_company_sku
ON products(company_id, sku COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_products_company
ON products(company_id);

CREATE INDEX IF NOT EXISTS idx_products_category
ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_products_supplier
ON products(supplier_id);

CREATE INDEX IF NOT EXISTS idx_products_stock
ON products(company_id, quantity_in_stock);


-- ==========================================
-- STOCK MOVEMENTS (audit trail)
-- ==========================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    movement_type   TEXT NOT NULL
                        CHECK (movement_type IN (
                            'purchase', 'sale', 'adjustment', 'return', 'damage'
                        )),
    quantity        INTEGER NOT NULL,
    reference_note  TEXT,
    performed_by    TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movements_company
ON stock_movements(company_id);

CREATE INDEX IF NOT EXISTS idx_movements_product
ON stock_movements(product_id);

CREATE INDEX IF NOT EXISTS idx_movements_product_date
ON stock_movements(product_id, created_at);

CREATE INDEX IF NOT EXISTS idx_movements_type
ON stock_movements(company_id, movement_type);


-- ==========================================
-- COMPANY FIELD SETTINGS (metadata, not schema)
-- ==========================================
--
-- This is where the Import Wizard writes its discoveries.
-- Each row means: "This company uses this custom field."
--
-- field_type: 'text', 'number', 'date', 'dropdown'
-- validation_rules: JSON with constraints
--   e.g. {"required": true, "min": 0, "max": 999, "options": ["Red","Blue","Green"]}
-- field_order: controls display order in forms and tables
-- is_visible: toggle to hide without deleting

CREATE TABLE IF NOT EXISTS company_field_settings (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    field_name      TEXT NOT NULL,           -- e.g. "color", "warranty"
    field_label     TEXT NOT NULL,           -- e.g. "Color", "Warranty (months)"
    field_type      TEXT NOT NULL DEFAULT 'text'
                        CHECK (field_type IN ('text', 'number', 'date', 'dropdown')),
    is_visible      INTEGER NOT NULL DEFAULT 1
                        CHECK (is_visible IN (0, 1)),
    field_order     INTEGER NOT NULL DEFAULT 0,
    validation_rules TEXT,                   -- JSON constraints
    default_value   TEXT,                    -- pre-fill value for new products
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_settings_unique
ON company_field_settings(company_id, field_name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_field_settings_company
ON company_field_settings(company_id);


-- ==========================================
-- IMPORT TEMPLATES (saved mappings for reuse)
-- ==========================================
--
-- When a company imports an Excel file and maps columns,
-- the mapping is saved as a template.
-- Next time they upload a similar file, they can reuse the template.

CREATE TABLE IF NOT EXISTS import_templates (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    template_name   TEXT NOT NULL,           -- e.g. "Main Inventory", "Electronics Stock"
    file_type       TEXT NOT NULL DEFAULT 'xlsx'
                        CHECK (file_type IN ('xlsx', 'csv')),
    column_mappings TEXT NOT NULL,           -- JSON: {"A":"name","B":"sku","C":"sell_price",...}
    has_header_row  INTEGER NOT NULL DEFAULT 1
                        CHECK (has_header_row IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_templates_company
ON import_templates(company_id);


-- ==========================================
-- VALIDATION TRIGGERS
-- ==========================================

CREATE TRIGGER IF NOT EXISTS trg_movements_validate_product_insert
BEFORE INSERT ON stock_movements
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Product does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_prevent_delete_with_products
BEFORE DELETE ON categories
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM products WHERE category_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'Cannot delete a category that still has products');
END;

CREATE TRIGGER IF NOT EXISTS trg_suppliers_prevent_delete_with_products
BEFORE DELETE ON suppliers
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM products WHERE supplier_id = OLD.id
)
BEGIN
    SELECT RAISE(ABORT, 'Cannot delete a supplier that still has products');
END;
