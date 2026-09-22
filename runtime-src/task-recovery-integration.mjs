import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoveryKey,recoveryInitial,recoveryFold,recoveryView} from './task-recovery.mjs';
import {recoveryHtml,recoveryScript} from './task-recovery-page.mjs';
import {installNotifications} from './desktop-notifications.mjs';

export function installTaskRecovery(ctx,home,desktopEvents=()=>null) {
  const notifications=installNotifications(ctx,home);
  const require=createRequire(join(dirname(fileURLToPath(import.meta.url)),'dsh/package.json'));
  const {z}=require('zod');
  const fact=z.object({status:z.enum(['UNCONFIRMED','INTERRUPTED','COMPLETED','NO_MESSAGE','UNKNOWN']),time:z.number(),seq:z.number().int()}).strict();
  const schema=z.object({turn:z.number().int().nullable(),step:z.number().int().nullable(),status:z.enum(['IDLE','RUNNING','COMPLETED','CANCELLED','BLOCKED','FAILED','LIMIT_REACHED','INTERRUPTED','UNKNOWN']),updatedAt:z.number(),lastConfirmedSeq:z.number().int().nullable(),lastModel:fact.nullable(),lastTool:z.object({name:z.string().max(128),status:z.enum(['COMPLETED','FAILED']),time:z.number(),seq:z.number().int()}).strict().nullable(),pendingTools:z.array(z.object({id:z.string().max(128),name:z.string().max(128),seq:z.number().int(),time:z.number()}).strict()).max(64),pendingApprovals:z.array(z.string().max(128)).max(64),coverage:z.enum(['COMPLETE','PARTIAL']),ignoreBefore:z.number().int().nonnegative()}).strict();
  let ready=false,focusRevision=0;
  ctx.inject(['sessionProjections'], scope=>{
    scope.sessionProjections.register({key:recoveryKey,stateSchema:schema,stateVersion:1,init:recoveryInitial,apply:recoveryFold,wire:{viewSchema:schema,view:state=>state}});
    ready=true;scope.effect(()=>()=>{ready=false;});
  });
  async function detail(id,signal) {
    if(typeof id!=='string'||id.length>128||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Invalid session identity');
    const observation=await ctx.get('sessionQuery').observeSession(id,{signal,projectionMode:'all'});
    try {
      const state=observation.projections?.values[recoveryKey];
      if(!state)throw Error('Recovery projection unavailable');
      const running=ctx.get('agents')?.get(id)?.status==='running';
      // The native title unit may be scoped to a loaded Agent. Query its logged
      // title when that projection is absent, without activating the Agent.
      const title=observation.projections?.values.title?.title??(await ctx.get('sessionQuery').readTitle(id,signal))?.title??null;
      return {sessionId:id,title,workspace:observation.header.cwd??null,source:observation.source,capturedThroughSeq:observation.cursor,...recoveryView(state,running)};
    } finally {observation[Symbol.dispose]();}
  }
  return {detail,async handle(req,res,url) {
    const json=(code,value)=>res.writeHead(code,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
    if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/recovery'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(recoveryHtml);return;}
    if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/recovery.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(recoveryScript);return;}
    if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/api/recovery/desktop-events'){
      const after=Number(url.searchParams.get('after')??0);
      if(!Number.isSafeInteger(after)||after<0){json(400,{error:'Invalid cursor'});return;}
      json(200,{focusRevision,notifications:await notifications.snapshot(after),desktop:desktopEvents()});return;
    }
    if(url.pathname==='/desktop-diagnostics/api/recovery/notifications'){
      if(req.method==='GET'){const {enabled,warning}=await notifications.snapshot();json(200,{enabled,warning});return;}
      if(req.method==='POST'){
        if(req.headers.origin!==('http://'+req.headers.host)||req.headers['content-type']!=='application/json'){json(403,{error:'Same-origin JSON required'});return;}
        let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256){json(413,{error:'Body too large'});return;}body+=chunk;}
        let value;try{value=JSON.parse(body);if(typeof value?.enabled!=='boolean'||Object.keys(value).length!==1)throw Error();}catch{json(400,{error:'Invalid preference'});return;}
        try{json(200,await notifications.save(value.enabled));}catch{json(500,{error:'通知偏好未能保存。'});}return;
      }
    }
    if(req.method==='POST'&&url.pathname==='/desktop-diagnostics/api/recovery/focus'){
      if(req.headers.origin!==('http://'+req.headers.host)||req.headers['content-type']!=='application/json'){json(403,{error:'Same-origin JSON required'});return;}
      let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>64){json(413,{error:'Body too large'});return;}}
      focusRevision++;json(200,{focusRevision});return;
    }
    if(req.method!=='GET'){json(405,{error:'Read only'});return;}
    if(!ready||!ctx.get('sessionQuery')){json(503,{error:'DSH 会话查询服务尚未就绪'});return;}
    const controller=new AbortController(),close=()=>controller.abort();res.on('close',close);
    try {
      if(url.pathname==='/desktop-diagnostics/api/recovery/session') {json(200,await detail(url.searchParams.get('id'),controller.signal));return;}
      if(url.pathname==='/desktop-diagnostics/api/recovery/list') {
        const offset=Number(url.searchParams.get('offset')??0);
        if(!Number.isSafeInteger(offset)||offset<0||offset>100000){json(400,{error:'Invalid page'});return;}
        const records=await ctx.get('sessionQuery').listSessions(controller.signal);
        // Warm running sessions first; no reads activate an Agent or send input.
        records.sort((a,b)=>Number(ctx.get('agents')?.get(b.header.id)?.status==='running')-Number(ctx.get('agents')?.get(a.header.id)?.status==='running')||b.header.createdAt-a.header.createdAt);
        const selected=records.slice(offset,offset+20),items=[];
        for(let i=0;i<selected.length;i+=4) {
          const batch=await Promise.all(selected.slice(i,i+4).map(async record=>{
            try{return await detail(record.header.id,controller.signal);}catch(error){if(controller.signal.aborted)throw error;return {sessionId:record.header.id,workspace:record.header.cwd??null,status:'UNKNOWN',error:'会话记录暂时无法读取；未尝试恢复或重放。'};}
          }));items.push(...batch);
        }
        json(200,{items,total:records.length,nextOffset:offset+selected.length<records.length?offset+selected.length:null});return;
      }
      json(404,{error:'Not found'});
    }catch{if(!res.headersSent&&!res.destroyed)json(500,{error:'无法读取恢复状态；会话日志未改变。'});}
    finally{res.off('close',close);}
  }};
}
