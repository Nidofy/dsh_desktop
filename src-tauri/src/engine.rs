use crate::{config, logging::Logs, process::Job, profiles};
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
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
    pub environment_id:String,
    pub engine_epoch:String,
    pub last_successful_stage:String,
    pub failure:Option<Failure>,
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
    pub transport_ready: bool,
    pub core_ready: bool,
    pub detail: String,
}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Failure {pub id:String,pub phase:String,pub component:String,pub reason:String,pub retryable:bool,pub desktop_version:String,pub engine_version:String,pub last_successful_stage:String}
pub enum Control {
    Inspect{id:String,action:String,reply:Sender<serde_json::Value>},
    RestartAndWait(Sender<Result<(), String>>),
    Apply(Apply),
    Maintenance(Box<dyn FnOnce() + Send>),
    Stop,
}
pub struct Apply {
    pub profile: profiles::Profile,
    pub previous: Option<profiles::Profile>,
    pub revision: u64,
    pub reply: Sender<Result<(), String>>,
}
#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    pub state: Arc<Mutex<Diagnostics>>,
    pub control: Sender<Control>,
    pub done: Arc<Mutex<Receiver<()>>>,
    pub save_lock: Arc<Mutex<()>>,
    pub storage_quota: crate::storage_quota::Quota,
    pub snapshot_workers: Arc<std::sync::atomic::AtomicUsize>,
    pub switch_ticket: Arc<Mutex<Option<crate::engine_control::Ticket>>>,
    pub repair_workspaces:Arc<std::sync::atomic::AtomicBool>,
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
        "BOOT_ADAPTER_UNSUPPORTED" => "此引擎尚未通过桌面适配或固定版本校验，已在修改会话和设置前停止。请使用通过完整构建验收的运行目录。",
        "BOOT_MODULE_LINK" => "旧版模块目录阻止引擎启动。请打开日志目录检查 dsh/profiles/node_modules；保留原目录后修复运行时链接。",
        "BOOT_ACCESS_DENIED" => "引擎无法读写本机目录。请检查 DSHDesktop 数据目录及运行目录的权限，关闭仍占用文件的旧版程序后重试。",
        "BOOT_MODULE_MISSING" => "引擎依赖缺失或旧模块链接失效。请使用包含 resources 的完整验证目录启动。",
        "BOOT_ADDRESS_IN_USE" => "引擎端口被占用，请重启引擎。",
        "BOOT_SETTINGS_INVALID" => "DSH 设置无法载入或同步。请检查数据目录中的 dsh/settings.yaml 或 dsh/profiles/dsh-desktop/cordis.patch.yml 与 desktop.patch.json，原设置已保留。",
        "BOOT_LEGACY_MIGRATION" => "旧设置尚未安全迁移。原文件已保留；请备份候选数据，检查 settings.yaml 中新版不支持的节、字段或明文 API Key。若存在 settings.yaml.imported，先从迁移前副本恢复完整旧设置；不要将旧 EXE 指向此候选目录。",
        "BOOT_SETTINGS_CONFLICT" => "未完成的配置切换与当前文件有冲突，已停止恢复。请保留 settings.yaml 和 desktop-settings-transaction.json，并从备份确认需要保留的配置。",
        "BOOT_SETTINGS_RECOVERY" => "配置切换的恢复记录无法读取或解密，现有记录已保留。请使用原 Windows 账户重试，并检查本机 PowerShell 和数据目录权限。",
        "BOOT_SETTINGS_LOCKED" => "设置写入锁仍被占用，请先退出旧 DSH 进程。异常退出后的遗留锁需确认原进程已结束再处理；现有配置与事务记录均保留。",
        "CACHE_KEY_POLICY_UNSUPPORTED" => "当前连接不支持所选独立缓存键策略。请在连接设置中选择原生缓存键策略，或检查 OpenAI 格式及已确认模型列表。",
        "BOOT_PREFERENCES_INVALID" => "诊断偏好无法载入，请检查数据目录中的诊断设置与访问权限。",
        "BOOT_UNEXPECTED" => "DSH 引擎启动异常。请在运行状态中复制诊断信息，并提供日志目录内的 desktop.log。",
        "BOOT_WORKSPACE_INCONSISTENT" => "工作区记录存在冲突，引擎未能启动。请保留数据目录，并提供启动日志以修复工作区索引。",
        "WORKSPACE_VERSION_UNSUPPORTED" => "当前引擎不支持此工作区存储版本，迁移未执行。请使用对应版本打开原数据，或在独立候选环境中验证。",
        _ => return None,
    })
}
impl Engine {
    pub fn start(app: tauri::AppHandle, root: PathBuf, runtime: PathBuf, logs: Logs) -> Self {
        let (tx, rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(Diagnostics {
            environment_id:crate::environments::id().into(),
            engine_epoch:String::new(),
            last_successful_stage:"host-ready".into(),failure:None,
            active_credential_ref: String::new(),
            active_profile_definition: None,
            active_profile_needs_apply: false,
            snapshot_status: "当前引擎尚无自动快照结果".into(),
            snapshot_navigation: None,
            active_profile_id: String::new(),
            active_profile_name: String::new(),
            active_home: root.join("dsh"),
            desktop_version: env!("CARGO_PKG_VERSION").into(),
            dsh_version: "pending-verification".into(),
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
            transport_ready: false,
            core_ready: false,
            detail: "Starting bundled DeepSeek Harness…".into(),
        }));
        let engine = Self {
            storage_quota: crate::storage_quota::Quota::new(root.clone()),
            snapshot_workers: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            switch_ticket: Arc::new(Mutex::new(None)),
            repair_workspaces:Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
                    " node=24.16.0 supervisor started; engine identity pending verification"
                ),
            );
            let mut completion: Option<Sender<Result<(), String>>> = None;
            let mut applying: Option<Apply> = None;
            let mut fallback: Option<profiles::Profile> = None;
            loop {
                match run(&app, &worker, &runtime, &logs, &rx, &mut completion, &mut applying, fallback.take()) {
                    Ok(Control::Inspect{reply,..})=>{let _=reply.send(serde_json::json!({"known":false}));}
                    Ok(Control::Stop) => break,
                    Ok(Control::RestartAndWait(reply)) => {
                        if let Some(old) = completion.replace(reply) {
                            let _ = old.send(Err("Restart was superseded".into()));
                        }
                    }
                    Ok(Control::Apply(request)) => applying=Some(request),
                    Ok(Control::Maintenance(action)) => {
                        worker.maintenance(action);
                    }
                    Err(message) => {
                        worker.record_failure(&message,&logs);
                        if let Some(request)=applying.take() {
                            // No catalogue change until core readiness. Saved edits
                            // remain saved; fallback uses the exact old live definition.
                            fallback=request.previous;
                            let _=request.reply.send(Err(if fallback.is_some(){format!("连接应用失败：{message} 默认连接未改变，恢复结果见运行状态。 ")}else{message.clone()}));
                            if fallback.is_some(){logs.write("desktop.log","connection apply failed; restoring previous live profile");continue;}
                        }
                        if let Some(reply) = completion.take() {
                            let _ = reply.send(Err(message.clone()));
                        }
                        worker.update("failed", &message, None, None);
                        logs.write("desktop.log", &message);
                        if let Some(w) = app.get_webview_window("shell") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        loop {match rx.recv() {
                            Ok(Control::Inspect{reply,..})=>{let _=reply.send(serde_json::json!({"known":false}));continue;}
                                    Ok(Control::RestartAndWait(reply)) => completion = Some(reply),
                            Ok(Control::Apply(request)) => applying=Some(request),
                            Ok(Control::Maintenance(action)) => worker.maintenance(action),
                            _ => {let _=done_tx.send(());return;},
                        }break;}
                    }
                }
            }
            if let Some(reply) = completion {
                let _ = reply.send(Err("Engine stopped before restart completed".into()));
            }
            if let Some(request)=applying {let _=request.reply.send(Err("连接应用未完成，引擎已停止；默认连接保持不变。".into()));}
            logs.write("desktop.log", "backend job closed; supervisor stopped");
            let _ = done_tx.send(());
        });
        engine
    }
    fn update(&self, health: &str, detail: &str, pid: Option<u32>, port: Option<u16>) {
        let mut s = self.state.lock().unwrap();
        s.backend_health = health.into();
        if health != "ready" { s.transport_ready=false; s.core_ready=false; }
        s.detail = detail.into();
        s.backend_pid = pid;
        s.backend_port = port;
        if health=="ready"{s.last_successful_stage="core-ready".into();}
    }
    fn record_failure(&self,message:&str,logs:&Logs){
        let mut s=self.state.lock().unwrap();
        let reason=if message.contains("缓存"){"CACHE_CAPABILITY"}else if message.contains("设置")||message.contains("配置"){"CONFIGURATION"}else if message.contains("CA"){"CERTIFICATE"}else if message.contains("工作区"){"WORKSPACE_COMPATIBILITY"}else if message.contains("快照"){"SNAPSHOT"}else if message.contains("超时"){"TIMEOUT"}else{"ENGINE_UNAVAILABLE"};
        let failure=Failure{id:profiles::new_id().unwrap_or_else(|_|"unavailable".into()),phase:if s.backend_health=="ready"{"running"}else{"startup"}.into(),component:"desktop-supervisor".into(),reason:reason.into(),retryable:!matches!(reason,"CONFIGURATION"|"WORKSPACE_COMPATIBILITY"|"CACHE_CAPABILITY"),desktop_version:s.desktop_version.clone(),engine_version:s.dsh_version.clone(),last_successful_stage:s.last_successful_stage.clone()};
        if let Ok(line)=serde_json::to_string(&failure){logs.write("desktop.log",&line);}s.failure=Some(failure);
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
    applying: &mut Option<Apply>,
    fallback: Option<profiles::Profile>,
) -> Result<Control, String> {
    // The old process is gone, but a bounded snapshot may be finishing an
    // atomic file write. Do not start a new writer until that lane has drained.
    // Stop remains serviceable while draining, including on a stalled disk.
    let drain=Instant::now();
    while engine.snapshot_workers.load(std::sync::atomic::Ordering::SeqCst)!=0 {
        if let Ok(control)=rx.try_recv(){if let Control::Inspect{reply,..}=control{let _=reply.send(serde_json::json!({"known":false}));continue;}if let Some(request)=applying.take(){let _=request.reply.send(Err("连接应用被控制请求中断，默认连接保持不变。".into()));}return Ok(control);}
        if drain.elapsed()>Duration::from_secs(20){return Err("旧引擎快照写入尚未结束，未启动新引擎。请稍后重试。".into());}
        thread::sleep(Duration::from_millis(50));
    }
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
    let engine_package: serde_json::Value = serde_json::from_slice(&fs::read(runtime.join("dsh/node_modules/@deepseek-ai/dsh/package.json")).map_err(|_|"引擎版本文件不可读")?).map_err(|_|"引擎版本文件损坏")?;
    let engine_version=engine_package["version"].as_str().ok_or("引擎版本缺失")?.to_owned();
    if engine_package["name"]!="@deepseek-ai/dsh" || !matches!(engine_version.as_str(),"0.1.5-rc.2"|"0.1.7-alpha.2") { return Err("不支持的引擎组合".into()); }
    if engine_version=="0.1.7-alpha.2" && crate::environments::id()=="stable" { return Err("源码候选只能在独立候选环境运行，请使用随包的候选启动入口。".into()); }
    // Share the state lock with credential cleanup while capturing the active
    // reference and reading its key; startup must not race collection.
    let mut active_state = engine.state.lock().map_err(|_| "Engine state unavailable")?;
    let catalog = profiles::load(&engine.root)?;
    let profile = applying.as_ref().map(|a|&a.profile).or(fallback.as_ref()).unwrap_or(profiles::active(&catalog)?).clone();
    let c = &profile.connection;
    let source_configuration=if engine_version=="0.1.7-alpha.2" {Some(crate::source_providers::build(&engine.root,runtime,&catalog,&profile)?)}else{None};
    if let Some(source)=&source_configuration {fs::write(engine.root.join("desktop.patch.json"),serde_json::to_vec_pretty(&source.patch).unwrap()).map_err(|_|"源码提供方配置写入失败")?;}else{config::write_overlay(&engine.root, &c, runtime)?;}
    let key = profiles::key(&engine.root, &profile)?;
    if !c.base_url.is_empty() && key.is_empty() {
        return Err("当前连接缺少凭据，请在设置中保存 API Key。".into());
    }
    let home = profiles::home(&engine.root, &profile.id)?;
    {
        let state = &mut *active_state;
        state.active_profile_id = profile.id.clone();
        state.dsh_version = engine_version.clone();
        state.active_credential_ref = profile.credential_ref.clone();
        state.active_profile_definition = serde_json::to_value(&profile).ok();
        state.active_profile_name = c.provider_name.clone();
        state.active_home = home.clone();
        state.snapshot_navigation = None;
    }
    drop(active_state);
    if crate::settings_owner::recover(&engine.root)?{logs.write("desktop.log","recovered owned startup settings lock after confirmed child exit");}
    let settings_owner=profiles::new_id()?;
    engine.state.lock().map_err(|_|"引擎状态不可用")?.engine_epoch=settings_owner.clone();
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
        .env("DSH_DESKTOP_ENVIRONMENT", crate::environments::id())
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("DSH_DESKTOP_PATCH", engine.root.join("desktop.patch.json"))
        .env("DSH_DESKTOP_SETTINGS_OWNER",&settings_owner)
        .env("DSH_DESKTOP_REPAIR_WORKSPACES",if engine.repair_workspaces.swap(false,std::sync::atomic::Ordering::SeqCst){"1"}else{"0"})
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
    let(control_tx,control_rx)=mpsc::sync_channel::<serde_json::Value>(4);
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
            if let Some(data)=line.strip_prefix("dsh control: "){if data.len()<1024{if let Ok(value)=serde_json::from_str(data){let _=control_tx.try_send(value);}}continue;}
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
    crate::settings_owner::record(&engine.root,&crate::settings_owner::Owner{pid,token:settings_owner})?;
    let diagnostic_key = config::diagnostic_key(false).ok();
    let start_message = format!(
        "start {}\n",
        serde_json::json!({"diagnosticKey": diagnostic_key, "providerKeys":source_configuration.as_ref().map(|s|&s.keys), "storageQuota":true, "snapshotBridge": {"token": snapshot_bridge.token, "engineId": snapshot_bridge.engine_id}})
    );
    process
        .child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(start_message.as_bytes())
        .map_err(|_| "Cannot signal runtime start")?;
    let snapshots=crate::engine_snapshots::Worker::new(engine.clone(),home.clone(),snapshot_bridge,snapshot_rx);
    engine.update(
        "starting",
        "Waiting for authenticated HTTP readiness…",
        Some(pid),
        None,
    );
    let mut http = crate::engine_http::Worker::new(engine_version.clone());
    let mut url = None;
    let mut ready = false;
    let mut last_check = Instant::now() - Duration::from_secs(5);
    let mut last_ui_poll = Instant::now();
    let mut last_focus_revision = 0;
    let mut last_desktop_revision = 0;
    let mut notification_sink = None;
    let mut misses = 0;
    let mut query:Option<(String,Instant,Sender<serde_json::Value>)>=None;
    let mut live_profile=profile.clone();
    let mut hot_apply:Option<(String,Instant,Apply)>=None;
    loop {
        if let Some((id,at,request))=hot_apply.take(){
            if let Ok(value)=control_rx.try_recv(){
                let epoch=engine.state.lock().map_err(|_|"引擎状态不可用")?.engine_epoch.clone();
                if value["id"]==id&&value["epoch"]==epoch {
                    if value["ok"]==true {
                        if let Err(error)=profiles::activate(&engine.root,&request.profile.id,request.revision){let _=request.reply.send(Err(error));return Err("提供方已更新但默认连接保存失败，请重启以恢复已保存的选择。".into());}
                        live_profile=request.profile.clone();
                        let mut state=engine.state.lock().map_err(|_|"引擎状态不可用")?;
                        state.active_profile_id=live_profile.id.clone();state.active_profile_name=live_profile.connection.provider_name.clone();state.active_credential_ref=live_profile.credential_ref.clone();state.active_profile_definition=serde_json::to_value(&live_profile).ok();
                        let _=request.reply.send(Ok(()));
                    }else {let _=request.reply.send(Err("提供方更新失败，已请求恢复旧配置；请检查运行状态。".into()));if value["code"]=="SOURCE_PROVIDER_RECOVERY_REQUIRED"{return Err("提供方配置回退未完成，请重启引擎恢复保存的连接。".into());}}
                }else{hot_apply=Some((id,at,request));}
            }else if at.elapsed()>Duration::from_secs(20){let _=request.reply.send(Err("提供方应用结果未确认，请等待引擎恢复后重试。".into()));return Err("提供方应用响应超时，请重启以恢复保存的连接。".into());}
            else{hot_apply=Some((id,at,request));}
        }
        if let Some((id,at,reply))=query.take(){
            if let Ok(value)=control_rx.try_recv(){if value["id"]==id {let _=reply.send(value);}else{query=Some((id,at,reply));}}
            else if at.elapsed()>Duration::from_secs(3){let _=reply.send(serde_json::json!({"known":false}));}
            else{query=Some((id,at,reply));}
        }
        if let Ok(control) = rx.try_recv() {
            if let Control::Inspect{id,action,reply}=control {
                if !ready||query.is_some()||hot_apply.is_some(){let _=reply.send(serde_json::json!({"known":false}));}
                else{let line=format!("desktop-control {}\n",serde_json::json!({"id":id,"action":action}));
                    if process.child.stdin.as_mut().is_some_and(|input|input.write_all(line.as_bytes()).is_ok()){query=Some((id,Instant::now(),reply));}
                    else{let _=reply.send(serde_json::json!({"known":false}));}}
                continue;
            }
            if let Control::Apply(request)=control {
                if crate::source_providers::can_hot_apply(&engine_version,ready,Some(&live_profile),&request.profile){
                    if hot_apply.is_some()||query.is_some(){let _=request.reply.send(Err("其他连接操作尚未完成，请稍后重试。".into()));continue;}
                    let prepared=(||->Result<(String,String),String>{
                        let catalog=profiles::load(&engine.root)?;if catalog.revision!=request.revision{return Err("连接配置已变化，请重新载入。".into());}
                        let source=crate::source_providers::build(&engine.root,runtime,&catalog,&request.profile)?;
                        let id=profiles::new_id()?[2..].to_owned();let epoch=engine.state.lock().map_err(|_|"引擎状态不可用")?.engine_epoch.clone();
                        Ok((id.clone(),format!("source-providers {}\n",serde_json::json!({"id":id,"epoch":epoch,"revision":catalog.revision,"providers":source.providers,"selection":source.selection,"keys":source.keys}))))
                    })();
                    match prepared {Ok((id,line))=>{if process.child.stdin.as_mut().is_some_and(|input|input.write_all(line.as_bytes()).is_ok()){hot_apply=Some((id,Instant::now(),request));}else{let _=request.reply.send(Err("提供方控制通道不可用".into()));}},Err(error)=>{let _=request.reply.send(Err(error));}}
                    continue;
                }
                if let Some((_,_,pending))=hot_apply.take(){let _=pending.reply.send(Err("提供方应用被重载中断".into()));}
                engine.update("restarting","正在停止旧引擎并应用网络设置…",Some(pid),None);process.stop();return Ok(Control::Apply(request));
            }
            if let Some((_,_,pending))=hot_apply.take(){let _=pending.reply.send(Err("提供方应用被引擎控制中断".into()));}
            if let Some(request)=applying.take(){let _=request.reply.send(Err("连接应用被控制请求中断，默认连接保持不变。".into()));}
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
        if let Ok(reply) = snapshots.replies.try_recv() {
                if let Some(input) = process.child.stdin.as_mut() {
                    input
                        .write_all(reply.line.as_bytes())
                        .map_err(|_| "Snapshot supervisor pipe closed")?;
                }
                let navigation = reply.navigation;
                if let Ok(mut state) = engine.state.lock() {
                    state.snapshot_status = reply.status;
                    if navigation.is_some() { state.snapshot_navigation = navigation.clone(); }
                }
                if navigation.is_some() {
                    if let Some(window) = app.get_webview_window("shell") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
        }
        if let Ok(found) = url_rx.try_recv() {
            url = Some(found);
        }
        if !ready && start.elapsed() > Duration::from_secs(90) {
            return Err("引擎核心服务就绪超时，请打开运行状态检查或重试。".into());
        }
        if let Some(reply)=http.poll() {
            match reply {
                crate::engine_http::Reply::Health{transport,core} => {
                    if let Ok(mut state)=engine.state.lock(){state.transport_ready=transport;state.core_ready=core;}
                    if !ready && core && transport {
                        let u=url.as_ref().ok_or("Engine URL unavailable")?;
                        show_main(app,u.clone())?;
                        if let Some(request)=applying.as_ref(){profiles::activate(&engine.root,&request.profile.id,request.revision)?;}
                        engine.update("ready","DSH 核心服务已就绪",Some(pid),u.port());
                        notification_sink=Some(crate::notifications::Sink::new(app.clone(),u.port().unwrap(),logs.clone()));
                        if let Some(reply)=completion.take(){let _=reply.send(Ok(()));}
                        if let Some(request)=applying.take(){let _=request.reply.send(Ok(()));}
                        logs.write("desktop.log",&format!("backend ready pid={pid} port={} startup_ms={}",u.port().unwrap(),start.elapsed().as_millis()));
                        ready=true;
                        if !c.base_url.is_empty(){if let Some(w)=app.get_webview_window("shell"){let _=w.hide();}}
                    } else if ready {
                        // A missing homepage does not kill an otherwise working core.
                        if core {misses=0;} else {misses+=1;}
                        if let Ok(mut state)=engine.state.lock(){state.detail=if !core {"核心服务暂不可达，正在重试…"}else if !transport {"核心服务正常，工作区页面暂不可达"}else{"DSH 核心服务已就绪"}.into();}
                        if misses>=3{return Err("引擎核心服务连续三次无法确认，请重启引擎。".into());}
                    }
                }
                crate::engine_http::Reply::Events(Some(value)) => {
                    if let Some(u)=&url {
                        if let Some(pets)=value.get("pets"){if let Some(port)=u.port(){crate::pets::update(app,port,pets.clone());}}
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
                crate::engine_http::Reply::Events(None)=>{}
            }
        }
        if let Some(u)=&url {
            if last_check.elapsed()>=Duration::from_secs(if ready {5}else{1}) {
                if http.submit(crate::engine_http::Request::Health(u.clone())){last_check=Instant::now();}
            } else if ready && last_ui_poll.elapsed()>=Duration::from_secs(1) {
                let endpoint=format!("{}/desktop-diagnostics/api/recovery/desktop-events?pets={}{}",u.origin().ascii_serialization(),if crate::pets::enabled(app){1}else{0},crate::pets::cursor(app));
                if http.submit(crate::engine_http::Request::Events(endpoint)){last_ui_poll=Instant::now();}
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
        .title(if crate::environments::id()=="stable"{"DeepSeek Harness — DSHDesktop".to_string()}else{format!("DSHDesktop — 候选 {}",crate::environments::id())})
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
        assert!(startup_failure("dsh desktop error: BOOT_ADAPTER_UNSUPPORTED").is_some());
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
