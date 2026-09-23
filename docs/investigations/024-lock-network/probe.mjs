// Synthetic loopback investigation against the unchanged delivered runtime.
// No native window or lock/sleep operation: those remain separate field tests.
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
const resources=resolve(process.argv.slice(2).find(v=>!v.startsWith('--'))??'dist/DSHDesktop-0.2.4-rc.2-win-x64/resources');
const defaults=process.argv.includes('--defaults');
const root=mkdtempSync(resolve('.build/lock-network-'));const results=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function events(dir,id){let text='';if(!existsSync(dir))return [];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){text+=eventsText(p,id);continue;}if(p.includes(id)&&p.endsWith('.zstd'))text+=decode(p);}return text.split('\n').filter(Boolean).map(s=>JSON.parse(s));}
function eventsText(dir,id){let text='';for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())text+=eventsText(p,id);else if(p.includes(id)&&p.endsWith('.zstd'))text+=decode(p);}return text;}
function decode(p){let b=readFileSync(p),text='';while(b.length){try{const r=zstdDecompressSync(b,{info:true});if(!r.engine.bytesWritten)break;text+=r.buffer.toString();b=b.subarray(r.engine.bytesWritten);}catch{break;}}return text;}
console.log('Evidence directory: '+root);
for(const protocol of defaults?['openai']:['openai','anthropic']){
 const home=join(root,protocol);mkdirSync(home,{recursive:true});let mode='normal',requests=0;const timers=new Set();
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);
  const isTitle=JSON.stringify(body.messages).includes('Generate the session title');const behavior=isTitle?'normal':mode;if(!isTitle)requests++;
  if(behavior==='no-headers')return;
  res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
  const later=(fn,ms,repeat=false)=>{const t=(repeat?setInterval:setTimeout)(fn,ms);timers.add(t);res.on('close',()=>{clearTimeout(t);clearInterval(t);timers.delete(t);});};
  const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  const chunk=delta=>res.write(`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
  const begin=()=>{if(protocol==='openai')chunk({role:'assistant',content:''});else{send('message_start',{message:{id:'msg_synthetic',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}});send('content_block_start',{index:0,content_block:{type:'text',text:''}});}};
  const delta=()=>protocol==='openai'?chunk({content:'step '}):send('content_block_delta',{index:0,delta:{type:'text_delta',text:'step '}});
  const end=()=>{if(protocol==='openai'){res.write(`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');}else{send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}});send('message_stop',{});res.end();}};
  if(behavior==='header-stall')return;
  if(behavior==='heartbeats'){later(()=>res.write(': proxy-alive\n\n'),200,true);return;}
  begin();delta();
  if(behavior==='mid-reset'){later(()=>res.destroy(),350);return;}
  if(behavior==='mid-stall')return;
  if(behavior==='progress'||behavior==='cancel-progress'){later(delta,400,true);if(behavior==='progress')later(end,12000);return;}
  end();
 }catch{res.destroy();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const patch=JSON.parse(readFileSync(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
 for(const row of patch)for(const p of row.insert??[]){const names={'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs','desktop-environment':'desktop-environment/index.mjs','desktop-vision':'desktop-vision.mjs'};if(names[p.id])p.name=pathToFileURL(join(resources,names[p.id])).href;}
 const config=patch.find(r=>r.id==='llm-pi-ai').config.providers['desktop-internal'];
 Object.assign(config,{baseURL:`http://127.0.0.1:${server.address().port}${protocol==='openai'?'/v1':''}`,timeoutMs:defaults?300000:6000,streamIdleTimeoutMs:defaults?300000:2500,retryPolicy:{mode:'normal',maxRetries:0}});
 const overlay=join(home,'patch.json');writeFileSync(overlay,JSON.stringify(patch));
 const env={...process.env,DSH_HOME:join(home,'dsh'),DSH_DESKTOP_PATCH:overlay,DSH_DESKTOP_LLM_KEY:'synthetic-local-only',DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
 for(const k of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(k))delete env[k];
 let output='',launch;const child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.on('error',e=>console.error(e));for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});child.stdin.write('start '+JSON.stringify({diagnosticKey:'09'.repeat(32)})+'\n');
 try{
  let deadline=Date.now()+60000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await pause(100);assert(launch,output.slice(-1800));
  const response=await fetch(launch,{redirect:'manual'});const cookie=response.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
  async function rpc(method,request){const r=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{request}}}),signal:AbortSignal.timeout(10000)});const j=await r.json();assert(j.result?.ok,JSON.stringify(j));return j.result.value;}
  async function control(action='status'){const id=crypto.randomUUID().replaceAll('-','');child.stdin.write('desktop-control '+JSON.stringify({id,action})+'\n');const end=Date.now()+5000;while(Date.now()<end){const line=output.split('\n').find(l=>l.startsWith('dsh control: ')&&l.includes(id));if(line)return JSON.parse(line.slice(13));await pause(50);}throw Error('control timeout');}
  async function state(id){const r=await fetch(origin+'/desktop-diagnostics/api/recovery/session?id='+id,{headers:{cookie,origin},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();}
  for(const scenario of defaults?['header-stall']:['progress','no-headers','header-stall','heartbeats','mid-reset','mid-stall','cancel-progress']){
   mode=scenario;const count=requests;const {sessionId}=await rpc('session/create',{cwd:home});const start=Date.now();
   await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'Synthetic transport test. Reply directly without tools.'}]});
   let cancellation=null;
   if(scenario==='progress')await pause(13000); // no browser/subscription/polling while the task runs
   if(scenario==='cancel-progress'){await pause(9000);const before=await control();assert(before.known&&before.running>0);cancellation={before,ack:await control('cancel')};}
   deadline=start+(defaults?330000:22000);let ended;
   while(Date.now()<deadline){ended=events(join(env.DSH_HOME,'sessions'),sessionId).find(e=>e.type==='turn/end');if(ended)break;await pause(defaults?500:100);}
   const after=await control(),recovery=await state(sessionId);
   const expected=scenario==='progress'?'completed':scenario==='cancel-progress'?'aborted':'error';
   const result={protocol,scenario,timeoutMs:config.timeoutMs,idleMs:config.streamIdleTimeoutMs,elapsedMs:Date.now()-start,requests:requests-count,expected,terminal:ended?.data.reason??null,control:after,recoveryStatus:recovery.status,cancellation,backendAlive:child.exitCode===null};
   result.pass=ended?.data.reason?.kind===expected&&after.known&&after.running===0&&result.backendAlive;
   results.push(result);writeFileSync(join(root,'report.json'),JSON.stringify({resources,defaults,actualLockTest:false,results},null,2));console.log(JSON.stringify(result));
   if(!result.pass){await control('cancel');await pause(500);}
  }
  assert(!output.includes('OFFLINE_TEST_DENIED'),'public network');
 }finally{child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause(100);if(child.exitCode===null)child.kill();for(const t of timers){clearTimeout(t);clearInterval(t);}server.closeAllConnections();server.close();}
}
assert(results.every(r=>r.pass),'See report for failed cases');
