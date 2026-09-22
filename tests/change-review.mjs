import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,unlink,symlink,readdir} from 'node:fs/promises';
import {join,resolve,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ChangeReview,workingFile,discoverRepository,validRepoPath,vcsEnvironment} from '../runtime-src/change-review.mjs';
import {installChangeReview} from '../runtime-src/change-review-integration.mjs';
const exec=promisify(execFile);await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/changes-'));
const protocols=process.argv.includes('--hg')?['git','hg']:['git'];
if(protocols.includes('hg'))process.env.PATH=resolve('.build/hg-test-venv/Scripts')+delimiter+process.env.PATH;
for(const vcs of protocols){
 const workspace=join(root,vcs+' 中文 workspace'),home=join(root,vcs+'-home');await mkdir(workspace);await mkdir(home);const manager=new ChangeReview(home);
 const command=async(...args)=>(await exec(vcs,args,{cwd:workspace,env:vcsEnvironment(),windowsHide:true})).stdout;
 await command('init');
 const empty=await manager.capture(workspace);assert.equal((await manager.inspect(workspace)).rows.length,0);
 const add=async()=>command(vcs==='git'?'add':'add','--','a.txt','before.txt','remove.txt','空间 [x].txt');
 const commit=async message=>vcs==='git'?command('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',message):command('commit','-u','Fixture','-m',message);
 for(const [name,value] of [['a.txt','original\n'],['before.txt','old\n'],['remove.txt','remove\n'],['空间 [x].txt','中文\n']])await writeFile(join(workspace,name),value);
 await add();await commit('initial');
 assert((await manager.inspect(workspace,empty.id)).rows.some(r=>r.path==='a.txt'&&r.classification==='DURING_TASK'),'first commit remains visible relative to an empty repository baseline');
 assert.match((await manager.patch(workspace,'a.txt',{baselineId:empty.id,mode:'task'})).text,/\+original/);
 assert.equal((await manager.inspect(workspace)).rows.length,0);
 await writeFile(join(workspace,'before.txt'),'user edit\n');await writeFile(join(workspace,'untracked.txt'),'before untracked\n');
 const baseline=await manager.capture(workspace);assert.equal(baseline.coverage,'COMPLETE');
 let view=await manager.inspect(workspace,baseline.id);assert(view.rows.every(r=>r.classification==='PREEXISTING'));
 await writeFile(join(workspace,'before.txt'),'user edit\nagent edit\n');await writeFile(join(workspace,'a.txt'),'during\n');await writeFile(join(workspace,'空间 [x].txt'),'中文\n新内容\n');await unlink(join(workspace,'remove.txt'));
 await writeFile(join(workspace,'new.txt'),'new\n');
 view=await manager.inspect(workspace,baseline.id);const byPath=Object.fromEntries(view.rows.map(r=>[r.path,r]));
 assert.equal(byPath['untracked.txt'].classification,'PREEXISTING');assert.equal(byPath['before.txt'].classification,'DURING_TASK');assert(byPath['before.txt'].preexisting);assert.equal(byPath['a.txt'].classification,'DURING_TASK');
 let patch=await manager.patch(workspace,'before.txt',{baselineId:baseline.id,mode:'task'});assert.match(patch.text,/\+agent edit/);assert(!patch.text.includes('-old'));
 patch=await manager.patch(workspace,'before.txt',{baselineId:baseline.id,mode:'before'});assert.match(patch.text,/-old/);assert.match(patch.text,/\+user edit/);
 patch=await manager.patch(workspace,'空间 [x].txt');assert.match(patch.text,/\+新内容/);
 patch=await manager.patch(workspace,'new.txt');assert.match(patch.text,/\+new/);
 patch=await manager.patch(workspace,'remove.txt',{baselineId:baseline.id,mode:'task'});assert.match(patch.text,/-remove/);
 // Independent staged and working-tree edits must both remain visible.
 if(vcs==='git'){
  await command('add','--','a.txt');await writeFile(join(workspace,'a.txt'),'after stage\n');
  assert.match((await manager.patch(workspace,'a.txt',{mode:'staged'})).text,/\+during/);
  assert.match((await manager.patch(workspace,'a.txt',{mode:'unstaged'})).text,/-during/);
  const indexBaseline=await manager.capture(workspace);const savedWorking=await readFile(join(workspace,'a.txt'));
  await writeFile(join(workspace,'a.txt'),'different stage\n');await command('add','--','a.txt');await writeFile(join(workspace,'a.txt'),savedWorking);
  assert.equal((await manager.inspect(workspace,indexBaseline.id)).rows.find(r=>r.path==='a.txt').classification,'DURING_TASK','index content changes count even with identical working bytes and status XY');
  // Reading must not invoke a repository-configured clean filter.
  await command('config','filter.poison.clean','cmd /c echo executed>filter-executed.txt');
  await command('config','filter.poison.required','true');await writeFile(join(workspace,'.gitattributes'),'*.txt filter=poison\n');
  await manager.inspect(workspace);await assert.rejects(readFile(join(workspace,'filter-executed.txt')),e=>e.code==='ENOENT');
  await unlink(join(workspace,'.gitattributes'));await command('config','--remove-section','filter.poison');
 }else{
  await writeFile(join(workspace,'.hg/hgrc'),'[hooks]\npre-status = echo executed>hook-executed.txt\n');
  await manager.inspect(workspace);await assert.rejects(readFile(join(workspace,'hook-executed.txt')),e=>e.code==='ENOENT');
 }
 // A later commit does not silently replace the original task baseline.
 await command('add','--','new.txt');if(vcs==='git')await command('add','-u');else await command('remove','--after','remove.txt');
 await commit('during task');view=await manager.inspect(workspace,baseline.id);assert(view.rows.some(r=>r.path==='new.txt'&&r.classification==='DURING_TASK'));
 assert.match((await manager.patch(workspace,'a.txt',{baselineId:baseline.id,mode:'task'})).text,/-original/);
 await rename(join(workspace,'a.txt'),join(workspace,'renamed [x].txt'));
 view=await manager.inspect(workspace,baseline.id);assert(view.rows.some(r=>r.path==='renamed [x].txt'));assert(view.rows.some(r=>r.path==='a.txt'));
 assert.match((await manager.patch(workspace,'a.txt',{baselineId:baseline.id,mode:'task'})).text,/-original/);assert((await manager.patch(workspace,'renamed [x].txt',{baselineId:baseline.id,mode:'task'})).text.includes('+++ b/renamed [x].txt'));
 await rename(join(workspace,'renamed [x].txt'),join(workspace,'a.txt'));
 // Binary, oversize, links and traversal never produce arbitrary file contents.
 await writeFile(join(workspace,'binary.bin'),Buffer.from([0,1,2]));assert.equal((await manager.patch(workspace,'binary.bin')).reason,'BINARY');
 await writeFile(join(workspace,'large.txt'),Buffer.alloc(2*1024*1024+1,65));assert.equal((await manager.patch(workspace,'large.txt')).reason,'INCOMPLETE');
 const outside=join(root,vcs+'-outside');await mkdir(outside);await writeFile(join(outside,'secret.txt'),'DO_NOT_READ');await symlink(outside,join(workspace,'external'),process.platform==='win32'?'junction':'dir');
 assert.equal((await workingFile(await discoverRepository(workspace),'external/secret.txt')).reason,'LINK');
 for(const bad of ['../secret','.git/config','foo/.hg/hgrc','C:/secret','a\\b','x:stream'])assert.equal(validRepoPath(bad),false);
 await assert.rejects(manager.patch(workspace,'../secret'),{code:'PATH'});
 const partial=await manager.capture(workspace);assert.equal(partial.coverage,'PARTIAL');assert((await manager.inspect(workspace,partial.id)).rows.every(r=>r.classification==='UNKNOWN'));
 const reboot=new ChangeReview(home);assert((await reboot.list(workspace)).items.some(r=>r.id===baseline.id));assert.match((await reboot.patch(workspace,'before.txt',{baselineId:baseline.id,mode:'before'})).text,/user edit/);
 await assert.rejects(manager.baseline({...await discoverRepository(workspace),root:outside},baseline.id),{code:'BASELINE'});
 console.log('PASS real '+vcs+': preexisting/task/committed changes, selected patches, literal Unicode path, bounded/binary/link reads, cold baseline, config execution suppressed');
}
// Bounded retention prunes only owned baseline files and preserves unrelated data.
const retentionHome=join(root,'retention');const retention=new ChangeReview(retentionHome);await mkdir(retention.dir,{recursive:true});
for(let i=0;i<33;i++)await writeFile(join(retention.dir,crypto.randomUUID()+'.json'),'{}');await writeFile(join(retention.dir,'user-notes.txt'),'keep');await retention.prune();assert.equal((await readdir(retention.dir)).filter(p=>p.endsWith('.json')).length,30);assert.equal(await readFile(join(retention.dir,'user-notes.txt'),'utf8'),'keep');
// The awaited native hook has no automatic default and never modifies model messages.
const handlers={},home=join(root,'hook-home');await mkdir(home);const workspace=join(root,'git 中文 workspace');
const integration=installChangeReview({on:(name,fn)=>{handlers[name]=fn;}},home),decision={kind:'enter',messages:[{content:'fixture'}]},signal=new AbortController().signal;
let captures=0;integration.manager.capture=async(_cwd,meta)=>{assert.equal(meta.source,'turn-start');captures++;};
const event={agent:{session:{header:{id:'fixture',cwd:workspace}}},turn:1,step:1,signal};
assert.equal(await handlers['agent/pre-step'](event,async()=>decision),decision);assert.equal(captures,0);
// Enable through the actual same-origin endpoint, then run a later turn twice.
async function request(route,body,origin='http://127.0.0.1:9'){
 const req={method:'POST',headers:{origin,host:'127.0.0.1:9','content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
 let code,data;const res={writeHead(c){code=c;return this;},end(s){data=JSON.parse(s);}};await integration.handle(req,res,new URL('http://127.0.0.1:9/desktop-diagnostics/api/changes/'+route));return {code,data};
}
assert.equal((await request('automatic',{workspace,enabled:true},'https://elsewhere.invalid')).code,403);
assert.equal((await request('automatic',{workspace,enabled:true})).code,200);
event.turn=2;await handlers['agent/pre-step'](event,async()=>decision);await handlers['agent/pre-step'](event,async()=>decision);assert.equal(captures,1);
event.turn=3;integration.manager.capture=async()=>{throw Error('disk failure');};assert.equal(await handlers['agent/pre-step'](event,async()=>decision),decision,'capture failure must not reject the actual task');
assert.equal((await request('automatic',{workspace,enabled:false})).code,200);
console.log('PASS native hook contract: opt-in, awaited before first step, per-turn dedup, failure containment, same-origin preference');
console.log('Evidence:',root);if(!protocols.includes('hg'))console.log('Hg executable integration SKIPPED; run with --hg using isolated Mercurial test venv.');
