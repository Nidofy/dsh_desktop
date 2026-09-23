//! Connections select model/network settings. Workspace history is shared.
use crate::config::{self, Connection};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    #[default]
    Inherit,
    Direct,
    Explicit,
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Network {
    #[serde(default)]
    pub proxy_mode: ProxyMode,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub no_proxy: String,
    #[serde(default)]
    pub ca_file: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub connection: Connection,
    #[serde(default)]
    pub network: Network,
    #[serde(default)]
    pub credential_ref: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub revision: u64,
    pub active_id: String,
    pub profiles: Vec<Profile>,
}
fn valid_id(id: &str) -> bool {
    id == "legacy"
        || (id.len() == 34
            && id.starts_with("p-")
            && id[2..]
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}
pub(crate) fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    unsafe {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        if BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            16,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        ) != 0
        {
            return Err("Cannot allocate connection identity".into());
        }
    }
    Ok(format!(
        "p-{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
pub fn credential_id(id: &str) -> String {
    format!("connection-profile-v1/{id}")
}
pub fn home(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid connection identity".into());
    }
    Ok(root.join("dsh"))
}
pub fn legacy_home(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("Invalid connection identity".into()); }
    Ok(if id == "legacy" { root.join("dsh") } else { root.join("profiles").join(id).join("dsh") })
}
pub fn active(catalog: &Catalog) -> Result<&Profile, String> {
    catalog
        .profiles
        .iter()
        .find(|p| p.id == catalog.active_id)
        .ok_or("Active connection is missing".into())
}
pub fn validate_network(n: &Network) -> Result<(), String> {
    if n.no_proxy.len() > 4096 || n.no_proxy.chars().any(char::is_control) {
        return Err("Invalid proxy bypass list".into());
    }
    if n.proxy_mode == ProxyMode::Explicit {
        let u = url::Url::parse(&n.proxy_url).map_err(|_| "代理地址须为完整 HTTP(S) URL")?;
        if n.proxy_url.len() > 2048
            || !matches!(u.scheme(), "http" | "https")
            || u.host_str().is_none()
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != "/"
        {
            return Err("代理仅支持不含凭据、路径或参数的 HTTP(S) 地址。".into());
        }
    } else if !n.proxy_url.is_empty() || !n.no_proxy.is_empty() {
        return Err("仅自定义代理模式接受代理地址和绕过列表。".into());
    }
    if !n.ca_file.is_empty() {
        let path = Path::new(&n.ca_file);
        if n.ca_file.len() > 4096
            || n.ca_file.chars().any(char::is_control)
            || !path.is_absolute()
            || !path.is_file()
        {
            return Err("企业 CA 须为当前可读的绝对文件路径。".into());
        }
        let size = fs::metadata(path)
            .map_err(|_| "Cannot inspect CA file")?
            .len();
        if size == 0 || size > 1024 * 1024 {
            return Err("CA 文件须为 1 字节至 1 MiB 的 PEM 证书。".into());
        }
    }
    Ok(())
}
pub(crate) fn validate_catalog(c: &Catalog) -> Result<(), String> {
    if c.schema_version != 1 || c.profiles.is_empty() || c.profiles.len() > 32 {
        return Err("Unsupported connection catalog".into());
    }
    let mut seen = std::collections::HashSet::new();
    for p in &c.profiles {
        if !valid_id(&p.id)
            || !seen.insert(&p.id)
            || (!p.credential_ref.is_empty()
                && (!valid_id(&p.credential_ref) || p.credential_ref == "legacy"))
        {
            return Err("Invalid or duplicate connection identity".into());
        }
        // A first-launch legacy slot can be empty. File existence is checked at
        // activation, so one disconnected CA drive cannot hide other profiles.
        if !p.connection.base_url.is_empty() {
            config::validate(&p.connection)?;
        }
    }
    active(c)?;
    Ok(())
}
pub fn load(root: &Path) -> Result<Catalog, String> {
    let path = root.join("connections.json");
    if !path.exists() {
        return Ok(Catalog {
            schema_version: 1,
            revision: 0,
            active_id: "legacy".into(),
            profiles: vec![Profile {
                id: "legacy".into(),
                connection: config::load(root)?,
                network: Network::default(),
                credential_ref: String::new(),
            }],
        });
    }
    if fs::metadata(&path)
        .map_err(|_| "Cannot inspect connection catalog")?
        .len()
        > 2 * 1024 * 1024
    {
        return Err("Connection catalog too large".into());
    }
    let mut catalog: Catalog =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read connection catalog")?)
            .map_err(|_| "Invalid connection catalog; original file preserved")?;
    for p in &mut catalog.profiles {p.connection.preserve_legacy_capabilities();}
    validate_catalog(&catalog)?;
    Ok(catalog)
}
fn persist(root: &Path, c: &mut Catalog) -> Result<(), String> {
    validate_catalog(c)?;
    c.revision = c
        .revision
        .checked_add(1)
        .ok_or("Connection revision overflow")?;
    let path = root.join("connections.json");
    let temp = root.join("connections.new.json");
    let mut file = fs::File::create(&temp).map_err(|_| "Cannot stage connection catalog")?;
    file.write_all(&serde_json::to_vec_pretty(c).map_err(|_| "Cannot encode connection catalog")?)
        .map_err(|_| "Cannot write connection catalog")?;
    file.sync_all()
        .map_err(|_| "Cannot flush connection catalog")?;
    drop(file);
    if path.exists() {
        fs::copy(&path, root.join("connections.previous.json"))
            .map_err(|_| "Cannot back up connection catalog")?;
    }
    fs::rename(&temp, &path).map_err(|_| "Cannot commit connection catalog")?;
    Ok(())
}
fn check_revision(c: &Catalog, expected: u64) -> Result<(), String> {
    if c.revision != expected {
        Err("连接配置已变化，请重新载入后再保存。".into())
    } else {
        Ok(())
    }
}
pub fn key(root: &Path, p: &Profile) -> Result<String, String> {
    let saved = if p.credential_ref.is_empty() {
        String::new()
    } else {
        config::read_key(&credential_id(&p.credential_ref))?
    };
    if !saved.is_empty() {
        return Ok(saved);
    }
    // Read-only compatibility until the first catalog save. Never use a URL key
    // for a new profile, even if it happens to share the same endpoint.
    if p.id == "legacy" && !root.join("connections.json").exists() {
        return config::read_key(&p.connection.base_url);
    }
    Ok(String::new())
}
#[derive(Default)]
pub(crate) struct StagedCredentials {
    ids: Vec<String>,
    pub(crate) committed: bool,
}
impl StagedCredentials {
    pub(crate) fn write(&mut self, key: &str) -> Result<String, String> {
        let id = new_id()?;
        self.ids.push(credential_id(&id));
        config::write_key(&credential_id(&id), key)?;
        Ok(id)
    }
}
impl Drop for StagedCredentials {
    fn drop(&mut self) {
        if !self.committed {
            for id in &self.ids {
                config::delete_key(id);
            }
        }
    }
}
fn migrate_legacy_key(
    root: &Path,
    c: &mut Catalog,
    staged: &mut StagedCredentials,
) -> Result<(), String> {
    if !root.join("connections.json").exists() {
        if let Some(p) = c.profiles.iter_mut().find(|p| p.id == "legacy") {
            let old = config::read_key(&p.connection.base_url)?;
            if !old.is_empty() {
                p.credential_ref = staged.write(&old)?;
            }
        }
    }
    Ok(())
}
pub fn save(
    root: &Path,
    id: Option<String>,
    mut connection: Connection,
    network: Network,
    api_key: &str,
    revision: u64,
) -> Result<Catalog, String> {
    for model in connection.model_ids(){let binding=connection.capability_binding(&model);let cap=connection.model_capabilities.entry(model).or_insert(config::ModelCapability{source:"unknown".into(),reasoning:None,binding:String::new()});
        if !cap.binding.is_empty()&&cap.binding!=binding{cap.source="unknown".into();cap.reasoning=None;}cap.binding=binding;}
    config::validate(&connection)?;
    validate_network(&network)?;
    let mut c = load(root)?;
    check_revision(&c, revision)?;
    let profile_id = match id {
        Some(id) => {
            c
                .profiles
                .iter()
                .find(|p| p.id == id)
                .ok_or("Connection no longer exists")?;
            id
        }
        None => {
            if c.profiles.len() >= 32 {
                return Err("最多保留 32 个连接。".into());
            }
            new_id()?
        }
    };
    if api_key.is_empty() && !c.profiles.iter().any(|p| p.id == profile_id) {
        return Err("请输入此连接独立的 API Key。".into());
    }
    let mut staged = StagedCredentials::default();
    migrate_legacy_key(root, &mut c, &mut staged)?;
    let mut credential_ref = c
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .map(|p| p.credential_ref.clone())
        .unwrap_or_default();
    // Never overwrite the live credential before the catalog commit succeeds.
    // The previous reference remains usable by connections.previous.json.
    if !api_key.is_empty() {
        credential_ref = staged.write(api_key)?;
    }
    if credential_ref.is_empty() || config::read_key(&credential_id(&credential_ref))?.is_empty() {
        return Err("请输入此连接独立的 API Key。".into());
    }
    let p = Profile {
        id: profile_id,
        connection,
        network,
        credential_ref,
    };
    if let Some(previous) = c.profiles.iter_mut().find(|previous| previous.id == p.id) {
        *previous = p;
    } else {
        c.profiles.push(p);
    }
    persist(root, &mut c)?;
    staged.committed = true;
    Ok(c)
}
pub fn remove(root: &Path, id: &str, replacement: Option<&str>, revision: u64) -> Result<Catalog, String> {
    let mut c = load(root)?;
    check_revision(&c, revision)?;
    if !c.profiles.iter().any(|p| p.id == id) { return Err("连接已不存在，请重新载入。".into()); }
    if c.active_id == id && c.profiles.len() > 1 {
        let next = c.profiles.iter().find(|p| Some(p.id.as_str()) == replacement && p.id != id).ok_or("请选择删除后使用的连接。")?;
        config::validate(&next.connection)?;
        validate_network(&next.network)?;
        if key(root, next)?.is_empty() { return Err("替代连接缺少 API Key。".into()); }
        c.active_id = next.id.clone();
    }
    let mut staged = StagedCredentials::default();
    migrate_legacy_key(root, &mut c, &mut staged)?;
    c.profiles.retain(|p| p.id != id);
    if c.profiles.is_empty() {
        c.active_id = "legacy".into();
        c.profiles.push(Profile { id:"legacy".into(), connection:Connection::default(), network:Network::default(), credential_ref:String::new() });
    }
    // Keep history and the credential referenced by the rollback backup.
    persist(root, &mut c)?;
    staged.committed = true;
    Ok(c)
}
pub fn activate(root: &Path, id: &str, revision: u64) -> Result<Catalog, String> {
    let mut c = load(root)?;
    check_revision(&c, revision)?;
    let p = c
        .profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or("Connection no longer exists")?;
    config::validate(&p.connection)?;
    validate_network(&p.network)?;
    if key(root, p)?.is_empty() {
        return Err("此连接缺少凭据，请先保存 API Key。".into());
    }
    let mut staged = StagedCredentials::default();
    migrate_legacy_key(root, &mut c, &mut staged)?;
    c.active_id = id.to_owned();
    persist(root, &mut c)?;
    staged.committed = true;
    Ok(c)
}
pub fn configure_process(command: &mut Command, n: &Network) -> Result<(), String> {
    validate_network(n)?;
    // DSH's native dsh-http-proxy owns fetch and child routing. Explicit blanks
    // prevent a workspace .env from restoring ambient proxies in direct mode.
    if n.proxy_mode != ProxyMode::Inherit {
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(name, "");
        }
        for name in ["NO_PROXY", "no_proxy"] {
            command.env(
                name,
                if n.proxy_mode == ProxyMode::Direct {
                    "*"
                } else {
                    &n.no_proxy
                },
            );
        }
        if n.proxy_mode == ProxyMode::Explicit {
            for name in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
                command.env(name, &n.proxy_url);
            }
        }
    }
    command
        .env_remove("NODE_USE_ENV_PROXY")
        .env("NODE_TLS_REJECT_UNAUTHORIZED", "1");
    command.env_remove("NODE_EXTRA_CA_CERTS");
    if !n.ca_file.is_empty() {
        command.env("NODE_EXTRA_CA_CERTS", &n.ca_file);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Credentials(Vec<String>);
    impl Drop for Credentials {
        fn drop(&mut self) {
            for id in &self.0 {
                config::delete_test_key(id);
            }
        }
    }
    fn keep(cleanup: &mut Credentials, catalog: &Catalog) {
        for p in &catalog.profiles {
            if !p.credential_ref.is_empty() {
                cleanup.0.push(credential_id(&p.credential_ref));
            }
        }
    }
    #[test]
    fn profiles_share_history_support_edits_and_preserve_credentials() {
        let _credential_lock = config::CREDENTIAL_TEST_LOCK.lock().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build")
            .join(format!("profiles-{}", new_id().unwrap()));
        fs::create_dir_all(root.join("dsh")).unwrap();
        fs::write(
            root.join("dsh/history-fixture.txt"),
            "legacy-private-conversation",
        )
        .unwrap();
        let legacy = Connection {
            base_url: "http://127.0.0.1:22345/v1".into(),
            model: "model".into(),
            ..Default::default()
        };
        let mut cleanup = Credentials(vec![legacy.base_url.clone()]);
        config::save(&root, &legacy, "legacy-fixture-key").unwrap();
        let original = fs::read(root.join("connection.json")).unwrap();
        let c = load(&root).unwrap();
        assert_eq!(c.revision, 0);
        assert_eq!(
            key(&root, active(&c).unwrap()).unwrap(),
            "legacy-fixture-key"
        );
        assert!(
            save(&root, None, legacy.clone(), Network::default(), "", 0).is_err(),
            "new profile cannot inherit URL credential"
        );
        let c = save(
            &root,
            Some("legacy".into()),
            legacy.clone(),
            Network::default(),
            "",
            0,
        )
        .unwrap();
        keep(&mut cleanup, &c);
        assert_eq!(fs::read(root.join("connection.json")).unwrap(), original);
        assert_eq!(
            key(&root, active(&c).unwrap()).unwrap(),
            "legacy-fixture-key"
        );
        let c = save(
            &root,
            None,
            legacy.clone(),
            Network::default(),
            "external-fixture-key",
            c.revision,
        )
        .unwrap();
        keep(&mut cleanup, &c);
        let external = c.profiles[1].id.clone();
        assert_eq!(key(&root, &c.profiles[1]).unwrap(), "external-fixture-key");
        assert_eq!(home(&root,"legacy").unwrap(),home(&root,&external).unwrap());
        assert_eq!(fs::read_to_string(home(&root,&external).unwrap().join("history-fixture.txt")).unwrap(),"legacy-private-conversation");
        assert!(
            save(
                &root,
                Some(external.clone()),
                legacy.clone(),
                Network::default(),
                "",
                0
            )
            .is_err(),
            "stale UI rejected"
        );
        let mut changed = legacy.clone();
        changed.base_url = "https://another.example/v1".into();
        changed.api = config::ApiFormat::Anthropic;
        let c = save(&root,Some(external.clone()),changed,Network::default(),"",c.revision).unwrap();
        assert_eq!(c.profiles[1].connection.base_url,"https://another.example/v1");
        assert_eq!(c.profiles[1].connection.api,config::ApiFormat::Anthropic);
        let c = activate(&root, &external, c.revision).unwrap();
        assert_eq!(c.active_id, external);
        let c = activate(&root, "legacy", c.revision).unwrap();
        assert_eq!(
            fs::read_to_string(home(&root, "legacy").unwrap().join("history-fixture.txt")).unwrap(),
            "legacy-private-conversation"
        );
        let previous = active(&c).unwrap().clone();
        let c = save(
            &root,
            Some("legacy".into()),
            legacy.clone(),
            Network::default(),
            "rotated-fixture-key",
            c.revision,
        )
        .unwrap();
        keep(&mut cleanup, &c);
        assert_eq!(
            key(&root, active(&c).unwrap()).unwrap(),
            "rotated-fixture-key"
        );
        assert_eq!(
            key(&root, &previous).unwrap(),
            "legacy-fixture-key",
            "rollback keeps old credential"
        );
        assert_eq!(
            key(&root, &c.profiles[1]).unwrap(),
            "external-fixture-key",
            "same endpoint but independent credentials"
        );
        for file in [
            "connections.json",
            "connections.previous.json",
            "connection.json",
        ] {
            let text = fs::read_to_string(root.join(file)).unwrap();
            assert!(!text.contains("fixture-key"));
        }
        let mut invalid = c.clone();
        invalid.profiles[1].id = "../escape".into();
        assert!(persist(&root, &mut invalid).is_err());
        assert!(home(&root, "../escape").is_err());
        assert!(remove(&root,"legacy",None,c.revision).is_err(),"active deletion needs a replacement");
        assert!(remove(&root,&external,None,0).is_err(),"stale delete is refused");
        let c=remove(&root,&external,None,c.revision).unwrap();
        assert_eq!(c.profiles.len(),1);
        let c=remove(&root,"legacy",None,c.revision).unwrap();
        assert!(active(&c).unwrap().connection.base_url.is_empty());
        assert_eq!(fs::read_to_string(root.join("dsh/history-fixture.txt")).unwrap(),"legacy-private-conversation");
        fs::write(root.join("connections.json"), "{broken").unwrap();
        assert!(
            load(&root).is_err(),
            "corrupt catalog never silently falls back to a different service"
        );
    }
    #[test]
    fn network_policy_validates_and_exports_native_launch_environment() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build/profile-network-fixtures");
        fs::create_dir_all(&root).unwrap();
        for (name, network) in [
            (
                "direct",
                Network {
                    proxy_mode: ProxyMode::Direct,
                    ..Default::default()
                },
            ),
            ("inherit", Network::default()),
            (
                "explicit",
                Network {
                    proxy_mode: ProxyMode::Explicit,
                    proxy_url: "http://127.0.0.1:9876".into(),
                    no_proxy: ".corp.example".into(),
                    ..Default::default()
                },
            ),
        ] {
            let mut command = Command::new("node");
            configure_process(&mut command, &network).unwrap();
            let env: std::collections::BTreeMap<String, Option<String>> = command
                .get_envs()
                .map(|(k, v)| {
                    (
                        k.to_string_lossy().to_string(),
                        v.map(|v| v.to_string_lossy().to_string()),
                    )
                })
                .collect();
            assert_eq!(
                env.get("NODE_TLS_REJECT_UNAUTHORIZED"),
                Some(&Some("1".into()))
            );
            assert_eq!(env.get("NODE_EXTRA_CA_CERTS"), Some(&None));
            if name == "direct" {
                assert_eq!(env.get("NO_PROXY"), Some(&Some("*".into())));
                assert_eq!(env.get("HTTP_PROXY"), Some(&Some("".into())));
            }
            fs::write(
                root.join(format!("{name}.json")),
                serde_json::to_vec(&env).unwrap(),
            )
            .unwrap();
        }
        for url in [
            "socks5://localhost:1080",
            "http://user:password@localhost:8080",
            "http://localhost/path",
            "http://localhost/?token=x",
            "bad",
        ] {
            assert!(validate_network(&Network {
                proxy_mode: ProxyMode::Explicit,
                proxy_url: url.into(),
                ..Default::default()
            })
            .is_err());
        }
        assert!(validate_network(&Network {
            ca_file: "relative.pem".into(),
            ..Default::default()
        })
        .is_err());
        assert!(validate_network(&Network {
            proxy_mode: ProxyMode::Direct,
            proxy_url: "http://localhost".into(),
            ..Default::default()
        })
        .is_err());
        let mut c = Connection {
            base_url: "http://localhost/v1".into(),
            model: "m".into(),
            ..Default::default()
        };
        c.timeout_ms = 0;
        assert!(config::validate(&c).is_err());
        c.timeout_ms = 300000;
        c.stream_idle_timeout_ms = 7200001;
        assert!(config::validate(&c).is_err());
    }
}
