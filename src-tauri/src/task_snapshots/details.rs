//! Stored evidence only: available even if the original workspace is gone.
use super::*;
use serde_json::{json, Value};

fn content(state: &State) -> Value {
    match state {
        State::Absent => json!({"kind":"absent"}),
        State::File { hash, size, .. } => json!({"kind":"file","sha256":hash,"bytes":size}),
    }
}
fn backup(dir: &Path, name: &str, expected: Option<&State>) -> Value {
    let path = dir.join(name);
    match path.try_exists() {
        Ok(false) => return json!({"status":if matches!(expected,Some(State::Absent)){"NOT_NEEDED"}else{"MISSING"}}),
        Err(_) => return json!({"status":"UNAVAILABLE"}),
        _ => (),
    }
    let result = (|| -> Result<Vec<u8>> {
        let mut file = file_open(&path,false,false).map_err(|_| "备份不可读取")?;
        bytes(&mut file)
    })();
    match result {
        Ok(data) => {
            let digest=hash(&data);
            let verified=matches!(expected,Some(State::File{hash,size,..}) if hash==&digest && *size==data.len());
            json!({"name":name,"status":if verified{"VERIFIED"}else{"UNVERIFIED"},"bytes":data.len(),"sha256":digest})
        }
        Err(_) => json!({"name":name,"status":"UNAVAILABLE"}),
    }
}
impl Store {
    pub fn details(&self,id:&str)->Result<Value> {
        let start=self.record(id,"start.json")?;
        let dir=self.dir(id)?;
        let pair=self.pair(id).ok();
        let end=pair.as_ref().map(|(_,end)|end);
        let mut rows=Vec::new();
        for (i,entry) in start.entries.iter().enumerate() {
            let final_entry=end.and_then(|record|record.entries.get(i));
            let journal_path=dir.path.join(format!("restore-{i}.json"));
            let receipt_path=dir.path.join(format!("result-{i}.json"));
            let journal=read_json::<Journal>(&journal_path).ok().filter(|j| j.version==1 && j.path==entry.path && j.target==entry.state && final_entry.is_some_and(|e|j.expected==e.state));
            let receipt=read_json::<Receipt>(&receipt_path).ok().filter(|r| matches!(r.status.as_str(),"RESTORED"|"ROLLED_BACK"|"INTERRUPTED") && journal.as_ref().is_some_and(|j|r.time>=j.prepared_at));
            let prior_path=dir.path.join(format!("pre-restore-{i}.bin"));
            let touched=[&journal_path,&receipt_path,&prior_path].iter().any(|p|p.try_exists().unwrap_or(true));
            let recovery=if let Some(result)=receipt {
                json!({"status":result.status,"preparedAt":journal.as_ref().map(|j|j.prepared_at),"completedAt":result.time})
            } else if touched {
                json!({"status":"UNKNOWN","preparedAt":journal.as_ref().map(|j|j.prepared_at)})
            } else {json!({"status":"NOT_ATTEMPTED"})};
            rows.push(json!({"path":entry.path,"before":content(&entry.state),"end":final_entry.map(|e|content(&e.state)),"originalBackup":backup(&dir.path,&format!("before-{i}.bin"),Some(&entry.state)),"recoveryBackup":if touched{backup(&dir.path,&format!("pre-restore-{i}.bin"),final_entry.map(|e|&e.state))}else{json!({"status":"NOT_CREATED"})},"recovery":recovery}));
        }
        Ok(json!({"snapshot":self.summary(&start),"endRecordedAt":end.map(|e|e.created_at),"rows":rows,"storagePath":dir.path,"currentWorkspaceChecked":false}))
    }
}
