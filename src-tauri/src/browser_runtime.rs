use crate::logging::Logs;
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

#[link(name = "ntdll")]
extern "system" {
    fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
}

#[derive(Clone)]
pub struct BrowserRuntime {
    pub folder: PathBuf,
    pub version: String,
    pub windows_version: String,
}

pub fn windows_version() -> Result<(u32, u32, u32), String> {
    let mut info = OSVERSIONINFOW::default();
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    if unsafe { RtlGetVersion(&mut info) } < 0 {
        return Err("无法读取 Windows 版本。".into());
    }
    Ok((info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber))
}

pub fn validate_folder(folder: &Path) -> Result<(), String> {
    // Fixed Version cannot run from UNC/network shares. Use the full local package.
    let value = folder.to_string_lossy();
    if value.starts_with(r"\\") && !value.starts_with(r"\\?\") || value.starts_with(r"\\?\UNC\") {
        return Err(
            "请将完整压缩包解压到本机磁盘后启动，WebView2 不支持从网络共享目录运行。".into(),
        );
    }
    for name in [
        "msedgewebview2.exe",
        "msedge.dll",
        "icudtl.dat",
        "resources.pak",
    ] {
        if !folder.join(name).is_file() {
            return Err(format!("随包 WebView2 文件缺失：{name}\n请完整解压新版免安装包，保留 resources\\webview2 目录，不要单独复制 EXE。"));
        }
    }
    Ok(())
}

// Required by Microsoft's Fixed Version 120+ distribution guidance on Windows 10.
// Grant only read/execute to the two AppContainer groups, only on our browser tree.
// Run as the current user; never request elevation or disable the browser sandbox.
pub fn grant_appcontainer_read(folder: &Path) -> Result<(), String> {
    let icacls = PathBuf::from(std::env::var_os("SystemRoot").ok_or("SystemRoot is unavailable")?)
        .join("System32/icacls.exe");
    let mut child = Command::new(icacls)
        .arg(folder)
        .args([
            "/grant",
            "*S-1-15-2-1:(OI)(CI)(RX)",
            "*S-1-15-2-2:(OI)(CI)(RX)",
            "/Q",
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法设置 WebView2 沙箱目录读取权限。请解压到当前用户可写的本机目录。")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err("无法设置 WebView2 沙箱目录读取权限。请将完整压缩包解压到当前用户拥有的本机目录（例如下载目录），不要使用 Program Files 或网络共享。".into()),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill(); let _ = child.wait();
                return Err("设置 WebView2 沙箱目录读取权限失败或超时。请重新解压到当前用户拥有的本机目录。".into());
            }
        }
    }
}

pub fn prepare() -> Result<BrowserRuntime, String> {
    let exe = std::env::current_exe().map_err(|_| "无法确定程序目录。")?;
    let folder = exe
        .parent()
        .ok_or("无法确定程序目录。")?
        .join("resources/webview2");
    validate_folder(&folder)?;
    let (major, minor, build) = windows_version()?;
    if major < 10 {
        return Err("此版本需要 Windows 10 或 Windows 11 的 64 位系统。".into());
    }
    if major == 10 && build < 22000 {
        grant_appcontainer_read(&folder)?;
    }
    // Must precede Tauri Runtime creation, including its installed-runtime probe.
    // This deliberately overrides stale inherited paths; it never falls back to Evergreen.
    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &folder);
    let version = tauri::webview_version().map_err(|_| "无法加载随包 WebView2。请确认已完整解压，且企业应用策略允许 resources\\webview2 中的微软运行文件。")?;
    let pins: serde_json::Value =
        serde_json::from_str(include_str!("../../versions.json")).map_err(|_| "版本配置损坏。")?;
    if Some(version.as_str()) != pins["webview2"].as_str() {
        return Err(format!(
            "WebView2 版本与免安装包不匹配（检测到 {version}）。请重新解压完整的新版本。"
        ));
    }
    let runtime = BrowserRuntime {
        folder,
        version,
        windows_version: format!("Windows {major}.{minor} build {build}"),
    };
    write_startup_log(&format!(
        "webview2=fixed version={} path={} os={}",
        runtime.version,
        runtime.folder.display(),
        runtime.windows_version
    ));
    Ok(runtime)
}

pub fn write_startup_log(message: &str) {
    if let Ok(root) = crate::environments::root() {
        if let Ok(logs) = Logs::new(&root) {
            logs.write("desktop.log", message);
        }
    }
}

pub fn show_startup_error(message: &str) {
    write_startup_log(message);
    let body: Vec<u16> = format!(
        "DSHDesktop 启动失败\n\n{message}\n\n日志：%LOCALAPPDATA%\\DSHDesktop\\logs\\desktop.log"
    )
    .encode_utf16()
    .chain(Some(0))
    .collect();
    let title: Vec<u16> = "DSHDesktop — 启动诊断"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            0x10,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn rejects_missing_or_network_browser_without_using_system_runtime() {
        assert!(validate_folder(Path::new(r"\\server\share\resources\webview2")).is_err());
        assert!(validate_folder(Path::new(r"\\?\UNC\server\share\webview2")).is_err());
        let path =
            std::env::temp_dir().join(format!("dsh-browser-preflight-{}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        assert!(validate_folder(&path).is_err());
        fs::remove_dir(&path).unwrap();
    }
    #[test]
    fn appcontainer_read_access_can_be_granted_without_elevation() {
        let path = std::env::temp_dir().join(format!("dsh-browser-acl-{}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("probe.txt"), "read-only browser fixture").unwrap();
        grant_appcontainer_read(&path).unwrap();
        assert_eq!(
            fs::read_to_string(path.join("probe.txt")).unwrap(),
            "read-only browser fixture"
        );
        fs::remove_file(path.join("probe.txt")).unwrap();
        fs::remove_dir(path).unwrap();
    }
}
