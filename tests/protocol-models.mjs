// Exercise the production Rust-generated overlays through the unmodified DSH CLI.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import {isSourceRuntime,sourceEnvironment,fixtureBase,remapDesktopPatch} from './runtime-fixture.mjs';
const resources=resolve(process.argv[2]??'runtime');
const source=isSourceRuntime(resources);
mkdirSync(fixtureBase(),{recursive:true});
const root=mkdtempSync(join(fixtureBase(),'protocol-models-'));
const pause=()=>new Promise(r=>setTimeout(r,100));
const results=[];
function events(dir,id){
 if(!existsSync(dir))return [];
 let text='';
 function walk(folder){for(const e of readdirSync(folder,{withFileTypes:true})){
  const p=join(folder,e.name);if(e.isDirectory()){walk(p);continue;}
  if(!p.includes(id)||!p.endsWith('.zstd'))continue;
  let bytes=readFileSync(p);while(bytes.length){try{const r=zstdDecompressSync(bytes,{info:true});if(!r.engine.bytesWritten)break;text+=r.buffer.toString();bytes=bytes.subarray(r.engine.bytesWritten);}catch{break;}}
 }}walk(dir);return text.split('\n').filter(Boolean).map(l=>JSON.parse(l));
}
for(const protocol of ['openai','anthropic']){
 const home=join(root,protocol,...(source?['c-'+crypto.randomUUID().replaceAll('-','')]:[]));mkdirSync(home,{recursive:true});writeFileSync(join(home,'fixture.txt'),'PROTOCOL_TOOL_READ_OK');
 const requests=[], failures=[];
 let overrideEffort;
 const server=http.createServer(async(req,res)=>{
  try{
   const endpoint=new URL(req.url,'http://localhost').pathname;
   assert.equal(endpoint,protocol==='openai'?'/gateway/v1/chat/completions':'/gateway/v1/messages');
   assert.equal(req.method,'POST');
   let raw='';for await(const c of req)raw+=c;
   const body=JSON.parse(raw);
   const authenticated=protocol==='openai'?req.headers.authorization==='Bearer desktop-test-key':req.headers['x-api-key']==='desktop-test-key'&&!!req.headers['anthropic-version'];
   const toolResults=protocol==='openai'?body.messages.filter(m=>m.role==='tool').map(m=>m.content):body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result').map(c=>c.content):[]);
   const maxTokens=body.max_tokens??body.max_completion_tokens;
   const isTitle=JSON.stringify(body.messages).includes('Generate the session title from this JSON array of human messages:');
   requests.push({model:body.model,endpoint,authenticated,toolResults,maxTokens,reasoningEffort:body.reasoning_effort,thinking:body.thinking,purpose:isTitle?'session-title':'conversation'});
   assert(authenticated,'protocol-specific authentication');assert(['glm-5.3-flash','glm-5.3'].includes(body.model));assert(body.stream);
   assert.equal(maxTokens,isTitle?64:body.model==='glm-5.3-flash'?8192:128000,'conversation budget or explicit auxiliary title override reaches the API');
   if(!isTitle){
    const effort=overrideEffort??(body.model==='glm-5.3'?'high':'low');
    if(protocol==='openai')assert.equal(body.reasoning_effort,effort);
    else {assert.equal(body.thinking?.type,'enabled');assert.equal(body.thinking.budget_tokens,Math.min({high:16384,medium:8192,low:2048}[effort],maxTokens-1024));}
   }
   const callTool=!isTitle&&!toolResults.length;
   res.writeHead(200,{'content-type':'text/event-stream'});
   if(protocol==='openai'){
    const delta=callTool?{role:'assistant',tool_calls:[{index:0,id:'fixture-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:'fixture.txt'})}}]}:{role:'assistant',content:'PROTOCOL_REPLY_OK'};
    for(const [i,d] of [delta,{}].entries())res.write(`data: ${JSON.stringify({id:'fixture-response',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:d,finish_reason:i?callTool?'tool_calls':'stop':null}]})}\n\n`);
    res.end('data: [DONE]\n\n');
   }else{
    const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:20,output_tokens:0}}});
    send('content_block_start',{index:0,content_block:callTool?{type:'tool_use',id:'fixture-read',name:'read',input:{}}:{type:'text',text:''}});
    send('content_block_delta',{index:0,delta:callTool?{type:'input_json_delta',partial_json:JSON.stringify({file_path:'fixture.txt'})}:{type:'text_delta',text:'PROTOCOL_REPLY_OK'}});
    send('content_block_stop',{index:0});
    send('message_delta',{delta:{stop_reason:callTool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:12}});
    send('message_stop',{});res.end();
   }
  }catch(error){failures.push(String(error));res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:String(error)}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const patch=JSON.parse(readFileSync(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
 remapDesktopPatch(patch,resources);
 for(const row of patch)for(const plugin of row.insert??[]) {
  const file={'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs','desktop-vision':'desktop-vision.mjs'}[plugin.id];
  if(file)plugin.name=pathToFileURL(join(resources,file)).href;
 }
 patch[1].config.providers['desktop-internal'].baseURL=`http://127.0.0.1:${server.address().port}/gateway${protocol==='openai'?'/v1':''}`;
 const overlay=join(home,'desktop.patch.json');writeFileSync(overlay,JSON.stringify(patch));
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,DSH_HOME:join(home,'dsh'),DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:'desktop-test-key',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
 Object.assign(env,sourceEnvironment(resources,home,env.DSH_HOME));
 mkdirSync(env.DSH_HOME,{recursive:true});
 const nativeSettings=join(env.DSH_HOME,'settings.yaml');
 writeFileSync(nativeSettings,JSON.stringify({'llm-pi-ai':{providers:{'desktop-internal':{...patch[1].config.providers['desktop-internal'],models:[{...patch[1].config.providers['desktop-internal'].models[1],id:'glm-5.3[1m]',contextWindow:32768,maxTokens:4096}]}}},'agent-default-model':{provider:'desktop-internal',model:'glm-5.3[1m]'},...(source?{'ui-theme':{preference:'dark'}}:{'desktop-sync-test':{preserve:true}})}));
 for(const key of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
 let child,output='',origin,cookie;
 async function start(sync=true){
  let launch;output='';
  const launchEnv={...env};delete launchEnv.DSH_DESKTOP_PATCH;if(sync)launchEnv.DSH_DESKTOP_PATCH=overlay;
  child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env:launchEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});
  child.stdin.write('start\n');const deadline=Date.now()+90000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await pause();assert(launch,'DSH startup');
  const response=await fetch(launch,{redirect:'manual'});cookie=response.headers.get('set-cookie').split(';')[0];origin=new URL(launch).origin;
 }
 async function stop(){if(!child||child.exitCode!==null)return;child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause();if(child.exitCode===null)child.kill();}
 async function rpc(method,request){const response=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:request===undefined?{}:method==='session/list'?{_request:request}:{request}}})});const data=await response.json();assert(data.result?.ok,JSON.stringify(data));return data.result.value;}
 try{
  await start(false);
  const stale=await rpc('session/modelCatalog');
  assert.deepEqual(stale.groups.find(g=>g.id==='desktop-internal').models.map(m=>m.id),['glm-5.3[1m]'],'reproduce native settings overriding the desktop overlay');
  assert.equal(stale.default.model,'glm-5.3[1m]');
  const {sessionId}=await rpc('session/create',{cwd:home});
  await rpc('session/selectModel',{sessionId,provider:'desktop-internal',model:'glm-5.3[1m]',reasoningEffort:'high'});
  await stop();
  await start();
  const catalog=await rpc('session/modelCatalog');
  assert.deepEqual(catalog.groups.find(g=>g.id==='desktop-internal').models.map(m=>m.id),['glm-5.3-flash','glm-5.3']);
  assert.equal(catalog.default.model,'glm-5.3');
  assert.equal(catalog.default.reasoningEffort,'high');
  assert(catalog.groups.find(g=>g.id==='desktop-internal').models.every(m=>m.reasoning.efforts.some(e=>e.id==='high')),'native thinking selector enabled');
  async function prompt(count){
   await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'Read fixture.txt, then reply PROTOCOL_REPLY_OK.'}]});
   const end=Date.now()+25000;let history=[];
   while(Date.now()<end){history=events(join(home,'dsh/sessions'),sessionId);if(history.filter(e=>e.type==='turn/end').length>=count)break;await pause();}
   const turns=history.filter(e=>e.type==='turn/end');
   assert(turns.length>=count,'completed turn persisted');assert(!turns.some(e=>e.data?.reason?.kind==='error'),JSON.stringify(turns));
   assert(JSON.stringify(history).includes('PROTOCOL_REPLY_OK'),'streamed assistant text persisted');
   const contexts=history.filter(e=>e.type==='request/context');
   assert(contexts.length,'native request context persisted');
   const context=contexts.at(-1).data;
   assert.equal(context.model,count===1?'glm-5.3':'glm-5.3-flash');
   assert.equal(context.contextWindow,count===1?1000000:131072,'native context meter uses per-model configured capacity');
  }
  await prompt(1);
  assert(requests.some(r=>JSON.stringify(r.toolResults).includes('PROTOCOL_TOOL_READ_OK')),'native read result returned through protocol');
  const boundary=requests.length;
  await rpc('session/selectModel',{sessionId,provider:'desktop-internal',model:'glm-5.3-flash',reasoningEffort:'low'});
  await prompt(2);
  assert(requests.slice(boundary).some(r=>r.model==='glm-5.3-flash'),'selection changes actual request model');
  assert(!output.includes('OFFLINE_TEST_DENIED'));
  await stop();await start();
  assert.equal((await rpc('session/modelCatalog')).default.model,'glm-5.3-flash','native last selection persists');
  await prompt(3);
  overrideEffort='medium';
  await rpc('session/selectModel',{sessionId,provider:'desktop-internal',model:'glm-5.3-flash',reasoningEffort:'medium'});
  await prompt(4);
  // Connections share the same DSH home. Switching transport configuration
  // must preserve native session history and never replay a prompt.
  await stop();const requestCount=requests.length;
  // Migrate an actual compressed DSH log, not just opaque fixture bytes.
  const legacyHome=join(home,'profiles','p-'+'a'.repeat(32),'dsh');
  mkdirSync(join(home,'profiles','p-'+'a'.repeat(32)),{recursive:true});
  assert(env.DSH_HOME.startsWith(root),'only relocate this test home');
  renameSync(env.DSH_HOME,legacyHome);mkdirSync(env.DSH_HOME,{recursive:true});
  env.DSH_DESKTOP_ROOT=home;
  const previousName=patch[1].config.providers['desktop-internal'].name;
  patch[1].config.providers['desktop-internal'].name='Connection B';
  writeFileSync(overlay,JSON.stringify(patch));await start();
  assert((await rpc('session/list',{})).items.some(s=>s.sessionId===sessionId),'connection B retains original history');
  assert(existsSync(join(legacyHome,'sessions')),'migration retains original native logs');
  const other=await rpc('session/create',{cwd:home});
  await stop();patch[1].config.providers['desktop-internal'].name=previousName;
  writeFileSync(overlay,JSON.stringify(patch));await start();
  const restored=(await rpc('session/list',{})).items;
  assert(restored.some(s=>s.sessionId===sessionId),'connection A retains original session');
  assert(restored.some(s=>s.sessionId===other.sessionId),'new session remains visible after switching back');
  assert.equal(requests.length,requestCount,'connection switching never replays prompts');
  assert.deepEqual(failures,[],'no mock request validation failures, including auxiliary requests');
  results.push({protocol,status:'PASS',staleNativeSettingsReproduced:true,fixedOnFirstRestart:true,oldSessionModelRepaired:true,nativeThinkingSelector:true,nativeEffortSelection:true,nativeThinkingOverride:true,models:['glm-5.3-flash','glm-5.3'],defaultModel:'glm-5.3',switchedModel:'glm-5.3-flash',contextWindows:[131072,1000000],maxOutputTokens:[8192,128000],nativeContextCapacityVerified:true,nativeReadTool:true,streamedReply:true,selectionPersistsAfterRestart:true,requests:requests.map(({toolResults,...r})=>r)});
  results.at(-1).sharedProfileHistory=true;results.at(-1).profileSwitchDoesNotReplay=true;
  console.log(`PASS ${protocol}: catalog, default, model switch, auth, streaming, read tool, restart persistence, shared workspace history without replay`);
 }finally{await stop();writeFileSync(join(home,'backend-test.log'),output);server.closeAllConnections();server.close();writeFileSync(join(root,'report.json'),JSON.stringify(results,null,2));}
}
console.log('Evidence directory:',root);
