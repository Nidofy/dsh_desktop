// Launched only by the ignored native Rust test: it supplies a real TaskBridge
// and armed fixture scope. This script relays private pipe messages unchanged.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceEnvironment,remapDesktopPatch} from './runtime-fixture.mjs';
const [workspace,home,protocol]=process.argv.slice(2), runtime=resolve(process.env.SOURCE_TEST_RUNTIME??'runtime');
assert(workspace&&home&&['openai','anthropic'].includes(protocol));
execFileSync('git',['init','-q'],{cwd:workspace,windowsHide:true});
const input=createInterface({input:process.stdin});let child,launch,failures=[],requests=0,checks=[];
const start=await new Promise(r=>input.on('line',line=>{if(line.startsWith('start '))r(line);else if(line.startsWith('snapshot '))child?.stdin.write(line+'\n');}));
const pause=()=>new Promise(r=>setTimeout(r,30));
const readRecords=async()=>Promise.all((await readdir(join(home,'desktop-task-snapshots'))).map(async id=>({id,start:JSON.parse(await readFile(join(home,'desktop-task-snapshots',id,'start.json'),'utf8'))})));
const server=http.createServer(async(req,res)=>{
  try {
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    const title=JSON.stringify(body.messages).includes('Generate the session title from this JSON array of human messages:');
    if(!title) {
      requests++;
      const records=await readRecords(),record=records.find(r=>r.start.task.binding.turn===requests);
      assert(record,'first model call must see the native start record');
      const dir=join(home,'desktop-task-snapshots',record.id);
      const confirmation=JSON.parse(await readFile(join(dir,'confirmed.json'),'utf8'));
      assert.equal(confirmation.task.binding.sessionId,record.start.task.binding.sessionId);
      assert.equal(await readFile(join(dir,'before-0.bin'),'utf8'),requests===1?'before':'after turn 1');
      if(requests===2) {
        const previous=records.find(r=>r.start.task.binding.turn===1);
        await readFile(join(home,'desktop-task-snapshots',previous.id,'end.json'));
      }
      assert(!raw.includes('snapshotBridge')&&!raw.includes(JSON.parse(start.slice(6)).snapshotBridge.token),'pipe authority must never enter model context');
      checks.push({turn:requests,confirmedBeforeModel:true,previousEndBeforeNextModel:requests===2});
      await writeFile(join(workspace,'a'),`after turn ${requests}`);
    }
    res.writeHead(200,{'content-type':'text/event-stream'});
    if(protocol==='openai') {
      for(const [delta,finish_reason] of [[{role:'assistant',content:'Done'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
      res.end('data: [DONE]\n\n');
    } else {
      const send=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
      send('message_start',{message:{id:'fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
      send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'Done'}});
      send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});send('message_stop',{});res.end();
    }
  } catch(error) { failures.push(String(error));res.writeHead(500).end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const patch=JSON.parse(await readFile(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
remapDesktopPatch(patch,runtime);
for(const row of patch)for(const p of row.insert??[])if(['desktop-observability','desktop-model-defaults','desktop-client'].includes(p.id))p.name=pathToFileURL(join(runtime,{'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs'}[p.id])).href;
patch[1].config.providers['desktop-internal'].baseURL=`http://127.0.0.1:${server.address().port}${protocol==='openai'?'/v1':''}`;
const overlay=join(home,'patch.json');await writeFile(overlay,JSON.stringify(patch));
const env={...process.env,DSH_HOME:home,DSH_DESKTOP_PATCH:overlay,DSH_DESKTOP_LLM_KEY:'synthetic',DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:'',NO_PROXY:'*'};
Object.assign(env,sourceEnvironment(runtime,dirname(home),home));
for(const key of Object.keys(env))if(/^(OPENAI_|ANTHROPIC_|DEEPSEEK_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
child=spawn(join(runtime,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(runtime,'host.mjs')).href,join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout});let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
lines.on('line',line=>{if(line.startsWith('dsh snapshot: '))process.stdout.write(line+'\n');else launch??=/^dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(line)?.[1];});
child.stdin.write(start+'\n');
const timeout=setTimeout(()=>{child.kill();process.exit(2);},90000);
try {
  const until=Date.now()+60000;while(!launch&&child.exitCode===null&&Date.now()<until)await pause();assert(launch,'DSH startup: '+stderr);
  const auth=await fetch(launch,{redirect:'manual'}),cookie=auth.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
  const rpc=async(method,request)=>{const r=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{request}}})});const data=await r.json();assert(data.result?.ok,JSON.stringify(data));return data.result.value;};
  const {sessionId}=await rpc('session/create',{cwd:workspace});
  const changes=async(route,body)=>fetch(origin+'/desktop-diagnostics/api/changes/'+route,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await changes('automatic',{workspace,enabled:true})).status,200);
  for(const turn of [1,2]) {
    await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'SYNTHETIC_SNAPSHOT_FIXTURE: reply Done without tools.'}]});
    const until=Date.now()+30000;let done=false;
    while(Date.now()<until){const state=await(await fetch(origin+'/desktop-diagnostics/api/recovery/session?id='+sessionId,{headers:{cookie}})).json();if(state.turn===turn&&state.status==='COMPLETED'){done=true;break;}await pause();}
    assert(done,JSON.stringify(failures));
  }
  const sealDeadline=Date.now()+16000;let sealed=false;
  while(Date.now()<sealDeadline) {try {const rows=await readRecords();assert.equal(rows.length,2);for(const row of rows)await readFile(join(home,'desktop-task-snapshots',row.id,'end.json'));sealed=true;break;}catch{}await pause();}
  assert(sealed,'both native ends sealed');assert.deepEqual(failures,[]);assert.equal(requests,2);
  const history=await(await fetch(origin+'/desktop-diagnostics/api/changes/history?'+new URLSearchParams({workspace}),{headers:{cookie}})).json();
  const last=history.items.find(row=>row.sessionId===sessionId&&row.turn===2);assert(last,'task comparison baseline exists');
  const opened=await changes('snapshot/open',{workspace,baselineId:last.id});assert.equal(opened.status,200);assert.equal((await opened.json()).status,'OPEN_REQUESTED');
  const manual=await(await changes('capture',{workspace})).json();assert.equal((await changes('snapshot/open',{workspace,baselineId:manual.id})).status,400);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/changes/snapshot/open',{method:'POST',headers:{cookie,origin:'https://not-same-origin.invalid','content-type':'application/json'},body:JSON.stringify({workspace,baselineId:last.id})})).status,403);
  assert.equal(requests,2,'navigation must not call model');assert.equal(await readFile(join(workspace,'a'),'utf8'),'after turn 2','navigation must not restore');
  checks.push({taskSnapshotNavigation:true,manualBaselineRefused:true,crossOriginRefused:true,noModelOrWorkspaceMutation:true});
  assert.equal(JSON.parse(start.slice(6)).storageQuota,true,'real host must enable native quota admission');
  const api=async(route,body)=>{const response=await fetch(origin+'/desktop-diagnostics/api/'+route,{headers:{cookie,...(body?{origin,'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const value=await response.json();assert(response.ok,JSON.stringify(value));return value;};
  const actionView=await api('actions/save',{workspace,config:{schemaVersion:1,actions:[{id:'quota',label:'quota fixture',command:"[Console]::Out.Write('QUOTA_ACTION')",timeoutMs:10000}]}});
  await api('actions/trust',{workspace,fingerprint:actionView.fingerprint});
  const action=await api('actions/start',{workspace,id:'quota'});
  const actionDeadline=Date.now()+20000;let actionResult;
  while(Date.now()<actionDeadline){actionResult=(await api('actions/inspect?'+new URLSearchParams({workspace}))).runs.find(row=>row.id===action.id);if(!['QUEUED','RUNNING'].includes(actionResult?.status))break;await pause();}
  assert.equal(actionResult?.status,'PASS',JSON.stringify(actionResult));
  assert.match((await api('actions/log?'+new URLSearchParams({workspace,id:action.id}))).text,/QUOTA_ACTION/);
  assert.equal((await api('actions/revoke',{workspace})).trusted,false);
  const selfTest=await api('self-test/start',{mode:'local'}),selfTestDeadline=Date.now()+40000;let selfTestResult;
  while(Date.now()<selfTestDeadline){selfTestResult=await api('self-test/report?id='+selfTest.id);if(selfTestResult.status!=='RUNNING')break;await pause();}
  assert.equal(selfTestResult.status,'COMPLETED',JSON.stringify(selfTestResult));
  assert.equal(selfTestResult.warning,null,JSON.stringify(selfTestResult));
  assert(selfTestResult.rows.filter(row=>row.group==='local').every(row=>row.status==='PASS'||row.status==='SKIPPED'),JSON.stringify(selfTestResult));
  // The live terminal state can precede the awaited final atomic checkpoint.
  const persistDeadline=Date.now()+10000;let persistedTest;
  while(Date.now()<persistDeadline){persistedTest=JSON.parse(await readFile(join(home,'desktop-self-tests','reports',selfTest.id+'.json'),'utf8'));if(persistedTest.status==='COMPLETED')break;await pause();}
  assert.equal(persistedTest.status,'COMPLETED','final checkpoint must reach disk before shutdown');
  assert.equal(requests,2,'local quota checks must not call the model');
  checks.push({nativeNodeQuota:true,projectActionAndLog:true,actionRevocation:true,localSelfTestFinalRecord:true,noAdditionalModelRequest:true});
  assert(!stderr.includes('OFFLINE_TEST_DENIED'));
  await mkdir('.build',{recursive:true});const evidence=await mkdtemp(resolve('.build/task-snapshot-wire-'));
  await writeFile(join(evidence,'report.json'),JSON.stringify({protocol,status:'PASS',checks,requests,privatePipe:true,nativeStore:true,nativeTauriWindow:false},null,2));
  console.log('PASS '+protocol+' snapshot native wire; evidence '+evidence);
} finally {
  if(child.exitCode===null){child.stdin.write('stop\n');const until=Date.now()+6000;while(child.exitCode===null&&Date.now()<until)await pause();if(child.exitCode===null)child.kill();}
  clearTimeout(timeout);server.closeAllConnections();await new Promise(r=>server.close(r));input.close();process.stdin.pause();lines.close();
}
