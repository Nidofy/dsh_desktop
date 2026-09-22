import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {StorageAdmission,storageAdmission} from '../runtime-src/storage-admission.mjs';
import {snapshotPipe} from '../runtime-src/task-snapshot-bridge.mjs';
import {ProjectActions,writeAtomic} from '../runtime-src/project-actions.mjs';
import {SelfTestRun,SelfTestStore} from '../runtime-src/self-test.mjs';
import {CacheProbe} from '../runtime-src/cache-probe.mjs';
await mkdir('.build',{recursive:true});const home=await mkdtemp(resolve('.build/storage-admission-'));
class Pipe {
  rows=new Map();allow=true;failAfterGrant=false;releaseFailures=0;
  async request(command,options={}){
    if(command.action==='releaseStorage'){if(this.releaseFailures-->0)throw Error('lost release');this.rows.delete(command.reservationId);return {status:'RELEASED'};}
    assert.equal(command.action,'reserveStorage');if(!this.allow)throw Error('full');
    this.rows.set(options.requestId,command.bytes);if(this.failAfterGrant)throw Error('lost grant');
    return {status:'RESERVED',reservationId:options.requestId};
  }
}
const pipe=new Pipe(),admission=new StorageAdmission(pipe);admission.configure(true,home);
const path=join(home,'desktop-measurements','a.json');
assert(!admission.managed(join(home,'sessions','native.json')));assert(!admission.managed(join(home,'..','desktop-measurements','a')));
let writes=0;pipe.allow=false;await assert.rejects(admission.write(path,20,async()=>{writes++;}));assert.equal(writes,0);assert.equal(pipe.rows.size,0);
pipe.allow=true;pipe.failAfterGrant=true;await assert.rejects(admission.acquire(path,20));assert.equal(pipe.rows.size,0,'uncertain grant is explicitly released');pipe.failAfterGrant=false;
const lease=await admission.acquire(path,50);pipe.allow=false;
await lease.run(async()=>{for(const bytes of [-1,0,NaN,Infinity,1.5])await assert.rejects(admission.write(path,bytes,async()=>{writes++;}));});
await lease.run(async()=>{await admission.write(path,20,async()=>{writes++;});await admission.write(path,20,async()=>{writes++;});await assert.rejects(admission.write(path,20,async()=>{writes++;}));});
assert.equal(writes,2);pipe.releaseFailures=1;await lease.release();assert.equal(pipe.rows.size,0);
await assert.rejects(lease.run(()=>admission.write(path,1,async()=>{})),{code:'STORAGE_RESERVATION_EXPIRED'});
pipe.allow=true;const finalLease=await admission.acquire(path,20);admission.close();await finalLease.run(()=>admission.write(path,10,async()=>{writes++;}));await finalLease.release();await assert.rejects(admission.acquire(path,1));

// Exercise actual writers under admission, including final journal writes after
// another operation consumes the remaining capacity.
snapshotPipe.request=pipe.request.bind(pipe);storageAdmission.configure(true,home);
await mkdir(join(home,'desktop-measurements'));await writeAtomic(path,'report');assert.equal(await readFile(path,'utf8'),'report');assert.equal(pipe.rows.size,0);
const work=join(home,'project');await mkdir(join(work,'.dsh'),{recursive:true});
await writeFile(join(work,'.dsh/project-actions.json'),JSON.stringify({schemaVersion:1,actions:[{id:'test',label:'test',command:'synthetic',timeoutMs:1000}]}));
let executions=0;const actions=new ProjectActions(home,async()=>{executions++;pipe.allow=false;return {exitCode:0,stdout:{text:'completion log'},stderr:{text:''}};});
const view=await actions.inspect(work);await actions.trust(work,view.fingerprint);
const run=await actions.start(work,'test');assert.equal((await actions.wait(work,run.id)).status,'PASS');assert.match(await actions.log(work,run.id),/completion log/);assert.equal(pipe.rows.size,0);
await assert.rejects(actions.start(work,'test'));assert.equal(executions,1);assert.equal((await actions.revoke(work)).trusted,false,'full quota cannot block revoking an action grant');await actions.close();

pipe.allow=true;const store=new SelfTestStore(home);let checks=0;
const selfTest=new SelfTestRun({store,local:async({check})=>{pipe.allow=false;await check('node',async()=>{checks++;});},provider:async()=>{}});
selfTest.start({mode:'local'});await selfTest.done;assert.equal(selfTest.snapshot().status,'COMPLETED');assert.equal((await store.read(selfTest.current.id)).status,'COMPLETED');assert.equal(checks,1);assert.equal(pipe.rows.size,0);
selfTest.start({mode:'local'});await selfTest.done;assert.equal(selfTest.snapshot().status,'FAILED');assert.equal(checks,1);

pipe.allow=true;let sent=0;const probeDir=join(home,'desktop-cache-probes');await mkdir(probeDir);
const probe=new CacheProbe({admit:signal=>storageAdmission.acquire(probeDir,2*1024*1024,{signal}),persist:r=>writeAtomic(join(probeDir,r.id+'.json'),JSON.stringify(r)),pause:async()=>{},prepare:async()=>{pipe.allow=false;return {configuration:{},calls:Array.from({length:4},()=>({config:{},async *stream(){sent++;yield {type:'finish',reason:{kind:'stop'}};} }))};}});
probe.start({model:'synthetic',requests:4,inputBytes:2048,accepted:true});await probe.done;assert.equal(probe.snapshot().status,'COMPLETED');assert.equal(sent,4);assert.equal(pipe.rows.size,0);
probe.start({model:'synthetic',requests:4,inputBytes:2048,accepted:true});await probe.done;assert.equal(probe.snapshot().status,'REFUSED');assert.equal(sent,4);
console.log('PASS storage admission: uncertain grant/release, refusal before effects, cumulative bounds, shutdown final writes, action log and self-test/probe final persistence under full quota');
