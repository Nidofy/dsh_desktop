import test from 'node:test';import assert from 'node:assert/strict';
import {PetFeed} from '../runtime-src/pet-state.mjs';
import {Presentation} from '../shell-ui/pet/state.js';
const row=(status,seq)=>({status,turn:1,seq});
test('bounded minimal projection rejects reordered events and snapshot races',()=>{
 const f=new PetFeed(()=>100,'epoch');f.accept('a',row('WAITING_INPUT'),10,{live:true});f.accept('a',row('RUNNING'),9);assert.equal(f.snapshot().items[0].status,'WAITING_INPUT');
 f.accept('a',{status:'RUNNING',title:'PRIVATE',lastTool:{name:'PRIVATE'},turn:1},11);assert(!JSON.stringify(f.snapshot()).includes('PRIVATE'));
 for(let i=0;i<80;i++)f.accept('s'+i,row('RUNNING'),1);assert.equal(f.snapshot().items.length,32);
});
test('wait survives interaction and new wait cancels a celebration; cancellation silent',()=>{
 let now=100;const f=new PetFeed(()=>now,'e'),m=new Presentation(()=>now),sync=()=>m.accept({...f.snapshot(),profile:'p',port:1});sync();
 f.accept('a',row('WAITING_PERMISSION'),1,{live:true});sync();m.interact();assert.equal(m.animation(),'waving');assert.equal(m.bubble(),'需要你的确认');m.reaction=null;assert.equal(m.animation(),'waiting');
 f.accept('a',row('COMPLETED'),2,{live:true,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});sync();assert.equal(m.animation(),'jumping');
 f.accept('a',row('WAITING_INPUT'),3,{live:true});sync();assert.equal(m.animation(),'waiting');assert.equal(m.bubble(),'等待你的输入');
 f.accept('a',row('CANCELLED'),4,{live:true,event:{type:'turn/end',data:{reason:{kind:'aborted'}}}});sync();assert.equal(m.animation(),'idle');assert.equal(m.bubble(),'');
});
test('cold reads and child completion do not replay transient art',()=>{
 const f=new PetFeed(()=>100,'e');f.accept('a',row('COMPLETED'),2,{live:true,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});const m=new Presentation(()=>100);m.accept(f.snapshot());assert.equal(m.animation(),'idle');
 f.accept('a',row('COMPLETED'),3,{live:true,subagent:true,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});m.accept(f.snapshot());assert.equal(m.animation(),'idle');
});
test('pin identity, priority, expiry, revision and engine isolation',()=>{
 let now=100;const f=new PetFeed(()=>now,'e'),m=new Presentation(()=>now);f.accept('a',row('RUNNING'),1);f.accept('b',row('WAITING_INPUT'),2);
 m.settingsChanged({pinned:'a',profile:'p'});m.accept({...f.snapshot(),profile:'p'});assert.equal(m.row.sessionId,'a');
 m.settingsChanged({});assert.equal(m.row.sessionId,'b');assert.equal(m.accept({generation:'e',revision:0,items:[]}),false);
 m.accept({generation:'new',profile:'other',revision:0,items:[]});assert.equal(m.row,null);
});
test('repeated waiting snapshot preserves interaction; a new wait still interrupts it',()=>{const m=new Presentation(()=>100);const f={generation:'g',revision:1,items:[{sessionId:'s',status:'WAITING_INPUT',revision:1,at:0}]};m.accept(f);m.interact('pat');m.accept(f);assert.equal(m.animation(),'pat');assert.equal(m.bubble(),'等待你的输入');m.accept({...f,revision:2,items:[{...f.items[0],status:'WAITING_PERMISSION',revision:2}]});assert.equal(m.animation(),'waiting');assert.equal(m.bubble(),'需要你的确认');});
test('unrelated native events never refresh an old completion timer or turn a cold read into a notice',()=>{let now=100;const f=new PetFeed(()=>now,'e');f.accept('a',{status:'COMPLETED',turn:1},3);now=10000;f.accept('a',{status:'COMPLETED',turn:1},4,{live:true,event:{type:'session/title'}});assert.equal(f.snapshot().items[0].at,100);assert.equal(f.snapshot().items[0].notify,false);f.accept('a',{status:'RUNNING',turn:2},5,{live:true});f.accept('a',{status:'COMPLETED',turn:2},6,{live:true,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});now=20000;f.accept('a',{status:'COMPLETED',turn:2},7,{live:true,event:{type:'session/title'}});assert.equal(f.snapshot().items[0].at,10000);});
test('cancellation or task reassignment immediately ends an old task reaction',()=>{for(const pinned of [false,true]){const m=new Presentation(()=>100),f=new PetFeed(()=>100,'g');if(pinned)m.settingsChanged({pinned:'s',profile:'p'});const sync=()=>m.accept({...f.snapshot(),profile:'p'});sync();f.accept('s',{status:'RUNNING',turn:1},1,{live:true,event:{type:'turn/start'}});sync();assert.equal(m.animation(),'waving');f.accept('s',{status:'CANCELLED',turn:1},2,{live:true,event:{type:'turn/end',data:{reason:{kind:'aborted'}}}});sync();assert.equal(m.animation(),'idle');assert.equal(m.bubble(),'');}});
