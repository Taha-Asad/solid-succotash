use super::*;
use std::collections::HashMap;
use sqlx::SqlitePool;
use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
use tauri::Manager;
use uuid::Uuid;

    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Creates a customer through the real command.
    async fn make_customer(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicCustomer {
        create_customer(
            app.state(),
            app.state(),
            name.to_string(),
            "cust@test.com".to_string(),
            "0300-111".to_string(),
            "Lahore".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create customer")
    }

    /// Creates a product with the given initial stock through the real command.
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
        stock: i64,
    ) -> crate::commands::inventory::PublicProduct {
        crate::commands::inventory::create_product(
            app.state(),
            app.state(),
            "".to_string(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            stock,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    /// Creates a draft invoice for the given customer.
    async fn make_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
    ) -> PublicInvoice {
        create_invoice(
            app.state(),
            app.state(),
            customer_id.to_string(),
            "2026-01-15".to_string(),
            "2026-02-14".to_string(),
            "PO-1".to_string(),
            "note".to_string(),
            None,
            None,
        )
        .await
        .expect("create invoice")
    }

    /// Adds an item (qty, unit_price, tax) to a draft invoice.
    async fn add_item(
        app: &tauri::App<tauri::test::MockRuntime>,
        invoice_id: &str,
        product_id: &str,
        quantity: i64,
        unit_price: i64,
        tax_rate: i64,
    ) -> Vec<PublicInvoiceItem> {
        add_invoice_item(
            app.state(),
            app.state(),
            invoice_id.to_string(),
            product_id.to_string(),
            quantity,
            unit_price,
            tax_rate,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item")
    }

    /// Builds a finalized invoice with one item and returns (invoice, product).
    async fn finalized_invoice_with_stock(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> (PublicInvoice, crate::commands::inventory::PublicProduct) {
        let customer = make_customer(app, "Walk-in").await;
        let product = make_product(app, "Widget", 10).await;
        let invoice = make_invoice(app, &customer.id).await;
        add_item(app, &invoice.id, &product.id, 2, 1000, 0).await;
        let finalized = finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize");
        (finalized, product)
    }

    // ---------------------------------------------------------------
    // clean_optional (pure)
    // ---------------------------------------------------------------

    #[test]
    fn clean_optional_blank_is_none() {
        // Input: "".
        // Expected: None.
        assert_eq!(clean_optional(""), None);
    }

    // ---------------------------------------------------------------
    // qr_svg (pure)
    // ---------------------------------------------------------------

    #[test]
    fn qr_svg_renders_scalable_markup() {
        // Input: a short payload.
        // Expected: a non-empty SVG at least 100px wide with a viewBox.
        let svg = qr_svg("INV-0001:100.00", 100);
        assert!(svg.contains("<svg"), "got: {svg}");
        let width = svg
            .split(r#"width=""#)
            .nth(1)
            .and_then(|s| s.split('"').next())
            .and_then(|s| s.parse::<u32>().ok());
        assert!(width.is_some_and(|w| w >= 100), "got width: {width:?}");
        assert!(svg.contains("viewBox"), "got: {svg}");
    }

    #[test]
    fn qr_svg_handles_large_payload() {
        // Input: a payload larger than any QR version supports.
        // Expected: empty string, no panic.
        let huge = "x".repeat(10_000);
        assert_eq!(qr_svg(&huge, 100), "");
    }

    #[test]
    fn clean_optional_trims() {
        // Input: "  abc  ".
        // Expected: Some("abc").
        assert_eq!(clean_optional("  abc  "), Some("abc".to_string()));
    }

    // ---------------------------------------------------------------
    // round_to_rupee (pure)
    // ---------------------------------------------------------------

    #[test]
    fn round_down_when_rem_below_50() {
        // Input: 123 paisa.
        // Expected: 100.
        assert_eq!(round_to_rupee(123), 100);
    }

    #[test]
    fn round_up_when_rem_at_least_50() {
        // Input: 150 paisa.
        // Expected: 200.
        assert_eq!(round_to_rupee(150), 200);
    }

    #[test]
    fn round_handles_negative_with_euclid() {
        // Input: -140 paisa.
        // Expected: -100.
        assert_eq!(round_to_rupee(-140), -100);
    }

    // ---------------------------------------------------------------
    // compute_line_amounts (pure)
    // ---------------------------------------------------------------

    #[test]
    fn line_amounts_percent_discount() {
        // Input: qty 10, price 1000, tax 17%, percent discount 10%.
        // Expected: (discount_rate 1000, tax 1530, discount 1000, line_total 10500).
        assert_eq!(
            compute_line_amounts(10, 1000, 1700, "percent", 1000),
            (1000, 1530, 1000, 10500)
        );
    }

    #[test]
    fn line_amounts_fixed_amount_discount() {
        // Input: qty 2, price 5000, tax 0, amount discount 3000.
        // Expected: (0, 0, 3000, 7000).
        assert_eq!(
            compute_line_amounts(2, 5000, 0, "amount", 3000),
            (0, 0, 3000, 7000)
        );
    }

    #[test]
    fn line_amounts_clamps_amount_discount_to_subtotal() {
        // Input: amount discount bigger than the line subtotal.
        // Expected: discount capped at line subtotal, line_total 0.
        assert_eq!(
            compute_line_amounts(1, 1000, 0, "amount", 99999),
            (0, 0, 1000, 0)
        );
    }

    #[test]
    fn line_amounts_no_discount_no_tax() {
        // Input: qty 3, price 200, tax 0, no discount.
        // Expected: (0, 0, 0, 600).
        assert_eq!(
            compute_line_amounts(3, 200, 0, "percent", 0),
            (0, 0, 0, 600)
        );
    }

    // ---------------------------------------------------------------
    // format_timestamp / is_leap (pure)
    // ---------------------------------------------------------------

    #[test]
    fn timestamp_epoch_is_1970_epoch() {
        // Input: 0 seconds.
        // Expected: "1970-01-01 00:00 UTC".
        assert_eq!(format_timestamp(0), "1970-01-01 00:00 UTC");
    }

    #[test]
    fn is_leap_handles_century_rules() {
        // Inputs: 2000, 1900, 2024, 2023.
        // Expected: true, false, true, false.
        assert!(is_leap(2000));
        assert!(!is_leap(1900));
        assert!(is_leap(2024));
        assert!(!is_leap(2023));
    }

    // ---------------------------------------------------------------
    // invoice placeholder engine (pure)
    // ---------------------------------------------------------------

    #[test]
    fn fill_template_replaces_known_and_keeps_unknown() {
        // Input: template with one known and one unknown token.
        // Expected: known replaced, unknown untouched.
        let mut map = HashMap::new();
        map.insert("customer_name".to_string(), "Ali & Co".to_string());
        map.insert("grand_total".to_string(), "1,250.00".to_string());
        let out = fill_template(
            "Hi {{customer_name}} total {{grand_total}} {{unknown_token}}",
            &map,
        );
        assert_eq!(out, "Hi Ali & Co total 1,250.00 {{unknown_token}}");
    }

    #[test]
    fn fill_template_handles_longest_token_first() {
        // Input: a token that is a prefix of another.
        // Expected: longer token wins even when shorter one exists.
        let mut map = HashMap::new();
        map.insert("tax_total".to_string(), "100.00".to_string());
        map.insert("total".to_string(), "0.00".to_string());
        let out = fill_template("{{tax_total}} / {{total}}", &map);
        assert_eq!(out, "100.00 / 0.00");
    }

    #[test]
    fn extract_tokens_finds_double_braced_tokens() {
        // Input: mixed text.
        // Expected: only {{...}} alphanumeric/underscore tokens.
        let toks = extract_tokens("a {{invoice_number}} b {not} c {{items_1_name}} d");
        assert_eq!(toks, vec!["invoice_number", "items_1_name"]);
    }

    #[test]
    fn known_placeholder_matches_core_and_item_fields() {
        // Inputs: core token, item token, junk token.
        // Expected: core + item recognised, junk not.
        assert!(is_known_placeholder("customer_name"));
        assert!(is_known_placeholder("items_12_line_total"));
        assert!(is_known_placeholder("items_1_sku"));
        assert!(!is_known_placeholder("items_x_name"));
        assert!(!is_known_placeholder("totally_bogus"));
        assert!(!is_known_placeholder("items_1_"));
    }

    #[test]
    fn placeholder_values_covers_core_and_items() {
        // Input: a doc with one line item.
        // Expected: core keys present, per-item keys populated.
        let item = PublicInvoiceItem {
            id: "i1".to_string(),
            invoice_id: "inv1".to_string(),
            company_id: "c1".to_string(),
            product_id: "p1".to_string(),
            product_name: "Widget".to_string(),
            product_sku: "SKU-1".to_string(),
            quantity: 2,
            unit_price: 1500,
            tax_rate: 1700,
            tax_amount: 510,
            discount_rate: 0,
            discount_amount: 0,
            discount_type: "percent".to_string(),
            line_total: 3510,
            created_at: "2026-01-01".to_string(),
            original_unit_price: 0,
            original_line_total: 0,
        };
        let doc = InvoiceDoc {
            invoice: PublicInvoice {
                id: "inv1".to_string(),
                company_id: "c1".to_string(),
                invoice_number: "INV-0001".to_string(),
                invoice_date: "2026-01-01".to_string(),
                due_date: None,
                customer_id: "cu1".to_string(),
                status: "finalized".to_string(),
                subtotal: 3000,
                tax_total: 510,
                discount_total: 0,
                grand_total: 3510,
                fbr_invoice_number: None,
                po_number: None,
                reference_note: None,
                amount_paid: 0,
                balance_due: 3510,
                created_by: "u1".to_string(),
                finalized_at: None,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                currency_code: "PKR".to_string(),
                exchange_rate: 1.0,
                irn: None,
                fbr_status: String::new(),
            },
            customer: PublicCustomer {
                id: "cu1".to_string(),
                company_id: "c1".to_string(),
                name: "Ali & Co".to_string(),
                email: Some("a@b.com".to_string()),
                phone: None,
                address: None,
                cnic: None,
                ntn: Some("1234567-8".to_string()),
                strn: None,
                buyer_type: "registered".to_string(),
                is_active: true,
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
                version: 1,
            },
            items: vec![item],
            payments: Vec::new(),
            company_name: "Ijaz & Co".to_string(),
            company_email: None,
            company_phone: None,
            company_address: None,
            currency: "Rs".to_string(),
            settings: InvoiceSettings {
                company_ntn: Some("1234567-8".to_string()),
                company_strn: None,
                company_cnic: None,
                invoice_prefix: "INV".to_string(),
                next_number: 1,
                default_due_days: 30,
                invoice_footer: None,
                terms_conditions: None,
                invoice_design: "classic".to_string(),
                design_accent_color: "#1d2b54".to_string(),
                show_qr: true,
                excel_template_base64: None,
                disclaimer: None,
                copyright: None,
                bank_details: None,
            },
            logo_base64: None,
            company_tagline: None,
        };

        let map = invoice_placeholder_values(&doc);
        assert_eq!(map.get("invoice_number").unwrap(), "INV-0001");
        assert_eq!(map.get("customer_name").unwrap(), "Ali & Co");
        assert_eq!(map.get("subtotal").unwrap(), "30.00");
        assert_eq!(map.get("grand_total").unwrap(), "35.10");
        assert_eq!(map.get("currency").unwrap(), "Rs");
        assert_eq!(map.get("items_1_name").unwrap(), "Widget");
        assert_eq!(map.get("items_1_qty").unwrap(), "2");
        assert_eq!(map.get("items_1_price").unwrap(), "15.00");
        assert_eq!(map.get("items_1_line_total").unwrap(), "35.10");
        assert!(!map.contains_key("items_2_name"));
    }

    // ---------------------------------------------------------------
    // generate_invoice_number (transaction helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn invoice_numbers_increment() {
        // Input: two calls in separate transactions.
        // Expected: "INV-0001" then "INV-0002".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let cid = company_id(&app).await;

        let n1 = {
            let mut tx = pool.begin().await.unwrap();
            let n = generate_invoice_number(&mut tx, &cid).await.expect("n1");
            tx.commit().await.unwrap();
            n
        };
        let n2 = {
            let mut tx = pool.begin().await.unwrap();
            let n = generate_invoice_number(&mut tx, &cid).await.expect("n2");
            tx.commit().await.unwrap();
            n
        };
        assert_eq!(n1, "INV-0001");
        assert_eq!(n2, "INV-0002");
    }

    // ---------------------------------------------------------------
    // customers
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_customer_succeeds() {
        // Input: valid registered customer.
        // Expected: Ok with buyer_type "registered", trimmed name.
        let app = owner_app().await;
        let c = create_customer(
            app.state(),
            app.state(),
            "  Acme Ltd  ".to_string(),
            "acme@test.com".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(c.name, "Acme Ltd");
        assert_eq!(c.buyer_type, "registered");
        assert_eq!(c.email.as_deref(), Some("acme@test.com"));
    }

    #[tokio::test]
    async fn create_customer_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Customer name cannot be empty".
        let app = owner_app().await;
        let err = create_customer(
            app.state(),
            app.state(),
            "  ".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Customer name cannot be empty");
    }

    #[tokio::test]
    async fn create_customer_rejects_bad_buyer_type() {
        // Input: buyer_type "walk-in".
        // Expected: Err "Buyer type must be 'registered' or 'unregistered'".
        let app = owner_app().await;
        let err = create_customer(
            app.state(),
            app.state(),
            "Acme".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "walk-in".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Buyer type must be 'registered' or 'unregistered'");
    }

    #[tokio::test]
    async fn create_customer_denied_for_employee() {
        // Input: employee logged in (invoices/view only).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_customer(
            app.state(),
            app.state(),
            "Acme".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn list_customers_and_delete() {
        // Input: create then delete a customer.
        // Expected: list reflects each state.
        let app = owner_app().await;
        let c = make_customer(&app, "Acme").await;

        let listed = list_customers(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(listed.len(), 1);

        delete_customer(app.state(), app.state(), c.id.clone())
            .await
            .expect("delete");

        let listed = list_customers(app.state(), app.state())
            .await
            .expect("list");
        assert!(listed.is_empty());
    }

    #[tokio::test]
    async fn delete_customer_not_found() {
        // Input: a random id.
        // Expected: Err "Customer not found".
        let app = owner_app().await;
        let err = delete_customer(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Customer not found");
    }

    #[tokio::test]
    async fn list_customers_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_customers(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_invoice
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_invoice_draft_with_number() {
        // Input: valid customer.
        // Expected: Ok, status "draft", number "INV-0001", due date stored.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;

        let inv = create_invoice(
            app.state(),
            app.state(),
            customer.id.clone(),
            "2026-01-15".to_string(),
            "2026-02-14".to_string(),
            "PO-9".to_string(),
            "hello".to_string(),
            None,
            None,
        )
        .await
        .expect("create");
        assert_eq!(inv.status, "draft");
        assert_eq!(inv.invoice_number, "INV-0001");
        assert_eq!(inv.due_date.as_deref(), Some("2026-02-14"));
        assert_eq!(inv.po_number.as_deref(), Some("PO-9"));
    }

    #[tokio::test]
    async fn create_invoice_customer_not_found() {
        // Input: a random customer id.
        // Expected: Err "Customer not found".
        let app = owner_app().await;
        let err = create_invoice(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Customer not found");
    }

    #[tokio::test]
    async fn create_invoice_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_invoice(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // add / update / remove invoice items
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn add_item_recalculates_totals() {
        // Input: two items with known prices.
        // Expected: invoice totals reflect the items.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p1 = make_product(&app, "Widget", 10).await;
        let p2 = make_product(&app, "Gadget", 5).await;
        let inv = make_invoice(&app, &customer.id).await;

        add_item(&app, &inv.id, &p1.id, 2, 1000, 0).await; // 2000
        add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p2.id.clone(),
            1,
            3000,
            1700, // 17% tax on 3000 = 510
            "percent".to_string(),
            0,
        )
        .await
        .expect("add second item");

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.items.len(), 2);
        assert_eq!(details.invoice.subtotal, 5000);
        assert_eq!(details.invoice.tax_total, 510);
        // 5510 paisa = 55.10 PKR → rounded to 55.00 = 5500.
        assert_eq!(details.invoice.grand_total, 5500);
    }

    #[tokio::test]
    async fn add_item_rejects_zero_quantity() {
        // Input: quantity 0.
        // Expected: Err "Quantity must be positive".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p.id.clone(),
            0,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Quantity must be positive");
    }

    #[tokio::test]
    async fn add_item_rejects_negative_price() {
        // Input: unit_price -1.
        // Expected: Err "Unit price cannot be negative".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            p.id.clone(),
            1,
            -1,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Unit price cannot be negative");
    }

    #[tokio::test]
    async fn add_item_product_not_found() {
        // Input: a random product id.
        // Expected: Err "Product not found".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product not found");
    }

    #[tokio::test]
    async fn update_and_remove_item() {
        // Input: add item, update its qty, then remove it.
        // Expected: totals follow each change; final item list empty.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        let items = add_item(&app, &inv.id, &p.id, 2, 1000, 0).await;

        let updated = update_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            items[0].id.clone(),
            5,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("update item");
        assert_eq!(updated[0].quantity, 5);

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.subtotal, 5000);

        let items = remove_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            items[0].id.clone(),
        )
        .await
        .expect("remove");
        assert!(items.is_empty());

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.grand_total, 0);
    }

    #[tokio::test]
    async fn update_item_not_on_invoice() {
        // Input: a random item id.
        // Expected: Err "Item not found on this invoice".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = update_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Item not found on this invoice");
    }

    #[tokio::test]
    async fn add_item_rejected_on_finalized_invoice() {
        // Input: adding an item to a finalized invoice.
        // Expected: Err "Can only add items to draft invoices".
        let app = owner_app().await;
        let (inv, product) = finalized_invoice_with_stock(&app).await;

        let err = add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            product.id.clone(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Can only add items to draft invoices");
    }

    #[tokio::test]
    async fn add_item_invoice_not_found() {
        // Input: a random invoice id.
        // Expected: Err "Invoice not found".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", 10).await;
        let err = add_invoice_item(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            p.id.clone(),
            1,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invoice not found");
    }

    // ---------------------------------------------------------------
    // finalize_invoice
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn finalize_deducts_stock_and_locks() {
        // Input: draft invoice with 2× Widget; product has 10.
        // Expected: status "finalized"; product stock 8; sale movement recorded.
        let app = owner_app().await;
        let (inv, product) = finalized_invoice_with_stock(&app).await;

        assert_eq!(inv.status, "finalized");
        assert!(inv.finalized_at.is_some());

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 8);

        let movements = crate::commands::inventory::list_stock_movements(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("movements");
        assert!(movements.iter().any(|m| m.movement_type == "sale"));
    }

    #[tokio::test]
    async fn finalize_rejects_insufficient_stock() {
        // Input: item qty 50 but only 10 in stock.
        // Expected: Err "Insufficient stock".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let product = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_invoice_item(
            app.state(),
            app.state(),
            inv.id.clone(),
            product.id.clone(),
            50,
            100,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Insufficient stock"), "got: {err}");
    }

    #[tokio::test]
    async fn finalize_rejects_zero_total() {
        // Input: draft invoice with no items.
        // Expected: Err "Cannot finalize an invoice with zero total".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("zero total"), "got: {err}");
    }

    #[tokio::test]
    async fn finalize_rejects_double_finalize() {
        // Input: finalize an already-finalized invoice.
        // Expected: Err "Invoice is not in draft status".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert_eq!(err, "Invoice is not in draft status");
    }

    #[tokio::test]
    async fn finalize_denied_for_employee() {
        // Input: employee logged in (no invoices/finalize).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_item(&app, &inv.id, &p.id, 1, 100, 0).await;

        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // get_invoice / list_invoices
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_invoice_returns_full_details() {
        // Input: finalized invoice.
        // Expected: customer, 1 item, no payments.
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let details = get_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("get");
        assert_eq!(details.invoice.id, inv.id);
        assert_eq!(details.customer.name, "Walk-in");
        assert_eq!(details.items.len(), 1);
        assert!(details.payments.is_empty());
    }

    #[tokio::test]
    async fn get_invoice_not_found() {
        // Input: a random id.
        // Expected: Err "Invoice not found".
        let app = owner_app().await;
        let err = get_invoice(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Invoice not found");
    }

    #[tokio::test]
    async fn list_invoices_returns_all() {
        // Input: two invoices.
        // Expected: 2 rows.
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        make_invoice(&app, &customer.id).await;
        make_invoice(&app, &customer.id).await;

        let invoices = list_invoices(app.state(), app.state()).await.expect("list");
        assert_eq!(invoices.len(), 2);
    }

    // ---------------------------------------------------------------
    // record_payment
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn record_payment_partial_and_full() {
        // Input: finalized invoice total 2000; pay 800 then 1200.
        // Expected: status finalized (balance 1200) then paid (balance 0).
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let p = make_product(&app, "Widget", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_item(&app, &inv.id, &p.id, 2, 1000, 0).await; // 2000 total
        let finalized = finalize_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("finalize");

        let after_partial = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            800,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "ref-1".to_string(),
            "advance".to_string(),
            None,
            None,
        )
        .await
        .expect("partial");
        assert_eq!(after_partial.status, "finalized");
        assert_eq!(after_partial.balance_due, finalized.grand_total - 800);

        let after_full = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            1200,
            "bank_transfer".to_string(),
            "2026-01-25".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .expect("full");
        assert_eq!(after_full.status, "paid");
        assert_eq!(after_full.amount_paid, finalized.grand_total);
        assert_eq!(after_full.balance_due, 0);
    }

    #[tokio::test]
    async fn record_payment_rejects_overpayment() {
        // Input: payment exceeding balance.
        // Expected: Err "Payment ... exceeds balance due".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            999999,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("exceeds balance due"), "got: {err}");
    }

    #[tokio::test]
    async fn record_payment_rejects_draft_invoice() {
        // Input: payment on a draft invoice.
        // Expected: Err "Cannot record payment for draft or cancelled invoices".
        let app = owner_app().await;
        let customer = make_customer(&app, "Acme").await;
        let inv = make_invoice(&app, &customer.id).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cannot record payment for draft or cancelled invoices");
    }

    #[tokio::test]
    async fn record_payment_rejects_invalid_method() {
        // Input: payment_method "bitcoin".
        // Expected: Err "Invalid payment method".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            100,
            "bitcoin".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Invalid payment method");
    }

    #[tokio::test]
    async fn record_payment_rejects_non_positive_amount() {
        // Input: amount 0.
        // Expected: Err "Payment amount must be positive".
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = record_payment(
            app.state(),
            app.state(),
            inv.id.clone(),
            0,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Payment amount must be positive");
    }

    // ---------------------------------------------------------------
    // invoice settings
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn settings_defaults_created() {
        // Input: fresh company.
        // Expected: prefix "INV", next_number 1, due 30.
        let app = owner_app().await;
        let s = get_invoice_settings(app.state(), app.state())
            .await
            .expect("settings");
        assert_eq!(s.invoice_prefix, "INV");
        assert_eq!(s.next_number, 1);
        assert_eq!(s.default_due_days, 30);
    }

    #[tokio::test]
    async fn settings_updated_and_upserted() {
        // Input: update settings twice (upsert must not duplicate).
        // Expected: latest values win, single row.
        let app = owner_app().await;

        let s = update_invoice_settings(
            app.state(),
            app.state(),
            "NTN-1".to_string(),
            "".to_string(),
            "".to_string(),
            "sale".to_string(),
            15,
            "footer".to_string(),
            "terms".to_string(),
            "modern".to_string(),
            "#2563eb".to_string(),
            true,
            "disclaimer".to_string(),
            "copyright".to_string(),
            "bank".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(s.invoice_prefix, "SALE");
        assert_eq!(s.default_due_days, 15);
        assert_eq!(s.company_ntn.as_deref(), Some("NTN-1"));
        assert_eq!(s.invoice_design, "modern");
        assert_eq!(s.design_accent_color, "#2563eb");
        assert!(s.show_qr);

        let s2 = update_invoice_settings(
            app.state(),
            app.state(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "   ".to_string(),
            0,
            "".to_string(),
            "".to_string(),
            "classic".to_string(),
            "#1d2b54".to_string(),
            true,
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("update again");
        assert_eq!(s2.invoice_prefix, "INV", "blank prefix falls back to INV");
        assert_eq!(s2.default_due_days, 30, "due days below 1 falls back to 30");
    }

    #[tokio::test]
    async fn update_settings_denied_for_employee() {
        // Input: employee logged in (no settings/edit).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = update_invoice_settings(
            app.state(),
            app.state(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "INV".to_string(),
            30,
            "".to_string(),
            "".to_string(),
            "classic".to_string(),
            "#1d2b54".to_string(),
            true,
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // misc
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_or_create_settings_is_idempotent() {
        // Input: call twice.
        // Expected: same defaults, no error.
        let app = owner_app().await;
        let cid = company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        let a = get_or_create_settings(&pool, &cid).await.expect("first");
        let b = get_or_create_settings(&pool, &cid).await.expect("second");
        assert_eq!(a.invoice_prefix, b.invoice_prefix);
        assert_eq!(a.next_number, b.next_number);
    }

    /// Extracts the current user's company id from the DB.
    async fn company_id(app: &tauri::App<tauri::test::MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap()
    }

    // ---------------------------------------------------------------
    // excel template: extract_tokens / is_known_placeholder (pure)
    // ---------------------------------------------------------------

    #[test]
    fn extract_tokens_finds_well_formed_tokens() {
        // Input: mixed text with {{token}}, {single} and empty {{}}.
        // Expected: only the well-formed {{token}} pairs.
        let text = "A {{customer_name}} B {{items_1_name}} C {not_a_token} D {{}} E";
        assert_eq!(extract_tokens(text), vec!["customer_name", "items_1_name"]);
    }

    #[test]
    fn extract_tokens_ignores_unclosed_braces() {
        // Input: an unclosed token.
        // Expected: no tokens.
        assert_eq!(extract_tokens("{{oops"), Vec::<String>::new());
    }

    #[test]
    fn is_known_placeholder_recognises_core_items_and_footer() {
        // Input: core, footer and item tokens plus garbage.
        // Expected: core/footer/item true, garbage false.
        assert!(is_known_placeholder("customer_name"));
        assert!(is_known_placeholder("terms_conditions"));
        assert!(is_known_placeholder("disclaimer"));
        assert!(is_known_placeholder("copyright"));
        assert!(is_known_placeholder("bank_details"));
        assert!(is_known_placeholder("items_3_sku"));
        assert!(!is_known_placeholder("anything_random"));
        assert!(is_known_placeholder("items_0_name"), "any numeric index is accepted");
        assert!(!is_known_placeholder("items_x_price"));
    }

    // ---------------------------------------------------------------
    // excel template: fill_excel_template (pure, in-memory zip)
    // ---------------------------------------------------------------

    /// Builds a minimal but structurally valid xlsx whose only cell text is
    /// `sheet_text` (so tests can assert on placeholder filling).
    fn build_test_xlsx(sheet_text: &str) -> Vec<u8> {
        use std::io::Write;
        let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        zw.start_file("[Content_Types].xml", opts).unwrap();
        zw.write_all(
            br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>"#,
        )
        .unwrap();
        zw.start_file("xl/workbook.xml", opts).unwrap();
        zw.write_all(
            br#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        )
        .unwrap();
        zw.start_file("xl/worksheets/sheet1.xml", opts).unwrap();
        zw.write_all(
            format!(
                r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>{sheet_text}</v></c></row></sheetData></worksheet>"#
            )
            .as_bytes(),
        )
        .unwrap();
        zw.finish().unwrap().into_inner()
    }

    /// Reads the sheet1.xml text back out of a (possibly filled) xlsx.
    fn sheet_text_from_xlsx(bytes: &[u8]) -> String {
        use std::io::Read;
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).expect("valid zip");
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).expect("entry");
            if entry.name().ends_with("sheet1.xml") {
                let mut text = String::new();
                entry.read_to_string(&mut text).expect("read sheet");
                return text;
            }
        }
        String::new()
    }

    #[test]
    fn fill_excel_template_replaces_known_tokens() {
        // Input: xlsx containing {{customer_name}}, {{grand_total}} and an
        //        unknown token.
        // Expected: known tokens replaced, unknown left intact.
        let xlsx = build_test_xlsx("{{customer_name}} owes {{grand_total}} {{unknown_one}}");
        let mut map = HashMap::new();
        map.insert("customer_name".to_string(), "Aisha Traders".to_string());
        map.insert("grand_total".to_string(), "Rs 1,234.50".to_string());
        let filled = fill_excel_template(&xlsx, &map).expect("fill");
        let text = sheet_text_from_xlsx(&filled);
        assert!(text.contains("Aisha Traders"), "got: {text}");
        assert!(text.contains("Rs 1,234.50"), "got: {text}");
        assert!(text.contains("{{unknown_one}}"), "got: {text}");
    }

    #[test]
    fn fill_excel_template_rejects_non_zip() {
        // Input: garbage bytes.
        // Expected: Err mentioning "not a valid Excel".
        let err =
            fill_excel_template(b"this is not a zip file at all", &HashMap::new()).unwrap_err();
        assert!(err.contains("not a valid Excel"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // excel template: save / analyze / generate (DB-backed)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn save_excel_template_rejects_non_zip() {
        // Input: base64 of non-zip bytes.
        // Expected: Err "Uploaded file is not a valid Excel".
        let app = owner_app().await;
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        let err = save_invoice_excel_template(app.state(), app.state(), BASE64.encode("hello"))
            .await
            .unwrap_err();
        assert!(err.contains("not a valid Excel"), "got: {err}");
    }

    #[tokio::test]
    async fn analyze_excel_template_without_template() {
        // Input: fresh company with no template uploaded.
        // Expected: has_template false, no known/unknown, all common missing.
        let app = owner_app().await;
        let analysis = analyze_invoice_excel_template(app.state(), app.state())
            .await
            .expect("analyze");
        assert!(!analysis.has_template);
        assert!(analysis.known_tokens.is_empty());
        assert!(analysis.unknown_tokens.is_empty());
        assert_eq!(
            analysis.missing_common_tokens.len(),
            COMMON_PLACEHOLDERS.len()
        );
    }

    #[tokio::test]
    async fn save_and_analyze_excel_template_roundtrip() {
        // Input: upload a template containing every common token plus a bogus
        //        one.
        // Expected: has_template true, known tokens include customer_name,
        //           unknown tokens include bogus_one, nothing missing.
        let app = owner_app().await;
        let xlsx = build_test_xlsx(
            "{{company_name}} {{customer_name}} {{invoice_number}} {{invoice_date}} \
             {{subtotal}} {{tax_total}} {{grand_total}} {{status}} {{bogus_one}}",
        );
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        let saved = save_invoice_excel_template(app.state(), app.state(), BASE64.encode(&xlsx))
            .await
            .expect("save");
        assert!(saved.excel_template_base64.is_some());

        let analysis = analyze_invoice_excel_template(app.state(), app.state())
            .await
            .expect("analyze");
        assert!(analysis.has_template);
        assert!(analysis
            .known_tokens
            .contains(&"customer_name".to_string()));
        assert_eq!(analysis.unknown_tokens, vec!["bogus_one".to_string()]);
        assert!(
            analysis.missing_common_tokens.is_empty(),
            "got: {:?}",
            analysis.missing_common_tokens
        );
    }

    #[tokio::test]
    async fn generate_invoice_excel_writes_filled_file() {
        // Input: finalized invoice + uploaded template with {{customer_name}}
        //        and {{invoice_number}}.
        // Expected: file written to save_path with every token filled.
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let xlsx = build_test_xlsx("Customer: {{customer_name}} Invoice: {{invoice_number}}");
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        save_invoice_excel_template(app.state(), app.state(), BASE64.encode(&xlsx))
            .await
            .expect("save");

        let path = std::env::temp_dir()
            .join(format!("invoice-excel-{}.xlsx", Uuid::new_v4()))
            .to_str()
            .unwrap()
            .to_string();
        let out = generate_invoice_excel(app.state(), app.state(), inv.id.clone(), Some(path.clone()))
            .await
            .expect("generate");
        assert_eq!(out, path);

        let bytes = std::fs::read(&path).expect("read file");
        std::fs::remove_file(&path).ok();
        let text = sheet_text_from_xlsx(&bytes);
        assert!(text.contains("Customer: Walk-in"), "got: {text}");
        assert!(text.contains("Invoice: "), "got: {text}");
        assert!(!text.contains("{{"), "tokens left unfilled: {text}");
    }

    #[test]
    fn download_sample_invoice_template_writes_file() {
        // Input: a temp save path.
        // Expected: a non-empty xlsx (zip) is written at that path.
        let path = std::env::temp_dir()
            .join(format!("sample-invoice-{}.xlsx", Uuid::new_v4()))
            .to_str()
            .unwrap()
            .to_string();
        let out = download_sample_invoice_template(path.clone()).expect("download");
        assert_eq!(out, path);
        let bytes = std::fs::read(&path).expect("read file");
        std::fs::remove_file(&path).ok();
        assert!(!bytes.is_empty());
        assert!(zip::ZipArchive::new(std::io::Cursor::new(bytes)).is_ok());
    }

    #[tokio::test]
    async fn placeholder_values_include_footer_fields_and_items() {
        // Input: finalized invoice with the new footer settings set.
        // Expected: the fill map carries terms/disclaimer/copyright/bank and
        //           per-item tokens.
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        update_invoice_settings(
            app.state(),
            app.state(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "INV".to_string(),
            30,
            "footer".to_string(),
            "terms".to_string(),
            "classic".to_string(),
            "#1d2b54".to_string(),
            true,
            "disclaimer".to_string(),
            "copyright".to_string(),
            "bank".to_string(),
        )
        .await
        .expect("update settings");

        let cid = company_id(&app).await;
        let pool = app.state::<SqlitePool>();
        let doc = load_invoice_doc(&pool, &inv.id, &cid).await.expect("doc");
        let m = invoice_placeholder_values(&doc);
        assert_eq!(m.get("terms_conditions").map(String::as_str), Some("terms"));
        assert_eq!(m.get("disclaimer").map(String::as_str), Some("disclaimer"));
        assert_eq!(m.get("copyright").map(String::as_str), Some("copyright"));
        assert_eq!(m.get("bank_details").map(String::as_str), Some("bank"));
        assert_eq!(m.get("items_1_name").map(String::as_str), Some("Widget"));
        assert_eq!(m.get("items_1_qty").map(String::as_str), Some("2"));
    }

    #[tokio::test]
    async fn delete_invoice_draft_succeeds() {
        let app = owner_app().await;
        let customer = make_customer(&app, "Delete Draft Cust").await;
        let product = make_product(&app, "DRAFT-DEL", 10).await;
        let inv = make_invoice(&app, &customer.id).await;
        add_item(&app, &inv.id, &product.id, 2, 100, 0).await;

        let res = delete_invoice(app.state(), app.state(), inv.id.clone())
            .await
            .expect("delete draft");
        assert!(res);
    }

    #[tokio::test]
    async fn delete_invoice_rejects_finalized() {
        let app = owner_app().await;
        let (inv, _) = finalized_invoice_with_stock(&app).await;

        let err = delete_invoice(app.state(), app.state(), inv.id)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Only draft invoices can be deleted"));
    }

    #[tokio::test]
    async fn cancel_invoice_restores_stock_and_reverses() {
        let app = owner_app().await;
        let (inv, product) = finalized_invoice_with_stock(&app).await;

        let pool = app.state::<SqlitePool>();
        let cid = company_id(&app).await;

        // Stock after finalize was 10 - 2 = 8
        let stock_before: i64 = sqlx::query_scalar(
            "SELECT quantity_in_stock FROM products WHERE id = ? AND company_id = ?",
        )
        .bind(&product.id)
        .bind(&cid)
        .fetch_one(pool.inner())
        .await
        .expect("stock lookup");
        assert_eq!(stock_before, 8);

        // Cancel the invoice
        let cancelled = cancel_invoice(
            app.state(),
            app.state(),
            inv.id.clone(),
            Some("Wrong bill".to_string()),
        )
        .await
        .expect("cancel invoice");

        assert_eq!(cancelled.status, "cancelled");

        // Stock must be restored: 8 + 2 = 10!
        let stock_after: i64 = sqlx::query_scalar(
            "SELECT quantity_in_stock FROM products WHERE id = ? AND company_id = ?",
        )
        .bind(&product.id)
        .bind(&cid)
        .fetch_one(pool.inner())
        .await
        .expect("stock lookup");
        assert_eq!(stock_after, 10);

        // Check stock movement return record
        let movement_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM stock_movements WHERE product_id = ? AND movement_type = 'return'",
        )
        .bind(&product.id)
        .fetch_one(pool.inner())
        .await
        .expect("movement lookup");
        assert!(movement_count >= 1);
    }
