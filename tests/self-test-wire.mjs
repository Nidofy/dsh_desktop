import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=()=>new Promise(r=>setTimeout(r,100));
// Called by the existing real-engine HTTP fixture with --self-test-only.
export async function runSelfTestWire({protocol,api,url,requests,home,setMode,restart,crashRestart,withVcs=false}){
 const state=await api('self-test/state');const before=requests.length;assert.equal(state.current,null);assert(state.models.length);assert.equal((await api('self-test/history')).length,0);assert.equal(requests.length,before);
 const wait=async id=>{const end=Date.now()+190000;while(Date.now()<end){const r=await api('self-test/report?id='+id);if(r.status!=='RUNNING')return r;await pause();}throw Error('Self-test timeout');};
 let {origin,cookie}=url();
 assert.equal((await fetch(origin+'/desktop-diagnostics/self-test')).status,401);
 assert.equal((await fetch(origin+'/desktop-diagnostics/api/self-test/start',{method:'POST',headers:{cookie,origin:'https://elsewhere.invalid','content-type':'application/json'},body:'{"mode":"local"}'})).status,403);
 const local=await api('self-test/start',{mode:'local'},202);const done=await wait(local.id);
 writeFileSync(join(home,'self-test-local.json'),JSON.stringify(done,null,2));
 assert.equal(done.status,'COMPLETED',JSON.stringify(done));assert.equal(done.rows.length,25);
 for(const row of done.rows.filter(r=>r.group==='local'))assert.equal(row.status,!withVcs&&['git','hg'].includes(row.id)?'SKIPPED':'PASS',JSON.stringify(row));
 assert.equal(requests.length,before,'local self-test never calls a model');
 const connection=(await api('self-test/state'));const options={mode:'provider',model:connection.models[0].id,accepted:true,fingerprint:connection.fingerprint};
 await api('self-test/start',{...options,accepted:false},409);await api('self-test/start',{...options,fingerprint:'0'.repeat(64)},409);assert.equal(requests.length,before);
 setMode('normal');const start=await api('self-test/start',options,202);await api('self-test/start',options,409);const provider=await wait(start.id);
 writeFileSync(join(home,'self-test-provider.json'),JSON.stringify(provider,null,2));
 assert.equal(provider.status,'COMPLETED');for(const row of provider.rows.filter(r=>r.group==='provider'))assert.equal(row.status,'PASS',JSON.stringify(row));
 const wire=requests.slice(before);assert.equal(wire.length,5);assert.equal(wire.filter(r=>r.body.tools?.length).length,1,'only synthetic tool probe has a schema');
 for(const r of wire){assert(!JSON.stringify(r.body).includes('PRIVATE_PROMPT'));assert(!JSON.stringify(r.body).includes('AGENTS.md'));}
 const exported=await fetch(origin+'/desktop-diagnostics/api/export?selfTest='+start.id,{headers:{cookie}});assert.equal(exported.status,200);const raw=await exported.text();for(const secret of ['PRIVATE_FIXTURE_REPLY','desktop-test-key',home,options.model,start.id,'SYNTHETIC_OK'])assert(!raw.includes(secret));assert.equal(JSON.parse(raw).rows.length,25);
 assert((await (await fetch(origin+'/desktop-diagnostics/api/export?selfTest='+start.id+'&format=md',{headers:{cookie}})).text()).includes('# DSH Desktop 自检'));
 // A real streamed request is cancelled through the product API.
 setMode('cancel');const cancelled=await api('self-test/start',options,202);const pendingEnd=Date.now()+15000;while(requests.length<before+6&&Date.now()<pendingEnd)await pause();assert.equal(requests.length,before+6);await api('self-test/cancel',{id:cancelled.id});assert.equal((await wait(cancelled.id)).status,'CANCELLED');
 setMode('normal');await restart();const cold=await api('self-test/report?id='+start.id);assert.equal(cold.status,'COMPLETED');assert.equal((await api('self-test/history')).length,3);
 // Kill only the isolated fixture engine, while a self-test request is pending.
 const newState=await api('self-test/state');setMode('cancel');const boundary=requests.length;const interrupted=await api('self-test/start',{...options,fingerprint:newState.fingerprint},202);const deadline=Date.now()+15000;while(requests.length===boundary&&Date.now()<deadline)await pause();assert.equal(requests.length,boundary+1);await crashRestart();
 const saved=await api('self-test/report?id='+interrupted.id);assert.equal(saved.status,'INTERRUPTED');assert.equal(saved.warning,'PROCESS_INTERRUPTED');assert.equal(requests.length,boundary+1,'cold self-test reads do not replay provider requests');
 assert(saved.rows.some(r=>r.group==='provider'&&r.code==='PROCESS_INTERRUPTED'));
 ({origin,cookie}=url());const page=await fetch(origin+'/desktop-diagnostics/self-test',{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();assert(html.includes('/desktop-diagnostics/theme.css')&&html.includes('/desktop-diagnostics/theme.js'));
 console.log('PASS '+protocol+': 25 self-test contracts; native local checks, five bounded requests, metadata export, cancellation, restart and crash without replay');
}
