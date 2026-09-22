import {mkdir,readFile,writeFile,readdir,lstat,realpath,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {CheckResult,requireCheck} from './self-test.mjs';
import {ProjectActions,writeAtomic} from './project-actions.mjs';
import {nativeActionExecutor} from './project-actions-integration.mjs';
import {ChangeReview,runVcs} from './change-review.mjs';
import {DesktopArtifacts} from './desktop-artifacts.mjs';
import {assessWirePrefix} from './prefix-regression.mjs';
import {recoveryInitial,recoveryFold,recoveryView} from './task-recovery.mjs';
import {NotificationFeed} from './desktop-notifications.mjs';
import {CacheProbe} from './cache-probe.mjs';
import {verifyRuntime,IntegrityError} from './runtime-integrity.mjs';

async function boundedJson(path,limit=1024*1024){const s=await lstat(path);requireCheck(s.isFile()&&!s.isSymbolicLink()&&s.size<=limit);return JSON.parse(await readFile(path,'utf8'));}
async function hashFile(path,signal){const hash=createHash('sha256');for await(const block of createReadStream(path,{signal}))hash.update(block);return hash.digest('hex');}
async function checkInventory(root,entries,signal){
 requireCheck(Array.isArray(entries)&&entries.length>0&&entries.length<=2000);let bytes=0;const seen=new Set();
 for(const file of entries){signal.throwIfAborted();requireCheck(typeof file.path==='string'&&!isAbsolute(file.path)&&!/[\\:\0]/.test(file.path)&&!file.path.split('/').some(p=>!p||p==='.'||p==='..')&&!seen.has(file.path)&&/^[a-f0-9]{64}$/.test(file.sha256));seen.add(file.path);
   let path=root;for(const part of file.path.split('/')){path=join(path,part);requireCheck(!(await lstat(path)).isSymbolicLink());}
   const stat=await lstat(path);requireCheck(stat.isFile()&&stat.size===file.bytes&&(bytes+=stat.size)<2*1024*1024*1024);requireCheck(await hashFile(path,signal)===file.sha256);
 }return {metrics:{files:entries.length,bytes}};
}
export function localSelfTests(ctx,home,runtimeRoot){return async({check,signal,report})=>{
 const base=resolve(home,'desktop-self-tests','fixtures');await mkdir(base,{recursive:true});
 // Interrupted fixtures are retained for diagnosis. Do not recursively clean
 // arbitrary prior directories; refuse an unbounded accumulation instead.
 requireCheck((await readdir(base)).length<10);
 const fixture=join(base,report.id);await mkdir(fixture);const canonicalBase=await realpath(base),canonicalFixture=await realpath(fixture);
 requireCheck(relative(canonicalBase,canonicalFixture)===report.id);await writeFile(join(fixture,'.owned'),report.id);
 const work=join(fixture,'workspace'),state=join(fixture,'state');await mkdir(work);await mkdir(state);await mkdir(join(work,'.git'));
 const execute=nativeActionExecutor(ctx),actions=new ProjectActions(state,execute);let view,ran;
 const actionConfig={schemaVersion:1,actions:[{id:'echo',label:'Synthetic echo',command:"[Console]::Out.Write('SELF_TEST_ACTION')",timeoutMs:15000}]};
 const shell=async(command,cwd=work,extra={})=>{if(!ctx.get('shell')||!ctx.get('sandboxPolicy'))throw new CheckResult('UNKNOWN','SERVICE_UNAVAILABLE');return execute({workspace:cwd,cwd,command,timeoutMs:15000,env:{},signal,...extra});};
 const okShell=result=>requireCheck(result.exitCode===0&&!result.aborted&&!result.timedOut&&!result.sandbox?.runnerFailed&&result.sandbox?.mode==='workspace-write');
 try{
  await check('node',async()=>{const m=await boundedJson(join(runtimeRoot,'desktop-runtime-manifest.json'));requireCheck(process.platform==='win32'&&process.arch==='x64'&&process.versions.node===m.versions.node);requireCheck((await realpath(process.execPath)).toLowerCase()===(await realpath(join(runtimeRoot,'runtime','node.exe'))).toLowerCase());requireCheck(await hashFile(process.execPath,signal)===m.versions.nodeSha256);});
  await check('dsh',async()=>{try{const {manifest,metrics}=await verifyRuntime(runtimeRoot,{signal});const m=await boundedJson(join(runtimeRoot,'desktop-runtime-manifest.json')),p=await boundedJson(join(runtimeRoot,'dsh','node_modules','@deepseek-ai','dsh','package.json'));requireCheck(p.version===m.versions.dsh&&JSON.stringify(manifest.versions)===JSON.stringify(m.versions));return {metrics};}catch(error){if(error instanceof IntegrityError)throw new CheckResult('FAIL',error.code);throw error;}});
  await check('modules',async()=>{const m=await boundedJson(join(runtimeRoot,'desktop-runtime-manifest.json'));requireCheck(m.schemaVersion===1&&m.files.some(f=>f.path==='self-test-local.mjs'));return checkInventory(runtimeRoot,m.files,signal);});
  await check('webview',async()=>{const m=await boundedJson(join(runtimeRoot,'desktop-runtime-manifest.json')),w=await boundedJson(join(runtimeRoot,'webview2-manifest.json'));requireCheck(w.version===m.versions.webview2&&w.cabSha256===m.versions.webview2CabSha256&&w.architecture==='x64'&&w.files.length>=100);return checkInventory(join(runtimeRoot,'webview2'),w.files,signal);});
  await check('storage',async()=>{const path=join(state,'atomic.json');await writeAtomic(path,JSON.stringify({version:1,value:'before'}));await writeAtomic(path,JSON.stringify({version:1,value:'after'}));requireCheck((await boundedJson(path)).value==='after');});
  await check('shell',async()=>{const result=await shell("Set-Content -LiteralPath 'native.txt' -Value 'SELF_TEST_NATIVE' -NoNewline; [Console]::Out.Write('SELF_TEST_OK')");okShell(result);requireCheck(result.stdout.text.includes('SELF_TEST_OK')&&(await readFile(join(work,'native.txt'),'utf8'))==='SELF_TEST_NATIVE');});
  await check('skills',async()=>{const require=createRequire(join(runtimeRoot,'dsh','package.json'));const {FileSystemSkillProvider}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-skill-filesystem')).href);const root=join(work,'skills');await mkdir(join(root,'synthetic-skill'),{recursive:true});await writeFile(join(root,'synthetic-skill','SKILL.md'),'---\nname: synthetic-skill\ndescription: Synthetic local self-test.\n---\nSELF_TEST_SKILL_BODY\n');
    const provider=new FileSystemSkillProvider(ctx,{invalidate:()=>{},signal},{includeDefaultRoots:false,customSkillDirs:[root],dshHome:state,agentsHome:state,watch:false});try{const found=await provider.list({cwd:work,signal});requireCheck(Array.isArray(found)&&found.length===1&&found[0].name==='synthetic-skill');const loaded=await provider.get(found[0],{cwd:work,signal});requireCheck(loaded.content.includes('SELF_TEST_SKILL_BODY'));}finally{await provider.dispose();}});
  await check('action-trust',async()=>{view=await actions.save(work,actionConfig);try{await actions.start(work,'echo',{signal});throw new CheckResult('FAIL','ASSERTION_FAILED');}catch(error){requireCheck(error.code==='TRUST_REQUIRED');}});
  await check('action-run',async()=>{view??=await actions.save(work,actionConfig);await actions.trust(work,view.fingerprint);const run=await actions.start(work,'echo',{signal});ran=await actions.wait(work,run.id);requireCheck(ran.status==='PASS'&&ran.tail.includes('SELF_TEST_ACTION'));const cold=new ProjectActions(state,()=>{throw Error('No replay');});try{const saved=await cold.wait(work,run.id);requireCheck(saved.status==='PASS');}finally{await cold.close();}});
  await check('action-change',async()=>{await actions.save(work,{schemaVersion:1,actions:[{...actionConfig.actions[0],label:'Changed synthetic echo'}]});requireCheck(!(await actions.inspect(work)).trusted);try{await actions.start(work,'echo',{signal});throw new CheckResult('FAIL','ASSERTION_FAILED');}catch(error){requireCheck(error.code==='TRUST_REQUIRED');}});
  await check('cancel',async()=>{const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);const job=shell("Set-Content -LiteralPath 'cancel-started.txt' -Value 'STARTED'; Start-Sleep -Seconds 30",work,{signal:combined});job.catch(()=>{});const deadline=Date.now()+10000;let started=false;
    try{while(!signal.aborted&&Date.now()<deadline){try{started=(await readFile(join(work,'cancel-started.txt'),'utf8')).includes('STARTED');}catch{}if(started)break;await new Promise(r=>setTimeout(r,100));}}finally{controller.abort();}
    const result=await job;requireCheck(started&&result.aborted===true);
  });
  for(const vcs of ['git','hg'])await check(vcs,async()=>{const root=join(fixture,vcs);await mkdir(root);await mkdir(join(root,'empty-template'));try{await runVcs({root,vcs},vcs==='git'?['init','--quiet','--template=empty-template','.']:['init','.'],{signal});}catch(error){if(error.code==='VCS_MISSING')throw new CheckResult('SKIPPED','DEPENDENCY_MISSING');throw error;}
    await writeFile(join(root,'synthetic.txt'),'BEFORE\n');const review=new ChangeReview(state),baseline=await review.capture(root,{signal});await writeFile(join(root,'synthetic.txt'),'AFTER\n');const inspection=await review.inspect(root,baseline.id,signal);requireCheck(inspection.rows.some(row=>row.path==='synthetic.txt'&&row.classification==='DURING_TASK'));const diff=await review.patch(root,'synthetic.txt',{mode:'task',baselineId:baseline.id});requireCheck(JSON.stringify(diff).includes('AFTER'));
  });
  await check('artifact',async()=>{const artifacts=new DesktopArtifacts(state);await writeFile(join(work,'artifact.txt'),'before');const row=await artifacts.register(work,'artifact.txt');await writeFile(join(work,'artifact.txt'),'after changed');try{await artifacts.resolveLease(row.id);throw new CheckResult('FAIL','ASSERTION_FAILED');}catch(error){requireCheck(error.code==='CHANGED');}try{await artifacts.register(work,'../escape.txt');throw new CheckResult('FAIL','ASSERTION_FAILED');}catch(error){requireCheck(error.code==='PATH');}});
  await check('prefix',async()=>{const before={model:'synthetic',tools:[],messages:[{role:'user',content:'original'}]},append={...before,messages:[...before.messages,{role:'assistant',content:'added'}]};requireCheck(assessWirePrefix('openai',before,append).pass&&!assessWirePrefix('openai',before,{...before,prompt_cache_key:'changed'}).pass&&!assessWirePrefix('openai',before,{...before,messages:[{role:'user',content:'rewritten'}]}).pass);});
  await check('recovery',async()=>{let projection=recoveryInitial({createdAt:1});for(const [seq,event] of [{type:'turn/start',data:{turn:1}},{type:'tool/call',data:{callId:'synthetic',name:'shell'}},{type:'turn/end',data:{reason:{kind:'interrupted'}}}].entries())projection=recoveryFold(projection,{...event,seq,time:seq+1});const path=join(state,'recovery.json');await writeAtomic(path,JSON.stringify(projection));const cold=recoveryView(await boundedJson(path),false);requireCheck(cold.status==='INTERRUPTED'&&cold.unconfirmedTools[0].status==='UNKNOWN');});
  await check('notification',async()=>{const feed=new NotificationFeed(),session={header:{id:'synthetic',origin:'user',title:'PRIVATE_FIXTURE'}};const event={seq:1,type:'turn/end',data:{reason:{kind:'completed'}}};feed.event(session,event);feed.event(session,event);const value=feed.snapshot();requireCheck(value.items.length===1&&!JSON.stringify(value).includes('PRIVATE_FIXTURE'));});
  await check('probe-failure',async()=>{let sent=0;const probe=new CacheProbe({prepare:async()=>({calls:Array.from({length:4},()=>({config:{},async *stream(){sent++;yield {type:'finish',reason:{kind:'error'}};}})),configuration:{}}),pause:async()=>{}});probe.start({model:'synthetic',requests:4,inputBytes:2048,accepted:true});await probe.done;requireCheck(sent===1&&probe.snapshot().status==='FAILED'&&probe.controller===null);});
 }finally{
  await actions.close();
  // Only this run's freshly-created, identity-marked canonical directory can
  // be removed. Retain interrupted/foreign/replaced paths instead of guessing.
  try{requireCheck(await realpath(fixture)===canonicalFixture&&(await readFile(join(fixture,'.owned'),'utf8'))===report.id&&relative(canonicalBase,canonicalFixture)===report.id&&!report.id.includes(sep));await rm(canonicalFixture,{recursive:true,force:false,maxRetries:2});}
  catch{report.warning='CLEANUP_FAILED';}
 }
};}
