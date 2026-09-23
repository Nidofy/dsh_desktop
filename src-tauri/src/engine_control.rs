use crate::engine::{Control,Engine};
use serde_json::{json,Value};
use std::{sync::mpsc,time::{Duration,Instant}};
pub struct Ticket {pub id:String,pub pid:Option<u32>,pub epoch:String,pub revision:u64,pub at:Instant}
impl Ticket {fn matches(&self,id:Option<&str>,pid:Option<u32>,epoch:&str,revision:u64,now:Instant)->bool{Some(self.id.as_str())==id&&self.pid==pid&&self.epoch==epoch&&self.revision==revision&&now.saturating_duration_since(self.at)<Duration::from_secs(60)}}
pub fn inspect(engine:&Engine,action:&str)->Result<Value,String>{
 if !["status","cancel"].contains(&action){return Err("无效的切换操作".into());}
 let id=crate::profiles::new_id()?[2..].to_string();
 let state=engine.state.lock().map_err(|_|"引擎状态不可用")?.clone();
 let revision=crate::profiles::load(&engine.root)?.revision;
 let (tx,rx)=mpsc::channel();
 engine.control.send(Control::Inspect{id:id.clone(),action:action.into(),reply:tx}).map_err(|_|"引擎管理已退出")?;
 let mut value=rx.recv_timeout(Duration::from_secs(4)).unwrap_or_else(|_|json!({"known":false}));
 let current=engine.state.lock().map_err(|_|"引擎状态不可用")?;
 if current.backend_pid!=state.backend_pid||current.engine_epoch!=state.engine_epoch {return Err("引擎已变化，请重新检查".into());}
 drop(current);
 *engine.switch_ticket.lock().map_err(|_|"切换控制不可用")?=Some(Ticket{id:id.clone(),pid:state.backend_pid,epoch:state.engine_epoch.clone(),revision,at:Instant::now()});
 value["ticket"]=json!(id);value["epoch"]=json!(state.engine_epoch);value["revision"]=json!(revision);
 value["automaticAdmission"]=json!(false);
 Ok(value)
}
pub fn authorize(engine:&Engine,ticket:Option<&str>)->Result<(),String>{
 let state=engine.state.lock().map_err(|_|"引擎状态不可用")?;
 // Even failed/starting processes require an explicit acknowledgement; only
 // a genuinely absent backend can be started without interrupting anything.
 if state.backend_pid.is_none(){return Ok(());}
 let revision=crate::profiles::load(&engine.root)?.revision;
 let mut current=engine.switch_ticket.lock().map_err(|_|"切换控制不可用")?;
 if !current.as_ref().is_some_and(|t|t.matches(ticket,state.backend_pid,&state.engine_epoch,revision,Instant::now())){
  return Err("请先检查任务状态，再确认停止并应用；旧确认已失效。".into());
 }
 current.take();Ok(())
}
#[cfg(test)]mod tests {use super::*;#[test]fn confirmation_is_bound_and_expires(){let now=Instant::now();let t=Ticket{id:"one".into(),pid:Some(3),epoch:"generation-a".into(),revision:7,at:now};assert!(t.matches(Some("one"),Some(3),"generation-a",7,now));for (id,pid,epoch,revision,time) in [(Some("two"),Some(3),"generation-a",7,now),(Some("one"),Some(4),"generation-a",7,now),(Some("one"),Some(3),"generation-b",7,now),(Some("one"),Some(3),"generation-a",8,now),(Some("one"),Some(3),"generation-a",7,now+Duration::from_secs(60))]{assert!(!t.matches(id,pid,epoch,revision,time));}}}
