// Synthetic by default. --live --execute is an explicit opt-in to real provider calls.
import {readFile,writeFile,mkdir,cp,lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHmac,createHash} from 'node:crypto';
import http from 'node:http';
import {matrixCases,interleave,runCommand} from './experiment-process.mjs';
import {selectReport,compareReports,comparisonMarkdown} from '../runtime-src/diagnostic-comparison.mjs';
const args=process.argv.slice(2),manifestPath=args.find(a=>!a.startsWith('--'));
if(!manifestPath){console.log('node scripts/experiment-runner.mjs manifest.json [--execute] [--live] [--full-matrix]');process.exit(0);}
const manifest=JSON.parse(await readFile(manifestPath,'utf8')),live=args.includes('--live'),execute=args.includes('--execute');
const cases=matrixCases(manifest.matrix,args.includes('--full-matrix')),schedule=interleave(cases,manifest.repeat??1);
if(!['task','request'].includes(manifest.mode??'task'))throw Error('mode must be task or request');
const mode=manifest.mode??'task',count=manifest.tasksPerCase??1,timeoutMs=manifest.timeoutMs??60000,maxRequests=manifest.maxRequests??30;
if(!Number.isInteger(count)||count<1||count>16||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>500)throw Error('Invalid limits');
if(schedule.length*count>120)throw Error('Maximum 120 workloads per invocation');
if(live&&(!manifest.provider?.baseURL||!manifest.provider?.model||!manifest.provider?.apiKeyEnv))throw Error('Live mode requires provider baseURL/model/apiKeyEnv');
if(live&&mode==='task'&&(!manifest.template||!manifest.prompt||!Array.isArray(manifest.acceptance)||!manifest.acceptance.length))throw Error('Live task requires template, prompt and external acceptance commands');
if(live&&manifest.provider.api&&manifest.provider.api!=='openai-completions')throw Error('Runner currently supports OpenAI-compatible transport');
if(live){const endpoint=new URL(manifest.provider.baseURL);if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error('Invalid provider URL');if(execute&&!process.env[manifest.provider.apiKeyEnv])throw Error('API key environment variable is missing');}
console.log(JSON.stringify({mode,live,execute,schedule,tasksPerCase:count,totalWorkloads:schedule.length*count},null,2));
if(!execute)process.exit(0);
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),runtime=resolve(repo,manifest.runtime??'runtime'),node=join(runtime,'runtime/node.exe');
const desktopVersion=JSON.parse(await readFile(join(runtime,'desktop-runtime-manifest.json'),'utf8')).versions.desktop;
const output=join(repo,'.build','experiments',Date.now()+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const key=randomBytes(32),hmac=value=>createHmac('sha256',key).update(value).digest('hex').slice(0,24);
const controller=new AbortController();let interrupted=false;process.once('SIGINT',()=>{interrupted=true;controller.abort();});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let server,baseURL=manifest.provider?.baseURL;
if(!live){server=http.createServer(async(req,res)=>{
 try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8*1024*1024)throw Error('oversize');}const body=JSON.parse(raw),title=JSON.stringify(body.messages).includes('Generate the session title');
 const tools=body.messages.filter(m=>m.role==='tool'),hasWrite=tools.some(m=>m.tool_call_id==='fixture-write');
 const call=mode==='task'&&!title&&!hasWrite?(tools.length?{id:'fixture-write',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:'result.txt',content:'accepted\n'})}}:{id:'fixture-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:'fixture.txt'})}}):null;
 const input=Math.ceil(Buffer.byteLength(raw)/4);res.writeHead(200,{'content-type':'text/event-stream'});
 const delta=call?{role:'assistant',tool_calls:[{index:0,...call}]}:{role:'assistant',content:'Synthetic fixture complete'};
 for(const [i,d] of [delta,{}].entries())res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:d,finish_reason:i?call?'tool_calls':'stop':null}]})+'\n\n');
 res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[],usage:{prompt_tokens:input,completion_tokens:12,total_tokens:input+12,prompt_tokens_details:{cached_tokens:0}}})+'\n\n');res.end('data: [DONE]\n\n');
 }catch{res.writeHead(400).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));baseURL='http://127.0.0.1:'+server.address().port+'/v1';}
const all=[],batchResults=[],batches=[];
async function safeCopy(source,destination){
 const s=await lstat(source);if(s.isSymbolicLink())throw Error('Template symlinks are not supported');
 if(s.isDirectory()){await mkdir(destination,{recursive:true});for(const entry of await readdir(source)){if(['.git','.hg','node_modules','.build','dist'].includes(entry))continue;await safeCopy(join(source,entry),join(destination,entry));}}
 else if(s.isFile())await cp(source,destination,{force:false,errorOnExist:true});
}
async function acceptanceFingerprint(workspace,paths){
 const hash=createHash('sha256');let bytes=0;
 async function visit(file){const s=await lstat(file);if(s.isSymbolicLink())throw Error('Acceptance symlink unsupported');hash.update(relative(workspace,file));if(s.isDirectory()){for(const name of (await readdir(file)).sort()){if(['__pycache__','.pytest_cache'].includes(name))continue;await visit(join(file,name));}}else{bytes+=s.size;if(bytes>16*1024*1024)throw Error('Acceptance definition exceeds 16 MiB');hash.update(await readFile(file));}}
 for(const path of paths){const file=resolve(workspace,path),rel=relative(workspace,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Protected acceptance path must be inside template');await visit(file);}return hash.digest('hex');
}
async function startEngine(dir,config){
 const home=join(dir,'home');await mkdir(home,{recursive:true});
 await writeFile(join(home,'desktop-observability.json'),JSON.stringify({enabled:true,spillMode:config.toolOutputBudget===24000?'compact':'native',skillMode:config.skillDescription===250?'compact':'native',repoSummary:config.repoSummary===true}));
 const model=manifest.provider?.model??'synthetic-model';const overlay=join(dir,'overlay.json');
 const patch=[{id:'session-telemetry-otel',disabled:true},{id:'llm-pi-ai',config:{providers:{'desktop-internal':{api:'openai-completions',baseURL,apiKeyEnv:'DSH_EXPERIMENT_KEY',models:[{id:model,contextWindow:131072,maxTokens:manifest.maxOutputTokens??8192}],retryPolicy:{mode:'normal',maxRetries:0}}}}},{id:'agent-default-model',config:{provider:'desktop-internal',model}},
 {insert:[{id:'desktop-observability',name:pathToFileURL(join(runtime,'desktop-observability.mjs')).href,config:{desktopVersion,api:'openai-completions'}}]}];
 await writeFile(overlay,JSON.stringify(patch));
 const env={...process.env,DSH_HOME:home,DSH_DESKTOP_PATCH:overlay,DSH_TELEMETRY_DISABLED:'1',DSH_EXPERIMENT_KEY:live?process.env[manifest.provider.apiKeyEnv]:'synthetic',NODE_OPTIONS:'',NODE_PATH:''};
 if(live&&!env.DSH_EXPERIMENT_KEY)throw Error('API key environment variable is missing');
 if(!live)for(const k of Object.keys(env))if(/^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|OPENAI_|ANTHROPIC_|DEEPSEEK_)/i.test(k))delete env[k];
 const child=spawn(node,['--import',pathToFileURL(join(runtime,'host.mjs')).href,join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:dir,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let text='',launch,spawnError;child.on('error',e=>{spawnError=e;});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{text=(text+chunk).slice(-10000);launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(text)?.[1];});
 child.stdin.write('start '+JSON.stringify({diagnosticKey:key.toString('hex')})+'\n');
 const stop=async()=>{if(child.exitCode!==null)return;child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause(50);if(child.exitCode===null)child.kill();};
 try{const end=Date.now()+60000;while(!launch&&child.exitCode===null&&!spawnError&&Date.now()<end&&!controller.signal.aborted)await pause(50);if(!launch)throw Error('Engine did not start');
 const response=await fetch(launch,{redirect:'manual',signal:AbortSignal.timeout(10000)}),cookie=response.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
 async function api(path,data){const r=await fetch(origin+path,{headers:{cookie,origin,'content-type':'application/json'},method:data===undefined?'GET':'POST',...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Engine API status '+r.status);return r.json();}
 async function rpc(method,request){const r=await api('/api/'+method,{type:'client-request',method,rpcId:randomUUID(),payload:{args:{request}}});if(!r.result?.ok)throw Error('Engine RPC failed');return r.result.value;}
 return {api,rpc,stop};}catch(e){await stop();throw e;}
}
try{for(const entry of schedule){
 if(interrupted)break;
 const dir=join(output,'round-'+entry.round+'-case-'+entry.caseIndex);await mkdir(dir,{recursive:true});
 const engine=mode==='task'?await startEngine(dir,entry.config):null,batchStart=Date.now(),resultOffset=batchResults.length;let cursor=0;
 const concurrency=entry.config.maxConcurrency??1;
 try{await Promise.all(Array.from({length:Math.min(count,concurrency)},async()=>{while(cursor<count&&!interrupted){const index=cursor++,queuedAt=batchStart,started=Date.now(),workspace=join(dir,'task-'+index);await mkdir(workspace,{recursive:true});
 let result={round:entry.round,caseIndex:entry.caseIndex,index,config:entry.config,mode,synthetic:!live,queueMs:started-queuedAt,status:'UNKNOWN'};
 try{if(mode==='request'){
   const response=await fetch(baseURL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(live?process.env[manifest.provider.apiKeyEnv]:'synthetic')},body:JSON.stringify({model:manifest.provider?.model??'synthetic-model',messages:[{role:'user',content:manifest.prompt??'Reply synthetic complete'}],max_tokens:manifest.maxOutputTokens??128,stream:true,stream_options:{include_usage:true}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});
   let firstByteMs=null,bytes=0;for await(const chunk of response.body){firstByteMs??=Date.now()-started;bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Response limit');}
   result={...result,status:response.ok?'TRANSPORT_OK':'HTTP_ERROR',httpStatus:response.status,firstByteMs,responseBytes:bytes,quality:'UNKNOWN'};
 }else{
   if(live){const source=resolve(dirname(resolve(manifestPath)),manifest.template),rel=relative(source,workspace);if(!rel.startsWith('..')&&!isAbsolute(rel))throw Error('Output cannot be inside template');await safeCopy(source,workspace);}
   else await writeFile(join(workspace,'fixture.txt'),'fixture\n'.repeat(8000));
   const protectedPaths=live?(manifest.protectedAcceptancePaths??[]):[],acceptanceBefore=protectedPaths.length?await acceptanceFingerprint(workspace,protectedPaths):null;
   const {sessionId}=await engine.rpc('session/create',{cwd:workspace}),session=hmac(sessionId),begin=new Date().toISOString();
   await engine.rpc('session/prompt',{sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:live?manifest.prompt:'Read fixture.txt, then write result.txt containing accepted followed by a newline.'}]});
   let report,finished=false;const deadline=Date.now()+timeoutMs;
   while(Date.now()<deadline&&!interrupted){await pause(100);report=await engine.api('/desktop-diagnostics/api/snapshot?session='+session);const rows=report.records.filter(r=>r.purpose==='conversation');
     if(rows.some(r=>r.status==='error'||r.status==='aborted'))break;
     if(rows.some(r=>r.status==='stop')){finished=true;break;}
     if(rows.length>=maxRequests)break;
   }
   if(!finished)await engine.rpc('session/cancel',{sessionId});
   const checks=[];
   const acceptance=live?manifest.acceptance:[{command:node,args:['-e',"const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='accepted\\n')process.exit(1)"]}];
   for(let i=0;i<acceptance.length;i++){const check=acceptance[i];if(typeof check.command!=='string'||!Array.isArray(check.args))throw Error('Acceptance requires command and args');checks.push(await runCommand({...check,cwd:workspace,timeoutMs:Math.min(timeoutMs,check.timeoutMs??60000),logFile:join(dir,'acceptance-'+index+'-'+i+'.log'),signal:controller.signal}));}
   const acceptanceUnchanged=!protectedPaths.length||acceptanceBefore===await acceptanceFingerprint(workspace,protectedPaths);
   const quality=finished&&checks.every(c=>c.status==='PASS')&&acceptanceUnchanged?'PASS':'FAIL';
   report=selectReport(report??await engine.api('/desktop-diagnostics/api/snapshot?session='+session),{session});
   report.workspace={vcs:'isolated-copy',revision:null,state:null,complete:false};
   report.measurement={...report.measurement,id:randomUUID(),label:(manifest.name??'Experiment')+' '+entry.round+'/'+entry.caseIndex+'/'+index,startedAt:begin,endedAt:new Date().toISOString(),quality,acceptanceKind:!live||protectedPaths.length?'external':'manual',acceptanceId:createHash('sha256').update(JSON.stringify({acceptance,definition:acceptanceBefore})).digest('hex'),complete:finished&&report.dropped===0&&report.toolsDropped===0};
   const file=join(dir,'measurement-'+index+'.json');await writeFile(file,JSON.stringify(report,null,2));all.push({file,report,entry,index});
   result={...result,status:quality,quality,measurement:file,acceptanceDefinition:!live?'BUILT_IN':protectedPaths.length?acceptanceUnchanged?'UNCHANGED':'CHANGED':'UNVERIFIED',acceptance:checks.map(({tail,...rest})=>rest)};
 }
 }catch(e){result.status='ERROR';result.errorType=e.name??'Error';}
 result.durationMs=Date.now()-started;batchResults.push(result);await writeFile(join(dir,'result-'+index+'.json'),JSON.stringify(result,null,2));
 }}));const rows=batchResults.slice(resultOffset),wallMs=Date.now()-batchStart;
 const percentile=(field,p)=>{const values=rows.map(r=>r[field]).filter(Number.isFinite).sort((a,b)=>a-b);return values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]:null;};
 batches.push({round:entry.round,caseIndex:entry.caseIndex,config:entry.config,workloads:rows.length,wallMs,throughputPerSecond:wallMs?rows.length*1000/wallMs:null,durationP50Ms:percentile('durationMs',.5),durationP95Ms:percentile('durationMs',.95),queueP95Ms:percentile('queueMs',.95),firstByteP50Ms:percentile('firstByteMs',.5),failures:rows.filter(r=>!['PASS','TRANSPORT_OK'].includes(r.status)).length});
 }finally{await engine?.stop();}
 console.log('Completed round '+entry.round+' case '+entry.caseIndex+' concurrency '+concurrency);
 }
 const comparisons=[];for(const run of all.filter(r=>r.entry.caseIndex!==0)){const base=all.find(r=>r.entry.round===run.entry.round&&r.entry.caseIndex===0&&r.index===run.index);if(base){const comparison=compareReports(base.report,run.report);const file=join(output,'comparison-'+run.entry.round+'-'+run.entry.caseIndex+'-'+run.index);await writeFile(file+'.json',JSON.stringify(comparison,null,2));await writeFile(file+'.md',comparisonMarkdown(comparison));comparisons.push(file+'.json');}}
 const result={schemaVersion:1,synthetic:!live,mode,matrixMode:args.includes('--full-matrix')?'full':'one-factor-at-a-time',interrupted,batches,results:batchResults,comparisons,
 limitations:['Synthetic results validate the harness, not real coding efficiency.','Request mode measures transport completion/first byte, not model TTFT or task quality.','Task workspaces are isolated copies excluding VCS metadata; workspace revision comparability is unknown.','Acceptance logs may contain project output; share diagnostic measurements separately.']};
 await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));console.log('Results: '+output);
 if(interrupted||batchResults.some(r=>['FAIL','ERROR','HTTP_ERROR'].includes(r.status)))process.exitCode=1;
}finally{if(server){server.closeAllConnections();server.close();}}
