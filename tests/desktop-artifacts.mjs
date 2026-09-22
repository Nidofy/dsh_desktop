import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,rename,symlink,readFile,readdir} from 'node:fs/promises';
import {PassThrough} from 'node:stream';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {DesktopArtifacts,artifactPath} from '../runtime-src/desktop-artifacts.mjs';
import {foldArtifacts} from '../runtime-src/artifacts-integration.mjs';
import {artifactsScript} from '../runtime-src/artifacts-page.mjs';
import {ProjectActions,validateActionConfig} from '../runtime-src/project-actions.mjs';
new vm.Script(artifactsScript);await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/artifacts-')),workspace=join(root,'中文 workspace'),home=join(root,'home'),outside=join(root,'outside');await mkdir(workspace);await mkdir(outside);
await writeFile(join(workspace,'报告.csv'),'a,b\r\n1,2\r\n');await writeFile(join(workspace,'danger.exe'),'not executable fixture');await writeFile(join(workspace,'empty.txt'),'');await writeFile(join(outside,'secret.txt'),'DO_NOT_OPEN');
let now=1000,calls=[];const manager=new DesktopArtifacts(home,{now:()=>now,openNative:async(...args)=>calls.push(args)});
const entry=await manager.register(workspace,'报告.csv');assert(entry.canOpen);assert.equal((await manager.list(workspace)).length,1);assert.equal(calls.length,0);
await manager.action(entry.id,'open');assert.equal(calls.length,1);assert.equal(calls[0][1],'open');assert(calls[0][0].endsWith('报告.csv'));
const binary=await manager.register(workspace,'danger.exe');assert(!binary.canOpen);assert(binary.canSave);await assert.rejects(manager.action(binary.id,'open'),{code:'OPEN_TYPE'});await manager.action(binary.id,'reveal');assert.equal(calls.length,2);
for(const path of ['../secret.txt','C:/secret.txt','file:secret','.git/config','x/../secret','x\\secret','x:stream','NUL.txt','dir./a','folder/CON','//host/file']){assert(!artifactPath(path),path);await assert.rejects(manager.register(workspace,path));}
await symlink(outside,join(workspace,'external'),process.platform==='win32'?'junction':'dir');await assert.rejects(manager.register(workspace,'external/secret.txt'),{code:'LINK'});
await writeFile(join(workspace,'报告.csv'),'changed\n');await assert.rejects(manager.action(entry.id,'open'),{code:'CHANGED'});assert.equal(calls.length,2);
const fresh=await manager.register(workspace,'报告.csv');assert.notEqual(fresh.id,entry.id);const empty=await manager.register(workspace,'empty.txt');
const pending=[];const server=http.createServer(async(req,res)=>{try{
 if(req.url.slice(1)===fresh.id){const original=res.writeHead;res.writeHead=function(...args){if(args[0]===200)writeFileSync(join(workspace,'报告.csv'),'overwritten by destination selection');return original.apply(this,args);};}
 const task=manager.download(req.url.slice(1),res,new AbortController().signal);pending.push(task.catch(()=>{}));await task;
}catch(error){if(!res.headersSent)res.writeHead(400).end(error.code);else res.destroy();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
try{let response=await fetch(base+'/'+fresh.id);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8/);assert.equal(await response.text(),'changed\n');response=await fetch(base+'/'+empty.id);assert.equal(response.headers.get('content-length'),'0');assert.equal(await response.text(),'');response=await fetch(base+'/../../outside/secret.txt');assert.equal(response.status,400);now+=600001;await assert.rejects(manager.action(fresh.id,'reveal'),{code:'EXPIRED'});}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));await Promise.all(pending);}
assert.equal(manager.downloads,0);assert.equal(manager.stagingBytes,0);assert.equal(await readFile(join(workspace,'报告.csv'),'utf8'),'overwritten by destination selection','snapshot transfer remains original bytes even if the save destination replaces the source after headers');
assert.equal((await readdir(join(home,'desktop-artifact-exports'))).length,0,'completed transfer removes its temporary copy');
const cancelledEntry=await manager.describe(workspace,'报告.csv'),controller=new AbortController(),sink=new PassThrough();sink.writeHead=()=>{controller.abort();return sink;};
await assert.rejects(manager.download(cancelledEntry.id,sink,controller.signal));assert.equal(manager.downloads,0);assert.equal(manager.stagingBytes,0);assert.equal((await readdir(join(home,'desktop-artifact-exports'))).length,0,'cancelled transfer closes and removes its temporary copy');
const reboot=new DesktopArtifacts(home);assert.equal((await reboot.list(workspace)).length,3);assert.equal(calls.length,2,'cold list cannot open apps');
await rename(join(workspace,'danger.exe'),join(workspace,'moved.exe'));assert((await reboot.list(workspace)).some(r=>r.path==='danger.exe'&&!r.available));
let state={items:[],truncated:false,ignoreBefore:10};state=foldArtifacts(state,{type:'deliverables/presented',seq:2,time:100,data:{turn:1,files:[{path:'inherited.txt'}]}});assert.equal(state.items.length,0);
state=foldArtifacts(state,{type:'deliverables/presented',seq:11,time:100,data:{turn:1,files:Array.from({length:120},(_,i)=>({path:i+'.txt'}))}});assert.equal(state.items.length,100);assert(state.truncated);
const config={schemaVersion:1,actions:[{id:'build',label:'Build',command:'fixture',artifacts:['报告.csv'],cwd:'.'}]};assert.deepEqual(validateActionConfig(config).actions[0].artifacts,['报告.csv']);assert.throws(()=>validateActionConfig({...config,actions:[{...config.actions[0],artifacts:['../outside']}]}));
const actions=new ProjectActions(join(root,'actions'),async()=>({exitCode:0,stdout:{text:'build log'},stderr:{text:''}}));let view=await actions.save(workspace,config);await actions.trust(workspace,view.fingerprint);const run=await actions.start(workspace,'build');const result=await actions.wait(workspace,run.id);assert.equal(result.status,'PASS');assert.deepEqual(result.artifacts,['报告.csv']);assert.match(await actions.log(workspace,run.id),/build log/);view=await actions.save(workspace,{...config,actions:[{...config.actions[0],artifacts:['other.csv']}]});assert(!view.trusted,'artifact declarations are in configuration trust fingerprint');await actions.close();
console.log('PASS artifacts: controlled paths, no automatic launch, open allowlist, changed/expired references, binary/empty download, persistent registration, native delivery projection, Project Actions association/trust');console.log('Evidence:',root);
