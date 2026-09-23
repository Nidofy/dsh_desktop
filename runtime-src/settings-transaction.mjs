import {lstat,readFile,unlink,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {settingsProtection} from './settings-protection.mjs';

const names=new Set(['settings.yaml','cordis.patch.yml','desktop-settings-revision.json','desktop-experiment-baseline.json','desktop-legacy-migration.json']);
const journalName='desktop-settings-transaction.json',fileLimit=2*1024*1024,journalLimit=24*1024*1024;
const hash=text=>createHash('sha256').update(text).digest('hex');
const failure=code=>Object.assign(Error(code),{code});
export async function readSettingsFile(home,name,limit=fileLimit){
  if(!names.has(name)&&name!==journalName)throw failure('SETTINGS_TRANSACTION_INVALID');
  const path=join(home,name);
  let stat;try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw failure('SETTINGS_TRANSACTION_INVALID');
  const bytes=await readFile(path);
  if(bytes.length>limit)throw failure('SETTINGS_TRANSACTION_INVALID');
  const text=bytes.toString('utf8');
  if(!Buffer.from(text).equals(bytes))throw failure('SETTINGS_TRANSACTION_INVALID');
  return text;
}
const digest=text=>text===null?{exists:false,sha256:null}:{exists:true,sha256:hash(text)};
const matches=(text,value)=>value.exists?text!==null&&hash(text)===value.sha256:text===null;

// Caller holds the same native settings.yaml lock throughout recovery and commit.
// Roll forward is idempotent; unknown external edits stop recovery without overwriting.
export function settingsTransaction(home,writeAtomic,{protection=settingsProtection,fault=async()=>{}}={}){
  const write=async(name,text)=>{
    const path=join(home,name);
    await writeAtomic(path,text,{mode:0o600,dirMode:0o700});
    const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
  };
  async function validate(record){
    if(record?.schemaVersion!==1||typeof record.id!=='string'||!/^[a-f0-9-]{36}$/.test(record.id)||!Array.isArray(record.writes)||record.writes.length<1||record.writes.length>3)throw failure('SETTINGS_TRANSACTION_INVALID');
    const seen=new Set();
    for(const item of record.writes){
      if(!names.has(item?.name)||seen.has(item.name)||typeof item.text!=='string'||Buffer.byteLength(item.text)>fileLimit||item.after!==hash(item.text)||typeof item.before?.exists!=='boolean'||(item.before.exists?!/^[a-f0-9]{64}$/.test(item.before.sha256):item.before.sha256!==null))throw failure('SETTINGS_TRANSACTION_INVALID');
      seen.add(item.name);
    }
  }
  async function checkAll(record){
    for(const item of record.writes){
      const current=await readSettingsFile(home,item.name);
      if(!matches(current,item.before)&&!matches(current,{exists:true,sha256:item.after}))throw failure('SETTINGS_TRANSACTION_CONFLICT');
    }
  }
  async function finish(record){
    await validate(record);await checkAll(record);
    for(const item of record.writes){
      const current=await readSettingsFile(home,item.name);
      if(!matches(current,{exists:true,sha256:item.after})){
        if(!matches(current,item.before))throw failure('SETTINGS_TRANSACTION_CONFLICT');
        await write(item.name,item.text);
      }
      await fault('after:'+item.name);
    }
    for(const item of record.writes)if(!matches(await readSettingsFile(home,item.name),{exists:true,sha256:item.after}))throw failure('SETTINGS_TRANSACTION_CONFLICT');
    await fault('committed');
    await unlink(join(home,journalName));
  }
  async function recover(){
    const text=await readSettingsFile(home,journalName,journalLimit);
    if(text===null)return false;
    let record;
    try{
      const envelope=JSON.parse(text);
      if(envelope.schemaVersion!==1||envelope.protection!=='windows-dpapi-current-user'||typeof envelope.payload!=='string'||!envelope.payload||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload))throw Error();
      const plain=await protection.unprotect(Buffer.from(envelope.payload,'base64'));
      try{record=JSON.parse(plain.toString('utf8'));}finally{plain.fill(0);}
    }catch{throw failure('SETTINGS_TRANSACTION_UNREADABLE');}
    await finish(record);return true;
  }
  async function commit(changes,expected){
    if(await readSettingsFile(home,journalName,journalLimit)!==null)throw failure('SETTINGS_TRANSACTION_PENDING');
    const record={schemaVersion:1,id:randomUUID(),writes:[]};
    for(const [name,text] of Object.entries(changes)){
      const before=await readSettingsFile(home,name);
      if(expected&&Object.hasOwn(expected,name)&&before!==expected[name])throw failure('SETTINGS_TRANSACTION_CONFLICT');
      if(before!==text)record.writes.push({name,before:digest(before),text,after:hash(text)});
    }
    if(!record.writes.length)return false;
    await validate(record);
    const plain=Buffer.from(JSON.stringify(record));let protectedBytes;
    try{protectedBytes=await protection.protect(plain);}finally{plain.fill(0);}
    const envelope=JSON.stringify({schemaVersion:1,protection:'windows-dpapi-current-user',payload:protectedBytes.toString('base64')});
    if(Buffer.byteLength(envelope)>journalLimit)throw failure('SETTINGS_TRANSACTION_INVALID');
    await fault('before:prepared');
    await write(journalName,envelope);
    await fault('prepared');
    await finish(record);return true;
  }
  return {recover,commit};
}
