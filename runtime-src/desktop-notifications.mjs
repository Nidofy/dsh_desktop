import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {writeAtomic} from './project-actions.mjs';

// Live events only. Native Session constructor replay does not publish on this
// stream, so opening/recovering old sessions cannot replay desktop alerts.
export class NotificationFeed {
  constructor(now=Date.now){this.now=now;this.revision=0;this.rows=[];this.seen=new Map();this.enabled=true;}
  event(session,event){
    const id=session.header.id;
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!Number.isSafeInteger(event.seq))return;
    if(event.seq<=(this.seen.get(id)??-1))return;
    this.seen.delete(id);this.seen.set(id,event.seq);
    if(this.seen.size>512)this.seen.delete(this.seen.keys().next().value);
    const d=event.data??{};
    const clear=predicate=>{this.rows=this.rows.filter(row=>row.sessionId!==id||!predicate(row));};
    if(event.type==='turn/start'||event.type==='turn/end')clear(()=>true);
    if(event.type==='approval/decided')clear(row=>row.kind==='permission'&&row.pendingId===d.id);
    if(event.type==='tool/result'){
      const ids=d.message?.content?.map(block=>block.toolCallId)??[];
      clear(row=>row.kind==='input'&&ids.includes(row.pendingId));
    }
    let kind,pendingId;
    if(event.type==='approval/asked'){kind='permission';pendingId=d.id;}
    if(event.type==='tool/call'&&d.name==='ask_user_question'){kind='input';pendingId=d.callId;}
    if(event.type==='turn/end'&&session.header.origin!=='subagent')kind={completed:'completed',error:'failed',blocked:'attention','max-tokens':'attention'}[d.reason?.kind];
    if(!kind||!this.enabled)return;
    // Never retain arbitrary commands, questions, titles, workspaces or results.
    if(typeof pendingId!=='string'||pendingId.length>256)pendingId=undefined;
    this.rows.push({revision:++this.revision,sessionId:id,kind,time:this.now(),pendingId});
    this.rows=this.rows.slice(-32);
  }
  snapshot(after=0){
    this.rows=this.rows.filter(row=>this.now()-row.time<120000);
    return {revision:this.revision,enabled:this.enabled,items:this.enabled?this.rows.filter(row=>row.revision>after).map(({pendingId,...row})=>row):[]};
  }
}

export function installNotifications(ctx,home){
  const feed=new NotificationFeed(),path=join(home,'desktop-notifications.json');
  let warning=null,loaded=false,writing=Promise.resolve();
  const ready=(async()=>{
    try{const raw=await readFile(path,'utf8');if(raw.length>1024)throw Error();const value=JSON.parse(raw);if(value.version!==1||typeof value.enabled!=='boolean')throw Error();feed.enabled=value.enabled;}
    catch(error){if(error.code!=='ENOENT'){feed.enabled=false;warning='通知偏好无法读取，提醒暂已关闭；重新保存可修复。';}}
    loaded=true;
  })();
  ctx.on('session/event',(session,event)=>{if(loaded)feed.event(session,event);});
  return {
    async snapshot(after=0){await ready;return {...feed.snapshot(after),warning};},
    async save(enabled){
      await ready;if(typeof enabled!=='boolean')throw Error('Invalid preference');
      const commit=writing.catch(()=>{}).then(async()=>{
        await mkdir(home,{recursive:true});await writeAtomic(path,JSON.stringify({version:1,enabled}));
        feed.enabled=enabled;feed.rows=[];warning=null;
      });writing=commit;await commit;
      return {enabled:feed.enabled,warning};
    }
  };
}
