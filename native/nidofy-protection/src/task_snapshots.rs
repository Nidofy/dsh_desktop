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
    let terminal = path.file_name().and_then(|v| v.to_str()).is_some_and(|v| v.starts_with("end") || v.starts_with("result-"));
    crate::quota::before_write(data.len(), terminal)?;
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
                crate::quota::before_write(0, false)?;
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
    crate::quota::before_write(data.len(), false)?;
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
        #[serde(rename = "expectedRevision")]
        expected_revision: String,
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
    pub fn storage_scope(&self) -> &'static str { match self {
        Self::Arm{..}|Self::Disarm{..} => "native:scope",
        Self::Capture{..} => "native:capture", Self::Restore{..} => "native:restore",
        Self::Seal{..} => "native:seal", Self::ImportArchive{..} => "native:import",
        Self::Export{..} => "native:export", _ => "native:read",
    }}
    pub fn storage_reservation(&self)->Option<u64>{match self {
        Self::Capture{..}|Self::Restore{..}=>Some(MAX_CAPTURE as u64+2*1024*1024),
        Self::Arm{..}|Self::Disarm{..}=>Some(512*1024),
        Self::Seal{..}=>Some(512*1024),
        Self::ImportArchive{..}=>Some(MAX_STORE),
        Self::Export{..}=>Some(MAX_STORE),
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
        Request::ImportArchive { directory, expected_revision } => return store.import_archive(&directory, &expected_revision),
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


/// Capture and confirm before the Host admits the first protected step.
pub fn admission(home: &Path, cwd: &Path) -> Result<serde_json::Value> {
    let scopes = scopes(home)?;
    let root = workspace(cwd)?;
    let Some(scope) = scopes.items.iter().find(|s| root.path.starts_with(&s.workspace)) else {
        return Ok(serde_json::json!({"status":"DISABLED"}));
    };
    let original = workspace(&scope.workspace)?;
    if scope.identity != original.identity { return Err("workspace identity changed".into()); }
    Ok(serde_json::json!({"status":"ARMED","workspace":scope.workspace}))
}
/// Capture and confirm before the Host admits the first protected step.
pub fn begin(home: &Path, cwd: &Path, binding: TaskBinding, expires_at: u64) -> Result<serde_json::Value> {
    check_deadline(expires_at)?;
    let scopes = scopes(home)?;
    let root = workspace(cwd)?;
    let Some(scope) = scopes.items.iter().find(|s| root.path.starts_with(&s.workspace)) else {
        return Ok(serde_json::json!({"status":"DISABLED"}));
    };
    let original = workspace(&scope.workspace)?;
    if scope.identity != original.identity { return Err("workspace identity changed".into()); }
    let store = Store::open(home)?;
    let summary = store.capture_task(&scope.workspace, scope.paths.clone(), binding.clone(), expires_at)?;
    store.confirm_task(&summary.id, &binding)?;
    Ok(serde_json::json!({"status":"CONFIRMED","id":summary.id,"binding":binding,"workspace":scope.workspace}))
}
/// Recheck pinned workspace identity and the exact confirmed task before each tool dispatch.
pub fn check(home: &Path, id: &str, binding: &TaskBinding) -> Result<()> {
    let store = Store::open(home)?;
    let start = store.record(id, "start.json")?;
    let root = workspace(&start.root)?;
    if start.root_identity != root.identity { return Err("workspace identity changed".into()); }
    let scopes = scopes(home)?;
    if !scopes.items.iter().any(|s| s.workspace == root.path && s.identity == root.identity) { return Err("scope changed".into()); }
    store.confirm_task(id, binding)?;
    Ok(())
}
