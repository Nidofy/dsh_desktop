import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createMock} from './mock-llm-server/server.mjs';
import {isSourceRuntime,sourceEnvironment,fixtureBase} from './runtime-fixture.mjs';
const resources=resolve(process.argv[2]??'runtime');
mkdirSync(fixtureBase(),{recursive:true});const root=mkdtempSync(join(fixtureBase(),'api-negative-'));
const results=[];
function history(dir,id){
 if(!existsSync(dir))return '';
 let text='';
 for(const e of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,e.name);if(e.isDirectory()){text+=history(p,id);continue;}
  if(!p.includes(id)||!p.endsWith('.zstd'))continue;
  let bytes=readFileSync(p);
  while(bytes.length){try{const r=zstdDecompressSync(bytes,{info:true});const n=r.engine.bytesWritten;if(!n)break;text+=r.buffer.toString();bytes=bytes.subarray(n);}catch{break;}}
 }return text;
}
for(const test of [
 {name:'T42 invalid API key',key:'invalid-test-key',expected:/401|unauthorized|authentication|invalid test key/i},
 {name:'T43 unreachable Base URL',unreachable:true,expected:/ECONNREFUSED|fetch failed|connect|connection/i},
 {name:'T44 model error',model:'unknown-model',expected:/404|unknown model/i},
 {name:'T45 stream idle timeout',stall:true,expected:/TIMEOUT|timed out|idle timeout/i},
]){
 const home=join(root,test.name.split(' ')[0],...(isSourceRuntime(resources)?['c-'+crypto.randomUUID().replaceAll('-','')]:[]));mkdirSync(home,{recursive:true});
 const mock=await createMock({stall:test.stall});const patch=join(home,'patch.json');
 const base=test.unreachable?'http://127.0.0.1:1/v1':mock.url;
 writeFileSync(patch,JSON.stringify([{id:'session-telemetry-otel',disabled:true},{id:'llm-pi-ai',config:{providers:{'desktop-internal':{api:'openai-completions',baseURL:base,apiKeyEnv:'DSH_DESKTOP_LLM_KEY',models:[{id:test.model??'desktop-mock',contextWindow:32768,maxTokens:4096}],timeoutMs:1000,streamIdleTimeoutMs:1000,retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'agent-default-model',config:{provider:'desktop-internal',model:test.model??'desktop-mock'}}]));
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,DSH_HOME:join(home,'dsh'),DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:test.key??'desktop-test-key',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
 Object.assign(env,sourceEnvironment(resources,home,env.DSH_HOME));env.DSH_DESKTOP_PATCH=patch;
 for(const key of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
 let output='',launch;
 const child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});
 child.stdin.write('start\n');
 try{
  let deadline=Date.now()+90000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert(launch,'launch');
  const exchange=await fetch(launch,{redirect:'manual'});const cookie=exchange.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
  async function rpc(method,request){const r=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{cookie,'content-type':'application/json',origin},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{request}}})});const value=await r.json();assert(value.result.ok,JSON.stringify(value));return value.result.value;}
  const {sessionId}=await rpc('session/create',{cwd:home});
  await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'Reply to this API failure fixture.'}]});
  deadline=Date.now()+15000;let log='';
  const failureEvents=text=>text.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.type==='turn/end'&&e.data?.reason?.kind==='error'&&test.expected.test(JSON.stringify(e.data.reason.error)));
  while(Date.now()<deadline){log=history(join(home,'dsh/sessions'),sessionId);if(failureEvents(log).length)break;await new Promise(r=>setTimeout(r,100));}
  const lines=failureEvents(log).map(e=>JSON.stringify(e));
  writeFileSync(join(home,'matching-events.jsonl'),lines.join('\n'));
  assert(lines.length,`${test.name}: expected error turn/end not persisted`);
  assert(!output.includes('OFFLINE_TEST_DENIED'),'unexpected public network');
  // Confirm error surfaced while the Web service remains usable.
  assert.equal((await fetch(origin,{headers:{cookie}})).status,200);
  results.push({test:test.name,status:'PASS'});console.log('PASS',test.name);
 }finally{
  child.stdin.write('stop\n');const deadline=Date.now()+10000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));if(child.exitCode===null)child.kill();mock.server.closeAllConnections();mock.server.close();
 }
}
writeFileSync(join(root,'report.json'),JSON.stringify(results,null,2));console.log('Evidence directory:',root);
