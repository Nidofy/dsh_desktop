//! Per-generation snapshot lane. File operations retain their native deadlines
//! and save lock, while stop/exit remains on the supervisor thread.
use crate::{engine::Engine,task_snapshots::{TaskBridge,Navigation}};
use std::{path::PathBuf,sync::{Arc,atomic::{AtomicBool,Ordering},mpsc::{self,Receiver}},thread,time::Duration};
pub struct Reply {pub line:String,pub status:String,pub navigation:Option<Navigation>}
pub struct Worker {pub replies:Receiver<Reply>,stop:Arc<AtomicBool>}
impl Worker {
    pub fn new(engine:Engine,home:PathBuf,mut bridge:TaskBridge,requests:Receiver<String>)->Self{
        Self::spawn(engine.snapshot_workers.clone(),requests,move |line|{
            let guard=engine.save_lock.try_lock().ok();
            bridge.handle(&home,&line,guard.is_some()).map(|line|Reply{line,status:bridge.last_status.clone(),navigation:bridge.navigation.take()})
        })
    }
    fn spawn(workers:Arc<std::sync::atomic::AtomicUsize>,requests:Receiver<String>,mut handle:impl FnMut(String)->Option<Reply>+Send+'static)->Self {
        let stop=Arc::new(AtomicBool::new(false));let stopping=stop.clone();
        let(tx,replies)=mpsc::sync_channel(64);
        workers.fetch_add(1,Ordering::SeqCst);
        thread::spawn(move || {
            struct Lease(Arc<std::sync::atomic::AtomicUsize>);
            impl Drop for Lease {fn drop(&mut self){self.0.fetch_sub(1,Ordering::SeqCst);}}
            let _lease=Lease(workers);
            while !stopping.load(Ordering::SeqCst){
                let line=match requests.recv_timeout(Duration::from_millis(100)){
                    Ok(line)=>line,Err(mpsc::RecvTimeoutError::Timeout)=>continue,Err(_)=>break,
                };
                if stopping.load(Ordering::SeqCst){break;}
                if let Some(reply)=handle(line){
                    if !stopping.load(Ordering::SeqCst){let _=tx.try_send(reply);}
                }
            }
        });
        Self{replies,stop}
    }
}
impl Drop for Worker {fn drop(&mut self){self.stop.store(true,Ordering::SeqCst);}}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slow_capture_does_not_block_exit_and_next_generation_waits_for_drain(){
        let workers=Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let(tx,requests)=mpsc::sync_channel(64);let(entered,entry)=mpsc::channel();let(release,wait)=mpsc::channel();
        let calls=Arc::new(std::sync::atomic::AtomicUsize::new(0));let count=calls.clone();
        let worker=Worker::spawn(workers.clone(),requests,move |line|{count.fetch_add(1,Ordering::SeqCst);entered.send(()).unwrap();wait.recv().unwrap();Some(Reply{line,status:"done".into(),navigation:None})});
        tx.send("first".into()).unwrap();entry.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(workers.load(Ordering::SeqCst),1);
        tx.send("queued".into()).unwrap();
        let start=std::time::Instant::now();drop(worker);assert!(start.elapsed()<Duration::from_millis(100));
        assert_eq!(workers.load(Ordering::SeqCst),1,"new generation must not write before the old write finishes");
        release.send(()).unwrap();let deadline=std::time::Instant::now()+Duration::from_secs(1);
        while workers.load(Ordering::SeqCst)!=0{assert!(std::time::Instant::now()<deadline);thread::sleep(Duration::from_millis(1));}
        assert_eq!(calls.load(Ordering::SeqCst),1,"queued old-generation operations are discarded");
    }
}
