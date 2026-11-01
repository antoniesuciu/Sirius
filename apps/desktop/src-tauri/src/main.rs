//! The Sirius desktop shell (ADR-1): a window, a tray and autostart. All logic lives in the
//! core service, so this process can crash or quit without touching any data.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, fs, path::PathBuf};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

const DEFAULT_CORE_URL: &str = "http://127.0.0.1:7337";

#[derive(Serialize)]
struct CoreConnection {
    url: String,
    token: Option<String>,
}

fn token_path() -> Option<PathBuf> {
    if let Ok(file) = env::var("SIRIUS_TOKEN_FILE") {
        return Some(PathBuf::from(file));
    }
    if let Ok(dir) = env::var("SIRIUS_DATA_DIR") {
        return Some(PathBuf::from(dir).join("token"));
    }
    let home = env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".local/share/sirius/token"))
}

/// Where the core is. Read at runtime so the token is never compiled into the bundle.
#[tauri::command]
fn core_connection() -> CoreConnection {
    CoreConnection {
        url: env::var("SIRIUS_CORE_URL").unwrap_or_else(|_| DEFAULT_CORE_URL.to_string()),
        token: token_path()
            .and_then(|path| fs::read_to_string(path).ok())
            .map(|token| token.trim().to_string()),
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Sirius", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Sirius")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Registers the app to open at login. Release builds only, so that a dev build never
/// leaves its debug binary in the user's autostart folder.
#[cfg(not(debug_assertions))]
fn enable_autostart(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    // Benchmarks launch the release binary from the build tree.
    if env::var_os("SIRIUS_NO_AUTOSTART").is_some() {
        return;
    }
    let manager = app.autolaunch();
    if !manager.is_enabled().unwrap_or(false) {
        if let Err(error) = manager.enable() {
            eprintln!("could not enable autostart: {error}");
        }
    }
}

#[cfg(debug_assertions)]
fn enable_autostart(_app: &AppHandle) {}

fn main() {
    tauri::Builder::default()
        // Must stay first: a second launch just raises the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![core_connection])
        .setup(|app| {
            build_tray(app.handle())?;
            enable_autostart(app.handle());
            Ok(())
        })
        // Closing hides to the tray. Reminders keep working because the core owns them.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sirius");
}
