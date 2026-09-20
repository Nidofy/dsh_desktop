#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod browser_runtime;
mod config;
mod engine;
mod logging;
mod process;
use engine::{Control, Engine};
use std::{fs, os::windows::process::CommandExt, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
fn diagnostics(state: tauri::State<Engine>) -> engine::Diagnostics {
    state.state.lock().unwrap().clone()
}
#[tauri::command]
fn connection(state: tauri::State<Engine>) -> Result<config::Connection, String> {
    config::load(&state.root)
}
#[tauri::command]
fn save_connection(
    state: tauri::State<Engine>,
    connection: config::Connection,
    api_key: String,
) -> Result<(), String> {
    config::save(&state.root, &connection, &api_key)?;
    state
        .control
        .send(Control::Restart)
        .map_err(|_| "Supervisor is unavailable".into())
}
#[tauri::command]
fn restart_engine(state: tauri::State<Engine>) -> Result<(), String> {
    state
        .control
        .send(Control::Restart)
        .map_err(|_| "Supervisor is unavailable".into())
}
#[tauri::command]
fn open_logs(state: tauri::State<Engine>) -> Result<(), String> {
    let explorer =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?)
            .join("explorer.exe");
    std::process::Command::new(explorer)
        .arg(state.root.join("logs"))
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|_| "Cannot open log folder")?;
    Ok(())
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
fn main() {
    let Some(_instance) = process::Instance::acquire() else {
        return;
    };
    let browser = match browser_runtime::prepare() {
        Ok(runtime) => runtime,
        Err(message) => {
            browser_runtime::show_startup_error(&message);
            return;
        }
    };
    let app = tauri::Builder::default()
        .manage(browser)
        .invoke_handler(tauri::generate_handler![
            diagnostics,
            connection,
            save_connection,
            restart_engine,
            open_logs,
            quit_app
        ])
        .setup(|app| {
            let root = PathBuf::from(
                std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?,
            )
            .join("DSHDesktop");
            fs::create_dir_all(&root)?;
            let logs = logging::Logs::new(&root)?;
            let runtime = std::env::current_exe()?.parent().unwrap().join("resources");
            WebviewWindowBuilder::new(app, "shell", WebviewUrl::App("index.html".into()))
                .data_directory(root.join("webview"))
                .title("DSHDesktop — Settings & Diagnostics")
                .inner_size(780.0, 800.0)
                .min_inner_size(600.0, 600.0)
                .on_navigation(|u| {
                    matches!(u.scheme(), "tauri" | "http")
                        && matches!(u.host_str(), Some("localhost" | "tauri.localhost"))
                })
                .build()?;
            let settings = MenuItem::with_id(
                app,
                "settings",
                "Settings / Diagnostics",
                true,
                None::<&str>,
            )?;
            let restart = MenuItem::with_id(app, "restart", "Restart Engine", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            app.set_menu(Menu::with_items(
                app,
                &[&Submenu::with_items(
                    app,
                    "Help",
                    true,
                    &[&settings, &restart, &quit],
                )?],
            )?)?;
            app.manage(Engine::start(app.handle().clone(), root, runtime, logs));
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                if let Some(w) = app.get_webview_window("shell") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "restart" => {
                let _ = app.state::<Engine>().control.send(Control::Restart);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "shell"
                    && window.app_handle().get_webview_window("main").is_some()
                {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(_) => {
            browser_runtime::show_startup_error("无法创建桌面窗口。请确认随包 WebView2 文件完整、用户数据目录可写，并检查企业应用执行策略。");
            return;
        }
    };
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            if let Some(s) = app.try_state::<Engine>() {
                s.shutdown();
            }
        }
    });
}
