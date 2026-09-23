//! Source Harness receives keys only through its inherited private pipe.
use crate::{config,profiles};
use serde_json::{json,Value,Map};
use std::path::Path;
pub struct Configuration {pub patch:Vec<Value>,pub providers:Value,pub selection:Value,pub keys:Value}
// Reviewed dad014b7 public hook, independently built and dual-protocol wire tested.
// This contract never enables the old installed-source rewriting bridge.
pub fn verify_payload_hook(runtime:&Path)->Result<(),String>{
    use sha2::{Digest,Sha256};
    let receipt:Value=serde_json::from_slice(&std::fs::read(runtime.join("harness-source-artifact.json")).map_err(|_|"源码产物回执缺失")?).map_err(|_|"源码产物回执无效")?;
    if receipt["source"]["commit"]!="dad014b7efd3e1d76a36e6bd9646487d28d9037e"||receipt["source"]["version"]!="0.1.7-alpha.2"||receipt["status"]!="SOURCE_SMOKE_PASSED"{return Err("源码 payload hook 来源不匹配".into());}
    let path="dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js";
    let expected="e2015c9cbb6dc2e4eba1c71705fd588800532939b39adfb2f061ee152b28de40";
    if !receipt["files"].as_array().is_some_and(|rows|rows.iter().any(|row|row["path"]==path&&row["sha256"]==expected)){return Err("源码 payload hook 清单不匹配".into());}
    let bytes=std::fs::read(runtime.join(path)).map_err(|_|"源码 payload hook 不可读")?;
    if format!("{:x}",Sha256::digest(bytes))!=expected{return Err("源码 payload hook 完整性失败".into());}Ok(())
}
pub fn can_hot_apply(version:&str,ready:bool,previous:Option<&profiles::Profile>,next:&profiles::Profile)->bool {
    version=="0.1.7-alpha.2"&&ready&&previous.is_some_and(|old|old.network==next.network)
}
pub fn build(root:&Path,runtime:&Path,catalog:&profiles::Catalog,selected:&profiles::Profile)->Result<Configuration,String>{
    let mut patch=config::overlay(&selected.connection,runtime)?;
    let mut providers=Map::new();let mut keys=Map::new();
    for profile in &catalog.profiles {
        if profile.network!=selected.network||profile.connection.base_url.is_empty(){continue;}
        let rows=config::overlay(&profile.connection,runtime)?;
        let mut provider=rows.iter().find(|row|row["id"]=="llm-pi-ai").and_then(|row|row["config"]["providers"].as_object()).and_then(|p|p.values().next()).ok_or("提供方配置缺失")?.clone();
        let route=format!("desktop-{}",profile.id);
        let key_name=format!("DSH_DESKTOP_PROVIDER_KEY_R{}_{}",catalog.revision,profile.id.strip_prefix("p-").unwrap_or("legacy"));
        provider["apiKeyEnv"]=json!(key_name);provider["displayName"]=json!(format!("{} · {}",profile.connection.provider_name,&profile.id[..profile.id.len().min(10)]));
        providers.insert(route,provider);keys.insert(key_name,json!(profiles::key(root,profile)?));
    }
    let route=format!("desktop-{}",selected.id);let selection=json!({"provider":route,"model":selected.connection.model});
    for row in &mut patch {
        if row["id"]=="llm-pi-ai" {row["config"]["providers"]=json!(providers);}
        if row["id"]=="agent-default-model" {row["config"]=selection.clone();}
        if let Some(inserts)=row["insert"].as_array_mut(){for entry in inserts {
            if entry["id"]=="desktop-model-defaults" {entry["config"]["provider"]=json!(route);}
            if entry["id"]=="desktop-observability" {entry["config"]["managedProvider"]=json!(route);}
        }}
    }
    // Leave room for the pipe envelope; the receiver refuses lines >= 2 MiB.
    if serde_json::to_vec(&json!({"providers":providers,"keys":keys,"selection":selection})).map_err(|_|"提供方配置无法编码")?.len()>2*1024*1024-1024{return Err("提供方配置超过监督管道容量，请减少模型目录后重试".into());}
    Ok(Configuration{patch,providers:json!(providers),selection,keys:json!(keys)})
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn same_model_connections_keep_distinct_routes_and_private_keys(){
  let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();let root=repo.join(".build").join(format!("source-providers-{}",profiles::new_id().unwrap()));std::fs::create_dir_all(&root).unwrap();
  let mut items=Vec::new();for api in [config::ApiFormat::OpenAi,config::ApiFormat::Anthropic]{let id=profiles::new_id().unwrap();let credential_ref=profiles::new_id().unwrap();config::write_key(&profiles::credential_id(&credential_ref),"synthetic-source-private").unwrap();items.push(profiles::Profile{id,credential_ref,network:profiles::Network::default(),connection:config::Connection{provider_name:"Same name".into(),base_url:"http://127.0.0.1:9/v1".into(),model:"same-model".into(),api,..Default::default()}});}
  let catalog=profiles::Catalog{schema_version:1,revision:77,active_id:items[0].id.clone(),profiles:items.clone()};let built=build(&root,&repo.join("runtime"),&catalog,&items[0]).unwrap();assert_eq!(built.providers.as_object().unwrap().len(),2);assert_eq!(built.keys.as_object().unwrap().len(),2);
  assert!(!serde_json::to_string(&built.patch).unwrap().contains("synthetic-source-private"));assert_ne!(built.providers[format!("desktop-{}",items[0].id)]["apiKeyEnv"],built.providers[format!("desktop-{}",items[1].id)]["apiKeyEnv"]);
  for item in items {config::delete_test_key(&profiles::credential_id(&item.credential_ref));}
 }
 #[test]fn process_network_changes_require_reload(){
  let a=profiles::Profile{id:"legacy".into(),connection:config::Connection::default(),network:profiles::Network::default(),credential_ref:String::new()};let mut b=a.clone();
  assert!(can_hot_apply("0.1.7-alpha.2",true,Some(&a),&b));b.connection.model="other".into();assert!(can_hot_apply("0.1.7-alpha.2",true,Some(&a),&b));
  b.network.proxy_mode=profiles::ProxyMode::Direct;assert!(!can_hot_apply("0.1.7-alpha.2",true,Some(&a),&b));
  b.network=a.network.clone();b.network.ca_file="changed.pem".into();assert!(!can_hot_apply("0.1.7-alpha.2",true,Some(&a),&b));assert!(!can_hot_apply("0.1.5-rc.2",true,Some(&a),&a));assert!(!can_hot_apply("0.1.7-alpha.2",false,Some(&a),&a));
 }
}
