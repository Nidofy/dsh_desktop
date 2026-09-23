use crate::pet_config::{self, Config, Instance};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::Mutex,
    time::Instant,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
pub struct Controller {
    pub root: PathBuf,
    pub settings: Mutex<Config>,
    pub frame: Mutex<(Value, Instant)>,
    pub assets_lock: Mutex<()>,
    assignments: Mutex<HashMap<String, Value>>,
    seen: Mutex<VecDeque<String>>,
    dragging: Mutex<HashMap<String, (tauri::PhysicalPosition<f64>, tauri::PhysicalPosition<i32>)>>,
    pub warning: Option<String>,
    future: bool,
}
impl Controller {
    pub fn new(root: PathBuf) -> Self {
        let loaded = pet_config::load(&root);
        Self {
            root,
            settings: Mutex::new(loaded.config),
            frame: Mutex::new((json!({"items":[]}), Instant::now())),
            assets_lock: Mutex::new(()),
            assignments: Mutex::new(HashMap::new()),
            seen: Mutex::new(VecDeque::new()),
            dragging: Mutex::new(HashMap::new()),
            warning: loaded.warning,
            future: loaded.future,
        }
    }
    pub fn save(&self, s: &Config) -> Result<(), String> {
        if self.future {
            return Err("已保留未知版本或不可备份的原配置，未覆盖".into());
        }
        pet_config::save(&self.root, s)
    }
}
pub fn enabled(app: &tauri::AppHandle) -> bool {
    app.try_state::<Controller>().is_some_and(|c| {
        c.settings
            .lock()
            .is_ok_and(|s| s.enabled && s.instances.iter().any(|p| p.enabled))
    })
}
pub fn cursor(app: &tauri::AppHandle) -> String {
    let Some(c) = app.try_state::<Controller>() else {
        return String::new();
    };
    let Ok(f) = c.frame.lock() else {
        return String::new();
    };
    if f.1.elapsed().as_secs() > 4 {
        return String::new();
    }
    let generation = f.0["generation"].as_str().unwrap_or("");
    if !generation
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return String::new();
    }
    format!(
        "&petAfter={}&petGeneration={}",
        f.0["revision"].as_u64().unwrap_or(0),
        generation
    )
}
fn merge_frame(previous: &Value, mut incoming: Value) -> Option<Value> {
    if incoming["generation"] == previous["generation"]
        && incoming["revision"].as_u64()? < previous["revision"].as_u64().unwrap_or(0)
    {
        return None;
    }
    if incoming["full"] == false {
        if incoming["generation"] != previous["generation"] {
            return None;
        }
        let mut rows = previous["items"].as_array()?.clone();
        for row in incoming["items"].as_array()? {
            rows.retain(|r| r["sessionId"] != row["sessionId"]);
            rows.push(row.clone());
        }
        if rows.len() > 32 {
            return None;
        }
        incoming["items"] = json!(rows);
    }
    Some(incoming)
}
pub fn closed(app: &tauri::AppHandle, label: &str) {
    if let Some(c) = app.try_state::<Controller>() {
        if let Ok(mut s) = c.settings.lock() {
            if let Some(p) = s
                .instances
                .iter_mut()
                .find(|p| format!("pet-{}", p.id) == label)
            {
                p.enabled = false;
            }
            let _ = c.save(&s);
        }
    }
}
fn score(row: &Value, now: u64, duration: u64) -> u32 {
    match row["status"].as_str().unwrap_or("") {
        "WAITING_PERMISSION" | "WAITING_INPUT" => 5,
        "BLOCKED" | "LIMIT_REACHED" => 4,
        "COMPLETED" | "FAILED"
            if row["notify"] == true
                && now.saturating_sub(row["at"].as_u64().unwrap_or(0)) < duration =>
        {
            3
        }
        "RUNNING" => 2,
        _ => 0,
    }
}
pub fn allocate(
    config: &Config,
    frame: &Value,
    previous: &HashMap<String, Value>,
    now: u64,
) -> HashMap<String, Value> {
    let rows = frame["items"].as_array().cloned().unwrap_or_default();
    let mut output = HashMap::new();
    let mut used = HashSet::new();
    for p in config.instances.iter().filter(|p| p.enabled) {
        if p.profile.as_deref() == frame["profile"].as_str() {
            if let Some(row) = rows
                .iter()
                .find(|r| Some(r["sessionId"].as_str().unwrap_or("")) == p.pinned.as_deref())
            {
                used.insert(row["sessionId"].as_str().unwrap_or("").to_string());
                output.insert(p.id.clone(), row.clone());
            }
        }
    }
    for p in config.instances.iter().filter(|p| p.enabled) {
        if output.contains_key(&p.id) {
            continue;
        }
        let mut available = rows
            .iter()
            .filter(|r| {
                score(r, now, p.bubble.duration_ms) > 0
                    && !used.contains(r["sessionId"].as_str().unwrap_or(""))
            })
            .collect::<Vec<_>>();
        available.sort_by(|a, b| {
            score(b, now, p.bubble.duration_ms)
                .cmp(&score(a, now, p.bubble.duration_ms))
                .then_with(|| a["sessionId"].as_str().cmp(&b["sessionId"].as_str()))
        });
        let mut best = available.first().copied();
        if let Some(old) = previous.get(&p.id) {
            if let Some(stable) = available.iter().find(|r| {
                r["sessionId"] == old["sessionId"]
                    && best.is_some_and(|b| {
                        score(r, now, p.bubble.duration_ms) >= score(b, now, p.bubble.duration_ms)
                    })
            }) {
                best = Some(*stable);
            }
        }
        if let Some(row) = best {
            used.insert(row["sessionId"].as_str().unwrap_or("").to_string());
            output.insert(p.id.clone(), row.clone());
        }
    }
    output
}
fn presentation(frame: &Value, row: Option<&Value>) -> Value {
    json!({"profile":frame["profile"],"port":frame["port"],"generation":frame["generation"],"revision":frame["revision"],"items":row.map(|r|vec![r.clone()]).unwrap_or_default()})
}
fn target_current(
    target: &Value,
    frame: &Value,
    age: u64,
    health: &str,
    profile: &str,
    port: Option<u16>,
) -> bool {
    age <= 5
        && health == "ready"
        && target["generation"] == frame["generation"]
        && target["profile"] == profile
        && target["port"] == json!(port)
        && frame["items"]
            .as_array()
            .is_some_and(|rows| rows.iter().any(|r| r["sessionId"] == target["sessionId"]))
}
pub fn update(app: &tauri::AppHandle, port: u16, mut value: Value) {
    let Some(c) = app.try_state::<Controller>() else {
        return;
    };
    if !enabled(app) {
        return;
    }
    let engine = app.state::<crate::engine::Engine>();
    let Ok(state) = engine.state.lock() else {
        return;
    };
    if state.backend_port != Some(port) || state.backend_health != "ready" {
        return;
    }
    value["profile"] = json!(state.active_profile_id);
    value["port"] = json!(port);
    drop(state);
    let config = c.settings.lock().unwrap().clone();
    let mut old = c.frame.lock().unwrap();
    let Some(value) = merge_frame(&old.0, value) else {
        return;
    };
    let new_generation =
        old.0["generation"] != value["generation"] || old.0["profile"] != value["profile"];
    let mut assigned = c.assignments.lock().unwrap();
    let mut seen = c.seen.lock().unwrap();
    if new_generation {
        assigned.clear();
        seen.clear();
    }
    let mut next = allocate(&config, &value, &assigned, pet_config::now());
    let mut notice_owners = HashSet::new();
    for p in &config.instances {
        if let Some(row) = next.get_mut(&p.id) {
            let key = format!(
                "{}:{}:{}",
                value["generation"], row["sessionId"], row["seq"]
            );
            if new_generation || seen.contains(&key) {
                row["reaction"] = Value::Null;
            } else if !row["reaction"].is_null() {
                seen.push_back(key);
                while seen.len() > 256 {
                    seen.pop_front();
                }
            }
            row["suppressNotice"] = json!(!notice_owners.insert(row["sessionId"].to_string()));
        }
    }
    *assigned = next.clone();
    *old = (value.clone(), Instant::now());
    drop(old);
    drop(assigned);
    drop(seen);
    for p in config.instances.iter().filter(|p| p.enabled) {
        if let Some(w) = app.get_webview_window(&format!("pet-{}", p.id)) {
            let _ = w.emit("pet-state", presentation(&value, next.get(&p.id)));
        }
    }
}
fn position(window: &tauri::WebviewWindow, s: &Instance) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|_| "显示器不可用")?;
    let Some(m) = monitors
        .iter()
        .find(|m| m.name().cloned() == s.monitor)
        .or_else(|| monitors.first())
    else {
        return Ok(());
    };
    let area = m.work_area();
    let factor = m.scale_factor();
    let size = window.outer_size().map_err(|_| "窗口尺寸不可用")?;
    let x = (area.position.x as f64 + s.x * factor).clamp(
        area.position.x as f64,
        (area.position.x as f64 + area.size.width as f64 - size.width as f64)
            .max(area.position.x as f64),
    );
    let y = (area.position.y as f64 + s.y * factor).clamp(
        area.position.y as f64,
        (area.position.y as f64 + area.size.height as f64 - size.height as f64)
            .max(area.position.y as f64),
    );
    window
        .set_position(tauri::PhysicalPosition::new(x as i32, y as i32))
        .map_err(|_| "无法恢复桌宠位置".into())
}
pub fn reconcile(app: &tauri::AppHandle) -> Result<(), String> {
    let c = app.state::<Controller>();
    let config = c.settings.lock().unwrap().clone();
    let wanted = config
        .instances
        .iter()
        .filter(|p| config.enabled && p.enabled)
        .map(|p| format!("pet-{}", p.id))
        .collect::<HashSet<_>>();
    for (label, w) in app.webview_windows() {
        if label.starts_with("pet-") && !wanted.contains(&label) {
            let _ = w.destroy();
        }
    }
    for p in config
        .instances
        .iter()
        .filter(|p| config.enabled && p.enabled)
    {
        let label = format!("pet-{}", p.id);
        let w = if let Some(w) = app.get_webview_window(&label) {
            w
        } else {
            let window =
                WebviewWindowBuilder::new(app, &label, WebviewUrl::App("pet/index.html".into()))
                    .data_directory(c.root.join("pet-webview"))
                    .title("吃白饭的大肥鱼")
                    .inner_size(240. * p.scale, 208. * p.scale)
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .focused(false)
                    .visible(false)
                    .on_navigation(|u| {
                        matches!(u.host_str(), Some("localhost" | "tauri.localhost"))
                            && matches!(u.scheme(), "http" | "tauri")
                    })
                    .build()
                    .map_err(|_| "桌宠窗口无法打开")?;
            // App menus otherwise add an invisible native menu inset to this
            // undecorated window and expose unrelated global shortcuts.
            window.remove_menu().map_err(|_| "桌宠菜单无法移除")?;
            crate::browser_runtime::write_startup_log("pet local window created");
            window
        };
        if p.resource == "xiaojing" {
            let _ = w.set_title("吃白饭的大肥鱼");
        }
        let _ = w.set_size(tauri::LogicalSize::new(240. * p.scale, 256. * p.scale));
        position(&w, p)?;
        w.show().map_err(|_| "桌宠窗口无法显示")?;
        let _ = w.emit("pet-settings", p);
    }
    Ok(())
}
pub fn open(app: &tauri::AppHandle) -> Result<(), String> {
    reconcile(app)
}
#[tauri::command]
pub fn pet_ready(window: tauri::WebviewWindow, decoded: bool) {
    if window.label().starts_with("pet-") {
        crate::browser_runtime::write_startup_log(if decoded {
            "pet production atlas decoded in native window"
        } else {
            "pet production module loaded"
        });
    }
}
#[tauri::command]
pub async fn pet_settings(
    app: tauri::AppHandle,
    settings: Option<Config>,
    base: Option<Config>,
    reset_positions: Option<Vec<String>>,
    reset_moods: Option<Vec<String>>,
) -> Result<Value, String> {
    // WebView2 creation from a synchronous IPC command deadlocks the Windows
    // event loop (including Quit). Keep native window work off that thread.
    tauri::async_runtime::spawn_blocking(move || {
        apply_settings(app, settings, base, reset_positions, reset_moods)
    })
    .await
    .map_err(|_| "桌宠设置未完成，请重试".to_string())?
}
fn apply_settings(
    app: tauri::AppHandle,
    settings: Option<Config>,
    base: Option<Config>,
    reset_positions: Option<Vec<String>>,
    reset_moods: Option<Vec<String>>,
) -> Result<Value, String> {
    let c = app.state::<Controller>();
    if let Some(s) = settings {
        let mut current = c.settings.lock().unwrap();
        let mut s = if let Some(base) = base {
            pet_config::merge(&current, &base, &s)?
        } else {
            s
        };
        for (ids, position) in [
            (reset_positions.unwrap_or_default(), true),
            (reset_moods.unwrap_or_default(), false),
        ] {
            if ids.len() > 3 {
                return Err("重置实例数量无效".into());
            }
            for id in ids {
                let p = s
                    .instances
                    .iter_mut()
                    .find(|p| p.id == id)
                    .ok_or("实例已删除")?;
                if position {
                    p.x = 60.;
                    p.y = 120.;
                    p.monitor = None;
                    p.pinned = None;
                    p.profile = None;
                } else {
                    p.affinity = 0;
                    p.mood = "normal".into();
                    p.last_interaction_ms = 0;
                }
            }
        }
        s.validate()?;
        c.save(&s)?;
        *current = s;
        drop(current);
        reconcile(&app)?;
    }
    let s = c.settings.lock().unwrap().clone();
    Ok(json!({"config":s,"warning":c.warning}))
}
#[tauri::command]
pub fn pet_snapshot(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    let c = app.state::<Controller>();
    let id = window.label().strip_prefix("pet-").ok_or("桌宠窗口无效")?;
    let settings = c
        .settings
        .lock()
        .unwrap()
        .instances
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("桌宠实例已删除")?;
    let frame = c.frame.lock().unwrap();
    let rows = c.assignments.lock().unwrap();
    Ok(
        json!({"doubleMs":unsafe{windows_sys::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime()},"settings":settings,"state":if frame.1.elapsed().as_secs()<5{presentation(&frame.0,rows.get(id))}else{json!({"items":[],"offline":true})}}),
    )
}
#[tauri::command]
pub async fn pet_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    target: Option<Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply_action(app,window,action,target)).await.map_err(|_|"桌宠操作未完成".to_string())?
}
fn apply_action(app:tauri::AppHandle,window:tauri::WebviewWindow,action:String,target:Option<Value>)->Result<(),String>{
    let id = window.label().strip_prefix("pet-").ok_or("桌宠窗口无效")?;
    let c = app.state::<Controller>();
    if ["navigate", "pin"].contains(&action.as_str()) {
        let target = target.ok_or("会话不可用")?;
        let frame = c.frame.lock().unwrap();
        let engine = app.state::<crate::engine::Engine>();
        let state = engine.state.lock().unwrap();
        let session = target["sessionId"]
            .as_str()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            })
            .ok_or("会话不可用")?;
        if !target_current(
            &target,
            &frame.0,
            frame.1.elapsed().as_secs(),
            &state.backend_health,
            &state.active_profile_id,
            state.backend_port,
        ) {
            return Err("会话状态已更新，请重新选择".into());
        }
        let profile = state.active_profile_id.clone();
        drop(state);
        drop(frame);
        if action == "pin" {
            let mut config = c.settings.lock().unwrap();
            let p = config
                .instances
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("实例已删除")?;
            p.pinned = Some(session.into());
            p.profile = Some(profile);
            let changed = p.clone();
            c.save(&config)?;
            let _ = window.emit("pet-settings", changed);
            return Ok(());
        }
        if let Some(w) = app.get_webview_window("main") {
            let payload = json!({"sessionId":session,"requestId":format!("pet-{}-{}",id,target["generation"])});
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            w.eval(&format!("window.dispatchEvent(new CustomEvent('dsh-desktop-open-session',{{detail:{payload}}}));")).map_err(|_|"会话无法打开")?;
        }
        return Ok(());
    }
    if action == "drag" {
        let origin=window.outer_position().map_err(|_|"窗口位置不可用")?;
        // IPC can arrive after a fast pointer has already reached its endpoint.
        // Preserve the actual pointer-down client location instead of sampling
        // the late global cursor as the starting position.
        let anchor=target.as_ref().ok_or("拖动起点缺失")?;
        let x=anchor["x"].as_f64().filter(|v|v.is_finite()&&*v>=0.&&*v<=4096.).ok_or("拖动起点无效")?;
        let y=anchor["y"].as_f64().filter(|v|v.is_finite()&&*v>=0.&&*v<=4096.).ok_or("拖动起点无效")?;
        let factor=window.scale_factor().map_err(|_|"窗口比例不可用")?;
        let client=window.inner_position().map_err(|_|"窗口位置不可用")?;
        let cursor=tauri::PhysicalPosition::new(client.x as f64+x*factor,client.y as f64+y*factor);
        c.dragging.lock().unwrap().insert(id.into(),(cursor,origin));
        return Ok(());
    }
    if action == "drag-move" {
        // Sample only in response to this window's captured pointer events.
        // Physical coordinates avoid mixed-DPI CSS/screen coordinate conversion.
        if let Some((cursor,origin))=c.dragging.lock().unwrap().get(id).copied(){
            let current=window.cursor_position().map_err(|_|"指针位置不可用")?;
            window.set_position(tauri::PhysicalPosition::new(origin.x+(current.x-cursor.x).round() as i32,origin.y+(current.y-cursor.y).round() as i32)).map_err(|_|"窗口移动失败")?;
        }
        return Ok(());
    }
    if action=="drag-end" {c.dragging.lock().unwrap().remove(id);}
    let mut config = c.settings.lock().unwrap();
    let p = config
        .instances
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("实例已删除")?;
    match action.as_str() {
        "bubble-size" => {
            let height = target
                .as_ref()
                .and_then(|t| t["height"].as_u64())
                .filter(|h| *h <= 160)
                .ok_or("气泡尺寸无效")?;
            if c.dragging.lock().unwrap().contains_key(id){return Ok(());}
            // Preserve the current physical position instead of snapping back
            // to the last persisted position whenever a bubble is measured.
            if let (Ok(pos), Ok(Some(m)))=(window.outer_position(),window.current_monitor()){
                p.x=(pos.x-m.work_area().position.x) as f64/m.scale_factor();
                p.y=(pos.y-m.work_area().position.y) as f64/m.scale_factor();p.monitor=m.name().cloned();
            }
            window
                .set_size(tauri::LogicalSize::new(
                    240. * p.scale,
                    (208. + height as f64) * p.scale,
                ))
                .map_err(|_| "气泡尺寸不可用")?;
            return position(&window, p);
        }
        "position" | "drag-end" => {
            if let (Ok(pos), Ok(Some(m))) = (window.outer_position(), window.current_monitor()) {
                p.x = (pos.x - m.work_area().position.x) as f64 / m.scale_factor();
                p.y = (pos.y - m.work_area().position.y) as f64 / m.scale_factor();
                p.monitor = m.name().cloned();
                position(&window, p)?;
            }
        }
        "hide" => {
            p.enabled = false;
        }
        "unpin" => {
            p.pinned = None;
            p.profile = None;
        }
        "interact" => {
            if !pet_config::interact(p, pet_config::now()) {
                return Ok(());
            }
        }
        _ => return Err("不支持的桌宠操作".into()),
    }
    let changed = p.clone();
    c.save(&config)?;
    drop(config);
    if action == "hide" {
        let _ = window.destroy();
    } else {
        let _ = window.emit("pet-settings", changed);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delta_merge_rejects_old_revision_and_wrong_epoch() {
        let f =
            json!({"generation":"a","revision":2,"items":[{"sessionId":"s","status":"RUNNING"}]});
        let d = json!({"generation":"a","revision":3,"full":false,"items":[{"sessionId":"s","status":"WAITING_INPUT"}]});
        assert_eq!(
            merge_frame(&f, d).unwrap()["items"][0]["status"],
            "WAITING_INPUT"
        );
        assert!(merge_frame(&f, json!({"generation":"a","revision":1})).is_none());
        assert!(merge_frame(
            &f,
            json!({"generation":"b","revision":3,"full":false,"items":[]})
        )
        .is_none());
    }
    #[test]
    fn stale_navigation_never_crosses_profile_engine_or_missing_session() {
        let f = json!({"generation":"a","items":[{"sessionId":"s"}]});
        let t = json!({"generation":"a","profile":"p","port":1,"sessionId":"s"});
        assert!(target_current(&t, &f, 1, "ready", "p", Some(1)));
        assert!(!target_current(&t, &f, 6, "ready", "p", Some(1)));
        assert!(!target_current(&t, &f, 1, "ready", "other", Some(1)));
        assert!(!target_current(&t, &f, 1, "ready", "p", Some(2)));
        assert!(!target_current(&t, &f, 1, "failed", "p", Some(1)));
        assert!(!target_current(
            &t,
            &json!({"generation":"b","items":[]}),
            1,
            "ready",
            "p",
            Some(1)
        ));
    }
    #[test]
    fn allocation_is_distinct_wait_first_and_stable() {
        let mut c = Config::default();
        c.instances.push(Instance {
            id: "2".into(),
            ..Default::default()
        });
        c.instances.push(Instance {
            id: "3".into(),
            ..Default::default()
        });
        let f = json!({"profile":"p","items":[{"sessionId":"a","status":"RUNNING"},{"sessionId":"b","status":"WAITING_INPUT"},{"sessionId":"c","status":"CANCELLED"}]});
        let a = allocate(&c, &f, &HashMap::new(), 10000);
        assert_eq!(a["1"]["sessionId"], "b");
        assert_eq!(a["2"]["sessionId"], "a");
        assert!(!a.contains_key("3"));
        assert_eq!(allocate(&c, &f, &a, 10001), a);
        c.instances[0].pinned = Some("a".into());
        c.instances[0].profile = Some("p".into());
        assert_eq!(allocate(&c, &f, &a, 10002)["1"]["sessionId"], "a");
    }
}
