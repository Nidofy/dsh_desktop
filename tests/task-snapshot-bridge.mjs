import assert from 'node:assert/strict';
import {SnapshotPipe} from '../runtime-src/task-snapshot-bridge.mjs';
import {installTaskSnapshots} from '../runtime-src/task-snapshot-integration.mjs';
const pause = ms => new Promise(r=>setTimeout(r,ms));
const lines=[], pipe=new SnapshotPipe(line=>lines.push(JSON.parse(line.slice(14))));
assert.deepEqual(await pipe.request({action:'begin'}),{status:'DISABLED'});
pipe.configure({token:'a'.repeat(32),engineId:'b'.repeat(32)});
const pending=pipe.request({action:'begin'},{timeoutMs:1000});
assert.equal(lines[0].token,'a'.repeat(32));
pipe.receive('snapshot '+JSON.stringify({id:lines[0].id,ok:true,value:{status:'CAPTURED'}}));
assert.equal((await pending).status,'CAPTURED');
const expired=pipe.request({action:'begin'},{timeoutMs:1});await assert.rejects(expired);
pipe.receive('snapshot '+JSON.stringify({id:lines.at(-1).id,ok:true,value:{status:'CAPTURED'}}));
const cancelled=new AbortController(), cancel=pipe.request({action:'begin'},{signal:cancelled.signal});cancelled.abort();await assert.rejects(cancel);
const closed=pipe.request({action:'begin'});pipe.close();await assert.rejects(closed);

function fixture() {
  const handlers={}, calls=[];let unblockEnd, failConfirm=false, disabled=false;
  const fake={enabled:true,async request(command) {
    calls.push(command);
    if(command.action==='begin') return disabled?{status:'DISABLED'}:{status:'CAPTURED',id:String(command.turn),binding:{requestId:'c'.repeat(32)}};
    if(command.action==='confirm'){if(failConfirm)throw Error('FAIL');return {status:'CONFIRMED'};}
    if(command.action==='end'){await new Promise(r=>unblockEnd=r);return {status:'SEALED'};}
    return {status:'FORGOTTEN'};
  }};
  const manager=installTaskSnapshots({on:(event,fn)=>handlers[event]=fn,effect:()=>{}},fake);
  const session={header:{id:'test-session',cwd:'C:/synthetic/work',origin:'human'}};
  const enter=turn=>handlers['agent/pre-step']({agent:{session},turn,signal:new AbortController().signal},async()=>({kind:'enter',messages:[{}]}));
  return {handlers,calls,manager,session,enter,unblock:()=>unblockEnd(),fail:()=>failConfirm=true,disable:()=>disabled=true};
}
const f=fixture();await f.enter(1);assert.deepEqual(f.calls.map(c=>c.action),['begin','confirm']);
await f.enter(1);assert.equal(f.calls.length,2,'additional tool steps never recapture');
f.handlers['session/event'](f.session,{type:'turn/end',data:{turn:1}});await pause(0);
const next=f.enter(2);await pause(0);assert.equal(f.calls.filter(c=>c.action==='begin').length,1,'next turn waits for end receipt');
f.unblock();await next;assert.deepEqual(f.calls.map(c=>c.action),['begin','confirm','end','begin','confirm']);
assert.equal(f.manager.status('test-session',1),'SEALED');
const failed=fixture();failed.fail();assert.equal((await failed.enter(1)).kind,'reject');assert.equal((await failed.enter(1)).kind,'reject');failed.handlers['session/event'](failed.session,{type:'turn/end',data:{turn:1}});await pause(0);
assert.equal(failed.manager.status('test-session',1),'UNCONFIRMED');assert(!failed.calls.some(c=>c.action==='end'));assert(failed.calls.some(c=>c.action==='abandon'));
const off=fixture();off.disable();await off.enter(1);assert.equal(off.calls.length,1);assert.equal(off.manager.status('test-session',1),'DISABLED');
const sub=fixture();sub.session.header.origin='subagent';await sub.enter(1);assert.equal(sub.calls.length,0);
console.log('PASS snapshot private pipe: bounded requests, cancellation/late reply, duplicate steps, end barrier, failed admission, disabled and subagent isolation');
