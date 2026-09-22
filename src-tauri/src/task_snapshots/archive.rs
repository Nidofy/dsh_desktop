//! Plain-directory snapshot archives: portable bytes plus a bounded exact-tree
//! manifest. No extraction, implicit workspace writes or automatic deletion.
use super::*;
const MAX_FILES: usize = MAX_PATHS * 4 + 8;
const MANIFEST: &str = "archive-manifest.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Archive {
    format: String,
    version: u32,
    snapshot_id: String,
    exported_at: u64,
    files: Vec<ArchiveFile>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArchiveFile {
    name: String,
    bytes: usize,
    sha256: String,
}
struct Source {
    name: String,
    file: File,
}
fn allowed(name: &str) -> bool {
    if [
        "start.json",
        "end.json",
        "task-intent.json",
        "confirmed.json",
        "end-intent.json",
    ]
    .contains(&name)
    {
        return true;
    }
    for (prefix, suffix) in [
        ("before-", ".bin"),
        ("pre-restore-", ".bin"),
        ("restore-", ".json"),
        ("result-", ".json"),
    ] {
        if let Some(index) = name
            .strip_prefix(prefix)
            .and_then(|s| s.strip_suffix(suffix))
        {
            if let Ok(value) = index.parse::<usize>() {
                return value < MAX_PATHS && value.to_string() == index;
            }
        }
    }
    false
}
fn sources(folder: &Path, archived: bool) -> Result<Vec<Source>> {
    let mut files = Vec::new();
    for item in fs::read_dir(folder).map_err(|_| "无法读取归档目录")? {
        let item = item.map_err(|_| "无法读取归档项目")?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "不支持的归档文件名")?;
        if archived && name == MANIFEST {
            continue;
        }
        if !allowed(&name) || files.len() >= MAX_FILES {
            return Err("归档包含未知文件或超过数量上限".into());
        }
        let file = file_open(&item.path(), false, false).map_err(|_| "归档文件不可读或被占用")?;
        let meta = info(&file)?;
        if meta.dwFileAttributes
            & (FILE_ATTRIBUTE_DIRECTORY
                | FILE_ATTRIBUTE_REPARSE_POINT
                | FILE_ATTRIBUTE_OFFLINE
                | FILE_ATTRIBUTE_ENCRYPTED)
            != 0
            || meta.nNumberOfLinks != 1
        {
            return Err("归档只接受普通文件".into());
        }
        unnamed_stream_only(&file)?;
        files.push(Source { name, file });
    }
    if !files.iter().any(|s| s.name == "start.json") {
        return Err("归档缺少完整开始记录".into());
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}
fn inventory(files: &mut [Source]) -> Result<Vec<ArchiveFile>> {
    let mut result = Vec::new();
    let mut total = 0u64;
    for source in files {
        let data = bytes(&mut source.file)?;
        total += data.len() as u64;
        if total > MAX_STORE {
            return Err("归档超过 256 MiB".into());
        }
        result.push(ArchiveFile {
            name: source.name.clone(),
            bytes: data.len(),
            sha256: hash(&data),
        });
    }
    Ok(result)
}
fn validate_start(folder: &Path, id: &str) -> Result<Record> {
    let start: Record = read_json(&folder.join("start.json"))?;
    if start.version != 1
        || start.id != id
        || !hex(id, 32)
        || !start.root.is_absolute()
        || start.root_identity.is_empty()
    {
        return Err("归档开始记录无效".into());
    }
    validate_paths(
        &start
            .entries
            .iter()
            .map(|e| e.path.clone())
            .collect::<Vec<_>>(),
    )?;
    let mut total = 0;
    for (i, entry) in start.entries.iter().enumerate() {
        if let State::File { hash, size, .. } = &entry.state {
            if !hex(hash, 64) || *size > MAX_FILE {
                return Err("归档内容描述无效".into());
            }
            total += size;
        }
        if total > MAX_CAPTURE {
            return Err("归档开始内容超过 32 MiB".into());
        }
        original_bytes(folder, i, &entry.state)?;
    }
    if let Some(task) = &start.task {
        task.binding.validate()?;
        if task.binding.snapshot_id() != id || start.created_at >= task.expires_at {
            return Err("归档任务身份无效".into());
        }
    }
    Ok(start)
}
fn checked(directory: &Path) -> Result<(PinnedDirs, Archive, Vec<Source>, Record)> {
    let folder = workspace(directory)?;
    // Keep the manifest handle pinned as well: replacement cannot race the
    // payload check and import while these guards remain alive.
    let mut manifest = file_open(&folder.path.join(MANIFEST), false, false)
        .map_err(|_| "归档清单不存在或不可读")?;
    let raw = bytes(&mut manifest)?;
    if raw.len() > 256 * 1024 {
        return Err("归档清单过大".into());
    }
    let archive: Archive = serde_json::from_slice(&raw).map_err(|_| "归档清单无效")?;
    if archive.format != "dsh-desktop-snapshot-archive"
        || archive.version != 1
        || !hex(&archive.snapshot_id, 32)
        || archive.files.is_empty()
        || archive.files.len() > MAX_FILES
    {
        return Err("不支持的归档格式".into());
    }
    let mut files = sources(&folder.path, true)?;
    let actual = inventory(&mut files)?;
    if actual.len() != archive.files.len()
        || actual
            .iter()
            .zip(&archive.files)
            .any(|(a, b)| a.name != b.name || a.bytes != b.bytes || a.sha256 != b.sha256)
    {
        return Err("归档文件缺失、额外增加或校验不匹配".into());
    }
    let start = validate_start(&folder.path, &archive.snapshot_id)?;
    // The payload handles are all pinned; the parsed manifest is now immutable
    // in memory and no later operation trusts a second on-disk manifest read.
    Ok((folder, archive, files, start))
}
fn receipt(folder: &Path, archive: &Archive, start: &Record) -> serde_json::Value {
    serde_json::json!({"directory":folder,"snapshotId":archive.snapshot_id,"files":archive.files.len(),"bytes":archive.files.iter().map(|f|f.bytes as u64).sum::<u64>(),"workspace":start.root,"paths":start.entries.iter().map(|e|&e.path).collect::<Vec<_>>(),"verified":true})
}
pub(super) fn verify(directory: &Path) -> Result<serde_json::Value> {
    let (folder, archive, _files, start) = checked(directory)?;
    Ok(receipt(&folder.path, &archive, &start))
}
impl Store {
    pub(super) fn export_archive(&self, id: &str, destination: &Path) -> Result<serde_json::Value> {
        let source = self.dir(id)?;
        let start = validate_start(&source.path, id)?;
        let mut files = sources(&source.path, false)?;
        let archive = Archive {
            format: "dsh-desktop-snapshot-archive".into(),
            version: 1,
            snapshot_id: id.into(),
            exported_at: now(),
            files: inventory(&mut files)?,
        };
        let destination = workspace_mode(destination, false)?;
        let target = destination
            .path
            .join(format!("DSH-snapshot-{id}-{}", random_id()?));
        if target.starts_with(&start.root) || target.starts_with(&self.pinned.path) {
            return Err("请选择工程和快照存储之外的归档目录".into());
        }
        fs::create_dir(&target).map_err(|_| "无法创建新的归档目录")?;
        let _pin = pin_dirs(&target)?;
        for file in &mut files {
            write_new(&target.join(&file.name), &bytes(&mut file.file)?)?;
        }
        // Commit marker comes last. A failed export has no valid manifest and
        // leaves the original snapshot untouched; no cleanup is implicit.
        json_new(&target.join(MANIFEST), &archive)?;
        let verified = verify(&target)?;
        if sources(&source.path, false)?.len() != files.len() {
            return Err("导出期间源目录发生变化；请重新检查归档".into());
        }
        Ok(verified)
    }
    pub(super) fn import_archive(&self, directory: &Path) -> Result<serde_json::Value> {
        let (_folder, archive, mut files, start) = checked(directory)?;
        if self.pinned.path.starts_with(&start.root) || start.root.starts_with(&self.pinned.path) {
            return Err("归档工作区与当前快照存储不能互相包含".into());
        }
        let size = archive.files.iter().map(|f| f.bytes as u64).sum();
        self.budget(size, true)?;
        let target = self.pinned.path.join(&archive.snapshot_id);
        // Create-only: an existing original or partial import is never replaced.
        fs::create_dir(&target).map_err(|_| "同编号快照已存在或目标不可写；不会覆盖")?;
        let _pin = pin_dirs(&target)?;
        files.sort_by_key(|s| s.name == "start.json");
        for file in &mut files {
            let data = bytes(&mut file.file)?;
            write_new(&target.join(&file.name), &data)?;
            let mut written = file_open(&target.join(&file.name), false, false)
                .map_err(|_| "无法复核导入文件")?;
            if bytes(&mut written)? != data {
                return Err("导入写入后校验失败；已保留部分文件".into());
            }
        }
        validate_start(&target, &archive.snapshot_id)?;
        Ok(
            serde_json::json!({"snapshot":self.summary(&self.record(&archive.snapshot_id,"start.json")?),"imported":true}),
        )
    }
}
