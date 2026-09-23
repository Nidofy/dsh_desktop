import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {synchronizeDesktopSettings} from '../runtime-src/settings-sync.mjs';
import {settingsTransaction} from '../runtime-src/settings-transaction.mjs';
import {settingsProtection} from '../runtime-src/settings-protection.mjs';
import {diagnosticState} from '../runtime-src/diagnostic-state.mjs';

const runtimeRoot=resolve(process.env.LEGACY_TEST_RUNTIME??'runtime'),require=createRequire(join(runtimeRoot,'dsh/package.json'));
const {parse,stringify}=require('yaml');
const {writeFileAtomic}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href);
// Deterministic process-independent key only for synthetic test payloads.
const key=Buffer.alloc(32,19);
const protection={
  async protect(bytes){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);},
  async unprotect(bytes){const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]);},
};
const missing=async file=>{try{await lstat(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
async function fixture(){
  const home=await mkdtemp(resolve('.build/settings-transaction-')),patchFile=join(home,'patch.json'),file=join(home,'settings.yaml');
  const original={apiKey:'synthetic-sensitive-native-b',models:[{id:'native-b'}]};
  await writeFile(file,stringify({'llm-pi-ai':{providers:{b:original,empty:null}},'ui-theme':{mode:'light'},'spill-policy':{maxInlineBytes:12345}}));
  async function select(route,options={}){
    await writeFile(patchFile,JSON.stringify([{id:'llm-pi-ai',config:{providers:{[route]:{apiKeyEnv:'DSH_DESKTOP_LLM_KEY',models:[{id:'desktop-model'}]}}}},{id:'agent-default-model',config:{provider:route,model:'desktop-model'}}]));
    await synchronizeDesktopSettings({home,patchFile,runtimeRoot,transactionOptions:{protection,...options}});
  }
  return {home,file,original,select,journal:join(home,'desktop-settings-transaction.json')};
}
const points=['before:prepared','prepared','after:desktop-experiment-baseline.json','after:settings.yaml','after:desktop-settings-revision.json','committed'];
for(const point of points){
  diagnosticState.preferences={enabled:true};
  const f=await fixture();await f.select('a');
  diagnosticState.preferences={enabled:true,spillMode:'compact'};
  await assert.rejects(f.select('b',{fault:async phase=>{if(phase===point)throw Error('INJECTED_STOP');}}),/INJECTED_STOP/);
  if(point!=='before:prepared'){
    const pending=await readFile(f.journal,'utf8');assert(!pending.includes('synthetic-sensitive'));assert(!pending.includes('native-b'));assert(!pending.includes('settings.yaml'));
  }
  await f.select('b');await f.select('a');
  const result=parse(await readFile(f.file,'utf8'));
  assert.deepEqual(result['llm-pi-ai'].providers.b,f.original,point);
  assert.equal(result['ui-theme'].mode,'light');
  assert.equal(JSON.parse(await readFile(join(f.home,'desktop-experiment-baseline.json'),'utf8')).spillMode.value,12345);
  assert(await missing(f.journal));
  await f.select('a');assert(await missing(f.journal));
}
console.log('PASS settings transaction: six interruption points, original provider and experiment baseline, encryption, idempotent recovery');
diagnosticState.preferences={enabled:true};
{
 const f=await fixture();await f.select('a');await f.select('empty');await f.select('a');
 const providers=parse(await readFile(f.file,'utf8'))['llm-pi-ai'].providers;
 assert(Object.hasOwn(providers,'empty'));assert.equal(providers.empty,null,'explicit null remains distinct from absent');
}
{
 const f=await fixture();await f.select('a');
 await assert.rejects(f.select('b',{fault:async phase=>{if(phase==='after:settings.yaml')throw Error('STOP');}}),/STOP/);
 const expected=await readFile(f.file,'utf8');
 const edited=expected+'\nexternal-preference: changed\n';await writeFile(f.file,edited);
 const marker=await readFile(join(f.home,'desktop-settings-revision.json'),'utf8');
 await assert.rejects(f.select('b'),{code:'SETTINGS_TRANSACTION_CONFLICT'});
 assert.equal(await readFile(f.file,'utf8'),edited);assert.equal(await readFile(join(f.home,'desktop-settings-revision.json'),'utf8'),marker);
 assert(!await missing(f.journal));
 await writeFile(f.file,expected);await f.select('b');await f.select('a');
 assert.deepEqual(parse(await readFile(f.file,'utf8'))['llm-pi-ai'].providers.b,f.original);
}
{
 const f=await fixture();await f.select('a');
 await assert.rejects(f.select('b',{fault:async phase=>{if(phase==='prepared')throw Error('STOP');}}));
 const before=await readFile(f.file,'utf8'),journal=await readFile(f.journal,'utf8');
 await writeFile(f.journal,journal.slice(0,-10));
 await assert.rejects(f.select('b'),{code:'SETTINGS_TRANSACTION_UNREADABLE'});assert.equal(await readFile(f.file,'utf8'),before);
 await writeFile(f.journal,journal);await f.select('b',{protection:{...protection,unprotect:async()=>{throw Error('wrong account');}}}).then(()=>assert.fail(),e=>assert.equal(e.code,'SETTINGS_TRANSACTION_UNREADABLE'));
 assert.equal(await readFile(f.file,'utf8'),before);
 await f.select('b');await f.select('a');assert.deepEqual(parse(await readFile(f.file,'utf8'))['llm-pi-ai'].providers.b,f.original);
}
{
 const home=await mkdtemp(resolve('.build/settings-io-'));
 await writeFile(join(home,'settings.yaml'),'before');
 const tx=settingsTransaction(home,async(path,...args)=>{if(path.endsWith('settings.yaml'))throw Object.assign(Error('disk full'),{code:'ENOSPC'});return writeFileAtomic(path,...args);},{protection});
 await assert.rejects(tx.commit({'settings.yaml':'after','desktop-settings-revision.json':'marker'}),{code:'ENOSPC'});
 assert.equal(await readFile(join(home,'settings.yaml'),'utf8'),'before');
 assert(await missing(join(home,'desktop-settings-revision.json')));
 assert.equal(await settingsTransaction(home,writeFileAtomic,{protection}).recover(),true);
 assert.equal(await readFile(join(home,'settings.yaml'),'utf8'),'after');
}
console.log('PASS settings transaction: missing/null, external edits, corrupt journal, unavailable protection, failed write and recovery');
{
 const home=await mkdtemp(resolve('.build/settings-render-race-'));
 await writeFile(join(home,'settings.yaml'),'external-new-value');
 await assert.rejects(settingsTransaction(home,writeFileAtomic,{protection}).commit({'settings.yaml':'rendered-from-old-value'},{'settings.yaml':'old-value'}),{code:'SETTINGS_TRANSACTION_CONFLICT'});
 assert.equal(await readFile(join(home,'settings.yaml'),'utf8'),'external-new-value');
 assert(await missing(join(home,'desktop-settings-transaction.json')));
 console.log('PASS settings transaction: external edit between read/render and prepare is preserved');
}
// Actual Windows DPAPI, including tamper rejection. No real settings or credentials.
if(process.platform==='win32'){
 const plain=Buffer.from('synthetic-settings-private-roundtrip');
 const protectedBytes=await settingsProtection.protect(plain);
 assert(!protectedBytes.includes(plain));assert.deepEqual(await settingsProtection.unprotect(protectedBytes),plain);
 const corrupt=Buffer.from(protectedBytes);corrupt[Math.floor(corrupt.length/2)]^=1;
 await assert.rejects(settingsProtection.unprotect(corrupt));
 console.log('PASS settings protection: real Windows CurrentUser DPAPI roundtrip and tamper rejection');
}
