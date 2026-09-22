// Synthetic prompts only. Records final HTTP bodies, never authorization headers.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {runSelfTestWire} from './self-test-wire.mjs';
import {runCacheKeyWire} from './cache-key-wire.mjs';
const resources=resolve(process.argv[2]??'runtime');
const yaml=createRequire(join(resources,'dsh/package.json'))('yaml');
mkdirSync('.build',{recursive:true});const root=mkdtempSync(resolve('.build/observability-wire-'));
const pause=()=>new Promise(r=>setTimeout(r,100));
const results=[];
function events(dir,id){
 let text='';if(!existsSync(dir))return [];
 function walk(folder){for(const e of readdirSync(folder,{withFileTypes:true})){
  const path=join(folder,e.name);if(e.isDirectory()){walk(path);continue;}
  if(!path.includes(id)||!path.endsWith('.zstd'))continue;
  let bytes=readFileSync(path);while(bytes.length){try{const r=zstdDecompressSync(bytes,{info:true});if(!r.engine.bytesWritten)break;text+=r.buffer.toString();bytes=bytes.subarray(r.engine.bytesWritten);}catch{break;}}
 }}walk(dir);return text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
for(const protocol of ['openai','anthropic']) {
 const home=join(root,protocol);mkdirSync(home,{recursive:true});writeFileSync(join(home,'fixture.txt'),'PRIVATE_TOOL_RESULT');
 const requests=[],failures=[];let mode='normal',pending=false;
 let visionCalls=0;
 const server=http.createServer(async(req,res)=>{
  try {
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);
   if(body.model==='vision-fixture'){
    assert.equal(req.url,protocol==='openai'?'/v1/chat/completions':'/v1/messages');
    assert.equal(protocol==='openai'?req.headers.authorization:req.headers['x-api-key'],protocol==='openai'?'Bearer vision-test-key':'vision-test-key');
    assert.equal(body.messages[0].content[0].type,protocol==='openai'?'image_url':'image');
    visionCalls++;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(protocol==='openai'?{choices:[{message:{content:'VISION_NATIVE_OK'}}]}:{content:[{type:'text',text:'VISION_NATIVE_OK'}]}));return;
   }
   const isTitle=JSON.stringify(body.messages).includes('Generate the session title from this JSON array of human messages:');
   const isProbe=JSON.stringify(body.messages).includes('Synthetic cache measurement.');
   const toolResults=protocol==='openai'?body.messages.filter(m=>m.role==='tool').map(m=>m.content):body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result').map(c=>c.content):[]);
   requests.push({body,raw,method:req.method,path:req.url,isTitle,toolResults});
   assert.equal(protocol==='openai'?req.headers.authorization:req.headers['x-api-key'],protocol==='openai'?'Bearer desktop-test-key':'desktop-test-key');
   if(!isTitle&&mode==='error'){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:'PRIVATE_PROVIDER_ERROR'}}));return;}
   if(!isTitle&&mode==='cancel'){pending=true;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting\n\n');return;}
   const tool=!isTitle&&!isProbe&&!toolResults.length;
   const selfTool=JSON.stringify(body.tools??[]).includes('desktop_self_test_echo');
   const toolName=selfTool?'desktop_self_test_echo':mode==='vision'?'analyze_image':mode==='action'?'run_project_action':mode==='present'?'present':'read';
   const toolArgs=selfTool?'{"value":"SYNTHETIC_OK"}':mode==='vision'?'{"file_path":"fixture.png","question":"Describe the test pixel"}':mode==='action'?'{"id":"fixture"}':mode==='present'?'{"files":[{"path":"fixture.txt","description":"Synthetic deliverable"}]}':'{"file_path":"fixture.txt"}';
   res.writeHead(200,{'content-type':'text/event-stream'});
   if(protocol==='openai') {
    const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'fixture-read',type:'function',function:{name:toolName,arguments:toolArgs}}]}:{role:'assistant',content:'PRIVATE_FIXTURE_REPLY'};
    for(const [i,d] of [delta,{}].entries())res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:d,finish_reason:i?tool?'tool_calls':'stop':null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[],usage:{prompt_tokens:500,completion_tokens:20,total_tokens:520,prompt_tokens_details:{cached_tokens:400}}})}\n\n`);res.end('data: [DONE]\n\n');
   } else {
    const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:400,cache_creation_input_tokens:0}}});
    send('content_block_start',{index:0,content_block:tool?{type:'tool_use',id:'fixture-read',name:toolName,input:{}}:{type:'text',text:''}});
    send('content_block_delta',{index:0,delta:tool?{type:'input_json_delta',partial_json:toolArgs}:{type:'text_delta',text:'PRIVATE_FIXTURE_REPLY'}});
    send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{});res.end();
   }
  }catch(e){failures.push(String(e));res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const patch=JSON.parse(readFileSync(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
 for(const row of patch)for(const plugin of row.insert??[]) {
  if(['desktop-observability','desktop-model-defaults'].includes(plugin.id))plugin.name=pathToFileURL(join(resources,plugin.id==='desktop-observability'?'desktop-observability.mjs':'model-defaults.mjs')).href;
  if(plugin.id==='desktop-client')plugin.name=pathToFileURL(join(resources,'desktop-client/index.mjs')).href;
  if(plugin.id==='desktop-environment')plugin.name=pathToFileURL(join(resources,'desktop-environment/index.mjs')).href;
  if(plugin.id==='desktop-vision')plugin.name=pathToFileURL(join(resources,'desktop-vision.mjs')).href;
 }
 patch[1].config.providers['desktop-internal'].baseURL=`http://127.0.0.1:${server.address().port}${protocol==='openai'?'/v1':''}`;
 const overlay=join(home,'patch.json');writeFileSync(overlay,JSON.stringify(patch));
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,DSH_HOME:join(home,'dsh'),DSH_DESKTOP_PATCH:overlay,DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:'desktop-test-key',PI_CACHE_RETENTION:'long',NODE_NO_WARNINGS:'1',NODE_OPTIONS:'',NODE_PATH:''};
 if(process.argv.includes('--self-test-vcs'))env.PATH=resolve('.build/hg-test-venv/Scripts')+';'+(process.env.PATH??process.env.Path??'');
 if(process.argv.includes('--feedback-ui')){
  env.PATH=process.env.PATH??process.env.Path??'';
  const git=args=>execFileSync('git',args,{cwd:home,windowsHide:true,stdio:'ignore'});
  git(['init','-b','desktop-ui-check']);writeFileSync(join(home,'AGENTS.md'),'Synthetic UI verification workspace.');writeFileSync(join(home,'.gitignore'),'dsh/\n');
  git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=NUL','commit','-m','Fixture']);git(['branch','preview-branch']);
  writeFileSync(join(home,'fixture.txt'),'PRIVATE_TOOL_RESULT\nSYNTHETIC_CHANGE\n');
 }
 for(const key of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
 let child,output='',origin,cookie,launchUrl;
 async function start(){
  let launch;output='';
  child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});
  child.stdin.write('start '+JSON.stringify({diagnosticKey:'07'.repeat(32)})+'\n');
  const deadline=Date.now()+90000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await pause();
  assert(launch,'DSH startup: '+output.slice(-3000));launchUrl=launch;const response=await fetch(launch,{redirect:'manual'});cookie=response.headers.get('set-cookie').split(';')[0];origin=new URL(launch).origin;
 }
 async function stop(){if(!child||child.exitCode!==null)return;child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause();if(child.exitCode===null)child.kill();}
 async function api(path,data,expected=200){const response=await fetch(origin+'/desktop-diagnostics/api/'+path,{method:data===undefined?'GET':'POST',headers:{cookie,origin,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.equal(response.status,expected,await response.clone().text());return response.json();}
 async function rpc(method,request){const response=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{request}}})});const data=await response.json();assert(data.result?.ok,JSON.stringify(data));return data.result.value;}
 async function prompt(id,turn){
  await rpc('session/prompt',{sessionId:id,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'PRIVATE_PROMPT: read fixture.txt and reply.'}]});
  const end=Date.now()+30000;while(Date.now()<end){const history=events(join(env.DSH_HOME,'sessions'),id);if(history.filter(e=>e.type==='turn/end').length>=turn)return history;await pause();}throw Error('Turn timeout');
 }
 try {
  await start();
  if(process.argv.includes('--vision-only')){
    async function settingsRpc(method,args){const response=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args}})});const value=await response.json();assert(value.result?.ok,JSON.stringify(value));return value.result.value;}
    const description=await settingsRpc('settings/describe',{}),vision=description.namespaces.find(n=>n.ns==='desktop-vision');assert(vision);
    assert.equal(vision.value.enabled,false);
    await settingsRpc('credentials/set',{ref:'DSH_VISION_API_KEY',value:'vision-test-key'});
    await settingsRpc('settings/update',{ns:'desktop-vision',patch:{enabled:true,api:protocol==='openai'?'openai-completions':'anthropic-messages',baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'vision-fixture'},expectedRevision:vision.revision});
    writeFileSync(join(home,'fixture.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'));
    mode='vision';const session=await rpc('session/create',{cwd:home});await prompt(session.sessionId,1);
    assert.equal(visionCalls,1,JSON.stringify(requests.map(r=>r.toolResults)));
    assert(requests.some(r=>JSON.stringify(r.toolResults).includes('VISION_NATIVE_OK')));
    await stop();await start();assert.equal((await settingsRpc('settings/describe',{})).namespaces.find(n=>n.ns==='desktop-vision').value.enabled,true);
    assert.equal(visionCalls,1,'restart never replays vision');assert.deepEqual(failures,[]);
    results.push({protocol,visionTool:'PASS',settingsPersistence:true});console.log('PASS '+protocol+': native analyze_image, filesystem/image validation, credential service, live settings, restart persistence');continue;
  }
  if(process.argv.includes('--feedback-ui')){
    await rpc('workspace/create',{path:home});
    const session=await rpc('session/create',{cwd:home});
    const context=await api('desktop/context?session='+session.sessionId);assert.equal(context.workspace,home);
    await api('desktop/open',{view:'changes',sessionId:session.sessionId});
    const events=await api('recovery/desktop-events');assert.equal(events.desktop.navigation.workspace,home);
    assert.equal(events.desktop.navigation.view,'changes');
    await api('desktop/open',{view:'https://example.com'},400);
    await prompt(session.sessionId,1);
    console.log('Feedback browser fixture (synthetic data): '+launchUrl);
    console.log('Session: '+session.sessionId);
    await new Promise(resolve=>{const timer=setTimeout(resolve,20*60*1000);process.stdin.once('data',()=>{clearTimeout(timer);process.stdin.pause();resolve();});});
    results.push({protocol,workspaceNavigation:'PASS'});break;
  }
  if(process.argv.includes('--cache-key-only')){
    const cases=await runCacheKeyWire({protocol,api,rpc,prompt,start,stop,patch,overlay,requests,home});
    assert.deepEqual(failures,[]);assert(!output.includes('OFFLINE_TEST_DENIED'));results.push({protocol,independentCacheKey:'PASS',cases});continue;
  }
  if(process.argv.includes('--self-test-only')){
    await runSelfTestWire({protocol,api,url:()=>({origin,cookie}),requests,home,withVcs:process.argv.includes('--self-test-vcs'),setMode:value=>{mode=value;},restart:async()=>{await stop();await start();},crashRestart:async()=>{const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;await start();}});
    assert.deepEqual(failures,[]);assert(!output.includes('OFFLINE_TEST_DENIED'));results.push({protocol,selfTest:'PASS'});continue;
  }
  assert.equal((await api('appearance')).preference,'system');
  const themeCss=await fetch(origin+'/desktop-diagnostics/theme.css',{headers:{cookie}});assert.equal(themeCss.status,200);assert((await themeCss.text()).includes('--dsw-alias-bg-base'));
  assert.equal((await fetch(origin+'/desktop-diagnostics/theme.js',{headers:{cookie}})).status,200);
  for(const [preference,fontSize] of [['dark',16],['light',12],['system',14]]){
    const settingsPath=join(env.DSH_HOME,'settings.yaml'),doc=yaml.parseDocument(readFileSync(settingsPath,'utf8'));doc.setIn(['ui-theme'],{preference,fontSize});writeFileSync(settingsPath,String(doc));
    const deadline=Date.now()+6000;let received;
    do{received=await api('appearance');if(received.preference===preference&&received.fontSize===fontSize)break;await pause();}while(Date.now()<deadline);
    assert.deepEqual(received,{preference,fontSize},'appearance follows the actual DSH settings provider');
  }
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/snapshot')).status,401);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/snapshot',{headers:{cookie,origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/preferences',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"enabled":false}'})).status,403);
  const html=await fetch(origin+'/desktop-diagnostics',{headers:{cookie}});assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/style-src 'self'/);assert((await html.text()).includes('会话诊断'));
  const runs=[];
  for(const enabled of [false,true]){
   await api('preferences',{enabled});await api('clear',{});
   const boundary=requests.length,begin=performance.now();const {sessionId}=await rpc('session/create',{cwd:home});
   await prompt(sessionId,1);await prompt(sessionId,2);
   const recovery=await api('recovery/session?id='+encodeURIComponent(sessionId));
   assert.equal(recovery.status,'COMPLETED');assert.equal(recovery.lastModel.status,'COMPLETED');
   const notices=(await api('recovery/desktop-events')).notifications;
   assert(notices.items.some(n=>n.sessionId===sessionId&&n.kind==='completed'),'native turn end notifies independently of collection');
   assert(!JSON.stringify(notices).includes('PRIVATE_'),'OS notification feed contains no user content');
   assert.equal((await api('recovery/desktop-events?after='+notices.revision)).notifications.items.length,0);
   const {title,...recoveryMetadata}=recovery;
   assert(!JSON.stringify(recoveryMetadata).includes('PRIVATE_'),'recovery state excludes message bodies, even with diagnostics disabled; title is local UI data');
   const run=requests.slice(boundary).filter(r=>!r.isTitle);
   assert.equal(run.length,3,'two turns including native read loop');
   assert(run.some(r=>JSON.stringify(r.toolResults).includes('PRIVATE_TOOL_RESULT')));
   const snapshot=await api('snapshot');assert.equal(snapshot.configuration.effectiveSpillBytes,50000,'observer switch does not change tool budget');
   const records=snapshot.records.filter(r=>r.purpose==='conversation');
   assert.equal(records.length,enabled?3:0);
   if(enabled){for(const record of records){assert.equal(record.status==='tool-calls'||record.status==='stop',true);assert.equal(record.usage.inputTokens,100);assert.equal(record.usage.cacheReadTokens,400);assert.equal(record.usage.outputTokens,20);assert.equal(record.usage.aggregateInputTokens,500);}
    assert.equal(snapshot.observerFailures,0);assert(records.some(r=>r.comparison.facts.includes('MESSAGES_CHANGED')));
    const exported=await fetch(origin+'/desktop-diagnostics/api/export',{headers:{cookie}});assert(exported.headers.get('content-disposition').includes('attachment'));
    const text=await exported.text();for(const secret of ['PRIVATE_PROMPT','PRIVATE_TOOL_RESULT','PRIVATE_FIXTURE_REPLY','desktop-test-key','07'.repeat(32),'"file_path"'])assert(!text.includes(secret),secret);
    const markdown=await fetch(origin+'/desktop-diagnostics/api/export?format=md',{headers:{cookie}});assert((await markdown.text()).includes('# DSHDesktop'));
    writeFileSync(join(home,'metadata.json'),text);
   }
   runs.push({enabled,wallMs:performance.now()-begin,requests:run});
  }
  writeFileSync(join(home,'synthetic-wire.json'),JSON.stringify(runs,null,2));
  assert.deepEqual(runs[0].requests.map(r=>r.body),runs[1].requests.map(r=>r.body),'final parsed wire body unchanged with observer');
  assert.deepEqual(runs[0].requests.map(r=>r.raw),runs[1].requests.map(r=>r.raw),'final wire bytes unchanged with observer');
  mode='error';const errorSession=await rpc('session/create',{cwd:home});await prompt(errorSession.sessionId,1);
  const afterError=await api('snapshot');writeFileSync(join(home,'after-error.json'),JSON.stringify(afterError,null,2));
  assert(afterError.records.some(r=>r.status==='error'),'provider error preserved at logical boundary');
  mode='cancel';const cancelSession=await rpc('session/create',{cwd:home});
  await rpc('session/prompt',{sessionId:cancelSession.sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'PRIVATE_CANCEL_PROMPT'}]});
  const end=Date.now()+15000;while(!pending&&Date.now()<end)await pause();assert(pending);
  await rpc('session/cancel',{sessionId:cancelSession.sessionId});
  let cancelled=false;for(let i=0;i<100;i++){cancelled=(await api('snapshot')).records.some(r=>r.status==='aborted');if(cancelled)break;await pause();}assert(cancelled,'cancel observed');
  // 0.1.7: actual tool/result correlation, bounded archive, guarded compare/export and experiment settings.
  mode='normal';const current=await api('snapshot');assert(current.tools.some(t=>t.name==='read'&&t.status==='completed'));
  const sid=current.records.find(r=>r.purpose==='conversation').session;
  const saved=await api('measurement/save',{session:sid,label:'wire window'});
  assert((await api('history')).some(r=>r.id===saved.id));
  const archived=await api('measurement?id='+saved.id);assert.equal(archived.measurement.complete,false);
  const ab=await api('compare',{a:archived,b:archived});assert.equal(ab.result.quality,'NOT_QUALITY_EQUIVALENT');
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/export?comparison='+ab.id+'&format=md',{headers:{cookie}})).status,200);
  const savedMd=await fetch(origin+'/desktop-diagnostics/api/export?id='+saved.id+'&format=md',{headers:{cookie}});assert.equal(savedMd.status,200);assert((await savedMd.text()).includes('DSHDesktop'));
  assert.equal((await fetch(origin+'/desktop-diagnostics/compare',{headers:{cookie}})).status,200);
  const measurement=await api('measurement/start',{session:sid,label:'empty measurement'});const finished=await api('measurement/finish',{id:measurement.id,quality:'UNKNOWN'});assert(finished.id);
  const scope=(await api('snapshot')).keyScopeId;await api('preferences',{enabled:false,spillMode:'compact',skillMode:'compact',repoSummary:true,autoArchive:true});await stop();await start();
  let snapshot=await api('snapshot');assert.equal(snapshot.enabled,false);assert.equal(snapshot.keyScopeId,scope);assert.equal(snapshot.configuration.effectiveSpillBytes,24000);assert.equal(snapshot.configuration.effectiveSkillDescription,250);assert.equal(snapshot.configuration.repoSummary,true);assert.equal(snapshot.records.length,0);assert((await api('history')).some(r=>r.id===saved.id));
  await api('preferences',{enabled:true,spillMode:'native',skillMode:'native',repoSummary:true});await stop();await start();snapshot=await api('snapshot');assert.equal(snapshot.configuration.effectiveSpillBytes,50000);
  const toolSession=await rpc('session/create',{cwd:home}),offset=requests.length;await prompt(toolSession.sessionId,1);
  assert(requests.slice(offset).some(r=>JSON.stringify(r.body.tools??[]).includes('repo_summary')),'opt-in tool registered');
  for(let i=0;i<30&&!(await api('history')).some(r=>r.measurement.label==='Turn 1');i++)await pause();
  assert((await api('history')).some(r=>r.measurement.label==='Turn 1'),'automatic turn archive');
  assert.equal((await api('snapshot')).observerFailures,0);
  // Daily-driver actions use the actual DSH shell service for both desktop and agent callers.
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/actions/inspect?workspace='+encodeURIComponent(home))).status,401);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/actions/trust',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/desktop-diagnostics/actions',{headers:{cookie}})).status,200);
  const actionConfig={schemaVersion:1,actions:[{id:'fixture',label:'Fixture',command:'Write-Output ACTION_WIRE_OK',timeoutMs:10000,artifacts:['fixture.txt']},{id:'slow',label:'Cancel fixture',command:'Start-Sleep -Seconds 30',timeoutMs:40000}]};
  let actionView=await api('actions/save',{workspace:home,config:actionConfig});assert.equal(actionView.trusted,false);
  await api('actions/trust',{workspace:home,fingerprint:actionView.fingerprint});
  async function actionDone(id){const end=Date.now()+30000;while(Date.now()<end){const view=await api('actions/inspect?workspace='+encodeURIComponent(home));const row=view.runs.find(r=>r.id===id);if(row&&!['QUEUED','RUNNING'].includes(row.status))return row;await pause();}throw Error('Action timeout');}
  const action=await api('actions/start',{workspace:home,id:'fixture'}),actionResult=await actionDone(action.id);
  assert.equal(actionResult.status,'PASS',JSON.stringify(actionResult));assert.equal(actionResult.sandbox.mode,'workspace-write');
  assert((await api('actions/log?workspace='+encodeURIComponent(home)+'&id='+action.id)).text.includes('ACTION_WIRE_OK'));
  const artifactCount=requests.length;
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/artifacts/list?workspace='+encodeURIComponent(home))).status,401);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/artifacts/register',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({workspace:home,path:'fixture.txt'})})).status,403);
  const registeredArtifact=await api('artifacts/register',{workspace:home,path:'fixture.txt'});
  const artifactList=await api('artifacts/list?workspace='+encodeURIComponent(home));assert(artifactList.items.some(r=>r.source==='action-log'&&r.runId===action.id));assert(artifactList.items.some(r=>r.source==='action'&&r.path==='fixture.txt'));
  const artifactDownload=await fetch(origin+'/desktop-diagnostics/api/export?artifact='+registeredArtifact.id,{headers:{cookie}});assert.equal(artifactDownload.status,200);assert.equal(await artifactDownload.text(),'PRIVATE_TOOL_RESULT');assert.equal(requests.length,artifactCount,'artifact operations do not call the model');
  mode='present';const presentedSession=await rpc('session/create',{cwd:home});await prompt(presentedSession.sessionId,1);
  const presentedArtifacts=await api('artifacts/list?session='+presentedSession.sessionId);assert(presentedArtifacts.items.some(r=>r.source==='session'&&r.path==='fixture.txt'&&r.turn===1),'actual native present event feeds artifact projection');
  assert.equal((await fetch(origin+'/desktop-diagnostics/artifacts',{headers:{cookie}})).status,200);
  console.log('PASS '+protocol+': native delivery projection + Project Actions artifacts/logs + authenticated controlled download');
  mode='action';const actionSession=await rpc('session/create',{cwd:home});await prompt(actionSession.sessionId,1);
  actionView=await api('actions/inspect?workspace='+encodeURIComponent(home));
  const agentAction=actionView.runs.find(r=>r.source==='agent');assert(agentAction,'model dispatched registered project action');assert.equal(agentAction.status,'PASS',JSON.stringify(agentAction));assert(agentAction.sandbox,'model action uses the sandbox executor');
  const slow=await api('actions/start',{workspace:home,id:'slow'});
  while(!(await api('actions/inspect?workspace='+encodeURIComponent(home))).runs.some(r=>r.id===slow.id&&r.status==='RUNNING'))await pause();
  await api('actions/cancel',{workspace:home,id:slow.id});assert.equal((await actionDone(slow.id)).status,'CANCELLED');
  await stop();await start();actionView=await api('actions/inspect?workspace='+encodeURIComponent(home));assert(actionView.trusted);assert(actionView.runs.some(r=>r.id===action.id&&r.status==='PASS'));
  console.log('PASS '+protocol+': Project Actions UI API + model tool + native sandbox + cancellation + durable results');
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/recovery/list')).status,401);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/recovery/focus',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,403);
  const focus=(await api('recovery/desktop-events')).focusRevision;await api('recovery/focus',{});assert.equal((await api('recovery/desktop-events')).focusRevision,focus+1);
  assert.equal((await fetch(origin+'/desktop-diagnostics/recovery',{headers:{cookie}})).status,200);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/recovery/notifications',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"enabled":false}'})).status,403);
  await api('recovery/notifications',{enabled:false});assert.equal((await api('recovery/desktop-events')).notifications.items.length,0);
  await api('recovery/notifications',{enabled:true});
  const history=await api('recovery/list');assert(history.items.some(r=>r.sessionId===actionSession.sessionId&&r.status==='COMPLETED'));
  const beforeCacheRead=requests.length;const cacheState=await api('cache/state');assert(cacheState.models.length>0);assert.equal(requests.length,beforeCacheRead,'reading capabilities does not call a model');
  assert.equal((await fetch(origin+'/desktop-diagnostics/cache',{headers:{cookie}})).status,200);
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/cache/start',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,403);
  mode='normal';const beforeProbe=requests.length;
  const probe=await api('cache/start',{model:cacheState.models[0].id,fingerprint:cacheState.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
  let probeState;const probeDeadline=Date.now()+20000;do{await pause();probeState=(await api('cache/state')).current;}while(probeState.status==='RUNNING'&&Date.now()<probeDeadline);
  assert.equal(probeState.status,'COMPLETED',JSON.stringify(probeState));assert.equal(probeState.rows.length,4);assert.equal(probeState.summary.positiveReadRequests,4);
  const probeRequests=requests.slice(beforeProbe);assert.equal(probeRequests.length,4,'bounded native preparation has no hidden title calls or retries');
  assert.equal(probeRequests[0].raw,probeRequests[1].raw,'identical repeat wire payload');
  assert.notEqual(probeRequests[0].raw,probeRequests[2].raw,'independent groups differ near the prefix');
  for(const request of probeRequests){assert(!JSON.stringify(request.body).includes('PRIVATE_'),'probe cannot carry workspace/history/skills');assert(!request.body.tools?.length,'no tools sent');}
  const probeExport=await fetch(origin+'/desktop-diagnostics/api/export?cacheProbe='+probe.id,{headers:{cookie}});assert.equal(probeExport.status,200);const safeProbe=await probeExport.text();assert(!safeProbe.includes(cacheState.models[0].id));assert(!safeProbe.includes('PRIVATE_'));
  assert((await api('cache/history')).some(r=>r.id===probe.id));
  await api('cache/capabilities',{model:cacheState.models[0].id,fingerprint:cacheState.fingerprint,features:{automaticCaching:'supported',promptCacheKey:'unknown',cacheControl:'unknown',longRetention:'unknown'}});
  assert.equal((await api('cache/state')).capabilities[cacheState.models[0].id].source,'user-declared');
  assert.equal((await fetch(origin+'/desktop-diagnostics/api/cache/start',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({model:cacheState.models[0].id,fingerprint:'0'.repeat(64),inputBytes:2048,requests:4,accepted:true})})).status,409,'stale configuration cannot silently change an approved probe destination');
  mode='cancel';pending=false;const cancelledProbe=await api('cache/start',{model:cacheState.models[0].id,fingerprint:cacheState.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
  const cancelProbeDeadline=Date.now()+10000;while(!pending&&Date.now()<cancelProbeDeadline)await pause();assert(pending);
  await api('cache/cancel',{id:cancelledProbe.id});let cancelledState;do{await pause();cancelledState=(await api('cache/state')).current;}while(cancelledState.status==='RUNNING'&&Date.now()<cancelProbeDeadline);
  assert.equal(cancelledState.status,'CANCELLED');assert.equal(cancelledState.rows.length,1);mode='normal';
  console.log('PASS '+protocol+': native cache probe, exact repeat wire, isolated groups, no real context/tools, bounded requests, metadata exports');
  const originalProvider=structuredClone(patch[1].config.providers['desktop-internal']);
  for(const variant of protocol==='openai'?['automatic','long','short-markers']:['automatic','long']){
    await stop();
    const policyPatch=JSON.parse(readFileSync(join('.build/cache-profile-fixtures',protocol,variant,'desktop.patch.json'),'utf8'));
    const provider=policyPatch[1].config.providers['desktop-internal'];provider.baseURL=originalProvider.baseURL;
    patch[1].config.providers['desktop-internal']=provider;writeFileSync(overlay,JSON.stringify(patch));await start();
    const state=await api('cache/state');assert.equal(state.capabilities[cacheState.models[0].id].stale,true,'previous capability claim is not silently reused for a changed configuration');
    const boundary=requests.length;await api('cache/start',{model:state.models[0].id,fingerprint:state.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
    let result;const deadline=Date.now()+20000;do{await pause();result=(await api('cache/state')).current;}while(result.status==='RUNNING'&&Date.now()<deadline);
    assert.equal(result.status,'COMPLETED',JSON.stringify(result));const bodies=requests.slice(boundary);assert.equal(bodies.length,4);
    assert.equal(bodies[0].raw,bodies[1].raw,'policy preserves repeated prefix');
    for(const request of bodies){
      if(variant==='automatic'){assert(!request.body.prompt_cache_key);assert(!request.body.prompt_cache_retention);assert(!request.raw.includes('cache_control'),'automatic caching sends no private hints');}
      if(variant==='long'&&protocol==='openai'){assert(request.body.prompt_cache_key);assert.equal(request.body.prompt_cache_retention,'24h');}
      if(variant==='long'&&protocol==='anthropic'){assert(request.raw.includes('"ttl":"1h"'));assert(request.raw.includes('cache_control'));}
      if(variant==='short-markers'){assert(request.raw.includes('cache_control'));assert(!request.body.prompt_cache_key);assert(!request.body.prompt_cache_retention);assert(!request.raw.includes('"ttl"'));}
    }
    console.log('PASS '+protocol+': cache '+variant+' matches pinned adapter wire contract');
  }
  await stop();patch[1].config.providers['desktop-internal']=originalProvider;writeFileSync(overlay,JSON.stringify(patch));await start();
  // A retry-enabled native route is rejected BEFORE any billable probe call.
  await stop();patch[1].config.providers['desktop-internal']={...originalProvider,retryPolicy:{mode:'normal',maxRetries:1}};writeFileSync(overlay,JSON.stringify(patch));await start();
  const retryState=await api('cache/state'),beforeRefusal=requests.length;
  await api('cache/start',{model:retryState.models[0].id,fingerprint:retryState.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
  let refusal;const refusalDeadline=Date.now()+10000;do{await pause();refusal=(await api('cache/state')).current;}while(refusal.status==='RUNNING'&&Date.now()<refusalDeadline);
  assert.equal(refusal.status,'REFUSED');assert.equal(requests.length,beforeRefusal);
  await stop();patch[1].config.providers['desktop-internal']=originalProvider;writeFileSync(overlay,JSON.stringify(patch));await start();
  // Terminate while a real native model request is in flight. Recovery reads the
  // native cold log and must not create an Agent or issue another HTTP request.
  mode='cancel';pending=false;const interrupted=await rpc('session/create',{cwd:home});
  await rpc('session/prompt',{sessionId:interrupted.sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'SYNTHETIC_CRASH_FIXTURE'}]});
  const crashDeadline=Date.now()+15000;while((!pending||!events(join(env.DSH_HOME,'sessions'),interrupted.sessionId).some(e=>e.type==='turn/start'))&&Date.now()<crashDeadline)await pause();
  assert(pending);assert(events(join(env.DSH_HOME,'sessions'),interrupted.sessionId).some(e=>e.type==='turn/start'));
  const crashCache=await api('cache/state');const crashedProbe=await api('cache/start',{model:crashCache.models[0].id,fingerprint:crashCache.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
  const probeCrashDeadline=Date.now()+10000;while((await api('cache/state')).current.rows.length===0&&Date.now()<probeCrashDeadline)await pause();
  const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;
  const beforeRecovery=requests.length;await start();
  const recovered=await api('recovery/session?id='+encodeURIComponent(interrupted.sessionId));
  assert.equal((await api('recovery/desktop-events')).notifications.items.length,0,'restart/cold recovery does not re-announce old tasks');
  assert.equal(recovered.status,'INTERRUPTED',JSON.stringify(recovered));assert.equal(recovered.source,'prepared');assert.equal(recovered.lastModel.status,'UNKNOWN');
  assert.equal(requests.length,beforeRecovery,'recovery view never replays a prompt or tool');
  assert.equal((await api('cache/report?id='+crashedProbe.id)).status,'INTERRUPTED','probe crash is explicit and never auto-resumed');
  assert((await api('recovery/list')).items.some(r=>r.sessionId===interrupted.sessionId&&r.status==='INTERRUPTED'));
  console.log('PASS '+protocol+': native cold-session recovery after forced exit; no prompt/tool replay');
  assert.deepEqual(failures,[]);assert(!output.includes('OFFLINE_TEST_DENIED'));
  results.push({protocol,status:'PASS',wireBytesIdentical:true,turns:2,nativeRead:true,usage:true,error:true,cancel:true,auth:true,exportPrivacy:true,keyScopeRestart:true,preferencePersistence:true,spillRestore:true,onOffWallMs:runs.map(r=>({enabled:r.enabled,wallMs:r.wallMs}))});
  console.log('PASS '+protocol+': identical final wire, usage, read, error/cancel, auth, privacy, persisted toggles, key scope');
 }finally{await stop();server.closeAllConnections();server.close();writeFileSync(join(home,'backend-test.log'),output);writeFileSync(join(root,'report.json'),JSON.stringify(results,null,2));}
}
console.log('Evidence directory:',root);
