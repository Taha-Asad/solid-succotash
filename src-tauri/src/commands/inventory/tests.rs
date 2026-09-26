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

    /// Creates a category through the real command.
    async fn make_category(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicCategory {
        create_category(
            app.state(),
            app.state(),
            name.to_string(),
            None,
            None,
        )
        .await
        .expect("create category")
    }

    /// Creates a supplier through the real command.
    async fn make_supplier(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
    ) -> PublicSupplier {
        create_supplier(
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

    /// Creates a product through the real command (blank SKU → auto-generated).
    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
        name: &str,
        category_id: Option<&str>,
    ) -> PublicProduct {
        create_product(
            app.state(),
            app.state(),
            "".to_string(),
            name.to_string(),
            category_id.unwrap_or("").to_string(),
            "".to_string(),
            1000,
            1500,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
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

    #[test]
    fn clean_optional_whitespace_is_none() {
        // Input: "   ".
        // Expected: None.
        assert_eq!(clean_optional("   "), None);
    }

    #[test]
    fn clean_optional_trims_value() {
        // Input: "  Lahore  ".
        // Expected: Some("Lahore").
        assert_eq!(clean_optional("  Lahore  "), Some("Lahore".to_string()));
    }

    // ---------------------------------------------------------------
    // map_product_db_error (DB-backed)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_product_allows_optional_category_and_supplier() {
        // Input: empty category + supplier.
        // Expected: product saved with NULL category/supplier — no "null" error.
        let app = owner_app().await;
        let p = make_product(&app, "No Category Product", None).await;
        assert_eq!(p.category_id, None);
        assert_eq!(p.supplier_id, None);
    }

    #[tokio::test]
    async fn create_product_duplicate_sku_gets_friendly_message() {
        // Input: the same SKU twice.
        // Expected: "SKU 'X' already exists", not a raw constraint string.
        let app = owner_app().await;
        create_product(
            app.state(),
            app.state(),
            "DUP-001".to_string(),
            "First".to_string(),
            "".to_string(),
            "".to_string(),
            1,
            1,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("first insert");

        let err = create_product(
            app.state(),
            app.state(),
            "DUP-001".to_string(),
            "Second".to_string(),
            "".to_string(),
            "".to_string(),
            1,
            1,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "SKU 'DUP-001' already exists");
    }

    #[tokio::test]
    async fn map_product_db_error_not_null_is_friendly() {
        // Input: a real NOT NULL constraint error.
        // Expected: generic missing-field message, not a raw SQL string.
        let app = owner_app().await;
        let pool: &SqlitePool = app.state::<SqlitePool>().inner();
        sqlx::query("CREATE TABLE tmp_required (id TEXT NOT NULL)")
            .execute(pool)
            .await
            .expect("create table");
        let err = sqlx::query("INSERT INTO tmp_required (id) VALUES (NULL)")
            .execute(pool)
            .await
            .unwrap_err();
        assert_eq!(
            map_product_db_error(err, "X"),
            "A required field is missing"
        );
    }

    #[tokio::test]
    async fn map_product_db_error_other_is_wrapped() {
        // Input: a generic failure.
        // Expected: raw error preserved under a prefix.
        let app = owner_app().await;
        let pool: &SqlitePool = app.state::<SqlitePool>().inner();
        let err = sqlx::query("INSERT INTO does_not_exist (x) VALUES (1)")
            .execute(pool)
            .await
            .unwrap_err();
        assert!(map_product_db_error(err, "X").starts_with("Database error:"));
    }

    // ---------------------------------------------------------------
    // derive_sku_prefix (pure)
    // ---------------------------------------------------------------

    #[test]
    fn sku_prefix_derives_short_words() {
        // Input: "Electronics".
        // Expected: "ELEC" (first 6 alphanumeric, uppercased).
        assert_eq!(derive_sku_prefix("Electronics"), "ELECTR");
    }

    #[test]
    fn sku_prefix_handles_spaces() {
        // Input: "Mobile Phones".
        // Expected: "MOBILE".
        assert_eq!(derive_sku_prefix("Mobile Phones"), "MOBILE");
    }

    #[test]
    fn sku_prefix_caps_at_six_chars() {
        // Input: "abcdefghij".
        // Expected: "ABCDEF".
        assert_eq!(derive_sku_prefix("abcdefghij"), "ABCDEF");
    }

    #[test]
    fn sku_prefix_falls_back_to_cat() {
        // Input: "!!!".  (no alphanumeric chars)
        // Expected: "CAT".
        assert_eq!(derive_sku_prefix("!!!"), "CAT");
    }

    // ---------------------------------------------------------------
    // normalize_sku_prefix (pure)
    // ---------------------------------------------------------------

    #[test]
    fn sku_prefix_normalize_strips_noise() {
        // Input: " my-prefix!! ".
        // Expected: "MYPREF".
        assert_eq!(normalize_sku_prefix(" my-prefix!! ", "X"), "MYPREF");
    }

    #[test]
    fn sku_prefix_normalize_falls_back_to_category() {
        // Input: blank prefix + category "Laptops".
        // Expected: "LAPTOP".
        assert_eq!(normalize_sku_prefix("   ", "Laptops"), "LAPTOP");
    }

    // ---------------------------------------------------------------
    // batch_status (pure)
    // ---------------------------------------------------------------

    #[test]
    fn batch_status_zero_qty_is_depleted() {
        // Input: qty 0, any date.
        // Expected: "depleted".
        assert_eq!(batch_status("2026-01-01", 0), "depleted");
    }

    #[test]
    fn batch_status_past_date_is_expired() {
        // Input: qty 5, date 2000-01-01.
        // Expected: "expired".
        assert_eq!(batch_status("2000-01-01", 5), "expired");
    }

    #[test]
    fn batch_status_future_date_is_ok() {
        // Input: qty 5, date 2099-01-01.
        // Expected: "ok".
        assert_eq!(batch_status("2099-01-01", 5), "ok");
    }

    #[test]
    fn batch_status_garbage_date_is_ok() {
        // Input: qty 5, date "nonsense".
        // Expected: "ok" (parse failure is not treated as expired).
        assert_eq!(batch_status("nonsense", 5), "ok");
    }

    // ---------------------------------------------------------------
    // parse_expiry_date (pure)
    // ---------------------------------------------------------------

    #[test]
    fn expiry_parses_iso() {
        // Input: "2024-01-15".
        // Expected: Ok("2024-01-15").
        assert_eq!(parse_expiry_date("2024-01-15").unwrap(), "2024-01-15");
    }

    #[test]
    fn expiry_parses_dmy() {
        // Input: "15/01/2024".
        // Expected: Ok("2024-01-15").
        assert_eq!(parse_expiry_date("15/01/2024").unwrap(), "2024-01-15");
    }

    #[test]
    fn expiry_disambiguates_day_first() {
        // Input: "20/01/2024" — first part > 12 → day first.
        // Expected: Ok("2024-01-20").
        assert_eq!(parse_expiry_date("20/01/2024").unwrap(), "2024-01-20");
    }

    #[test]
    fn expiry_disambiguates_month_first() {
        // Input: "01/20/2024" — second part > 12 → month first.
        // Expected: Ok("2024-01-20").
        assert_eq!(parse_expiry_date("01/20/2024").unwrap(), "2024-01-20");
    }

    #[test]
    fn expiry_rejects_empty() {
        // Input: "   ".
        // Expected: Err "Expiry date is empty".
        assert_eq!(
            parse_expiry_date("   ").unwrap_err(),
            "Expiry date is empty"
        );
    }

    #[test]
    fn expiry_rejects_wrong_parts() {
        // Input: "2024-01".
        // Expected: Err about format.
        assert!(parse_expiry_date("2024-01").is_err());
    }

    #[test]
    fn expiry_rejects_impossible_date() {
        // Input: "31/02/2024" (Feb 31).
        // Expected: Err about format.
        assert!(parse_expiry_date("31/02/2024").is_err());
    }

    // ---------------------------------------------------------------
    // list_categories
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_categories_empty_before_create() {
        // Input: fresh company.
        // Expected: Ok([]).
        let app = owner_app().await;
        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert!(cats.is_empty());
    }

    #[tokio::test]
    async fn list_categories_returns_created() {
        // Input: one created category.
        // Expected: the category is returned.
        let app = owner_app().await;
        make_category(&app, "Electronics").await;
        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].name, "Electronics");
    }

    #[tokio::test]
    async fn list_categories_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_categories(app.state(), app.state()).await.unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_category_generates_prefix() {
        // Input: name "Electronics", blank prefix.
        // Expected: Ok with sku_prefix "ELECTR".
        let app = owner_app().await;
        let cat = create_category(
            app.state(),
            app.state(),
            "Electronics".to_string(),
            Some("Gadgets".to_string()),
            Some("".to_string()),
        )
        .await
        .expect("create");
        assert_eq!(cat.name, "Electronics");
        assert_eq!(cat.sku_prefix.as_deref(), Some("ELECTR"));
        assert_eq!(cat.description.as_deref(), Some("Gadgets"));
    }

    #[tokio::test]
    async fn create_category_with_none_prefix_and_description() {
        // Input: name "Beverages", None prefix and None description.
        // Expected: Ok with auto-derived sku_prefix "BEVERA".
        let app = owner_app().await;
        let cat = create_category(
            app.state(),
            app.state(),
            "Beverages".to_string(),
            None,
            None,
        )
        .await
        .expect("create");
        assert_eq!(cat.name, "Beverages");
        assert_eq!(cat.sku_prefix.as_deref(), Some("BEVERA"));
        assert_eq!(cat.description, None);
    }

    #[tokio::test]
    async fn create_category_rejects_empty_name() {
        // Input: name "   ".
        // Expected: Err "Category name cannot be empty".
        let app = owner_app().await;
        let err = create_category(
            app.state(),
            app.state(),
            "   ".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category name cannot be empty");
    }

    #[tokio::test]
    async fn create_category_rejects_duplicate() {
        // Input: two categories with the same name.
        // Expected: second Err "Category 'X' already exists".
        let app = owner_app().await;
        make_category(&app, "Tools").await;
        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category 'Tools' already exists");
    }

    #[tokio::test]
    async fn create_category_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied: employee cannot create inventory".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let employee = insert_user(
            &pool,
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    #[tokio::test]
    async fn create_category_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = create_category(
            app.state(),
            app.state(),
            "Tools".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_category_succeeds_and_bumps_version() {
        // Input: owner updates name with matching expected_version.
        // Expected: Ok, new name, version incremented.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let updated = update_category(
            app.state(),
            app.state(),
            cat.version,
            cat.id.clone(),
            "Power Tools".to_string(),
            None,
            Some("PWR".to_string()),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Power Tools");
        assert_eq!(updated.sku_prefix.as_deref(), Some("PWR"));
        assert!(updated.version > cat.version);
    }

    #[tokio::test]
    async fn update_category_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let err = update_category(
            app.state(),
            app.state(),
            cat.version + 5,
            cat.id.clone(),
            "Renamed".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_category_not_found() {
        // Input: a random id.
        // Expected: Err "Record not found or deleted".
        let app = owner_app().await;
        let err = update_category(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "X".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Record not found"), "got: {err}");
    }

    #[tokio::test]
    async fn update_category_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Category name cannot be empty".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;
        let err = update_category(
            app.state(),
            app.state(),
            cat.version,
            cat.id.clone(),
            "  ".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Category name cannot be empty");
    }

    // ---------------------------------------------------------------
    // set_category_active
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_category_active_deactivate_reactivate() {
        // Input: owner deactivates then reactivates a category.
        // Expected: is_active false then true.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        let off = set_category_active(app.state(), app.state(), cat.id.clone(), false)
            .await
            .expect("deactivate");
        assert!(!off.is_active);

        let on = set_category_active(app.state(), app.state(), cat.id.clone(), true)
            .await
            .expect("reactivate");
        assert!(on.is_active);
    }

    #[tokio::test]
    async fn set_category_active_not_found() {
        // Input: a random id.
        // Expected: Err "Category not found".
        let app = owner_app().await;
        let err = set_category_active(app.state(), app.state(), Uuid::new_v4().to_string(), false)
            .await
            .unwrap_err();
        assert_eq!(err, "Category not found");
    }

    // ---------------------------------------------------------------
    // delete_category
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn delete_category_soft_deletes() {
        // Input: owner deletes an existing category.
        // Expected: Ok; subsequent list omits it.
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;

        delete_category(app.state(), app.state(), cat.id.clone())
            .await
            .expect("delete");

        let cats = list_categories(app.state(), app.state())
            .await
            .expect("list");
        assert!(cats.is_empty(), "deleted category must disappear");
    }

    #[tokio::test]
    async fn delete_category_not_found() {
        // Input: a random id.
        // Expected: Err "Category not found".
        let app = owner_app().await;
        let err = delete_category(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert_eq!(err, "Category not found");
    }

    #[tokio::test]
    async fn delete_category_denied_for_employee() {
        // Input: employee logged in (no inventory/delete).
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let cat = make_category(&app, "Tools").await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = delete_category(app.state(), app.state(), cat.id.clone())
            .await
            .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // create_supplier / list_suppliers / update / set_active / delete
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn supplier_full_crud_cycle() {
        // Input: create → list → update → deactivate → delete.
        // Expected: each step reflects its state.
        let app = owner_app().await;

        let sup = create_supplier(
            app.state(),
            app.state(),
            "Acme Ltd".to_string(),
            "John".to_string(),
            "john@acme.com".to_string(),
            "0300-000".to_string(),
            "Lahore".to_string(),
            "NTN-1".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(sup.email.as_deref(), Some("john@acme.com"));

        let listed = list_suppliers(app.state(), app.state())
            .await
            .expect("list");
        assert_eq!(listed.len(), 1);

        let updated = update_supplier(
            app.state(),
            app.state(),
            sup.version,
            sup.id.clone(),
            "Acme Corp".to_string(),
            "Jane".to_string(),
            "jane@acme.com".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Acme Corp");
        assert_eq!(updated.contact_person.as_deref(), Some("Jane"));

        let off = set_supplier_active(app.state(), app.state(), sup.id.clone(), false)
            .await
            .expect("deactivate");
        assert!(!off.is_active);

        delete_supplier(app.state(), app.state(), sup.id.clone())
            .await
            .expect("delete");
        let listed = list_suppliers(app.state(), app.state())
            .await
            .expect("list");
        assert!(listed.is_empty());
    }

    #[tokio::test]
    async fn create_supplier_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Supplier name cannot be empty".
        let app = owner_app().await;
        let err = create_supplier(
            app.state(),
            app.state(),
            " ".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Supplier name cannot be empty");
    }

    #[tokio::test]
    async fn update_supplier_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let sup = make_supplier(&app, "Acme").await;
        let err = update_supplier(
            app.state(),
            app.state(),
            sup.version + 1,
            sup.id.clone(),
            "Renamed".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_supplier_not_found() {
        // Input: a random id.
        // Expected: Err "Record not found or deleted".
        let app = owner_app().await;
        let err = update_supplier(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "X".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Record not found"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // generate_sku (via create_product)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_product_auto_sku_sequences() {
        // Input: blank SKU with a category that has prefix ELEC.
        // Expected: first product "ELEC-001", second "ELEC-002".
        let app = owner_app().await;
        let cat = make_category(&app, "Electronics").await;

        let p1 = make_product(&app, "Bolt", Some(&cat.id)).await;
        let p2 = make_product(&app, "Nut", Some(&cat.id)).await;
        assert_eq!(p1.sku, "ELECTR-001");
        assert_eq!(p2.sku, "ELECTR-002");
    }

    #[tokio::test]
    async fn create_product_uses_explicit_sku() {
        // Input: explicit SKU "CUSTOM-9".
        // Expected: Ok with sku "CUSTOM-9".
        let app = owner_app().await;
        let p = create_product(
            app.state(),
            app.state(),
            "CUSTOM-9".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            500,
            700,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(p.sku, "CUSTOM-9");
    }

    #[tokio::test]
    async fn create_product_records_initial_stock_movement() {
        // Input: quantity_in_stock = 25.
        // Expected: product stock = 25; one stock movement row.
        let app = owner_app().await;
        let p = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            25,
            "pcs".to_string(),
        )
        .await
        .expect("create");
        assert_eq!(p.quantity_in_stock, 25);

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert_eq!(movements.len(), 1);
        assert_eq!(movements[0].movement_type, "adjustment");
    }

    #[tokio::test]
    async fn create_product_rejects_negative_price() {
        // Input: cost_price = -1.
        // Expected: Err "Cost price cannot be negative".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            -1,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Cost price cannot be negative");
    }

    #[tokio::test]
    async fn create_product_rejects_negative_stock() {
        // Input: quantity_in_stock = -5.
        // Expected: Err "Initial stock cannot be negative".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            -5,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Initial stock cannot be negative");
    }

    #[tokio::test]
    async fn create_product_rejects_duplicate_sku() {
        // Input: same explicit SKU twice.
        // Expected: second Err "SKU 'DUP' already exists".
        let app = owner_app().await;
        create_product(
            app.state(),
            app.state(),
            "DUP".to_string(),
            "One".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("first create");

        let err = create_product(
            app.state(),
            app.state(),
            "dup".to_string(),
            "Two".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[tokio::test]
    async fn create_product_rejects_empty_name() {
        // Input: blank name.
        // Expected: Err "Product name cannot be empty".
        let app = owner_app().await;
        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "  ".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Product name cannot be empty");
    }

    #[tokio::test]
    async fn create_product_denied_for_employee() {
        // Input: employee logged in.
        // Expected: Err "Access denied".
        let app = owner_app().await;
        let employee = insert_user(
            &app.state::<SqlitePool>(),
            &register_owner_company_id(&app).await,
            "e@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;
        set_session_user(&app, employee).await;

        let err = create_product(
            app.state(),
            app.state(),
            "SKU-A".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Access denied"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // update_product
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_product_succeeds_and_bumps_version() {
        // Input: owner updates with matching version.
        // Expected: Ok, new name/sku, version bumped.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let updated = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "NEW-SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            900,
            1300,
            5,
            "box".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.name, "Gadget");
        assert_eq!(updated.sku, "NEW-SKU");
        assert_eq!(updated.cost_price, 900);
        assert_eq!(updated.unit, "box");
        assert!(updated.version > p.version);
    }

    #[tokio::test]
    async fn update_product_keeps_sku_when_blank() {
        // Input: blank SKU on edit.
        // Expected: existing SKU retained.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let updated = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            900,
            1300,
            0,
            "pcs".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated.sku, p.sku);
    }

    #[tokio::test]
    async fn update_product_conflict_on_stale_version() {
        // Input: stale expected_version.
        // Expected: Err "Conflict: record was modified...".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = update_product(
            app.state(),
            app.state(),
            p.version + 3,
            p.id.clone(),
            "NEW-SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Conflict: record was modified"), "got: {err}");
    }

    #[tokio::test]
    async fn update_product_rejects_negative_price() {
        // Input: sell_price = -1.
        // Expected: Err "Prices cannot be negative".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = update_product(
            app.state(),
            app.state(),
            p.version,
            p.id.clone(),
            "SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            -1,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Prices cannot be negative");
    }

    #[tokio::test]
    async fn update_product_not_found() {
        // Input: a random id with a non-blank SKU.
        // Expected: Err "Record not found or deleted" (check_version guard).
        let app = owner_app().await;
        let err = update_product(
            app.state(),
            app.state(),
            0,
            Uuid::new_v4().to_string(),
            "SKU".to_string(),
            "Gadget".to_string(),
            "".to_string(),
            "".to_string(),
            100,
            200,
            0,
            "pcs".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Record not found or deleted");
    }

    // ---------------------------------------------------------------
    // adjust_stock
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn adjust_stock_purchase_and_sale() {
        // Input: purchase +10 then sale -3.
        // Expected: stock 7; two movements.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;

        let in_p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "from supplier".to_string(),
            None,
            None,
        )
        .await
        .expect("purchase");
        assert_eq!(in_p.quantity_in_stock, 10);

        let out_p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            -3,
            "walk-in".to_string(),
            None,
            None,
        )
        .await
        .expect("sale");
        assert_eq!(out_p.quantity_in_stock, 7);

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert_eq!(movements.len(), 2);
    }

    #[tokio::test]
    async fn adjust_stock_rejects_invalid_type() {
        // Input: movement_type "launch".
        // Expected: Err "Invalid movement type".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "launch".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid movement type"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_positive_sale() {
        // Input: sale with +5.
        // Expected: Err "sale quantity must be negative".
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("must be negative"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_zero_adjustment() {
        // Input: adjustment with 0 and no expiry date.
        // Expected: Err — zero quantity is only meaningful as an expiry-only
        // adjustment, which requires an expiry date.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("Adjustment quantity cannot be zero"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn adjust_stock_expiry_only_attaches_to_unbatched_stock() {
        // Input: product has 10 unbatched units; adjustment 0 with expiry.
        // Expected: quantity stays 10; one batch covering the 10 units exists.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "first batch".to_string(),
            None,
            None,
        )
        .await
        .expect("plain stock in");

        let p = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "attach expiry".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("expiry-only adjustment");
        assert_eq!(
            p.quantity_in_stock, 10,
            "expiry-only must not change quantity"
        );

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert_eq!(batches[0].quantity, 10);
    }

    #[tokio::test]
    async fn adjust_stock_expiry_only_rejected_when_all_batched() {
        // Input: product already fully batched (10 units with an expiry);
        // adjustment 0 with another expiry.
        // Expected: Err — there is no unbatched stock left to attach it to.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("batched stock in");

        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "adjustment".to_string(),
            0,
            "".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("already has an expiry date"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn adjust_stock_same_expiry_merges_into_single_batch() {
        // Input: +5 then +5 for the same product with the same expiry date.
        // Expected: ONE batch of 10 (not two batches), with a stable batch
        // number and weighted-average unit cost.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "first lot".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("first stock in");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "second lot".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("second stock in");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1, "same expiry must stay one batch");
        assert_eq!(batches[0].quantity, 10);
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert!(
            batches[0].batch_number.as_deref().unwrap_or("").starts_with("B-"),
            "batch number should be generated"
        );
    }

    #[tokio::test]
    async fn adjust_stock_different_expiry_keeps_separate_batches() {
        // Input: +5 expiring 2026-12-31 then +5 expiring 2027-06-30.
        // Expected: two batches — different expiries must stay apart for FIFO.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2026-12-31".to_string()),
            None,
        )
        .await
        .expect("first expiry");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2027-06-30".to_string()),
            None,
        )
        .await
        .expect("second expiry");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 2, "different expiries stay separate");
        assert_eq!(batches[0].expiry_date, "2026-12-31");
        assert_eq!(batches[1].expiry_date, "2027-06-30");
    }

    #[tokio::test]
    async fn adjust_stock_product_not_found() {
        // Input: a random product id.
        // Expected: Err — the DB FK trigger aborts with "Product does not exist".
        let app = owner_app().await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            "purchase".to_string(),
            5,
            "".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Product does not exist"), "got: {err}");
    }

    #[tokio::test]
    async fn adjust_stock_rejects_bad_expiry_date() {
        // Input: expiry_date "not-a-date".
        // Expected: Err about date format.
        let app = owner_app().await;
        let p = make_product(&app, "Widget", None).await;
        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("not-a-date".to_string()),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Cannot read"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // expiry batches + FIFO
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn expiry_batch_created_on_stock_in() {
        // Input: purchase +10 with expiry 2026-01-01.
        // Expected: product gets next_expiry_date; one batch row.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "batch 1".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("stock in with expiry");

        let products = list_products(app.state(), app.state()).await.expect("list");
        assert_eq!(
            products[0].next_expiry_date.as_deref(),
            Some("2026-01-01"),
            "next_expiry_date must be exposed"
        );

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].expiry_date, "2026-01-01");
        assert_eq!(batches[0].quantity, 10);
        assert_eq!(
            batches[0].batch_number.as_deref(),
            Some("B-0001"),
            "blank batch number must auto-generate B-0001"
        );
    }

    #[tokio::test]
    async fn adjust_stock_accepts_user_batch_number() {
        // Input: purchase +10 with expiry AND an explicit batch number.
        // Expected: the supplied number is stored on the batch.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "LOT A".to_string(),
            Some("2026-01-01".to_string()),
            Some("LOT-2026-A".to_string()),
        )
        .await
        .expect("stock in with named batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches[0].batch_number.as_deref(), Some("LOT-2026-A"));
    }

    #[tokio::test]
    async fn adjust_stock_rejects_duplicate_batch_number() {
        // Input: two purchases with the same explicit batch number.
        // Expected: second Err "A batch with number 'X' already exists".
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            Some("DUP-1".to_string()),
        )
        .await
        .expect("first named batch");

        let err = adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some("2026-06-01".to_string()),
            Some("DUP-1".to_string()),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "A batch with number 'DUP-1' already exists");
    }

    #[tokio::test]
    async fn fifo_deducts_soonest_batch_first() {
        // Input: batch A (2026-01-01, 10) and batch B (2026-06-01, 10);
        // then a sale of -5.
        // Expected: batch A drops to 5, batch B stays 10.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-01-01".to_string()),
            None,
        )
        .await
        .expect("batch a");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2026-06-01".to_string()),
            None,
        )
        .await
        .expect("batch b");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "sale".to_string(),
            -5,
            "".to_string(),
            None,
            None,
        )
        .await
        .expect("sale");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].expiry_date, "2026-01-01", "soonest batch first");
        assert_eq!(batches[0].quantity, 5, "FIFO drained from batch A");
        assert_eq!(batches[1].quantity, 10, "batch B untouched");
    }

    #[tokio::test]
    async fn list_expiring_batches_flags_expired_and_expiring() {
        // Input: one expired batch (yesterday) and one expiring soon (tomorrow).
        // Expected: warn window includes both; window 0 only the expired one.
        let today = today();
        let yesterday = (today - chrono::Duration::days(1)).to_string();
        let tomorrow = (today + chrono::Duration::days(1)).to_string();

        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some(yesterday.clone()),
            None,
        )
        .await
        .expect("expired batch");

        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            5,
            "".to_string(),
            Some(tomorrow.clone()),
            None,
        )
        .await
        .expect("expiring batch");

        let all = list_expiring_batches(app.state(), app.state(), 30)
            .await
            .expect("warn 30d");
        assert_eq!(all.len(), 2, "both batches inside warn window");
        assert!(all.iter().any(|b| b.status == "expired"));
        assert!(all.iter().any(|b| b.status == "expiring"));

        let strict = list_expiring_batches(app.state(), app.state(), 0)
            .await
            .expect("warn 0d");
        assert_eq!(strict.len(), 1, "only truly expired today or before");
        assert_eq!(strict[0].expiry_date, yesterday);
    }

    #[tokio::test]
    async fn write_off_batch_reduces_batch_and_stock() {
        // Input: batch qty 10, write off 4.
        // Expected: batch qty 6, product stock reduced by 4, damage movement.
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;
        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2025-01-01".to_string()),
            None,
        )
        .await
        .expect("batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        let batch = &batches[0];

        let updated = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            4,
            "mouldy".to_string(),
        )
        .await
        .expect("write off");
        assert_eq!(updated.quantity, 6);

        let products = list_products(app.state(), app.state()).await.expect("list");
        assert_eq!(products[0].quantity_in_stock, 6, "product stock reduced");

        let movements = list_stock_movements(app.state(), app.state(), p.id.clone())
            .await
            .expect("movements");
        assert!(
            movements.iter().any(|m| m.movement_type == "damage"),
            "damage movement must be recorded"
        );
    }

    #[tokio::test]
    async fn write_off_batch_rejects_invalid_quantity() {
        // Input: quantity 0 and quantity > batch qty.
        // Expected: Err "Invalid write-off quantity".
        let app = owner_app().await;
        let p = make_product(&app, "Medicine", None).await;
        adjust_stock(
            app.state(),
            app.state(),
            p.id.clone(),
            "purchase".to_string(),
            10,
            "".to_string(),
            Some("2025-01-01".to_string()),
            None,
        )
        .await
        .expect("batch");

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        let batch = &batches[0];

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            0,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid write-off quantity"), "got: {err}");

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch.id.clone(),
            99,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid write-off quantity"), "got: {err}");
    }

    #[tokio::test]
    async fn write_off_batch_not_found() {
        // Input: a random batch id.
        // Expected: Err "Batch not found".
        let app = owner_app().await;
        let err = write_off_batch(
            app.state(),
            app.state(),
            Uuid::new_v4().to_string(),
            1,
            "x".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Batch not found");
    }

    #[tokio::test]
    async fn list_stock_movements_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = list_stock_movements(app.state(), app.state(), Uuid::new_v4().to_string())
            .await
            .unwrap_err();
        assert!(err.contains("log in first"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // deduct_fifo / add_batch (private helpers, direct)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn deduct_fifo_noop_without_batches() {
        // Input: product with no batches, deduct 5.
        // Expected: Ok(()), nothing changes.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Widget", None).await;

        let mut tx = pool.begin().await.unwrap();
        deduct_fifo(&mut tx, "company-x", &p.id, 5)
            .await
            .expect("noop");
        tx.commit().await.unwrap();
    }

    #[tokio::test]
    async fn deduct_fifo_noop_on_zero_quantity() {
        // Input: quantity_out = 0.
        // Expected: Ok(()) immediately.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let mut tx = pool.begin().await.unwrap();
        deduct_fifo(&mut tx, "company-x", "product-x", 0)
            .await
            .expect("noop");
        tx.commit().await.unwrap();
    }

    #[tokio::test]
    async fn add_batch_inserts_row() {
        // Input: add_batch for a company/product.
        // Expected: Ok; the row exists afterwards with a generated number.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(&mut tx, &cid, &p.id, 7, 500, "2026-03-01", "purchase", None)
            .await
            .expect("add batch");
        tx.commit().await.unwrap();

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].quantity, 7);
        assert_eq!(batches[0].unit_cost, 500);
        assert_eq!(
            batches[0].batch_number.as_deref(),
            Some("B-0001"),
            "blank number must auto-generate a sequential batch number"
        );
    }

    #[tokio::test]
    async fn add_batch_keeps_user_supplied_number() {
        // Input: add_batch with an explicit "LOT-7".
        // Expected: the supplied number is stored verbatim.
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(
            &mut tx,
            &cid,
            &p.id,
            7,
            500,
            "2026-03-01",
            "purchase",
            Some("LOT-7"),
        )
        .await
        .expect("add batch");
        tx.commit().await.unwrap();

        let batches = list_product_batches(app.state(), app.state(), p.id.clone())
            .await
            .expect("batches");
        assert_eq!(batches[0].batch_number.as_deref(), Some("LOT-7"));
    }

    #[tokio::test]
    async fn add_batch_rejects_duplicate_number() {
        // Input: two add_batch calls with the same explicit number.
        // Expected: second Err "A batch with number 'X' already exists".
        let app = owner_app().await;
        let pool = app.state::<SqlitePool>();
        let p = make_product(&app, "Medicine", None).await;
        let cid = register_owner_company_id(&app).await;

        let mut tx = pool.begin().await.unwrap();
        add_batch(
            &mut tx,
            &cid,
            &p.id,
            5,
            500,
            "2026-03-01",
            "purchase",
            Some("DUP"),
        )
        .await
        .expect("first add batch");
        let err = add_batch(
            &mut tx,
            &cid,
            &p.id,
            3,
            500,
            "2026-03-02",
            "purchase",
            Some("DUP"),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "A batch with number 'DUP' already exists");
        tx.rollback().await.unwrap();
    }

    /// Extracts the current user's company id from the DB (owner registered).
    async fn register_owner_company_id(app: &tauri::App<tauri::test::MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn write_off_depleted_batch_is_rejected() {
        // Input: a batch already at 0 units.
        // Expected: a clear "already depleted" error, NOT "between 1 and 0".
        let app = owner_app().await;
        let company_id = register_owner_company_id(&app).await;
        let product = make_product(&app, "Depleted Item", None).await;
        let pool = app.state::<SqlitePool>();
        let batch_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO stock_batches
                (id, company_id, product_id, quantity, unit_cost, expiry_date, batch_number, source)
            VALUES (?, ?, ?, 0, 0, '2030-01-01', 'DPL', 'adjustment')
            "#,
        )
        .bind(&batch_id)
        .bind(&company_id)
        .bind(&product.id)
        .execute(&*pool)
        .await
        .unwrap();

        let err = write_off_batch(
            app.state(),
            app.state(),
            batch_id.clone(),
            1,
            "test".to_string(),
        )
        .await
        .expect_err("write-off of a depleted batch must fail");

        assert!(
            err.contains("already depleted"),
            "expected a clear depleted message, got: {err}"
        );
    }
