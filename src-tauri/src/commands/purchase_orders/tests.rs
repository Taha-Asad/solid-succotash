use super::*;
use crate::commands::test_helpers::{insert_user, register_owner, set_session_user, setup_app};
use sqlx::SqlitePool;
use tauri::Manager;
use uuid::Uuid;

    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    /// Creates a supplier through the real inventory command.
    async fn make_supplier(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> crate::commands::inventory::PublicSupplier {
        crate::commands::inventory::create_supplier(
            app.state(),
            app.state(),
            name.to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create supplier")
    }

    /// Creates a product through the real inventory command.
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
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
            0,
            "pcs".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("create product")
    }

    /// Creates a draft PO for the given supplier.
    async fn make_po(
        app: &tauri::App<tauri::test::MockRuntime>,
        supplier_id: &str,
    ) -> PublicPurchaseOrder {
        create_purchase_order(
            app.state(),
            app.state(),
            supplier_id.to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "restock".to_string(),
        )
        .await
        .expect("create po")
    }

    /// Creates a submitted (ordered) PO with one item.
    async fn ordered_po_with_item(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> (
        PublicPurchaseOrder,
        crate::commands::inventory::PublicProduct,
    ) {
        let supplier = make_supplier(app, "Acme").await;
        let product = make_product(app, "Widget").await;
        let po = make_po(app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");
        let ordered = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");
        (ordered, product)
    }

    /// Company id of the registered owner.
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
    // clean (pure)
    // ---------------------------------------------------------------

    #[test]
    fn clean_blank_is_none() {
        // Input: "   ".
        // Expected: None.
        assert_eq!(clean("   "), None);
    }

    #[test]
    fn clean_trims_value() {
        // Input: "  note  ".
        // Expected: Some("note").
        assert_eq!(clean("  note  "), Some("note".to_string()));
    }

    // ---------------------------------------------------------------
    // next_po_number (helper)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn po_numbers_increment() {
        // Input: two calls.
        // Expected: "PO-0001" then "PO-0002".
        let app = owner_app().await;
        let cid = company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        let n1 = next_po_number(&pool, &cid).await.expect("n1");
        let n2 = next_po_number(&pool, &cid).await.expect("n2");
        assert_eq!(n1, "PO-0001");
        assert_eq!(n2, "PO-0002");
    }

    // ---------------------------------------------------------------
    // create_purchase_order
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_po_draft_with_number() {
        // Input: valid supplier.
        // Expected: Ok, status "draft", po_number "PO-0001".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;

        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "2026-02-01".to_string(),
            "restock".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(po.status, "draft");
        assert_eq!(po.po_number, "PO-0001");
        assert_eq!(po.supplier_name, "Acme");
        assert_eq!(po.expected_date.as_deref(), Some("2026-02-01"));
    }

    #[tokio::test]
    async fn create_po_supplier_not_found() {
        // Input: a random supplier id.
        // Expected: Err "Supplier not found".
        let app = owner_app().await;
        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Supplier not found");
    }

    #[tokio::test]
    async fn create_po_denied_for_employee() {
        // Input: employee logged in (purchase_orders/view only).
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

        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn create_po_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_purchase_order(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // add_po_item
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn add_po_item_recalculates_totals() {
        // Input: two items (10×500=5000, 5×200=1000 + 17% tax 170).
        // Expected: subtotal 6000, tax 170, grand 6170.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let p1 = make_product(&app, "Widget").await;
        let p2 = make_product(&app, "Gadget").await;
        let po = make_po(&app, &supplier.id).await;

        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p1.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("item 1");

        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p2.id.clone(),
            5,
            200,
            1700,
            None,
        )
        .await
        .expect("item 2");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.items.len(), 2);
        assert_eq!(details.order.subtotal, 6000);
        assert_eq!(details.order.tax_total, 170);
        assert_eq!(details.order.grand_total, 6170);
    }

    #[tokio::test]
    async fn add_po_item_rejects_zero_quantity() {
        // Input: quantity 0.
        // Expected: Err "Quantity must be positive".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            0,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Quantity must be positive");
    }

    #[tokio::test]
    async fn add_po_item_product_not_found() {
        // Input: a random product id.
        // Expected: Err "Product not found".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            Uuid::new_v4().to_string(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product not found");
    }

    #[tokio::test]
    async fn add_po_item_po_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let product = make_product(&app, "Widget").await;

        let err = add_po_item(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    #[tokio::test]
    async fn add_po_item_rejected_on_ordered_po() {
        // Input: adding an item to an ordered PO.
        // Expected: Err "Can only add items to draft POs".
        let app = owner_app().await;
        let (po, product) = ordered_po_with_item(&app).await;

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Can only add items to draft POs");
    }

    #[tokio::test]
    async fn owner_always_can_edit_po_items() {
        // Input: owner (short-circuited to all permissions) adds an item.
        // Expected: Ok — the "owner" role bypasses the permission table.
        // NOTE: this documents that `check_permission` grants owner everything,
        // so the missing owner/purchase_orders/edit seed row has no effect.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create po");

        let items = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .expect("owner can add an item");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].product_id, product.id);
    }

    #[tokio::test]
    async fn employee_cannot_edit_po_items() {
        // Input: employee logged in after the PO was created by the owner.
        // Expected: Err "Access denied: employee cannot edit purchase_orders"
        // (employee has view-only PO permissions in the seed data).
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = create_purchase_order(
            app.state(),
            app.state(),
            supplier.id.clone(),
            "2026-01-15".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("create po");

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

        let err = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            1,
            500,
            0,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // remove_po_item
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn remove_po_item_removes_and_recalcs() {
        // Input: two items, remove one.
        // Expected: one item remains, totals recalculated to 0.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let p1 = make_product(&app, "Widget").await;
        let p2 = make_product(&app, "Gadget").await;
        let po = make_po(&app, &supplier.id).await;
        let items1 = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p1.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("item 1");
        let _items2 = add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            p2.id.clone(),
            5,
            200,
            0,
            None,
        )
        .await
        .expect("item 2");

        let remaining = remove_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            items1[0].id.clone(),
        )
        .await
        .expect("remove");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].product_id, p2.id);

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.order.grand_total, 1000);
    }

    #[tokio::test]
    async fn remove_po_item_missing_is_noop() {
        // Input: removing a non-existent item.
        // Expected: Ok — the DELETE matches 0 rows and no error is raised.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");

        let remaining = remove_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            Uuid::new_v4().to_string(),
        )
        .await
        .expect("remove noop");
        assert_eq!(remaining.len(), 1, "nothing was removed");
    }

    // ---------------------------------------------------------------
    // submit_purchase_order
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn submit_moves_to_ordered() {
        // Input: draft PO.
        // Expected: status "ordered".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let submitted = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");
        assert_eq!(submitted.status, "ordered");
    }

    #[tokio::test]
    async fn submit_rejects_double_submit() {
        // Input: submit an already-ordered PO.
        // Expected: Err "PO not found or not in draft status".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found or not in draft status");
    }

    #[tokio::test]
    async fn submit_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found or not in draft status".
        let app = owner_app().await;
        let err = submit_purchase_order(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found or not in draft status");
    }

    #[tokio::test]
    async fn submit_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;
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

        let err = submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // receive_po_items
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn receive_increases_stock_and_records_movement() {
        // Input: ordered PO with 10× Widget.
        // Expected: status "received"; product stock 10; 'purchase' movement.
        let app = owner_app().await;
        let (po, product) = ordered_po_with_item(&app).await;

        let received = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("receive");
        assert_eq!(received.status, "received");
        assert!(received.received_at.is_some());

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 10);

        let movements = crate::commands::inventory::list_stock_movements(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("movements");
        assert!(movements.iter().any(|m| m.movement_type == "purchase"));
    }

    #[tokio::test]
    async fn receive_creates_expiry_batch() {
        // Input: ordered PO with an expiry date on the item.
        // Expected: stock_batch created after receive.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Medicine").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            Some("2026-01-01".to_string()),
        )
        .await
        .expect("add item with expiry");
        submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");

        receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("receive");

        let batches = crate::commands::inventory::list_product_batches(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-01-01");
        assert_eq!(batches[0].quantity, 10);
    }

    #[tokio::test]
    async fn receive_uses_expiry_entered_at_receive_time() {
        // Input: ordered PO whose item has NO stored expiry, but the user
        // supplies an expiry when receiving (the normal flow — the supplier's
        // date is only known once the goods arrive).
        // Expected: stock_batch created with the receive-time expiry.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Syrup").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            5,
            400,
            0,
            None,
        )
        .await
        .expect("add item without expiry");
        submit_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("submit");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("details");
        let item = &details.items[0];

        receive_po_items(
            app.state(),
            app.state(),
            po.id.clone(),
            vec![ReceiveItemExpiry {
                item_id: item.id.clone(),
                expiry_date: Some("2026-09-15".to_string()),
            }],
        )
        .await
        .expect("receive with expiry");

        let batches = crate::commands::inventory::list_product_batches(
            app.state(),
            app.state(),
            product.id.clone(),
        )
        .await
        .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-09-15");
        assert_eq!(batches[0].quantity, 5);
    }

    #[tokio::test]
    async fn receive_rejects_non_ordered_po() {
        // Input: receive a draft PO.
        // Expected: Err "PO must be in 'ordered' status to receive".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .unwrap_err();
        assert_eq!(err, "PO must be in 'ordered' status to receive");
    }

    #[tokio::test]
    async fn receive_po_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let err = receive_po_items(app.state(), app.state(), Uuid::new_v4().to_string(), vec![])
            .await
            .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    #[tokio::test]
    async fn receive_twice_is_rejected_after_received() {
        // Input: receive an already-received PO.
        // Expected: Err "PO must be in 'ordered' status to receive" — a second
        // receive is blocked by the status guard, so stock cannot double in.
        let app = owner_app().await;
        let (po, _product) = ordered_po_with_item(&app).await;
        receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .expect("first receive");

        let err = receive_po_items(app.state(), app.state(), po.id.clone(), vec![])
            .await
            .unwrap_err();
        assert!(err.contains("must be in 'ordered' status"), "got: {err}");

        let products = crate::commands::inventory::list_products(app.state(), app.state())
            .await
            .expect("products");
        assert_eq!(products[0].quantity_in_stock, 10, "stock must not double");
    }

    // ---------------------------------------------------------------
    // record_po_payment
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn po_payment_partial_and_full() {
        // Input: ordered PO with grand total 5000; pay 2000 then 3000.
        // Expected: status ordered→(received skipped) stays "ordered" until fully paid.
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await; // 10 × 500 = 5000

        let after_partial = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            2000,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("partial");
        assert_eq!(after_partial.status, "ordered");
        assert_eq!(after_partial.amount_paid, 2000);
        assert_eq!(after_partial.balance_due, 3000);

        let after_full = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            3000,
            "bank_transfer".to_string(),
            "2026-01-21".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("full");
        assert_eq!(after_full.status, "paid");
        assert_eq!(after_full.balance_due, 0);
    }

    #[tokio::test]
    async fn po_payment_rejects_overpayment() {
        // Input: payment exceeding balance.
        // Expected: Err "Payment exceeds balance".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            999999,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Payment exceeds balance");
    }

    #[tokio::test]
    async fn po_payment_rejects_draft() {
        // Input: payment on a draft PO.
        // Expected: Err "Cannot pay for draft/cancelled POs".
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let po = make_po(&app, &supplier.id).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cannot pay for draft/cancelled POs");
    }

    #[tokio::test]
    async fn po_payment_rejects_non_positive() {
        // Input: amount 0.
        // Expected: Err "Amount must be positive".
        let app = owner_app().await;
        let (po, _) = ordered_po_with_item(&app).await;

        let err = record_po_payment(
            app.state(),
            app.state(),
            po.id.clone(),
            0,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Amount must be positive");
    }

    #[tokio::test]
    async fn po_payment_not_found() {
        // Input: a random PO id.
        // Expected: Err "PO not found".
        let app = owner_app().await;
        let err = record_po_payment(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            100,
            "cash".to_string(),
            "2026-01-20".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "PO not found");
    }

    // ---------------------------------------------------------------
    // get / list
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn get_purchase_order_returns_items() {
        // Input: PO with one item.
        // Expected: order + 1 item with product sku snapshot.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        let product = make_product(&app, "Widget").await;
        let po = make_po(&app, &supplier.id).await;
        add_po_item(
            app.state(),
            app.state(),
            po.id.clone(),
            product.id.clone(),
            10,
            500,
            0,
            None,
        )
        .await
        .expect("add item");

        let details = get_purchase_order(app.state(), app.state(), po.id.clone())
            .await
            .expect("get");
        assert_eq!(details.order.id, po.id);
        assert_eq!(details.items.len(), 1);
        assert_eq!(details.items[0].product_name, "Widget");
        assert_eq!(details.items[0].product_sku, product.sku);
        assert_eq!(details.items[0].quantity_ordered, 10);
    }

    #[tokio::test]
    async fn get_purchase_order_not_found() {
        // Input: a random PO id.
        // Expected: Err "Purchase order not found".
        let app = owner_app().await;
        let err = get_purchase_order(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Purchase order not found");
    }

    #[tokio::test]
    async fn list_purchase_orders_returns_all() {
        // Input: two POs.
        // Expected: 2 rows with supplier names.
        let app = owner_app().await;
        let supplier = make_supplier(&app, "Acme").await;
        make_po(&app, &supplier.id).await;
        make_po(&app, &supplier.id).await;

        let pos = list_purchase_orders(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(pos.len(), 2);
        assert_eq!(pos[0].supplier_name, "Acme");
    }

    #[tokio::test]
    async fn list_purchase_orders_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_purchase_orders(app.state(), app.state())
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }
