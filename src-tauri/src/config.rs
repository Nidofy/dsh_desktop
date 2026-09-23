use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use windows_sys::Win32::Security::Credentials::*;

#[cfg(not(test))]
const TARGET: &str = "DSHDesktop/InternalLLM";
#[cfg(test)]
const TARGET: &str = "DSHDesktop/IsolatedCredentialTest";
// Native save/activation is serialized by Engine::save_lock. Keep the two
// integration fixtures using the same OS credential store serialized as well.
#[cfg(test)]
pub static CREDENTIAL_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub const KEY_ENV: &str = "DSH_DESKTOP_LLM_KEY";
// A separate credential from model API keys, stable across portable ZIP locations.
const DIAGNOSTIC_CREDENTIAL: &str = "desktop-diagnostics-v1";
pub fn diagnostic_key(reset: bool) -> Result<String, String> {
    if !reset {
        let saved = read_key(DIAGNOSTIC_CREDENTIAL)?;
        if saved.len() == 64 && saved.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ok(saved);
        }
    }
    let mut bytes = [0u8; 32];
    unsafe {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        if BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        ) != 0
        {
            return Err("Diagnostic random key unavailable".into());
        }
    }
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    write_key(DIAGNOSTIC_CREDENTIAL, &key)?;
    Ok(key)
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
pub enum ApiFormat {
    #[default]
    #[serde(rename = "openai-completions")]
    OpenAi,
    #[serde(rename = "anthropic-messages")]
    Anthropic,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheRetention {
    #[default]
    Native,
    Automatic,
    Short,
    Long,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CacheKeyMode {
    #[default]
    Native,
    Off,
    Session,
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheSettings {
    #[serde(default)]
    pub retention: CacheRetention,
    #[serde(default)]
    pub anthropic_markers: bool,
    #[serde(default)]
    pub key_mode: CacheKeyMode,
    #[serde(default)]
    pub key_models: Vec<String>,
}
impl CacheSettings {
    fn validate(&self, api: ApiFormat) -> Result<(), String> {
        if self.key_mode == CacheKeyMode::Session
            && (api != ApiFormat::OpenAi || self.key_models.is_empty())
        {
            return Err("独立缓存键仅支持 OpenAI 格式，请至少勾选一个已确认支持的模型。".into());
        }
        if self.key_models.len() > 100
            || self
                .key_models
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.key_models.len()
        {
            return Err("缓存键模型列表过长或有重复。".into());
        }
        if self.anthropic_markers && api != ApiFormat::OpenAi {
            return Err("Anthropic 协议已使用原生缓存标记，无需额外开启。".into());
        }
        if self.anthropic_markers
            && matches!(
                self.retention,
                CacheRetention::Automatic | CacheRetention::Long
            )
        {
            return Err("OpenAI 格式的 Anthropic 标记仅支持短期保留。".into());
        }
        Ok(())
    }
    fn apply(&self, provider: &mut serde_json::Value) {
        if provider["api"] == "openai-completions" && self.key_mode != CacheKeyMode::Native {
            provider["desktopCacheKey"] =
                serde_json::json!({"mode":self.key_mode,"models":self.key_models});
        }
        // Pin the native default to short, so ambient PI_CACHE_RETENTION or
        // home.env cannot silently enable long retention on a custom gateway.
        provider["cacheRetention"] = serde_json::json!(match self.retention {
            CacheRetention::Automatic => "none",
            CacheRetention::Long => "long",
            CacheRetention::Native | CacheRetention::Short => "short",
        });
        if self.anthropic_markers {
            provider["compat"] = serde_json::json!({"cacheControlFormat":"anthropic", "supportsLongCacheRetention":false});
        }
    }
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
    #[serde(default)]
    pub builtin_provider: Option<String>,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api: ApiFormat,
    // None distinguishes legacy single-model files from an invalid empty list.
    #[serde(default)]
    pub models: Option<Vec<String>>,
    #[serde(default)]
    pub model_limits: std::collections::BTreeMap<String, ModelLimits>,
    #[serde(default)]
    pub model_capabilities: std::collections::BTreeMap<String, ModelCapability>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u32,
    #[serde(default = "default_timeout")]
    pub stream_idle_timeout_ms: u32,
    #[serde(default)]
    pub cache: CacheSettings,
}
fn default_timeout() -> u32 {
    300000
}
impl Default for Connection {
    fn default() -> Self {
        Self {
            provider_name: "Internal LLM".into(),
            builtin_provider: None,
            base_url: String::new(),
            model: String::new(),
            api: ApiFormat::default(),
            models: None,
            model_limits: Default::default(),
            model_capabilities: Default::default(),
            timeout_ms: default_timeout(),
            stream_idle_timeout_ms: default_timeout(),
            cache: CacheSettings::default(),
        }
    }
}
impl Connection {
    pub fn preserve_legacy_capabilities(&mut self){
        for id in self.model_ids(){if !self.model_capabilities.contains_key(&id){
            let limits=self.model_limits.get(&id).copied().unwrap_or_else(||if matches!(id.to_ascii_lowercase().trim_end_matches("[1m]"),"glm-5.3"|"glm-5.3-flash"){ModelLimits{context_window:1000000,max_tokens:128000}}else{ModelLimits::default()});self.model_limits.entry(id.clone()).or_insert(limits);
            self.model_capabilities.insert(id.clone(),if self.builtin_provider.is_some(){ModelCapability{source:"preset".into(),reasoning:None,binding:self.capability_binding(&id)}}else{ModelCapability{source:"legacy".into(),reasoning:Some(vec!["off","minimal","low","medium","high","xhigh","max"].into_iter().map(String::from).collect()),binding:self.capability_binding(&id)}});
        }}
    }
    pub fn capability_binding(&self,id:&str)->String{use sha2::{Digest,Sha256};format!("{:x}",Sha256::digest(serde_json::to_vec(&(self.base_url.trim_end_matches('/'),&self.builtin_provider,self.api,id)).unwrap()))}
    pub fn limits(&self, id: &str) -> ModelLimits {
        self.model_limits.get(id).copied().unwrap_or_default()
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
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ModelCapability {
    pub source:String,
    #[serde(default)]pub binding:String,
    #[serde(default)] pub reasoning:Option<Vec<String>>,
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn credential_target(base_url: &str) -> Vec<u16> {
    wide(&format!("{}/{base_url}",credential_namespace()))
}
fn credential_namespace()->String{if crate::environments::id()=="stable"{TARGET.into()}else{format!("{TARGET}/environments/{}",crate::environments::id())}}
pub(crate) fn delete_environment_credentials(id:&str)->Result<(),String>{
    if !crate::environments::valid_id(id){return Err("环境编号无效".into());}
    let prefix=format!("{TARGET}/environments/{id}/");
    unsafe {
        let mut count=0;let mut pointer=std::ptr::null_mut();
        if CredEnumerateW(wide(&format!("{prefix}*")).as_ptr(),0,&mut count,&mut pointer)==0{return if std::io::Error::last_os_error().raw_os_error()==Some(1168){Ok(())}else{Err("无法检查候选环境凭据".into())};}
        struct Allocation(*mut *mut CREDENTIALW);impl Drop for Allocation{fn drop(&mut self){unsafe{CredFree(self.0 as _)}}}let _allocation=Allocation(pointer);
        if count>4096{return Err("环境凭据数量超过上限".into());}
        for credential in std::slice::from_raw_parts(pointer,count as usize){let value=&**credential;if value.Type!=CRED_TYPE_GENERIC||value.TargetName.is_null(){continue;}let mut len=0;while len<32768&&*value.TargetName.add(len)!=0{len+=1;}if len==32768{return Err("凭据名称无效".into());}
            let name=String::from_utf16_lossy(std::slice::from_raw_parts(value.TargetName,len));if name.starts_with(&prefix)&&CredDeleteW(value.TargetName,CRED_TYPE_GENERIC,0)==0&&std::io::Error::last_os_error().raw_os_error()!=Some(1168){return Err("候选环境凭据删除失败，可重试".into());}
        }Ok(())
    }
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
pub fn write_key(base_url: &str, key: &str) -> Result<(), String> {
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
pub fn delete_key(id: &str) {
    unsafe {
        CredDeleteW(credential_target(id).as_ptr(), CRED_TYPE_GENERIC, 0);
    }
}
#[derive(Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all="camelCase")]
pub(crate) struct CredentialMetadata {
    pub id: String,
    pub written: u64,
}
// Enumerate only immutable profile references, never legacy URL credentials or
// the diagnostic HMAC key. No CredentialBlob is read or returned.
pub(crate) fn profile_credentials() -> Result<Vec<CredentialMetadata>,String> {
    let prefix=format!("{}/connection-profile-v1/",credential_namespace());
    let filter=wide(&format!("{prefix}*"));
    unsafe {
        let mut count=0u32;let mut pointer=std::ptr::null_mut();
        if CredEnumerateW(filter.as_ptr(),0,&mut count,&mut pointer)==0 {
            return if std::io::Error::last_os_error().raw_os_error()==Some(1168) {Ok(Vec::new())} else {Err("无法枚举本应用的连接凭据".into())};
        }
        struct Allocation(*mut *mut CREDENTIALW);
        impl Drop for Allocation {fn drop(&mut self){unsafe{CredFree(self.0 as _);}}}
        let _allocation=Allocation(pointer);
        if count>4096 {return Err("连接凭据数量超过检查上限".into());}
        let mut rows=Vec::new();
        for credential in std::slice::from_raw_parts(pointer,count as usize) {
            let value=&**credential;
            if value.Type!=CRED_TYPE_GENERIC || value.TargetName.is_null() {continue;}
            let mut len=0;while len<32768 && *value.TargetName.add(len)!=0 {len+=1;}
            if len==32768 {return Err("连接凭据名称无效".into());}
            let name=String::from_utf16(std::slice::from_raw_parts(value.TargetName,len)).map_err(|_| "连接凭据名称编码无效")?;
            let Some(id)=name.strip_prefix(&prefix) else {continue;};
            if id.len()!=34 || !id.starts_with("p-") || !id[2..].bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) {continue;}
            rows.push(CredentialMetadata{id:id.into(),written:((value.LastWritten.dwHighDateTime as u64)<<32)|value.LastWritten.dwLowDateTime as u64});
        }
        rows.sort_by(|a,b|a.id.cmp(&b.id));Ok(rows)
    }
}
pub(crate) fn delete_profile_credential(id: &str) -> Result<bool,String> {
    if id.len()!=34 || !id.starts_with("p-") || !id[2..].bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) {return Err("连接凭据编号无效".into());}
    unsafe {
        if CredDeleteW(credential_target(&crate::profiles::credential_id(id)).as_ptr(),CRED_TYPE_GENERIC,0)!=0 {return Ok(true);}
    }
    if std::io::Error::last_os_error().raw_os_error()==Some(1168) {Ok(false)} else {Err("Windows 拒绝删除此凭据".into())}
}
#[cfg(test)]
pub fn delete_test_key(id: &str) {
    delete_key(id);
}
pub fn load(root: &Path) -> Result<Connection, String> {
    let path = root.join("connection.json");
    if !path.exists() {
        return Ok(Connection::default());
    }
    let mut c:Connection=serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read connection configuration")?).map_err(|_| "Invalid connection configuration")?;
    c.preserve_legacy_capabilities();Ok(c)
}
pub fn validate(c: &Connection) -> Result<(), String> {
    if c.model_capabilities.len()>100 || c.model_capabilities.iter().any(|(id,cap)|!c.model_ids().contains(id)||!matches!(cap.source.as_str(),"preset"|"server"|"user"|"legacy"|"unknown")||cap.reasoning.as_ref().is_some_and(|r|r.len()>7||r==&["off"]||r.iter().collect::<std::collections::HashSet<_>>().len()!=r.len()||r.iter().any(|v|!matches!(v.as_str(),"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max")))){return Err("模型能力声明无效".into());}
    c.cache.validate(c.api)?;
    if !(1000..=7200000).contains(&c.timeout_ms)
        || !(1000..=7200000).contains(&c.stream_idle_timeout_ms)
    {
        return Err("请求与流空闲超时须为 1 秒至 2 小时。".into());
    }
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
    if c.cache.key_models.iter().any(|id| !models.contains(id)) {
        return Err("缓存键只能勾选当前连接中存在的模型。".into());
    }
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
    let presets: Vec<serde_json::Value> = serde_json::from_str(include_str!("../generated/provider-catalog.json"))
        .map_err(|_| "内置提供方目录无效")?;
    let preset = c.builtin_provider.as_ref().and_then(|id| presets.iter().find(|p| p["id"] == *id && p["api"] == serde_json::to_value(c.api).unwrap()));
    let route = preset.and_then(|p| p["id"].as_str()).unwrap_or("desktop-internal");
    let mut overlay = vec![serde_json::json!({"id":"session-telemetry-otel","disabled":true})];
    if !c.base_url.is_empty() {
        validate(c)?;
        overlay.push(serde_json::json!({"id":"llm-pi-ai","config":{"providers":{(route):{
            "displayName":c.provider_name, "apiKeyEnv":KEY_ENV,"api":c.api,
            "baseURL":c.provider_base_url(),"models":c.model_ids().iter().map(|id| {
                let limits = c.limits(id);
                let mut model = preset.and_then(|p| p["models"].as_array()).and_then(|models| models.iter().find(|m|m["id"] == *id)).cloned().unwrap_or_else(||serde_json::json!({"id":id,"name":id}));
                if let Some(cap)=c.model_capabilities.get(id){
                    if let Some(efforts)=&cap.reasoning{model["reasoningEfforts"]=if efforts.is_empty(){serde_json::json!(false)}else{serde_json::Value::Object(efforts.iter().map(|e|(e.clone(),if e=="off"{serde_json::Value::Null}else{serde_json::json!(e)})).collect())};}
                    else if cap.source=="unknown" {model["reasoningEfforts"]=serde_json::json!(false);}
                }
                model["contextWindow"] = limits.context_window.into();
                model["maxTokens"] = limits.max_tokens.into();
                model
            }).collect::<Vec<_>>(),
            "retryPolicy":{"mode":"normal","maxRetries":0},
            "timeoutMs":c.timeout_ms,"streamIdleTimeoutMs":c.stream_idle_timeout_ms
        }}}}));
        c.cache
            .apply(&mut overlay.last_mut().unwrap()["config"]["providers"][route]);
        let selection = serde_json::json!({"provider":route,"model":c.model});
        overlay.push(serde_json::json!({"id":"agent-default-model","config":selection}));
        let plugin = url::Url::from_file_path(runtime.join("model-defaults.mjs"))
            .map_err(|_| "Invalid model defaults runtime path")?;
        overlay.push(serde_json::json!({"insert":[{"id":"desktop-model-defaults","name":plugin.as_str(),"config":{"provider":route,"models":c.model_ids(),"defaultModel":c.model}}]}));
    }
    let observer = url::Url::from_file_path(runtime.join("desktop-observability.mjs"))
        .map_err(|_| "Invalid diagnostics runtime path")?;
    overlay.push(
        serde_json::json!({"insert":[{"id":"desktop-observability","name":observer.as_str(),
        "config":{"desktopVersion":env!("CARGO_PKG_VERSION"),"api":c.api,"providerName":c.provider_name,"connectionConfigured":!c.base_url.is_empty(),"managedProvider":if c.base_url.is_empty(){""}else{route}}}]}),
    );
    let client = url::Url::from_file_path(runtime.join("desktop-client/index.mjs"))
        .map_err(|_| "Invalid desktop client runtime path")?;
    overlay.push(serde_json::json!({"insert":[{"id":"desktop-client","name":client.as_str()}]}));
    let environment = url::Url::from_file_path(runtime.join("desktop-environment/index.mjs"))
        .map_err(|_| "Invalid environment plugin path")?;
    overlay.push(serde_json::json!({"insert":[{"id":"desktop-environment","name":environment.as_str()}]}));
    let vision = url::Url::from_file_path(runtime.join("desktop-vision.mjs"))
        .map_err(|_| "Invalid vision plugin path")?;
    overlay.push(serde_json::json!({"insert":[{"id":"desktop-vision","name":vision.as_str()}]}));
    fs::write(
        root.join("desktop.patch.json"),
        serde_json::to_vec_pretty(&overlay).unwrap(),
    )
    .map_err(|_| "Cannot save native DSH overlay".into())
}
/// Check the optional pinned bridge before retiring the working backend. Native
/// policy deliberately does not depend on this adapter's source fingerprint.
pub fn preflight_runtime(c: &Connection, runtime: &Path) -> Result<(), String> {
    use sha2::{Digest,Sha256};
    validate(c)?;
    if c.cache.key_mode == CacheKeyMode::Native || c.api != ApiFormat::OpenAi { return Ok(()); }
    let file=runtime.join("dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js");
    if fs::metadata(&file).map_err(|_|"缓存适配器缺失，当前连接保持不变。")?.len()>2*1024*1024 {
        return Err("缓存适配器不匹配，当前连接保持不变。".into());
    }
    let bytes=fs::read(file).map_err(|_|"缓存适配器无法读取，当前连接保持不变。")?;
    if format!("{:x}",Sha256::digest(bytes))!="1f787eb5cd3d0308e7a2563cdb2b8cc2c1fc153fe06b55d39439fb2446059483" {
        return Err("缓存适配器不匹配。请使用完整配套运行时，或选择原生缓存键策略；当前连接保持不变。".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_model_has_no_inferred_reasoning_and_binding_is_route_specific(){
        let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();let dir=repo.join(".build").join(format!("capabilities-{}",crate::profiles::new_id().unwrap()));fs::create_dir_all(&dir).unwrap();
        let mut c=Connection{provider_name:"Fixture".into(),base_url:"http://localhost:9000/v1".into(),model:"glm-5.3".into(),..Default::default()};
        let binding=c.capability_binding("glm-5.3");c.model_capabilities.insert("glm-5.3".into(),ModelCapability{source:"unknown".into(),binding:binding.clone(),reasoning:None});
        validate(&c).unwrap();write_overlay(&dir,&c,&repo.join("runtime")).unwrap();
        let overlay:serde_json::Value=serde_json::from_slice(&fs::read(dir.join("desktop.patch.json")).unwrap()).unwrap();
        assert_eq!(overlay[1]["config"]["providers"]["desktop-internal"]["models"][0]["reasoningEfforts"],false);
        c.base_url="http://localhost:9001/v1".into();assert_ne!(binding,c.capability_binding("glm-5.3"));c.base_url="http://localhost:9000/v1".into();c.api=ApiFormat::Anthropic;assert_ne!(binding,c.capability_binding("glm-5.3"));
        for values in [vec!["off"],vec!["high","high"],vec!["imaginary"]]{c.model_capabilities.get_mut("glm-5.3").unwrap().reasoning=Some(values.into_iter().map(String::from).collect());assert!(validate(&c).is_err());}
    }
    #[test]
    fn preflight_refuses_changed_bridge_before_config_mutation() {
        let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let root=repo.join(".build").join(format!("cache-preflight-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let mut connection=Connection{provider_name:"Fixture".into(),base_url:"http://127.0.0.1:9000/v1".into(),model:"fixture".into(),..Default::default()};
        preflight_runtime(&connection,&root).unwrap();
        connection.cache.key_mode=CacheKeyMode::Off;
        assert!(preflight_runtime(&connection,&root).is_err());
        let adapter=root.join("dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js");
        fs::create_dir_all(adapter.parent().unwrap()).unwrap();fs::write(&adapter,"changed adapter").unwrap();
        assert!(preflight_runtime(&connection,&root).is_err());
        assert!(!root.join("desktop.patch.json").exists());assert!(!root.join("connections.json").exists());
        preflight_runtime(&connection,&repo.join("runtime")).unwrap();
        connection.cache.key_mode=CacheKeyMode::Native;
        preflight_runtime(&connection,&root).unwrap();
    }
    #[test]
    fn bundled_provider_presets_keep_model_capabilities() {
        let presets: Vec<serde_json::Value> = serde_json::from_str(include_str!("../generated/provider-catalog.json")).unwrap();
        let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for preset in presets {
            let models=preset["models"].as_array().unwrap();
            let c=Connection {
                builtin_provider: Some(preset["id"].as_str().unwrap().into()),
                provider_name:preset["name"].as_str().unwrap().into(),
                api:serde_json::from_value(preset["api"].clone()).unwrap(),
                base_url:preset["baseUrl"].as_str().unwrap().into(),
                model:preset["model"].as_str().unwrap().into(),
                models:Some(models.iter().map(|m|m["id"].as_str().unwrap().into()).collect()),
                model_limits:models.iter().map(|m|(m["id"].as_str().unwrap().into(),ModelLimits{context_window:m["contextWindow"].as_u64().unwrap() as u32,max_tokens:m["maxTokens"].as_u64().unwrap() as u32})).collect(),
                cache:CacheSettings{retention:CacheRetention::Automatic,key_mode:CacheKeyMode::Off,..Default::default()},
                ..Default::default()
            };
            let dir=repo.join(".build/provider-presets").join(c.builtin_provider.as_ref().unwrap());
            fs::create_dir_all(&dir).unwrap();write_overlay(&dir,&c,&repo.join("runtime")).unwrap();
            let overlay:serde_json::Value=serde_json::from_slice(&fs::read(dir.join("desktop.patch.json")).unwrap()).unwrap();
            assert_eq!(&overlay[1]["config"]["providers"][preset["id"].as_str().unwrap()]["models"],&preset["models"]);
            assert!(!serde_json::to_string(&overlay).unwrap().contains("fixture-secret"));
        }
    }
    #[test]
    fn cache_settings_migrate_and_emit_only_native_supported_combinations() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let legacy: Connection = serde_json::from_str(r#"{"providerName":"Cache fixture","baseUrl":"http://localhost:9000/v1","model":"glm-5.3"}"#).unwrap();
        assert_eq!(legacy.cache.retention, CacheRetention::Native);
        for api in [ApiFormat::OpenAi, ApiFormat::Anthropic] {
            for (label, retention, markers, wire) in [
                ("native", CacheRetention::Native, false, "short"),
                ("automatic", CacheRetention::Automatic, false, "none"),
                ("short", CacheRetention::Short, false, "short"),
                ("long", CacheRetention::Long, false, "long"),
                ("short-markers", CacheRetention::Short, true, "short"),
            ] {
                if markers && api == ApiFormat::Anthropic {
                    continue;
                }
                let mut c = Connection {
                    api,
                    models: Some(vec!["glm-5.3-flash".into(), "glm-5.3".into()]),
                    cache: CacheSettings {
                        retention,
                        anthropic_markers: markers,
                        ..Default::default()
                    },
                    ..legacy.clone()
                };
                c.preserve_legacy_capabilities();
                let dir = root
                    .join(".build/cache-profile-fixtures")
                    .join(if api == ApiFormat::OpenAi {
                        "openai"
                    } else {
                        "anthropic"
                    })
                    .join(label);
                fs::create_dir_all(&dir).unwrap();
                write_overlay(&dir, &c, &root.join("runtime")).unwrap();
                let value: serde_json::Value =
                    serde_json::from_slice(&fs::read(dir.join("desktop.patch.json")).unwrap())
                        .unwrap();
                let provider = &value[1]["config"]["providers"]["desktop-internal"];
                assert_eq!(provider["cacheRetention"], wire);
                assert_eq!(provider["compat"].is_object(), markers);
                if markers {
                    assert_eq!(provider["compat"]["cacheControlFormat"], "anthropic");
                }
            }
        }
        for (api, retention) in [
            (ApiFormat::OpenAi, CacheRetention::Long),
            (ApiFormat::OpenAi, CacheRetention::Automatic),
            (ApiFormat::Anthropic, CacheRetention::Short),
        ] {
            assert!(CacheSettings {
                retention,
                anthropic_markers: true,
                ..Default::default()
            }
            .validate(api)
            .is_err());
        }
    }
    #[test]
    fn independent_cache_key_is_explicit_and_model_scoped() {
        let mut c: Connection = serde_json::from_str(r#"{"providerName":"Cache fixture","baseUrl":"http://localhost:9000/v1","model":"glm-5.3","models":["glm-5.3-flash","glm-5.3"]}"#).unwrap();
        c.preserve_legacy_capabilities();
        assert_eq!(c.cache.key_mode, CacheKeyMode::Native);
        c.cache.key_mode = CacheKeyMode::Session;
        assert!(validate(&c).is_err());
        c.cache.key_models = vec!["missing".into()];
        assert!(validate(&c).is_err());
        c.cache.key_models = vec!["glm-5.3-flash".into()];
        validate(&c).unwrap();
        c.api = ApiFormat::Anthropic;
        assert!(validate(&c).is_err());
        c.api = ApiFormat::OpenAi;
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        for (label, mode, retention, markers) in [
            (
                "key-only",
                CacheKeyMode::Session,
                CacheRetention::Automatic,
                false,
            ),
            (
                "key-long",
                CacheKeyMode::Session,
                CacheRetention::Long,
                false,
            ),
            (
                "key-markers",
                CacheKeyMode::Session,
                CacheRetention::Short,
                true,
            ),
            ("off-long", CacheKeyMode::Off, CacheRetention::Long, false),
        ] {
            c.cache.key_mode = mode;
            c.cache.retention = retention;
            c.cache.anthropic_markers = markers;
            validate(&c).unwrap();
            let dir = root
                .join(".build/cache-profile-fixtures/openai")
                .join(label);
            fs::create_dir_all(&dir).unwrap();
            write_overlay(&dir, &c, &root.join("runtime")).unwrap();
            let value: serde_json::Value =
                serde_json::from_slice(&fs::read(dir.join("desktop.patch.json")).unwrap()).unwrap();
            let provider = &value[1]["config"]["providers"]["desktop-internal"];
            assert_eq!(
                provider["desktopCacheKey"]["mode"],
                serde_json::to_value(mode).unwrap()
            );
            assert_eq!(
                provider["desktopCacheKey"]["models"],
                serde_json::json!(["glm-5.3-flash"])
            );
        }
    }
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
            let mut c = Connection {
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
            // This fixture represents an existing connection, loaded through
            // the same explicit legacy migration as production catalogues.
            c.preserve_legacy_capabilities();
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
            assert_eq!(c.limits("glm-5.3"),ModelLimits::default(),"new unknown model names do not infer limits");
            c.preserve_legacy_capabilities();
            assert_eq!(c.model_capabilities["glm-5.3"].source,"legacy");
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
        let _credential_lock = CREDENTIAL_TEST_LOCK.lock().unwrap();
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe {
                    CredDeleteW(
                        credential_target(DIAGNOSTIC_CREDENTIAL).as_ptr(),
                        CRED_TYPE_GENERIC,
                        0,
                    );
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
        let fingerprint_key = diagnostic_key(true).unwrap();
        assert_eq!(fingerprint_key.len(), 64);
        assert_eq!(fingerprint_key, diagnostic_key(false).unwrap());
        assert_ne!(fingerprint_key, diagnostic_key(true).unwrap());
        assert_eq!(read_key(&c.base_url).unwrap(), "desktop-credential-fixture");
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
