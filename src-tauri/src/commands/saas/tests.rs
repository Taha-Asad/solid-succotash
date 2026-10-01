    use super::*;
    use crate::commands::auth::{logout_user, PublicUser};
    use crate::commands::test_helpers::{
        insert_super_admin, register_owner, set_session_user, setup_app, state_of,
    };
    use crate::commands::company::{list_company_modules, set_company_module};
    use sqlx::SqlitePool;

    /// Inserts a super admin and signs it into the session.
    async fn login_super_admin(app: &tauri::App<tauri::test::MockRuntime>) -> PublicUser {
        let pool = state_of::<SqlitePool>(app);
        let admin = insert_super_admin(&*pool, "root@admin.test").await;
        set_session_user(app, admin.clone()).await;
        admin
    }

    // ---------------------------------------------------------------
    // list_packages
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn list_packages_requires_login() {
        let app = setup_app().await;
        let err = list_packages(state_of(&app), state_of(&app), None)
            .await
            .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn seeded_packages_are_listed_for_logged_in_users() {
        // Input: seeded database, any logged-in user.
        // Expected: the 3 default active packages are returned (spec §14.1.6).
        let app = setup_app().await;
        login_super_admin(&app).await;

        let packages = list_packages(state_of(&app), state_of(&app), None)
            .await
            .expect("list packages");
        assert_eq!(packages.len(), 3);
        assert!(packages.iter().any(|p| p.id == "pkg-basic"));
        assert!(packages.iter().any(|p| p.id == "pkg-standard"));
        assert!(packages.iter().any(|p| p.id == "pkg-premium"));
    }

    // ---------------------------------------------------------------
    // create_package
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn create_package_denied_for_company_owner() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_creates_package() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let created = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            Some("Priority".to_string()),
            Some(9999.0),
            Some("yearly".to_string()),
            Some(r#"{"inventory":1,"sales":1}"#.to_string()),
            Some(50),
            Some(10),
            Some(2000),
            Some(r#"{"fbr":true}"#.to_string()),
            Some(9),
        )
        .await
        .expect("create package");

        assert_eq!(created.name, "Gold");
        assert_eq!(created.price, 9999.0);
        assert_eq!(created.billing_cycle, "yearly");
        assert!(created.is_active);

        let packages = list_packages(state_of(&app), state_of(&app), None)
            .await
            .expect("list");
        assert_eq!(packages.len(), 4);
    }

    #[tokio::test]
    async fn create_package_rejects_bad_json() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let err = create_package(
            state_of(&app),
            state_of(&app),
            "Gold".to_string(),
            None,
            None,
            None,
            Some("not-json".to_string()),
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("module_limits must be valid JSON"));
    }

    // ---------------------------------------------------------------
    // register_tenant
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn register_tenant_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn register_tenant_creates_company_subscription_and_modules() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let result = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            Some("+92-300-0000000".to_string()),
            None,
            Some("1234567".to_string()),
            Some("PKR".to_string()),
            None,
            None,
            Some("Punjab".to_string()),
        )
        .await
        .expect("register tenant");

        assert_eq!(result.company.name, "ACME Trading");
        assert_eq!(result.admin_user.role, "owner");
        assert!(result.admin_user.must_change_password);
        assert_eq!(result.admin_user.company_id.as_deref(), Some(result.company.id.as_str()));

        assert_eq!(result.subscription.package_id, "pkg-basic");
        assert_eq!(result.subscription.status, "active");

        // pkg-basic enables: dashboard, inventory, sales, purchases,
        // reports, employees, invoices (branches:0 and import:0 excluded).
        assert_eq!(result.modules.len(), 7);
        assert!(result.modules.iter().any(|m| m.module_key == "invoices"));
        assert!(!result.modules.iter().any(|m| m.module_key == "branches"));

        // The new tenant admin can log in.
        logout_user(state_of(&app)).await.expect("logout");
        let login = crate::commands::auth::login_user(
            state_of(&app),
            state_of(&app),
            state_of(&app),
            "admin@acme.com".to_string(),
            "password123".to_string(),
        )
        .await
        .expect("tenant admin can log in");
        assert_eq!(login.company_id.as_deref(), Some(result.company.id.as_str()));
    }

    #[tokio::test]
    async fn register_tenant_rejects_duplicate_email() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME One".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("first tenant");

        let err = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Two".to_string(),
            "Ali".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Email address is already registered");
    }

    // ---------------------------------------------------------------
    // update_tenant_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn update_tenant_company_requires_super_admin() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let company_id = owner.company_id.unwrap();

        let err = update_tenant_company(
            state_of(&app),
            state_of(&app),
            company_id,
            Some("Renamed".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_updates_tenant_company() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let created = register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            Some("+92-300-0000000".to_string()),
            None,
            Some("1234567".to_string()),
            Some("PKR".to_string()),
            None,
            None,
            Some("Punjab".to_string()),
        )
        .await
        .expect("register tenant");

        let updated = update_tenant_company(
            state_of(&app),
            state_of(&app),
            created.company.id.clone(),
            Some("ACME International".to_string()),
            Some("hello@acme.com".to_string()),
            Some("+92-321-1111111".to_string()),
            Some("Main Bazaar, Lahore".to_string()),
            Some("7654321".to_string()),
            Some("USD".to_string()),
            None,
            None,
            None,
        )
        .await
        .expect("update tenant company");

        assert_eq!(updated.name, "ACME International");
        assert_eq!(updated.email.as_deref(), Some("hello@acme.com"));
        assert_eq!(updated.phone.as_deref(), Some("+92-321-1111111"));
        assert_eq!(updated.address.as_deref(), Some("Main Bazaar, Lahore"));
        assert_eq!(updated.tax_number.as_deref(), Some("7654321"));
        assert_eq!(updated.currency_code, "USD");

        let detail = get_tenant_company_detail(state_of(&app), state_of(&app), created.company.id)
            .await
            .expect("fetch detail");
        assert_eq!(detail.company.name, "ACME International");
    }

    #[tokio::test]
    async fn update_tenant_company_unknown_company_rejected() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let err = update_tenant_company(
            state_of(&app),
            state_of(&app),
            "company-does-not-exist".to_string(),
            Some("Nope".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("not found"));
    }

    // ---------------------------------------------------------------
    // get_platform_analytics
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn platform_analytics_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn platform_analytics_aggregates_platform() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        let before = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .expect("analytics before");
        assert_eq!(before.total_tenants, 0);

        // Register two tenants on pkg-standard (1499/month) and one on pkg-basic.
        for email in ["admin@one.com", "admin@two.com"] {
            register_tenant(
                state_of(&app),
                state_of(&app),
                "Tenant Co".to_string(),
                "Ali".to_string(),
                email.to_string(),
                "password123".to_string(),
                "pkg-standard".to_string(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .expect("register tenant");
        }
        register_tenant(
            state_of(&app),
            state_of(&app),
            "Basic Co".to_string(),
            "Ali".to_string(),
            "admin@three.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("register basic tenant");

        let after = get_platform_analytics(state_of(&app), state_of(&app))
            .await
            .expect("analytics after");
        assert_eq!(after.total_tenants, 3);
        assert_eq!(after.active_tenants, 3);
        assert_eq!(after.total_users, 4); // 3 tenant admins + the super admin
        assert_eq!(after.mrr, 1499.0 * 2.0);

        let by_pkg = after.tenants_by_package;
        let standard = by_pkg.iter().find(|p| p.package_id == "pkg-standard").unwrap();
        assert_eq!(standard.count, 2);
        let basic = by_pkg.iter().find(|p| p.package_id == "pkg-basic").unwrap();
        assert_eq!(basic.count, 1);

        assert!(after
            .subscriptions_by_status
            .iter()
            .any(|s| s.status == "active" && s.count == 3));
        assert!(after.monthly_growth.iter().any(|m| m.count == 3));
    }

    // ---------------------------------------------------------------
    // set_company_module
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_company_module_owner_can_toggle_own_modules() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let company_id = owner.company_id.clone().unwrap();

        let module = set_company_module(
            state_of(&app),
            state_of(&app),
            company_id.clone(),
            "reports".to_string(),
            true,
        )
        .await
        .expect("owner toggles module");
        assert_eq!(module.module_key, "reports");
        assert!(module.is_enabled);

        let modules = list_company_modules(state_of(&app), state_of(&app), None)
            .await
            .expect("list");
        assert!(modules.iter().any(|m| m.module_key == "reports" && m.is_enabled));
    }

    #[tokio::test]
    async fn set_company_module_rejects_unknown_module() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = set_company_module(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "nonsense".to_string(),
            true,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unknown module"));
    }

    // ---------------------------------------------------------------
    // set_feature_flag
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn set_feature_flag_denied_for_owner() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = set_feature_flag(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "ai_insights".to_string(),
            true,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_toggles_feature_flag() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        login_super_admin(&app).await;

        let flag = set_feature_flag(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "ai_insights".to_string(),
            true,
            Some("Beta rollout".to_string()),
        )
        .await
        .expect("toggle flag");
        assert_eq!(flag.feature_key, "ai_insights");
        assert!(flag.is_enabled);
        assert_eq!(flag.reason.as_deref(), Some("Beta rollout"));
    }

    // ---------------------------------------------------------------
    // assign_company_subscription
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn assign_subscription_denied_for_owner() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;

        let err = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.unwrap(),
            "pkg-standard".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_assigns_subscription() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        login_super_admin(&app).await;

        let sub = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "pkg-premium".to_string(),
            Some("trial".to_string()),
            Some(14),
        )
        .await
        .expect("assign");
        assert_eq!(sub.package_id, "pkg-premium");
        assert_eq!(sub.status, "trial");
        assert!(sub.trial_ends_at.is_some());

        // Re-assigning updates, not duplicates.
        let sub2 = assign_company_subscription(
            state_of(&app),
            state_of(&app),
            owner.company_id.clone().unwrap(),
            "pkg-standard".to_string(),
            None,
            None,
        )
        .await
        .expect("reassign");
        assert_eq!(sub2.id, sub.id, "one subscription per company");
        assert_eq!(sub2.package_id, "pkg-standard");
    }

    // ---------------------------------------------------------------
    // archive_company
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn archive_company_deactivates_and_bumps_token_version() {
        let app = setup_app().await;
        let owner = register_owner(&app, "owner@test.com").await;
        let pool = state_of::<SqlitePool>(&app);
        let company_id = owner.company_id.clone().unwrap();

        // Add a second user so token_version bump is observable.
        crate::commands::test_helpers::insert_user(
            &*pool,
            &company_id,
            "emp@test.com",
            "Emp",
            "employee",
            true,
        )
        .await;

        login_super_admin(&app).await;
        archive_company(state_of(&app), state_of(&app), company_id.clone())
            .await
            .expect("archive");

        let is_active: i64 =
            sqlx::query_scalar("SELECT is_active FROM companies WHERE id = ?")
                .bind(&company_id)
                .fetch_one(&*pool)
                .await
                .unwrap();
        assert_eq!(is_active, 0);

        let versions: Vec<i64> =
            sqlx::query_scalar("SELECT token_version FROM users WHERE company_id = ?")
                .bind(&company_id)
                .fetch_all(&*pool)
                .await
                .unwrap();
        assert!(!versions.is_empty());
        assert!(versions.iter().all(|v| *v >= 1), "token_version bumped");
    }

    // ---------------------------------------------------------------
    // list_tenant_companies / detail
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn tenant_management_requires_super_admin() {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;

        let err = list_tenant_companies(state_of(&app), state_of(&app))
            .await
            .unwrap_err();
        assert_eq!(err, "Super admin access required");
    }

    #[tokio::test]
    async fn super_admin_lists_tenants_with_subscription() {
        let app = setup_app().await;
        login_super_admin(&app).await;

        register_tenant(
            state_of(&app),
            state_of(&app),
            "ACME Trading".to_string(),
            "Ali Khan".to_string(),
            "admin@acme.com".to_string(),
            "password123".to_string(),
            "pkg-basic".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("register tenant");

        let companies = list_tenant_companies(state_of(&app), state_of(&app))
            .await
            .expect("list");
        assert_eq!(companies.len(), 1);
        assert_eq!(companies[0].name, "ACME Trading");
        assert_eq!(companies[0].subscription_status.as_deref(), Some("active"));
        assert_eq!(companies[0].package_name.as_deref(), Some("Basic"));
        assert_eq!(companies[0].user_count, 1);

        let detail = get_tenant_company_detail(state_of(&app), state_of(&app), companies[0].id.clone())
            .await
            .expect("detail");
        assert_eq!(detail.company.name, "ACME Trading");
        assert_eq!(detail.province.as_deref(), None);
        assert!(detail.subscription.is_some());
        assert!(!detail.modules.is_empty());
    }
