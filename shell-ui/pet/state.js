export const bubbles={WAITING_PERMISSION:'需要你的确认',WAITING_INPUT:'等待你的输入',BLOCKED:'任务需要处理',LIMIT_REACHED:'任务需要处理',COMPLETED:'本轮任务已结束',FAILED:'本轮执行遇到问题',UNKNOWN:'状态待确认',INTERRUPTED:'状态待确认'};
export function priority(row,now,duration=5000){return /^WAITING_/.test(row.status)?5:['BLOCKED','LIMIT_REACHED'].includes(row.status)?4:['FAILED','COMPLETED'].includes(row.status)&&row.notify===true&&now-row.at<duration?3:row.status==='RUNNING'?2:0;}
export class Presentation {
 constructor(now=Date.now){this.now=now;this.frame=null;this.row=null;this.reaction=null;this.heldUntil=0;this.settings={};this.watermark=0;}
 settingsChanged(s){this.settings=s;this.select();}
 accept(frame){
  if(this.frame?.generation===frame.generation&&frame.revision<this.watermark)return false;
  const fresh=this.frame?.generation!==frame.generation||this.frame?.profile!==frame.profile;
  if(fresh){this.reaction=null;this.watermark=frame.revision;this.row=null;}
  const previous=this.watermark,previousSession=this.row?.sessionId;this.frame=frame;this.select();
  if(this.reaction?.kind==='task'&&(this.row?.status==='CANCELLED'||previousSession&&this.row?.sessionId!==previousSession))this.reaction=null;
  if(this.row&&/^WAITING_/.test(this.row.status)&&this.row.revision>previous)this.reaction=null;
  else if(!fresh&&this.row?.source==='live'&&this.row.revision>previous&&this.row.reaction&&this.now()-this.row.at<5000)this.reaction={id:this.row.reaction,at:this.now(),kind:'task'};
  this.watermark=Math.max(this.watermark,frame.revision??0);return true;
 }
 select(){
  const rows=this.frame?.items??[],now=this.now(),rank=r=>priority(r,now,this.settings.bubble?.durationMs??5000);
  const pinned=this.settings.profile===this.frame?.profile?rows.find(r=>r.sessionId===this.settings.pinned):null;
  const candidates=rows.filter(r=>rank(r)>0).sort((a,b)=>rank(b)-rank(a)||b.at-a.at||a.sessionId.localeCompare(b.sessionId));
  const old=rows.find(r=>r.sessionId===this.row?.sessionId),best=pinned??candidates[0]??null;
  this.row=!pinned&&old&&this.heldUntil>now&&rank(old)>=rank(best??{})?old:best;
  if(this.row?.sessionId!==old?.sessionId)this.heldUntil=now+1000;
 }
 interact(id='waving'){if(this.reaction?.kind==='task'||this.now()-(this.lastInteraction??-Infinity)<500)return;this.lastInteraction=this.now();this.reaction={id,at:this.now(),kind:'interaction'};}
 animation(){this.select();return this.drag??this.reaction?.id??(/^WAITING_/.test(this.row?.status)||['BLOCKED','LIMIT_REACHED'].includes(this.row?.status)?'waiting':this.row?.status==='RUNNING'?'running':'idle');}
  bubble(){const row=this.row;if(!row||row.suppressNotice)return '';return ['COMPLETED','FAILED'].includes(row.status)&&(!row.notify||this.now()-row.at>=(this.settings.bubble?.durationMs??5000))?'':bubbles[row.status]??'';}
 target(){return this.row?{sessionId:this.row.sessionId,profile:this.frame.profile,generation:this.frame.generation,port:this.frame.port}:null;}
}
