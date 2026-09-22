//! Explicit configuration recovery. No engine control, network requests, or
//! history-directory mutations happen here. Native callers hold save_lock.
use crate::{
    config,
    profiles::{self, Catalog, Network, Profile, StagedCredentials},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::os::windows::fs::MetadataExt;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
const LIMIT: usize = 2 * 1024 * 1024;
const SOURCES: [(&str, &str, &str); 3] = [
    (
        "previous",
        "connections.previous.json",
        "上一次保存前的配置",
    ),
    (
        "before-restore",
        "connections.recovery-before.json",
        "上一次回退前的配置",
    ),
    ("legacy", "connection.json", "旧版单连接配置"),
];
fn source_path(source: &str) -> Result<&'static str, String> {
    SOURCES
        .iter()
        .find(|row| row.0 == source)
        .map(|row| row.1)
        .ok_or("无效备份来源".into())
}
fn bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取配置文件信息".into()),
    };
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > LIMIT as u64 {
        return Err("配置不是普通文件、是链接或超过 2 MiB".into());
    }
    let mut data = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法打开配置文件")?
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|_| "无法读取配置文件")?;
    if data.len() > LIMIT {
        return Err("配置文件超过 2 MiB".into());
    }
    Ok(Some(data))
}
fn parse(source: &str, data: &[u8]) -> Result<Catalog, String> {
    let catalog = if source == "legacy" {
        let connection: config::Connection =
            serde_json::from_slice(data).map_err(|_| "旧版连接配置无法解析")?;
        config::validate(&connection)?;
        Catalog {
            schema_version: 1,
            revision: 0,
            active_id: "legacy".into(),
            profiles: vec![Profile {
                id: "legacy".into(),
                connection,
                network: Network::default(),
                credential_ref: String::new(),
            }],
        }
    } else {
        serde_json::from_slice(data).map_err(|_| "备份格式损坏或不受当前版本支持")?
    };
    profiles::validate_catalog(&catalog)?;
    Ok(catalog)
}
fn token(source: &str, current: Option<&[u8]>, backup: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"desktop-profile-recovery-v1\0");
    hash.update(source.as_bytes());
    hash.update([u8::from(current.is_some())]);
    if let Some(data) = current {
        hash.update(Sha256::digest(data));
    }
    hash.update(Sha256::digest(backup));
    format!("{:x}", hash.finalize())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    id: String,
    name: String,
    endpoint: String,
    api: config::ApiFormat,
    models: usize,
    credential_available: bool,
    network_ready: bool,
    active: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    source: String,
    label: String,
    available: bool,
    error: Option<String>,
    token: Option<String>,
    profiles: Vec<Row>,
    removed_profiles: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    current_status: String,
    candidates: Vec<Candidate>,
}
fn available_key(root: &Path, source: &str, p: &Profile) -> bool {
    if source == "legacy" {
        config::read_key(&p.connection.base_url).is_ok_and(|s| !s.is_empty())
    } else {
        profiles::key(root, p).is_ok_and(|s| !s.is_empty())
    }
}
fn boundaries(current: &Catalog, candidate: &Catalog) -> Result<(), String> {
    for old in &current.profiles {
        if let Some(new) = candidate.profiles.iter().find(|p| p.id == old.id) {
            if !old.connection.base_url.is_empty()
                && (old.connection.base_url != new.connection.base_url
                    || old.connection.api != new.connection.api)
            {
                return Err("备份试图把已有会话目录改绑到另一服务，已拒绝。请新建连接。".into());
            }
        }
    }
    Ok(())
}
pub fn inspect(root: &Path) -> State {
    let current = bytes(&root.join("connections.json"));
    let parsed = current
        .as_ref()
        .ok()
        .and_then(|b| b.as_ref())
        .and_then(|b| parse("current", b).ok());
    let current_status = if parsed.is_some() {
        "CURRENT"
    } else if matches!(&current, Ok(None)) {
        "LEGACY_OR_EMPTY"
    } else {
        "INVALID"
    }
    .to_string();
    let candidates = SOURCES
        .iter()
        .map(|(source, file, label)| {
            let mut row = Candidate {
                source: source.to_string(),
                label: label.to_string(),
                available: false,
                error: None,
                token: None,
                profiles: vec![],
                removed_profiles: vec![],
            };
            let result = (|| -> Result<(), String> {
                let current = current.as_ref().map_err(|e| e.clone())?;
                let data = bytes(&root.join(file))?.ok_or("尚无此备份")?;
                let c = parse(source, &data)?;
                if let Some(old) = &parsed {
                    boundaries(old, &c)?;
                    row.removed_profiles = old
                        .profiles
                        .iter()
                        .filter(|p| !c.profiles.iter().any(|n| n.id == p.id))
                        .map(|p| p.connection.provider_name.clone())
                        .collect();
                }
                row.token = Some(token(source, current.as_deref(), &data));
                row.profiles = c
                    .profiles
                    .iter()
                    .map(|p| Row {
                        id: p.id.clone(),
                        name: p.connection.provider_name.clone(),
                        endpoint: p.connection.base_url.clone(),
                        api: p.connection.api,
                        models: p.connection.model_ids().len(),
                        credential_available: available_key(root, source, p),
                        network_ready: profiles::validate_network(&p.network).is_ok(),
                        active: p.id == c.active_id,
                    })
                    .collect();
                row.available = true;
                Ok(())
            })();
            if let Err(e) = result {
                row.error = Some(e);
            }
            row
        })
        .collect();
    State {
        current_status,
        candidates,
    }
}
fn atomic_write(root: &Path, name: &str, data: &[u8]) -> Result<(), String> {
    // create_new prevents a stale temp file or link being followed. Replacement
    // renames the fixed directory entry and does not truncate its former target.
    let temp = root.join(format!(
        ".recovery-{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "系统时间无效")?
            .as_nanos()
    ));
    let result = (|| -> Result<(), String> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "无法暂存恢复配置")?;
        f.write_all(data).map_err(|_| "无法写入恢复配置")?;
        f.sync_all().map_err(|_| "无法刷新恢复配置")?;
        drop(f);
        fs::rename(&temp, root.join(name)).map_err(|_| "无法提交恢复配置")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
pub fn restore(root: &Path, source: &str, expected: &str) -> Result<Catalog, String> {
    let backup = bytes(&root.join(source_path(source)?))?.ok_or("备份不存在")?;
    let current = bytes(&root.join("connections.json"))?;
    if token(source, current.as_deref(), &backup) != expected {
        return Err("配置或备份已变化，请重新预览后再回退。".into());
    }
    let mut next = parse(source, &backup)?;
    let old = current.as_ref().and_then(|b| parse("current", b).ok());
    if let Some(old) = &old {
        boundaries(old, &next)?;
    }
    // Jump out of ordinary old-page revisions even when current JSON is broken.
    // Remain exactly representable by the JavaScript settings UI.
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间无效")?
        .as_millis() as u64;
    next.revision = next
        .revision
        .max(old.as_ref().map(|c| c.revision).unwrap_or(0))
        .max(epoch)
        .checked_add(1024)
        .filter(|n| *n <= 9007199254740991)
        .ok_or("配置修订号超出范围")?;
    let mut staged = StagedCredentials::default();
    if source == "legacy" {
        for p in &mut next.profiles {
            let key = config::read_key(&p.connection.base_url)?;
            if !key.is_empty() {
                p.credential_ref = staged.write(&key)?;
            }
        }
    }
    let encoded = serde_json::to_vec_pretty(&next).map_err(|_| "无法编码恢复配置")?;
    // Retain the inspected current bytes before replacement. A corrupt file is
    // preserved verbatim; it is not presented as a valid automatic fallback.
    if let Some(data) = &current {
        atomic_write(root, "connections.recovery-before.json", data)?;
    }
    if bytes(&root.join("connections.json"))? != current {
        return Err("当前配置在回退期间变化，已停止；请重新预览。".into());
    }
    atomic_write(root, "connections.json", &encoded)?;
    staged.committed = true;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build")
            .join(format!(
                "profile-recovery-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn catalog(model: &str, revision: u64) -> Catalog {
        Catalog {
            schema_version: 1,
            revision,
            active_id: "legacy".into(),
            profiles: vec![Profile {
                id: "legacy".into(),
                connection: config::Connection {
                    provider_name: "Test".into(),
                    base_url: "http://127.0.0.1:25641/v1".into(),
                    model: model.into(),
                    ..Default::default()
                },
                network: Network::default(),
                credential_ref: String::new(),
            }],
        }
    }
    fn write(root: &Path, file: &str, c: &Catalog) {
        fs::write(root.join(file), serde_json::to_vec(c).unwrap()).unwrap();
    }
    fn preview(root: &Path, source: &str) -> String {
        inspect(root)
            .candidates
            .into_iter()
            .find(|c| c.source == source)
            .unwrap()
            .token
            .unwrap()
    }
    #[test]
    fn recovery_preserves_broken_current_and_has_no_automatic_fallback() {
        let r = root();
        write(&r, "connections.previous.json", &catalog("old", 9));
        fs::write(r.join("connections.json"), b"{broken").unwrap();
        assert!(profiles::load(&r).is_err());
        assert_eq!(inspect(&r).current_status, "INVALID");
        let c = restore(&r, "previous", &preview(&r, "previous")).unwrap();
        assert_eq!(c.profiles[0].connection.model, "old");
        assert!(c.revision > 10);
        assert_eq!(
            fs::read(r.join("connections.recovery-before.json")).unwrap(),
            b"{broken"
        );
        assert!(
            !inspect(&r)
                .candidates
                .iter()
                .find(|c| c.source == "before-restore")
                .unwrap()
                .available
        );
        assert!(r.join("connections.previous.json").exists());
    }
    #[test]
    fn recovery_refuses_stale_files_rebinding_and_backup_failure() {
        let r = root();
        let current = catalog("current", 10);
        let old = catalog("old", 9);
        write(&r, "connections.json", &current);
        write(&r, "connections.previous.json", &old);
        let token = preview(&r, "previous");
        write(&r, "connections.json", &catalog("concurrent", 11));
        assert!(restore(&r, "previous", &token).is_err());
        let token = preview(&r, "previous");
        write(
            &r,
            "connections.previous.json",
            &catalog("changed-backup", 8),
        );
        assert!(restore(&r, "previous", &token).is_err());
        let mut bad = old.clone();
        bad.profiles[0].connection.base_url = "https://other.invalid/v1".into();
        write(&r, "connections.previous.json", &bad);
        assert!(!inspect(&r).candidates[0].available);
        write(&r, "connections.previous.json", &old);
        fs::create_dir(r.join("connections.recovery-before.json")).unwrap();
        let before = fs::read(r.join("connections.json")).unwrap();
        assert!(restore(&r, "previous", &preview(&r, "previous")).is_err());
        assert_eq!(before, fs::read(r.join("connections.json")).unwrap());
        assert!(restore(&r, "../escape", &token).is_err());
    }
    #[test]
    fn recovery_can_undo_and_preserves_all_history_and_unavailable_ca() {
        let r = root();
        let old = catalog("old", 9);
        let mut current = catalog("current", 10);
        current.profiles[0].network.ca_file = "Z:\\missing-fixture-ca.pem".into();
        write(&r, "connections.json", &current);
        write(&r, "connections.previous.json", &old);
        fs::create_dir_all(r.join("dsh/sessions")).unwrap();
        fs::write(r.join("dsh/sessions/fixture"), "history").unwrap();
        let a = restore(&r, "previous", &preview(&r, "previous")).unwrap();
        let state = inspect(&r);
        let row = state
            .candidates
            .iter()
            .find(|c| c.source == "before-restore")
            .unwrap();
        assert!(row.available);
        assert!(!row.profiles[0].network_ready);
        let b = restore(&r, "before-restore", row.token.as_ref().unwrap()).unwrap();
        assert_eq!(b.profiles[0].connection.model, "current");
        assert!(b.revision > a.revision);
        assert!(profiles::activate(&r, "legacy", 10).is_err());
        assert_eq!(
            fs::read_to_string(r.join("dsh/sessions/fixture")).unwrap(),
            "history"
        );
    }
    #[test]
    fn recovery_migrates_legacy_credential_without_json_secret() {
        let _guard = config::CREDENTIAL_TEST_LOCK.lock().unwrap();
        let r = root();
        let c = catalog("legacy-model", 0).profiles[0].connection.clone();
        config::save(&r, &c, "recovery-fixture-secret").unwrap();
        let restored = restore(&r, "legacy", &preview(&r, "legacy")).unwrap();
        let p = &restored.profiles[0];
        assert_eq!(profiles::key(&r, p).unwrap(), "recovery-fixture-secret");
        assert!(!p.credential_ref.is_empty());
        assert!(!fs::read_to_string(r.join("connections.json"))
            .unwrap()
            .contains("recovery-fixture-secret"));
        config::delete_key(&profiles::credential_id(&p.credential_ref));
        config::delete_key(&c.base_url);
    }
}
