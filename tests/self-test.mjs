import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SelfTestRun,SelfTestStore,contracts,exportSelfTest,selfTestMarkdown} from '../runtime-src/self-test.mjs';
import {providerSelfTests} from '../runtime-src/self-test-provider.mjs';
import {installSelfTestCenter} from '../runtime-src/self-test-center.mjs';
await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/self-test-unit-'));
const store=new SelfTestStore(root);let called=0,release;
const runner=new SelfTestRun({store,local:async({check,signal})=>{called++;await check('storage',async()=>({metrics:{files:1,privatePath:root}}));await new Promise(resolve=>{release=resolve;signal.addEventListener('abort',resolve,{once:true});});},provider:async()=>{called++;}});
assert.throws(()=>runner.start({mode:'provider',model:'secret',accepted:false,fingerprint:'a'.repeat(64)}));assert.equal(called,0);
const report=runner.start({mode:'local'});assert.throws(()=>runner.start({mode:'local'}));while(!release)await new Promise(r=>setTimeout(r,5));assert.throws(()=>runner.cancel('wrong'));
const cold=await store.read(report.id);assert.equal(cold.status,'INTERRUPTED');assert(cold.rows.some(row=>row.code==='PROCESS_INTERRUPTED'));assert.equal(called,1);
runner.cancel(report.id);await runner.done;assert.equal(runner.snapshot().status,'CANCELLED');assert.equal((await store.read(report.id)).status,'CANCELLED');
const hostile={...runner.snapshot(),model:root,warning:'PRIVATE_ERROR',rows:[{id:'node',label:root,scope:root,status:'PASS',code:'OK',metrics:{files:1,privatePath:root},error:'PRIVATE_ERROR'}]};const raw=JSON.stringify(exportSelfTest(hostile));assert(!raw.includes(root));assert(!raw.includes('PRIVATE_ERROR'));assert.equal(JSON.parse(raw).rows.length,25);assert(!selfTestMarkdown(hostile).includes(root));
const failed=new SelfTestRun({store:{save:async()=>{throw Error('PRIVATE_DISK');}},local:async()=>{called++;},provider:async()=>{called++;}});failed.start({mode:'local'});await failed.done;assert.equal(called,1,'persist intent before running checks');assert.equal(failed.snapshot().warning,'STORAGE_FAILED');
const localFail=new SelfTestRun({store,local:async({check})=>{await check('storage',async()=>{throw Error('PRIVATE_DISK');});},provider:async()=>{}});localFail.start({mode:'local'});await localFail.done;assert.equal(localFail.snapshot().rows.find(r=>r.id==='storage').status,'FAIL');assert(!JSON.stringify(localFail.snapshot()).includes('PRIVATE_DISK'));
// Terminal state must not become visible before the final write releases the run.
let releaseFinal,finalSaved=false;
const finishing=new SelfTestRun({store:{save:async value=>{if(value.status==='COMPLETED'&&!finalSaved){await new Promise(resolve=>{releaseFinal=resolve;});finalSaved=true;}}},local:async()=>{},provider:async()=>{}});
finishing.start({mode:'local'});while(!releaseFinal)await new Promise(setImmediate);
assert.equal(finishing.snapshot().status,'RUNNING');assert.throws(()=>finishing.start({mode:'local'}));
releaseFinal();await finishing.done;assert.equal(finishing.snapshot().status,'COMPLETED');
finishing.start({mode:'local'});await finishing.done;assert.equal(finishing.snapshot().status,'COMPLETED');
// Keep only 20 bounded reports; cold reads of RUNNING records never invoke work.
for(let i=0;i<22;i++){const r={...localFail.snapshot(),id:crypto.randomUUID(),startedAt:i};await store.save(r);}assert.equal((await store.list()).length,20);
await assert.rejects(()=>store.read('../escape'));await assert.rejects(()=>store.save({...report,id:'../escape'}));
// Provider preparation refuses hidden retries before any stream is started.
let sent=0;const cache={state:async()=>({fingerprint:'a'.repeat(64)}),probe:{prepare:async()=>{throw Error('Must not prepare');}}};const ctx={llm:{prepareCall:async()=>({retryPolicy:{maxRetries:1},stream:async function*(){sent++;}})}};
const provider=new SelfTestRun({store,local:async()=>{},provider:providerSelfTests(ctx,cache)});provider.start({mode:'provider',accepted:true,model:'synthetic',fingerprint:'a'.repeat(64)});await provider.done;assert.equal(sent,0);assert.equal(provider.snapshot().rows.find(r=>r.id==='connection').code,'RETRIES_ENABLED');
const limitedCache={state:cache.state,probe:{prepare:async()=>({configuration:{},calls:Array.from({length:4},()=>({config:{},async *stream(){sent++;yield {type:'text-delta',text:'synthetic',index:0};yield {type:'finish',reason:{kind:'stop'}};}}))})}};
const limitedCtx={llm:{prepareCall:async()=>({config:{},retryPolicy:{maxRetries:0},async *stream(){sent++;yield {type:'finish',reason:{kind:'max-tokens'}};}})}};
const limited=new SelfTestRun({store:{save:async()=>{}},local:async()=>{},provider:providerSelfTests(limitedCtx,limitedCache)});limited.start({mode:'provider',accepted:true,model:'synthetic',fingerprint:'a'.repeat(64)});await limited.done;assert.equal(sent,5);const limitedRows=limited.snapshot().rows;assert.equal(limitedRows.find(r=>r.id==='tool-call').status,'UNKNOWN');assert.equal(limitedRows.find(r=>r.id==='tool-call').code,'OUTPUT_LIMIT');assert.equal(limitedRows.find(r=>r.id==='cache-counter').code,'NO_COUNTER');assert.equal(limitedRows.find(r=>r.id==='cache-repeat').code,'NO_POSITIVE_CACHE_READ');
// HTTP contracts use the product handler, not a second implementation.
let cleanup;const center=installSelfTestCenter({effect:fn=>{cleanup=fn();}},root,{state:async()=>({models:[{id:'synthetic'}],fingerprint:'a'.repeat(64)})});
async function api(path,body,headers={}){let status,raw;const req={method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:10',origin:'http://127.0.0.1:10','content-type':'application/json',...headers},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};const res={writeHead(value){status=value;return this;},end(value){raw=value;}};await center.handle(req,res,new URL('http://127.0.0.1:10/desktop-diagnostics/api/self-test/'+path));return {status,value:JSON.parse(raw)};}
assert.equal((await api('state')).value.current,null);assert.equal((await api('start',{mode:'local'},{origin:'https://elsewhere.invalid'})).status,403);assert.equal((await api('start',{mode:'provider',accepted:true,model:'synthetic',fingerprint:'b'.repeat(64)})).status,409);assert.equal(center.runner.current,null);await cleanup();
console.log('PASS self-test lifecycle: intent persistence, cancellation, cold interruption, no replay, 20-report retention, metadata allowlist, provider retry refusal and same-origin controls');
