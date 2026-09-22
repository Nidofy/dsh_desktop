use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Bubble {
    pub placement: String,
    pub font_size: u32,
    pub duration_ms: u64,
    pub theme: String,
    pub templates: std::collections::BTreeMap<String, String>,
}
impl Default for Bubble {
    fn default() -> Self {
        Self {
            placement: "top".into(),
            font_size: 14,
            duration_ms: 5000,
            theme: "dark".into(),
            templates: Default::default(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Instance {
    pub id: String,
    pub enabled: bool,
    pub resource: String,
    pub x: f64,
    pub y: f64,
    pub monitor: Option<String>,
    pub scale: f64,
    pub pinned: Option<String>,
    pub profile: Option<String>,
    pub interaction: bool,
    pub look: bool,
    pub mood_enabled: bool,
    pub affinity: u32,
    pub mood: String,
    pub last_interaction_ms: u64,
    pub bubble: Bubble,
}
impl Default for Instance {
    fn default() -> Self {
        Self {
            id: "1".into(),
            enabled: true,
            resource: "xiaojing".into(),
            x: 60.,
            y: 120.,
            monitor: None,
            scale: 1.,
            pinned: None,
            profile: None,
            interaction: true,
            look: true,
            mood_enabled: false,
            affinity: 0,
            mood: "normal".into(),
            last_interaction_ms: 0,
            bubble: Bubble::default(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    pub enabled: bool,
    pub instances: Vec<Instance>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 3,
            enabled: false,
            instances: vec![Instance::default()],
        }
    }
}
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
// Apply only fields changed in this settings window, under the host settings lock.
pub fn merge(current: &Config, base: &Config, desired: &Config) -> Result<Config, String> {
    base.validate()?;
    desired.validate()?;
    let mut result = current.clone();
    if base.enabled != desired.enabled {
        result.enabled = desired.enabled;
    }
    result.instances.retain(|p| {
        !base.instances.iter().any(|b| b.id == p.id)
            || desired.instances.iter().any(|d| d.id == p.id)
    });
    for wanted in &desired.instances {
        if let Some(before) = base.instances.iter().find(|b| b.id == wanted.id) {
            let actual = result
                .instances
                .iter_mut()
                .find(|p| p.id == wanted.id)
                .ok_or("实例已删除，请重新载入")?;
            let old = serde_json::to_value(before).unwrap();
            let new = serde_json::to_value(wanted).unwrap();
            let mut value = serde_json::to_value(&*actual).unwrap();
            for (key, v) in new.as_object().unwrap() {
                if old[key] != *v {
                    value[key] = v.clone();
                }
            }
            *actual = serde_json::from_value(value).map_err(|_| "设置合并失败")?;
        } else {
            if result.instances.iter().any(|p| p.id == wanted.id) {
                return Err("实例编号已使用，请重新载入".into());
            }
            result.instances.push(wanted.clone());
        }
    }
    result.validate()?;
    Ok(result)
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 3 || self.instances.is_empty() || self.instances.len() > 3 {
            return Err("只支持 1–3 个桌宠实例".into());
        }
        let mut ids = HashSet::new();
        for p in &self.instances {
            if !valid_id(&p.id)
                || !ids.insert(&p.id)
                || !valid_id(&p.resource)
                || !p.x.is_finite()
                || !p.y.is_finite()
                || p.x.abs() > 100000.
                || p.y.abs() > 100000.
                || ![0.75, 1., 1.25, 1.5, 2.].contains(&p.scale)
                || p.affinity > 100
                || !["normal", "happy", "resting"].contains(&p.mood.as_str())
            {
                return Err("桌宠实例配置无效".into());
            }
            if p.pinned.as_ref().is_some_and(|s| {
                s.len() > 128
                    || !s
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            }) || p.profile.as_ref().is_some_and(|s| s.len() > 128)
                || p.monitor.as_ref().is_some_and(|s| s.len() > 256)
            {
                return Err("桌宠目标无效".into());
            }
            let b = &p.bubble;
            if !["top", "bottom"].contains(&b.placement.as_str())
                || !(10..=22).contains(&b.font_size)
                || !(1000..=15000).contains(&b.duration_ms)
                || !["dark", "light", "blue"].contains(&b.theme.as_str())
                || b.templates.len() > 8
            {
                return Err("气泡设置无效".into());
            }
            for (key, text) in &b.templates {
                if ![
                    "WAITING_INPUT",
                    "WAITING_PERMISSION",
                    "COMPLETED",
                    "FAILED",
                    "BLOCKED",
                    "LIMIT_REACHED",
                    "UNKNOWN",
                    "INTERRUPTED",
                ]
                .contains(&key.as_str())
                    || text.chars().count() > 80
                    || text.chars().any(|c| c.is_control())
                    || text.replace("{state}", "").contains(['{', '}'])
                {
                    return Err("气泡仅支持 80 字短文本及 {state}".into());
                }
            }
        }
        Ok(())
    }
}
pub fn migrate(mut value: serde_json::Value) -> Result<Config, String> {
    let version = value["schemaVersion"].as_u64().ok_or("桌宠配置版本缺失")?;
    if version > 3 {
        return Err("这是较新版本的桌宠配置，已保留原文件".into());
    }
    if version == 1 || version == 2 {
        let object = value.as_object_mut().ok_or("桌宠配置无效")?;
        let enabled = object.remove("enabled").unwrap_or(serde_json::json!(false));
        object.remove("schemaVersion");
        object.insert("id".into(), serde_json::json!("1"));
        value = serde_json::json!({"schemaVersion":3,"enabled":enabled,"instances":[value]});
    }
    let c: Config = serde_json::from_value(value).map_err(|_| "桌宠配置无法解析")?;
    c.validate()?;
    Ok(c)
}
pub struct Loaded {
    pub config: Config,
    pub warning: Option<String>,
    pub future: bool,
}
pub fn load(root: &Path) -> Loaded {
    let path = root.join("pets.json");
    let mut warning = None;
    let mut future = false;
    let config = match fs::read(&path) {
        Ok(bytes) => {
            let parsed = if bytes.len() <= 65536 {
                serde_json::from_slice::<serde_json::Value>(&bytes).ok()
            } else {
                None
            };
            future = parsed
                .as_ref()
                .is_some_and(|v| v["schemaVersion"].as_u64().unwrap_or(0) > 3);
            match parsed
                .clone()
                .ok_or("配置损坏".to_string())
                .and_then(migrate)
            {
                Ok(c) => {
                    if parsed.unwrap()["schemaVersion"] != 3 {
                        let backup = root.join(format!("pets-before-v3-{}.json", now()));
                        if fs::copy(&path, &backup).is_err() {
                            warning = Some("迁移备份未完成，暂不保存配置".into());
                            future = true;
                        } else if let Err(e) = save(root, &c) {
                            warning = Some(e);
                        }
                    }
                    c
                }
                Err(e) => {
                    warning = Some(e);
                    if !future {
                        let backup = root.join(format!("pets-corrupt-{}.json", now()));
                        if fs::copy(&path, backup).is_err() {
                            future = true;
                        }
                    }
                    Config::default()
                }
            }
        }
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                warning = Some("桌宠配置不可读，默认关闭".into());
                future = true;
            }
            Config::default()
        }
    };
    Loaded {
        config,
        warning,
        future,
    }
}
pub fn save(root: &Path, c: &Config) -> Result<(), String> {
    c.validate()?;
    let temp = root.join("pets.new.json");
    fs::write(&temp, serde_json::to_vec_pretty(c).unwrap())
        .and_then(|_| fs::rename(temp, root.join("pets.json")))
        .map_err(|_| "桌宠设置未能保存".into())
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn interact(p: &mut Instance, time: u64) -> bool {
    if !p.mood_enabled || time.saturating_sub(p.last_interaction_ms) < 60000 {
        return false;
    }
    p.affinity = (p.affinity + 1).min(100);
    p.mood = "happy".into();
    p.last_interaction_ms = time;
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_settings_preserve_native_position_mood_and_hidden_state() {
        let base = Config::default();
        let mut current = base.clone();
        current.instances[0].x = 400.;
        current.instances[0].affinity = 8;
        current.instances[0].enabled = false;
        let mut desired = base.clone();
        desired.instances[0].scale = 1.5;
        let merged = merge(&current, &base, &desired).unwrap();
        assert_eq!(merged.instances[0].x, 400.);
        assert_eq!(merged.instances[0].affinity, 8);
        assert!(!merged.instances[0].enabled);
        assert_eq!(merged.instances[0].scale, 1.5);
    }
    #[test]
    fn disk_migration_backup_recovery_and_mood_persistence() {
        let root =
            std::env::temp_dir().join(format!("dsh-pet-config-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("pets.json");
        fs::write(&path, br#"{"schemaVersion":1,"enabled":true,"x":-40}"#).unwrap();
        let loaded = load(&root);
        assert!(loaded.config.enabled);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap()
                ["schemaVersion"],
            3
        );
        assert!(fs::read_dir(&root).unwrap().any(|f| f
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("pets-before-v3-")));
        let mut c = loaded.config;
        c.instances[0].mood_enabled = true;
        interact(&mut c.instances[0], 100000);
        save(&root, &c).unwrap();
        assert_eq!(load(&root).config.instances[0].affinity, 1);
        fs::write(&path, b"broken").unwrap();
        let damaged = load(&root);
        assert!(!damaged.config.enabled);
        assert!(damaged.warning.is_some());
        fs::write(&path, br#"{"schemaVersion":99}"#).unwrap();
        assert!(load(&root).future);
        assert_eq!(fs::read(&path).unwrap(), br#"{"schemaVersion":99}"#);
    }
    #[test]
    fn versions_are_idempotent_and_future_is_not_overwritten() {
        for version in [1, 2] {
            let c =
                migrate(serde_json::json!({"schemaVersion":version,"enabled":true,"x":-30,"y":40}))
                    .unwrap();
            assert!(c.enabled);
            assert_eq!(c.instances[0].x, -30.);
            assert_eq!(
                serde_json::to_value(&c).unwrap(),
                serde_json::to_value(migrate(serde_json::to_value(&c).unwrap()).unwrap()).unwrap()
            );
        }
        assert!(migrate(serde_json::json!({"schemaVersion":9})).is_err());
    }
    #[test]
    fn preferences_are_bounded() {
        let mut c = Config::default();
        c.instances[0].scale = 8.;
        assert!(c.validate().is_err());
        c = Config::default();
        c.instances.push(c.instances[0].clone());
        assert!(c.validate().is_err());
    }
    #[test]
    fn local_affinity_has_cooldown_no_offline_penalty_and_switch() {
        let mut p = Instance::default();
        assert!(!interact(&mut p, 100000));
        p.mood_enabled = true;
        assert!(interact(&mut p, 100000));
        assert!(!interact(&mut p, 110000));
        assert_eq!(p.affinity, 1);
        p.affinity = 100;
        assert!(interact(&mut p, 100000000));
        assert_eq!(p.affinity, 100);
    }
}
