-- ==========================================
-- Migration 010: FULL-TEXT SEARCH (FTS5)
-- ==========================================
--
-- Enables fast full-text search on products, customers, and invoices.
-- Replaces slow LIKE '%...%' queries.

-- Products FTS index
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    name, sku, custom_fields,
    content='products',
    content_rowid='rowid'
);

-- Populate from existing data
INSERT INTO products_fts(rowid, name, sku, custom_fields)
SELECT rowid, name, sku, COALESCE(custom_fields, '')
FROM products WHERE deleted_at IS NULL;

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS products_fts_insert AFTER INSERT ON products
WHEN NEW.deleted_at IS NULL
BEGIN
    INSERT INTO products_fts(rowid, name, sku, custom_fields)
    VALUES (NEW.rowid, NEW.name, NEW.sku, COALESCE(NEW.custom_fields, ''));
END;

CREATE TRIGGER IF NOT EXISTS products_fts_delete_on_update AFTER UPDATE ON products
WHEN OLD.deleted_at IS NULL
BEGIN
    INSERT INTO products_fts(products_fts, rowid, name, sku, custom_fields)
    VALUES ('delete', OLD.rowid, OLD.name, OLD.sku, COALESCE(OLD.custom_fields, ''));
END;

CREATE TRIGGER IF NOT EXISTS products_fts_insert_on_update AFTER UPDATE ON products
WHEN NEW.deleted_at IS NULL
BEGIN
    INSERT INTO products_fts(rowid, name, sku, custom_fields)
    VALUES (NEW.rowid, NEW.name, NEW.sku, COALESCE(NEW.custom_fields, ''));
END;

CREATE TRIGGER IF NOT EXISTS products_fts_delete AFTER DELETE ON products
WHEN OLD.deleted_at IS NULL
BEGIN
    INSERT INTO products_fts(products_fts, rowid, name, sku, custom_fields)
    VALUES ('delete', OLD.rowid, OLD.name, OLD.sku, COALESCE(OLD.custom_fields, ''));
END;


-- Customers FTS index
CREATE VIRTUAL TABLE IF NOT EXISTS customers_fts USING fts5(
    name, email, phone, cnic, ntn,
    content='customers',
    content_rowid='rowid'
);

INSERT INTO customers_fts(rowid, name, email, phone, cnic, ntn)
SELECT rowid, name, COALESCE(email,''), COALESCE(phone,''),
       COALESCE(cnic,''), COALESCE(ntn,'')
FROM customers WHERE deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS customers_fts_insert AFTER INSERT ON customers
WHEN NEW.deleted_at IS NULL
BEGIN
    INSERT INTO customers_fts(rowid, name, email, phone, cnic, ntn)
    VALUES (NEW.rowid, NEW.name, COALESCE(NEW.email,''),
            COALESCE(NEW.phone,''), COALESCE(NEW.cnic,''), COALESCE(NEW.ntn,''));
END;

CREATE TRIGGER IF NOT EXISTS customers_fts_delete_on_update AFTER UPDATE ON customers
WHEN OLD.deleted_at IS NULL
BEGIN
    INSERT INTO customers_fts(customers_fts, rowid, name, email, phone, cnic, ntn)
    VALUES ('delete', OLD.rowid, OLD.name, COALESCE(OLD.email, ''),
            COALESCE(OLD.phone, ''), COALESCE(OLD.cnic, ''), COALESCE(OLD.ntn, ''));
END;

CREATE TRIGGER IF NOT EXISTS customers_fts_insert_on_update AFTER UPDATE ON customers
WHEN NEW.deleted_at IS NULL
BEGIN
    INSERT INTO customers_fts(rowid, name, email, phone, cnic, ntn)
    VALUES (NEW.rowid, NEW.name, COALESCE(NEW.email, ''),
            COALESCE(NEW.phone, ''), COALESCE(NEW.cnic, ''), COALESCE(NEW.ntn, ''));
END;

CREATE TRIGGER IF NOT EXISTS customers_fts_delete AFTER DELETE ON customers
WHEN OLD.deleted_at IS NULL
BEGIN
    INSERT INTO customers_fts(customers_fts, rowid, name, email, phone, cnic, ntn)
    VALUES ('delete', OLD.rowid, OLD.name, COALESCE(OLD.email, ''),
            COALESCE(OLD.phone, ''), COALESCE(OLD.cnic, ''), COALESCE(OLD.ntn, ''));
END;
