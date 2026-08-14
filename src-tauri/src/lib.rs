mod commands;
mod db;
mod pdf;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use std::str::FromStr;
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Your Rust backend is working.", name)
}

/// Writes an error to a log file the user can find
fn write_error_log(message: &str) {
    let log_path = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ijazandcompany-erp")
        .join("error.log");
    let _ = std::fs::write(&log_path, message);
    eprintln!("Error log written to: {}", log_path.display());
}

/// On Windows, attach to the parent console so println! and eprintln!
/// actually show up when running from Command Prompt.
#[cfg(target_os = "windows")]
fn attach_console() {
    unsafe {
        // ATTACH_PARENT_PROCESS = -1
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn attach_console() {}

/// WebKitGTK ships an accelerated DMA-BUF compositor that crashes with
/// `corrupted double-linked list` (heap corruption in the web process) on
/// WSL2/NVIDIA and a few other Linux setups. The same crash is hit on some
/// pages (e.g. the Journal tab) depending on how the page composites.
///
/// This must run BEFORE the Tauri builder creates the webview, and it only
/// affects the web process, so it is safe to force for all Linux users.
/// Docs: https://webkitgtk.org -> `WEBKIT_DISABLE_DMABUF_RENDERER`
#[cfg(target_os = "linux")]
fn harden_webkit() {
    // WebKitGTK's accelerated DMA-BUF compositor is known to crash the web
    // process with `corrupted double-linked list` (heap corruption) on
    // WSL2/WSLg and certain NVIDIA setups. The journal tab hit this abort
    // because of how the page composites. The upstream-sanctioned fix is
    // disabling the DMA-BUF renderer; disabling accelerated compositing too
    // is the strongest fallback when the crash persists.
    for (var, val) in [
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ] {
        if std::env::var_os(var).is_none() {
            println!("harden_webkit: setting {var}={val}");
            std::env::set_var(var, val);
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn harden_webkit() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tokio::main]
pub async fn run() {
    // Attach to console so errors show in Command Prompt
    attach_console();
    // Avoid the WebKitGTK compositing crash before the webview starts
    harden_webkit();

    println!("=== Ijaz & Company ERP Starting ===");

    // Get the correct database path
    let sqlite_url = db::sqlite_migrate::get_database_path();
    println!("Database: {sqlite_url}");

    // Run migrations
    match db::sqlite_migrate::run_sqlite_migrations(&sqlite_url).await {
        Ok(_) => println!("Migrations OK"),
        Err(e) => {
            let error_msg = format!("MIGRATION FAILED:\n\n{e}");
            eprintln!("{error_msg}");
            write_error_log(&error_msg);
            // Keep console open for 10 seconds so user can read the error
            std::thread::sleep(std::time::Duration::from_secs(10));
            panic!("{error_msg}");
        }
    }

    // Create the connection pool
    let sqlite_pool = match SqliteConnectOptions::from_str(&sqlite_url) {
        Ok(options) => match SqlitePool::connect_with(options.create_if_missing(true)).await {
            Ok(pool) => {
                println!("Database connected");
                pool
            }
            Err(e) => {
                let error_msg = format!("DATABASE CONNECTION FAILED:\n\n{e}");
                eprintln!("{error_msg}");
                write_error_log(&error_msg);
                std::thread::sleep(std::time::Duration::from_secs(10));
                panic!("{error_msg}");
            }
        },
        Err(e) => {
            panic!("Invalid SQLite URL: {e}");
        }
    };

    println!("Starting Tauri application...");

    // One-time Super Admin seeding (creates credentials + handover doc on
    // first launch; idempotent afterwards).
    if let Some(data_dir) = dirs::data_dir() {
        let app_data = data_dir.join("ijazandcompany-erp");
        if let Err(e) = commands::setup::ensure_super_admin(&sqlite_pool, &app_data).await {
            eprintln!("Super admin seeding failed: {e}");
        }
    }

    tauri::Builder::default()
        .manage(sqlite_pool)
        .manage(commands::auth::SessionState::new())
        .manage(commands::auth::LoginAttemptTracker::new())
        .setup(|app| {
            // Capture the app handle (for import push-progress events) and
            // resolve the bundled Tesseract OCR engine, if present.
            commands::import_wizard::init_app_services(app.handle());
            // Notification push channel: capture the handle for instant emits
            // from stock/invoice/PO mutations and start a 30s background
            // ticker so time-based alerts (expiry/overdue) surface on their own.
            commands::notifications::init_notifications(app.handle());
            commands::notifications::start_notification_ticker();
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::auth::login_user,
            commands::auth::logout_user,
            commands::auth::current_user,
            commands::auth::update_my_profile,
            commands::auth::change_my_password,
            commands::company::is_company_setup,
            commands::company::register_company,
            commands::company::get_company,
            commands::company::update_company,
            commands::users::list_company_users,
            commands::users::create_company_user,
            commands::users::update_company_user_role,
            commands::users::set_company_user_active,
            commands::inventory::list_categories,
            commands::inventory::create_category,
            commands::inventory::update_category,
            commands::inventory::set_category_active,
            commands::inventory::delete_category,
            commands::inventory::list_suppliers,
            commands::inventory::create_supplier,
            commands::inventory::update_supplier,
            commands::inventory::set_supplier_active,
            commands::inventory::delete_supplier,
            commands::inventory::list_products,
            commands::inventory::create_product,
            commands::inventory::update_product,
            commands::inventory::adjust_stock,
            commands::inventory::delete_product,
            commands::inventory::list_stock_movements,
            commands::inventory::list_custom_fields,
            commands::inventory::list_product_batches,
            commands::inventory::list_expiring_batches,
            commands::inventory::write_off_batch,
            commands::import_wizard::analyze_import_file,
            commands::import_wizard::execute_import,
            commands::import_wizard::confirm_import,
            commands::import_wizard::list_import_jobs,
            commands::import_wizard::get_import_job,
            commands::import_wizard::rollback_import,
            commands::import_wizard::list_erp_adapters,
            commands::import_wizard::list_import_templates,
            commands::import_wizard::delete_import_template,
            commands::units::list_units,
            commands::units::create_unit,
            commands::units::update_unit,
            commands::units::delete_unit,
            commands::invoices::list_customers,
            commands::invoices::create_customer,
            commands::invoices::delete_customer,
            commands::invoices::list_invoices,
            commands::invoices::get_invoice,
            commands::invoices::create_invoice,
            commands::invoices::add_invoice_item,
            commands::invoices::update_invoice_item,
            commands::invoices::remove_invoice_item,
            commands::invoices::finalize_invoice,
            commands::invoices::record_payment,
            commands::invoices::get_invoice_settings,
            commands::invoices::update_invoice_settings,
            commands::invoices::generate_invoice_html,
            commands::invoices::generate_invoice_pdf,
            commands::invoices::generate_invoice_excel,
            commands::invoices::save_invoice_excel_template,
            commands::invoices::analyze_invoice_excel_template,
            commands::invoices::download_sample_invoice_template,
            commands::auth::save_session,
            commands::auth::load_saved_session,
            commands::auth::clear_saved_session,
            commands::updater::check_for_updates,
            commands::updater::install_update,
            // ---- Backup ----
            commands::backup::create_backup,
            commands::backup::restore_backup,
            commands::backup::list_backups,
            commands::audit::list_audit_logs,
            commands::reports::report_sales_summary,
            commands::reports::report_sales_by_month,
            commands::reports::report_top_products,
            commands::reports::report_top_customers,
            commands::reports::report_stock,
            commands::reports::report_profit_loss,
            commands::reports::report_customer_ledger,
            commands::reports::report_product_movements,
            commands::purchase_orders::list_purchase_orders,
            commands::purchase_orders::get_purchase_order,
            commands::purchase_orders::create_purchase_order,
            commands::purchase_orders::add_po_item,
            commands::purchase_orders::remove_po_item,
            commands::purchase_orders::submit_purchase_order,
            commands::purchase_orders::receive_po_items,
            commands::purchase_orders::record_po_payment,
            commands::export::export_stock_csv,
            commands::export::export_customer_ledger_csv,
            commands::export::export_sales_csv,
            commands::export::export_report_pdf,
            // ---- Accounting Ledger ----
            commands::ledger::get_chart_of_accounts,
            commands::ledger::get_ledger_summary,
            commands::ledger::get_journal_entries,
            commands::ledger::get_account_statement,
            commands::ledger::post_manual_entry,
            // ---- Roles & Permissions ----
            commands::roles::list_roles,
            commands::roles::create_custom_role,
            commands::roles::update_role_permissions,
            commands::roles::delete_custom_role,
            commands::roles::get_my_permissions,
            // ---- Search ----
            commands::search::search_all,
            // ---- Theme ----
            commands::theme::get_theme,
            commands::theme::update_theme,
            commands::theme::read_file_base64,
            // ---- Notifications ----
            commands::notifications::get_notifications,
            // ---- Retention ----
            commands::retention::get_retention_summary,
            commands::retention::archive_old_records,
            // ---- SaaS Layer ----
            commands::saas::list_packages,
            commands::saas::create_package,
            commands::saas::update_package,
            commands::saas::delete_package,
            commands::saas::get_current_subscription,
            commands::saas::get_company_subscription,
            commands::saas::assign_company_subscription,
            commands::saas::list_company_modules,
            commands::saas::set_company_module,
            commands::saas::list_feature_flags,
            commands::saas::set_feature_flag,
            commands::saas::list_tenant_companies,
            commands::saas::get_tenant_company_detail,
            commands::saas::get_platform_analytics,
            commands::saas::register_tenant,
            commands::saas::update_tenant_company,
            commands::saas::archive_company,
            commands::saas::activate_company,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}
