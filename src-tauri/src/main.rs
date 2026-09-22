#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod artifacts;
mod browser_runtime;
mod config;
mod credential_cleanup;
mod desktop_theme;
mod engine;
mod logging;
mod notifications;
mod pets;
mod pet_config;
mod pet_packages;
mod process;
mod profile_recovery;
mod profiles;
mod storage;
mod storage_quota;
mod task_snapshots;
use engine::{Control, Engine};
use std::{fs, os::windows::process::CommandExt, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
fn diagnostics(state: tauri::State<Engine>) -> engine::Diagnostics {
    let mut result=state.state.lock().unwrap().clone();
    if let Ok(catalog)=profiles::load(&state.root) {
        result.active_profile_needs_apply=catalog.profiles.iter().find(|profile|profile.id==result.active_profile_id)
            .and_then(|profile|serde_json::to_value(profile).ok()) != result.active_profile_definition;
    }
    result
}
#[tauri::command]
fn connection(state: tauri::State<Engine>) -> Result<config::Connection, String> {
    Ok(profiles::active(&profiles::load(&state.root)?)?
        .connection
        .clone())
}
#[tauri::command]
fn connection_profiles(state: tauri::State<Engine>) -> Result<profiles::Catalog, String> {
    profiles::load(&state.root)
}
#[tauri::command]
async fn global_storage_stats(state:tauri::State<'_,Engine>)->Result<storage_quota::Inventory,String>{
    let quota=state.storage_quota.clone();
    tauri::async_runtime::spawn_blocking(move||quota.inspect()).await.map_err(|_|"全局存储扫描中断".to_string())?
}
#[tauri::command]
async fn set_storage_quota(state:tauri::State<'_,Engine>,expected_revision:u64,limit_bytes:u64)->Result<storage_quota::Inventory,String>{
    let quota=state.storage_quota.clone();
    tauri::async_runtime::spawn_blocking(move||quota.set_limit(expected_revision,limit_bytes)).await.map_err(|_|"总配额保存结果未确认，请重新扫描".to_string())?
}
#[tauri::command]
async fn credential_cleanup(
    state: tauri::State<'_, Engine>,
    selection: Option<credential_cleanup::Selection>,
) -> Result<serde_json::Value, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = engine.save_lock.lock().map_err(|_| "凭据清理锁不可用")?;
        let state = engine.state.lock().map_err(|_| "引擎状态不可用")?;
        if let Some(selection) = selection {
            serde_json::to_value(credential_cleanup::apply(&engine.root, &state.active_credential_ref, selection)?)
        } else {
            serde_json::to_value(credential_cleanup::inspect(&engine.root, &state.active_credential_ref)?)
        }.map_err(|_| "无法返回凭据清理结果".into())
    }).await.map_err(|_| "凭据清理中断，请重新扫描；不要自动重试".to_string())?
}
#[tauri::command]
async fn desktop_storage(
    state: tauri::State<'_, Engine>,
    profile_id: String,
    days: u32,
    selection: Option<Vec<storage::Selection>>,
) -> Result<serde_json::Value, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = engine.save_lock.lock().map_err(|_| "存储操作锁不可用")?;
        let home = if profile_id == "shared" { engine.root.join("dsh") } else {
            let catalog = profiles::load(&engine.root)?;
            let profile = catalog.profiles.iter().find(|p| p.id == profile_id).ok_or("连接已不存在，请重新载入")?;
            profiles::legacy_home(&engine.root, &profile.id)?
        };
        if let Some(selection) = selection {
            if selection.is_empty() || selection.len() > 200 {
                return Err("每次选择 1–200 份记录".into());
            }
            let (tx, rx) = std::sync::mpsc::channel();
            engine
                .control
                .send(Control::Maintenance(Box::new(move || {
                    let result = storage::apply(&home, selection);
                    let _ = tx.send(result);
                })))
                .map_err(|_| "引擎管理已退出，未开始清理")?;
            let result = rx
                .recv()
                .map_err(|_| "清理回执未确认，请重新扫描；不要自动重试")??;
            serde_json::to_value(result).map_err(|_| "无法返回清理结果".into())
        } else {
            serde_json::to_value(storage::inspect(&home, days)?)
                .map_err(|_| "无法返回存储预览".into())
        }
    })
    .await
    .map_err(|_| "存储操作中断，请重新扫描".to_string())?
}
#[tauri::command]
async fn connection_recovery(
    state: tauri::State<'_, Engine>,
    source: Option<String>,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = engine.save_lock.lock().map_err(|_| "配置恢复锁不可用")?;
        if let Some(source) = source {
            let catalog = profile_recovery::restore(
                &engine.root,
                &source,
                token.as_deref().ok_or("请先预览备份")?,
            )?;
            serde_json::to_value(catalog).map_err(|_| "无法返回恢复结果".into())
        } else {
            serde_json::to_value(profile_recovery::inspect(&engine.root))
                .map_err(|_| "无法读取恢复预览".into())
        }
    })
    .await
    .map_err(|_| "恢复操作中断，请重新读取配置；勿自动重试".to_string())?
}
#[tauri::command]
async fn save_connection_profile(
    state: tauri::State<'_, Engine>,
    id: Option<String>,
    connection: config::Connection,
    network: profiles::Network,
    api_key: String,
    revision: u64,
) -> Result<profiles::Catalog, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _save = engine
            .save_lock
            .lock()
            .map_err(|_| "Configuration save lock unavailable")?;
        profiles::save(&engine.root, id, connection, network, &api_key, revision)
    })
    .await
    .map_err(|_| "Connection save task failed".to_string())?
}
#[tauri::command]
async fn delete_connection_profile(state: tauri::State<'_, Engine>, id: String, replacement_id: Option<String>, revision: u64) -> Result<profiles::Catalog, String> {
    let engine=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _save=engine.save_lock.lock().map_err(|_| "Configuration save lock unavailable")?;
        let running=engine.state.lock().map_err(|_| "Engine state unavailable")?.active_profile_id == id;
        let catalog=profiles::remove(&engine.root,&id,replacement_id.as_deref(),revision)?;
        if running {
            let (tx,rx)=std::sync::mpsc::channel();
            engine.control.send(Control::RestartAndWait(tx)).map_err(|_| "连接已删除，请重新启动引擎")?;
            rx.recv_timeout(std::time::Duration::from_secs(110)).map_err(|_| "连接已删除，引擎启动超时，请检查运行状态")??;
        }
        Ok(catalog)
    }).await.map_err(|_| "删除操作中断，请重新载入连接列表".to_string())?
}
#[tauri::command]
async fn activate_connection_profile(
    state: tauri::State<'_, Engine>,
    id: String,
    revision: u64,
) -> Result<(), String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _save = engine
            .save_lock
            .lock()
            .map_err(|_| "Configuration save lock unavailable")?;
        // Reapplying the unchanged running profile is a no-op, including stale
        // UI double clicks. Saved edits still need a new engine configuration.
        let catalog=profiles::load(&engine.root)?;
        if catalog.revision!=revision { return Err("连接配置已变化，请重新载入后再应用。".into()); }
        let already_applied={
            let running=engine.state.lock().map_err(|_| "Engine state unavailable")?;
            running.backend_health=="ready" && running.active_profile_id==id && catalog.active_id==id &&
                catalog.profiles.iter().find(|profile|profile.id==id).and_then(|profile|serde_json::to_value(profile).ok())==running.active_profile_definition
        };
        if already_applied { return Ok(()); }
        profiles::activate(&engine.root, &id, revision)?;
        let (tx, rx) = std::sync::mpsc::channel();
        engine
            .control
            .send(Control::RestartAndWait(tx))
            .map_err(|_| "Supervisor is unavailable")?;
        rx.recv_timeout(std::time::Duration::from_secs(110))
            .map_err(|_| "连接已选择，但引擎启动超时；请查看诊断。".to_string())?
    })
    .await
    .map_err(|_| "Connection activation task failed".to_string())?
}
#[tauri::command]
fn appearance(state: tauri::State<Engine>) -> Result<desktop_theme::Appearance, String> {
    let home = state
        .state
        .lock()
        .map_err(|_| "Engine state unavailable")?
        .active_home
        .clone();
    desktop_theme::load_home(&home)
}
#[tauri::command]
async fn task_snapshots(
    state: tauri::State<'_, Engine>,
    profile_id: String,
    request: task_snapshots::Request,
) -> Result<serde_json::Value, String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Serializes native writes and connection activation. The request stays
        // bound to the connection that the user actually inspected.
        let _guard = engine.save_lock.lock().map_err(|_| "快照操作锁不可用")?;
        let home = {
            let state = engine.state.lock().map_err(|_| "引擎状态不可用")?;
            if profile_id.is_empty() || state.active_profile_id != profile_id {
                return Err("当前连接已变化，请重新载入快照".into());
            }
            state.active_home.clone()
        };
        let _reservation=request.storage_reservation().map(|bytes|engine.storage_quota.reserve(&home,bytes)).transpose()?;
        task_snapshots::dispatch(&home, request)
    })
    .await
    .map_err(|_| "快照任务中断；请重新读取状态，勿自动重试".to_string())?
}
#[tauri::command]
async fn save_connection(
    state: tauri::State<'_, Engine>,
    connection: config::Connection,
    api_key: String,
) -> Result<(), String> {
    let engine = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _save = engine
            .save_lock
            .lock()
            .map_err(|_| "Configuration save lock unavailable")?;
        if engine.root.join("connections.json").exists() {
            return Err("请通过多连接管理保存设置。".into());
        }
        config::save(&engine.root, &connection, &api_key)?;
        let (tx, rx) = std::sync::mpsc::channel();
        engine
            .control
            .send(Control::RestartAndWait(tx))
            .map_err(|_| "Supervisor is unavailable")?;
        rx.recv_timeout(std::time::Duration::from_secs(110))
            .map_err(|_| "配置已保存，但等待引擎启动超时。请查看诊断状态。".to_string())?
    })
    .await
    .map_err(|_| "Configuration save task failed".to_string())?
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
#[tauri::command]
fn open_session_diagnostics(app: tauri::AppHandle) -> Result<(), String> {
    engine::show_diagnostics(&app)
}
#[tauri::command]
fn reset_diagnostic_key() -> Result<(), String> {
    config::diagnostic_key(true).map(|_| ())
}
fn restore_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn restore_main(app: &tauri::AppHandle) {
    let label = if app.get_webview_window("main").is_some() {
        "main"
    } else {
        "shell"
    };
    restore_window(app, label);
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
            pets::pet_ready,
            pets::pet_settings,
            pets::pet_snapshot,
            pets::pet_action,
            pet_packages::pet_packages,
            pet_packages::pet_resource,
            pet_packages::pet_pick,
            diagnostics,
            connection,
            connection_profiles,
            desktop_storage,
            global_storage_stats,
            set_storage_quota,
            credential_cleanup,
            connection_recovery,
            save_connection_profile,
            delete_connection_profile,
            activate_connection_profile,
            appearance,
            task_snapshots,
            save_connection,
            open_session_diagnostics,
            reset_diagnostic_key,
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
                .title("DSHDesktop — 设置")
                .inner_size(780.0, 800.0)
                .min_inner_size(600.0, 600.0)
                .on_navigation(|u| {
                    matches!(u.scheme(), "tauri" | "http")
                        && matches!(u.host_str(), Some("localhost" | "tauri.localhost"))
                })
                .build()?;
            let workspace = MenuItem::with_id(
                app,
                "show",
                "返回工作区",
                true,
                None::<&str>,
            )?;
            let restart = MenuItem::with_id(app, "restart", "重启引擎", true, None::<&str>)?;
            let sessions = MenuItem::with_id(
                app,
                "session-diagnostics",
                "会话诊断",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            app.set_menu(Menu::with_items(
                app,
                &[&Submenu::with_items(
                    app,
                    "应用",
                    true,
                    &[&workspace, &sessions, &restart, &quit],
                )?],
            )?)?;
            let tray_menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "show", "打开 DSH Desktop", true, None::<&str>)?,
                    &MenuItem::with_id(app, "settings", "设置 / 诊断", true, None::<&str>)?,
                    &MenuItem::with_id(app, "session-diagnostics", "会话诊断", true, None::<&str>)?,
                    &MenuItem::with_id(app, "restart", "重启引擎", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
                ],
            )?;
            // Tauri retains the tray handle for the application's lifetime.
            // Fail startup if it cannot be created: hidden windows must remain recoverable.
            TrayIconBuilder::with_id("dsh-desktop")
                .icon(
                    app.default_window_icon()
                        .ok_or("Application icon is missing")?
                        .clone(),
                )
                .tooltip("DSH Desktop — 点击打开，右键退出")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        restore_main(tray.app_handle());
                    }
                })
                .build(app)?;
            logs.write(
                "desktop.log",
                "system tray initialized; window close hides to tray",
            );
            app.manage(pets::Controller::new(root.clone()));
            app.manage(Engine::start(app.handle().clone(), root, runtime, logs));
            if pets::enabled(app.handle()){if let Err(e)=pets::open(app.handle()){browser_runtime::write_startup_log(&e);}}
            // Explicit process-local smoke mode; ordinary installs remain off.
            if std::env::var("DSH_DESKTOP_PET_SMOKE").as_deref()==Ok("1") { if let Err(e)=pets::open(app.handle()){browser_runtime::write_startup_log(&e);} }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_main(app),
            "settings" => restore_window(app, "shell"),
            "session-diagnostics" => {
                let _ = engine::show_diagnostics(app);
            }
            "restart" => {
                let _ = app.state::<Engine>().control.send(Control::Restart);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("pet-"){pets::closed(window.app_handle(),window.label());return;}
                api.prevent_close();
                let _ = window.hide();
                // Closing the main window also hides its companion settings window.
                if window.label() == "main" {
                    if let Some(shell) = window.app_handle().get_webview_window("shell") {
                        let _ = shell.hide();
                    }
                }
                browser_runtime::write_startup_log(&format!(
                    "window hidden to tray: {}",
                    window.label()
                ));
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
