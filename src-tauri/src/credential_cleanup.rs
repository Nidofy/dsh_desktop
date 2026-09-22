//! Explicit collection of unreferenced immutable profile credentials. Callers
//! hold save_lock. Referenced config files remain pinned through deletion.
use crate::{config,profiles,storage};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{collections::HashSet,fs::{File,OpenOptions},io::Read,os::windows::fs::OpenOptionsExt,path::Path,time::{SystemTime,UNIX_EPOCH}};
use windows_sys::Win32::Storage::FileSystem::*;
type Result<T>=std::result::Result<T,String>;
const EPOCH: u64=116444736000000000;
const DAY: u64=24*60*60*10_000_000;
fn now()->u64 {EPOCH+SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()*10_000_000}
struct References { _pins:Vec<File>, ids:HashSet<String>, fingerprint:String }
fn references(root:&Path,active:&str)->Result<References> {
    let mut pins=storage::pin(root,true)?;let mut ids=HashSet::new();let mut digest=Sha256::new();
    digest.update(b"desktop-credential-references-v1\0");digest.update(active.as_bytes());
    if !active.is_empty(){ids.insert(active.into());}
    for name in ["connections.json","connections.previous.json","connections.recovery-before.json","connections.new.json"] {
        digest.update(name.as_bytes());
        let mut file=match OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(root.join(name)) {
            Ok(file)=>file,
            Err(error) if error.kind()==std::io::ErrorKind::NotFound && name!="connections.json" => {digest.update([0]);continue;},
            Err(_)=>return Err("当前配置或备份不可读取；未开始凭据清理".into()),
        };
        use std::os::windows::{fs::MetadataExt,io::AsRawHandle};
        let meta=file.metadata().map_err(|_| "无法检查配置")?;
        let mut identity=BY_HANDLE_FILE_INFORMATION::default();
        if unsafe{GetFileInformationByHandle(file.as_raw_handle(),&mut identity)}==0 || identity.nNumberOfLinks!=1 || !meta.is_file() || meta.file_attributes()&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_OFFLINE|FILE_ATTRIBUTE_ENCRYPTED)!=0 || meta.len()>2*1024*1024 {return Err("配置不是受支持的普通文件；未开始清理".into());}
        crate::task_snapshots::unnamed_stream_only(&file)?;
        let mut data=Vec::new();file.by_ref().take(2*1024*1024+1).read_to_end(&mut data).map_err(|_| "无法读取配置")?;
        if data.len()>2*1024*1024 {return Err("配置大小超过上限".into());}
        let catalog:profiles::Catalog=serde_json::from_slice(&data).map_err(|_| "配置或备份损坏，无法确定凭据引用；未开始清理")?;
        profiles::validate_catalog(&catalog)?;
        for profile in catalog.profiles {if !profile.credential_ref.is_empty(){ids.insert(profile.credential_ref);}}
        digest.update([1]);digest.update(Sha256::digest(&data));pins.push(file);
    }
    Ok(References{_pins:pins,ids,fingerprint:format!("{:x}",digest.finalize())})
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Row {id:String,written_at:u64}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Preview {token:String,rows:Vec<Row>,referenced:usize,recent:usize,total:usize}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {pub token:String,pub ids:Vec<String>}
fn eligible(row:&config::CredentialMetadata,refs:&References,time:u64)->bool {!refs.ids.contains(&row.id)&&row.written.saturating_add(DAY)<=time}
fn preview(refs:&References,rows:&[config::CredentialMetadata],time:u64)->Preview {
    let mut digest=Sha256::new();digest.update(refs.fingerprint.as_bytes());
    for row in rows {digest.update(row.id.as_bytes());digest.update(row.written.to_le_bytes());}
    let referenced=rows.iter().filter(|r|refs.ids.contains(&r.id)).count();
    let candidates:Vec<_>=rows.iter().filter(|r|eligible(r,refs,time)).map(|r|Row{id:r.id.clone(),written_at:r.written.saturating_sub(EPOCH)/10000}).collect();
    Preview{token:format!("{:x}",digest.finalize()),recent:rows.len()-referenced-candidates.len(),referenced,total:rows.len(),rows:candidates}
}
pub fn inspect(root:&Path,active:&str)->Result<Preview> {let refs=references(root,active)?;Ok(preview(&refs,&config::profile_credentials()?,now()))}
#[derive(Serialize)]
pub struct Receipt {id:String,status:&'static str}
fn apply_at(root:&Path,active:&str,selection:Selection,time:u64)->Result<Vec<Receipt>> {
    let refs=references(root,active)?;let rows=config::profile_credentials()?;
    let current=preview(&refs,&rows,time);
    let mut seen=HashSet::new();
    if selection.ids.is_empty()||selection.ids.len()>128||selection.token!=current.token||selection.ids.iter().any(|id|!seen.insert(id)||!current.rows.iter().any(|r|&r.id==id)) {return Err("选择无效、仍被引用或预览已过期；请重新扫描".into());}
    let mut results=Vec::new();
    for id in selection.ids {
        // Recheck OS metadata immediately before each deletion. Configuration
        // handles are held for this entire batch; API keys are never read.
        let old=rows.iter().find(|r|r.id==id).unwrap();
        let fresh=match config::profile_credentials() {
            Ok(rows)=>rows,
            Err(_)=>{results.push(Receipt{id,status:"REFUSED"});continue;},
        };
        let status=match fresh.iter().find(|r|r.id==id) {
            None=>"ALREADY_MISSING",
            Some(row) if row!=old||!eligible(row,&refs,time)=>"CHANGED",
            Some(_)=>match config::delete_profile_credential(&id) {Ok(true)=>"DELETED",Ok(false)=>"ALREADY_MISSING",Err(_)=>"REFUSED"},
        };
        results.push(Receipt{id,status});
    }
    Ok(results)
}
pub fn apply(root:&Path,active:&str,selection:Selection)->Result<Vec<Receipt>> {apply_at(root,active,selection,now())}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    struct Fixture {root:std::path::PathBuf, ids:Vec<String>}
    impl Fixture {
        fn new()->Self {
            let root=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join(".build").join(format!("credential-cleanup-{}",now()+SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos() as u64));
            fs::create_dir_all(&root).unwrap();
            let ids=(0..7).map(|_|{let mut bytes=[0u8;16];
                use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom,BCRYPT_USE_SYSTEM_PREFERRED_RNG};
                assert_eq!(unsafe{BCryptGenRandom(std::ptr::null_mut(),bytes.as_mut_ptr(),16,BCRYPT_USE_SYSTEM_PREFERRED_RNG)},0);
                format!("p-{}",bytes.iter().map(|b|format!("{b:02x}")).collect::<String>())}).collect();
            Self{root,ids}
        }
        fn write(&self,name:&str,id:&str) {
            let catalog=profiles::Catalog{schema_version:1,revision:1,active_id:"legacy".into(),profiles:vec![profiles::Profile{id:"legacy".into(),connection:config::Connection{provider_name:"Fixture".into(),base_url:"http://127.0.0.1:25641/v1".into(),model:"test".into(),..Default::default()},network:profiles::Network::default(),credential_ref:id.into()}]};
            fs::write(self.root.join(name),serde_json::to_vec(&catalog).unwrap()).unwrap();
        }
        fn seed(&self) {for id in &self.ids {config::write_key(&profiles::credential_id(id),"isolated-cleanup-fixture-secret").unwrap();}}
    }
    impl Drop for Fixture {fn drop(&mut self){for id in &self.ids{config::delete_key(&profiles::credential_id(id));}}}
    #[test]
    fn cleanup_preserves_all_config_and_active_references_and_grace() {
        let _guard=config::CREDENTIAL_TEST_LOCK.lock().unwrap();let f=Fixture::new();f.seed();
        for (i,name) in ["connections.json","connections.previous.json","connections.recovery-before.json","connections.new.json"].iter().enumerate(){f.write(name,&f.ids[i]);}
        let refs=references(&f.root,&f.ids[4]).unwrap();let rows=config::profile_credentials().unwrap();
        let recent=preview(&refs,&rows,now());assert!(!recent.rows.iter().any(|r|f.ids.contains(&r.id)));
        let later=now()+2*DAY;let p=preview(&refs,&rows,later);
        for id in &f.ids[..5] {assert!(!p.rows.iter().any(|r|&r.id==id));}
        assert!(p.rows.iter().any(|r|r.id==f.ids[5]));drop(refs);
        let receipts=apply_at(&f.root,&f.ids[4],Selection{token:p.token,ids:vec![f.ids[5].clone()]},later).unwrap();
        assert_eq!(receipts[0].status,"DELETED");
        let remaining=config::profile_credentials().unwrap();assert!(!remaining.iter().any(|r|r.id==f.ids[5]));
        for i in [0,1,2,3,4,6] {assert!(remaining.iter().any(|r|r.id==f.ids[i]));}
        assert!(!serde_json::to_string(&inspect(&f.root,&f.ids[4]).unwrap()).unwrap().contains("fixture-secret"));
    }
    #[test]
    fn cleanup_refuses_stale_selection_and_malformed_backup_without_deletion() {
        let _guard=config::CREDENTIAL_TEST_LOCK.lock().unwrap();let f=Fixture::new();f.seed();f.write("connections.json",&f.ids[0]);
        let later=now()+2*DAY;
        let token=||{let refs=references(&f.root,"").unwrap();preview(&refs,&config::profile_credentials().unwrap(),later).token};
        let old=token();f.write("connections.previous.json",&f.ids[5]);
        assert!(apply_at(&f.root,"",Selection{token:old,ids:vec![f.ids[5].clone()]},later).is_err());
        let current=token();assert!(apply_at(&f.root,"",Selection{token:current,ids:vec![f.ids[6].clone(),f.ids[0].clone()]},later).is_err());
        let old=token();config::write_key(&profiles::credential_id(&f.ids[6]),"changed-fixture").unwrap();
        assert!(apply_at(&f.root,"",Selection{token:old,ids:vec![f.ids[6].clone()]},later).is_err());
        fs::write(f.root.join("connections.recovery-before.json"),b"{broken").unwrap();assert!(inspect(&f.root,"").is_err());
        for id in &f.ids {assert!(config::profile_credentials().unwrap().iter().any(|r|&r.id==id));}
    }
    #[test]
    fn cleanup_pins_config_and_refuses_hardlinks_and_missing_catalog() {
        let _guard=config::CREDENTIAL_TEST_LOCK.lock().unwrap();let f=Fixture::new();
        assert!(references(&f.root,"").is_err());f.write("connections.json",&f.ids[0]);
        let refs=references(&f.root,"").unwrap();
        assert!(fs::write(f.root.join("connections.json"),b"{}").is_err());
        assert!(fs::rename(f.root.join("connections.json"),f.root.join("moved.json")).is_err());drop(refs);
        fs::hard_link(f.root.join("connections.json"),f.root.join("copy.json")).unwrap();assert!(references(&f.root,"").is_err());
    }
    #[test]
    fn cleanup_namespace_excludes_other_credentials_and_never_exposes_values() {
        let _guard=config::CREDENTIAL_TEST_LOCK.lock().unwrap();let f=Fixture::new();
        let legacy=format!("https://{}.invalid/v1",f.ids[0]);let malformed=format!("connection-profile-v1/{}/nested",f.ids[1]);
        config::write_key(&legacy,"legacy-fixture").unwrap();config::write_key(&malformed,"other-fixture").unwrap();
        let rows=config::profile_credentials().unwrap();assert!(!rows.iter().any(|r|r.id==legacy||r.id.contains('/')));
        assert!(config::delete_profile_credential(&legacy).is_err());assert!(config::delete_profile_credential("p-../../bad").is_err());
        assert_eq!(config::read_key(&legacy).unwrap(),"legacy-fixture");assert_eq!(config::read_key(&malformed).unwrap(),"other-fixture");
        config::delete_key(&legacy);config::delete_key(&malformed);
    }
}
