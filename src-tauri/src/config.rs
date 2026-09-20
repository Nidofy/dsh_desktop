use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use windows_sys::Win32::Security::Credentials::*;

#[cfg(not(test))]
const TARGET: &str = "DSHDesktop/InternalLLM";
#[cfg(test)]
const TARGET: &str = "DSHDesktop/IsolatedCredentialTest";
pub const KEY_ENV: &str = "DSH_DESKTOP_LLM_KEY";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider_name: String,
    pub base_url: String,
    pub model: String,
}
impl Default for Connection {
    fn default() -> Self {
        Self {
            provider_name: "Internal LLM".into(),
            base_url: String::new(),
            model: String::new(),
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
pub fn write_overlay(root: &Path, c: &Connection) -> Result<(), String> {
    // JSON is YAML-compatible; no string interpolation into executable YAML tags.
    let mut overlay = vec![serde_json::json!({"id":"session-telemetry-otel","disabled":true})];
    if !c.base_url.is_empty() {
        validate(c)?;
        overlay.push(serde_json::json!({"id":"llm-pi-ai","config":{"providers":{"desktop-internal":{
            "displayName":c.provider_name, "apiKeyEnv":KEY_ENV,"api":"openai-completions",
            "baseURL":c.base_url,"models":[{"id":c.model,"name":c.model,"contextWindow":32768,"maxTokens":4096}],
            "retryPolicy":{"mode":"normal","maxRetries":0}
        }}}}));
        overlay.push(serde_json::json!({"id":"agent-default-model","config":{"provider":"desktop-internal","model":c.model}}));
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
        };
        save(&dir, &c, "desktop-credential-fixture").unwrap();
        write_overlay(&dir, &c).unwrap();
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
