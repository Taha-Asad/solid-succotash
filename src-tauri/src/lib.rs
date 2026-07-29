mod commands;
mod db;

use sqlx::sqlite::SqlitePool;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Your Rust backend is working.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tokio::main]
pub async fn run() {
    let sqlite_url = "sqlite:ijazandcompany.db";

    // Apply all unapplied migrations, including 002.
    db::sqlite_migrate::run_sqlite_migrations(sqlite_url)
        .await
        .expect("Failed to run SQLite migrations");

    // The pool allows Rust commands to reuse database connections.
    let sqlite_pool = SqlitePool::connect(sqlite_url)
        .await
        .expect("Failed to create SQLite pool");

    tauri::Builder::default()
        // Make the database pool available through State<SqlitePool>.
        .manage(sqlite_pool)

        // Make the logged-in Rust session available through
        // State<SessionState>.
        .manage(commands::auth::SessionState::new())

        .plugin(tauri_plugin_opener::init())

        .invoke_handler(tauri::generate_handler![
            greet,

            // Authentication
            commands::auth::login_user,
            commands::auth::logout_user,
            commands::auth::current_user,
            commands::auth::update_my_profile,
            commands::auth::change_my_password,

            // Company
            commands::company::register_company,
            commands::company::get_company,
            commands::company::update_company,

            // Company users
            commands::users::list_company_users,
            commands::users::create_company_user,
            commands::users::update_company_user_role,
            commands::users::set_company_user_active,
        ])

        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}