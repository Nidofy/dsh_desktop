use std::{
    os::windows::ffi::OsStringExt,
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::HWND,
    UI::Controls::Dialogs::{
        GetSaveFileNameW, OFN_DONTADDTORECENT, OFN_EXPLORER, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT,
        OFN_PATHMUSTEXIST, OPENFILENAMEW,
    },
};

pub fn is_artifact_export(url: &url::Url) -> bool {
    let values: Vec<_> = url.query_pairs().collect();
    url.path() == "/desktop-diagnostics/api/export"
        && values.len() == 1
        && values[0].0 == "artifact"
        && values[0].1.len() == 36
        && values[0].1.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn suggested_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("DSH-artifact.bin");
    let value: String = raw
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(200)
        .collect();
    let value = value.trim_end_matches([' ', '.']);
    if value.is_empty() {
        "DSH-artifact.bin".into()
    } else {
        value.into()
    }
}

/// The WebView performs the authenticated download; this dialog selects its
/// destination. Cancellation returns false to WebView and writes no file.
pub fn save_destination(owner: HWND, suggested: &Path) -> Option<PathBuf> {
    let mut buffer = vec![0u16; 32768];
    let name: Vec<_> = suggested_name(suggested).encode_utf16().collect();
    buffer[..name.len()].copy_from_slice(&name);
    let title: Vec<_> = "另存产物文件\0".encode_utf16().collect();
    let filter: Vec<_> = "所有文件\0*.*\0\0".encode_utf16().collect();
    let mut dialog: OPENFILENAMEW = unsafe { std::mem::zeroed() };
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.hwndOwner = owner;
    dialog.lpstrFile = buffer.as_mut_ptr();
    dialog.nMaxFile = buffer.len() as u32;
    dialog.lpstrTitle = title.as_ptr();
    dialog.lpstrFilter = filter.as_ptr();
    dialog.Flags = OFN_EXPLORER
        | OFN_PATHMUSTEXIST
        | OFN_OVERWRITEPROMPT
        | OFN_NOCHANGEDIR
        | OFN_DONTADDTORECENT;
    if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
        return None;
    }
    let end = buffer.iter().position(|c| *c == 0)?;
    let path = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..end]));
    path.is_absolute().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_opaque_artifact_exports_use_native_save() {
        let base = "http://127.0.0.1:9123/desktop-diagnostics/api/export";
        assert!(is_artifact_export(
            &url::Url::parse(&format!(
                "{base}?artifact=12345678-1234-1234-1234-123456789abc"
            ))
            .unwrap()
        ));
        for suffix in [
            "",
            "?artifact=../file",
            "?artifact=",
            "?artifact=12345678-1234-1234-1234-123456789abc&path=C:/secret",
            "?artifact=12345678-1234-1234-1234-123456789abc&artifact=duplicate",
        ] {
            assert!(!is_artifact_export(
                &url::Url::parse(&format!("{base}{suffix}")).unwrap()
            ));
        }
        assert_eq!(suggested_name(Path::new("C:/tmp/报告.csv")), "报告.csv");
        assert_eq!(
            suggested_name(Path::new("C:/tmp/bad\nname.txt")),
            "badname.txt"
        );
    }
}
