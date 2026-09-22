import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const listeners=new Map(),calls=[],opened=[],replies=[];let apply,dispose,channel,block;
const context={
 crypto,
 window:{__ModuleLoader__:{load(def){apply=def.factory().apply;}},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}},
 BroadcastChannel:class{constructor(){channel=this;}postMessage(v){replies.push(v);}close(){this.closed=true;}},
 async fetch(url,options){calls.push([url,options]);if(block){const wait=block;block=null;await wait;}return {ok:true};}
};
vm.runInNewContext(await readFile(new URL('../runtime-src/desktop-client/client.js',import.meta.url),'utf8'),context);
apply({uiWorkspace:{openSession(id){opened.push(id);}},effect(fn){dispose=fn();}});
assert.equal(calls.length,0,'plugin startup does not activate/read/send a session');
const native=listeners.get('dsh-desktop-open-session');
native({detail:{sessionId:'task-a',requestId:'n-1'}});
await new Promise(setImmediate);
assert.deepEqual(opened,['task-a']);
assert.equal(calls[0][0],'/desktop-diagnostics/api/recovery/session?id=task-a');
assert.equal(calls[1][0],'/desktop-diagnostics/api/recovery/focus');
assert.equal(replies[0].type,'opened');
native({detail:{sessionId:"');bad()//",requestId:'n-2'}});await new Promise(setImmediate);assert.equal(calls.length,2);
let release;block=new Promise(r=>release=r);
channel.onmessage({data:{type:'open-session',sessionId:'slow',requestId:'old'}});
native({detail:{sessionId:'new',requestId:'new'}});await new Promise(setImmediate);release();await new Promise(setImmediate);
assert.deepEqual(opened,['task-a','new'],'late earlier clicks cannot take navigation back');
dispose();assert(channel.closed);assert.equal(listeners.size,0);
console.log('PASS desktop client: notification/BroadcastChannel navigation, validated identities, no startup action, superseded click handling, disposal');
