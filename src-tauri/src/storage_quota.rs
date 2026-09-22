//! Shared accounting for desktop-owned stores across all physical profiles.
//! Native and Node writers share reservations through the private engine pipe.
use crate::storage;
use serde::{Deserialize,Serialize};
use std::{collections::HashMap,fs::{self,OpenOptions},io::{Read,Write},os::windows::{fs::OpenOptionsExt,io::AsRawHandle},path::{Path,PathBuf},sync::{Arc,Mutex}};
use windows_sys::Win32::Storage::FileSystem::*;

type Result<T> = std::result::Result<T,String>;
pub const DEFAULT_LIMIT:u64=2*1024*1024*1024;
const MAX_ENTRIES:usize=200000;
const MAX_PROFILES:usize=1024;
const ROOTS:[&str;7]=["desktop-measurements","desktop-cache-probes","desktop-self-tests","desktop-changes","desktop-actions","desktop-artifact-exports","desktop-task-snapshots"];
const SETTINGS:&str="desktop-storage-quota.json";
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Settings {version:u32,revision:u64,limit_bytes:u64}
fn valid_limit(bytes:u64)->bool{(256*1024*1024..=64*1024*1024*1024).contains(&bytes)&&bytes%(1024*1024)==0}
fn profile_id(id:&str)->bool {id.len()==34&&id.starts_with("p-")&&id[2..].bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ProfileUsage {pub id:String,pub home:PathBuf,pub bytes:u64,pub files:usize,pub complete:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Inventory {
    pub profiles:Vec<ProfileUsage>,pub bytes:u64,pub files:usize,pub warnings:Vec<String>,
    pub complete:bool,pub limit_bytes:u64,pub quota_revision:u64,pub reserved_bytes:u64,pub available_bytes:Option<u64>,
    pub enforcement:&'static str,
}
struct State {next:u64,leases:HashMap<u64,u64>}
#[derive(Clone)]
pub struct Quota {root:PathBuf,limit:u64,state:Arc<Mutex<State>>}
pub struct Reservation {state:Arc<Mutex<State>>,id:u64}
impl Drop for Reservation {fn drop(&mut self){if let Ok(mut state)=self.state.lock(){state.leases.remove(&self.id);}}}

// Metadata handles avoid following reparse points and do not read file contents.
fn file_size(path:&Path)->Result<u64> {
    let handle=OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).share_mode(FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(path).map_err(|_|"文件不可读取或正在变化")?;
    let mut info=BY_HANDLE_FILE_INFORMATION::default();
    if unsafe{GetFileInformationByHandle(handle.as_raw_handle(),&mut info)}==0 {return Err("无法读取文件元数据".into());}
    if info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_OFFLINE|FILE_ATTRIBUTE_ENCRYPTED)!=0||info.nNumberOfLinks!=1 {return Err("链接、硬链接或特殊文件未计入".into());}
    crate::task_snapshots::unnamed_stream_only(&handle)?;
    Ok(((info.nFileSizeHigh as u64)<<32)|info.nFileSizeLow as u64)
}
fn tree(path:&Path,depth:usize,entries:&mut usize,bytes:&mut u64,files:&mut usize)->Result<()> {
    if depth>32 {return Err("存储层级超过 32 层".into());}
    let _pins=storage::pin(path,false)?;
    for item in fs::read_dir(path).map_err(|_|"无法枚举存储目录")? {
        *entries+=1;if *entries>MAX_ENTRIES{return Err("总扫描超过 200000 项".into());}
        let item=item.map_err(|_|"存储项目正在变化或不可读取")?;
        let kind=item.file_type().map_err(|_|"无法检查存储类型")?;
        if kind.is_dir(){tree(&item.path(),depth+1,entries,bytes,files)?;}
        else if kind.is_file(){*bytes=bytes.checked_add(file_size(&item.path())?).ok_or("容量溢出")?;*files+=1;}
        else{return Err("存储中存在链接或特殊项目".into());}
    }
    Ok(())
}
fn homes(root:&Path)->Result<Vec<(String,PathBuf)>> {
    let _pins=storage::pin(root,false)?;
    let mut result=vec![("legacy".into(),root.join("dsh"))];
    let profiles=root.join("profiles");
    if !profiles.try_exists().map_err(|_|"无法检查连接目录")? {return Ok(result);}
    let _profiles=storage::pin(&profiles,false)?;
    let mut count=0;
    for item in fs::read_dir(&profiles).map_err(|_|"无法枚举连接目录")? {
        count+=1;if count>MAX_PROFILES{return Err("连接目录超过 1024 项".into());}
        let item=item.map_err(|_|"无法读取连接目录项目")?;
        let id=item.file_name().into_string().map_err(|_|"连接目录名无效")?;
        if !profile_id(&id){return Err("连接根目录存在无法识别的项目，统计不完整".into());}
        // Includes directories hidden by configuration rollback. Unknown data
        // is counted, never interpreted as safe-to-delete ownership evidence.
        let _profile=storage::pin(&item.path(),false)?;
        result.push((id,item.path().join("dsh")));
    }
    result.sort_by(|a,b|a.0.cmp(&b.0));Ok(result)
}
impl Quota {
    pub fn new(root:PathBuf)->Self {Self{root,limit:DEFAULT_LIMIT,state:Arc::new(Mutex::new(State{next:0,leases:HashMap::new()}))}}
    fn settings(&self)->Result<Settings>{
        let _pins=storage::pin(&self.root,false)?;
        let file=match OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(self.root.join(SETTINGS)){
            Ok(file)=>file,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Settings{version:1,revision:0,limit_bytes:self.limit}),Err(_)=>return Err("无法读取总配额设置，请保留原文件并检查本机存储".into()),
        };
        let mut info=BY_HANDLE_FILE_INFORMATION::default();
        if unsafe{GetFileInformationByHandle(file.as_raw_handle(),&mut info)}==0||info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_OFFLINE|FILE_ATTRIBUTE_ENCRYPTED)!=0||info.nNumberOfLinks!=1{return Err("总配额设置文件类型无效".into());}
        crate::task_snapshots::unnamed_stream_only(&file)?;
        let mut bytes=Vec::new();file.take(4097).read_to_end(&mut bytes).map_err(|_|"无法读取总配额设置")?;
        if bytes.len()>4096{return Err("总配额设置超过大小限制".into());}
        let value:Settings=serde_json::from_slice(&bytes).map_err(|_|"总配额设置损坏，请保留原文件并修复")?;
        if value.version!=1||value.revision==0||!valid_limit(value.limit_bytes){return Err("总配额设置版本或数值无效".into());}
        Ok(value)
    }
    pub fn set_limit(&self,expected_revision:u64,limit_bytes:u64)->Result<Inventory>{
        if !valid_limit(limit_bytes){return Err("总配额须为 256–65536 MiB 的整数值".into());}
        let state=self.state.lock().map_err(|_|"配额锁不可用")?;
        let _pins=storage::pin(&self.root,false)?;
        let current=self.settings()?;
        if current.revision!=expected_revision{return Err("总配额设置已变化，请重新扫描后保存".into());}
        let next=Settings{version:1,revision:current.revision.checked_add(1).ok_or("总配额修订号耗尽")?,limit_bytes};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"无法读取本机时间")?.as_nanos();
        let temp=self.root.join(format!("desktop-storage-quota-{}-{stamp}.new",std::process::id()));
        let mut file=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|"无法创建总配额临时设置")?;
        let result=(||->Result<()>{file.write_all(&serde_json::to_vec(&next).map_err(|_|"无法编码总配额设置")?).map_err(|_|"无法写入总配额设置")?;file.sync_all().map_err(|_|"无法保存总配额设置")?;Ok(())})();
        drop(file);
        if let Err(error)=result{let _=fs::remove_file(&temp);return Err(error);}
        if fs::rename(&temp,self.root.join(SETTINGS)).is_err(){let _=fs::remove_file(&temp);return Err("总配额保存失败，原设置保留；请检查文件占用后重新扫描".into());}
        // Existing leases remain valid even when the new limit is below usage.
        Ok(self.scan(state.leases.values().sum(),&next))
    }
    fn scan(&self,reserved:u64,settings:&Settings)->Inventory {
        let mut report=Inventory{profiles:vec![],bytes:0,files:0,warnings:vec![],complete:true,limit_bytes:settings.limit_bytes,quota_revision:settings.revision,reserved_bytes:reserved,available_bytes:None,enforcement:"NATIVE_AND_NODE_ADMISSION"};
        let homes=match homes(&self.root){Ok(v)=>v,Err(error)=>{report.complete=false;report.warnings.push(error);return report;}};
        let mut entries=0;
        for (id,home) in homes {
            let mut usage=ProfileUsage{id:id.clone(),home:home.clone(),bytes:0,files:0,complete:true};
            for name in ROOTS {
                let dir=home.join(name);
                let result=(||->Result<()>{
                    // Check the home even if the category itself is absent: a
                    // junction to an empty directory must not look trustworthy.
                    if !home.try_exists().map_err(|_|"连接存储不可检查")?{return Ok(());}
                    let _home=storage::pin(&home,false)?;
                    if !dir.try_exists().map_err(|_|"受管目录不可检查")?{return Ok(());}
                    tree(&dir,0,&mut entries,&mut usage.bytes,&mut usage.files)
                })();
                if let Err(error)=result{usage.complete=false;report.complete=false;report.warnings.push(format!("{id} / {name}：{error}"));}
            }
            if let Some(total)=report.bytes.checked_add(usage.bytes){report.bytes=total;}else{report.complete=false;report.warnings.push("容量统计溢出".into());}
            report.files+=usage.files;report.profiles.push(usage);
        }
        if report.complete {report.available_bytes=Some(settings.limit_bytes.saturating_sub(report.bytes.saturating_add(reserved)));}
        report
    }
    pub fn inspect(&self)->Result<Inventory>{let state=self.state.lock().map_err(|_|"配额锁不可用")?;Ok(self.scan(state.leases.values().sum(),&self.settings()?))}
    pub fn reserve(&self,home:&Path,bytes:u64)->Result<Reservation>{
        if bytes==0||bytes>1024*1024*1024{return Err("存储预留额度无效".into());}
        // Only the fixed legacy/profile layout is eligible; arbitrary workspace
        // or archive output paths cannot be admitted through this manager.
        let allowed=home==self.root.join("dsh") || home.parent().and_then(|p|p.file_name()).and_then(|p|p.to_str()).is_some_and(profile_id)&&home.parent().and_then(Path::parent)==Some(self.root.join("profiles").as_path())&&home.file_name().is_some_and(|n|n=="dsh");
        if !allowed{return Err("存储预留不属于此桌面目录".into());}
        let mut state=self.state.lock().map_err(|_|"配额锁不可用")?;
        if state.leases.len()>=1024{return Err("存储预留数量超过上限".into());}
        let report=self.scan(state.leases.values().sum(),&self.settings()?);
        if !report.complete{return Err("无法完整统计所有连接，未允许新增存储；请检查本机存储总览".into());}
        if report.available_bytes.unwrap_or(0)<bytes{return Err("所有连接的桌面记录已接近总配额，请先归档或清理后重试".into());}
        state.next=state.next.checked_add(1).ok_or("存储预留编号耗尽")?;let id=state.next;state.leases.insert(id,bytes);
        Ok(Reservation{state:self.state.clone(),id})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new()->Self{let root=std::env::temp_dir().join(format!("dsh-quota-test-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir_all(&root).unwrap();Self(root)}
        fn put(&self,path:&str,bytes:usize){let path=self.0.join(path);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,vec![0;bytes]).unwrap();}
        fn quota(&self,limit:u64)->Quota{Quota{limit,..Quota::new(self.0.clone())}}
    }
    impl Drop for Fixture {fn drop(&mut self){assert_eq!(self.0.parent(),Some(std::env::temp_dir().as_path()));assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("dsh-quota-test-"));let _=fs::remove_dir_all(&self.0);}}
    #[test]
    fn quota_counts_hidden_profiles_temporary_and_unknown_managed_files_only(){
        let f=Fixture::new();f.put("dsh/desktop-measurements/unknown.new",40);f.put("dsh/desktop-actions/workspace/config.json",10);
        f.put("profiles/p-11111111111111111111111111111111/dsh/desktop-task-snapshots/id/before-0.bin",70);
        f.put("dsh/sessions/native-history",1000);f.put("workspace/project.txt",2000);f.put("connections.json",20);
        let q=f.quota(200);let report=q.inspect().unwrap();assert!(report.complete,"{:?}",report.warnings);assert_eq!(report.bytes,120);assert_eq!(report.files,3);assert_eq!(report.profiles.len(),2);assert_eq!(report.available_bytes,Some(80));
        assert!(q.reserve(&f.0.join("dsh"),81).is_err());
        let lease=q.reserve(&f.0.join("dsh"),80).unwrap();assert_eq!(q.inspect().unwrap().available_bytes,Some(0));drop(lease);assert_eq!(q.inspect().unwrap().available_bytes,Some(80));
    }
    #[test]
    fn quota_serializes_parallel_reservations_and_drop_releases(){
        let f=Fixture::new();let q=f.quota(80);let home=f.0.join("dsh");
        let tasks=(0..8).map(|_|{let q=q.clone();let home=home.clone();std::thread::spawn(move||q.reserve(&home,20))}).collect::<Vec<_>>();
        let leases=tasks.into_iter().filter_map(|t|t.join().unwrap().ok()).collect::<Vec<_>>();assert_eq!(leases.len(),4);assert_eq!(q.inspect().unwrap().reserved_bytes,80);drop(leases);assert_eq!(q.inspect().unwrap().reserved_bytes,0);
    }
    #[test]
    fn quota_refuses_incomplete_inventory_and_outside_admission(){
        let f=Fixture::new();f.put("dsh/desktop-measurements/original",10);let q=f.quota(100);
        fs::hard_link(f.0.join("dsh/desktop-measurements/original"),f.0.join("duplicate")).unwrap();
        let report=q.inspect().unwrap();assert!(!report.complete);assert_eq!(report.available_bytes,None);assert!(q.reserve(&f.0.join("dsh"),1).is_err());
        fs::remove_file(f.0.join("duplicate")).unwrap();assert!(q.inspect().unwrap().complete);
        assert!(q.reserve(&f.0.join("workspace"),1).is_err());assert!(q.reserve(&f.0.join("profiles/invalid/dsh"),1).is_err());
        f.put("profiles/unknown/note",1);assert!(!q.inspect().unwrap().complete);assert!(q.reserve(&f.0.join("dsh"),1).is_err());
    }
    #[test]
    fn quota_recounts_writes_and_retains_existing_data_when_full(){
        let f=Fixture::new();let q=f.quota(100);let home=f.0.join("dsh");let lease=q.reserve(&home,60).unwrap();
        f.put("dsh/desktop-task-snapshots/id/start.json",50);
        assert!(q.reserve(&home,1).is_err(),"in-flight reservations remain conservative while writes grow");
        drop(lease);assert_eq!(q.inspect().unwrap().available_bytes,Some(50));
        f.put("dsh/desktop-cache-probes/old.json",60);assert!(q.reserve(&home,1).is_err());
        assert_eq!(fs::metadata(home.join("desktop-task-snapshots/id/start.json")).unwrap().len(),50);
        assert_eq!(fs::metadata(home.join("desktop-cache-probes/old.json")).unwrap().len(),60);
    }
    #[test]
    fn quota_settings_persist_cas_and_keep_existing_leases(){
        let f=Fixture::new();let q=Quota::new(f.0.clone());let home=f.0.join("dsh");let lease=q.reserve(&home,512*1024*1024).unwrap();
        let report=q.set_limit(0,256*1024*1024).unwrap();assert_eq!(report.quota_revision,1);assert_eq!(report.reserved_bytes,512*1024*1024);assert_eq!(report.available_bytes,Some(0));assert!(q.reserve(&home,1).is_err());
        assert_eq!(Quota::new(f.0.clone()).inspect().unwrap().limit_bytes,256*1024*1024);
        assert!(q.set_limit(0,DEFAULT_LIMIT).is_err());assert!(q.set_limit(1,1).is_err());
        drop(lease);assert_eq!(q.inspect().unwrap().reserved_bytes,0);let report=q.clone().set_limit(1,DEFAULT_LIMIT).unwrap();assert_eq!(report.quota_revision,2);assert_eq!(q.inspect().unwrap().limit_bytes,DEFAULT_LIMIT);
    }
    #[test]
    fn quota_settings_invalid_or_locked_keep_original(){
        let f=Fixture::new();let q=Quota::new(f.0.clone());q.set_limit(0,DEFAULT_LIMIT).unwrap();let path=f.0.join(SETTINGS);let before=fs::read(&path).unwrap();
        let lock=OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(&path).unwrap();
        assert!(q.set_limit(1,4*1024*1024*1024).is_err());assert_eq!(fs::read(&path).unwrap(),before);drop(lock);
        assert_eq!(fs::read_dir(&f.0).unwrap().count(),1,"failed staging is cleaned without changing settings");
        fs::write(&path,b"broken").unwrap();assert!(q.inspect().is_err());assert!(q.reserve(&f.0.join("dsh"),1).is_err());assert!(q.set_limit(1,DEFAULT_LIMIT).is_err());assert_eq!(fs::read(&path).unwrap(),b"broken");
        fs::write(&path,&before).unwrap();fs::hard_link(&path,f.0.join("duplicate")).unwrap();assert!(q.inspect().is_err());
    }
}
