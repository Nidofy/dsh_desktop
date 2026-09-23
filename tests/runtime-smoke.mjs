import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createMock} from './mock-llm-server/server.mjs';
import {isSourceRuntime,sourceEnvironment,fixtureBase} from './runtime-fixture.mjs';
const resources=resolve(process.argv[2]??'runtime');
const workRoot=fixtureBase();mkdirSync(workRoot,{recursive:true});
const fixture=mkdtempSync(join(workRoot,'smoke-中文 (space)-'));
const home=isSourceRuntime(resources)?join(fixture,'c-'+crypto.randomUUID().replaceAll('-','')):fixture;
const workspace=join(home,'测试项目','Solver Test (a-b_c)');mkdirSync(workspace,{recursive:true});
writeFileSync(join(workspace,'fixture.txt'),'ORIGINAL_CONTENT\n');
const mock=await createMock();
const overlay=join(home,'desktop.patch.json');
writeFileSync(overlay,JSON.stringify([
 {id:'session-telemetry-otel',disabled:true},
 {id:'llm-pi-ai',config:{providers:{'desktop-internal':{displayName:'Mock',apiKeyEnv:'DSH_DESKTOP_LLM_KEY',api:'openai-completions',baseURL:mock.url,models:[{id:'desktop-mock',contextWindow:32768,maxTokens:4096}],retryPolicy:{mode:'normal',maxRetries:0}}}}},
 {id:'agent-default-model',config:{provider:'desktop-internal',model:'desktop-mock'}}
]));
const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,DSH_HOME:join(home,'dsh'),DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_PATCH:overlay,DSH_DESKTOP_LLM_KEY:'desktop-test-key',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
Object.assign(env,sourceEnvironment(resources,home,env.DSH_HOME));
for(const k of Object.keys(env))if(/^(?:DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(k))delete env[k];
let child;let output='';let cookie='';let origin='';const results=[];
const check=(name,ok,detail='')=>{results.push({name,status:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+detail:''}`);assert(ok,name);};
async function start(){
 output='';let launch;
 child=spawn(join(resources,'runtime/node.exe'),[...(process.env.DSH_TEST_WITHOUT_GUARD?[]:['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href]),'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 console.log('Runtime probe child PID',child.pid);
 child.on('error',e=>{output+=String(e);});
 for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;const m=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output);if(m)launch=m[1];});
 child.stdin.write('start\n');const deadline=Date.now()+90000;
 while(!launch&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 if(!launch)throw new Error('Backend did not announce readiness: '+output.replace(/token=\S+/g,'token=[redacted]'));
 origin=new URL(launch).origin;
 const exchange=await fetch(launch,{redirect:'manual'});cookie=exchange.headers.get('set-cookie')?.split(';')[0]??'';
 assert(cookie,'auth cookie');
 const root=await fetch(origin,{headers:{cookie}});assert.equal(root.status,200);
 return root.text();
}
async function stop(){if(!child||child.exitCode!==null)return;child.stdin.write('stop\n');const deadline=Date.now()+10000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));if(child.exitCode===null){child.kill();throw new Error('Graceful runtime stop exceeded timeout');}}
async function rpc(method,args={}){
 const response=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{cookie,'content-type':'application/json',origin},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{[method==='session/list'?'_request':'request']:args}}})});
 const text=await response.text();let body;try{body=JSON.parse(text);}catch{throw new Error(`RPC ${method}: HTTP ${response.status}: ${text.slice(0,100)}`);}
 if(body.result?.ok===false||body.error)throw new Error(`RPC ${method}: ${JSON.stringify(body)}`);
 return body;
}
try{
 const html=await start();
 check('bundled Node / no Node,npm,pnpm in PATH / HTTP UI',html.includes('<html'));
 const assets=[...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(m=>m[1]);
 for(const asset of assets){const u=new URL(asset,origin);assert.equal(u.origin,origin,'remote asset');assert.equal((await fetch(u,{headers:{cookie}})).status,200,asset);}
 check('upstream UI assets served locally',assets.length>0,`${assets.length} assets`);
 if(isSourceRuntime(resources)){
   const initial=await rpc('workspace/initializeDefault',{directoryName:'默认工作区',title:'默认工作区'});
   const initialValue=initial.result?.value??initial.result??initial;
   assert.equal(initialValue.workspace.path,join(home,'workspace','deepseek-harness','默认工作区'));
   const repeated=await rpc('workspace/initializeDefault',{directoryName:'must-not-create',title:'must-not-rename'});
   assert.deepEqual(repeated.result?.value??repeated.result??repeated,initialValue);
   check('first-use default workspace stays in candidate and is idempotent',true);
 }
 const ws=await rpc('workspace/create',{path:workspace});console.log('workspace result',JSON.stringify(ws).slice(0,700));
 check('workspace creation, Chinese/space/parenthesis paths',true);
 const session=await rpc('session/create',{cwd:workspace});console.log('session result',JSON.stringify(session).slice(0,700));
 const value=session.result?.value??session.result??session;const sessionId=value.sessionId;
 check('native session creation',typeof sessionId==='string');
 await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'EXERCISE_TOOLS: Read fixture.txt, change ORIGINAL_CONTENT to EDITED_CONTENT, run a PowerShell command to write shell-proof.txt with SHELL_OK, then reply MOCK_LLM_OK.'}]});
 const deadline=Date.now()+30000;while(!mock.requests.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 check('custom Base URL + API Key + Model reaches mock',mock.requests.some(r=>r.model==='desktop-mock'&&r.authorized));
 console.log('Native tool names:',mock.requests.find(r=>r.tools.length)?.tools.join(', '));
 const toolDeadline=Date.now()+30000;
 while(!existsSync(join(workspace,'shell-proof.txt'))&&Date.now()<toolDeadline)await new Promise(r=>setTimeout(r,100));
 check('native file read tool',mock.requests.some(r=>r.toolResults.some(v=>JSON.stringify(v).includes('ORIGINAL_CONTENT'))));
 check('native file edit tool',readFileSync(join(workspace,'fixture.txt'),'utf8').includes('EDITED_CONTENT'));
 if(!existsSync(join(workspace,'shell-proof.txt')))console.log('Tool evidence:',JSON.stringify(mock.requests.map(r=>r.toolResults)).slice(-3500));
 check('native PowerShell tool',existsSync(join(workspace,'shell-proof.txt'))&&readFileSync(join(workspace,'shell-proof.txt'),'utf8').includes('SHELL_OK'));
 check('no denied public internet/package-manager calls',!output.includes('OFFLINE_TEST_DENIED'));
 await stop();check('graceful backend stop',child.exitCode===0);
 await start();const list=await rpc('session/list',{});check('session persists across restart',JSON.stringify(list).includes(sessionId));
 if(isSourceRuntime(resources)){
   const data=JSON.parse(readFileSync(join(home,'dsh/storages/workspace.json'),'utf8'));
   assert(Object.values(data.tables.workspaces).some(row=>row.path===workspace));
   assert(Object.values(data.tables.workspaces).some(row=>row.path===join(home,'workspace','deepseek-harness','默认工作区')));
   check('registered explicit project paths survive restart unchanged',true);
 }
 await stop();
}finally{
 try{await stop();}catch(e){console.error(e.message);}finally{mock.server.close();}
 writeFileSync(join(home,'report.json'),JSON.stringify({resources,results},null,2));
 console.log('Evidence directory:',home);
}
