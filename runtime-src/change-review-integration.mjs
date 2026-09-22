import {join} from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ChangeReview,ChangeError,discoverRepository} from './change-review.mjs';
import {writeAtomic} from './project-actions.mjs';
import {changesHtml,changesScript} from './change-review-page.mjs';
import {ChangeDrafts,patchHash} from './change-draft.mjs';
import {snapshotPipe} from './task-snapshot-bridge.mjs';

export function installChangeReview(ctx,home,{snapshots=snapshotPipe}={}){
  const manager=new ChangeReview(home),path=join(home,'desktop-change-preferences.json');
  const drafts=new ChangeDrafts({manager,query:()=>ctx.get?.('sessionQuery')});
  ctx.effect?.(()=>()=>drafts.dispose());
  let preferences={},writing=Promise.resolve();const failures=new Map(),seen=new Map();
  const workspaceKey=root=>createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex');
  const ready=(async()=>{try{const raw=await readFile(path,'utf8');if(raw.length>32768)throw Error();const value=JSON.parse(raw);if(value.version!==1||!Array.isArray(value.enabled)||value.enabled.length>128||value.enabled.some(k=>!/^[a-f0-9]{64}$/.test(k)))throw Error();preferences=Object.fromEntries(value.enabled.map(k=>[k,true]));}catch{preferences={};}})();
  // Awaited admission hook: capture before this turn's first model/tool step,
  // not a fire-and-forget turn/start listener racing workspace modifications.
  ctx.on('agent/pre-step',async(payload,next)=>{
    const decision=await next();if(decision.kind!=='enter'||!decision.messages?.length||payload.agent.session.header.origin==='subagent')return decision;
    const {agent,turn,signal}=payload,id=agent.session.header.id,cwd=agent.session.header.cwd;
    if(!cwd||seen.get(id)===turn)return decision;seen.delete(id);seen.set(id,turn);if(seen.size>512)seen.delete(seen.keys().next().value);
    await ready;if(!Object.keys(preferences).length)return decision;
    try{
      const repo=await discoverRepository(cwd);if(!preferences[workspaceKey(repo.root)])return decision;
      await manager.capture(cwd,{sessionId:id,turn,source:'turn-start',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});failures.delete(workspaceKey(repo.root));
    }catch{try{const repo=await discoverRepository(cwd);failures.set(workspaceKey(repo.root),'最近一轮基线采集失败或超过 15 秒；本轮不保证具有开始前基线，任务继续执行。');if(failures.size>128)failures.delete(failures.keys().next().value);}catch{}}
    return decision;
  });
  return {manager,drafts,async handle(req,res,url){
    const json=(code,value)=>res.writeHead(code,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
    try{
      if(req.method==='GET'){
        if(url.pathname==='/desktop-diagnostics/changes'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(changesHtml);return;}
        if(url.pathname==='/desktop-diagnostics/changes.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(changesScript);return;}
        const workspace=url.searchParams.get('workspace');
        if(url.pathname.endsWith('/sessions')){json(200,await drafts.sessions(workspace,Number(url.searchParams.get('offset')??0)));return;}
        if(url.pathname.endsWith('/draft/status')){json(200,drafts.status(url.searchParams.get('ticket')));return;}
        if(url.pathname.endsWith('/history')){await ready;const value=await manager.list(workspace),key=workspaceKey(value.repo.root);json(200,{...value,automatic:preferences[key]===true,warning:failures.get(key)??null});return;}
        const controller=new AbortController(),close=()=>controller.abort();res.on('close',close);
        try{
          if(url.pathname.endsWith('/inspect')){json(200,await manager.inspect(workspace,url.searchParams.get('baseline'),controller.signal));return;}
          if(url.pathname.endsWith('/patch')){const patch=await manager.patch(workspace,url.searchParams.get('path'),{baselineId:url.searchParams.get('baseline'),mode:url.searchParams.get('mode')??'repository'});json(200,{...patch,hash:patchHash(patch.text)});return;}
        }finally{res.off('close',close);}
      }
      if(req.method==='POST'){
        if(req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json'){json(403,{error:'需要同源 JSON 请求'});return;}
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){json(413,{error:'请求过大'});return;}chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString());
        if(url.pathname.endsWith('/snapshot/open')){
          if(!snapshots.enabled)throw new ChangeError('UNAVAILABLE','任务快照入口需要在桌面程序中使用');
          const history=await manager.list(body.workspace),baseline=history.items.find(row=>row.id===body.baselineId);
          if(baseline?.source!=='turn-start'||typeof baseline.sessionId!=='string'||!baseline.sessionId.length||baseline.sessionId.length>256||/[\x00-\x1f\x7f]/.test(baseline.sessionId)||!Number.isSafeInteger(baseline.turn)||baseline.turn<0)throw new ChangeError('INPUT','请选择有效的任务轮次基线；手动基线没有对应任务快照');
          const id=createHash('sha256').update(JSON.stringify(['task-snapshot-v1',baseline.sessionId,baseline.turn])).digest('hex').slice(0,32);
          try{const value=await snapshots.request({action:'open',id,expiresAt:Date.now()+10000},{timeoutMs:11000});if(value.status!=='OPEN_REQUESTED')throw Error();json(200,{id,status:'OPEN_REQUESTED'});}
          catch{throw new ChangeError('UNAVAILABLE','未确认打开对应快照。该轮可能未启用文件快照、记录已归档，或桌面正忙；请检查设置页。不会自动重试。');}
          return;
        }
        if(url.pathname.endsWith('/draft/stage')){json(200,await drafts.stage(body));return;}
        if(url.pathname.endsWith('/draft/cancel')){json(200,drafts.cancel(body.ticket));return;}
        if(url.pathname.endsWith('/draft/claim')){const result=await drafts.claim(body.ticket,body.clientId);json(result?200:409,result??{error:'草稿已被领取、过期或目标已不可用'});return;}
        if(url.pathname.endsWith('/draft/settle')){const ok=drafts.settle(body.ticket,body.clientId,body.status);json(ok?200:409,{ok});return;}
        if(url.pathname.endsWith('/capture')){json(200,await manager.capture(body.workspace,{signal:AbortSignal.timeout(15000)}));return;}
        if(url.pathname.endsWith('/automatic')){
          if(typeof body.enabled!=='boolean')throw new ChangeError('INPUT','自动采集偏好无效');
          const repo=await discoverRepository(body.workspace),key=workspaceKey(repo.root);await ready;
          const job=writing.catch(()=>{}).then(async()=>{const value={...preferences};if(body.enabled)value[key]=true;else delete value[key];if(Object.keys(value).length>128)throw new ChangeError('LIMIT','自动基线工作区超过上限');await mkdir(home,{recursive:true});await writeAtomic(path,JSON.stringify({version:1,enabled:Object.keys(value)}));preferences=value;});writing=job;await job;json(200,{automatic:body.enabled});return;
        }
      }
      json(404,{error:'入口不存在'});
    }catch(error){if(!res.headersSent&&!res.destroyed)json(error instanceof ChangeError?400:500,{error:error instanceof ChangeError?error.message:'读取或保存失败；没有修改仓库文件。',code:error instanceof ChangeError?error.code:'LOCAL_ERROR'});}
  }};
}
