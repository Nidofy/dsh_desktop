import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
import {ChangeDrafts,patchHash} from '../runtime-src/change-draft.mjs';
const root=await mkdtemp(resolve('.build/change-draft-')),workspace=join(root,'repo'),other=join(root,'other');
await mkdir(join(workspace,'.git'),{recursive:true});await mkdir(join(other,'.hg'),{recursive:true});
let clock=0,text='--- before\n+++ after\n-old\n+new 中文\n',disposed=0;
const headers={task:{id:'task',cwd:workspace,createdAt:2},outside:{id:'outside',cwd:other,createdAt:1}};
const query={async observeSession(id){if(!headers[id])throw Error();return {header:headers[id],[Symbol.dispose](){disposed++;}};},async listSessions(){return Object.values(headers).map(header=>({header}));},async readTitle(){return {title:'Synthetic'};}};
const manager=new ChangeDrafts({manager:{async patch(){return {text};}},query:()=>query,now:()=>clock});
const body={workspace,sessionId:'task',path:'a.cpp',mode:'repository',baselineId:null,hash:patchHash(text),start:text.indexOf('+new'),end:text.length};
assert.equal((await manager.sessions(workspace)).items.length,1);
await assert.rejects(manager.stage({...body,sessionId:'outside'}),/不属于/);
await assert.rejects(manager.stage({...body,hash:'0'.repeat(64)}),/已变化/);
await assert.rejects(manager.stage({...body,start:-1}),/有效片段/);
const {ticket}=await manager.stage(body);assert.equal(manager.status(ticket).status,'PENDING');
const claims=await Promise.all([manager.claim(ticket,'client-a'),manager.claim(ticket,'client-b')]);assert.equal(claims.filter(Boolean).length,1);
assert(claims[0].text.includes('+new 中文'));assert(!claims[0].text.includes('-old'));
assert.equal(manager.status(ticket).status,'UNKNOWN');assert.equal(manager.settle(ticket,'client-b','APPENDED'),false);
assert(manager.settle(ticket,'client-a','APPENDED'));assert.equal(manager.status(ticket).status,'APPENDED');assert.equal(await manager.claim(ticket,'client-a'),null);
const expired=await manager.stage(body);clock+=120001;assert.equal(manager.status(expired.ticket).status,'EXPIRED');assert.equal(await manager.claim(expired.ticket,'client-a'),null);
const cancelled=await manager.stage(body);assert.equal(manager.cancel(cancelled.ticket).status,'REFUSED');assert.equal(await manager.claim(cancelled.ticket,'client-a'),null);
const changed=text;text+='late edit\n';await assert.rejects(manager.stage(body),/已变化/);text=changed;
clock+=120001;
for(let i=0;i<16;i++)await manager.stage(body);await assert.rejects(manager.stage(body),/过多/);manager.dispose();assert(disposed>0);

// Exercise the shipped browser module against the public native faces, including
// reference-chip detect coordinates, existing text, attachments and CAS refusal.
let apply,channel,dispose,statuses=[],opened=[],focus=0,insertions=0,blocked=false,cas=true,phase='plain';
let snapshot={draft:'existing @[File](ref)',draftRev:4,occurrences:[{length:12}],attachmentIds:['attachment-a'],phase};
const input={state:{getSnapshot:()=>({...snapshot,phase})},notify(){}};
const scope={bail(event,request){assert.equal(event,'slash/input-insert-text');assert.equal(request.span.start,10);assert.equal(request.span.end,10);assert.equal(request.span.draftRev,4);assert.equal(request.text,'\n\nselected diff');if(cas){insertions++;snapshot={...snapshot,draft:snapshot.draft+request.text};return true;}}};
vm.runInNewContext(await readFile('runtime-src/desktop-client/client.js','utf8'),{crypto,AbortSignal,window:{__ModuleLoader__:{load(d){apply=d.factory().apply;}},addEventListener(){},removeEventListener(){}},BroadcastChannel:class{constructor(){channel=this;}close(){}postMessage(){}},async fetch(url,opt){if(url.endsWith('/claim'))return {ok:true,json:async()=>({sessionId:'task',text:'selected diff'})};if(url.endsWith('/settle'))statuses.push(JSON.parse(opt.body).status);else if(url.endsWith('/focus'))focus++;return {ok:true};}});
apply({uiWorkspace:{openSession(id){opened.push(id);}},sessions:{list:{getSnapshot:()=>({ids:['task']})},async refresh(){},scope:()=>scope},conversation:{input:{for:()=>input},blocks:{storeFor:()=>({getSnapshot:()=>blocked})}},effect(fn){dispose=fn();}});
const send=async()=>{channel.onmessage({data:{type:'insert-diff',ticket:'11111111-1111-1111-1111-111111111111'}});await new Promise(setImmediate);};
await send();assert.equal(statuses.at(-1),'APPENDED');assert.equal(insertions,1);assert(snapshot.draft.startsWith('existing @[File](ref)'));assert.deepEqual(snapshot.attachmentIds,['attachment-a']);assert.deepEqual(opened,['task']);assert.equal(focus,1);
phase='claimed';await send();assert.equal(statuses.at(-1),'REFUSED');phase='plain';blocked=true;await send();assert.equal(insertions,1);blocked=false;cas=false;snapshot.draft='existing @[File](ref)';await send();assert.equal(statuses.at(-1),'REFUSED');assert.equal(insertions,1);dispose();
console.log('PASS selected diff: repository-bound target, stale preview refusal, selected-only payload, exclusive claim, unknown receipt, expiry/quota, native CAS append with chips/attachments retained, blocked composer refusal');
