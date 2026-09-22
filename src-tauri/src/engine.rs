use crate::{config, logging::Logs, process::Job, profiles};
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    #[serde(skip)]
    pub active_credential_ref: String,
    #[serde(skip)]
    pub active_profile_definition: Option<serde_json::Value>,
    pub active_profile_needs_apply: bool,
    pub snapshot_status: String,
    pub snapshot_navigation: Option<crate::task_snapshots::Navigation>,
    pub active_profile_id: String,
    pub active_profile_name: String,
    pub active_home: PathBuf,
    pub desktop_version: String,
    pub dsh_version: String,
    pub node_version: String,
    pub windows_version: String,
    pub webview2_version: String,
    pub webview2_path: String,
    pub webview2_mode: String,
    pub runtime_path: String,
    pub config_path: String,
    pub log_path: String,
    pub backend_pid: Option<u32>,
    pub backend_port: Option<u16>,
    pub backend_health: String,
    pub detail: String,
}
pub enum Control {
    Restart,
    RestartAndWait(Sender<Result<(), String>>),
    Maintenance(Box<dyn FnOnce() + Send>),
    Stop,
}
#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    pub state: Arc<Mutex<Diagnostics>>,
    pub control: Sender<Control>,
    pub done: Arc<Mutex<Receiver<()>>>,
    pub save_lock: Arc<Mutex<()>>,
    pub storage_quota: crate::storage_quota::Quota,
}
struct Running {
    child: Child,
    _job: Job,
}
impl Running {
    fn stop(&mut self) {
        if let Some(input) = self.child.stdin.as_mut() {
            let _ = input.write_all(b"stop\n");
        }
        let deadline = Instant::now() + Duration::from_secs(6);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn ready_url(line: &str) -> Option<Url> {
    let value = line.strip_prefix("dsh web: ")?.split_whitespace().next()?;
    let u = Url::parse(value).ok()?;
    (u.scheme() == "http"
        && u.host_str() == Some("127.0.0.1")
        && u.port().is_some_and(|p| p > 0)
        && u.username().is_empty()
        && u.password().is_none()
        && u.path() == "/"
        && u.fragment().is_none())
    .then_some(u)
}
fn startup_failure(line: &str) -> Option<&'static str> {
    Some(match line.strip_prefix("dsh desktop error: ")? {
        "BOOT_MODULE_LINK" => "旧版模块目录阻止引擎启动。请打开日志目录检查 dsh/profiles/node_modules；保留原目录后修复运行时链接。",
        "BOOT_ACCESS_DENIED" => "引擎无法读写本机目录。请检查 DSHDesktop 数据目录及运行目录的权限，关闭仍占用文件的旧版程序后重试。",
        "BOOT_MODULE_MISSING" => "引擎依赖缺失或旧模块链接失效。请使用包含 resources 的完整验证目录启动。",
        "BOOT_ADDRESS_IN_USE" => "引擎端口被占用，请重启引擎。",
        "BOOT_SETTINGS_INVALID" => "DSH 设置无法载入或同步。请检查数据目录中的 dsh/settings.yaml 与 desktop.patch.json，原设置已保留。",
        "BOOT_PREFERENCES_INVALID" => "诊断偏好无法载入，请检查数据目录中的诊断设置与访问权限。",
        "BOOT_UNEXPECTED" => "DSH 引擎启动异常。请在运行状态中复制诊断信息，并提供日志目录内的 desktop.log。",
        "BOOT_WORKSPACE_INCONSISTENT" => "工作区记录存在冲突，引擎未能启动。请保留数据目录，并提供启动日志以修复工作区索引。",
        _ => return None,
    })
}
impl Engine {
    pub fn start(app: tauri::AppHandle, root: PathBuf, runtime: PathBuf, logs: Logs) -> Self {
        let (tx, rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(Diagnostics {
            active_credential_ref: String::new(),
            active_profile_definition: None,
            active_profile_needs_apply: false,
            snapshot_status: "当前引擎尚无自动快照结果".into(),
            snapshot_navigation: None,
            active_profile_id: String::new(),
            active_profile_name: String::new(),
            active_home: root.join("dsh"),
            desktop_version: env!("CARGO_PKG_VERSION").into(),
            dsh_version: "0.1.5-rc.2".into(),
            node_version: "24.16.0".into(),
            windows_version: app
                .state::<crate::browser_runtime::BrowserRuntime>()
                .windows_version
                .clone(),
            webview2_version: app
                .state::<crate::browser_runtime::BrowserRuntime>()
                .version
                .clone(),
            webview2_path: app
                .state::<crate::browser_runtime::BrowserRuntime>()
                .folder
                .display()
                .to_string(),
            webview2_mode: "bundled-fixed".into(),
            runtime_path: runtime.display().to_string(),
            config_path: root.display().to_string(),
            log_path: logs.0.display().to_string(),
            backend_pid: None,
            backend_port: None,
            backend_health: "starting".into(),
            detail: "Starting bundled DeepSeek Harness…".into(),
        }));
        let engine = Self {
            storage_quota: crate::storage_quota::Quota::new(root.clone()),
            root,
            state,
            control: tx,
            done: Arc::new(Mutex::new(done_rx)),
            save_lock: Arc::new(Mutex::new(())),
        };
        let worker = engine.clone();
        thread::spawn(move || {
            logs.write(
                "desktop.log",
                concat!(
                    "desktop=",
                    env!("CARGO_PKG_VERSION"),
                    " dsh=0.1.5-rc.2 node=24.16.0 supervisor started"
                ),
            );
            let mut completion: Option<Sender<Result<(), String>>> = None;
            loop {
                match run(&app, &worker, &runtime, &logs, &rx, &mut completion) {
                    Ok(Control::Stop) => break,
                    Ok(Control::Restart) => {}
                    Ok(Control::RestartAndWait(reply)) => {
                        if let Some(old) = completion.replace(reply) {
                            let _ = old.send(Err("Restart was superseded".into()));
                        }
                    }
                    Ok(Control::Maintenance(action)) => {
                        worker.maintenance(action);
                    }
                    Err(message) => {
                        if let Some(reply) = completion.take() {
                            let _ = reply.send(Err(message.clone()));
                        }
                        worker.update("failed", &message, None, None);
                        logs.write("desktop.log", &message);
                        if let Some(w) = app.get_webview_window("shell") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        match rx.recv() {
                            Ok(Control::Restart) => {}
                            Ok(Control::RestartAndWait(reply)) => completion = Some(reply),
                            Ok(Control::Maintenance(action)) => worker.maintenance(action),
                            _ => break,
                        }
                    }
                }
            }
            if let Some(reply) = completion {
                let _ = reply.send(Err("Engine stopped before restart completed".into()));
            }
            logs.write("desktop.log", "backend job closed; supervisor stopped");
            let _ = done_tx.send(());
        });
        engine
    }
    fn update(&self, health: &str, detail: &str, pid: Option<u32>, port: Option<u16>) {
        let mut s = self.state.lock().unwrap();
        s.backend_health = health.into();
        s.detail = detail.into();
        s.backend_pid = pid;
        s.backend_port = port;
    }
    fn maintenance(&self, action: Box<dyn FnOnce() + Send>) {
        // run() has returned and its Running/Job guards have been dropped.
        // The closure never runs beside the old backend or its child processes.
        self.update(
            "maintenance",
            "引擎已停止，正在清理所选桌面记录…",
            None,
            None,
        );
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(action));
    }
    pub fn shutdown(&self) {
        let _ = self.control.send(Control::Stop);
        let _ = self
            .done
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(10));
    }
}

fn run(
    app: &tauri::AppHandle,
    engine: &Engine,
    runtime: &PathBuf,
    logs: &Logs,
    rx: &Receiver<Control>,
    completion: &mut Option<Sender<Result<(), String>>>,
) -> Result<Control, String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
    if let Some(w) = app.get_webview_window("session-diagnostics") {
        let _ = w.destroy();
    }
    if let Some(w) = app.get_webview_window("shell") {
        let _ = w.show();
    }
    engine.update("starting", "Starting bundled DeepSeek Harness…", None, None);
    let start = Instant::now();
    let node = runtime.join("runtime/node.exe");
    let host = runtime.join("host.mjs");
    if !node.is_file()
        || !host.is_file()
        || !runtime
            .join("dsh/node_modules/@deepseek-ai/dsh/lib/bin.js")
            .is_file()
    {
        return Err("Bundled runtime is missing. Re-extract the complete portable ZIP; see runtime path in Diagnostics.".into());
    }
    // Share the state lock with credential cleanup while capturing the active
    // reference and reading its key; startup must not race collection.
    let mut active_state = engine.state.lock().map_err(|_| "Engine state unavailable")?;
    let catalog = profiles::load(&engine.root)?;
    let profile = profiles::active(&catalog)?;
    let c = &profile.connection;
    config::write_overlay(&engine.root, &c, runtime)?;
    let key = profiles::key(&engine.root, profile)?;
    if !c.base_url.is_empty() && key.is_empty() {
        return Err("当前连接缺少凭据，请在设置中保存 API Key。".into());
    }
    let home = profiles::home(&engine.root, &profile.id)?;
    {
        let state = &mut *active_state;
        state.active_profile_id = profile.id.clone();
        state.active_credential_ref = profile.credential_ref.clone();
        state.active_profile_definition = serde_json::to_value(profile).ok();
        state.active_profile_name = c.provider_name.clone();
        state.active_home = home.clone();
        state.snapshot_navigation = None;
    }
    drop(active_state);
    let workspace = engine.root.join("workspace");
    fs::create_dir_all(&home).map_err(|_| "Cannot create DSH home")?;
    fs::create_dir_all(&workspace).map_err(|_| "Cannot create default workspace")?;
    let mut command = Command::new(&node);
    command
        .arg("--use-system-ca")
        .arg("--import")
        .arg(
            url::Url::from_file_path(&host)
                .map_err(|_| "Invalid runtime path")?
                .as_str(),
        )
        .arg(runtime.join("dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"))
        .args(["web", "--patch"])
        .arg(engine.root.join("desktop.patch.json"))
        .args(["--host", "127.0.0.1", "--port", "0", "--no-open"])
        .current_dir(&workspace)
        .creation_flags(0x08000000)
        .env("DSH_HOME", &home)
        .env("DSH_DESKTOP_ROOT", &engine.root)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("DSH_DESKTOP_PATCH", engine.root.join("desktop.patch.json"))
        .env(config::KEY_ENV, key)
        .env("NODE_NO_WARNINGS", "1")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("DEEPSEEK_API_KEY")
        .env_remove("DEEPSEEK_BASE_URL")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    profiles::configure_process(&mut command, &profile.network)?;
    let mut child = command.spawn().map_err(|_| {
        "Cannot launch bundled node.exe. Check extraction and application execution policy."
    })?;
    // Host waits for start; no upstream code or descendants run before Job assignment.
    let job = match Job::new(&child) {
        Ok(j) => j,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Windows Job Object assignment failed; backend was stopped safely.".into());
        }
    };
    let (url_tx, url_rx) = mpsc::channel();
    let (startup_error_tx, startup_error_rx) = mpsc::channel();
    let (snapshot_tx, snapshot_rx) = mpsc::sync_channel::<String>(64);
    let mut snapshot_bridge = crate::task_snapshots::TaskBridge::new()?;
    snapshot_bridge.quota = Some(engine.storage_quota.clone());
    engine
        .state
        .lock()
        .map_err(|_| "Engine state unavailable")?
        .snapshot_status = snapshot_bridge.last_status.clone();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out_log = logs.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(reason) = startup_failure(&line) {
                out_log.write("desktop.log", &line);
                let _ = startup_error_tx.send(reason.to_string());
            }
            if line.starts_with("dsh snapshot: ") {
                if line.len() <= 16400 {
                    let _ = snapshot_tx.try_send(line);
                }
                continue;
            }
            if line == "dsh desktop error: WORKSPACE_MIGRATION_FAILED" {
                let _ = startup_error_tx.send("旧连接的工作区记录未能合并，原数据已保留。请检查存储权限或重复会话文件。".to_string());
            }
            if line == "dsh desktop error: EXTRA_CA_INVALID" {
                let _ = startup_error_tx.send(
                    "企业 CA 未能验证或载入，引擎已停止。请检查连接中的 PEM 证书路径和内容。"
                        .to_string(),
                );
            }
            if line == "dsh desktop error: CACHE_KEY_ADAPTER_MISMATCH" {
                let _ = startup_error_tx.send(
                    "缓存适配器与当前桌面版本不匹配，引擎已停止。请使用配套的完整运行时重新部署。"
                        .to_string(),
                );
            }
            if let Some(url) = ready_url(&line) {
                out_log.write(
                    "dsh.stdout.log",
                    "backend announced loopback URL [authentication redacted]",
                );
                let _ = url_tx.send(url);
            }
            // Upstream output can contain prompts and keys. Do not persist arbitrary lines.
        }
    });
    let err_log = logs.clone();
    thread::spawn(move || {
        let mut count = 0;
        for _line in BufReader::new(stderr).lines().map_while(Result::ok) {
            count += 1;
            if count <= 10 {
                err_log.write(
                    "dsh.stderr.log",
                    "backend stderr received [content withheld for prompt/credential privacy]",
                );
            }
        }
    });
    let pid = child.id();
    let mut process = Running { child, _job: job };
    let diagnostic_key = config::diagnostic_key(false).ok();
    let start_message = format!(
        "start {}\n",
        serde_json::json!({"diagnosticKey": diagnostic_key, "storageQuota":true, "snapshotBridge": {"token": snapshot_bridge.token, "engineId": snapshot_bridge.engine_id}})
    );
    process
        .child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(start_message.as_bytes())
        .map_err(|_| "Cannot signal runtime start")?;
    engine.update(
        "starting",
        "Waiting for authenticated HTTP readiness…",
        Some(pid),
        None,
    );
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(2))
        .build();
    let mut url = None;
    let mut ready = false;
    let mut last_check = Instant::now();
    let mut last_ui_poll = Instant::now();
    let mut last_focus_revision = 0;
    let mut last_desktop_revision = 0;
    let mut notification_sink = None;
    let mut misses = 0;
    loop {
        if let Ok(control) = rx.try_recv() {
            engine.update("restarting", "正在停止旧引擎并应用设置…", Some(pid), None);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
            process.stop();
            return Ok(control);
        }
        if let Some(status) = process
            .child
            .try_wait()
            .map_err(|_| "Cannot query backend process")?
        {
            logs.write(
                "desktop.log",
                &format!("backend exit code={:?}", status.code()),
            );
            if let Ok(reason) = startup_error_rx.recv_timeout(Duration::from_millis(100)) {
                return Err(reason);
            }
            return Err(format!("DSH 引擎意外退出（退出码 {}）。请打开运行状态查看日志，或点击重启引擎。", status.code().map(|v|v.to_string()).unwrap_or_else(||"未知".into())));
        }
        // Process one bounded private request per tick. Never block on save_lock:
        // connection activation may hold it while waiting for this loop to stop.
        if let Ok(line) = snapshot_rx.try_recv() {
            let guard = engine.save_lock.try_lock().ok();
            if let Some(reply) = snapshot_bridge.handle(&home, &line, guard.is_some()) {
                if let Some(input) = process.child.stdin.as_mut() {
                    input
                        .write_all(reply.as_bytes())
                        .map_err(|_| "Snapshot supervisor pipe closed")?;
                }
                let navigation = snapshot_bridge.navigation.take();
                if let Ok(mut state) = engine.state.lock() {
                    state.snapshot_status = snapshot_bridge.last_status.clone();
                    if navigation.is_some() { state.snapshot_navigation = navigation.clone(); }
                }
                if navigation.is_some() {
                    if let Some(window) = app.get_webview_window("shell") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }
        if let Ok(found) = url_rx.try_recv() {
            url = Some(found);
        }
        if !ready {
            if start.elapsed() > Duration::from_secs(90) {
                return Err("Startup timed out after 90 seconds. Check runtime integrity and application execution policy, then restart.".into());
            }
            if let Some(u) = &url {
                if agent
                    .get(u.as_str())
                    .call()
                    .is_ok_and(|r| r.status() == 200)
                {
                    show_main(app, u.clone())?;
                    engine.update("ready", "Native DSH Web UI is ready", Some(pid), u.port());
                    notification_sink = Some(crate::notifications::Sink::new(
                        app.clone(),
                        u.port().unwrap(),
                        logs.clone(),
                    ));
                    if let Some(reply) = completion.take() {
                        let _ = reply.send(Ok(()));
                    }
                    logs.write(
                        "desktop.log",
                        &format!(
                            "backend ready pid={pid} port={} startup_ms={}",
                            u.port().unwrap(),
                            start.elapsed().as_millis()
                        ),
                    );
                    ready = true;
                    if let Some(w) = app.get_webview_window("shell") {
                        if !c.base_url.is_empty() {
                            let _ = w.hide();
                        }
                    }
                }
            }
        } else if last_check.elapsed() > Duration::from_secs(5) {
            last_check = Instant::now();
            if let Some(u) = &url {
                if agent
                    .get(&format!("{}/", u.origin().ascii_serialization()))
                    .call()
                    .is_ok_and(|r| r.status() == 200)
                {
                    misses = 0;
                } else {
                    misses += 1;
                }
                if misses >= 3 {
                    return Err(
                        "Backend HTTP health failed three times. Restart Engine to recover.".into(),
                    );
                }
            }
        }
        if ready && last_ui_poll.elapsed() >= Duration::from_secs(1) {
            last_ui_poll = Instant::now();
            if let Some(u) = &url {
                let endpoint = format!(
                    "{}/desktop-diagnostics/api/recovery/desktop-events",
                    u.origin().ascii_serialization()
                );
                if let Ok(response) = agent.get(&endpoint).call() {
                    if let Ok(value) = serde_json::from_reader::<_, serde_json::Value>(
                        response.into_reader().take(16384),
                    ) {
                        if let Some(revision) = value["desktop"]["revision"].as_u64() {
                            if revision > last_desktop_revision {
                                last_desktop_revision = revision;
                                let nav = &value["desktop"]["navigation"];
                                let _ = show_desktop_page(app, nav["view"].as_str().unwrap_or(""), nav["workspace"].as_str(), nav["sessionId"].as_str());
                            }
                        }
                        if let Some(sink) = &notification_sink {
                            if let Ok(feed) = serde_json::from_value(value["notifications"].clone())
                            {
                                sink.update(app, feed);
                            }
                        }
                        if let Some(revision) = value["focusRevision"].as_u64() {
                            if revision > last_focus_revision {
                                last_focus_revision = revision;
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
}
fn show_main(app: &tauri::AppHandle, url: Url) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, Submenu};
    // Use a fresh native menu for each recreated window; Windows destroys the old HWND menu.
    let menu = (|| -> tauri::Result<_> {
        let settings = MenuItem::with_id(
            app,
            "settings",
            "桌面设置",
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
        Menu::with_items(
            app,
            &[&Submenu::with_items(
                app,
                "应用",
                true,
                &[&settings, &sessions, &restart, &quit],
            )?],
        )
    })()
    .map_err(|_| "Cannot create desktop Help menu".to_string())?;
    let origin = url.origin();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .menu(menu)
        .initialization_script(include_str!("../generated/desktop-theme.js"))
        .data_directory(app.state::<Engine>().root.join("webview"))
        .title("DeepSeek Harness — DSHDesktop")
        .inner_size(1280.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .on_navigation(move |next| next.origin() == origin)
        .on_new_window(|url, _| {
            open_external(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(|_, _| false)
        .build()
        .map_err(|_| {
            "Cannot create WebView. Verify bundled resources/webview2 is complete and allowed by application policy."
                .to_string()
        })?;
    Ok(())
}
pub fn show_diagnostics(app: &tauri::AppHandle) -> Result<(), String> {
    show_desktop_page(app, "diagnostics", None, None)
}
fn show_desktop_page(app: &tauri::AppHandle, view: &str, workspace: Option<&str>, session: Option<&str>) -> Result<(), String> {
    if matches!(view, "settings" | "snapshots") {
        let window = app.get_webview_window("shell").ok_or("Settings window unavailable")?;
        let tab = if view == "snapshots" { "snapshots" } else { "connections" };
        let payload = serde_json::json!({"tab":tab,"workspace":workspace});
        let _ = window.eval(format!("document.dispatchEvent(new CustomEvent('desktop-navigate',{{detail:{payload}}}));"));
        let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
        return Ok(());
    }
    let path = match view {
        "diagnostics" => "", "changes" => "/changes", "actions" => "/actions", "artifacts" => "/artifacts",
        "cache" => "/cache", "recovery" => "/recovery", "self-test" => "/self-test", "compare" => "/compare",
        _ => return Err("Unknown desktop page".into()),
    };
    let state = app.state::<Engine>();
    let port = state
        .state
        .lock()
        .unwrap()
        .backend_port
        .ok_or("Engine is not ready")?;
    let mut url = Url::parse(&format!("http://127.0.0.1:{port}/desktop-diagnostics{path}")).unwrap();
    if let Some(workspace) = workspace { url.query_pairs_mut().append_pair("workspace", workspace); }
    if let Some(session) = session { url.query_pairs_mut().append_pair("sessionId", session); }
    if let Some(window) = app.get_webview_window("session-diagnostics") {
        window.navigate(url).map_err(|_| "Cannot navigate desktop page")?;
        let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
        return Ok(());
    }
    let origin = url.origin();
    let download_origin = origin.clone();
    WebviewWindowBuilder::new(app, "session-diagnostics", WebviewUrl::External(url))
        .data_directory(state.root.join("webview"))
        .title("DSHDesktop — 会话诊断")
        .inner_size(1280.0, 860.0)
        .min_inner_size(800.0, 600.0)
        .on_navigation(move |next| {
            next.origin() == origin && next.path().starts_with("/desktop-diagnostics")
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(move |window, event| match event {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                if url.origin() != download_origin
                    || url.path() != "/desktop-diagnostics/api/export"
                {
                    return false;
                }
                if url.query_pairs().any(|(key, _)| key == "artifact") {
                    if !crate::artifacts::is_artifact_export(&url) {
                        return false;
                    }
                    let owner = window
                        .window()
                        .hwnd()
                        .map(|handle| handle.0)
                        .unwrap_or(std::ptr::null_mut());
                    if let Some(path) = crate::artifacts::save_destination(owner, destination) {
                        *destination = path;
                        true
                    } else {
                        false
                    }
                } else {
                    true
                }
            }
            tauri::webview::DownloadEvent::Finished { .. } => true,
            _ => false,
        })
        .build()
        .map_err(|_| "Cannot open session diagnostics".to_string())?;
    Ok(())
}
fn open_external(url: &Url) {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return;
    }
    let value: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            value.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        );
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_failures_accept_only_fixed_codes() {
        assert!(startup_failure("dsh desktop error: BOOT_MODULE_LINK").is_some());
        assert!(startup_failure("dsh desktop error: BOOT_SETTINGS_INVALID").is_some());
        assert!(startup_failure("dsh desktop error: secret-provider-response").is_none());
        assert!(startup_failure("dsh desktop error: BOOT_UNEXPECTED secret").is_none());
    }
    #[test]
    fn accepts_only_real_loopback_readiness() {
        assert!(ready_url("dsh web: http://127.0.0.1:49152/?token=abc").is_some());
        for s in [
            "http://evil:42/",
            "http://127.0.0.1.evil:42/",
            "http://127.0.0.1:0/",
            "https://127.0.0.1:42/",
            "http://x@127.0.0.1:42/",
        ] {
            assert!(ready_url(&format!("dsh web: {s}")).is_none());
        }
    }
}
