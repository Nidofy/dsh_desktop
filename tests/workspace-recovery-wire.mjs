import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isSourceRuntime,sourceEnvironment,fixtureBase} from './runtime-fixture.mjs';
const runtime=resolve(process.argv[2]??'runtime');
await mkdir(fixtureBase(),{recursive:true});
const fixture=await mkdtemp(join(fixtureBase(),'workspace-recovery-wire-')),root=isSourceRuntime(runtime)?join(fixture,'c-'+crypto.randomUUID().replaceAll('-','')):fixture,home=join(root,'dsh');
await mkdir(join(home,'storages'),{recursive:true});
const workspace=join(root,'project');await mkdir(workspace);
const record={path:workspace,title:'Shared project',sessionIds:['session-a'],createdAt:'2026-09-20T00:00:00Z',updatedAt:'2026-09-20T00:00:00Z'};
const document={unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['current','legacy'],archivedSessionIds:['session-b']},tables:{workspaces:{current:record,legacy:{...record,title:'Old project name',sessionIds:['session-b','session-a']}}}};
const file=join(home,'storages/workspace.json'),original=JSON.stringify(document,null,2);
await writeFile(file,original);
const overlay=join(root,'desktop.patch.json');await writeFile(overlay,'[]');
async function boot(host){
  const env={...process.env,DSH_HOME:home,DSH_DESKTOP_ROOT:root,DSH_DESKTOP_PATCH:overlay,DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:'fixture',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
  Object.assign(env,sourceEnvironment(runtime,root,home));
  for(const key of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
  const args=['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href];
  if(host)args.push('--import',pathToFileURL(join(runtime,'host.mjs')).href);
  args.push(join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open');
  const child=spawn(join(runtime,'runtime/node.exe'),args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let text='',ready=false,killTimer;
  const timeout=setTimeout(()=>child.kill(),45000);
  const closed=new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>done(code));});
  child.stdin.on('error',()=>{});
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{
    text+=bytes;
    if(!ready&&text.includes('dsh web: http://127.0.0.1:')){ready=true;child.stdin.write('stop\n');killTimer=setTimeout(()=>child.kill(),6000);}
  });
  if(host)child.stdin.write('start\n');
  const code=await closed;clearTimeout(timeout);clearTimeout(killTimer);
  return {code,ready,duplicate:text.includes('is claimed by both workspace'),offline:text.includes('OFFLINE_TEST_DENIED')};
}
const baseline=await boot(false);
if(isSourceRuntime(runtime)){
  // Cordis now isolates the failed workspace service while starting the HTTP host.
  // A listening endpoint does not mean that duplicate workspace data was repaired.
  assert.equal(baseline.ready,true);assert.equal(baseline.duplicate,true);assert.equal(baseline.offline,false);
}else assert.deepEqual(baseline,{code:1,ready:false,duplicate:true,offline:false},'legacy DSH exits on the duplicate-path invariant');
assert.equal(await readFile(file,'utf8'),original);
const fixed=await boot(true);assert.equal(fixed.ready,true);assert.equal(fixed.code,0);assert.equal(fixed.offline,false);
const repaired=JSON.parse(await readFile(file,'utf8'));
assert.deepEqual(repaired.global.workspaceIds,['current']);
assert.deepEqual(repaired.tables.workspaces.current.sessionIds,['session-a','session-b']);
assert.deepEqual(repaired.global.archivedSessionIds,['session-b']);
const backups=await readdir(join(home,'desktop-workspace-repairs'));assert.equal(backups.length,1);
assert.equal(await readFile(join(home,'desktop-workspace-repairs',backups[0]),'utf8'),original);
assert.equal((await boot(true)).ready,true);
assert.equal((await readdir(join(home,'desktop-workspace-repairs'))).length,1);
await writeFile(join(fixture,'report.json'),JSON.stringify({runtime,baseline,fixed,checks:['duplicate invariant reproduced','original bytes preserved before repair','single backed-up repair','sessions and archive preserved','second boot idempotent'],status:'PASS'},null,2)+'\n');
console.log('PASS Harness duplicate workspace startup: reproduced upstream service rejection, automatic backed-up repair, session/archive preservation and second boot');
console.log('Evidence:',root);
