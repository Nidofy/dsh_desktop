use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use windows_sys::Win32::Security::Credentials::*;

#[cfg(not(test))]
const TARGET: &str = "DSHDesktop/InternalLLM";
#[cfg(test)]
const TARGET: &str = "DSHDesktop/IsolatedCredentialTest";
pub const KEY_ENV: &str = "DSH_DESKTOP_LLM_KEY";
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
pub enum ApiFormat {
    #[default]
    #[serde(rename = "openai-completions")]
    OpenAi,
    #[serde(rename = "anthropic-messages")]
    Anthropic,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimits {
    pub context_window: u32,
    pub max_tokens: u32,
}
impl Default for ModelLimits {
    fn default() -> Self {
        // Preserve the conservative legacy fallback; never infer gateway limits from an ID.
        Self {
            context_window: 32768,
            max_tokens: 4096,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider_name: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api: ApiFormat,
    // None distinguishes legacy single-model files from an invalid empty list.
    #[serde(default)]
    pub models: Option<Vec<String>>,
    #[serde(default)]
    pub model_limits: std::collections::BTreeMap<String, ModelLimits>,
}
impl Default for Connection {
    fn default() -> Self {
        Self {
            provider_name: "Internal LLM".into(),
            base_url: String::new(),
            model: String::new(),
            api: ApiFormat::default(),
            models: None,
            model_limits: Default::default(),
        }
    }
}
impl Connection {
    pub fn limits(&self, id: &str) -> ModelLimits {
        self.model_limits.get(id).copied().unwrap_or_else(|| {
            if matches!(
                id.to_ascii_lowercase().trim_end_matches("[1m]"),
                "glm-5.3" | "glm-5.3-flash"
            ) {
                ModelLimits {
                    context_window: 1000000,
                    max_tokens: 128000,
                }
            } else {
                ModelLimits::default()
            }
        })
    }
    pub fn model_ids(&self) -> Vec<String> {
        self.models.clone().unwrap_or_else(|| {
            if self.model.is_empty() {
                vec![]
            } else {
                vec![self.model.clone()]
            }
        })
    }

    fn provider_base_url(&self) -> &str {
        let base = self.base_url.trim_end_matches('/');
        if self.api == ApiFormat::Anthropic {
            base.strip_suffix("/v1").unwrap_or(base)
        } else {
            base
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn credential_target(base_url: &str) -> Vec<u16> {
    wide(&format!("{TARGET}/{base_url}"))
}
pub fn read_key(base_url: &str) -> Result<String, String> {
    if base_url.is_empty() {
        return Ok(String::new());
    }
    unsafe {
        let mut credential = std::ptr::null_mut();
        if CredReadW(
            credential_target(base_url).as_ptr(),
            CRED_TYPE_GENERIC,
            0,
            &mut credential,
        ) == 0
        {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(1168) {
                return Ok(String::new());
            }
            return Err("Windows Credential Manager cannot read the saved credential".into());
        }
        if (*credential).CredentialBlobSize == 0 {
            CredFree(credential as _);
            return Ok(String::new());
        }
        let bytes = std::slice::from_raw_parts(
            (*credential).CredentialBlob,
            (*credential).CredentialBlobSize as usize,
        );
        let result = String::from_utf8(bytes.to_vec())
            .map_err(|_| "Saved credential has invalid encoding".into());
        CredFree(credential as _);
        result
    }
}
fn write_key(base_url: &str, key: &str) -> Result<(), String> {
    if key.len() > 2400 || key.contains(['\0', '\n', '\r']) {
        return Err("Invalid API key length or characters".into());
    }
    unsafe {
        let mut target = credential_target(base_url);
        let mut username = wide("DSHDesktop");
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: key.len() as u32,
            CredentialBlob: key.as_ptr() as _,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..std::mem::zeroed()
        };
        if CredWriteW(&credential, 0) == 0 {
            return Err("Windows Credential Manager refused the credential".into());
        }
    }
    Ok(())
}
pub fn load(root: &Path) -> Result<Connection, String> {
    let path = root.join("connection.json");
    if !path.exists() {
        return Ok(Connection::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read connection configuration")?)
        .map_err(|_| "Invalid connection configuration".into())
}
pub fn validate(c: &Connection) -> Result<(), String> {
    if c.base_url.len() > 2048 {
        return Err("Base URL is too long".into());
    }
    let u = url::Url::parse(&c.base_url).map_err(|_| "Base URL must be a complete HTTP(S) URL")?;
    if !matches!(u.scheme(), "http" | "https")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(
            "Base URL must use HTTP(S), without embedded credentials, query or fragment".into(),
        );
    }
    if c.model.trim().is_empty()
        || c.model.len() > 256
        || c.provider_name.trim().is_empty()
        || c.provider_name.len() > 128
    {
        return Err("Enter a provider name and model (maximum 128/256 characters)".into());
    }
    let models = c.model_ids();
    if models.is_empty() || models.len() > 100 {
        return Err("请配置 1–100 个模型。".into());
    }
    let mut unique = std::collections::HashSet::new();
    for id in &models {
        if id.trim().is_empty()
            || id != id.trim()
            || id.len() > 256
            || id.chars().any(char::is_control)
        {
            return Err("模型 ID 不能为空、包含首尾空白或控制字符，且不能超过 256 字节。".into());
        }
        if !unique.insert(id) {
            return Err(format!("模型 ID 重复：{id}"));
        }
    }
    if !models.contains(&c.model) {
        return Err("默认模型必须在模型列表中。".into());
    }
    for (id, limits) in &c.model_limits {
        if !models.contains(id) {
            return Err(format!("容量设置对应的模型不在列表中：{id}"));
        }
        if !(1024..=100_000_000).contains(&limits.context_window)
            || limits.max_tokens == 0
            || limits.max_tokens >= limits.context_window
        {
            return Err(format!(
                "{id}：上下文须为 1,024–100,000,000 tokens 的整数；最大输出须大于 0 且小于上下文。"
            ));
        }
    }
    Ok(())
}
pub fn save(root: &Path, c: &Connection, key: &str) -> Result<(), String> {
    validate(c)?;
    if !key.is_empty() {
        write_key(&c.base_url, key)?;
    }
    if read_key(&c.base_url)?.is_empty() {
        return Err("Enter an API key for this Base URL".into());
    }
    fs::write(
        root.join("connection.new.json"),
        serde_json::to_vec_pretty(c).unwrap(),
    )
    .map_err(|_| "Cannot save connection configuration")?;
    fs::rename(
        root.join("connection.new.json"),
        root.join("connection.json"),
    )
    .map_err(|_| "Cannot commit connection configuration")?;
    Ok(())
}
pub fn write_overlay(root: &Path, c: &Connection, runtime: &Path) -> Result<(), String> {
    // JSON is YAML-compatible; no string interpolation into executable YAML tags.
    let mut overlay = vec![serde_json::json!({"id":"session-telemetry-otel","disabled":true})];
    if !c.base_url.is_empty() {
        validate(c)?;
        overlay.push(serde_json::json!({"id":"llm-pi-ai","config":{"providers":{"desktop-internal":{
            "displayName":c.provider_name, "apiKeyEnv":KEY_ENV,"api":c.api,
            "baseURL":c.provider_base_url(),"models":c.model_ids().iter().map(|id| {
                let limits = c.limits(id);
                let mut model = serde_json::json!({"id":id,"name":id,"contextWindow":limits.context_window,"maxTokens":limits.max_tokens});
                model["reasoningEfforts"] = serde_json::json!({"off":null,"minimal":"minimal","low":"low","medium":"medium","high":"high","xhigh":"xhigh","max":"max"});
                model
            }).collect::<Vec<_>>(),
            "retryPolicy":{"mode":"normal","maxRetries":0}
        }}}}));
        let selection = serde_json::json!({"provider":"desktop-internal","model":c.model});
        overlay.push(serde_json::json!({"id":"agent-default-model","config":selection}));
        let plugin = url::Url::from_file_path(runtime.join("model-defaults.mjs"))
            .map_err(|_| "Invalid model defaults runtime path")?;
        overlay.push(serde_json::json!({"insert":[{"id":"desktop-model-defaults","name":plugin.as_str(),"config":{"models":c.model_ids(),"defaultModel":c.model}}]}));
    }
    fs::write(
        root.join("desktop.patch.json"),
        serde_json::to_vec_pretty(&overlay).unwrap(),
    )
    .map_err(|_| "Cannot save native DSH overlay".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_connection_and_multiple_models_use_native_protocols() {
        let legacy: Connection = serde_json::from_str(
            r#"{"providerName":"Legacy","baseUrl":"http://localhost:9000/v1","model":"old-model"}"#,
        )
        .unwrap();
        assert_eq!(legacy.api, ApiFormat::OpenAi);
        assert_eq!(legacy.model_ids(), vec!["old-model"]);
        validate(&legacy).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build/config-protocol-fixtures");
        for (name, api) in [
            ("openai", ApiFormat::OpenAi),
            ("anthropic", ApiFormat::Anthropic),
        ] {
            let dir = root.join(name);
            fs::create_dir_all(&dir).unwrap();
            let c = Connection {
                api,
                models: Some(vec!["glm-5.3-flash".into(), "glm-5.3".into()]),
                model: "glm-5.3".into(),
                model_limits: [
                    (
                        "glm-5.3-flash".into(),
                        ModelLimits {
                            context_window: 131072,
                            max_tokens: 8192,
                        },
                    ),
                    (
                        "glm-5.3".into(),
                        ModelLimits {
                            context_window: 1000000,
                            max_tokens: 128000,
                        },
                    ),
                ]
                .into(),
                ..legacy.clone()
            };
            write_overlay(
                &dir,
                &c,
                &root.parent().unwrap().parent().unwrap().join("runtime"),
            )
            .unwrap();
            let value: serde_json::Value =
                serde_json::from_slice(&fs::read(dir.join("desktop.patch.json")).unwrap()).unwrap();
            let provider = &value[1]["config"]["providers"]["desktop-internal"];
            assert_eq!(provider["api"], serde_json::to_value(api).unwrap());
            assert_eq!(provider["models"].as_array().unwrap().len(), 2);
            assert_eq!(value[2]["config"]["model"], "glm-5.3");
            assert_eq!(
                provider["baseURL"],
                if api == ApiFormat::Anthropic {
                    "http://localhost:9000"
                } else {
                    "http://localhost:9000/v1"
                }
            );
            let roundtrip: Connection =
                serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
            assert_eq!(roundtrip.model_ids(), c.model_ids());
            assert_eq!(roundtrip.api, api);
            assert_eq!(roundtrip.model_limits, c.model_limits);
        }
        let c = Connection {
            api: ApiFormat::Anthropic,
            base_url: "https://gateway.example/anthropic/v1/".into(),
            ..legacy
        };
        assert_eq!(c.provider_base_url(), "https://gateway.example/anthropic");
        assert!(serde_json::from_str::<Connection>(
            r#"{"providerName":"bad","baseUrl":"http://localhost","model":"m","api":"unsupported"}"#
        )
        .is_err());
    }
    #[test]
    fn rejects_empty_duplicate_and_missing_default_models() {
        let valid = Connection {
            base_url: "http://localhost:9000/v1".into(),
            model: "one".into(),
            models: Some(vec!["one".into(), "two".into()]),
            ..Default::default()
        };
        validate(&valid).unwrap();
        for models in [
            vec![],
            vec!["".into()],
            vec!["one".into(), "one".into()],
            vec!["two".into()],
            vec!["one".into(), " bad ".into()],
            vec!["one".into(), "bad\nvalue".into()],
            vec!["x".repeat(257)],
            vec!["one".into(); 101],
        ] {
            assert!(validate(&Connection {
                models: Some(models),
                ..valid.clone()
            })
            .is_err());
        }
    }
    #[test]
    fn model_limits_migrate_validate_and_preserve_wire_ids() {
        for json in [
            r#"{"providerName":"Old","baseUrl":"http://localhost/v1","model":"glm-5.3"}"#,
            r#"{"providerName":"Old","baseUrl":"http://localhost/v1","model":"glm-5.3","models":["glm-5.3","glm-5.3-flash"]}"#,
        ] {
            let mut c: Connection = serde_json::from_str(json).unwrap();
            assert_eq!(
                c.limits("glm-5.3"),
                ModelLimits {
                    context_window: 1000000,
                    max_tokens: 128000
                }
            );
            for (context_window, max_tokens, valid) in [
                (1000000, 16384, true),
                (1024, 1, true),
                (0, 1, false),
                (100000001, 4096, false),
                (32768, 0, false),
                (32768, 32768, false),
                (32768, 32769, false),
            ] {
                c.model_limits.insert(
                    "glm-5.3".into(),
                    ModelLimits {
                        context_window,
                        max_tokens,
                    },
                );
                assert_eq!(validate(&c).is_ok(), valid);
                assert_eq!(c.model_ids()[0], "glm-5.3");
            }
            c.model_limits.insert(
                "glm-5.3".into(),
                ModelLimits {
                    context_window: 1000000,
                    max_tokens: 16384,
                },
            );
            c.model_limits
                .insert("removed-model".into(), ModelLimits::default());
            assert!(validate(&c).is_err());
        }
        assert!(
            serde_json::from_str::<ModelLimits>(r#"{"contextWindow":1.5,"maxTokens":1}"#).is_err()
        );
        assert!(
            serde_json::from_str::<ModelLimits>(r#"{"contextWindow":-1,"maxTokens":1}"#).is_err()
        );
    }
    #[test]
    fn windows_credential_bridge_keeps_key_out_of_config() {
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe {
                    CredDeleteW(
                        credential_target("http://127.0.0.1:12345/v1").as_ptr(),
                        CRED_TYPE_GENERIC,
                        0,
                    );
                }
            }
        }
        let _cleanup = Cleanup;
        let dir = std::env::temp_dir().join(format!(
            "dsh-desktop-credential-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let c = Connection {
            provider_name: "Test".into(),
            base_url: "http://127.0.0.1:12345/v1".into(),
            model: "test-model".into(),
            ..Default::default()
        };
        save(&dir, &c, "desktop-credential-fixture").unwrap();
        write_overlay(&dir, &c, &std::env::current_dir().unwrap()).unwrap();
        assert_eq!(read_key(&c.base_url).unwrap(), "desktop-credential-fixture");
        assert_eq!(read_key("http://127.0.0.1:12346/v1").unwrap(), "");
        for f in ["connection.json", "desktop.patch.json"] {
            assert!(!fs::read_to_string(dir.join(f))
                .unwrap()
                .contains("desktop-credential-fixture"));
        }
        assert_eq!(load(&dir).unwrap().model, "test-model");
    }
    #[test]
    fn rejects_embedded_secrets_and_bad_urls() {
        for url in [
            "ftp://host",
            "http://key@host",
            "http://host/?key=secret",
            "bad",
        ] {
            assert!(validate(&Connection {
                base_url: url.into(),
                model: "m".into(),
                ..Default::default()
            })
            .is_err());
        }
        assert!(validate(&Connection {
            base_url: "http://127.0.0.1:9000/v1".into(),
            model: "m".into(),
            ..Default::default()
        })
        .is_ok());
    }
}
