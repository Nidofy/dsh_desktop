//! User-confirmed cleanup of desktop-owned records, never native sessions or projects.
//! The supervisor invokes apply only after the old engine/job has fully stopped.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::Storage::FileSystem::*;
type Result<T> = std::result::Result<T, String>;
const MAX_ENTRIES: usize = 10000;
const MAX_GROUP_FILES: usize = 4096;
const CATEGORIES: [(&str, &str); 8] = [
    ("measurements", "诊断采集记录"),
    ("probes", "缓存探针报告"),
    ("self-tests", "自检报告"),
    ("changes", "任务差异比较基线"),
    ("actions", "项目操作记录与日志"),
    ("exports", "文件导出临时副本"),
    ("fixtures", "自检遗留工作目录"),
    ("snapshots", "文件恢复快照与备份"),
];
fn hex(value: &str, n: usize) -> bool {
    value.len() == n
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn uuid(value: &str) -> bool {
    value.len() == 36
        && value
            .split('-')
            .zip([8, 4, 4, 4, 12])
            .all(|(p, n)| hex(p, n))
        && value.split('-').count() == 5
}
fn info(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION> {
    let mut m = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut m) } == 0 {
        return Err("无法读取存储文件身份".into());
    }
    Ok(m)
}
fn timestamp(t: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}
fn stamp(m: &BY_HANDLE_FILE_INFORMATION) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}",
        m.dwVolumeSerialNumber,
        m.nFileIndexHigh,
        m.nFileIndexLow,
        m.nFileSizeHigh,
        m.nFileSizeLow,
        timestamp(m.ftLastWriteTime),
        timestamp(m.ftCreationTime)
    )
}
fn modified(m: &BY_HANDLE_FILE_INFORMATION) -> u64 {
    timestamp(m.ftLastWriteTime).saturating_sub(116444736000000000) / 10000
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn open(path: &Path, directory: bool, delete: bool, stable: bool) -> Result<File> {
    let file = OpenOptions::new()
        .access_mode(FILE_GENERIC_READ | if delete { DELETE } else { 0 })
        .share_mode(if delete && !directory {
            0
        } else {
            FILE_SHARE_READ | FILE_SHARE_WRITE | if stable { 0 } else { FILE_SHARE_DELETE }
        })
        .custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    0
                },
        )
        .open(path)
        .map_err(|_| "目录或记录正被占用，或不可读取")?;
    let m = info(&file)?;
    if (m.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        || m.dwFileAttributes
            & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_ENCRYPTED)
            != 0
        || (!directory && m.nNumberOfLinks != 1)
    {
        return Err("拒绝链接、硬链接、离线或非普通存储项".into());
    }
    if !directory {
        crate::task_snapshots::unnamed_stream_only(&file)
            .map_err(|_| "存储项含附加数据流或无法检查")?;
    }
    Ok(file)
}
// Mutation pins ancestors against rename/deletion. Preview permits rotation,
// so it cannot block a live engine's atomic report replacement/cleanup.
pub(crate) fn pin(path: &Path, stable: bool) -> Result<Vec<File>> {
    if !path.is_absolute() {
        return Err("存储目录必须为本机绝对路径".into());
    }
    let mut cursor = PathBuf::new();
    let mut handles = vec![];
    for part in path.components() {
        match part {
            Component::Prefix(p) => {
                if !matches!(
                    p.kind(),
                    std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)
                ) {
                    return Err("仅支持本机存储目录".into());
                }
                cursor.push(part.as_os_str());
                continue;
            }
            Component::RootDir | Component::Normal(_) => cursor.push(part.as_os_str()),
            _ => return Err("目录不能包含相对跳转".into()),
        }
        handles.push(open(&cursor, true, false, stable)?);
    }
    Ok(handles)
}
fn names(path: &Path, budget: &mut usize) -> Result<Vec<String>> {
    let mut out = vec![];
    for entry in fs::read_dir(path).map_err(|_| "无法枚举存储目录")? {
        *budget += 1;
        if *budget > MAX_ENTRIES {
            return Err("存储扫描超过 10000 项，请先人工归档".into());
        }
        let n = entry
            .map_err(|_| "无法读取存储条目")?
            .file_name()
            .into_string()
            .map_err(|_| "无法识别存储名称")?;
        out.push(n);
    }
    out.sort();
    Ok(out)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub category: String,
    pub label: String,
    pub bytes: u64,
    pub files: usize,
    pub modified_at: u64,
    pub token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub rows: Vec<Row>,
    pub managed_bytes: u64,
    pub warnings: Vec<String>,
    pub cutoff_ms: u64,
    pub home: String,
}
struct Entry {
    relative: String,
    file: File,
    directory: bool,
}
struct Group {
    row: Row,
    entries: Vec<Entry>,
    _pins: Vec<File>,
}
fn walk(
    base: &Path,
    relative: &str,
    delete: bool,
    entries: &mut Vec<Entry>,
    budget: &mut usize,
    depth: usize,
) -> Result<()> {
    if depth > 16 || entries.len() >= MAX_GROUP_FILES {
        return Err("单份记录过深或超过 4096 项".into());
    }
    let path = base.join(relative);
    let meta = fs::symlink_metadata(&path).map_err(|_| "记录在扫描期间变化")?;
    let directory = meta.is_dir();
    let file = open(&path, directory, delete, delete)?;
    entries.push(Entry {
        relative: relative.into(),
        file,
        directory,
    });
    if directory {
        for name in names(&path, budget)? {
            walk(
                base,
                &format!("{relative}/{name}"),
                delete,
                entries,
                budget,
                depth + 1,
            )?;
        }
    }
    Ok(())
}
fn group(home: &Path, category: &str, id: &str, delete: bool, budget: &mut usize) -> Result<Group> {
    let mut entries = vec![];
    let root = match category {
        "measurements" => "desktop-measurements",
        "probes" => "desktop-cache-probes",
        "self-tests" => "desktop-self-tests/reports",
        "changes" => "desktop-changes",
        "actions" => "desktop-actions",
        "exports" => "desktop-artifact-exports",
        "fixtures" => "desktop-self-tests/fixtures",
        "snapshots" => "desktop-task-snapshots",
        _ => return Err("存储类别无效".into()),
    };
    let base = home.join(root);
    let pins = pin(&base, delete)?;
    if category == "actions" {
        let (key, run) = id.split_once('/').ok_or("操作记录编号无效")?;
        if !hex(key, 64) || !uuid(run) {
            return Err("操作记录编号无效".into());
        }
        let additional = pin(&base.join(key).join("runs"), delete)?;
        for ext in ["json", "log"] {
            let rel = format!("{key}/runs/{run}.{ext}");
            if base.join(&rel).try_exists().map_err(|_| "记录不可访问")? {
                walk(&base, &rel, delete, &mut entries, budget, 0)?;
            }
        }
        if entries.iter().any(|e| e.directory) {
            return Err("操作记录不是普通文件".into());
        }
        if entries.is_empty() {
            return Err("记录已不存在".into());
        }
        // Keep nested parent pins alive until all deletions finish.
        let mut all = pins;
        all.extend(additional);
        return finish(home, category, id, entries, all);
    }
    if category == "snapshots" {
        if !hex(id, 32) {
            return Err("快照编号无效".into());
        }
    } else if !uuid(id) {
        return Err("存储编号无效".into());
    }
    let relative = match category {
        "fixtures" | "snapshots" => id.to_string(),
        "exports" => format!("{id}.tmp"),
        _ => format!("{id}.json"),
    };
    walk(&base, &relative, delete, &mut entries, budget, 0)?;
    if !["fixtures", "snapshots"].contains(&category) && entries.iter().any(|e| e.directory) {
        return Err("报告不是普通文件".into());
    }
    if category == "fixtures" {
        let owned = entries
            .iter_mut()
            .find(|e| e.relative == format!("{id}/.owned") && !e.directory)
            .ok_or("目录缺少自检身份标记，保留原样")?;
        let mut text = String::new();
        (&mut owned.file)
            .take(100)
            .read_to_string(&mut text)
            .map_err(|_| "自检身份标记无法读取")?;
        if text != id {
            return Err("自检身份标记不匹配，保留原样".into());
        }
        // Keep ownership evidence until all other descendants have been removed.
        let index = entries
            .iter()
            .position(|e| e.relative == format!("{id}/.owned"))
            .unwrap();
        let marker = entries.remove(index);
        entries.insert(1, marker);
    }
    finish(home, category, id, entries, pins)
}
fn finish(
    home: &Path,
    category: &str,
    id: &str,
    entries: Vec<Entry>,
    pins: Vec<File>,
) -> Result<Group> {
    let mut hash = Sha256::new();
    hash.update(b"desktop-storage-v1\0");
    hash.update(home.as_os_str().to_string_lossy().as_bytes());
    hash.update(category);
    hash.update(id);
    // Ancestor identity makes a same-content replaced profile/category stale.
    for f in &pins {
        let m = info(f)?;
        hash.update(format!(
            "{}:{}:{}",
            m.dwVolumeSerialNumber, m.nFileIndexHigh, m.nFileIndexLow
        ));
    }
    let (mut bytes, mut files, mut modified_at) = (0, 0, 0);
    for e in &entries {
        let m = info(&e.file)?;
        hash.update(&e.relative);
        hash.update(stamp(&m));
        modified_at = modified_at.max(modified(&m));
        if !e.directory {
            bytes += ((m.nFileSizeHigh as u64) << 32) | m.nFileSizeLow as u64;
            files += 1;
        }
    }
    Ok(Group {
        row: Row {
            id: id.into(),
            category: category.into(),
            label: CATEGORIES
                .iter()
                .find(|c| c.0 == category)
                .unwrap()
                .1
                .into(),
            bytes,
            files,
            modified_at,
            token: format!("{:x}", hash.finalize()),
        },
        entries,
        _pins: pins,
    })
}
fn category_dir(category: &str) -> &'static str {
    match category {
        "measurements" => "desktop-measurements",
        "probes" => "desktop-cache-probes",
        "self-tests" => "desktop-self-tests/reports",
        "changes" => "desktop-changes",
        "actions" => "desktop-actions",
        "exports" => "desktop-artifact-exports",
        "fixtures" => "desktop-self-tests/fixtures",
        _ => "desktop-task-snapshots",
    }
}
pub fn inspect(home: &Path, days: u32) -> Result<Inventory> {
    if ![0, 1, 7, 30, 90].contains(&days) {
        return Err("保留天数无效".into());
    }
    let cutoff = now().saturating_sub(days as u64 * 86400000);
    let (mut rows, mut warnings, mut total, mut budget) = (vec![], vec![], 0, 0);
    if !home.try_exists().map_err(|_| "存储目录不可访问")? {
        return Ok(Inventory {
            rows,
            managed_bytes: 0,
            warnings,
            cutoff_ms: cutoff,
            home: home.display().to_string(),
        });
    }
    let _home = pin(home, false)?;
    for (category, label) in CATEGORIES {
        let result = (|| -> Result<()> {
            let base = home.join(category_dir(category));
            if !base.try_exists().map_err(|_| "目录不可访问")? {
                return Ok(());
            }
            let _base = pin(&base, false)?;
            let mut ids = vec![];
            for name in names(&base, &mut budget)? {
                if category == "actions" && hex(&name, 64) {
                    let runs = base.join(&name).join("runs");
                    if runs.try_exists().map_err(|_| "记录目录不可访问")? {
                        let _runs = pin(&runs, false)?;
                        for file in names(&runs, &mut budget)? {
                            if let Some(id) = file.strip_suffix(".json").filter(|id| uuid(id)) {
                                ids.push(format!("{name}/{id}"));
                            }
                        }
                    }
                } else if (category == "fixtures" && uuid(&name))
                    || (category == "snapshots" && hex(&name, 32))
                {
                    ids.push(name);
                } else if let Some(id) = name
                    .strip_suffix(if category == "exports" {
                        ".tmp"
                    } else {
                        ".json"
                    })
                    .filter(|id| uuid(id))
                {
                    ids.push(id.into());
                }
            }
            for id in ids {
                match group(home, category, &id, false, &mut budget) {
                    Ok(g) => {
                        total += g.row.bytes;
                        if g.row.modified_at <= cutoff {
                            rows.push(g.row);
                        }
                    }
                    Err(e) => warnings.push(format!("{label} / {id}：{e}")),
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            warnings.push(format!("{label}：{e}"));
        }
    }
    rows.sort_by_key(|r| r.modified_at);
    Ok(Inventory {
        rows,
        managed_bytes: total,
        warnings,
        cutoff_ms: cutoff,
        home: home.display().to_string(),
    })
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub category: String,
    pub id: String,
    pub token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub category: String,
    pub id: String,
    pub status: String,
    pub deleted_files: usize,
    pub freed_bytes: u64,
    pub message: String,
}
pub fn apply(home: &Path, selection: Vec<Selection>) -> Result<Vec<Receipt>> {
    if selection.is_empty() || selection.len() > 200 {
        return Err("每次选择 1–200 份记录".into());
    }
    let mut seen = std::collections::HashSet::new();
    for s in &selection {
        if !seen.insert((&s.category, &s.id)) || !hex(&s.token, 64) {
            return Err("重复或无效清理选择".into());
        }
    }
    let mut receipts = vec![];
    for s in selection {
        let mut r = Receipt {
            category: s.category.clone(),
            id: s.id.clone(),
            status: "REFUSED".into(),
            deleted_files: 0,
            freed_bytes: 0,
            message: String::new(),
        };
        let result = (|| -> Result<()> {
            let mut budget = 0;
            let g = group(home, &s.category, &s.id, true, &mut budget)?;
            if g.row.token != s.token {
                return Err("预览后记录或目录已变化，请重新扫描".into());
            }
            // Handles are exclusive for files; parents stay pinned throughout.
            // Reverse pre-order deletes children before their directory handles.
            for entry in g.entries.into_iter().rev() {
                let meta = info(&entry.file)?;
                let mut disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
                if unsafe {
                    SetFileInformationByHandle(
                        entry.file.as_raw_handle(),
                        FileDispositionInfo,
                        (&mut disposition as *mut FILE_DISPOSITION_INFO).cast(),
                        std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
                    )
                } == 0
                {
                    return Err("清理未全部完成；已处理记录不自动重试，请重新扫描".into());
                }
                drop(entry.file);
                if !entry.directory {
                    r.deleted_files += 1;
                    r.freed_bytes += ((meta.nFileSizeHigh as u64) << 32) | meta.nFileSizeLow as u64;
                }
            }
            r.status = "DELETED".into();
            Ok(())
        })();
        if let Err(e) = result {
            r.message = e;
            if r.deleted_files > 0 {
                r.status = "PARTIAL".into();
            }
        } else {
            r.message = "已永久清理所选记录".into();
        }
        receipts.push(r);
    }
    Ok(receipts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    const ID: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    fn home() -> PathBuf {
        let p = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build")
            .join(format!(
                "storage-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn put(home: &Path, path: &str, value: &str) {
        let p = home.join(path);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, value).unwrap();
    }
    fn selected(home: &Path, category: &str) -> Selection {
        let row = inspect(home, 0)
            .unwrap()
            .rows
            .into_iter()
            .find(|r| r.category == category)
            .unwrap();
        Selection {
            category: row.category,
            id: row.id,
            token: row.token,
        }
    }
    #[test]
    fn storage_selection_only_deletes_desktop_records() {
        let h = home();
        for category in ["measurements", "probes", "self-tests", "changes"] {
            put(
                &h,
                &format!("{}/{ID}.json", category_dir(category)),
                "synthetic",
            );
        }
        put(&h, &format!("desktop-artifact-exports/{ID}.tmp"), "export");
        put(&h, "sessions/keep.json", "native history");
        put(&h, "settings.yaml", "settings");
        put(&h, "desktop-cache-capabilities.json", "declarations");
        let rows = inspect(&h, 0).unwrap();
        assert_eq!(rows.rows.len(), 5);
        assert!(inspect(&h, 7).unwrap().rows.is_empty());
        let receipts = apply(
            &h,
            vec![selected(&h, "measurements"), selected(&h, "exports")],
        )
        .unwrap();
        assert!(receipts.iter().all(|r| r.status == "DELETED"));
        assert_eq!(inspect(&h, 0).unwrap().rows.len(), 3);
        assert_eq!(
            fs::read_to_string(h.join("sessions/keep.json")).unwrap(),
            "native history"
        );
        assert!(h.join("settings.yaml").exists());
        assert!(h.join("desktop-cache-capabilities.json").exists());
        assert_eq!(
            apply(
                &h,
                vec![Selection {
                    category: "sessions".into(),
                    id: ID.into(),
                    token: "0".repeat(64)
                }]
            )
            .unwrap()[0]
                .status,
            "REFUSED"
        );
    }
    #[test]
    fn storage_changed_file_and_replaced_identity_refuse() {
        let h = home();
        let p = format!("desktop-measurements/{ID}.json");
        put(&h, &p, "original");
        let s = selected(&h, "measurements");
        put(&h, &p, "changed and larger");
        assert_eq!(apply(&h, vec![s]).unwrap()[0].status, "REFUSED");
        let s = selected(&h, "measurements");
        fs::rename(h.join(&p), h.join("old.json")).unwrap();
        put(&h, &p, "changed and larger");
        assert_eq!(apply(&h, vec![s]).unwrap()[0].status, "REFUSED");
        assert!(h.join(p).exists());
    }
    #[test]
    fn storage_preview_does_not_block_live_atomic_rotation() {
        let h = home();
        let p = format!("desktop-measurements/{ID}.json");
        put(&h, &p, "original");
        let preview = group(&h, "measurements", ID, false, &mut 0).unwrap();
        let s = Selection {
            category: "measurements".into(),
            id: ID.into(),
            token: preview.row.token.clone(),
        };
        fs::rename(h.join(&p), h.join("rotated.json")).unwrap();
        put(&h, &p, "replacement");
        drop(preview);
        assert_eq!(apply(&h, vec![s]).unwrap()[0].status, "REFUSED");
        assert_eq!(fs::read_to_string(h.join(p)).unwrap(), "replacement");
    }
    #[test]
    fn storage_actions_pair_and_fixture_tree_are_complete() {
        let h = home();
        let key = "f".repeat(64);
        let base = format!("desktop-actions/{key}");
        put(&h, &format!("{base}/config.json"), "config");
        put(&h, &format!("{base}/trust.json"), "trust");
        for ext in ["json", "log"] {
            put(&h, &format!("{base}/runs/{ID}.{ext}"), "record");
        }
        let f = format!("desktop-self-tests/fixtures/{ID}");
        put(&h, &format!("{f}/.owned"), ID);
        put(&h, &format!("{f}/git/.git/index"), "synthetic vcs");
        put(&h, &format!("{f}/workspace/output.txt"), "synthetic output");
        let snapshot = "a".repeat(32);
        put(
            &h,
            &format!("desktop-task-snapshots/{snapshot}/before-0.bin"),
            "snapshot",
        );
        let receipts = apply(
            &h,
            vec![
                selected(&h, "actions"),
                selected(&h, "fixtures"),
                selected(&h, "snapshots"),
            ],
        )
        .unwrap();
        assert!(
            receipts.iter().all(|r| r.status == "DELETED"),
            "{}",
            serde_json::to_string(&receipts).unwrap()
        );
        assert!(!h.join(f).exists());
        assert!(!h
            .join(format!("desktop-task-snapshots/{snapshot}"))
            .exists());
        assert!(h.join(format!("{base}/config.json")).exists());
        assert!(h.join(format!("{base}/trust.json")).exists());
    }
    #[test]
    fn storage_ownership_links_streams_and_busy_files_refuse() {
        let h = home();
        let fixture = format!("desktop-self-tests/fixtures/{ID}");
        put(&h, &format!("{fixture}/.owned"), "wrong");
        assert!(inspect(&h, 0).unwrap().rows.is_empty());
        assert!(!inspect(&h, 0).unwrap().warnings.is_empty());
        let p = format!("desktop-measurements/{ID}.json");
        put(&h, &p, "original");
        let s = selected(&h, "measurements");
        let busy = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(h.join(&p))
            .unwrap();
        assert_eq!(apply(&h, vec![s]).unwrap()[0].status, "REFUSED");
        drop(busy);
        fs::hard_link(h.join(&p), h.join("outside-hardlink")).unwrap();
        assert!(inspect(&h, 0).unwrap().rows.is_empty());
        fs::remove_file(h.join("outside-hardlink")).unwrap();
        put(&h, &format!("{p}:secret"), "stream");
        assert!(inspect(&h, 0).unwrap().rows.is_empty());
        assert!(h.join(p).exists());
    }
    #[test]
    fn storage_partial_cleanup_retains_ownership_and_has_no_replay() {
        let h = home();
        let f = format!("desktop-self-tests/fixtures/{ID}");
        put(&h, &format!("{f}/.owned"), ID);
        put(&h, &format!("{f}/a.txt"), "read only");
        put(&h, &format!("{f}/z.txt"), "delete first");
        let mut permissions = fs::metadata(h.join(&f).join("a.txt"))
            .unwrap()
            .permissions();
        permissions.set_readonly(true);
        fs::set_permissions(h.join(&f).join("a.txt"), permissions).unwrap();
        let s = selected(&h, "fixtures");
        let r = apply(&h, vec![s.clone()]).unwrap();
        assert_eq!(r[0].status, "PARTIAL");
        assert_eq!(r[0].deleted_files, 1);
        assert!(h.join(&f).join(".owned").exists());
        assert!(!h.join(&f).join("z.txt").exists());
        assert_eq!(apply(&h, vec![s]).unwrap()[0].status, "REFUSED");
    }
    #[test]
    fn storage_junctions_never_touch_outside_records() {
        let h = home();
        let outside = home();
        put(&outside, "keep.txt", "outside");
        let f = h.join("desktop-self-tests").join("fixtures").join(ID);
        fs::create_dir_all(&f).unwrap();
        fs::write(f.join(".owned"), ID).unwrap();
        let status = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(f.join("linked"))
            .arg(&outside)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "junction fixture: {}",
            String::from_utf8_lossy(&status.stderr)
        );
        assert!(inspect(&h, 0).unwrap().rows.is_empty());
        assert_eq!(
            fs::read_to_string(outside.join("keep.txt")).unwrap(),
            "outside"
        );
        let forged = Selection {
            category: "fixtures".into(),
            id: "../escape".into(),
            token: "a".repeat(64),
        };
        assert_eq!(apply(&h, vec![forged]).unwrap()[0].status, "REFUSED");
    }
}
