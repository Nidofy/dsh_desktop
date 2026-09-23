//! A single bounded HTTP lane per engine generation. Dropping the lane never
//! waits on HTTP; late results have no route to the next engine or its windows.
use std::{io::Read, sync::mpsc::{self, Receiver, SyncSender}, thread, time::Duration};
use serde_json::Value;
use url::Url;

pub enum Request { Health(Url), Events(String) }
pub enum Reply { Health { transport: bool, core: bool }, Events(Option<Value>) }
pub struct Worker { tx: SyncSender<Request>, rx: Receiver<Reply>, pending: bool }
impl Worker {
    pub fn new(engine_version: String) -> Self {
        let agent=ureq::AgentBuilder::new().timeout(Duration::from_secs(2)).redirects(0).build();
        Self::with_fetch(move |request| match request {
            Request::Health(url) => {
                // The announced URL establishes the upstream authentication cookie.
                // Page availability is recorded separately from core capability readiness.
                let transport=page_available(&agent,&url);
                let value=get_json(&agent,&format!("{}/desktop-diagnostics/api/health",url.origin().ascii_serialization()),4096);
                let core=value.is_some_and(|v|v["contractVersion"]==1 && v["engineVersion"]==engine_version && v["coreReady"]==true);
                Reply::Health{transport,core}
            }
            Request::Events(url) => Reply::Events(get_json(&agent,&url,32768)),
        })
    }
    fn with_fetch(mut fetch: impl FnMut(Request)->Reply + Send + 'static) -> Self {
        let(tx,requests)=mpsc::sync_channel(1);let(replies,rx)=mpsc::sync_channel(1);
        thread::spawn(move || while let Ok(request)=requests.recv(){if replies.send(fetch(request)).is_err(){break;}});
        Self{tx,rx,pending:false}
    }
    pub fn submit(&mut self, request: Request)->bool {
        if self.pending{return false;}
        if self.tx.try_send(request).is_err(){return false;}
        self.pending=true;true
    }
    pub fn poll(&mut self)->Option<Reply>{let reply=self.rx.try_recv().ok()?;self.pending=false;Some(reply)}
}
fn page_available(agent:&ureq::Agent,url:&Url)->bool {
    let Ok(response)=agent.get(url.as_str()).call() else{return false;};
    if response.status()==200{return true;}
    if !matches!(response.status(),302|303|307|308){return false;}
    let Some(next)=response.header("location").and_then(|value|url.join(value).ok()) else{return false;};
    if next.origin()!=url.origin() || !next.username().is_empty() || next.password().is_some(){return false;}
    agent.get(next.as_str()).call().is_ok_and(|r|r.status()==200)
}
fn get_json(agent:&ureq::Agent,url:&str,limit:u64)->Option<Value>{
    let response=agent.get(url).call().ok()?;
    if response.status()!=200{return None;}
    let mut bytes=Vec::new();response.into_reader().take(limit+1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64>limit{return None;}
    serde_json::from_slice(&bytes).ok()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authentication_redirect_and_core_health_are_separate(){
        use std::{net::TcpListener,io::{BufRead,BufReader,Write}};
        let server=TcpListener::bind("127.0.0.1:0").unwrap();
        let url=Url::parse(&format!("http://{}/?token=synthetic",server.local_addr().unwrap())).unwrap();
        let server_thread=thread::spawn(move||{
            for (index,(status,headers,body)) in [
                ("302 Found","Location: /\r\nSet-Cookie: dsh=synthetic; Path=/\r\n",""),
                ("503 Unavailable","","page unavailable"),
                ("200 OK","Content-Type: application/json\r\n",r#"{"contractVersion":1,"engineVersion":"0.1.5-rc.2","coreReady":true}"#),
            ].iter().enumerate(){
                let(mut socket,_)=server.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut reader=BufReader::new(socket.try_clone().unwrap());let mut request=String::new();
                loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\r\n"{break;}request.push_str(&line);}
                if index>0 {assert!(request.to_lowercase().contains("cookie: dsh=synthetic"));}
                write!(socket,"HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        let mut worker=Worker::new("0.1.5-rc.2".into());assert!(worker.submit(Request::Health(url)));
        let end=std::time::Instant::now()+Duration::from_secs(7);
        loop{if let Some(Reply::Health{transport,core})=worker.poll(){assert!(!transport);assert!(core);break;}
            assert!(std::time::Instant::now()<end);thread::sleep(Duration::from_millis(5));}
        server_thread.join().unwrap();
    }
    #[test]
    fn hung_query_never_blocks_control_or_accumulates_requests(){
        let(release,wait)=mpsc::channel();let(entered,entry)=mpsc::channel();
        let mut worker=Worker::with_fetch(move |_|{entered.send(()).unwrap();let _=wait.recv();Reply::Events(None)});
        assert!(worker.submit(Request::Events("local".into())));entry.recv_timeout(Duration::from_secs(1)).unwrap();
        for _ in 0..1000 {assert!(!worker.submit(Request::Events("queued".into())));assert!(worker.poll().is_none());}
        let now=std::time::Instant::now();drop(worker);assert!(now.elapsed()<Duration::from_millis(100));
        release.send(()).unwrap(); // late reply is discarded, not applied to a new generation
        let mut next=Worker::with_fetch(|_|Reply::Health{transport:false,core:true});
        assert!(next.poll().is_none());assert!(next.submit(Request::Events("new".into())));
        let deadline=std::time::Instant::now()+Duration::from_secs(1);
        loop {if let Some(Reply::Health{transport,core})=next.poll(){assert!(!transport);assert!(core);break;}
            assert!(std::time::Instant::now()<deadline);thread::sleep(Duration::from_millis(1));}
    }
}
