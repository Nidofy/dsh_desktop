import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {discoverRepository,runVcs,parseStatus} from './change-review.mjs';
import {environmentRepository,compareEnvironmentBranch,createEnvironmentOperations} from './environment-repository.mjs';

export const desktopViews = new Set(['settings','snapshots','diagnostics','changes','actions','artifacts','cache','recovery','self-test','compare']);
// Consumed by the native supervisor; requests never carry arbitrary URLs.
export function installDesktopWorkspace(ctx, config, recovery, sessionKey = () => null) {
  let revision = 0, navigation = null;
  const operations=createEnvironmentOperations();
  async function context(sessionId) {
    let workspace = null, title = null;
    if (sessionId) {
      if(!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))throw Error('Invalid session');
      // A new blank session has a header but may not yet have a recovery projection.
      const query=ctx.get?.('sessionQuery');
      if(query){const value=await query.observeSession(sessionId,{signal:AbortSignal.timeout(10000),projectionMode:'all'});try{workspace=value.header.cwd??null;title=value.projections?.values.title?.title??null;}finally{value[Symbol.dispose]();}}
      else {const value=await recovery.detail(sessionId,AbortSignal.timeout(10000));workspace=value.workspace;title=value.title;}
    }
    const exists = async name => {
      if (!workspace) return false;
      try { await stat(join(workspace,name)); return true; } catch { return false; }
    };
    const [git,hg,agents,claude] = await Promise.all(['.git','.hg','AGENTS.md','CLAUDE.md'].map(exists));
    let repository=null;
    if(workspace)try{
      const repo=await discoverRepository(workspace),signal=AbortSignal.timeout(8000);
      repository={...repo,branch:null,changedFiles:null};
      const [branch,status]=await Promise.all([
        runVcs(repo,repo.vcs==='git'?['symbolic-ref','--short','-q','HEAD']:['branch'],{signal}).catch(()=>Buffer.from('')),
        runVcs(repo,repo.vcs==='git'?['status','--porcelain=v1','-z','--no-renames','--untracked-files=all']:['status','-0'],{signal}).then(value=>parseStatus(repo.vcs,value).length).catch(()=>null)
      ]);
      repository={...repo,branch:branch.toString('utf8').trim()||'Detached HEAD',changedFiles:status};
    }catch{}
    return {sessionId:sessionId || null,diagnosticSession:sessionId?sessionKey(sessionId):null,title,workspace,vcs:git?'Git':hg?'Hg':null,
      repository,
      environment:{platform:process.platform==='win32'?'Windows':process.platform,node:process.version,variables:Object.fromEntries(['COMSPEC','PROCESSOR_ARCHITECTURE','LANG','LC_ALL'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))},
      connection:config.providerName || 'DeepSeek',api:config.api,managedProvider:config.managedProvider || (config.connectionConfigured?'desktop-internal':null),
      version:config.desktopVersion || 'development',
      configurationSource:config.connectionConfigured?'桌面连接':'DSH 模型设置',
      workspaceFiles:[agents?'AGENTS.md':null,claude?'CLAUDE.md':null].filter(Boolean)};
  }
  return {
    events: () => ({revision,navigation}),
    async handle(req,res,url) {
      const json=(code,data)=>res.writeHead(code,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
      try {
        if(req.method==='GET' && url.pathname==='/desktop-diagnostics/api/desktop/context') {
          json(200,await context(url.searchParams.get('session') || '')); return;
        }
        if(req.method==='GET' && ['/desktop-diagnostics/api/desktop/repository','/desktop-diagnostics/api/desktop/compare'].includes(url.pathname)){
          const info=await context(url.searchParams.get('session')||'');
          if(!info.workspace)throw Error('请先选择工程');
          json(200,url.pathname.endsWith('/compare')?await compareEnvironmentBranch(info.workspace,url.searchParams.get('branch')):await environmentRepository(info.workspace));return;
        }
        if(req.method==='POST' && ['/desktop-diagnostics/api/desktop/preview','/desktop-diagnostics/api/desktop/apply'].includes(url.pathname)){
          if(req.headers.origin!==`http://${req.headers.host}`||req.headers['content-type']!=='application/json'){json(403,{error:'需要同源请求'});return;}
          const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192){json(413,{error:'请求过大'});return;}chunks.push(chunk);}
          const data=JSON.parse(Buffer.concat(chunks));const info=await context(data.sessionId||'');
          if(!info.workspace)throw Error('请先选择工程');
          try{json(200,url.pathname.endsWith('/preview')?await operations.preview(info.workspace,data):await operations.apply(info.workspace,data.token));}
          catch(error){json(400,{error:error.message});}return;
        }
        if(req.method==='POST' && url.pathname==='/desktop-diagnostics/api/desktop/open') {
          if(req.headers.origin!==`http://${req.headers.host}` || req.headers['content-type']!=='application/json') {json(403,{error:'需要同源请求'});return;}
          const chunks=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>1024){json(413,{error:'请求过大'});return;}chunks.push(chunk);}
          const data=JSON.parse(Buffer.concat(chunks));
          if(!desktopViews.has(data.view) || (data.sessionId!==undefined && (typeof data.sessionId!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.sessionId)))) {json(400,{error:'无效的页面'});return;}
          const info=await context(data.sessionId || '');
          navigation={view:data.view,workspace:info.workspace,sessionId:info.sessionId}; revision++;
          json(200,{revision});return;
        }
        json(405,{error:'不支持的操作'});
      } catch {json(400,{error:'无法打开此会话的工具，请刷新后重试。'});}
    }
  };
}
