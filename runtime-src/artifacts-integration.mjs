import {createRequire} from 'node:module';
import {dirname,join,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DesktopArtifacts,ArtifactError,artifactPath} from './desktop-artifacts.mjs';
import {artifactsHtml,artifactsScript} from './artifacts-page.mjs';

export function foldArtifacts(state,event){
  if(event.seq<state.ignoreBefore||event.type!=='deliverables/presented'||!Array.isArray(event.data?.files))return state;
  const rows=event.data.files.slice(0,100).flatMap((file,index)=>typeof file?.path==='string'&&file.path.length<=4096?[{path:file.path,seq:event.seq,index,time:event.time,turn:event.data.turn??0}]:[]);
  return {...state,items:[...rows,...state.items].slice(0,100),truncated:state.truncated||state.items.length+event.data.files.length>100};
}
export function installArtifacts(ctx,home,actionsReady){
  const manager=new DesktopArtifacts(home,{openNative:async(path,action,signal)=>{const controller=ctx.get('sessionController');if(!controller?.workspaceDesktop().available)throw new ArtifactError('UNAVAILABLE','当前环境不支持打开本机应用');await controller.openWorkspacePath({path,action},signal??new AbortController().signal);}});
  const require=createRequire(join(dirname(fileURLToPath(import.meta.url)),'dsh/package.json')),{z}=require('zod'),key='desktopArtifactReferences';
  const schema=z.object({items:z.array(z.object({path:z.string().max(4096),seq:z.number().int(),index:z.number().int(),time:z.number(),turn:z.number().int()})).max(100),truncated:z.boolean(),ignoreBefore:z.number().int()});
  ctx.inject(['sessionProjections'],scope=>scope.sessionProjections.register({key,stateVersion:1,stateSchema:schema,init:({inheritedEventCount=0}={})=>({items:[],truncated:false,ignoreBefore:inheritedEventCount}),apply:foldArtifacts,wire:{viewSchema:schema,view:state=>state}}));
  async function sessionFiles(id,signal){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id??''))throw new ArtifactError('SESSION','会话标识无效');const view=await ctx.get('sessionQuery').observeSession(id,{signal,projectionMode:'all'});try{const root=view.header.cwd,projection=view.projections?.values[key];if(!root||!projection)return {items:[],truncated:false};const items=[];for(const row of projection.items){signal.throwIfAborted();const path=isAbsolute(row.path)?relative(root,row.path).replaceAll('\\','/'):row.path.replaceAll('\\','/');try{items.push(await manager.describe(root,path,{source:'session',turn:row.turn}));}catch{items.push({path,source:'session',turn:row.turn,available:false,message:'文件不在受支持的工作区范围内，或已移动/删除'});}}return {workspace:root,items,truncated:projection.truncated};}finally{view[Symbol.dispose]();}}
  async function actionFiles(workspace){const actions=(await actionsReady).manager,state=await actions.workspace(workspace),items=[];for(const row of [...state.rows.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20)){
    if(row.logAvailable)try{items.push(await manager.describe(join(state.dir,'runs'),row.id+'.log',{source:'action-log',runId:row.id,label:row.label,status:row.status}));}catch{}
    for(const path of row.artifacts??[]){try{items.push(await manager.describe(state.root,path,{source:'action',runId:row.id,label:row.label,status:row.status}));}catch{items.push({path,source:'action',runId:row.id,label:row.label,status:row.status,available:false,message:'声明文件尚不存在、已移动或超出受支持路径'});}}
    if(items.length>=100)break;
  }return items.slice(0,100);}
  return {manager,async handle(req,res,url){const json=(code,value)=>res.writeHead(code,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));const abort=new AbortController(),close=()=>abort.abort();res.on('close',close);
    try{
      if(req.method==='GET'){
        if(url.pathname==='/desktop-diagnostics/artifacts'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(artifactsHtml);return;}
        if(url.pathname==='/desktop-diagnostics/artifacts.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(artifactsScript);return;}
        if(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('artifact')){await manager.download(url.searchParams.get('artifact'),res,abort.signal);return;}
        if(url.pathname.endsWith('/list')){const sessionId=url.searchParams.get('session'),workspace=url.searchParams.get('workspace');const session=sessionId?await sessionFiles(sessionId,abort.signal):null,root=session?.workspace??workspace;if(!root)throw new ArtifactError('WORKSPACE','请指定工作区或具有工作区的会话');const [manual,actions]=await Promise.all([manager.list(root),actionFiles(root)]);json(200,{workspace:root,items:[...(session?.items??[]),...manual,...actions],truncated:session?.truncated??false});return;}
      }
      if(req.method==='POST'){
        if(req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json'){json(403,{error:'需要同源 JSON 请求'});return;}const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8192){json(413,{error:'请求过大'});return;}chunks.push(c);}const value=JSON.parse(Buffer.concat(chunks));
        if(url.pathname.endsWith('/register')){if(!artifactPath(value.path))throw new ArtifactError('PATH','请输入工作区内的相对文件路径');json(200,await manager.register(value.workspace,value.path));return;}
        if(url.pathname.endsWith('/action')){json(200,await manager.action(value.id,value.action,abort.signal));return;}
      }
      json(404,{error:'入口不存在'});
    }catch(error){if(!res.headersSent&&!res.destroyed)json(error instanceof ArtifactError?400:500,{error:error instanceof ArtifactError?error.message:'文件操作失败；请刷新后检查文件是否仍可用。'});else if(!res.destroyed)res.destroy();}
    finally{res.off('close',close);}
  }};
}
