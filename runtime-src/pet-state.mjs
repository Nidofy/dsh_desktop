import {randomUUID} from 'node:crypto';
import {recoveryKey,recoveryView} from './task-recovery.mjs';
export const validPetSession=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
const states=new Set(['IDLE','RUNNING','WAITING_PERMISSION','WAITING_INPUT','COMPLETED','CANCELLED','BLOCKED','FAILED','LIMIT_REACHED','INTERRUPTED','UNKNOWN']);
// Contains only a minimal projection. No messages, titles, paths or tool data.
export class PetFeed {
  constructor(now=Date.now,generation=randomUUID()){this.now=now;this.generation=generation;this.revision=0;this.rows=new Map();this.floor=0;}
  accept(id,state,seq,{live=false,subagent=false,event}={}){
    if(!validPetSession(id)||!Number.isSafeInteger(seq)||!states.has(state.status))return;
    const old=this.rows.get(id);if(old&&seq<old.seq)return;
    if(old&&seq===old.seq&&old.status===state.status)return;
    const reaction=live&&event?.type==='turn/end'&&!subagent?{completed:'jumping',error:'failed'}[event.data?.reason?.kind]:live&&event?.type==='turn/start'?'waving':null;
    const unchanged=old&&old.status===state.status&&old.turn===(state.turn??null);
    const row={sessionId:id,seq,turn:state.turn??null,status:state.status,revision:++this.revision,source:live?'live':'snapshot',notify:unchanged?old.notify:live&&!subagent,reaction:reaction??null,at:unchanged?old.at:this.now()};
    this.rows.delete(id);this.rows.set(id,row);
    if(this.rows.size>32){this.rows.delete(this.rows.keys().next().value);this.floor=this.revision;}
  }
  snapshot(after=0,generation=this.generation){const full=!Number.isSafeInteger(after)||after<=this.floor||after>this.revision||generation!==this.generation;return {generation:this.generation,revision:this.revision,full,items:[...this.rows.values()].filter(r=>full||r.revision>after)};}
}
export function installPetState(ctx){
  let feed=new PetFeed(),enabledUntil=0,cold=false,loading=null;
  const running=id=>ctx.get('agents')?.get(id)?.status==='running';
  const capture=(session,event)=>{try{const snap=ctx.get('sessionProjections')?.snapshot(session,[recoveryKey]),state=snap?.values[recoveryKey];if(state)feed.accept(session.header.id,recoveryView(state,running(session.header.id)),snap.asOfSeq,{live:!!event,subagent:session.header.origin==='subagent',event});}catch{/* Read-side failure never affects committed events. */}};
  ctx.on('session/event',(session,event)=>{if(Date.now()<enabledUntil)capture(session,event);});
  return {async snapshot(after=0,generation){
    if(enabledUntil&&Date.now()>enabledUntil){feed=new PetFeed();cold=false;loading=null;}
    enabledUntil=Date.now()+5000;
    for(const agent of (ctx.get('agents')?.list()??[]).slice(0,32))capture(agent.session);
    if(!cold&&!loading&&ctx.get('sessionQuery'))loading=(async()=>{
      const target=feed,signal=AbortSignal.timeout(3000),query=ctx.get('sessionQuery');
      const records=(await query.listSessions(signal)).sort((a,b)=>b.header.createdAt-a.header.createdAt).slice(0,32);
      for(const record of records){let observation;try{observation=await query.observeSession(record.header.id,{signal,projectionMode:'all'});const state=observation.projections?.values[recoveryKey];if(state&&target===feed)target.accept(record.header.id,recoveryView(state,running(record.header.id)),observation.projections.asOfSeq,{subagent:record.header.origin==='subagent'});}catch{}finally{observation?.[Symbol.dispose]();}}
      if(target===feed)cold=true;
    })().catch(()=>{}).finally(()=>{loading=null;});
    // Live rows are returned immediately. Cold snapshots merge by native seq.
    return feed.snapshot(after,generation);
  }};
}
