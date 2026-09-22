import {createHash,randomUUID} from 'node:crypto';
import {ChangeError,discoverRepository} from './change-review.mjs';
export const patchHash = text => typeof text==='string'?createHash('sha256').update(text).digest('hex'):null;
const id = value => typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const fail = message => {throw new ChangeError('DRAFT',message);};
const same = (a,b) => process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const names={repository:'仓库版本 → 当前文件',staged:'仓库版本 → Git 暂存区',unstaged:'Git 暂存区 → 当前文件',task:'任务基线 → 当前文件',before:'仓库版本 → 任务基线'};

// Short-lived one-consumer handoff. No draft body is stored on disk or sent on
// BroadcastChannel; that channel carries only an opaque ticket. A lost receipt
// remains UNKNOWN and is never automatically retried.
export class ChangeDrafts {
  constructor({manager,query,now=Date.now}) {this.manager=manager;this.query=query;this.now=now;this.items=new Map();}
  prune(){for(const [key,row] of this.items)if(this.now()>row.expiresAt)this.items.delete(key);}
  async target(workspace,sessionId){
    if(!id(sessionId))fail('目标会话无效');
    const repo=await discoverRepository(workspace),query=this.query();
    if(!query)fail('会话服务尚未就绪');
    const observation=await query.observeSession(sessionId,{signal:AbortSignal.timeout(10000),projectionMode:'none'});
    try{
      if(observation.header.origin==='subagent')fail('请选择主会话');
      const target=await discoverRepository(observation.header.cwd);
      if(!same(repo.root,target.root))fail('目标会话不属于当前仓库');
      return repo.root;
    } finally {observation[Symbol.dispose]();}
  }
  async sessions(workspace,offset=0){
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('会话页码无效');
    const repo=await discoverRepository(workspace),query=this.query();if(!query)fail('会话服务尚未就绪');
    const records=await query.listSessions(AbortSignal.timeout(10000));records.sort((a,b)=>b.header.createdAt-a.header.createdAt);
    const items=[];
    for(const record of records.slice(offset,offset+50)){
      const h=record.header;if(h.origin==='subagent')continue;
      try{const target=await discoverRepository(h.cwd);if(!same(repo.root,target.root))continue;
        const title=(await query.readTitle(h.id,AbortSignal.timeout(3000)))?.title;
        items.push({id:h.id,title:title??h.id,createdAt:h.createdAt});
      }catch{}
    }
    return {items,nextOffset:offset+50<records.length?offset+50:null};
  }
  async stage(value){
    if(!value||Object.keys(value).some(k=>!['workspace','sessionId','path','mode','baselineId','hash','start','end'].includes(k)))fail('草稿请求无效');
    if(!Object.hasOwn(names,value.mode))fail('请选择有效比较范围');
    const root=await this.target(value.workspace,value.sessionId);
    const patch=await this.manager.patch(root,value.path,{baselineId:value.baselineId,mode:value.mode});
    if(typeof patch.text!=='string'||patchHash(patch.text)!==value.hash)fail('差异已变化，请刷新并重新选择片段');
    const {start,end}=value;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>patch.text.length)fail('请选择差异中的有效片段');
    const selected=patch.text.slice(start,end);if(Buffer.byteLength(selected)>64*1024)fail('选中片段超过 64 KiB，请缩小范围');
    // Refuse broken surrogate pairs rather than silently changing the excerpt.
    if(!selected.isWellFormed())fail('选择边界截断字符，请重新选择');
    this.prune();if(this.items.size>=16)fail('待处理草稿过多，请稍后再试');
    const ticket=randomUUID(),text='用户选取的差异片段（不是完整文件或完整补丁）：\n'+JSON.stringify({file:value.path,comparison:names[value.mode]})+'\n\n'+selected;
    this.items.set(ticket,{status:'PENDING',sessionId:value.sessionId,workspace:root,text,expiresAt:this.now()+120000});
    return {ticket,expiresInMs:120000};
  }
  status(ticket){this.prune();return {status:this.items.get(ticket)?.status??'EXPIRED'};}
  cancel(ticket){const row=this.items.get(ticket);if(row?.status==='PENDING'){row.status='REFUSED';delete row.text;}return this.status(ticket);}
  async claim(ticket,clientId){
    this.prune();const row=this.items.get(ticket);
    if(!row||row.status!=='PENDING'||!id(clientId))return null;
    row.status='UNKNOWN';row.clientId=clientId;
    const text=row.text;delete row.text;
    try{await this.target(row.workspace,row.sessionId);if(this.now()>row.expiresAt)throw Error();}catch{row.status='REFUSED';return null;}
    return {sessionId:row.sessionId,text};
  }
  settle(ticket,clientId,status){
    const row=this.items.get(ticket);
    if(!row||row.clientId!==clientId||row.status!=='UNKNOWN'||!['APPENDED','REFUSED'].includes(status))return false;
    row.status=status;return true;
  }
  dispose(){this.items.clear();}
}
