//! User-operated, explicitly scoped content snapshots. No Git/Hg history edits.
//! Workspace writes are only exposed to the packaged local settings window;
//! this is deliberately not an agent tool or a remote WebView capability.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND},
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    Storage::FileSystem::*,
};
mod archive;
mod details;

const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_CAPTURE: usize = 32 * 1024 * 1024;
const MAX_STORE: u64 = 256 * 1024 * 1024;
const MAX_PATHS: usize = 128;
type Result<T> = std::result::Result<T, String>;
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn random_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    if unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            16,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    } != 0
    {
        return Err("无法生成快照编号".into());
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value
            .chars()
            .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
        && value.split('/').all(|part| {
            let lower = part.to_lowercase();
            let stem = lower.split('.').next().unwrap_or("");
            !part.is_empty()
                && !part.ends_with(['.', ' '])
                && ![".", "..", ".git", ".hg"].contains(&lower.as_str())
                && !["con", "prn", "aux", "nul", "conin$", "conout$"].contains(&stem)
                && !(stem.starts_with("com") || stem.starts_with("lpt"))
                    .then(|| stem.chars().skip(3).collect::<String>())
                    .is_some_and(|suffix| {
                        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"]
                            .contains(&suffix.as_str())
                    })
        })
}
fn info(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION> {
    let mut result = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut result) } == 0 {
        return Err("无法读取文件身份".into());
    }
    Ok(result)
}
fn identity(info: &BY_HANDLE_FILE_INFORMATION) -> String {
    format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    )
}
fn reject_vcs_metadata(file: &File) -> Result<()> {
    // Resolve by handle so an NTFS short-name alias cannot hide .git/.hg.
    let mut name = vec![0u16; 32768];
    let size = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            name.as_mut_ptr(),
            name.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    } as usize;
    if size == 0 || size >= name.len() {
        return Err("无法确认文件的真实路径".into());
    }
    let path =
        PathBuf::from(String::from_utf16(&name[..size]).map_err(|_| "不支持的文件路径编码")?);
    if path.components().any(|p| matches!(p,Component::Normal(name) if [".git",".hg"].contains(&name.to_string_lossy().to_lowercase().as_str()))) {
        return Err("快照不读取或修改 Git/Hg 元数据".into());
    }
    Ok(())
}
fn changed(info: &BY_HANDLE_FILE_INFORMATION) -> u64 {
    ((info.ftLastWriteTime.dwHighDateTime as u64) << 32) | info.ftLastWriteTime.dwLowDateTime as u64
}
fn is_missing(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(code) if code == ERROR_FILE_NOT_FOUND as i32 || code == ERROR_PATH_NOT_FOUND as i32)
}

/// Deny delete/rename on ancestors and write handles on the selected parent.
/// Above-parent directories use attribute access so a short restore operation
/// does not lock unrelated directory operations across the entire drive.
/// Pins live through final file close, including on failure.
struct PinnedDirs {
    _handles: Vec<File>,
    path: PathBuf,
    identity: String,
}
fn pin_dirs(path: &Path) -> Result<PinnedDirs> {
    pin_dirs_mode(path, true)
}
fn pin_dirs_mode(path: &Path, lock_leaf_writes: bool) -> Result<PinnedDirs> {
    if !path.is_absolute() {
        return Err("需要本机绝对目录".into());
    }
    let mut handles = Vec::new();
    let mut cursor = PathBuf::new();
    let mut last = String::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                if !matches!(
                    prefix.kind(),
                    std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)
                ) {
                    return Err("快照仅支持本机磁盘".into());
                }
                cursor.push(component.as_os_str());
                continue;
            }
            Component::RootDir => cursor.push(component.as_os_str()),
            Component::Normal(_) => cursor.push(component.as_os_str()),
            _ => return Err("目录路径不能含相对跳转".into()),
        }
        let leaf = cursor == path && lock_leaf_writes;
        let file = OpenOptions::new()
            .access_mode(if leaf {
                FILE_GENERIC_READ
            } else {
                FILE_READ_ATTRIBUTES
            })
            .share_mode(if leaf {
                FILE_SHARE_READ
            } else {
                FILE_SHARE_READ | FILE_SHARE_WRITE
            })
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&cursor)
            .map_err(|_| "目录被占用、不可访问或不支持锁定")?;
        let meta = info(&file)?;
        reject_vcs_metadata(&file)?;
        if meta.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
            || meta.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("快照不接受目录链接或重解析点".into());
        }
        last = identity(&meta);
        handles.push(file);
    }
    if handles.is_empty() {
        return Err("目录无效".into());
    }
    Ok(PinnedDirs {
        _handles: handles,
        path: path.to_path_buf(),
        identity: last,
    })
}
fn workspace(path: &Path) -> Result<PinnedDirs> {
    workspace_mode(path, true)
}
fn workspace_mode(path: &Path, lock_leaf_writes: bool) -> Result<PinnedDirs> {
    if !path.is_absolute() {
        return Err("需要本机绝对工作区路径".into());
    }
    let resolved = fs::canonicalize(path).map_err(|_| "工作区不存在")?;
    let pinned = pin_dirs_mode(&resolved, lock_leaf_writes)?;
    let root: PathBuf = resolved.components().take(2).collect();
    let wide: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
    // DRIVE_FIXED = 3 (GetDriveTypeW); avoid adding WindowsProgramming bindings.
    if unsafe { GetDriveTypeW(wide.as_ptr()) } != 3 {
        return Err("快照当前仅支持本机固定磁盘".into());
    }
    Ok(pinned)
}
fn file_open(path: &Path, writable: bool, create: bool) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    if writable {
        options
            .read(true)
            .write(true)
            .access_mode(FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE)
            .share_mode(0);
    } else {
        options.read(true).share_mode(FILE_SHARE_READ);
    }
    options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    if create {
        options.create_new(true);
    }
    options.open(path)
}
fn bytes(file: &mut File) -> Result<Vec<u8>> {
    let meta = info(file)?;
    reject_vcs_metadata(file)?;
    if meta.dwFileAttributes
        & (FILE_ATTRIBUTE_REPARSE_POINT
            | FILE_ATTRIBUTE_DIRECTORY
            | FILE_ATTRIBUTE_ENCRYPTED
            | FILE_ATTRIBUTE_OFFLINE)
        != 0
        || meta.nNumberOfLinks != 1
    {
        return Err("仅支持普通文件；链接、目录、硬链接不能恢复".into());
    }
    unnamed_stream_only(file)?;
    if meta.nFileSizeHigh != 0 || meta.nFileSizeLow as usize > MAX_FILE {
        return Err("单个文件超过 8 MiB".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| "无法定位文件")?;
    let mut data = Vec::new();
    file.take(MAX_FILE as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|_| "无法读取文件")?;
    if data.len() > MAX_FILE {
        return Err("文件超过大小上限".into());
    }
    Ok(data)
}
pub(crate) fn unnamed_stream_only(file: &File) -> Result<()> {
    // Named streams must not be silently dropped by restoring a deleted file.
    // The query is against the already pinned handle, never a fresh path open.
    let mut buffer = [0u64; 2048];
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStreamInfo,
            buffer.as_mut_ptr().cast(),
            std::mem::size_of_val(&buffer) as u32,
        )
    } == 0
    {
        return Err("当前文件系统无法安全检查附加数据流".into());
    }
    let data = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), std::mem::size_of_val(&buffer))
    };
    let next = u32::from_le_bytes(data[0..4].try_into().unwrap());
    let size = u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize;
    let offset = std::mem::offset_of!(FILE_STREAM_INFO, StreamName);
    if next != 0 || size % 2 != 0 || offset + size > data.len() {
        return Err("附加数据流不在快照范围内，拒绝自动恢复".into());
    }
    let name: Vec<u16> = data[offset..offset + size]
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect();
    if String::from_utf16(&name).ok().as_deref() != Some("::$DATA") {
        return Err("附加数据流不在快照范围内，拒绝自动恢复".into());
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum State {
    Absent,
    File {
        hash: String,
        size: usize,
        identity: String,
        modified: u64,
    },
}
fn state(file: &File, data: &[u8]) -> Result<State> {
    let meta = info(file)?;
    Ok(State::File {
        hash: hash(data),
        size: data.len(),
        identity: identity(&meta),
        modified: changed(&meta),
    })
}
fn equal_content(a: &State, b: &State) -> bool {
    match (a, b) {
        (State::Absent, State::Absent) => true,
        (State::File { hash: a, .. }, State::File { hash: b, .. }) => a == b,
        _ => false,
    }
}
fn original_bytes(dir: &Path, index: usize, expected: &State) -> Result<Vec<u8>> {
    let State::File {
        hash: expected_hash,
        size,
        ..
    } = expected
    else {
        return Ok(Vec::new());
    };
    let mut file = file_open(&dir.join(format!("before-{index}.bin")), false, false)
        .map_err(|_| "原始内容备份不可读")?;
    let data = bytes(&mut file)?;
    if data.len() != *size || hash(&data) != *expected_hash {
        return Err("原始内容备份校验失败；没有修改此文件".into());
    }
    Ok(data)
}
fn inspect(root: &Path, path: &str) -> Result<(State, Vec<u8>)> {
    let target = root.join(path);
    let _parents = pin_dirs(target.parent().ok_or("文件路径无效")?)?;
    match file_open(&target, false, false) {
        Ok(mut file) => {
            let data = bytes(&mut file)?;
            Ok((state(&file, &data)?, data))
        }
        Err(error) if is_missing(&error) => Ok((State::Absent, Vec::new())),
        Err(_) => Err("文件正在写入、被占用或无法读取".into()),
    }
}
fn write_new(path: &Path, data: &[u8]) -> Result<()> {
    let mut file =
        file_open(path, true, true).map_err(|_| "无法创建快照记录（已有记录不会覆盖）")?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|_| "快照记录未能完整写入；未自动删除残留")?;
    Ok(())
}
fn json_new(path: &Path, value: &impl Serialize) -> Result<()> {
    write_new(
        path,
        &serde_json::to_vec(value).map_err(|_| "快照序列化失败")?,
    )
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let mut file = file_open(path, false, false).map_err(|_| "快照记录不存在或被占用")?;
    let data = bytes(&mut file)?;
    if data.len() > 256 * 1024 {
        return Err("快照记录超过大小上限".into());
    }
    serde_json::from_slice(&data).map_err(|_| "快照记录损坏；保留原数据等待检查".into())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    path: String,
    state: State,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u32,
    id: String,
    root: PathBuf,
    root_identity: String,
    created_at: u64,
    entries: Vec<Entry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    task: Option<TaskCapture>,
}
/// Native-only lifecycle contract. This is intentionally absent from Request:
/// only the supervisor may call it after checking a user-armed scope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskBinding {
    pub session_id: String,
    pub turn: u64,
    pub engine_id: String,
    pub request_id: String,
}
impl TaskBinding {
    fn validate(&self) -> Result<()> {
        if self.session_id.is_empty()
            || self.session_id.len() > 256
            || self.session_id.chars().any(char::is_control)
            || self.turn > 9_007_199_254_740_991
            || !hex(&self.engine_id, 32)
            || !hex(&self.request_id, 32)
        {
            return Err("任务快照身份无效".into());
        }
        Ok(())
    }
    fn snapshot_id(&self) -> String {
        // Engine and request are deliberately excluded: a restarted engine must
        // not overwrite the original attempt for the same session/turn.
        hash(&serde_json::to_vec(&("task-snapshot-v1", &self.session_id, self.turn)).unwrap())[..32]
            .into()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskCapture {
    binding: TaskBinding,
    expires_at: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskIntent {
    task: TaskCapture,
    root: PathBuf,
    root_identity: String,
    paths: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskConfirmation {
    task: TaskCapture,
    confirmed_at: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskEndIntent {
    task: TaskBinding,
    expires_at: u64,
}
fn check_deadline(expires_at: u64) -> Result<()> {
    let time = now();
    if expires_at <= time || expires_at.saturating_sub(time) > 15_000 {
        return Err("任务快照请求已过期或时间窗无效".into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    id: String,
    workspace: PathBuf,
    created_at: u64,
    count: usize,
    sealed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    task: Option<TaskBinding>,
    admission: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    path: String,
    status: String,
    message: String,
}
#[derive(Serialize)]
pub struct Preview {
    snapshot: Summary,
    rows: Vec<Row>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    path: String,
    expected: State,
    target: State,
    prepared_at: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    status: String,
    time: u64,
}

pub struct Store {
    pinned: PinnedDirs,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    id: String,
    workspace: PathBuf,
    identity: String,
    paths: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scopes {
    version: u32,
    revision: u64,
    items: Vec<Scope>,
}
fn scope_file(home: &PinnedDirs) -> PathBuf {
    home.path.join("desktop-snapshot-scopes.json")
}
fn load_scopes(home: &PinnedDirs) -> Result<Scopes> {
    let path = scope_file(home);
    if !path.try_exists().map_err(|_| "无法读取自动快照范围")? {
        return Ok(Scopes {
            version: 1,
            revision: 0,
            items: Vec::new(),
        });
    }
    let scopes: Scopes = read_json(&path)?;
    let mut ids = HashSet::new();
    let mut roots = HashSet::new();
    if scopes.version != 1
        || scopes.revision > 9_007_199_254_740_000
        || scopes.items.len() > 16
        || scopes.items.iter().any(|s| {
            !hex(&s.id, 32)
                || !ids.insert(&s.id)
                || !s.workspace.is_absolute()
                || !roots.insert(s.workspace.to_string_lossy().to_lowercase())
                || s.identity.is_empty()
                || validate_paths(&s.paths).is_err()
        })
    {
        return Err("自动快照范围配置无效".into());
    }
    Ok(scopes)
}
fn validate_paths(paths: &[String]) -> Result<()> {
    let mut seen = HashSet::new();
    if paths.is_empty()
        || paths.len() > MAX_PATHS
        || paths
            .iter()
            .any(|p| !valid_path(p) || !seen.insert(p.to_lowercase()))
    {
        return Err("请选择 1–128 个不重复的相对文件路径，使用 / 分隔".into());
    }
    Ok(())
}
fn browse(root: &Path, directory: &str) -> Result<serde_json::Value> {
    if !directory.is_empty() && !valid_path(directory) {
        return Err("目录路径无效".into());
    }
    let root = workspace_mode(root, false)?;
    let folder = pin_dirs_mode(&root.path.join(directory), false)?;
    let mut rows = Vec::new();
    let mut visited = 0;
    let mut truncated = false;
    for item in fs::read_dir(&folder.path).map_err(|_| "无法读取工作区目录")? {
        visited += 1;
        if visited > 2000 {
            truncated = true;
            break;
        }
        let item = item.map_err(|_| "无法读取目录项目")?;
        let Some(name) = item.file_name().to_str().map(String::from) else {
            continue;
        };
        let path = if directory.is_empty() {
            name.clone()
        } else {
            format!("{directory}/{name}")
        };
        if !valid_path(&path) {
            continue;
        }
        let kind = item.file_type().map_err(|_| "无法检查目录项目")?;
        // Opening directories by handle also rejects junctions and short-name
        // aliases to VCS metadata. File contents are not read by the browser.
        if kind.is_dir() {
            if pin_dirs_mode(&item.path(), false).is_err() {
                continue;
            }
            rows.push(serde_json::json!({"name":name,"path":path,"kind":"directory"}));
        } else if kind.is_file() {
            let Ok(file) = file_open(&item.path(), false, false) else {
                continue;
            };
            let meta = info(&file)?;
            if reject_vcs_metadata(&file).is_err()
                || meta.dwFileAttributes
                    & (FILE_ATTRIBUTE_REPARSE_POINT
                        | FILE_ATTRIBUTE_OFFLINE
                        | FILE_ATTRIBUTE_ENCRYPTED)
                    != 0
                || meta.nNumberOfLinks != 1
            {
                continue;
            }
            let size = ((meta.nFileSizeHigh as u64) << 32) | meta.nFileSizeLow as u64;
            rows.push(serde_json::json!({"name":name,"path":path,"kind":"file","bytes":size,"selectable":size<=MAX_FILE as u64}));
        }
        if rows.len() >= 300 {
            truncated = true;
            break;
        }
    }
    rows.sort_by_key(|r| {
        (
            r["kind"] != "directory",
            r["name"].as_str().unwrap_or("").to_lowercase(),
        )
    });
    Ok(
        serde_json::json!({"workspace":root.path,"directory":directory,"rows":rows,"truncated":truncated}),
    )
}
fn save_scopes(home: &PinnedDirs, mut scopes: Scopes) -> Result<Scopes> {
    scopes.revision += 1;
    let data = serde_json::to_vec(&scopes).map_err(|_| "无法编码自动快照范围")?;
    if data.len() > 256 * 1024 {
        return Err("自动快照范围总配置超过 256 KiB".into());
    }
    let temporary = home
        .path
        .join(format!(".snapshot-scopes-{}.tmp", random_id()?));
    write_new(&temporary, &data)?;
    fs::rename(&temporary, scope_file(home)).map_err(|_| "无法提交范围配置；保留临时文件")?;
    Ok(scopes)
}
pub fn scopes(home: &Path) -> Result<Scopes> {
    load_scopes(&workspace_mode(home, false)?)
}
fn arm_scope(home: &Path, root: &Path, paths: Vec<String>, revision: u64) -> Result<Scopes> {
    validate_paths(&paths)?;
    let home = workspace_mode(home, false)?;
    let root = workspace(root)?;
    if root.path.starts_with(&home.path) || home.path.starts_with(&root.path) {
        return Err("自动快照工作区与连接存储不能互相包含".into());
    }
    let mut scopes = load_scopes(&home)?;
    if scopes.revision != revision {
        return Err("范围配置已变化，请重新载入".into());
    }
    let mut total = 0;
    for path in &paths {
        total += inspect(&root.path, path)?.1.len();
        if total > MAX_CAPTURE {
            return Err("指定范围超过 32 MiB".into());
        }
    }
    let same = scopes.items.iter().position(|s| s.workspace == root.path);
    if same.is_none() && scopes.items.len() >= 16 {
        return Err("最多启用 16 个工作区".into());
    }
    let scope = Scope {
        id: random_id()?,
        workspace: root.path.clone(),
        identity: root.identity.clone(),
        paths,
    };
    if let Some(index) = same {
        scopes.items[index] = scope;
    } else {
        scopes.items.push(scope);
    }
    save_scopes(&home, scopes)
}
fn disarm_scope(home: &Path, id: &str, revision: u64) -> Result<Scopes> {
    let home = workspace_mode(home, false)?;
    let mut scopes = load_scopes(&home)?;
    if scopes.revision != revision {
        return Err("范围配置已变化，请重新载入".into());
    }
    if !scopes.items.iter().any(|s| s.id == id) {
        return Err("指定范围已不存在".into());
    }
    scopes.items.retain(|s| s.id != id);
    save_scopes(&home, scopes)
}

/// Authority sent exclusively through inherited private pipes, never HTTP or
/// environment. Local Settings alone can arm a persistent file scope.
pub struct TaskBridge {
    pub token: String,
    pub engine_id: String,
    pub last_status: String,
    pub navigation: Option<Navigation>,
    pub quota: Option<crate::storage_quota::Quota>,
    storage_leases: std::collections::HashMap<String,crate::storage_quota::Reservation>,
    pending: std::collections::HashMap<String, (TaskBinding, String)>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Navigation { pub request_id: String, pub id: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    token: String,
    id: String,
    command: BridgeRequest,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum BridgeRequest {
    ReserveStorage { bytes:u64, #[serde(rename="expiresAt")] expires_at:u64 },
    ReleaseStorage { #[serde(rename="reservationId")] reservation_id:String },
    Open {
        id: String,
        #[serde(rename = "expiresAt")]
        expires_at: u64,
    },
    Begin {
        workspace: PathBuf,
        #[serde(rename = "sessionId")]
        session_id: String,
        turn: u64,
        #[serde(rename = "expiresAt")]
        expires_at: u64,
    },
    Confirm {
        id: String,
        binding: TaskBinding,
    },
    End {
        id: String,
        binding: TaskBinding,
        #[serde(rename = "expiresAt")]
        expires_at: u64,
    },
    Forget {
        id: String,
        binding: TaskBinding,
    },
    Abandon {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}
impl TaskBridge {
    pub fn new() -> Result<Self> {
        Ok(Self {
            token: random_id()?,
            engine_id: random_id()?,
            last_status: "当前引擎尚无自动快照结果".into(),
            navigation: None,
            quota: None,
            storage_leases: Default::default(),
            pending: Default::default(),
        })
    }
    pub fn handle(&mut self, home: &Path, line: &str, available: bool) -> Option<String> {
        let body = line.strip_prefix("dsh snapshot: ")?;
        if body.len() > 16384 {
            return None;
        }
        let request: Envelope = serde_json::from_str(body).ok()?;
        if request.token != self.token || !hex(&request.id, 32) {
            return None;
        }
        let automatic=matches!(&request.command,BridgeRequest::Begin{..}|BridgeRequest::Confirm{..}|BridgeRequest::End{..});
        let result = if available
            || matches!(
                &request.command,
                BridgeRequest::Abandon { .. } | BridgeRequest::Forget { .. } | BridgeRequest::ReleaseStorage { .. }
            ) {
            self.execute(home, &request.id, request.command)
        } else {
            Err("桌面配置或恢复操作正在进行".into())
        };
        let response = match result {
            Ok(value) => {
                match value["status"].as_str() {
                    Some("CAPTURED") => {
                        self.last_status = "最近自动快照：开始内容已采集，等待任务确认".into()
                    }
                    Some("CONFIRMED") => {
                        self.last_status = "最近自动快照：任务开始已确认，等待结束封存".into()
                    }
                    Some("SEALED") => {
                        self.last_status = "最近自动快照：已完成开始与结束记录，可载入预览".into()
                    }
                    Some("FORGOTTEN") => {
                        self.last_status =
                            "最近自动快照：任务边界未完整确认；保留备份，不自动补采".into()
                    }
                    _ => (),
                }
                serde_json::json!({"id":request.id,"ok":true,"value":value})
            }
            Err(_) => {
                if automatic { self.last_status = "最近自动快照：未能完成；请检查范围、文件占用、快照上限及所有连接存储总览。本轮可能没有可恢复快照。".into(); }
                serde_json::json!({"id":request.id,"ok":false,"error":"SNAPSHOT_UNAVAILABLE"})
            }
        };
        Some(format!("snapshot {}\n", response))
    }
    fn execute(
        &mut self,
        home: &Path,
        request_id: &str,
        request: BridgeRequest,
    ) -> Result<serde_json::Value> {
        match request {
            BridgeRequest::ReserveStorage { bytes,expires_at } => {
                check_deadline(expires_at)?;
                if self.storage_leases.contains_key(request_id){return Err("重复的存储预留请求".into());}
                let lease=self.quota.as_ref().ok_or("共享存储配额不可用")?.reserve(home,bytes)?;
                check_deadline(expires_at)?;
                self.storage_leases.insert(request_id.into(),lease);
                Ok(serde_json::json!({"status":"RESERVED","reservationId":request_id}))
            }
            BridgeRequest::ReleaseStorage { reservation_id } => {
                if !hex(&reservation_id,32){return Err("存储预留编号无效".into());}
                self.storage_leases.remove(&reservation_id);
                Ok(serde_json::json!({"status":"RELEASED"}))
            }
            BridgeRequest::Open { id, expires_at } => {
                check_deadline(expires_at)?;
                let store = Store::open(home)?;
                let start = store.record(&id, "start.json")?;
                if start.task.is_none() { return Err("所选记录不是任务快照".into()); }
                check_deadline(expires_at)?;
                self.navigation = Some(Navigation { request_id: request_id.into(), id: id.clone() });
                Ok(serde_json::json!({"status":"OPEN_REQUESTED","id":id}))
            }
            BridgeRequest::Begin {
                workspace: cwd,
                session_id,
                turn,
                expires_at,
            } => {
                check_deadline(expires_at)?;
                let scopes = scopes(home)?;
                if scopes.items.is_empty() {
                    return Ok(serde_json::json!({"status":"DISABLED"}));
                }
                let root = workspace(&cwd)?;
                let Some(scope) = scopes.items.iter().find(|s| s.workspace == root.path) else {
                    return Ok(serde_json::json!({"status":"DISABLED"}));
                };
                if scope.identity != root.identity {
                    return Err("启用范围后工作区身份已变化".into());
                }
                if self.pending.len() >= 64 {
                    return Err("活动快照超过上限".into());
                }
                let binding = TaskBinding {
                    session_id,
                    turn,
                    engine_id: self.engine_id.clone(),
                    request_id: request_id.into(),
                };
                let store = Store::open(home)?;
                let _reservation=self.quota.as_ref().map(|q|q.reserve(home,MAX_CAPTURE as u64+512*1024)).transpose()?;
                let summary = store.capture_task(
                    &root.path,
                    scope.paths.clone(),
                    binding.clone(),
                    expires_at,
                )?;
                self.pending
                    .insert(summary.id.clone(), (binding.clone(), scope.id.clone()));
                Ok(serde_json::json!({"status":"CAPTURED", "id":summary.id, "binding":binding}))
            }
            BridgeRequest::Confirm { id, binding } => {
                let (original, scope_id) = self.pending.get(&id).ok_or("本引擎没有此采集请求")?;
                if &binding != original || !scopes(home)?.items.iter().any(|s| &s.id == scope_id) {
                    return Err("快照请求或启用范围已变化".into());
                }
                let _reservation=self.quota.as_ref().map(|q|q.reserve(home,512*1024)).transpose()?;
                let summary = Store::open(home)?.confirm_task(&id, &binding)?;
                Ok(serde_json::json!({"status":"CONFIRMED", "id":summary.id}))
            }
            BridgeRequest::End {
                id,
                binding,
                expires_at,
            } => {
                let (original, _) = self.pending.get(&id).ok_or("本引擎没有此活动快照")?;
                if &binding != original {
                    return Err("快照任务身份不匹配".into());
                }
                self.pending.remove(&id);
                let _reservation=self.quota.as_ref().map(|q|q.reserve(home,512*1024)).transpose()?;
                let summary = Store::open(home)?.seal_task(&id, &binding, expires_at)?;
                Ok(serde_json::json!({"status":"SEALED", "id":summary.id}))
            }
            BridgeRequest::Forget { id, binding } => {
                if self
                    .pending
                    .get(&id)
                    .is_some_and(|(original, _)| original == &binding)
                {
                    self.pending.remove(&id);
                }
                Ok(serde_json::json!({"status":"FORGOTTEN"}))
            }
            BridgeRequest::Abandon { request_id } => {
                self.pending
                    .retain(|_, (binding, _)| binding.request_id != request_id);
                Ok(serde_json::json!({"status":"FORGOTTEN"}))
            }
        }
    }
}
impl Store {
    pub fn open(home: &Path) -> Result<Self> {
        fs::create_dir_all(home).map_err(|_| "快照存储目录不可用")?;
        let home = workspace(home)?;
        let dir = home.path.join("desktop-task-snapshots");
        if !dir.exists() {
            fs::create_dir(&dir).map_err(|_| "无法创建快照目录")?;
        }
        Ok(Self {
            pinned: pin_dirs(&dir)?,
        })
    }
    fn dir(&self, id: &str) -> Result<PinnedDirs> {
        if !hex(id, 32) {
            return Err("快照编号无效".into());
        }
        pin_dirs(&self.pinned.path.join(id))
    }
    fn budget(&self, needed: u64, creating: bool) -> Result<()> {
        let mut total = 0;
        let mut entries = 0;
        let mut records = 0;
        for item in fs::read_dir(&self.pinned.path).map_err(|_| "无法读取快照目录")? {
            let item = item.map_err(|_| "快照目录无法读取")?;
            if !item.file_type().map_err(|_| "无法检查快照类型")?.is_dir()
                || !hex(&item.file_name().to_string_lossy(), 32)
            {
                return Err("快照目录包含未知项目，请先检查存储".into());
            }
            records += 1;
            let dir = pin_dirs(&item.path())?;
            for child in fs::read_dir(&dir.path).map_err(|_| "无法统计快照容量")? {
                entries += 1;
                if entries > 20000 {
                    return Err("快照记录数量超限".into());
                }
                let child = child.map_err(|_| "无法统计快照容量")?;
                let meta = child.metadata().map_err(|_| "无法统计快照容量")?;
                if !child.file_type().map_err(|_| "无法统计快照容量")?.is_file() {
                    return Err("快照存储包含非普通文件".into());
                }
                total += meta.len();
            }
        }
        if creating && records >= 20 || total.saturating_add(needed) > MAX_STORE {
            return Err("快照上限为 20 份 / 256 MiB；现有备份不会自动删除，请先归档".into());
        }
        Ok(())
    }
    fn record(&self, id: &str, name: &str) -> Result<Record> {
        let dir = self.dir(id)?;
        let record: Record = read_json(&dir.path.join(name))?;
        let mut seen = HashSet::new();
        if record.version != 1 || record.id != id || record.entries.is_empty() || record.entries.len() > MAX_PATHS ||
            record.entries.iter().any(|e| !valid_path(&e.path) || !seen.insert(e.path.to_lowercase()) || matches!(&e.state, State::File { hash, size, .. } if !hex(hash,64) || *size > MAX_FILE)) ||
            record.entries.iter().map(|e| match e.state {State::File{size,..} => size,_ => 0}).sum::<usize>() > MAX_CAPTURE {
            return Err("快照格式无效".into());
        }
        if let Some(task) = &record.task {
            task.binding.validate()?;
            if task.binding.snapshot_id() != id
                || (name == "start.json" && record.created_at >= task.expires_at)
            {
                return Err("任务快照记录不匹配".into());
            }
        }
        Ok(record)
    }
    fn confirmed(&self, record: &Record) -> Result<()> {
        let task = record.task.as_ref().ok_or("不是任务快照")?;
        let dir = self.dir(&record.id)?;
        let confirmation: TaskConfirmation = read_json(&dir.path.join("confirmed.json"))?;
        if &confirmation.task != task
            || confirmation.confirmed_at < record.created_at
            || confirmation.confirmed_at >= task.expires_at
        {
            return Err("任务开始确认无效".into());
        }
        Ok(())
    }
    fn summary(&self, record: &Record) -> Summary {
        Summary {
            id: record.id.clone(),
            workspace: record.root.clone(),
            created_at: record.created_at,
            count: record.entries.len(),
            sealed: if record.task.is_some() {
                self.pair(&record.id).is_ok()
            } else {
                self.pinned.path.join(&record.id).join("end.json").exists()
            },
            task: record.task.as_ref().map(|task| task.binding.clone()),
            admission: if record.task.is_none() {
                "MANUAL"
            } else if self.confirmed(record).is_ok() {
                "CONFIRMED"
            } else {
                "UNCONFIRMED"
            },
        }
    }
    pub fn list(&self) -> Result<Vec<Summary>> {
        self.budget(0, false)?;
        let mut rows = Vec::new();
        for item in fs::read_dir(&self.pinned.path).map_err(|_| "无法读取快照")? {
            let item = item.map_err(|_| "无法读取快照")?;
            let id = item.file_name().to_string_lossy().to_string();
            // A failed capture retains its bytes but is not advertised as a usable snapshot.
            if let Ok(record) = self.record(&id, "start.json") {
                rows.push(self.summary(&record));
            }
        }
        rows.sort_by_key(|r| std::cmp::Reverse(r.created_at));
        Ok(rows)
    }
    pub fn capture(&self, root: &Path, paths: Vec<String>) -> Result<Summary> {
        self.capture_inner(root, paths, None)
    }
    // Lifecycle entry points will be wired exclusively to the authenticated
    // supervisor channel; the settings IPC cannot manufacture task events.
    #[allow(dead_code)]
    pub fn capture_task(
        &self,
        root: &Path,
        paths: Vec<String>,
        binding: TaskBinding,
        expires_at: u64,
    ) -> Result<Summary> {
        binding.validate()?;
        check_deadline(expires_at)?;
        self.capture_inner(
            root,
            paths,
            Some(TaskCapture {
                binding,
                expires_at,
            }),
        )
    }
    fn capture_inner(
        &self,
        root: &Path,
        paths: Vec<String>,
        task: Option<TaskCapture>,
    ) -> Result<Summary> {
        let root = workspace(root)?;
        if self.pinned.path.starts_with(&root.path) || root.path.starts_with(&self.pinned.path) {
            return Err("工作区与快照存储不能互相包含".into());
        }
        let mut seen = HashSet::new();
        if paths.is_empty()
            || paths.len() > MAX_PATHS
            || paths
                .iter()
                .any(|p| !valid_path(p) || !seen.insert(p.to_lowercase()))
        {
            return Err("请选择 1–128 个不重复的相对文件路径，使用 / 分隔".into());
        }
        let id = match &task {
            Some(task) => task.binding.snapshot_id(),
            None => random_id()?,
        };
        let dir = self.pinned.path.join(&id);
        if let Some(task) = &task {
            if dir.try_exists().map_err(|_| "无法确认任务快照是否存在")? {
                let _pin = self.dir(&id)?;
                let intent: TaskIntent = read_json(&dir.join("task-intent.json"))?;
                if intent.task != *task
                    || intent.root != root.path
                    || intent.root_identity != root.identity
                    || intent.paths != paths
                {
                    return Err("此轮已有其他快照请求，不能重新采集".into());
                }
                let record = self.record(&id, "start.json")?;
                if record.task.as_ref() != Some(task)
                    || record.root != intent.root
                    || record.root_identity != intent.root_identity
                    || record
                        .entries
                        .iter()
                        .map(|e| &e.path)
                        .ne(intent.paths.iter())
                {
                    return Err("任务快照与采集意图不匹配".into());
                }
                return Ok(self.summary(&record));
            }
        }
        self.budget(MAX_CAPTURE as u64 + 512 * 1024, true)?;
        fs::create_dir(&dir).map_err(|_| "无法创建快照")?;
        let _pin = pin_dirs(&dir)?;
        if let Some(task) = &task {
            check_deadline(task.expires_at)?;
            json_new(
                &dir.join("task-intent.json"),
                &TaskIntent {
                    task: task.clone(),
                    root: root.path.clone(),
                    root_identity: root.identity.clone(),
                    paths: paths.clone(),
                },
            )?;
        }
        let mut entries = Vec::new();
        let mut total = 0;
        for (index, path) in paths.into_iter().enumerate() {
            if let Some(task) = &task {
                check_deadline(task.expires_at)?;
            }
            let (state, data) = inspect(&root.path, &path)?;
            total += data.len();
            if total > MAX_CAPTURE {
                return Err("所选文件合计超过 32 MiB；已保存的部分保留但不可恢复".into());
            }
            if matches!(state, State::File { .. }) {
                write_new(&dir.join(format!("before-{index}.bin")), &data)?;
            }
            entries.push(Entry { path, state });
        }
        // Do not call a moving set of files one point-in-time capture.
        for entry in &entries {
            if let Some(task) = &task {
                check_deadline(task.expires_at)?;
            }
            if inspect(&root.path, &entry.path)?.0 != entry.state {
                return Err("采集期间文件发生变化，请在工程空闲后重新采集".into());
            }
        }
        if let Some(task) = &task {
            check_deadline(task.expires_at)?;
        }
        let record = Record {
            version: 1,
            id,
            root: root.path.clone(),
            root_identity: root.identity.clone(),
            created_at: now(),
            entries,
            task,
        };
        json_new(&dir.join("start.json"), &record)?;
        if let Some(task) = &record.task {
            check_deadline(task.expires_at)?;
        }
        Ok(self.summary(&record))
    }
    #[allow(dead_code)]
    pub fn confirm_task(&self, id: &str, binding: &TaskBinding) -> Result<Summary> {
        binding.validate()?;
        let start = self.record(id, "start.json")?;
        let task = start.task.as_ref().ok_or("不是任务快照")?;
        if &task.binding != binding {
            return Err("任务身份不匹配".into());
        }
        let dir = self.dir(id)?;
        if dir
            .path
            .join("confirmed.json")
            .try_exists()
            .map_err(|_| "无法检查确认状态")?
        {
            self.confirmed(&start)?;
            return Ok(self.summary(&start));
        }
        check_deadline(task.expires_at)?;
        let root = self.root(&start)?;
        for entry in &start.entries {
            if inspect(&root.path, &entry.path)?.0 != entry.state {
                return Err("开始确认前文件已变化，不能确认此任务快照".into());
            }
        }
        self.budget(256 * 1024, false)?;
        check_deadline(task.expires_at)?;
        json_new(
            &dir.path.join("confirmed.json"),
            &TaskConfirmation {
                task: task.clone(),
                confirmed_at: now(),
            },
        )?;
        self.confirmed(&start)?;
        Ok(self.summary(&start))
    }
    fn root(&self, record: &Record) -> Result<PinnedDirs> {
        let root = pin_dirs(&record.root)?;
        if root.identity != record.root_identity {
            return Err("工作区目录身份已变化，不能自动恢复".into());
        }
        Ok(root)
    }
    pub fn seal(&self, id: &str) -> Result<Summary> {
        let start = self.record(id, "start.json")?;
        if start.task.is_some() {
            return Err("任务快照只能由对应的活动任务封存".into());
        }
        self.seal_inner(start, None)
    }
    #[allow(dead_code)]
    pub fn seal_task(&self, id: &str, binding: &TaskBinding, expires_at: u64) -> Result<Summary> {
        binding.validate()?;
        let start = self.record(id, "start.json")?;
        if start.task.as_ref().map(|t| &t.binding) != Some(binding) {
            return Err("任务身份不匹配".into());
        }
        self.confirmed(&start)?;
        let dir = self.dir(id)?;
        if dir
            .path
            .join("end.json")
            .try_exists()
            .map_err(|_| "无法检查结束状态")?
        {
            self.pair(id)?;
            return Ok(self.summary(&start));
        }
        check_deadline(expires_at)?;
        // A failed seal must never silently sample a later task's changes.
        json_new(
            &dir.path.join("end-intent.json"),
            &TaskEndIntent {
                task: binding.clone(),
                expires_at,
            },
        )?;
        self.seal_inner(start, Some(expires_at))
    }
    fn seal_inner(&self, start: Record, expires_at: Option<u64>) -> Result<Summary> {
        let id = &start.id;
        let root = self.root(&start)?;
        let dir = self.dir(id)?;
        self.budget(256 * 1024, false)?;
        if dir.path.join("end.json").exists() {
            return Err("结束状态已固定，不能重新记录以绕过冲突检查".into());
        }
        let mut entries = Vec::new();
        for entry in &start.entries {
            if let Some(expires_at) = expires_at {
                check_deadline(expires_at)?;
            }
            entries.push(Entry {
                path: entry.path.clone(),
                state: inspect(&root.path, &entry.path)?.0,
            });
        }
        if entries
            .iter()
            .map(|e| match e.state {
                State::File { size, .. } => size,
                _ => 0,
            })
            .sum::<usize>()
            > MAX_CAPTURE
        {
            return Err("结束时所选文件合计超过 32 MiB，不能安全记录".into());
        }
        for entry in &entries {
            if let Some(expires_at) = expires_at {
                check_deadline(expires_at)?;
            }
            if inspect(&root.path, &entry.path)?.0 != entry.state {
                return Err("记录结束状态时文件仍在变化，请停止任务后重试".into());
            }
        }
        let record = Record {
            version: 1,
            id: id.clone(),
            root: start.root.clone(),
            root_identity: start.root_identity.clone(),
            created_at: now(),
            entries,
            task: start.task.clone(),
        };
        if let Some(expires_at) = expires_at {
            check_deadline(expires_at)?;
        }
        json_new(&dir.path.join("end.json"), &record)?;
        Ok(self.summary(&start))
    }
    fn pair(&self, id: &str) -> Result<(Record, Record)> {
        let start = self.record(id, "start.json")?;
        let end = self.record(id, "end.json")?;
        if start.root != end.root
            || start.task != end.task
            || start.root_identity != end.root_identity
            || start.entries.len() != end.entries.len()
            || start
                .entries
                .iter()
                .zip(&end.entries)
                .any(|(a, b)| a.path != b.path)
        {
            return Err("开始与结束记录不匹配".into());
        }
        if let Some(task) = &start.task {
            self.confirmed(&start)?;
            let dir = self.dir(id)?;
            let intent: TaskEndIntent = read_json(&dir.path.join("end-intent.json"))?;
            if intent.task != task.binding
                || end.created_at >= intent.expires_at
                || end.created_at < start.created_at
            {
                return Err("任务结束记录未在有效时间窗内完成".into());
            }
        }
        Ok((start, end))
    }
    pub fn preview(&self, id: &str) -> Result<Preview> {
        let (start, end) = self.pair(id)?;
        let root = self.root(&start)?;
        let dir = self.dir(id)?;
        let mut rows = Vec::new();
        for (i, (a, b)) in start.entries.iter().zip(&end.entries).enumerate() {
            let (status, message) = if dir.path.join(format!("restore-{i}.json")).exists() {
                match read_json::<Receipt>(&dir.path.join(format!("result-{i}.json"))) {
                    Ok(result) => (result.status, "已有恢复记录，不会自动重放".into()),
                    Err(_) => (
                        "INTERRUPTED".into(),
                        "恢复结果未确认；原内容备份保留，请手动核对".into(),
                    ),
                }
            } else if dir.path.join(format!("pre-restore-{i}.bin")).exists() {
                (
                    "INTERRUPTED".into(),
                    "恢复前备份未完成确认；保留数据，请手动核对".into(),
                )
            } else if equal_content(&a.state, &b.state) {
                ("UNCHANGED".into(), "选定范围内内容未变化".into())
            } else if let Err(error) = original_bytes(&dir.path, i, &a.state) {
                ("UNAVAILABLE".into(), error)
            } else {
                match inspect(&root.path, &a.path) {
                    Ok((current, _)) if current == b.state => (
                        "READY".into(),
                        match &a.state {
                            State::Absent => "恢复将删除任务期间创建的这个文件",
                            _ => "恢复为快照中的原始内容",
                        }
                        .into(),
                    ),
                    Ok(_) => (
                        "CONFLICT".into(),
                        "结束记录后文件已变化，保持当前内容".into(),
                    ),
                    Err(error) => ("UNAVAILABLE".into(), error),
                }
            };
            rows.push(Row {
                path: a.path.clone(),
                status,
                message,
            });
        }
        Ok(Preview {
            snapshot: self.summary(&start),
            rows,
        })
    }
    pub fn restore(&self, id: &str, paths: Vec<String>) -> Result<Preview> {
        let (start, end) = self.pair(id)?;
        let root = self.root(&start)?;
        let dir = self.dir(id)?;
        if paths.is_empty()
            || paths.len() > MAX_PATHS
            || paths
                .iter()
                .any(|p| !start.entries.iter().any(|e| &e.path == p))
        {
            return Err("恢复选择不在快照范围内".into());
        }
        // Reserve before touching the workspace; recovery backups are never pruned here.
        self.budget(MAX_CAPTURE as u64 + 512 * 1024, false)?;
        for (i, (a, b)) in start.entries.iter().zip(&end.entries).enumerate() {
            if !paths.contains(&a.path) || equal_content(&a.state, &b.state) {
                continue;
            }
            if dir.path.join(format!("restore-{i}.json")).exists()
                || dir.path.join(format!("pre-restore-{i}.bin")).exists()
            {
                continue;
            }
            self.restore_one(&root.path, &dir.path, i, a, b)?;
        }
        self.preview(id)
    }
    fn restore_one(
        &self,
        root: &Path,
        dir: &Path,
        index: usize,
        before: &Entry,
        end: &Entry,
    ) -> Result<()> {
        let target = root.join(&before.path);
        let _parents = pin_dirs(target.parent().ok_or("无效文件路径")?)?;
        let desired = original_bytes(dir, index, &before.state)?;
        let mut current = match file_open(&target, true, false) {
            Ok(mut file) => {
                let data = bytes(&mut file)?;
                if state(&file, &data)? != end.state {
                    return Err("文件与结束记录不一致；没有修改此文件，请刷新预览".into());
                }
                Some((file, data))
            }
            Err(error) if is_missing(&error) && end.state == State::Absent => None,
            Err(_) => return Err("文件冲突、被占用或不可写；没有修改此文件".into()),
        };
        // Both copies are durable before a single workspace byte changes.
        if let Some((_, data)) = &current {
            write_new(&dir.join(format!("pre-restore-{index}.bin")), data)?;
        }
        json_new(
            &dir.join(format!("restore-{index}.json")),
            &Journal {
                version: 1,
                path: before.path.clone(),
                expected: end.state.clone(),
                target: before.state.clone(),
                prepared_at: now(),
            },
        )?;
        let result = match before.state {
            State::Absent => {
                let Some((file, _)) = &current else {
                    return Err("恢复状态无效".into());
                };
                let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
                if unsafe {
                    SetFileInformationByHandle(
                        file.as_raw_handle(),
                        FileDispositionInfo,
                        (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                        std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
                    )
                } == 0
                {
                    Err("无法删除锁定的文件".into())
                } else {
                    Ok(())
                }
            }
            State::File { .. } => {
                if let Some((file, old)) = &mut current {
                    match overwrite(file, &desired) {
                        Ok(()) => Ok(()),
                        Err(_) => {
                            let status = if overwrite(file, old).is_ok() {
                                "ROLLED_BACK"
                            } else {
                                "INTERRUPTED"
                            };
                            json_new(
                                &dir.join(format!("result-{index}.json")),
                                &Receipt {
                                    status: status.into(),
                                    time: now(),
                                },
                            )?;
                            return Err("写入未完成，已保存恢复前备份；请刷新并核对状态".into());
                        }
                    }
                } else {
                    match file_open(&target, true, true) {
                        Ok(mut file) => {
                            let result = overwrite(&mut file, &desired);
                            current = Some((file, Vec::new()));
                            result
                        }
                        Err(_) => Err("恢复前出现新文件或文件无法创建；没有覆盖现有文件".into()),
                    }
                }
            }
        };
        let status = if result.is_ok() {
            "RESTORED"
        } else {
            "INTERRUPTED"
        };
        // Delete-on-close must finish while parent pins are still held.
        drop(current);
        json_new(
            &dir.join(format!("result-{index}.json")),
            &Receipt {
                status: status.into(),
                time: now(),
            },
        )?;
        result
    }
}
fn overwrite(file: &mut File, data: &[u8]) -> Result<()> {
    #[cfg(test)]
    if FAIL_AFTER_PARTIAL_WRITE.with(|fail| fail.replace(false)) {
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(&data[..data.len().min(1)]))
            .map_err(|_| "注入失败")?;
        return Err("注入写入中途失败".into());
    }
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.write_all(data))
        .and_then(|_| file.set_len(data.len() as u64))
        .and_then(|_| file.sync_all())
        .map_err(|_| "文件写入失败")?;
    if bytes(file)? != data {
        return Err("写入后校验失败".into());
    }
    Ok(())
}
#[cfg(test)]
thread_local! { static FAIL_AFTER_PARTIAL_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List,
    Details { id: String },
    Browse {
        workspace: PathBuf,
        directory: String,
    },
    Export {
        id: String,
        destination: PathBuf,
    },
    VerifyArchive {
        directory: PathBuf,
    },
    ImportArchive {
        directory: PathBuf,
    },
    Scopes,
    Arm {
        workspace: PathBuf,
        paths: Vec<String>,
        revision: u64,
    },
    Disarm {
        id: String,
        revision: u64,
    },
    Capture {
        workspace: PathBuf,
        paths: Vec<String>,
    },
    Seal {
        id: String,
    },
    Preview {
        id: String,
    },
    Restore {
        id: String,
        paths: Vec<String>,
    },
}
impl Request {
    pub fn storage_reservation(&self)->Option<u64>{match self {
        Self::Capture{..}|Self::Restore{..}=>Some(MAX_CAPTURE as u64+512*1024),
        Self::Seal{..}=>Some(512*1024),
        Self::ImportArchive{..}=>Some(MAX_STORE),
        _=>None,
    }}
}
pub fn dispatch(home: &Path, request: Request) -> Result<serde_json::Value> {
    match request {
        Request::Browse {
            workspace,
            directory,
        } => return browse(&workspace, &directory),
        Request::VerifyArchive { directory } => return archive::verify(&directory),
        Request::Scopes => {
            return serde_json::to_value(scopes(home)?).map_err(|_| "范围编码失败".into())
        }
        Request::Arm {
            workspace,
            paths,
            revision,
        } => {
            return serde_json::to_value(arm_scope(home, &workspace, paths, revision)?)
                .map_err(|_| "范围编码失败".into())
        }
        Request::Disarm { id, revision } => {
            return serde_json::to_value(disarm_scope(home, &id, revision)?)
                .map_err(|_| "范围编码失败".into())
        }
        _ => (),
    }
    let store = Store::open(home)?;
    match request {
        Request::Browse {..} | Request::VerifyArchive {..} => unreachable!(),
        Request::Export { id, destination } => return store.export_archive(&id, &destination),
        Request::ImportArchive { directory } => return store.import_archive(&directory),
        Request::Scopes | Request::Arm {..} | Request::Disarm {..} => unreachable!(),
        Request::List => {
            let items = store.list()?;
            let total = fs::read_dir(&store.pinned.path).map_err(|_| "无法读取快照目录")?.count();
            Ok(serde_json::json!({"storagePath":store.pinned.path,"incomplete":total.saturating_sub(items.len()),"items":items}))
        },
        Request::Details { id } => return store.details(&id),
        Request::Capture { workspace, paths } => {
            serde_json::to_value(store.capture(&workspace, paths)?)
        }
        Request::Seal { id } => serde_json::to_value(store.seal(&id)?),
        Request::Preview { id } => serde_json::to_value(store.preview(&id)?),
        Request::Restore { id, paths } => serde_json::to_value(store.restore(&id, paths)?),
    }
    .map_err(|_| "快照结果序列化失败".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    struct Fixture {
        dir: PathBuf,
        work: PathBuf,
        home: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("dsh-snapshot-test-{}", random_id().unwrap()));
            let work = dir.join("工程");
            let home = dir.join("home");
            fs::create_dir_all(&work).unwrap();
            fs::create_dir(&home).unwrap();
            Self { dir, work, home }
        }
        fn store(&self) -> Store {
            Store::open(&self.home).unwrap()
        }
        fn put(&self, path: &str, value: &[u8]) {
            fs::write(self.work.join(path), value).unwrap();
        }
        fn get(&self, path: &str) -> Vec<u8> {
            fs::read(self.work.join(path)).unwrap()
        }
        fn capture(&self, store: &Store, paths: &[&str]) -> String {
            store
                .capture(&self.work, paths.iter().map(|p| (*p).into()).collect())
                .unwrap()
                .id
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only the uniquely-created fixture subtree; never a workspace/user root.
            assert!(self.dir.parent() == Some(std::env::temp_dir().as_path()));
            assert!(self
                .dir
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("dsh-snapshot-test-"));
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
    fn states(preview: Preview) -> Vec<String> {
        preview.rows.into_iter().map(|r| r.status).collect()
    }
    fn archive_root(f: &Fixture) -> PathBuf {
        let path = f.dir.join("归档");
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn snapshot_details_preserve_historical_results_without_workspace_access() {
        let f=Fixture::new();let store=f.store();f.put("a",b"before");
        let id=f.capture(&store,&["a","new"]);f.put("a",b"after");f.put("new",b"created");store.seal(&id).unwrap();
        store.restore(&id,vec!["a".into(),"new".into()]).unwrap();
        f.put("a",b"later user edit");
        let detail=store.details(&id).unwrap();
        assert_eq!(detail["currentWorkspaceChecked"],false);
        assert_eq!(detail["rows"][0]["recovery"]["status"],"RESTORED");
        assert_eq!(detail["rows"][0]["originalBackup"]["status"],"VERIFIED");
        assert_eq!(detail["rows"][0]["recoveryBackup"]["status"],"VERIFIED");
        assert_eq!(detail["rows"][1]["originalBackup"]["status"],"NOT_NEEDED");
        assert_eq!(f.get("a"),b"later user edit");
        fs::rename(&f.work,f.dir.join("moved-workspace")).unwrap();
        assert!(store.preview(&id).is_err());assert_eq!(store.details(&id).unwrap()["rows"].as_array().unwrap().len(),2);
    }
    #[test]
    fn snapshot_details_reject_false_receipts_and_explain_partial_backups() {
        let f=Fixture::new();let store=f.store();f.put("a",b"before");let id=f.capture(&store,&["a"]);
        assert_eq!(store.details(&id).unwrap()["rows"][0]["recovery"]["status"],"NOT_ATTEMPTED");
        f.put("a",b"after");store.seal(&id).unwrap();let dir=store.dir(&id).unwrap();
        write_new(&dir.path.join("pre-restore-0.bin"),b"after").unwrap();
        json_new(&dir.path.join("result-0.json"),&Receipt{status:"RESTORED".into(),time:now()}).unwrap();
        let details=store.details(&id).unwrap();assert_eq!(details["rows"][0]["recovery"]["status"],"UNKNOWN");
        assert_eq!(details["rows"][0]["recoveryBackup"]["status"],"VERIFIED");
        fs::write(dir.path.join("before-0.bin"),b"tampered").unwrap();
        assert_eq!(store.details(&id).unwrap()["rows"][0]["originalBackup"]["status"],"UNVERIFIED");
        assert_eq!(f.get("a"),b"after");
    }
    #[test]
    fn snapshot_navigation_only_selects_existing_task_and_never_restores() {
        let f=Fixture::new();let store=f.store();f.put("a",b"before");
        let mut bridge=TaskBridge::new().unwrap();
        let binding=TaskBinding{session_id:"snapshot-navigation".into(),turn:1,engine_id:bridge.engine_id.clone(),request_id:random_id().unwrap()};
        let item=store.capture_task(&f.work,vec!["a".into()],binding,now()+14000).unwrap();
        f.put("a",b"user edit");
        assert!(bridge.execute(&f.home,"navigation-request",BridgeRequest::Open{id:item.id.clone(),expires_at:now()-1}).is_err());
        assert!(bridge.navigation.is_none());
        let value=bridge.execute(&f.home,"navigation-request",BridgeRequest::Open{id:item.id.clone(),expires_at:now()+10000}).unwrap();
        assert_eq!(value["status"],"OPEN_REQUESTED");assert_eq!(bridge.navigation.take().unwrap().id,item.id);
        assert_eq!(f.get("a"),b"user edit");assert!(!store.summary(&store.record(&item.id,"start.json").unwrap()).sealed);
        let manual=f.capture(&store,&["a"]);
        assert!(bridge.execute(&f.home,"navigation-request",BridgeRequest::Open{id:manual,expires_at:now()+10000}).is_err());
        assert!(bridge.navigation.is_none());
    }
    #[test]
    fn archive_roundtrip_preserves_binary_dirty_files_and_restore_receipts() {
        let f = Fixture::new();
        let store = f.store();
        let output = archive_root(&f);
        f.put("a", &[0, 255, 13, 10]);
        let id = f.capture(&store, &["a", "new"]);
        f.put("a", b"after");
        f.put("new", b"new");
        store.seal(&id).unwrap();
        let exported = store.export_archive(&id, &output).unwrap();
        let directory = Path::new(exported["directory"].as_str().unwrap());
        assert_eq!(archive::verify(directory).unwrap()["snapshotId"], id);
        assert!(store.import_archive(directory).is_err());
        let other = Store::open(&f.dir.join("other-home")).unwrap();
        let imported = other.import_archive(directory).unwrap();
        assert_eq!(imported["snapshot"]["id"], id);
        assert_eq!(f.get("a"), b"after", "import never restores automatically");
        assert_eq!(
            states(other.restore(&id, vec!["a".into(), "new".into()]).unwrap()),
            ["RESTORED", "RESTORED"]
        );
        assert_eq!(f.get("a"), [0, 255, 13, 10]);
        assert!(!f.work.join("new").exists());
        let restored = other.export_archive(&id, &output).unwrap();
        let third = Store::open(&f.dir.join("third-home")).unwrap();
        third
            .import_archive(Path::new(restored["directory"].as_str().unwrap()))
            .unwrap();
        assert_eq!(
            states(third.preview(&id).unwrap()),
            ["RESTORED", "RESTORED"]
        );
        assert_eq!(
            fs::read(third.dir(&id).unwrap().path.join("pre-restore-0.bin")).unwrap(),
            b"after"
        );
    }
    #[test]
    fn archive_rejects_corrupt_missing_extra_and_linked_payloads() {
        let f = Fixture::new();
        let store = f.store();
        let output = archive_root(&f);
        f.put("a", b"before");
        let id = f.capture(&store, &["a"]);
        store.seal(&id).unwrap();
        let exported = store.export_archive(&id, &output).unwrap();
        let path = Path::new(exported["directory"].as_str().unwrap());
        fs::write(path.join("before-0.bin"), b"corrupt").unwrap();
        assert!(archive::verify(path).is_err());
        let other = Store::open(&f.dir.join("other")).unwrap();
        assert!(other.import_archive(path).is_err());
        assert!(other.list().unwrap().is_empty());
        fs::write(path.join("before-0.bin"), b"before").unwrap();
        assert!(archive::verify(path).is_ok());
        fs::write(path.join("unexpected.txt"), b"extra").unwrap();
        assert!(archive::verify(path).is_err());
        fs::remove_file(path.join("unexpected.txt")).unwrap();
        fs::hard_link(path.join("before-0.bin"), f.dir.join("hardlink")).unwrap();
        assert!(archive::verify(path).is_err());
        fs::remove_file(f.dir.join("hardlink")).unwrap();
        fs::remove_file(path.join("end.json")).unwrap();
        assert!(archive::verify(path).is_err());
        assert_eq!(f.get("a"), b"before");
        assert!(store.preview(&id).is_ok());
    }
    #[test]
    fn archive_export_is_create_only_outside_workspace_and_requires_valid_originals() {
        let f = Fixture::new();
        let store = f.store();
        let output = archive_root(&f);
        f.put("a", b"before");
        let id = f.capture(&store, &["a"]);
        assert!(store.export_archive(&id, &f.work).is_err());
        assert!(store.export_archive(&id, &store.pinned.path).is_err());
        let first = store.export_archive(&id, &output).unwrap();
        let second = store.export_archive(&id, &output).unwrap();
        assert_ne!(first["directory"], second["directory"]);
        assert_eq!(
            store.list().unwrap().len(),
            1,
            "export never deletes the original"
        );
        fs::write(
            store.dir(&id).unwrap().path.join("before-0.bin"),
            b"damaged",
        )
        .unwrap();
        assert!(store.export_archive(&id, &output).is_err());
        assert_eq!(fs::read_dir(&output).unwrap().count(), 2);
    }
    #[test]
    fn archive_unconfirmed_task_stays_unconfirmed_after_import() {
        let f = Fixture::new();
        let store = f.store();
        let output = archive_root(&f);
        f.put("a", b"before");
        let captured = store
            .capture_task(&f.work, vec!["a".into()], task(), now() + 14000)
            .unwrap();
        let exported = store.export_archive(&captured.id, &output).unwrap();
        let other = Store::open(&f.dir.join("other")).unwrap();
        let imported = other
            .import_archive(Path::new(exported["directory"].as_str().unwrap()))
            .unwrap();
        assert_eq!(imported["snapshot"]["admission"], "UNCONFIRMED");
        assert_eq!(imported["snapshot"]["sealed"], false);
        assert!(other.seal(&captured.id).is_err());
        assert!(other.preview(&captured.id).is_err());
    }
    #[test]
    fn snapshot_browse_stays_in_scope_and_omits_metadata_and_links() {
        let f = Fixture::new();
        f.put("a", b"text");
        f.put("large", &vec![0; MAX_FILE + 1]);
        for directory in ["src", ".git", ".hg"] {
            fs::create_dir(f.work.join(directory)).unwrap();
        }
        f.put("src/中文.cpp", b"hello");
        fs::hard_link(f.work.join("a"), f.work.join("alias")).unwrap();
        let root = browse(&f.work, "").unwrap();
        let rows = root["rows"].as_array().unwrap();
        assert!(rows
            .iter()
            .any(|r| r["name"] == "src" && r["kind"] == "directory"));
        assert!(rows
            .iter()
            .any(|r| r["name"] == "large" && r["selectable"] == false));
        assert!(!rows
            .iter()
            .any(|r| [".git", ".hg", "alias", "a"].contains(&r["name"].as_str().unwrap())));
        assert_eq!(
            browse(&f.work, "src").unwrap()["rows"][0]["path"],
            "src/中文.cpp"
        );
        for path in ["../home", ".git", "src/../../", "C:/Windows"] {
            assert!(browse(&f.work, path).is_err());
        }
    }

    fn task() -> TaskBinding {
        TaskBinding {
            session_id: "session-中文".into(),
            turn: 1,
            engine_id: "a".repeat(32),
            request_id: "b".repeat(32),
        }
    }
    #[test]
    fn automatic_scopes_are_explicit_revisioned_and_identity_bound() {
        let f = Fixture::new();
        f.put("a", b"before");
        assert!(scopes(&f.home).unwrap().items.is_empty());
        let first = arm_scope(&f.home, &f.work, vec!["a".into()], 0).unwrap();
        assert_eq!(first.revision, 1);
        assert!(arm_scope(&f.home, &f.work, vec!["a".into()], 0).is_err());
        assert!(arm_scope(&f.home, &f.work, vec!["../a".into()], 1).is_err());
        assert!(arm_scope(&f.home, &f.home, vec!["a".into()], 1).is_err());
        let second = arm_scope(&f.home, &f.work, vec!["a".into(), "new".into()], 1).unwrap();
        assert_ne!(first.items[0].id, second.items[0].id);
        assert!(disarm_scope(&f.home, &first.items[0].id, 2).is_err());
        assert!(disarm_scope(&f.home, &second.items[0].id, 1).is_err());
        assert!(disarm_scope(&f.home, &second.items[0].id, 2)
            .unwrap()
            .items
            .is_empty());
    }
    #[test]
    #[ignore = "requires the prepared pinned DSH runtime and protocol fixtures"]
    fn automatic_snapshots_real_dsh_wire() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for protocol in ["openai", "anthropic"] {
            let mut f = Fixture::new();
            let home=f.dir.join("dsh");fs::rename(&f.home,&home).unwrap();f.home=home;
            f.put("a", b"before");
            arm_scope(&f.home, &f.work, vec!["a".into()], 0).unwrap();
            let mut bridge = TaskBridge::new().unwrap();
            bridge.quota=Some(crate::storage_quota::Quota::new(f.dir.clone()));
            let mut child = Command::new(repo.join("runtime/runtime/node.exe"))
                .arg(repo.join("tests/task-snapshot-wire.mjs"))
                .arg(&f.work)
                .arg(&f.home)
                .arg(protocol)
                .current_dir(repo)
                .creation_flags(0x08000000)
                .env_remove("NODE_OPTIONS")
                .env_remove("NODE_PATH")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap();
            let _job = crate::process::Job::new(&child).unwrap();
            let start = format!(
                "start {}\n",
                serde_json::json!({"diagnosticKey":"07".repeat(32),"storageQuota":true,"snapshotBridge":{"token":bridge.token,"engineId":bridge.engine_id}})
            );
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(start.as_bytes())
                .unwrap();
            let stdout = child.stdout.take().unwrap();
            let (tx, rx) = std::sync::mpsc::sync_channel(64);
            let reader = std::thread::spawn(move || {
                for line in BufReader::new(stdout)
                    .lines()
                    .map_while(std::result::Result::ok)
                {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
            let deadline = Instant::now() + Duration::from_secs(110);
            let status = loop {
                if Instant::now() > deadline {
                    child.kill().unwrap();
                    break child.wait().unwrap();
                }
                if let Ok(line) = rx.recv_timeout(Duration::from_millis(50)) {
                    if let Some(reply) = bridge.handle(&f.home, &line, true) {
                        child
                            .stdin
                            .as_mut()
                            .unwrap()
                            .write_all(reply.as_bytes())
                            .unwrap();
                    } else if line.starts_with("PASS ") {
                        println!("{line}");
                    }
                }
                if let Some(status) = child.try_wait().unwrap() {
                    break status;
                }
            };
            drop(rx);
            reader.join().unwrap();
            assert!(status.success(), "native DSH snapshot {protocol} failed");
            let store = f.store();
            let items = store.list().unwrap();
            assert_eq!(items.len(), 2);
            assert!(items.iter().all(|s| s.sealed));
            let last = items
                .iter()
                .find(|s| s.task.as_ref().unwrap().turn == 2)
                .unwrap();
            assert_eq!(bridge.navigation.as_ref().unwrap().id,last.id);
            assert_eq!(bridge.quota.as_ref().unwrap().inspect().unwrap().reserved_bytes,0);
            assert_eq!(
                states(store.restore(&last.id, vec!["a".into()]).unwrap()),
                ["RESTORED"]
            );
            assert_eq!(f.get("a"), b"after turn 1");
        }
    }

    fn bridge_call(
        bridge: &mut TaskBridge,
        home: &Path,
        command: serde_json::Value,
        available: bool,
    ) -> serde_json::Value {
        let line = format!(
            "dsh snapshot: {}",
            serde_json::json!({"token":bridge.token,"id":random_id().unwrap(),"command":command})
        );
        let response = bridge.handle(home, &line, available).unwrap();
        serde_json::from_str(response.strip_prefix("snapshot ").unwrap()).unwrap()
    }
    #[test]
    fn storage_leases_release_while_busy_and_on_engine_drop() {
        let f=Fixture::new();let home=f.dir.join("dsh");fs::create_dir(&home).unwrap();
        let quota=crate::storage_quota::Quota::new(f.dir.clone());let mut bridge=TaskBridge::new().unwrap();bridge.quota=Some(quota.clone());
        let before=bridge.last_status.clone();
        let command=serde_json::json!({"action":"reserveStorage","bytes":1048576,"expiresAt":now()+13000});
        assert_eq!(bridge_call(&mut bridge,&home,command.clone(),false)["ok"],false);assert_eq!(bridge.last_status,before);
        let reserved=bridge_call(&mut bridge,&home,command.clone(),true);assert_eq!(reserved["value"]["status"],"RESERVED");assert_eq!(quota.inspect().unwrap().reserved_bytes,1048576);
        let release=serde_json::json!({"action":"releaseStorage","reservationId":reserved["id"]});
        assert_eq!(bridge_call(&mut bridge,&home,release.clone(),false)["value"]["status"],"RELEASED");
        assert_eq!(bridge_call(&mut bridge,&home,release,false)["value"]["status"],"RELEASED");assert_eq!(quota.inspect().unwrap().reserved_bytes,0);
        bridge_call(&mut bridge,&home,command,true);drop(bridge);assert_eq!(quota.inspect().unwrap().reserved_bytes,0);
    }
    #[test]
    fn automatic_bridge_enforces_pipe_authority_scope_and_revoke_before_confirmation() {
        let f = Fixture::new();
        f.put("a", b"before");
        let mut bridge = TaskBridge::new().unwrap();
        let begin = serde_json::json!({"action":"begin","workspace":f.work,"sessionId":"session","turn":1,"expiresAt":now()+14000});
        assert_eq!(
            bridge_call(&mut bridge, &f.home, begin.clone(), true)["value"]["status"],
            "DISABLED"
        );
        let scopes = arm_scope(&f.home, &f.work, vec!["a".into()], 0).unwrap();
        assert!(bridge
            .handle(
                &f.home,
                &format!(
                    "dsh snapshot: {}",
                    serde_json::json!({"token":"f".repeat(32),"id":"a".repeat(32),"command":begin})
                ),
                true
            )
            .is_none());
        assert_eq!(
            bridge_call(&mut bridge, &f.home, begin.clone(), false)["ok"],
            false
        );
        let captured = bridge_call(&mut bridge, &f.home, begin, true)["value"].clone();
        assert_eq!(captured["status"], "CAPTURED");
        disarm_scope(&f.home, &scopes.items[0].id, scopes.revision).unwrap();
        assert_eq!(
            bridge_call(
                &mut bridge,
                &f.home,
                serde_json::json!({"action":"confirm","id":captured["id"],"binding":captured["binding"]}),
                true
            )["ok"],
            false
        );
        bridge_call(
            &mut bridge,
            &f.home,
            serde_json::json!({"action":"abandon","requestId":captured["binding"]["requestId"]}),
            false,
        );
        assert!(bridge.pending.is_empty());
        assert_eq!(f.store().list().unwrap()[0].admission, "UNCONFIRMED");
    }
    #[test]
    fn automatic_bridge_seals_original_scope_after_disarm_and_rejects_restart() {
        let f = Fixture::new();
        f.put("a", b"before");
        let scopes = arm_scope(&f.home, &f.work, vec!["a".into()], 0).unwrap();
        let mut bridge = TaskBridge::new().unwrap();
        let captured=bridge_call(&mut bridge,&f.home,serde_json::json!({"action":"begin","workspace":f.work,"sessionId":"session","turn":1,"expiresAt":now()+14000}),true)["value"].clone();
        assert_eq!(
            bridge_call(
                &mut bridge,
                &f.home,
                serde_json::json!({"action":"confirm","id":captured["id"],"binding":captured["binding"]}),
                true
            )["value"]["status"],
            "CONFIRMED"
        );
        disarm_scope(&f.home, &scopes.items[0].id, scopes.revision).unwrap();
        f.put("a", b"after");
        let end = serde_json::json!({"action":"end","id":captured["id"],"binding":captured["binding"],"expiresAt":now()+14000});
        assert_eq!(
            bridge_call(&mut TaskBridge::new().unwrap(), &f.home, end.clone(), true)["ok"],
            false
        );
        assert_eq!(
            bridge_call(&mut bridge, &f.home, end, true)["value"]["status"],
            "SEALED"
        );
        assert!(bridge.pending.is_empty());
        assert_eq!(
            states(f.store().preview(captured["id"].as_str().unwrap()).unwrap()),
            ["READY"]
        );
    }
    #[test]
    fn task_snapshot_requires_confirmation_and_preserves_original_on_duplicate() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"before");
        let binding = task();
        let expires = now() + 15_000;
        let start = store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), expires)
            .unwrap();
        assert_eq!(start.admission, "UNCONFIRMED");
        assert!(store.seal(&start.id).is_err());
        assert!(store
            .seal_task(&start.id, &binding, now() + 15_000)
            .is_err());
        assert_eq!(
            store.confirm_task(&start.id, &binding).unwrap().admission,
            "CONFIRMED"
        );
        f.put("a", b"task changes");
        assert_eq!(
            store
                .capture_task(&f.work, vec!["a".into()], binding.clone(), expires)
                .unwrap()
                .id,
            start.id
        );
        assert_eq!(
            store.confirm_task(&start.id, &binding).unwrap().admission,
            "CONFIRMED"
        );
        assert!(
            store
                .seal_task(&start.id, &binding, now() + 15_000)
                .unwrap()
                .sealed
        );
        // An end acknowledgement retry returns the same state, never resamples.
        f.put("a", b"later user edit");
        assert!(
            store
                .seal_task(&start.id, &binding, now() + 15_000)
                .unwrap()
                .sealed
        );
        assert_eq!(states(store.preview(&start.id).unwrap()), ["CONFLICT"]);
        assert_eq!(
            fs::read(store.dir(&start.id).unwrap().path.join("before-0.bin")).unwrap(),
            b"before"
        );
    }

    #[test]
    fn task_snapshot_restore_uses_existing_conflict_and_backup_contract() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"before");
        let binding = task();
        let start = store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), now() + 15_000)
            .unwrap();
        store.confirm_task(&start.id, &binding).unwrap();
        f.put("a", b"after");
        store
            .seal_task(&start.id, &binding, now() + 15_000)
            .unwrap();
        drop(store);
        let store = f.store();
        assert_eq!(
            states(store.restore(&start.id, vec!["a".into()]).unwrap()),
            ["RESTORED"]
        );
        assert_eq!(f.get("a"), b"before");
        assert_eq!(
            fs::read(store.dir(&start.id).unwrap().path.join("pre-restore-0.bin")).unwrap(),
            b"after"
        );
    }

    #[test]
    fn task_snapshot_rejects_changed_scope_restarted_engine_and_wrong_confirmation() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"before");
        let binding = task();
        let expires = now() + 15_000;
        let start = store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), expires)
            .unwrap();
        let mut restarted = binding.clone();
        restarted.engine_id = "c".repeat(32);
        assert!(store
            .capture_task(&f.work, vec!["a".into()], restarted.clone(), expires)
            .is_err());
        assert!(store
            .capture_task(&f.work, vec!["b".into()], binding.clone(), expires)
            .is_err());
        assert!(store.confirm_task(&start.id, &restarted).is_err());
        f.put("a", b"changed before admission");
        assert!(store.confirm_task(&start.id, &binding).is_err());
        assert!(!store.list().unwrap()[0].sealed);
        assert_eq!(store.list().unwrap()[0].admission, "UNCONFIRMED");
        assert!(store.preview(&start.id).is_err());
    }

    #[test]
    fn failed_task_capture_cannot_be_replayed_after_files_change() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", &vec![1; MAX_FILE + 1]);
        let binding = task();
        let expires = now() + 15_000;
        assert!(store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), expires)
            .is_err());
        f.put("a", b"small again");
        assert!(store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), expires)
            .is_err());
        assert!(store.list().unwrap().is_empty());
        assert!(store
            .dir(&binding.snapshot_id())
            .unwrap()
            .path
            .join("task-intent.json")
            .exists());
    }

    #[test]
    fn failed_task_seal_cannot_sample_later_changes() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"before");
        let binding = task();
        let start = store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), now() + 15_000)
            .unwrap();
        store.confirm_task(&start.id, &binding).unwrap();
        f.put("a", &vec![1; MAX_FILE + 1]);
        assert!(store
            .seal_task(&start.id, &binding, now() + 15_000)
            .is_err());
        f.put("a", b"later changes");
        assert!(store
            .seal_task(&start.id, &binding, now() + 15_000)
            .is_err());
        assert!(store.seal(&start.id).is_err());
        assert!(store.preview(&start.id).is_err());
        assert!(!store.list().unwrap()[0].sealed);
    }

    #[test]
    fn task_snapshot_deadline_identity_and_local_ipc_are_bounded() {
        let f = Fixture::new();
        let store = f.store();
        assert!(store
            .capture_task(&f.work, vec!["a".into()], task(), now() - 1)
            .is_err());
        assert!(store
            .capture_task(&f.work, vec!["a".into()], task(), now() + 60_000)
            .is_err());
        let mut invalid = task();
        invalid.session_id = "\n".into();
        assert!(store
            .capture_task(&f.work, vec!["a".into()], invalid, now() + 15_000)
            .is_err());
        assert!(store.list().unwrap().is_empty());
        assert!(serde_json::from_value::<Request>(
            serde_json::json!({"action":"captureTask", "binding":task()})
        )
        .is_err());
    }

    #[test]
    fn task_snapshot_tampered_confirmation_cannot_enable_restore() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"before");
        let binding = task();
        let start = store
            .capture_task(&f.work, vec!["a".into()], binding.clone(), now() + 15_000)
            .unwrap();
        store.confirm_task(&start.id, &binding).unwrap();
        f.put("a", b"after");
        store
            .seal_task(&start.id, &binding, now() + 15_000)
            .unwrap();
        let dir = store.dir(&start.id).unwrap();
        let mut confirmation: TaskConfirmation =
            read_json(&dir.path.join("confirmed.json")).unwrap();
        confirmation.confirmed_at = confirmation.task.expires_at;
        fs::write(
            dir.path.join("confirmed.json"),
            serde_json::to_vec(&confirmation).unwrap(),
        )
        .unwrap();
        assert!(!store.list().unwrap()[0].sealed);
        assert!(store.restore(&start.id, vec!["a".into()]).is_err());
        assert_eq!(f.get("a"), b"after");
    }

    #[test]
    fn snapshots_roundtrip_dirty_binary_created_deleted_without_touching_metadata() {
        let f = Fixture::new();
        let store = f.store();
        fs::create_dir(f.work.join(".git")).unwrap();
        fs::create_dir(f.work.join(".hg")).unwrap();
        f.put(".git/index", b"git index remains");
        f.put(".hg/dirstate", b"hg remains");
        f.put("修改.txt", b"pre-existing dirty\r\n");
        f.put("binary.dat", &[0, 255, 0, 13, 10]);
        f.put("deleted.txt", b"bring back");
        f.put("same", b"untouched");
        let paths = [
            "修改.txt",
            "binary.dat",
            "deleted.txt",
            "created.txt",
            "same",
        ];
        let id = f.capture(&store, &paths);
        f.put("修改.txt", b"task changes");
        f.put("binary.dat", &[128, 0]);
        fs::remove_file(f.work.join("deleted.txt")).unwrap();
        f.put("created.txt", b"created by task");
        f.put("outside-scope", b"must remain");
        store.seal(&id).unwrap();
        drop(store);
        let store = f.store();
        assert_eq!(
            states(store.preview(&id).unwrap()),
            ["READY", "READY", "READY", "READY", "UNCHANGED"]
        );
        let restored = store
            .restore(&id, paths.map(String::from).to_vec())
            .unwrap();
        assert_eq!(
            states(restored),
            ["RESTORED", "RESTORED", "RESTORED", "RESTORED", "UNCHANGED"]
        );
        assert_eq!(f.get("修改.txt"), b"pre-existing dirty\r\n");
        assert_eq!(f.get("binary.dat"), [0, 255, 0, 13, 10]);
        assert_eq!(f.get("deleted.txt"), b"bring back");
        assert!(!f.work.join("created.txt").exists());
        assert_eq!(f.get("outside-scope"), b"must remain");
        assert_eq!(f.get(".git/index"), b"git index remains");
        assert_eq!(f.get(".hg/dirstate"), b"hg remains");
        let saved = store.dir(&id).unwrap();
        assert_eq!(
            fs::read(saved.path.join("pre-restore-0.bin")).unwrap(),
            b"task changes"
        );
        assert_eq!(
            fs::read(saved.path.join("pre-restore-3.bin")).unwrap(),
            b"created by task"
        );
        f.put("修改.txt", b"edit after restore");
        store.restore(&id, vec!["修改.txt".into()]).unwrap();
        assert_eq!(f.get("修改.txt"), b"edit after restore");
    }

    #[test]
    fn snapshots_late_edit_after_preview_is_conflict_and_cannot_reseal() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        f.put("a", b"task");
        store.seal(&id).unwrap();
        assert_eq!(states(store.preview(&id).unwrap()), ["READY"]);
        f.put("a", b"user edit");
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert_eq!(f.get("a"), b"user edit");
        assert_eq!(states(store.preview(&id).unwrap()), ["CONFLICT"]);
        assert!(store.seal(&id).is_err());
        assert!(!store.dir(&id).unwrap().path.join("restore-0.json").exists());
    }

    #[test]
    fn snapshots_replacement_with_same_bytes_and_new_file_are_not_overwritten() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        f.put("b", b"old");
        let id = f.capture(&store, &["a", "b"]);
        f.put("a", b"task");
        fs::remove_file(f.work.join("b")).unwrap();
        store.seal(&id).unwrap();
        fs::rename(f.work.join("a"), f.work.join("old-a")).unwrap();
        f.put("a", b"task");
        f.put("b", b"new user file");
        assert_eq!(
            states(store.preview(&id).unwrap()),
            ["CONFLICT", "CONFLICT"]
        );
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert!(store.restore(&id, vec!["b".into()]).is_err());
        assert_eq!(f.get("a"), b"task");
        assert_eq!(f.get("b"), b"new user file");
    }

    #[test]
    fn snapshots_windows_handles_block_concurrent_writes_and_parent_rename() {
        let f = Fixture::new();
        fs::create_dir(f.work.join("sub")).unwrap();
        f.put("sub/a", b"safe");
        let _pins = pin_dirs(&f.work.join("sub")).unwrap();
        let mut file = file_open(&f.work.join("sub/a"), true, false).unwrap();
        let path = f.work.clone();
        std::thread::spawn(move || {
            assert!(fs::write(path.join("sub/a"), b"concurrent").is_err());
            assert!(fs::remove_file(path.join("sub/a")).is_err());
            assert!(fs::rename(path.join("sub"), path.join("renamed")).is_err());
            assert!(OpenOptions::new()
                .access_mode(FILE_GENERIC_WRITE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(path.join("sub"))
                .is_err());
        })
        .join()
        .unwrap();
        overwrite(&mut file, b"restored").unwrap();
        drop(file);
        assert_eq!(f.get("sub/a"), b"restored");
        let fresh = file_open(&f.work.join("new"), true, true).unwrap();
        drop(fresh);
        assert!(file_open(&f.work.join("new"), true, true).is_err());
    }

    #[test]
    fn snapshots_busy_files_and_hardlinks_refuse_without_writes() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        f.put("a", b"task");
        store.seal(&id).unwrap();
        let busy = file_open(&f.work.join("a"), true, false).unwrap();
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        drop(busy);
        fs::hard_link(f.work.join("a"), f.work.join("alias")).unwrap();
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert!(store.capture(&f.work, vec!["alias".into()]).is_err());
        assert_eq!(f.get("alias"), b"task");
    }

    #[test]
    fn snapshots_reject_streams_junctions_reserved_names_and_outside_paths() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"main");
        fs::write(
            format!("{}:extra", f.work.join("a").display()),
            b"named stream must not be lost",
        )
        .unwrap();
        assert!(store.capture(&f.work, vec!["a".into()]).is_err());
        for path in [
            "../escape",
            ".git/index",
            ".hg/dirstate",
            "dir/.GiT/index",
            "C:/file",
            "a:extra",
            "dir\\a",
            "NUL.txt",
            "com1",
            "LPT².log",
            "bad.",
            "foo//x",
            "/root",
            "CONIN$",
            "foo?",
        ] {
            assert!(!valid_path(path), "{path}");
        }
        assert!(valid_path("src/报告 1.cpp"));
        assert!(valid_path("company/data"));
        let outside = f.dir.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret"), b"untouched").unwrap();
        let status = std::process::Command::new(std::env::var_os("ComSpec").unwrap())
            .args(["/d", "/c", "mklink", "/J"])
            .arg(f.work.join("link"))
            .arg(&outside)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(status.status.success(), "junction fixture creation failed");
        assert!(store.capture(&f.work, vec!["link/secret".into()]).is_err());
        assert_eq!(fs::read(outside.join("secret")).unwrap(), b"untouched");
    }

    #[test]
    fn snapshots_corrupt_backup_and_replaced_root_fail_closed() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        f.put("a", b"task");
        store.seal(&id).unwrap();
        fs::write(
            store.dir(&id).unwrap().path.join("before-0.bin"),
            b"corrupt",
        )
        .unwrap();
        assert_eq!(states(store.preview(&id).unwrap()), ["UNAVAILABLE"]);
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert_eq!(f.get("a"), b"task");
        fs::rename(&f.work, f.dir.join("old-work")).unwrap();
        fs::create_dir(&f.work).unwrap();
        f.put("a", b"unrelated project");
        assert!(store.preview(&id).is_err());
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert_eq!(f.get("a"), b"unrelated project");
    }

    #[test]
    fn snapshots_interrupted_journal_is_visible_and_never_replayed() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        f.put("a", b"task");
        store.seal(&id).unwrap();
        let (start, end) = store.pair(&id).unwrap();
        let dir = store.dir(&id).unwrap();
        write_new(&dir.path.join("pre-restore-0.bin"), b"task").unwrap();
        json_new(
            &dir.path.join("restore-0.json"),
            &Journal {
                version: 1,
                path: "a".into(),
                expected: end.entries[0].state.clone(),
                target: start.entries[0].state.clone(),
                prepared_at: now(),
            },
        )
        .unwrap();
        // Simulate a process stopping after a partial in-place write and before receipt.
        f.put("a", b"ini");
        drop(dir);
        drop(store);
        let cold = f.store();
        assert_eq!(states(cold.preview(&id).unwrap()), ["INTERRUPTED"]);
        cold.restore(&id, vec!["a".into()]).unwrap();
        assert_eq!(f.get("a"), b"ini");
        assert_eq!(
            fs::read(cold.dir(&id).unwrap().path.join("pre-restore-0.bin")).unwrap(),
            b"task"
        );
    }

    #[test]
    fn snapshots_limits_retain_existing_records_and_connections_are_separate() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        let other = Store::open(&f.dir.join("other-profile")).unwrap();
        assert!(other.list().unwrap().is_empty());
        assert!(other.seal(&id).is_err());
        assert!(store
            .capture(&f.work, vec!["a".into(), "A".into()])
            .is_err());
        f.put("large", &vec![0; MAX_FILE + 1]);
        assert!(store.capture(&f.work, vec!["large".into()]).is_err());
        let mut count = fs::read_dir(&store.pinned.path).unwrap().count();
        while count < 20 {
            fs::create_dir(store.pinned.path.join(random_id().unwrap())).unwrap();
            count += 1;
        }
        assert!(store.capture(&f.work, vec!["a".into()]).is_err());
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.list().unwrap()[0].id, id);
        assert_eq!(fs::read_dir(&store.pinned.path).unwrap().count(), 20);
    }
    #[test]
    fn snapshots_partial_write_failure_rolls_back_and_preserves_recovery_copies() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        f.put("a", b"task change");
        store.seal(&id).unwrap();
        FAIL_AFTER_PARTIAL_WRITE.with(|fail| fail.set(true));
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert_eq!(f.get("a"), b"task change");
        assert_eq!(states(store.preview(&id).unwrap()), ["ROLLED_BACK"]);
        assert_eq!(
            fs::read(store.dir(&id).unwrap().path.join("pre-restore-0.bin")).unwrap(),
            b"task change"
        );
        assert_eq!(
            fs::read(store.dir(&id).unwrap().path.join("before-0.bin")).unwrap(),
            b"initial"
        );
    }
    #[test]
    fn snapshots_failed_creation_is_interrupted_and_keeps_original_backup() {
        let f = Fixture::new();
        let store = f.store();
        f.put("a", b"initial");
        let id = f.capture(&store, &["a"]);
        fs::remove_file(f.work.join("a")).unwrap();
        store.seal(&id).unwrap();
        FAIL_AFTER_PARTIAL_WRITE.with(|fail| fail.set(true));
        assert!(store.restore(&id, vec!["a".into()]).is_err());
        assert_eq!(states(store.preview(&id).unwrap()), ["INTERRUPTED"]);
        assert_eq!(f.get("a"), b"i");
        store.restore(&id, vec!["a".into()]).unwrap();
        assert_eq!(f.get("a"), b"i");
        assert_eq!(
            fs::read(store.dir(&id).unwrap().path.join("before-0.bin")).unwrap(),
            b"initial"
        );
    }
}
