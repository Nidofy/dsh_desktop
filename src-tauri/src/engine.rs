use crate::{config, logging::Logs, process::Job};
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
    Stop,
}
#[derive(Clone)]
pub struct Engine {
    pub root: PathBuf,
    pub state: Arc<Mutex<Diagnostics>>,
    pub control: Sender<Control>,
    pub done: Arc<Mutex<Receiver<()>>>,
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
impl Engine {
    pub fn start(app: tauri::AppHandle, root: PathBuf, runtime: PathBuf, logs: Logs) -> Self {
        let (tx, rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(Diagnostics {
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
            root,
            state,
            control: tx,
            done: Arc::new(Mutex::new(done_rx)),
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
            loop {
                match run(&app, &worker, &runtime, &logs, &rx) {
                    Ok(Control::Stop) => break,
                    Ok(Control::Restart) => {}
                    Err(message) => {
                        worker.update("failed", &message, None, None);
                        logs.write("desktop.log", &message);
                        if let Some(w) = app.get_webview_window("shell") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        match rx.recv() {
                            Ok(Control::Restart) => {}
                            _ => break,
                        }
                    }
                }
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
) -> Result<Control, String> {
    if let Some(w) = app.get_webview_window("main") {
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
    let c = config::load(&engine.root)?;
    config::write_overlay(&engine.root, &c)?;
    let key = config::read_key(&c.base_url)?;
    let home = engine.root.join("dsh");
    let workspace = engine.root.join("workspace");
    fs::create_dir_all(&home).map_err(|_| "Cannot create DSH home")?;
    fs::create_dir_all(&workspace).map_err(|_| "Cannot create default workspace")?;
    let mut command = Command::new(&node);
    command
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
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out_log = logs.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
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
    process
        .child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"start\n")
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
    let mut misses = 0;
    loop {
        if let Ok(control) = rx.try_recv() {
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
            return Err(format!("DSH backend stopped unexpectedly (exit {:?}). Choose Restart Engine, Open Logs, or Quit.", status.code()));
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
        thread::sleep(Duration::from_millis(100));
    }
}
fn show_main(app: &tauri::AppHandle, url: Url) -> Result<(), String> {
    let origin = url.origin();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
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
