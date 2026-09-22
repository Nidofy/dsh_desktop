//! Native Windows notification-area alerts. No network, registration, installer,
//! PowerShell, or extra tray menu; a hidden notification icon owns each click ID.
use crate::{engine::Engine, logging::Logs};
use serde::Deserialize;
use std::{collections::HashMap, sync::mpsc, thread, time::Duration};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{Shell::*, WindowsAndMessaging::*},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    revision: u64,
    session_id: String,
    kind: String,
}
#[derive(Deserialize)]
pub struct Feed {
    revision: u64,
    enabled: bool,
    items: Vec<Notice>,
}
struct Frame {
    feed: Feed,
    foreground: bool,
}
fn foreground(app: &tauri::AppHandle) -> bool {
    app.webview_windows()
        .values()
        .filter(|w| notification_foreground_label(w.label()))
        .any(|w| w.is_focused().unwrap_or(true))
}
fn notification_foreground_label(label:&str)->bool{!label.starts_with("pet-")}
#[cfg(test)]mod pet_focus_tests{use super::*;#[test]fn pet_focus_does_not_suppress_background_notifications(){assert!(!notification_foreground_label("pet-1"));assert!(!notification_foreground_label("pet-3"));assert!(notification_foreground_label("main"));assert!(notification_foreground_label("shell"));}}
fn consume(feed: &Feed, watermark: &mut u64, suppressed: bool) -> Vec<Notice> {
    let items = feed
        .items
        .iter()
        .take(32)
        .filter(|notice| {
            notice.revision > *watermark
                && notice.revision <= feed.revision
                && feed.enabled
                && !suppressed
                && valid_id(&notice.session_id)
                && title(&notice.kind).is_some()
        })
        .cloned()
        .collect();
    // Suppression consumes the event too; switching away must not replay it.
    *watermark = (*watermark).max(feed.revision);
    items
}
pub struct Sink(mpsc::SyncSender<Frame>);
impl Sink {
    pub fn new(app: tauri::AppHandle, port: u16, logs: Logs) -> Self {
        let (tx, rx) = mpsc::sync_channel(2);
        thread::spawn(move || unsafe { run(app, port, logs, rx) });
        Self(tx)
    }
    pub fn update(&self, app: &tauri::AppHandle, feed: Feed) {
        let foreground = foreground(app);
        let _ = self.0.try_send(Frame { feed, foreground });
    }
}

const CALLBACK: u32 = WM_APP + 37;
const CLASS: &[u16] = &[
    68, 83, 72, 68, 101, 115, 107, 116, 111, 112, 78, 111, 116, 105, 99, 101, 0,
];
#[derive(Default)]
struct Callbacks {
    clicked: Vec<u32>,
    closed: Vec<u32>,
}
unsafe extern "system" fn procedure(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == CALLBACK {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Callbacks;
        if let Some(state) = state.as_mut() {
            // Version 0 deliberately keeps the full uID in wParam.
            match l as u32 {
                NIN_BALLOONUSERCLICK => {
                    if state.clicked.len() < 32 {
                        state.clicked.push(w as u32);
                    }
                }
                NIN_BALLOONHIDE | NIN_BALLOONTIMEOUT => {
                    if state.closed.len() < 32 {
                        state.closed.push(w as u32);
                    }
                }
                _ => {}
            }
        }
        return 0;
    }
    DefWindowProcW(hwnd, msg, w, l)
}
fn put<const N: usize>(target: &mut [u16; N], text: &str) {
    for (to, from) in target.iter_mut().take(N - 1).zip(text.encode_utf16()) {
        *to = from;
    }
}
fn title(kind: &str) -> Option<&'static str> {
    match kind {
        "completed" => Some("DSH · 本轮任务已结束"),
        "failed" => Some("DSH · 执行失败"),
        "permission" => Some("DSH · 等待权限确认"),
        "input" => Some("DSH · 等待你的输入"),
        "attention" => Some("DSH · 任务需要处理"),
        _ => None,
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn base(hwnd: HWND, id: u32) -> NOTIFYICONDATAW {
    NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: id,
        ..Default::default()
    }
}
unsafe fn show(hwnd: HWND, id: u32, kind: &str) -> bool {
    let Some(title) = title(kind) else {
        return false;
    };
    let mut data = base(hwnd, id);
    data.uFlags = NIF_MESSAGE | NIF_STATE | NIF_ICON;
    data.uCallbackMessage = CALLBACK;
    data.dwState = NIS_HIDDEN;
    data.dwStateMask = NIS_HIDDEN;
    data.hIcon = LoadIconW(std::ptr::null_mut(), IDI_APPLICATION);
    if Shell_NotifyIconW(NIM_ADD, &data) == 0 {
        return false;
    }
    data.uFlags = NIF_INFO | NIF_REALTIME;
    data.dwInfoFlags = NIIF_INFO | NIIF_NOSOUND | NIIF_RESPECT_QUIET_TIME;
    put(&mut data.szInfoTitle, title);
    put(
        &mut data.szInfo,
        "点击回到原会话查看详情。不会自动继续执行。",
    );
    if Shell_NotifyIconW(NIM_MODIFY, &data) == 0 {
        Shell_NotifyIconW(NIM_DELETE, &data);
        return false;
    }
    true
}
fn navigate(app: &tauri::AppHandle, port: u16, notice: &Notice) {
    if !valid_id(&notice.session_id) {
        return;
    }
    let engine = app.state::<Engine>();
    if !engine
        .state
        .lock()
        .is_ok_and(|s| s.backend_port == Some(port) && s.backend_health == "ready")
    {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let payload = serde_json::json!({"sessionId":notice.session_id, "requestId":format!("notification-{}",notice.revision)});
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('dsh-desktop-open-session',{{detail:{payload}}}));"));
    }
}
unsafe fn run(app: tauri::AppHandle, port: u16, logs: Logs, rx: mpsc::Receiver<Frame>) {
    let class = WNDCLASSW {
        lpfnWndProc: Some(procedure),
        hInstance: GetModuleHandleW(std::ptr::null()),
        lpszClassName: CLASS.as_ptr(),
        ..Default::default()
    };
    // Class is shared between successive backend generations. Re-registration
    // returning zero is fine; CreateWindow validates whether it exists.
    RegisterClassW(&class);
    let hwnd = CreateWindowExW(
        0,
        CLASS.as_ptr(),
        CLASS.as_ptr(),
        0,
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        std::ptr::null_mut(),
        class.hInstance,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        logs.write("desktop.log", "notification sink unavailable");
        return;
    }
    let mut callbacks = Box::<Callbacks>::default();
    SetWindowLongPtrW(
        hwnd,
        GWLP_USERDATA,
        (&mut *callbacks as *mut Callbacks) as isize,
    );
    let mut active: HashMap<u32, Notice> = HashMap::new();
    let mut watermark = 0;
    let mut next_id: u32 = 1;
    let mut reported_failure = false;
    loop {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, hwnd, 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        for id in std::mem::take(&mut callbacks.clicked) {
            if let Some(notice) = active.remove(&id) {
                Shell_NotifyIconW(NIM_DELETE, &base(hwnd, id));
                navigate(&app, port, &notice);
            }
        }
        for id in std::mem::take(&mut callbacks.closed) {
            if active.remove(&id).is_some() {
                Shell_NotifyIconW(NIM_DELETE, &base(hwnd, id));
            }
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(frame) => {
                let expired: Vec<_> = active
                    .iter()
                    .filter(|(_, n)| {
                        !frame.feed.enabled
                            || !frame.feed.items.iter().any(|r| r.revision == n.revision)
                    })
                    .map(|(id, _)| *id)
                    .collect();
                for id in expired {
                    active.remove(&id);
                    Shell_NotifyIconW(NIM_DELETE, &base(hwnd, id));
                }
                let suppressed = frame.foreground || foreground(&app);
                for notice in consume(&frame.feed, &mut watermark, suppressed) {
                    // Windows may suppress/replace alerts under user policy. A
                    // successful API return means submitted, never delivered.
                    if active.len() >= 4 {
                        continue;
                    }
                    let id = next_id;
                    next_id = next_id.wrapping_add(1).max(1);
                    if show(hwnd, id, &notice.kind) {
                        active.insert(id, notice);
                    } else if !reported_failure {
                        logs.write(
                            "desktop.log",
                            "notification submission unavailable; use task recovery page",
                        );
                        reported_failure = true;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    for id in active.keys() {
        Shell_NotifyIconW(NIM_DELETE, &base(hwnd, *id));
    }
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    DestroyWindow(hwnd);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_identity_and_metadata() {
        assert!(valid_id("session-123_abc"));
        for value in ["", "x');alert(1)//", "../other", "会话"] {
            assert!(!valid_id(value));
        }
        assert!(!valid_id(&"x".repeat(129)));
        assert!(title("completed").is_some());
        assert!(title("PRIVATE_PROVIDER_ERROR").is_none());
        let mut text = [0u16; 4];
        put(&mut text, "12345");
        assert_eq!(text, [49, 50, 51, 0]);
    }
    #[test]
    fn suppression_and_polling_never_replay_alerts() {
        let mut watermark = 0;
        let mut feed = Feed {
            revision: 1,
            enabled: true,
            items: vec![Notice {
                revision: 1,
                session_id: "task".into(),
                kind: "completed".into(),
            }],
        };
        assert!(consume(&feed, &mut watermark, true).is_empty());
        assert!(
            consume(&feed, &mut watermark, false).is_empty(),
            "foreground completion stays silent after focus changes"
        );
        feed.revision = 2;
        feed.items[0].revision = 2;
        assert_eq!(consume(&feed, &mut watermark, false).len(), 1);
        assert!(
            consume(&feed, &mut watermark, false).is_empty(),
            "repeat poll is silent"
        );
        feed.enabled = false;
        feed.revision = 3;
        feed.items[0].revision = 3;
        assert!(consume(&feed, &mut watermark, false).is_empty());
        feed.enabled = true;
        assert!(
            consume(&feed, &mut watermark, false).is_empty(),
            "reenabling stays silent"
        );
    }
}
