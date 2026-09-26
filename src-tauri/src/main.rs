// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // When running as an AppImage on modern Wayland environments (Arch Linux, CachyOS, Fedora),
        // the bundled older libwayland-client from Ubuntu CI conflicts with the host Mesa/EGL
        // driver, crashing with "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...".
        // Preloading the host system's libwayland-client.so.0 transparently resolves this.
        if (std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some())
            && std::env::var_os("_CORBEL_WAYLAND_PRELOADED").is_none()
        {
            for candidate in [
                "/usr/lib/libwayland-client.so.0",
                "/usr/lib64/libwayland-client.so.0",
                "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
            ] {
                if std::path::Path::new(candidate).exists() {
                    let existing = std::env::var("LD_PRELOAD").unwrap_or_default();
                    let new_preload = if existing.is_empty() {
                        candidate.to_string()
                    } else {
                        format!("{candidate}:{existing}")
                    };
                    std::env::set_var("LD_PRELOAD", new_preload);
                    std::env::set_var("_CORBEL_WAYLAND_PRELOADED", "1");

                    if let Ok(exe) = std::env::current_exe() {
                        let args: Vec<String> = std::env::args().collect();
                        use std::os::unix::process::CommandExt;
                        let _ = std::process::Command::new(exe).args(&args[1..]).exec();
                    }
                    break;
                }
            }
        }
    }

    corbel_lib::run()
}
