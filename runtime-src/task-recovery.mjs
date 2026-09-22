// A derived view over native committed Session events. The native log remains
// authoritative; its projection cache supplies durability and cold replay.
export const recoveryKey = 'desktopTaskRecovery';
import {createHash} from 'node:crypto';
const keep = value => typeof value === 'string' ? value.slice(0,128) : '';
const identity = value => createHash('sha256').update(typeof value==='string'?value:'').digest('hex');
export function recoveryInitial(header, inheritedEventCount = 0) {
  return {turn:null,step:null,status:'IDLE',updatedAt:header.createdAt,lastConfirmedSeq:null,
    lastModel:null,lastTool:null,pendingTools:[],pendingApprovals:[],coverage:'COMPLETE',ignoreBefore:inheritedEventCount};
}
export function recoveryFold(state, event) {
  if(event.seq < state.ignoreBefore)return state;
  const d=event.data??{},time=Number.isFinite(event.time)?event.time:state.updatedAt;
  const next=patch=>({...state,updatedAt:time,lastConfirmedSeq:event.seq,...patch});
  switch(event.type) {
    case 'turn/start': return next({turn:d.turn,step:null,status:'RUNNING',lastModel:null,lastTool:null,pendingTools:[],pendingApprovals:[],coverage:'COMPLETE'});
    case 'step/start': return next({step:d.step,lastModel:{status:'UNCONFIRMED',time,seq:event.seq}});
    case 'assistant/message': return next({lastModel:{status:d.interrupted?'INTERRUPTED':'COMPLETED',time,seq:event.seq}});
    case 'assistant/attempt': return next({lastModel:{status:'NO_MESSAGE',time,seq:event.seq}});
    case 'tool/call': {
      if(state.pendingTools.length>=64)return next({coverage:'PARTIAL'});
      return next({pendingTools:[...state.pendingTools,{id:identity(d.callId),name:keep(d.name),seq:event.seq,time}]});
    }
    case 'tool/result': {
      const result=d.message?.content?.find(b=>b.toolCallId);
      if(!result)return state;
      const id=identity(result.toolCallId),found=state.pendingTools.find(t=>t.id===id);
      return next({pendingTools:state.pendingTools.filter(t=>t.id!==id),lastTool:{name:found?.name??'unknown',status:result.isError?'FAILED':'COMPLETED',time,seq:event.seq}});
    }
    case 'approval/asked': {
      if(state.pendingApprovals.length>=64)return next({coverage:'PARTIAL'});
      return next({pendingApprovals:[...state.pendingApprovals,identity(d.id)]});
    }
    case 'approval/decided': return next({pendingApprovals:state.pendingApprovals.filter(id=>id!==identity(d.id))});
    case 'turn/end': {
      const status={completed:'COMPLETED',aborted:'CANCELLED',blocked:'BLOCKED',error:'FAILED','max-tokens':'LIMIT_REACHED',interrupted:'INTERRUPTED'}[d.reason?.kind]??'UNKNOWN';
      // Cold reads may synthesize this closer. It is not a newly confirmed
      // durable operation or a known time of process death.
      return next({status,...(status==='INTERRUPTED'?{updatedAt:state.updatedAt,lastConfirmedSeq:state.lastConfirmedSeq}:{}),lastModel:state.lastModel?.status==='UNCONFIRMED'?{...state.lastModel,status:'UNKNOWN'}:state.lastModel});
    }
    default:return state;
  }
}
export function recoveryView(state, running) {
  let status=state.status;
  if(status==='RUNNING') {
    if(!running)status='UNKNOWN';
    else if(state.pendingApprovals.length)status='WAITING_PERMISSION';
    else if(state.pendingTools.some(t=>t.name==='ask_user_question'))status='WAITING_INPUT';
  }
  return {...state,status,unconfirmedTools:state.pendingTools.map(t=>({...t,status:running?'PENDING':'UNKNOWN'})),
    caution:state.pendingTools.length&&!running?'工具调用已有记录，但没有完成记录；实际副作用未知，请检查工作区后再决定是否重试。':null};
}
