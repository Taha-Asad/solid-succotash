use super::*;
use crate::commands::test_helpers::{
    insert_super_admin, insert_user, register_owner, set_session_user, setup_app, state_of,
};
use crate::error::ErrorCode;

#[tokio::test]
async fn test_admin_commands_reject_unauthenticated() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    let result = admin_list_companies(pool, session).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_admin_commands_reject_owner_and_employee() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    // Register owner (company admin)
    let owner = register_owner(&app, "owner@corbel.test").await;
    set_session_user(&app, owner.clone()).await;

    let result = admin_list_companies(pool.clone(), session.clone()).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(err.code, ErrorCode::Forbidden);

    // Create and switch to employee
    let employee = insert_user(
        &*pool,
        owner.company_id.as_deref().unwrap(),
        "emp@corbel.test",
        "Employee User",
        "employee",
        true,
    )
    .await;
    set_session_user(&app, employee).await;

    let result2 = admin_list_companies(pool, session).await;
    assert!(result2.is_err());
    assert_eq!(result2.unwrap_err().code, ErrorCode::Forbidden);
}


#[tokio::test]
async fn test_admin_bootstrap_first_super_admin() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    // When no super admin exists, bootstrap succeeds
    let sa = admin_bootstrap_super_admin(
        pool.clone(),
        session.clone(),
        "root@admin.test".to_string(),
        "SuperPassword123!".to_string(),
        "Chief Executive".to_string(),
    )
    .await
    .expect("First super admin bootstrap should succeed");

    assert_eq!(sa.email, "root@admin.test");
    assert_eq!(sa.role, "super_admin");
    assert!(sa.is_super_admin);
    assert!(sa.company_id.is_none());

    // When super admin exists, unauthenticated caller cannot bootstrap another
    let failed = admin_bootstrap_super_admin(
        pool,
        session,
        "second@admin.test".to_string(),
        "SuperPassword123!".to_string(),
        "Second Admin".to_string(),
    )
    .await;
    assert!(failed.is_err());
}

#[tokio::test]
async fn test_admin_list_and_details_flow() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    let owner = register_owner(&app, "merchant@corbel.test").await;
    let super_admin = insert_super_admin(&*pool, "master@corbel.test").await;
    set_session_user(&app, super_admin).await;

    // List companies
    let companies = admin_list_companies(pool.clone(), session.clone())
        .await
        .expect("Super admin should list companies");
    assert_eq!(companies.len(), 1);
    assert_eq!(companies[0].name, "Test Company");
    assert!(companies[0].is_active);

    // Get company details
    let details = admin_get_company_details(
        pool.clone(),
        session.clone(),
        owner.company_id.clone().unwrap(),
    )
    .await
    .expect("Super admin should get company details");

    assert_eq!(details.company.name, "Test Company");
    assert_eq!(details.user_count, 1);
    assert_eq!(details.users[0].email, "merchant@corbel.test");
}

#[tokio::test]
async fn test_admin_create_company_provisions_tenant() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    let super_admin = insert_super_admin(&*pool, "sysadmin@corbel.test").await;
    set_session_user(&app, super_admin).await;

    let payload = CreateTenantPayload {
        company_name: "Apex Retailers".to_string(),
        email: Some("contact@apex.test".to_string()),
        phone: Some("03001234567".to_string()),
        address: Some("Shop #4, Liberty Market, Lahore".to_string()),
        currency_code: Some("PKR".to_string()),
        admin_name: "Tariq Mahmood".to_string(),
        admin_email: "tariq@apex.test".to_string(),
        admin_password: "SecurePassword123!".to_string(),
        package_id: Some("pkg-standard".to_string()),
    };

    let summary = admin_create_company(pool.clone(), session.clone(), payload)
        .await
        .expect("Provisioning tenant should succeed");

    assert_eq!(summary.name, "Apex Retailers");
    assert_eq!(summary.package_id.as_deref(), Some("pkg-standard"));
    assert!(summary.is_active);

    // Inspect detailed tenant record
    let details = admin_get_company_details(pool.clone(), session.clone(), summary.id)
        .await
        .expect("Should fetch details for provisioned tenant");

    assert_eq!(details.company.name, "Apex Retailers");
    assert!(details.subscription.is_some());
    assert_eq!(details.subscription.unwrap().package_id, "pkg-standard");
    assert!(!details.modules.is_empty());
}

#[tokio::test]
async fn test_admin_update_company_status_and_package() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    let owner = register_owner(&app, "owner@corbel.test").await;
    let company_id = owner.company_id.clone().unwrap();

    let super_admin = insert_super_admin(&*pool, "root@corbel.test").await;
    set_session_user(&app, super_admin).await;

    // Suspend company
    admin_update_company_status(pool.clone(), session.clone(), company_id.clone(), false)
        .await
        .expect("Super admin should suspend company");

    let comp = sqlx::query_scalar::<_, i64>("SELECT is_active FROM companies WHERE id = ?")
        .bind(&company_id)
        .fetch_one(&*pool)
        .await
        .unwrap();
    assert_eq!(comp, 0);

    // Reactivate company
    admin_update_company_status(pool.clone(), session.clone(), company_id.clone(), true)
        .await
        .expect("Super admin should reactivate company");

    let comp2 = sqlx::query_scalar::<_, i64>("SELECT is_active FROM companies WHERE id = ?")
        .bind(&company_id)
        .fetch_one(&*pool)
        .await
        .unwrap();
    assert_eq!(comp2, 1);

    // Upgrade package to Premium
    admin_update_company_package(
        pool.clone(),
        session.clone(),
        company_id.clone(),
        "pkg-premium".to_string(),
    )
    .await
    .expect("Super admin should upgrade package");

    let sub_pkg =
        sqlx::query_scalar::<_, String>("SELECT package_id FROM company_subscriptions WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .unwrap();
    assert_eq!(sub_pkg, "pkg-premium");

    // Toggle tenant feature flag
    admin_toggle_feature_flag(
        pool.clone(),
        session.clone(),
        company_id.clone(),
        "ai_insights".to_string(),
        true,
    )
    .await
    .expect("Super admin should toggle feature flag");

    let flag = sqlx::query_scalar::<_, i64>(
        "SELECT is_enabled FROM tenant_feature_flags WHERE company_id = ? AND feature_key = 'ai_insights'",
    )
    .bind(&company_id)
    .fetch_one(&*pool)
    .await
    .unwrap();
    assert_eq!(flag, 1);
}

#[tokio::test]
async fn test_admin_get_system_analytics() {
    let app = setup_app().await;
    let pool = state_of::<SqlitePool>(&app);
    let session = state_of::<SessionState>(&app);

    register_owner(&app, "owner@corbel.test").await;
    let super_admin = insert_super_admin(&*pool, "root@corbel.test").await;
    set_session_user(&app, super_admin).await;

    let analytics = admin_get_system_analytics(pool, session)
        .await
        .expect("Super admin should fetch system analytics");

    assert_eq!(analytics.total_companies, 1);
    assert_eq!(analytics.active_companies, 1);
    assert_eq!(analytics.total_users, 1);
    assert!(!analytics.package_distribution.is_empty());
}
