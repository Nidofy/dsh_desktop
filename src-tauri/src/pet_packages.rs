use crate::engine::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::windows::{fs::MetadataExt, process::CommandExt},
    path::{Component, Path},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
#[tauri::command]
pub async fn pet_pick(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::UI::Controls::Dialogs::*;
    let owner = window.hwnd().map_err(|_| "设置窗口不可用")?.0 as usize;
    tauri::async_runtime::spawn_blocking(move || {
        let mut buffer = vec![0u16; 32768];
        let title = "选择 ZIP 或资源目录中的 pet.json\0"
            .encode_utf16()
            .collect::<Vec<_>>();
        let filter = "宠物资源\0*.zip;pet.json\0\0"
            .encode_utf16()
            .collect::<Vec<_>>();
        let mut d: OPENFILENAMEW = unsafe { std::mem::zeroed() };
        d.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
        d.hwndOwner = owner as _;
        d.lpstrFile = buffer.as_mut_ptr();
        d.nMaxFile = buffer.len() as u32;
        d.lpstrTitle = title.as_ptr();
        d.lpstrFilter = filter.as_ptr();
        d.Flags = OFN_EXPLORER
            | OFN_FILEMUSTEXIST
            | OFN_PATHMUSTEXIST
            | OFN_NOCHANGEDIR
            | OFN_DONTADDTORECENT;
        if unsafe { GetOpenFileNameW(&mut d) } == 0 {
            return None;
        }
        let end = buffer.iter().position(|v| *v == 0)?;
        let p = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..end]));
        let p = if p.file_name().is_some_and(|n| n == "pet.json") {
            p.parent()?.to_path_buf()
        } else {
            p
        };
        Some(p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "资源选择窗口已关闭".into())
}
// Reject Windows links/reparse points along the selected path and entire input tree.
fn ordinary(path: &Path, recursive: bool) -> Result<(), String> {
    if !path.is_absolute() || path.to_string_lossy().starts_with("\\\\") {
        return Err("请选择本机绝对路径".into());
    }
    let mut current = std::path::PathBuf::new();
    for part in path.components() {
        if matches!(part, Component::ParentDir) {
            return Err("路径不能包含父目录跳转".into());
        }
        current.push(part.as_os_str());
        if current.as_os_str().len() > 3 {
            let m = fs::symlink_metadata(&current).map_err(|_| "路径不可读")?;
            if m.file_attributes() & 0x400 != 0 {
                return Err("不支持链接或重解析点".into());
            }
        }
    }
    if recursive && path.is_dir() {
        let mut queue = vec![path.to_path_buf()];
        let mut count = 0;
        while let Some(dir) = queue.pop() {
            for entry in fs::read_dir(dir).map_err(|_| "目录不可读")? {
                count += 1;
                if count > 256 {
                    return Err("资源条目超过 256".into());
                }
                let e = entry.map_err(|_| "资源不可读")?;
                let m = fs::symlink_metadata(e.path()).map_err(|_| "资源不可读")?;
                if m.file_attributes() & 0x400 != 0 {
                    return Err("不支持链接或重解析点".into());
                }
                if m.is_dir() {
                    queue.push(e.path());
                }
            }
        }
    }
    Ok(())
}
pub fn run(engine: &Engine, mut request: Value) -> Result<Value, String> {
    let library = engine.root.join("pet-resources");
    if library.exists() {
        ordinary(&library, false)?;
    }
    if let Some(source) = request["source"].as_str() {
        ordinary(Path::new(source), true)?;
    }
    if let Some(destination) = request["destination"].as_str() {
        ordinary(Path::new(destination), false)?;
    }
    let resources = engine
        .state
        .lock()
        .map_err(|_| "引擎状态不可用")?
        .runtime_path
        .clone();
    request["home"] = json!(engine.root);
    request["resources"] = json!(resources);
    let mut child = Command::new(Path::new(&resources).join("runtime/node.exe"))
        .arg(Path::new(&resources).join("pet-packages.mjs"))
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "资源校验器无法启动")?;
    let _job = crate::process::Job::new(&child)?;
    let bytes = serde_json::to_vec(&request).map_err(|_| "资源请求无效")?;
    child
        .stdin
        .take()
        .ok_or("资源校验输入不可用")?
        .write_all(&bytes)
        .map_err(|_| "资源校验请求失败")?;
    let out = child.stdout.take().ok_or("资源校验输出不可用")?;
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = out.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes);
        let _ = tx.send((result, bytes));
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    while child.try_wait().map_err(|_| "资源校验进程异常")?.is_none() {
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("资源校验超时".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let (result, bytes) = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "资源校验无回执")?;
    result.map_err(|_| "资源校验输出异常")?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("资源回执过大".into());
    }
    let result: Value = serde_json::from_slice(&bytes).map_err(|_| "资源校验结果无效")?;
    if result["ok"] != true {
        return Err(result["error"].as_str().unwrap_or("资源校验失败").into());
    }
    Ok(result["value"].clone())
}
#[tauri::command]
pub async fn pet_packages(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    let engine = app.state::<Engine>().inner().clone();
    let owner = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let c = owner.state::<crate::pets::Controller>();
        let _lock = c.assets_lock.lock().map_err(|_| "资源操作忙碌")?;
        if !["list", "preview", "import", "delete", "export"]
            .contains(&request["action"].as_str().unwrap_or(""))
        {
            return Err("资源操作无效".into());
        }
        let result = run(&engine, request.clone())?;
        if request["action"] == "delete" {
            let mut config = c.settings.lock().map_err(|_| "桌宠配置不可用")?;
            for p in &mut config.instances {
                if request["resourceId"] == p.resource {
                    p.resource = "xiaojing".into();
                }
            }
            c.save(&config)?;
            drop(config);
            crate::pets::reconcile(&owner)?;
        }
        if request["action"] == "import" {
            let config = c.settings.lock().map_err(|_| "桌宠配置不可用")?;
            for p in &config.instances {
                if result["id"] == p.resource {
                    if let Some(w) = owner.get_webview_window(&format!("pet-{}", p.id)) {
                        let _ = w.emit("pet-resource-changed", &p.resource);
                    }
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| "资源操作未确认，请刷新列表".to_string())?
}
#[tauri::command]
pub async fn pet_resource(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    let c = app.state::<crate::pets::Controller>();
    let id = window.label().strip_prefix("pet-").ok_or("桌宠窗口无效")?;
    let resource = c
        .settings
        .lock()
        .map_err(|_| "桌宠配置不可用")?
        .instances
        .iter()
        .find(|p| p.id == id)
        .ok_or("桌宠实例已删除")?
        .resource
        .clone();
    let engine = app.state::<Engine>().inner().clone();
    let owner = app.clone();
    let instance = id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let result = run(&engine, json!({"action":"asset","resourceId":resource}))?;
        let c = owner.state::<crate::pets::Controller>();
        if c.settings.lock().is_ok_and(|s| {
            s.instances
                .iter()
                .any(|p| p.id == instance && p.resource == resource)
        }) {
            if let Some(title) = result["displayName"].as_str() {
                let _ = window.set_title(title);
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| "资源读取中断".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escape_and_relative_paths_are_rejected() {
        assert!(ordinary(Path::new("../x"), false).is_err());
        assert!(ordinary(Path::new("\\\\server\\share"), false).is_err());
    }
}
