// Actual pinned DSH admission hook + authenticated local routes, synthetic repository/model only.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isSourceRuntime,sourceEnvironment,fixtureBase,remapDesktopPatch} from './runtime-fixture.mjs';
const exec=promisify(execFile),resources=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'runtime');await mkdir(fixtureBase(),{recursive:true});const fixture=await mkdtemp(join(fixtureBase(),'change-wire-')),root=isSourceRuntime(resources)?join(fixture,'c-'+crypto.randomUUID().replaceAll('-','')):fixture,workspace=join(root,'workspace'),home=join(root,'dsh');await mkdir(workspace,{recursive:true});
const git=async(...args)=>exec('git',args,{cwd:workspace,windowsHide:true});await git('init');await writeFile(join(workspace,'fixture.txt'),'initial\n');await git('add','fixture.txt');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','init');await writeFile(join(workspace,'fixture.txt'),'preexisting\n');
let requests=0,conversationRequests=0,checks=[],errors=[];
const mock=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;requests++;const body=JSON.parse(raw),title=JSON.stringify(body.messages).includes('Generate the session title from this JSON array of human messages:');
 if(!title){conversationRequests++;const files=(await readdir(join(home,'desktop-changes'))).filter(p=>p.endsWith('.json'));const rows=await Promise.all(files.map(async p=>JSON.parse(await readFile(join(home,'desktop-changes',p),'utf8'))));const row=rows.find(r=>r.turn===conversationRequests);assert(row,'native first model call must observe durable turn baseline');assert.equal(row.source,'turn-start');checks.push({turn:row.turn,coverage:row.coverage});if(conversationRequests===1)await writeFile(join(workspace,'fixture.txt'),'preexisting\nduring first turn\n');}
 res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish] of [[{role:'assistant',content:'Done'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(500).end();}});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));const patch=JSON.parse(await readFile('.build/config-protocol-fixtures/openai/desktop.patch.json','utf8'));
remapDesktopPatch(patch,resources);
for(const row of patch)for(const plugin of row.insert??[])if(['desktop-observability','desktop-model-defaults','desktop-client'].includes(plugin.id))plugin.name=pathToFileURL(join(resources,{'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs'}[plugin.id])).href;
patch[1].config.providers['desktop-internal'].baseURL='http://127.0.0.1:'+mock.address().port+'/v1';const overlay=join(root,'patch.json');await writeFile(overlay,JSON.stringify(patch));
const env={...process.env,DSH_HOME:home,DSH_DESKTOP_PATCH:overlay,DSH_DESKTOP_LLM_KEY:'synthetic',DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:'',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'*'};
Object.assign(env,sourceEnvironment(resources,root,home));
for(const key of Object.keys(env))if(/^(OPENAI_|ANTHROPIC_|DEEPSEEK_)/i.test(key))delete env[key];
const child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let output='',launch;for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});child.stdin.write('start '+JSON.stringify({diagnosticKey:'07'.repeat(32)})+'\n');const pause=()=>new Promise(r=>setTimeout(r,100));
try{
 const deadline=Date.now()+60000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await pause();assert(launch,'backend startup');const start=await fetch(launch,{redirect:'manual'}),cookie=start.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
 const api=async(path,data,expected=200)=>{const r=await fetch(origin+'/desktop-diagnostics/api/changes/'+path,{method:data?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(r.status,expected,await r.clone().text());return r.json();};
 const rpc=async(method,request)=>{const r=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{request}}})});const data=await r.json();assert(data.result?.ok,JSON.stringify(data));return data.result.value;};
 const q=new URLSearchParams({workspace});assert.equal((await api('history?'+q)).automatic,false);assert.equal(requests,0);
 const noAuth=await fetch(origin+'/desktop-diagnostics/api/changes/inspect?'+q);assert.notEqual(noAuth.status,200);
 const cross=await fetch(origin+'/desktop-diagnostics/api/changes/automatic',{method:'POST',headers:{cookie,origin:'https://untrusted.invalid','content-type':'application/json'},body:JSON.stringify({workspace,enabled:true})});assert.equal(cross.status,403);
 await api('automatic',{workspace,enabled:true});const {sessionId}=await rpc('session/create',{cwd:workspace});
 for(const turn of [1,2]){await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'SYNTHETIC_BASELINE_FIXTURE: reply Done without tools.'}]});const deadline=Date.now()+30000;let completed=false;while(Date.now()<deadline){const response=await fetch(origin+'/desktop-diagnostics/api/recovery/session?id='+sessionId,{headers:{cookie}});const state=await response.json();if(state.turn===turn&&state.status==='COMPLETED'){completed=true;break;}await pause();}assert(completed,'turn completed');}
 assert.deepEqual(errors,[]);assert.deepEqual(checks,[{turn:1,coverage:'COMPLETE'},{turn:2,coverage:'COMPLETE'}]);
 const history=await api('history?'+q);assert.equal(history.items.length,2);assert(history.items.every(r=>r.sessionId===sessionId));const first=history.items.find(r=>r.turn===1);q.set('baseline',first.id);
 const state=await api('inspect?'+q);assert.equal(state.rows.find(r=>r.path==='fixture.txt').classification,'DURING_TASK');q.set('path','fixture.txt');q.set('mode','task');assert.match((await api('patch?'+q)).text,/\+during first turn/);
 assert.equal((await fetch(origin+'/desktop-diagnostics/changes',{headers:{cookie}})).status,200);assert.equal(conversationRequests,2,'opening review never calls a model');
 const preview=await api('patch?'+q),offset=preview.text.indexOf('+during first turn'),selected={workspace,sessionId,path:'fixture.txt',mode:'task',baselineId:first.id,hash:preview.hash,start:offset,end:offset+'+during first turn'.length};
 assert((await api('sessions?'+new URLSearchParams({workspace}))).items.some(row=>row.id===sessionId));
 const stage=await api('draft/stage',selected);assert.equal((await api('draft/status?ticket='+stage.ticket)).status,'PENDING');
 const claim=await api('draft/claim',{ticket:stage.ticket,clientId:'fixture-a'});assert(claim.text.endsWith('+during first turn'));assert(!claim.text.includes('-preexisting'));
 await api('draft/claim',{ticket:stage.ticket,clientId:'fixture-b'},409);await api('draft/settle',{ticket:stage.ticket,clientId:'fixture-b',status:'APPENDED'},409);
 await api('draft/settle',{ticket:stage.ticket,clientId:'fixture-a',status:'APPENDED'});assert.equal((await api('draft/status?ticket='+stage.ticket)).status,'APPENDED');
 await api('draft/stage',{...selected,hash:'0'.repeat(64)},400);assert.equal(conversationRequests,2,'draft staging and delivery issue no model request');
 const currentFile=await readFile(join(workspace,'fixture.txt'),'utf8');await writeFile(join(workspace,'fixture.txt'),currentFile+'late edit\n');await api('draft/stage',selected,400);await writeFile(join(workspace,'fixture.txt'),currentFile);
 const cancelled=await api('draft/stage',selected);await api('draft/cancel',{ticket:cancelled.ticket});await api('draft/claim',{ticket:cancelled.ticket,clientId:'late-client'},409);
 if(process.argv.includes('--draft-browser')){
   await writeFile(join(root,'browser.json'),JSON.stringify({launch,origin,workspace,sessionId,baseline:first.id}));console.log('Browser fixture:',join(root,'browser.json'));
   await new Promise(resolve=>{const done=()=>{clearTimeout(timer);process.stdin.pause();resolve();};const timer=setTimeout(done,10*60*1000);process.stdin.once('data',done);});
   assert.equal(conversationRequests,2,'real browser draft editing must never send a prompt automatically');
 }
 console.log('PASS native change review: pre-step durable capture, two turns, preexisting vs during-task, authenticated routes, no model calls on review');console.log('Evidence:',root);
}finally{if(child.exitCode===null){child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause();if(child.exitCode===null)child.kill();}mock.closeAllConnections();await new Promise(r=>mock.close(r));await writeFile(join(root,'engine.log'),output);}
