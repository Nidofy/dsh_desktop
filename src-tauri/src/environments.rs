//! Candidate data is never mounted into the stable environment. Checkpoints are
//! inert archives: original project paths are not activated in the candidate.
use std::{fs,path::{Path,PathBuf},sync::OnceLock,os::windows::{fs::MetadataExt,process::CommandExt}};
use serde_json::{json,Value};
static ID:OnceLock<String>=OnceLock::new();
pub fn id()->&'static str {ID.get().map(String::as_str).unwrap_or("stable")}
pub fn valid_id(id:&str)->bool{id.len()==34&&id.starts_with("c-")&&id[2..].bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
pub fn initialize()->Result<(),String>{
 let args=std::env::args().skip(1).collect::<Vec<_>>();
 let versions:Value=serde_json::from_str(include_str!("../../versions.json")).map_err(|_|"构建版本无效")?;
 let value=if args.is_empty(){if versions["dsh"]=="0.1.7-alpha.2"{default_source_candidate(&stable_root()?,env!("CARGO_PKG_VERSION"))?}else{"stable".into()}}else if args.len()==2&&args[0]=="--environment"&&valid_id(&args[1]){args[1].clone()}else{return Err("无效的环境启动参数".into());};
 ID.set(value).map_err(|_|"环境已初始化")?;
 if id()!="stable" {let root=selected(id())?;let file=root.join("environment.json");if regular(&file)?.len()>4096{return Err("环境清单过大".into());}let meta:Value=serde_json::from_slice(&fs::read(file).map_err(|_|"候选环境不存在")?).map_err(|_|"环境清单损坏")?;if meta["schemaVersion"]!=1||meta["id"]!=id(){return Err("环境版本不支持".into());}}
 Ok(())
}
// Source releases open an isolated, version-scoped candidate on a normal double
// click. No launcher script or writes to the sealed package are needed.
// Existing incomplete/foreign directories are refused, never repaired or reset.
fn default_source_candidate(base:&Path,version:&str)->Result<String,String>{
 use sha2::{Digest,Sha256};
 let digest=format!("{:x}",Sha256::digest(format!("DSHDesktop/source-candidate/v1/{version}")));
 let name=format!("c-{}",&digest[..32]);
 fs::create_dir_all(base).map_err(|_|"无法创建候选数据根目录")?;regular(base)?;
 let parent=base.join("candidates");fs::create_dir_all(&parent).map_err(|_|"无法创建候选目录")?;regular(&parent)?;
 let target=parent.join(&name);
 if !target.exists(){
  let staging=parent.join(format!(".new-{}",crate::profiles::new_id()?));fs::create_dir(&staging).map_err(|_|"候选环境创建失败")?;
  let manifest=json!({"schemaVersion":1,"id":name,"createdWith":version,"projects":"independent","checkpoints":"not-mounted","defaultSourceCandidate":true});
  use std::io::Write;
  let mut file=fs::OpenOptions::new().write(true).create_new(true).open(staging.join("environment.json")).map_err(|_|"候选清单创建失败")?;
  file.write_all(&serde_json::to_vec_pretty(&manifest).unwrap()).and_then(|_|file.sync_all()).map_err(|_|"候选清单写入失败")?;drop(file);
  fs::create_dir(staging.join("workspace")).map_err(|_|"候选工作区创建失败")?;
  if fs::rename(&staging,&target).is_err()&&!target.exists(){return Err("候选环境安装失败，已保留暂存目录".into());}
 }
 regular(&target)?;let path=target.join("environment.json");let metadata=regular(&path)?;
 if !metadata.is_file()||metadata.len()>4096{return Err("默认候选清单无效，请从已有候选恢复，原数据未改变".into());}
 let manifest:Value=serde_json::from_slice(&fs::read(&path).map_err(|_|"默认候选清单不可读")?).map_err(|_|"默认候选清单损坏，原数据未改变")?;
 if manifest["schemaVersion"]!=1||manifest["id"]!=name||manifest["createdWith"]!=version||manifest["defaultSourceCandidate"]!=true{return Err("默认候选身份不匹配，原数据未改变".into());}
 Ok(name)
}
pub fn stable_root()->Result<PathBuf,String>{Ok(PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA 不可用")?).join("DSHDesktop"))}
pub fn root()->Result<PathBuf,String>{let base=stable_root()?;Ok(if id()=="stable"{base}else{base.join("candidates").join(id())})}
fn regular(path:&Path)->Result<fs::Metadata,String>{let m=fs::symlink_metadata(path).map_err(|_|"无法读取环境文件")?;if m.file_attributes()&0x400!=0||m.file_type().is_symlink(){return Err("环境目录不接受链接或重解析点".into());}Ok(m)}
fn safe_tree(path:&Path,count:&mut usize,bytes:&mut u64)->Result<(),String>{
 scan_tree(path,count,bytes,0)
}
fn scan_tree(path:&Path,count:&mut usize,bytes:&mut u64,depth:usize)->Result<(),String>{
 if depth>64{return Err("检查点目录层级超过 64 层".into());}
 let m=regular(path)?;*count+=1;*bytes+=m.len();if *count>100000||*bytes>4*1024*1024*1024{return Err("检查点超过 100000 项或 4 GiB 上限".into());}
 if m.is_dir(){for e in fs::read_dir(path).map_err(|_|"无法读取环境目录")?{scan_tree(&e.map_err(|_|"环境目录读取失败")?.path(),count,bytes,depth+1)?;}}else if !m.is_file(){return Err("环境包含特殊文件".into());}Ok(())
}
fn candidates()->Result<PathBuf,String>{let base=stable_root()?;fs::create_dir_all(&base).map_err(|_|"无法创建数据目录")?;regular(&base)?;let path=base.join("candidates");fs::create_dir_all(&path).map_err(|_|"无法创建候选目录")?;regular(&path)?;Ok(path)}
fn selected(value:&str)->Result<PathBuf,String>{if !valid_id(value){return Err("候选环境编号无效".into());}let path=candidates()?.join(value);regular(&path)?;Ok(path)}
fn copy_tree(source:&Path,target:&Path)->Result<(),String>{
 copy_bounded(source,target,&mut 0,&mut 0,0)
}
fn copy_bounded(source:&Path,target:&Path,count:&mut usize,bytes:&mut u64,depth:usize)->Result<(),String>{
 use std::{io::Read,os::windows::fs::OpenOptionsExt};
 if depth>64{return Err("检查点目录层级超过 64 层".into());}*count+=1;if *count>100000{return Err("检查点文件过多".into());}
 let m=regular(source)?;if m.is_dir(){fs::create_dir(target).map_err(|_|"无法创建检查点子目录")?;for e in fs::read_dir(source).map_err(|_|"读取检查点失败")?{let e=e.map_err(|_|"读取检查点失败")?;copy_bounded(&e.path(),&target.join(e.file_name()),count,bytes,depth+1)?;}}
 else{let input=fs::OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000).open(source).map_err(|_|"检查点文件仍被写入或不可读")?;let actual=input.metadata().map_err(|_|"检查点文件不可读")?;if actual.file_attributes()&0x400!=0||!actual.is_file(){return Err("检查点包含链接或特殊文件".into());}
 *bytes=bytes.checked_add(actual.len()).ok_or("检查点过大")?;if *bytes>4*1024*1024*1024{return Err("检查点超过 4 GiB".into());}
 let mut output=fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|_|"写入检查点失败")?;let n=std::io::copy(&mut input.take(actual.len()+1),&mut output).map_err(|_|"复制检查点失败")?;if n!=actual.len(){return Err("检查点源发生变化".into());}output.sync_all().map_err(|_|"检查点未刷新")?;}Ok(())
}
fn remove_tree(path:&Path,budget:&mut usize)->Result<(),String>{
 *budget+=1;if *budget>100000{return Err("候选环境文件过多，请分批整理后重试".into());}
 let m=fs::symlink_metadata(path).map_err(|_|"无法检查删除目标")?;
 // Unlink junctions/symlinks themselves, never traverse their targets.
 if m.file_attributes()&0x400!=0 {if m.file_attributes()&0x10!=0{fs::remove_dir(path)}else{fs::remove_file(path)}.map_err(|_|"无法移除候选环境链接")?;return Ok(());}
 if m.is_dir(){for e in fs::read_dir(path).map_err(|_|"候选目录不可读")?{remove_tree(&e.map_err(|_|"候选目录不可读")?.path(),budget)?;}fs::remove_dir(path).map_err(|_|"候选目录无法删除")?;}
 else{fs::remove_file(path).map_err(|_|"候选文件无法删除")?;}Ok(())
}
pub fn dispatch(action:&str,selection:Option<&str>)->Result<Value,String>{
 match action {
 "list"=>{let mut entries=Vec::new();for e in fs::read_dir(candidates()?).map_err(|_|"环境目录不可用")?.take(100){let e=e.map_err(|_|"环境目录不可用")?;let value=e.file_name().to_string_lossy().into_owned();if valid_id(&value){entries.push(json!({"id":value,"active":value==id()}));}}Ok(json!({"current":id(),"entries":entries}))},
 "create"=>{let name=crate::profiles::new_id()?.replacen("p-","c-",1);let base=candidates()?;let staging=base.join(format!(".new-{name}"));fs::create_dir(&staging).map_err(|_|"环境创建失败")?;
  fs::write(staging.join("environment.json"),serde_json::to_vec_pretty(&json!({"schemaVersion":1,"id":name,"createdWith":env!("CARGO_PKG_VERSION"),"projects":"independent","checkpoints":"not-mounted"})).unwrap()).map_err(|_|"环境清单写入失败")?;
  fs::create_dir(staging.join("workspace")).map_err(|_|"工程目录创建失败")?;fs::rename(staging,base.join(&name)).map_err(|_|"环境安装失败")?;Ok(json!({"id":name}))},
 "open"|"launch"|"delete"|"checkpoint"=>{let value=selection.ok_or("请选择环境")?;let path=selected(value)?;
  match action {
   "launch"=>{std::process::Command::new(std::env::current_exe().map_err(|_|"程序路径不可用")?).args(["--environment",value]).creation_flags(0x08000000).spawn().map_err(|_|"候选环境启动失败")?;},
   "open"=>{std::process::Command::new(PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows 目录不可用")?).join("explorer.exe")).arg(&path).creation_flags(0x08000000).spawn().map_err(|_|"无法打开环境目录")?;},
   "delete"=>{if value==id(){return Err("不能删除当前环境".into());}let _owner=crate::process::Instance::for_environment(value).ok_or("请先退出该候选环境")?;
    // Exact generated ID under validated candidates root, never a user path.
    crate::config::delete_environment_credentials(value)?;remove_tree(&path,&mut 0)?;},
   "checkpoint"=>{if id()=="stable"{return Err("请从候选环境操作，并先完全退出正式环境。".into());}
    let _stable=crate::process::Instance::for_environment("stable").ok_or("正式环境仍在运行，请先完全退出")?;
    let _candidate=if value!=id(){Some(crate::process::Instance::for_environment(value).ok_or("目标候选环境仍在运行")?)}else{None};
    let source=stable_root()?.join("dsh/storages");let(mut count,mut bytes)=(0,0);safe_tree(&source,&mut count,&mut bytes)?;
    let staging=path.join(format!(".checkpoint-{}",crate::profiles::new_id()?));copy_tree(&source,&staging)?;
    use std::io::Write;let mut manifest=fs::OpenOptions::new().write(true).create_new(true).open(staging.join("checkpoint-manifest.json")).map_err(|_|"检查点清单已存在或不可写")?;manifest.write_all(&serde_json::to_vec_pretty(&json!({"schemaVersion":1,"source":"stable/storages","files":count,"bytes":bytes,"mounted":false,"credentialsIncluded":false,"projectFilesIncluded":false})).unwrap()).and_then(|_|manifest.sync_all()).map_err(|_|"检查点清单失败")?;drop(manifest);
    let target=path.join(format!("checkpoint-{}",crate::profiles::new_id()?));fs::rename(staging,target).map_err(|_|"检查点发布失败")?;
   },_=>unreachable!()
  }Ok(json!({"ok":true}))
 },_=>Err("不支持的环境操作".into())
 }
}
#[cfg(test)] mod tests{use super::*;#[test]fn identifiers_cannot_escape(){assert!(valid_id("c-1234567890abcdef1234567890abcdef"));for value in ["stable","../stable","c-../","C-1234567890abcdef1234567890abcdef"]{assert!(!valid_id(value));}}}
#[cfg(test)]mod checkpoint_tests {
 use super::*;
 #[test]fn default_source_launch_is_version_scoped_and_preserves_stable_and_unknown_data(){
  let root=std::env::temp_dir().join(format!("dsh-source-launch-{}",crate::profiles::new_id().unwrap()));fs::create_dir_all(root.join("dsh")).unwrap();fs::write(root.join("dsh/keep"),"stable data").unwrap();
  let a=default_source_candidate(&root,"0.2.5-rc.1").unwrap();assert!(valid_id(&a));assert_eq!(default_source_candidate(&root,"0.2.5-rc.1").unwrap(),a);
  let b=default_source_candidate(&root,"0.2.5-rc.2").unwrap();assert_ne!(a,b);assert_eq!(fs::read_to_string(root.join("dsh/keep")).unwrap(),"stable data");
  let manifest=root.join("candidates").join(a).join("environment.json");fs::write(&manifest,"unknown interruption").unwrap();assert!(default_source_candidate(&root,"0.2.5-rc.1").is_err());assert_eq!(fs::read_to_string(manifest).unwrap(),"unknown interruption");
 }
 #[test]fn bounded_copy_is_inert_refuses_collisions_and_links(){
  let repo=Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();let root=repo.join(".build").join(format!("checkpoint-{}",crate::profiles::new_id().unwrap()));let source=root.join("source");fs::create_dir_all(source.join("sessions")).unwrap();fs::write(source.join("sessions/fixture.json"),"{\"version\":2}").unwrap();
  let target=root.join(".checkpoint-staging");copy_tree(&source,&target).unwrap();assert_eq!(fs::read(source.join("sessions/fixture.json")).unwrap(),fs::read(target.join("sessions/fixture.json")).unwrap());assert!(!root.join("dsh").exists());assert!(copy_tree(&source,&target).is_err());assert!(copy_bounded(&source,&root.join("over-limit"),&mut 100000,&mut 0,0).is_err());assert!(scan_tree(&source,&mut 0,&mut 0,65).is_err());
  let external=root.join("external");fs::create_dir(&external).unwrap();fs::write(external.join("keep.txt"),"keep").unwrap();let link=source.join("link");assert!(std::process::Command::new("cmd.exe").args(["/d","/c","mklink","/J"]).arg(&link).arg(&external).creation_flags(0x08000000).output().unwrap().status.success());assert!(safe_tree(&source,&mut 0,&mut 0).is_err());remove_tree(&source,&mut 0).unwrap();assert_eq!(fs::read_to_string(external.join("keep.txt")).unwrap(),"keep");
 }
 #[test]fn process_locks_separate_environments_but_refuse_duplicate_instances(){let id=crate::profiles::new_id().unwrap().replacen("p-","c-",1);let id2=crate::profiles::new_id().unwrap().replacen("p-","c-",1);let first=crate::process::Instance::for_environment(&id).unwrap();assert!(crate::process::Instance::for_environment(&id).is_none());let other=crate::process::Instance::for_environment(&id2).unwrap();drop(first);assert!(crate::process::Instance::for_environment(&id).is_some());drop(other);}
}
