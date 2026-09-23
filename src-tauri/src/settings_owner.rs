//! Recover only the tagged startup lock written by our own stopped child.
//! Empty/native/foreign locks remain untouched. No age-based cleanup.
use std::{fs,io::Read,path::Path,os::windows::{fs::OpenOptionsExt,io::AsRawHandle}};
use serde::{Serialize,Deserialize};
#[derive(Serialize,Deserialize)]pub struct Owner{pub pid:u32,pub token:String}
fn dead(pid:u32)->bool{unsafe{
 use windows_sys::Win32::{System::Threading::{OpenProcess,GetExitCodeProcess,PROCESS_QUERY_LIMITED_INFORMATION},Foundation::CloseHandle};
 let h=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,0,pid);if h.is_null(){return std::io::Error::last_os_error().raw_os_error()==Some(87);}
 let mut code=259;let ok=GetExitCodeProcess(h,&mut code);CloseHandle(h);ok!=0&&code!=259
}}
pub fn record(root:&Path,owner:&Owner)->Result<(),String>{use std::io::Write;let path=root.join("desktop-settings-owner.new");let mut file=fs::File::create(&path).map_err(|_|"无法保存设置写入者身份")?;file.write_all(&serde_json::to_vec(owner).unwrap()).and_then(|_|file.sync_all()).map_err(|_|"无法刷新设置写入者身份")?;drop(file);fs::rename(path,root.join("desktop-settings-owner.json")).map_err(|_|"无法提交设置写入者身份".into())}
pub fn recover(root:&Path)->Result<bool,String>{
 let path=root.join("dsh/settings.yaml.lock");if !path.exists(){return Ok(false);}
 let mut bytes=Vec::new();let Ok(file)=fs::File::open(root.join("desktop-settings-owner.json"))else{return Ok(false)};if file.take(4097).read_to_end(&mut bytes).is_err()||bytes.len()>4096{return Ok(false);}
 let Ok(owner)=serde_json::from_slice::<Owner>(&bytes)else{return Ok(false)};
 if owner.token.len()!=34||!owner.token.starts_with("p-")||!owner.token[2..].bytes().all(|b|b.is_ascii_hexdigit()){return Ok(false);}
 if !dead(owner.pid){return Ok(false);}
 let mut file=match fs::OpenOptions::new().read(true).write(true).access_mode(0x80000000|0x10000).share_mode(0).custom_flags(0x00200000).open(&path){Ok(file)=>file,Err(_)=>return Ok(false)};
 use std::os::windows::fs::MetadataExt;
 let metadata=file.metadata().map_err(|_|"无法检查设置锁")?;if metadata.file_attributes()&0x400!=0||metadata.len()>128{return Ok(false);}
 let mut token=String::new();file.read_to_string(&mut token).map_err(|_|"无法读取设置锁")?;
 if token!=format!("DSHDesktop-startup:{}",owner.token){return Ok(false);}
 unsafe{use windows_sys::Win32::Storage::FileSystem::{SetFileInformationByHandle,FileDispositionInfo,FILE_DISPOSITION_INFO};
 let info=FILE_DISPOSITION_INFO{DeleteFile:true};if SetFileInformationByHandle(file.as_raw_handle() as _,FileDispositionInfo,&info as *const _ as _,std::mem::size_of_val(&info) as u32)==0{return Err("已确认原写入者退出，但设置锁无法释放".into());}}
 drop(file);Ok(true)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn recovery_requires_tag_and_confirmed_dead_writer(){
  let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();let root=repo.join(".build").join(format!("owner-{}",crate::profiles::new_id().unwrap()));fs::create_dir_all(root.join("dsh")).unwrap();
  let lock=root.join("dsh/settings.yaml.lock");let token=crate::profiles::new_id().unwrap();fs::write(&lock,format!("DSHDesktop-startup:{token}")).unwrap();
  record(&root,&Owner{pid:std::process::id(),token:token.clone()}).unwrap();assert!(!recover(&root).unwrap());assert!(lock.exists());
  let mut child=std::process::Command::new(repo.join("runtime/runtime/node.exe")).args(["-e","process.exit(0)"]).spawn().unwrap();let pid=child.id();child.wait().unwrap();
  record(&root,&Owner{pid,token:token.clone()}).unwrap();fs::write(&lock,"").unwrap();assert!(!recover(&root).unwrap());
  fs::write(&lock,"DSHDesktop-startup:p-ffffffffffffffffffffffffffffffff").unwrap();assert!(!recover(&root).unwrap());
  fs::write(&lock,format!("DSHDesktop-startup:{token}")).unwrap();assert!(recover(&root).unwrap());assert!(!lock.exists());assert!(!recover(&root).unwrap());
 }
}
