import test from 'node:test';import assert from 'node:assert/strict';
import {desktopControl,installDesktopControl} from '../runtime-src/desktop-control.mjs';
import {DragQueue} from '../shell-ui/pet/drag.js';
test('private control observes all native queues/approvals and cancellation is not completion',async()=>{
 const agents=[{status:'running',inbox:{nextTurn:[{}],nextStep:[]},session:{},cancel(c){assert.deepEqual(c,{kind:'user'});this.requested=true;}},{status:'idle',inbox:{nextTurn:[],nextStep:[{}]},session:{},cancel(){this.requested=true;}}];
 let disposed;const jobs=new Map([['job',{controller:new AbortController()}]]);
 const ctx={get:n=>n==='agents'?{list:()=>agents}:n==='sessionProjections'?{stateOf:()=>({pendingApprovals:['x']})}:null,effect:f=>{disposed=f();}};
 installDesktopControl(ctx,Promise.resolve({manager:{jobs}}));await Promise.resolve();
 const read=async action=>{let value;await desktopControl(JSON.stringify({id:'a'.repeat(32),action}),s=>{value=JSON.parse(s.slice(13));});return value;};
 assert.deepEqual(await read('status'),{id:'a'.repeat(32),known:true,running:1,queued:2,waiting:1,actions:1,checks:0,admission:'unsupported'});
 assert.equal((await read('cancel')).running,1);assert.ok(agents.every(a=>a.requested));assert.ok(jobs.get('job').controller.signal.aborted);
 disposed();assert.equal((await read('status')).known,false);let sent=false;await desktopControl('{"id":"wrong","action":"cancel"}',()=>sent=true);assert.equal(sent,false);
});
test('drag serializes start/moves/end and coalesces pointer flood',async()=>{
 const calls=[],gates=[];const q=new DragQueue(action=>{calls.push(action);return new Promise(r=>gates.push(r));});
 q.start();for(let i=0;i<1000;i++)q.move();q.finish();assert.deepEqual(calls,['drag']);
 gates.shift()();await new Promise(setImmediate);assert.deepEqual(calls,['drag','drag-move']);
 gates.shift()();await new Promise(setImmediate);assert.deepEqual(calls,['drag','drag-move','drag-end']);
 gates.shift()();await new Promise(setImmediate);assert.equal(q.active,false);
 q.start();assert.equal(calls.at(-1),'drag');gates.shift()();await new Promise(setImmediate);gates.shift()();q.finish();await new Promise(setImmediate);gates.shift()();
});
test('drag failure clears active gesture without endless retries',async()=>{let errors=0;const q=new DragQueue(async()=>{throw Error('gone');},()=>errors++);q.start();await new Promise(setImmediate);assert.equal(q.active,false);assert.equal(errors,1);q.move();assert.equal(errors,1);});
test('pointer-down anchors before threshold and taps never move the window',async()=>{const calls=[];let ended=0;const q=new DragQueue(async a=>calls.push(a),()=>{},()=>ended++);q.prepare();await new Promise(setImmediate);assert.deepEqual(calls,['drag']);q.finish();await new Promise(setImmediate);assert.deepEqual(calls,['drag','drag-end']);assert.equal(ended,1);q.prepare();await new Promise(setImmediate);q.start();await new Promise(setImmediate);q.finish();await new Promise(setImmediate);assert.deepEqual(calls.slice(2),['drag','drag-move','drag-end']);});
test('fast drags retain pointer-down anchor while native IPC is pending',async()=>{let release;const calls=[];const q=new DragQueue((a,p)=>{calls.push([a,p]);if(a==='drag')return new Promise(r=>release=r);return Promise.resolve();});q.prepare({x:100,y:80});q.start();q.move();q.finish();assert.deepEqual(calls,[['drag',{x:100,y:80}]]);release();await new Promise(setImmediate);assert.deepEqual(calls.map(c=>c[0]),['drag','drag-move','drag-end']);});
