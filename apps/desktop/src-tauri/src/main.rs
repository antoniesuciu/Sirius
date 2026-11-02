//! The Sirius desktop shell (ADR-1): a window, a tray and autostart. All logic lives in the
//! core service, so this process can crash or quit without touching any data.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, env, fs, path::PathBuf};

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
    headers: HashMap<String, String>,
}

/// `~/.config/sirius/desktop.env`, written by `scripts/deploy.sh` when the core is remote.
/// Plain KEY=VALUE lines. A missing file means the local core.
fn desktop_settings() -> HashMap<String, String> {
    let Ok(home) = env::var("HOME") else {
        return HashMap::new();
    };
    let path = PathBuf::from(home).join(".config/sirius/desktop.env");
    parse_settings(&fs::read_to_string(path).unwrap_or_default())
}

fn parse_settings(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
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
    let settings = desktop_settings();
    let setting = |key: &str| env::var(key).ok().or_else(|| settings.get(key).cloned());
    let mut headers = HashMap::new();
    for (key, header) in [
        ("CF_ACCESS_CLIENT_ID", "CF-Access-Client-Id"),
        ("CF_ACCESS_CLIENT_SECRET", "CF-Access-Client-Secret"),
    ] {
        if let Some(value) = setting(key) {
            headers.insert(header.to_string(), value);
        }
    }
    CoreConnection {
        url: setting("SIRIUS_CORE_URL").unwrap_or_else(|| DEFAULT_CORE_URL.to_string()),
        token: setting("SIRIUS_CORE_TOKEN").or_else(|| {
            token_path()
                .and_then(|path| fs::read_to_string(path).ok())
                .map(|token| token.trim().to_string())
        }),
        headers,
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

#[cfg(test)]
mod tests {
    use super::parse_settings;

    #[test]
    fn reads_key_value_lines_and_skips_comments() {
        let settings = parse_settings("# note\nSIRIUS_CORE_URL=https://a.example\nnonsense\nX = y\n");
        assert_eq!(settings["SIRIUS_CORE_URL"], "https://a.example");
        assert_eq!(settings["X"], "y");
        assert_eq!(settings.len(), 2);
    }

    #[test]
    fn keeps_equals_signs_in_values() {
        assert_eq!(parse_settings("TOKEN=ab=cd==")["TOKEN"], "ab=cd==");
    }

    #[test]
    fn an_empty_file_means_the_local_core() {
        assert!(parse_settings("").is_empty());
    }
}
