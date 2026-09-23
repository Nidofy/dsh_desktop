import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,symlink,cp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {selectHarnessAdapter,requireDesktopAdapter,sourceProbeArguments,sourceProfile} from '../runtime-src/harness-adapter.mjs';
import {startupErrorCode} from '../runtime-src/startup-errors.mjs';

async function fixture(){
  await mkdir('.build',{recursive:true});
  const root=await mkdtemp(resolve('.build/adapter-contract-'));
  return {root,home:join(root,'dsh')};
}
test('desktop admission refuses source and unknown engines before any home writes',async()=>{
  const f=await fixture(),pkg=join(f.root,'dsh/node_modules/@deepseek-ai/dsh');
  await mkdir(pkg,{recursive:true});
  for(const version of ['0.1.5-rc.2','0.1.7-alpha.2','0.1.7-alpha.3']){
    await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version}));
    if(version==='0.1.5-rc.2')assert.equal((await requireDesktopAdapter(f.root)).sessionWriter,3);
    else await assert.rejects(requireDesktopAdapter(f.root),{code:version==='0.1.7-alpha.2'?'HARNESS_ADAPTER_NOT_READY':'HARNESS_ADAPTER_UNKNOWN'});
  }
  assert.throws(()=>selectHarnessAdapter('toString'),{code:'HARNESS_ADAPTER_UNKNOWN'});
  assert.equal(startupErrorCode(Error('sensitive detail'),'ADAPTER'),'BOOT_ADAPTER_UNSUPPORTED');
});
test('custom profile initializes once; restart preserves configuration and omits initializer',async()=>{
  const f=await fixture();
  assert.deepEqual((await sourceProbeArguments(f)).slice(0,4),['--profile',sourceProfile,'--from-default-profile','web']);
  const dir=join(f.home,'profiles',sourceProfile);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
  await writeFile(join(dir,'cordis.patch.yml'),'# synthetic user settings\n[]\n');
  assert(!(await sourceProbeArguments(f)).includes('--from-default-profile'));
  assert.equal(await readFile(join(dir,'cordis.patch.yml'),'utf8'),'# synthetic user settings\n[]\n');
});
test('interrupted initialization is refused without deleting or repairing evidence',async()=>{
  const f=await fixture(),dir=join(f.home,'profiles',sourceProfile);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'partial'),'keep');
  await assert.rejects(sourceProbeArguments(f),{code:'HARNESS_PROFILE_INCOMPLETE'});
  assert.equal(await readFile(join(dir,'partial'),'utf8'),'keep');
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:['@deepseek-ai/dsh-base']}}}));
  await assert.rejects(sourceProbeArguments(f),{code:'HARNESS_PROFILE_INCOMPATIBLE'});
});
test('probe rejects a shared home, relative paths and linked profile ancestors',async()=>{
  const f=await fixture(),other=await fixture();
  await assert.rejects(sourceProbeArguments({...f,home:other.home}),{code:'HARNESS_PROFILE_ISOLATION'});
  await assert.rejects(sourceProbeArguments({root:'.',home:'dsh'}),{code:'HARNESS_PROFILE_ISOLATION'});
  await mkdir(other.home);await symlink(other.home,f.home,process.platform==='win32'?'junction':'dir');
  await assert.rejects(sourceProbeArguments(f),{code:'HARNESS_PROFILE_PATH'});
});
test('real preload rejects unqualified engine before CLI and settings migration execute',async()=>{
  const f=await fixture(),runtime=join(f.root,'resources'),pkg=join(runtime,'dsh/node_modules/@deepseek-ai/dsh');
  await mkdir(pkg,{recursive:true});
  for(const name of await readdir('runtime-src'))if(name.endsWith('.mjs'))await cp(join('runtime-src',name),join(runtime,name));
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.1.7-alpha.2'}));
  await mkdir(f.home);await writeFile(join(f.home,'settings.yaml'),'# preserve synthetic settings\n');
  const cli=join(runtime,'sentinel.mjs');await writeFile(cli,"console.log('CLI_MUST_NOT_RUN'); process.exit(0);\n");
  const child=spawn(process.execPath,['--import',pathToFileURL(join(runtime,'host.mjs')).href,cli],{
    env:{...process.env,DSH_HOME:f.home,DSH_DESKTOP_ROOT:f.root,NODE_OPTIONS:'',NODE_PATH:''},windowsHide:true,stdio:['pipe','pipe','pipe'],
  });
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;});
  const timer=setTimeout(()=>child.kill(),15000);
  const result=new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>done(code));});
  child.stdin.on('error',()=>{});child.stdin.write('start\n');
  try{assert.equal(await result,1);assert.match(output,/dsh desktop error: BOOT_ADAPTER_UNSUPPORTED/);assert(!output.includes('CLI_MUST_NOT_RUN'));}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
  assert.deepEqual(await readdir(f.home),['settings.yaml']);
  assert.equal(await readFile(join(f.home,'settings.yaml'),'utf8'),'# preserve synthetic settings\n');
});
