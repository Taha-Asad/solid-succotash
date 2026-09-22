use super::types::*;
use super::readers::{read_csv_rows, read_docx_rows, read_excel_rows};

// ==========================================
// ERP MIGRATION ADAPTERS & MAPPING HEURISTICS
// ==========================================

#[tauri::command]
pub async fn list_erp_adapters() -> Vec<ErpAdapterInfo> {
    vec![
        ErpAdapterInfo {
            key: "quickbooks_csv".to_string(),
            name: "QuickBooks Desktop".to_string(),
            description: "Items, customers, vendors and sales invoices (CSV / IIF)".to_string(),
        },
        ErpAdapterInfo {
            key: "quickbooks_online".to_string(),
            name: "QuickBooks Online".to_string(),
            description: "Products, customers and invoices exported as CSV".to_string(),
        },
        ErpAdapterInfo {
            key: "odoo_csv".to_string(),
            name: "Odoo".to_string(),
            description: "Product, partner (customer/vendor) and invoice CSV exports".to_string(),
        },
        ErpAdapterInfo {
            key: "erpnext_csv".to_string(),
            name: "ERPNext".to_string(),
            description: "Item, customer and sales-invoice CSV exports".to_string(),
        },
        ErpAdapterInfo {
            key: "excel_generic".to_string(),
            name: "MS Excel (generic)".to_string(),
            description: "Generic invoice spreadsheet — the spec's alias dictionary (§23.5)".to_string(),
        },
        ErpAdapterInfo {
            key: "tally_csv".to_string(),
            name: "Tally".to_string(),
            description: "Stock items / inventory master CSV exports".to_string(),
        },
    ]
}

/// The adapter's known column names for a target, as
/// `(target_field, alias column names)`. Column names are matched against
/// normalized headers, so casing/punctuation differences are tolerated.
fn erp_adapter_fields<'a>(
    adapter: &str,
    target: &str,
) -> Vec<(&'a str, &'a [&'a str])> {
    let fields: &[(&'a str, &'a [&'a str])] = match (adapter, target) {
        // ---- QuickBooks Desktop / Online: items, customers, vendors ----
        ("quickbooks_csv" | "quickbooks_online", "products") => &[
            ("name", &["name", "item", "item name", "product name"]),
            (
                "sku",
                &["part number", "partnumber", "sku", "item code", "code"],
            ),
            (
                "quantity_in_stock",
                &["qty on hand", "quantity on hand", "on hand", "qty"],
            ),
            ("cost_price", &["purchase cost", "cost price", "cost"]),
            (
                "sell_price",
                &["sales price", "selling price", "price", "rate"],
            ),
            ("unit", &["uom", "unit of measure", "unit"]),
            (
                "category",
                &["class", "category", "income account", "account"],
            ),
            ("supplier", &["preferred vendor", "vendor"]),
            ("tax_rate", &["tax rate", "tax percent", "tax"]),
        ],
        ("quickbooks_csv" | "quickbooks_online", "customers") => &[
            (
                "customer_name",
                &["name", "customer", "customer name", "company name"],
            ),
            ("email", &["email", "email address"]),
            (
                "phone",
                &["phone", "phone number", "phone no", "mobile"],
            ),
            (
                "address",
                &["bill address", "billing address", "address", "ship address"],
            ),
            ("ntn", &["tax id", "tax id number", "tax number", "vat reg"]),
            (
                "buyer_type",
                &["customer type", "customer status", "status"],
            ),
        ],
        ("quickbooks_csv" | "quickbooks_online", "suppliers") => &[
            (
                "supplier_name",
                &["name", "supplier", "vendor", "vendor name", "company name"],
            ),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "phone no"]),
            ("address", &["address", "billing address"]),
            ("tax_number", &["tax id", "tax id number", "tax number", "vat"]),
        ],
        ("quickbooks_csv" | "quickbooks_online", "invoices") => &[
            ("invoice_number", &["invoice no", "invoice number", "inv no", "inv number", "no"]),
            ("invoice_date", &["invoice date", "inv date", "transaction date", "date"]),
            ("customer_name", &["customer", "customer name", "buyer", "sold to"]),
            ("product_sku", &["item", "item name", "item description", "product", "product name"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price", "sales price"]),
            ("tax_rate", &["tax rate", "tax percent", "tax"]),
            ("total_amount", &["total", "grand total", "bill amount", "amount"]),
            ("amount_paid", &["amount paid", "paid amount", "received amount"]),
            ("status", &["status", "invoice status", "payment status"]),
        ],

        // ---- Odoo ----
        ("odoo_csv", "products") => &[
            ("name", &["name", "product name"]),
            (
                "sku",
                &["internal reference", "default code", "sku", "product code"],
            ),
            ("cost_price", &["cost", "standard price", "cost price"]),
            (
                "sell_price",
                &["list price", "sale price", "selling price"],
            ),
            (
                "quantity_in_stock",
                &["on hand quantity", "qty available", "quantity on hand", "stock quantity"],
            ),
            ("category", &["product category", "category", "categ"]),
            ("unit", &["uom", "unit of measure", "internal uom"]),
            ("supplier", &["vendor", "seller"]),
            ("tax_rate", &["taxes", "tax rate", "tax"]),
        ],
        ("odoo_csv", "customers") => &[
            ("customer_name", &["name", "customer", "customer name", "partner", "partner name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "mobile", "mobile number"]),
            ("address", &["street", "address", "street2", "billing address"]),
            ("ntn", &["tax id", "vat", "tax number", "vat number"]),
        ],
        ("odoo_csv", "suppliers") => &[
            ("supplier_name", &["name", "supplier", "vendor", "vendor name", "partner"]),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email", "email address"]),
            ("phone", &["phone", "phone number", "mobile"]),
            ("address", &["street", "address", "billing address"]),
            ("tax_number", &["tax id", "vat", "tax number"]),
        ],
        ("odoo_csv", "invoices") => &[
            ("invoice_number", &["name", "number", "invoice number", "invoice no", "reference"]),
            ("invoice_date", &["invoice date", "date", "billing date", "invoice date invoice"]),
            ("customer_name", &["partner", "customer", "customer name", "partner name"]),
            ("product_sku", &["product", "product name", "item", "sku"]),
            ("quantity", &["quantity", "qty"]),
            ("unit_price", &["unit price", "price unit", "price", "rate"]),
            ("tax_rate", &["tax", "taxes", "tax rate"]),
            ("total_amount", &["amount total", "total", "grand total", "amount"]),
            ("amount_paid", &["amount paid", "paid amount", "residual", "amount due"]),
            ("status", &["status", "invoice status", "payment status"]),
        ],

        // ---- ERPNext ----
        ("erpnext_csv", "products") => &[
            ("sku", &["item code", "item_code", "sku", "item"]),
            ("name", &["item name", "item_name", "name", "item description"]),
            ("cost_price", &["valuation rate", "valuation_rate", "cost price", "cost"]),
            ("sell_price", &["standard rate", "standard_rate", "price", "selling rate", "sales rate"]),
            (
                "quantity_in_stock",
                &["actual quantity", "actual_qty", "quantity on hand", "on hand", "qty"],
            ),
            ("category", &["item group", "item_group", "category"]),
            ("unit", &["stock uom", "stock_uom", "uom", "unit of measure"]),
            ("supplier", &["supplier", "vendor"]),
        ],
        ("erpnext_csv", "customers") => &[
            ("customer_name", &["customer name", "customer_name", "name", "customer"]),
            ("email", &["email id", "email_id", "email", "email address"]),
            ("phone", &["mobile no", "mobile_no", "phone", "mobile number"]),
            ("address", &["address", "billing address", "territory"]),
        ],
        ("erpnext_csv", "suppliers") => &[
            ("supplier_name", &["supplier name", "supplier_name", "name", "supplier"]),
            ("contact_person", &["contact", "contact person", "contact name"]),
            ("email", &["email id", "email_id", "email"]),
            ("phone", &["mobile no", "mobile_no", "phone"]),
            ("address", &["address", "billing address"]),
        ],
        ("erpnext_csv", "invoices") => &[
            ("invoice_number", &["name", "invoice number", "invoice no", "reference"]),
            ("invoice_date", &["posting date", "posting_date", "invoice date", "date"]),
            ("customer_name", &["customer", "customer name"]),
            ("product_sku", &["item code", "item_code", "item", "product"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price"]),
            ("tax_rate", &["tax", "tax rate", "taxes"]),
            ("total_amount", &["grand total", "total", "amount", "net total"]),
            ("amount_paid", &["amount paid", "paid amount", "outstanding amount"]),
            ("status", &["status", "invoice status"]),
        ],

        // ---- MS Excel generic invoice (spec §23.5 alias dictionary) ----
        ("excel_generic", "invoices") => &[
            (
                "customer_name",
                &["buyer", "client", "customer", "purchaser", "sold to", "customer name"],
            ),
            (
                "total_amount",
                &["amount", "total", "amt", "grand total", "bill amount", "total amount"],
            ),
            (
                "invoice_date",
                &["date", "inv date", "invoice date", "billing date"],
            ),
            (
                "invoice_number",
                &["inv #", "invoice no", "invoice number", "ref", "reference"],
            ),
        ],

        // ---- Tally ----
        ("tally_csv", "products") => &[
            ("name", &["name", "stock item", "item name", "item"]),
            ("sku", &["sku", "code", "item code", "part number"]),
            (
                "quantity_in_stock",
                &["opening quantity", "opening qty", "quantity", "closing quantity", "on hand"],
            ),
            ("cost_price", &["opening rate", "purchase price", "rate", "cost price", "valuation rate"]),
            ("sell_price", &["sales price", "selling price", "rate"]),
            ("unit", &["units", "uom", "unit", "unit of measure"]),
        ],
        ("tally_csv", "invoices") => &[
            ("invoice_number", &["invoice no", "invoice number", "voucher no", "voucher number", "ref"]),
            ("invoice_date", &["date", "invoice date", "voucher date", "billing date"]),
            ("customer_name", &["customer", "customer name", "party", "buyer", "sold to"]),
            ("product_sku", &["item", "item name", "product", "stock item", "sku"]),
            ("quantity", &["qty", "quantity"]),
            ("unit_price", &["rate", "unit price", "price", "amount"]),
            ("tax_rate", &["tax rate", "tax", "gst", "vat"]),
            ("total_amount", &["total", "grand total", "bill amount", "amount"]),
            ("status", &["status", "voucher type", "type"]),
        ],

        _ => &[],
    };
    fields.to_vec()
}



pub fn propose_mappings(target: &str, adapter: Option<&str>, headers: &[String]) -> Vec<FieldMapping> {
    let adapter_hints: Vec<(&str, &[&str])> = adapter
        .filter(|a| is_valid_adapter(a))
        .map(|a| erp_adapter_fields(a, target))
        .unwrap_or_default();

    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            let normalized = normalize_header(header);

            // 1. ERP adapter column name (pre-filled, high confidence).
            let adapter_hit = adapter_hints
                .iter()
                .find(|(_, aliases)| matches_any(&normalized, aliases))
                .map(|(field, _)| (field.to_string(), "core".to_string(), "high".to_string()));

            // 2. Fuzzy vocabulary per target.
            let (target_field, category, confidence) = match adapter_hit {
                Some(hit) => hit,
                None => match target {
                    "customers" => detect_customer_field(&normalized),
                    "suppliers" => detect_supplier_field(&normalized),
                    "opening_stock" => detect_opening_stock_field(&normalized),
                    "invoices" => detect_invoice_field(&normalized),
                    "purchase_bills" => detect_purchase_bill_field(&normalized),
                    _ => detect_field(&normalized),
                },
            };
            FieldMapping {
                source_column: header.clone(),
                source_index: index,
                target_field,
                field_category: category,
                confidence,
                manual_value: None,
            }
        })
        .collect()
}

/// Normalizes a header for matching:
/// lowercase, remove special chars, collapse spaces
pub fn normalize_header(header: &str) -> String {
    header
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Returns (target_field, field_category, confidence)
pub fn detect_field(normalized: &str) -> (String, String, String) {
    // ---- CORE FIELD PATTERNS ----

    // SKU
    if matches_any(
        normalized,
        &[
            "sku",
            "code",
            "item code",
            "product code",
            "barcode",
            "item no",
            "item number",
            "product id",
            "item id",
            "article no",
            "article number",
            "hs code",
            "hscode",
        ],
    ) {
        return ("sku".to_string(), "core".to_string(), "high".to_string());
    }

    // NAME
    if matches_any(
        normalized,
        &[
            "product name",
            "item name",
            "name",
            "item",
            "product",
            "description",
            "product description",
            "item description",
            "title",
            "product title",
        ],
    ) {
        return ("name".to_string(), "core".to_string(), "high".to_string());
    }

    // COST PRICE
    if matches_any(
        normalized,
        &[
            "cost price",
            "buying price",
            "purchase price",
            "buy price",
            "buying rate",
            "purchase rate",
            "cost rate",
            "landed cost",
            "unit cost",
            "base cost",
            "cost",
        ],
    ) {
        return (
            "cost_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX
    // Checked before SELL PRICE because SELL PRICE's broad "rate" pattern
    // would otherwise swallow "tax rate" / "gst rate" via substring match.
    if matches_any(
        normalized,
        &[
            "tax",
            "tax rate",
            "gst",
            "vat",
            "sales tax",
            "tax percentage",
        ],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // SELL PRICE
    if matches_any(
        normalized,
        &[
            "sell price",
            "selling price",
            "sale price",
            "retail price",
            "mrp",
            "selling rate",
            "sale rate",
            "unit price",
            "price",
            "rate",
            "amount",
        ],
    ) {
        return (
            "sell_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &[
            "qty",
            "quantity",
            "stock",
            "stock qty",
            "quantity in stock",
            "stock quantity",
            "count",
            "on hand",
            "onhand",
            "available",
            "balance",
            "opening stock",
            "opening qty",
        ],
    ) {
        return (
            "quantity_in_stock".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT
    if matches_any(
        normalized,
        &["unit", "uom", "unit of measure", "measure", "measurement"],
    ) {
        return ("unit".to_string(), "core".to_string(), "high".to_string());
    }

    // CATEGORY
    if matches_any(
        normalized,
        &[
            "category",
            "group",
            "type",
            "product type",
            "item type",
            "classification",
            "class",
            "product group",
            "item group",
        ],
    ) {
        return (
            "category".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // SUPPLIER
    if matches_any(
        normalized,
        &[
            "supplier",
            "vendor",
            "brand",
            "manufacturer",
            "supplier name",
            "vendor name",
            "brand name",
        ],
    ) {
        return (
            "supplier".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EXPIRY DATE
    // When a column matches, the imported stock is tracked as an
    // expiry batch and sold FIFO. Dates always come from the file —
    // never defaulted.
    if matches_any(
        normalized,
        &[
            "expiry date",
            "expiration date",
            "exp date",
            "expiry",
            "expiration",
            "exp",
            "best before",
            "best by",
            "use by",
            "sell by",
        ],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // ---- Everything else = CUSTOM FIELD ----
    // Use the normalized header as the field name
    let custom_name = normalized.replace(' ', "_");
    (
        format!("custom:{custom_name}"),
        "custom".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "customers" import target.
/// Unknown columns are skipped (customers have no custom fields).
fn detect_customer_field(normalized: &str) -> (String, String, String) {
    // BUYER TYPE
    // Checked first: "buyer"/"customer" also appear as NAME substrings,
    // so "buyer type" / "customer type" must win over the name patterns.
    if matches_any(
        normalized,
        &[
            "buyer type",
            "customer type",
            "buyer status",
            "registration status",
            "registered",
            "tax status",
        ],
    ) {
        return (
            "buyer_type".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // NAME
    if matches_any(
        normalized,
        &[
            "customer name",
            "customer full name",
            "customer",
            "client name",
            "client",
            "full name",
            "name",
            "buyer",
            "party",
            "account name",
            "account holder",
        ],
    ) {
        return (
            "customer_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // EMAIL
    if matches_any(
        normalized,
        &["email address", "e mail", "e-mail", "email", "mail"],
    ) {
        return ("email".to_string(), "core".to_string(), "high".to_string());
    }

    // PHONE
    if matches_any(
        normalized,
        &[
            "phone number",
            "mobile number",
            "contact number",
            "phone",
            "mobile",
            "contact",
            "telephone",
            "tel",
            "cell",
            "whatsapp",
        ],
    ) {
        return ("phone".to_string(), "core".to_string(), "high".to_string());
    }

    // ADDRESS
    if matches_any(
        normalized,
        &[
            "shipping address",
            "billing address",
            "full address",
            "address line",
            "address",
            "location",
            "address1",
        ],
    ) {
        return (
            "address".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // CNIC
    if matches_any(
        normalized,
        &[
            "cnic",
            "national id",
            "national identity",
            "id card",
            "identity",
            "nic",
        ],
    ) {
        return ("cnic".to_string(), "core".to_string(), "medium".to_string());
    }

    // NTN
    if matches_any(
        normalized,
        &[
            "national tax number",
            "ntn number",
            "ntn",
            "tax number",
            "tax no",
            "tax id",
        ],
    ) {
        return ("ntn".to_string(), "core".to_string(), "medium".to_string());
    }

    // STRN
    if matches_any(
        normalized,
        &[
            "strn number",
            "strn",
            "sales tax registration",
            "sales tax reg",
        ],
    ) {
        return ("strn".to_string(), "core".to_string(), "medium".to_string());
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "suppliers" import target.
fn detect_supplier_field(normalized: &str) -> (String, String, String) {
    // NAME (checked first: "supplier" appears as a substring of many labels)
    if matches_any(
        normalized,
        &[
            "supplier name",
            "supplier full name",
            "supplier",
            "vendor name",
            "vendor",
            "party",
            "full name",
            "name",
            "account name",
            "account holder",
        ],
    ) {
        return (
            "supplier_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // CONTACT PERSON
    if matches_any(
        normalized,
        &[
            "contact person",
            "contact name",
            "person",
            "poc",
            "representative",
            "contact",
        ],
    ) {
        return (
            "contact_person".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EMAIL
    if matches_any(
        normalized,
        &["email address", "e mail", "e-mail", "email", "mail"],
    ) {
        return ("email".to_string(), "core".to_string(), "high".to_string());
    }

    // PHONE
    if matches_any(
        normalized,
        &[
            "phone number",
            "mobile number",
            "contact number",
            "phone",
            "mobile",
            "telephone",
            "tel",
            "cell",
            "whatsapp",
        ],
    ) {
        return ("phone".to_string(), "core".to_string(), "high".to_string());
    }

    // ADDRESS
    if matches_any(
        normalized,
        &[
            "shipping address",
            "billing address",
            "full address",
            "address line",
            "address",
            "location",
        ],
    ) {
        return (
            "address".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // TAX NUMBER
    if matches_any(
        normalized,
        &[
            "national tax number",
            "ntn number",
            "ntn",
            "tax number",
            "tax no",
            "tax id",
            "strn",
            "sales tax registration",
        ],
    ) {
        return (
            "tax_number".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Field detection vocabulary for the "opening_stock" import target.
/// Rows reference products by SKU (the products import runs first).
fn detect_opening_stock_field(normalized: &str) -> (String, String, String) {
    // SKU
    if matches_any(
        normalized,
        &[
            "sku",
            "code",
            "item code",
            "product code",
            "barcode",
            "item no",
            "item number",
            "product id",
            "item id",
            "article no",
            "article number",
            "hs code",
            "hscode",
        ],
    ) {
        return ("sku".to_string(), "core".to_string(), "high".to_string());
    }

    // NAME (optional; used for friendly error messages only)
    if matches_any(
        normalized,
        &[
            "product name",
            "item name",
            "product description",
            "name",
            "item",
            "product",
            "description",
        ],
    ) {
        return ("name".to_string(), "core".to_string(), "medium".to_string());
    }

    // QUANTITY
    if matches_any(
        normalized,
        &[
            "opening stock",
            "opening qty",
            "quantity in stock",
            "stock quantity",
            "stock qty",
            "on hand",
            "onhand",
            "qty",
            "quantity",
            "stock",
            "balance",
            "count",
            "available",
            "units",
        ],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // COST PRICE (unit cost carried into expiry batches)
    if matches_any(
        normalized,
        &[
            "cost price",
            "unit cost",
            "buying price",
            "purchase price",
            "buy price",
            "landed cost",
            "base cost",
            "cost",
        ],
    ) {
        return (
            "cost_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // EXPIRY DATE
    if matches_any(
        normalized,
        &[
            "expiry date",
            "expiration date",
            "exp date",
            "expiry",
            "expiration",
            "best before",
            "best by",
            "use by",
            "sell by",
        ],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Header detector for the sales-invoice import target (spec §23.2).
/// Order matters: more specific patterns are checked first so e.g.
/// "reference note" is never captured by the generic "ref" alias.
fn detect_invoice_field(normalized: &str) -> (String, String, String) {
    // DISCOUNT (before total_amount — "discount amount" contains "amount")
    if matches_any(
        normalized,
        &["discount rate", "discount percent", "disc %", "discount"],
    ) {
        return (
            "discount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // AMOUNT PAID (before total_amount — "amount paid" contains "amount")
    if matches_any(
        normalized,
        &[
            "amount paid",
            "paid amount",
            "amount received",
            "received amount",
            "payment received",
        ],
    ) {
        return (
            "amount_paid".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX RATE (before total_amount — "tax amount" contains "amount")
    if matches_any(
        normalized,
        &["tax rate", "tax percent", "tax %", "sales tax", "gst", "vat", "tax"],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TOTAL AMOUNT
    if matches_any(
        normalized,
        &[
            "total amount",
            "grand total",
            "bill amount",
            "invoice total",
            "net amount",
            "net total",
            "total",
            "amount",
            "amt",
        ],
    ) {
        return (
            "total_amount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT PRICE (before quantity — "unit qty" contains "qty", not "price")
    if matches_any(
        normalized,
        &["unit price", "unit rate", "selling price", "sale price", "price", "rate"],
    ) {
        return (
            "unit_price".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &["no of units", "number of units", "quantity", "qty", "units", "unit count", "pieces"],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PRODUCT LINE (SKU)
    if matches_any(
        normalized,
        &[
            "product sku",
            "item sku",
            "product code",
            "item code",
            "barcode",
            "product",
            "item",
            "description",
        ],
    ) {
        return (
            "product_sku".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // CUSTOMER
    if matches_any(
        normalized,
        &[
            "customer name",
            "client name",
            "sold to",
            "billed to",
            "customer",
            "client",
            "buyer",
            "purchaser",
            "party",
            "name",
        ],
    ) {
        return (
            "customer_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // STATUS
    if matches_any(normalized, &["invoice status", "payment status", "status"]) {
        return (
            "status".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // DUE DATE
    if matches_any(normalized, &["due date", "payment due date", "payment terms date"]) {
        return (
            "due_date".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // CUSTOMER PO NUMBER
    if matches_any(
        normalized,
        &["po number", "po no", "customer po", "purchase order no", "order number"],
    ) {
        return (
            "po_number".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // REFERENCE NOTE (before the generic "ref"/"reference" below)
    if matches_any(normalized, &["reference note", "reference notes", "notes", "remarks", "remark", "note", "comment"]) {
        return (
            "reference_note".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // INVOICE DATE
    if matches_any(
        normalized,
        &["invoice date", "inv date", "billing date", "transaction date", "date"],
    ) {
        return (
            "invoice_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // INVOICE NUMBER
    if matches_any(
        normalized,
        &[
            "invoice number",
            "invoice no",
            "invoice num",
            "inv number",
            "inv no",
            "invoice #",
            "inv #",
            "reference number",
            "reference",
            "ref number",
            "ref no",
            "ref",
        ],
    ) {
        return (
            "invoice_number".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Header detector for the purchase-bill import target (spec §23.2).
fn detect_purchase_bill_field(normalized: &str) -> (String, String, String) {
    // EXPECTED DATE (before expiry — "expected" contains "exp")
    if matches_any(
        normalized,
        &["expected date", "expected arrival", "delivery date", "arrival date"],
    ) {
        return (
            "expected_date".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // EXPIRY DATE
    if matches_any(
        normalized,
        &["expiry date", "expiration date", "exp date", "expiry", "expiration", "best before", "use by", "sell by"],
    ) {
        return (
            "expiry_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // AMOUNT PAID
    if matches_any(
        normalized,
        &["amount paid", "paid amount", "amount paid to supplier", "payment made"],
    ) {
        return (
            "amount_paid".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TAX RATE
    if matches_any(
        normalized,
        &["tax rate", "tax percent", "tax %", "sales tax", "gst", "vat", "tax"],
    ) {
        return (
            "tax_rate".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // TOTAL AMOUNT
    if matches_any(
        normalized,
        &["total amount", "grand total", "bill amount", "invoice total", "net total", "total", "amount", "amt"],
    ) {
        return (
            "total_amount".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // UNIT COST
    if matches_any(
        normalized,
        &["unit cost", "unit price", "purchase price", "cost price", "cost", "rate"],
    ) {
        return (
            "unit_cost".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // QUANTITY
    if matches_any(
        normalized,
        &["quantity", "qty", "units", "no of units", "number of units", "pieces"],
    ) {
        return (
            "quantity".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PRODUCT LINE (SKU)
    if matches_any(
        normalized,
        &["product sku", "item sku", "product code", "item code", "barcode", "product", "item", "description"],
    ) {
        return (
            "product_sku".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // SUPPLIER
    if matches_any(
        normalized,
        &[
            "supplier name",
            "vendor name",
            "supplier",
            "vendor",
            "party",
            "seller",
            "account name",
            "name",
        ],
    ) {
        return (
            "supplier_name".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // STATUS
    if matches_any(normalized, &["po status", "payment status", "status"]) {
        return (
            "status".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // REFERENCE NOTE
    if matches_any(normalized, &["reference note", "reference notes", "notes", "remarks", "remark", "note", "comment"]) {
        return (
            "reference_note".to_string(),
            "core".to_string(),
            "medium".to_string(),
        );
    }

    // PO DATE
    if matches_any(
        normalized,
        &["po date", "bill date", "purchase date", "transaction date", "date"],
    ) {
        return (
            "po_date".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // PO NUMBER
    if matches_any(
        normalized,
        &["po number", "po no", "bill number", "bill no", "purchase order no", "voucher number", "voucher no", "reference number", "reference", "ref"],
    ) {
        return (
            "po_number".to_string(),
            "core".to_string(),
            "high".to_string(),
        );
    }

    // Everything else → skip
    (
        "skip".to_string(),
        "skip".to_string(),
        "unknown".to_string(),
    )
}

/// Check if a normalized header matches any of the patterns
fn matches_any(normalized: &str, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|p| normalized == *p || normalized.contains(p))
}

/// Detect the data type of a custom field from sample data
pub fn detect_field_type(request: &ImportRequest, mapping: &FieldMapping) -> String {
    // Manual fields have a fixed value for every row — classify from that.
    if let Some(manual) = mapping
        .manual_value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if manual.parse::<f64>().is_ok() {
            return "number".to_string();
        }
        if looks_like_date(manual) {
            return "date".to_string();
        }
        return "text".to_string();
    }

    let source_index = mapping.source_index;

    // Try to read the file again to get sample data
    let rows = match request.file_type.as_str() {
        "xlsx" | "xls" => read_excel_rows(&request.file_bytes).unwrap_or_default(),
        "csv" => read_csv_rows(&request.file_bytes).unwrap_or_default(),
        "docx" => read_docx_rows(&request.file_bytes).unwrap_or_default(),
        _ => return "text".to_string(),
    };

    let mut numeric_count = 0;
    let mut date_count = 0;
    let mut sample_count = 0;

    for row in rows.iter().skip(1).take(10) {
        if source_index >= row.len() {
            continue;
        }

        let value = &row[source_index];
        if value.is_empty() {
            continue;
        }

        sample_count += 1;

        // Check if numeric
        if value.parse::<f64>().is_ok() {
            numeric_count += 1;
            continue;
        }

        // Check if date-like (simple pattern)
        if looks_like_date(value) {
            date_count += 1;
        }
    }

    if sample_count == 0 {
        return "text".to_string();
    }

    // If >70% of values are numeric → number
    if (numeric_count as f64) / (sample_count as f64) > 0.7 {
        return "number".to_string();
    }

    // If >70% of values look like dates → date
    if (date_count as f64) / (sample_count as f64) > 0.7 {
        return "date".to_string();
    }

    "text".to_string()
}

/// Simple date pattern check
pub fn looks_like_date(value: &str) -> bool {
    let v = value.trim();
    // Common patterns: 2024-01-15, 15/01/2024, 01-15-2024
    let has_dash = v.len() >= 8
        && v.len() <= 12
        && v.contains('-')
        && v.chars().filter(|c| *c == '-').count() == 2;
    let has_slash = v.len() >= 8
        && v.len() <= 12
        && v.contains('/')
        && v.chars().filter(|c| *c == '/').count() == 2;
    has_dash || has_slash
}

/// Value a mapping contributes for a row. Manually-added fields (added in
/// the wizard's Map step, e.g. "Category = Medicines for every row")
/// return their constant value; everything else reads from the file's
/// column. Returns None when the mapping has nothing for this row.
pub fn mapping_value(mapping: &FieldMapping, row: &[String]) -> Option<String> {
    if let Some(manual) = mapping
        .manual_value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(manual.to_string());
    }
    if mapping.source_index >= row.len() {
        return None;
    }
    Some(row[mapping.source_index].trim().to_string())
}

/// Imports one row of data into the products table.
/// Returns Ok(true) when a row was imported, Ok(false) when it was
/// intentionally skipped (e.g. duplicate).
/// Formats the mapped-column note used in "missing required field" errors.
pub fn mapped_fields_note(mappings: &[FieldMapping], row: &[String]) -> String {
    mappings
        .iter()
        .filter(|m| m.target_field != "skip")
        .filter_map(|m| {
            mapping_value(m, row).map(|value| {
                format!(
                    "'{}' → {} = '{}'",
                    m.source_column, m.target_field, value
                )
            })
        })
        .collect::<Vec<_>>()
        .join(", ")
}


