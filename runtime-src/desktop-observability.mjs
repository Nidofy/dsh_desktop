import {Capture, observeStream} from './diagnostic-capture.mjs';
import {readHarnessSetting} from './harness-settings.mjs';
import {sourceCredential} from './source-provider-control.mjs';
import {diagnosticState, saveDiagnosticPreferences} from './diagnostic-state.mjs';
import {diagnosticHtml, diagnosticScript} from './diagnostic-page.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {normalizeReport,selectReport,compareReports,comparisonMarkdown} from './diagnostic-comparison.mjs';
import {MeasurementStore} from './diagnostic-store.mjs';
import {ToolTelemetry} from './diagnostic-tools.mjs';
import {workspaceFingerprint,registerRepoTool} from './repo-summary.mjs';
import {comparisonHtml,comparisonScript} from './comparison-page.mjs';
import {installProjectActions} from './project-actions-integration.mjs';
import {installDesktopTheme} from './desktop-theme.mjs';
import {desktopThemeCss,desktopThemeScript} from './desktop-theme-assets.mjs';
import {installTaskRecovery} from './task-recovery-integration.mjs';
import {installCacheCenter} from './cache-center.mjs';
import {probeSessionPrefix} from './cache-probe.mjs';
import {installChangeReview} from './change-review-integration.mjs';
import {installArtifacts} from './artifacts-integration.mjs';
import {installPromptStability} from './desktop-prompt-stability.mjs';
import {installSelfTestCenter} from './self-test-center.mjs';
import {selfTestSessionPrefix} from './self-test.mjs';
import {CACHE_KEY_BRIDGE_VERSION} from './desktop-cache-key.mjs';
import {installTaskSnapshots} from './task-snapshot-integration.mjs';
import {installDesktopWorkspace} from './desktop-workspace.mjs';
import {desktopHealth} from './desktop-health.mjs';
import {snapshotPipe} from './task-snapshot-bridge.mjs';
import {installDesktopControl} from './desktop-control.mjs';

export const name = 'desktop-observability';
export const inject = ['llm','webServer','connection'];
export function apply(ctx, config = {}) {
  installTaskSnapshots(ctx);
  installPromptStability(ctx);
  let desktop;
  const recovery=installTaskRecovery(ctx,diagnosticState.home,()=>desktop?.events());
  desktop=installDesktopWorkspace(ctx,config,recovery,id=>capture.id(id));
  const cache=installCacheCenter(ctx,diagnosticState.home,diagnosticState.key);
  const selfTest=installSelfTestCenter(ctx,diagnosticState.home,cache);
  const changes=installChangeReview(ctx,diagnosticState.home);
  const readAppearance = installDesktopTheme(ctx, diagnosticState.home);
  const actionsReady = installProjectActions(ctx, diagnosticState.home);
  installDesktopControl(ctx,actionsReady,[cache.probe,selfTest.runner]);
  let actionsHealth = 'starting';
  actionsReady.then(()=>{actionsHealth='ready';},()=>{actionsHealth='unavailable';});
  const artifacts=installArtifacts(ctx,diagnosticState.home,actionsReady);
  // Contain initialization failures; action routes report them without breaking conversation.
  actionsReady.catch(() => {});
  const capture = new Capture({key:diagnosticState.key,configuration:{
    desktopVersion:config.desktopVersion ?? 'development',dshVersion:diagnosticState.engineVersion??'0.1.5-rc.2',
    cacheKeyBridgeVersion:CACHE_KEY_BRIDGE_VERSION,
    api:config.api ?? 'unknown',effectiveSpillBytes:diagnosticState.effectiveSpillBytes,
    effectiveSkillDescription:diagnosticState.effectiveSkillDescription,nodeVersion:process.version,
    runtimeManifestHash:diagnosticState.runtimeManifestHash,repoSummary:diagnosticState.preferences.repoSummary===true,
  }});
  if(diagnosticState.overlayHash)capture.configuration.overlayHash=capture.id(diagnosticState.overlayHash);
  if (diagnosticState.providerConfiguration) capture.configuration.connectionId=capture.id(diagnosticState.providerConfiguration);
  const boundaries = new Map();
  const nativeStats = new Map();
  const telemetry=new ToolTelemetry(capture),store=new MeasurementStore(diagnosticState.home);
  const measurements=new Map(),turns=new Map(),workspaces=new Map(),workspacePaths=new Map(),comparisons=new Map();
  let archiveFailures=0;
  registerRepoTool(ctx).catch(()=>{capture.failures++;});
  ctx.inject(['sessionProjections'], statsCtx => {
    statsCtx.effect(() => statsCtx.sessionProjections.onChanged((session,key,value) => {
      if(key!=='sessionStats'||!diagnosticState.preferences.enabled)return;
      try {
        const id=capture.id(session.header.id), stats={};
        for(const field of ['turns','steps','llmMs','toolMs','ttftMs','ttftSteps','decodeMs','decodeTokens']) {
          if(Number.isFinite(value?.[field])&&value[field]>=0)stats[field]=value[field];
        }
        nativeStats.delete(id);nativeStats.set(id,stats);
        if(nativeStats.size>500)nativeStats.delete(nativeStats.keys().next().value);
      }catch{capture.failures++;}
    }));
  });
  ctx.on('session/event', (session,event) => {
    if (!diagnosticState.preferences.enabled) return;
    try {
      telemetry.event(session,event);
      const sid=capture.id(session.header.id),turnKey=sid+':'+event.data?.turn;
      if(event.type==='turn/start'){
        turns.set(turnKey,{startedAt:new Date(event.time).toISOString(),dropped:capture.dropped,toolsDropped:telemetry.dropped});
        if(turns.size>500)turns.delete(turns.keys().next().value);
        if(!workspaces.has(sid)&&workspaces.size<500){workspaces.set(sid,{complete:false});workspacePaths.set(sid,session.header.cwd);workspaceFingerprint(session.header.cwd,capture).then(value=>{if(workspaces.has(sid))workspaces.set(sid,value);}).catch(()=>{});}
      }
      if(event.type==='turn/end'&&diagnosticState.preferences.autoArchive){
        const boundary=turns.get(turnKey);
        const report=selectReport(snapshot(sid),{session:sid,turn:event.data.turn});
        report.measurement={...report.measurement,label:'Turn '+event.data.turn,startedAt:boundary?.startedAt,endedAt:new Date(event.time).toISOString(),
          quality:'UNKNOWN',complete:!!boundary&&boundary.dropped===capture.dropped&&boundary.toolsDropped===telemetry.dropped};
        store.save(report).catch(()=>{archiveFailures++;});
      }
      if(!['turn/start','step/start','llm/retry-started','compaction/end'].includes(event.type))return;
      const id=capture.id(session.header.id), previous=boundaries.get(id) ?? {};
      if(event.type==='turn/start')previous.turn=event.data.turn;
      if(event.type==='step/start')previous.step=event.data.step;
      if(event.type==='llm/retry-started')previous.retry=true;
      if(event.type==='compaction/end')previous.compaction=true;
      boundaries.delete(id);boundaries.set(id,previous);
      if(boundaries.size>500)boundaries.delete(boundaries.keys().next().value);
    } catch {capture.failures++;}
  });
  ctx.on('llm/stream', (options,next) => {
    if(options.sessionId?.startsWith(probeSessionPrefix)||options.sessionId?.startsWith(selfTestSessionPrefix))return next();
    if (!diagnosticState.preferences.enabled) return next();
    // Attach only numeric event positions and explicit durable boundary facts.
    const configuration={...capture.configuration};
    try{if(diagnosticState.engineVersion==='0.1.7-alpha.2'){
      const provider=readHarnessSetting(ctx,'llm-pi-ai')?.providers?.[options.provider];
      configuration.connectionId=capture.id(JSON.stringify(provider??null));
      configuration.credentialId=capture.id(sourceCredential(provider?.apiKeyEnv)?.value??process.env[provider?.apiKeyEnv]??'');
      configuration.api=provider?.api??'unknown';
    }}catch{capture.failures++;}
    return observeStream(capture,options,next,record=>{
            const boundary=boundaries.get(record.session);
            if(record&&boundary&&record.purpose==='conversation') {
              for(const field of ['turn','step'])if(Number.isSafeInteger(boundary[field]))record[field]=boundary[field];
              if(boundary.retry){record.comparison.facts.push('RETRY');delete boundary.retry;}
              if(boundary.compaction){record.comparison.facts.push('COMPACTION');record.continuity.reasons.push('COMPACTION');delete boundary.compaction;}
            }
    },configuration);
  });
  const snapshot = session => {
    const result = capture.snapshot();
    if(session)result.records=result.records.filter(r=>r.session===session);
    return {...result,exportedAt:new Date().toISOString(),enabled:diagnosticState.preferences.enabled,
      tools:telemetry.rows.filter(t=>!session||t.session===session),toolsDropped:telemetry.dropped,
      workspace:session?workspaces.get(session):undefined,archiveFailures,activeMeasurements:[...measurements.values()],
      nativeSessionStats:Object.fromEntries([...nativeStats].filter(([id])=>!session||id===session)),
      keyPersistence:diagnosticState.keyPersistence,preferences:diagnosticState.preferences,
      preferenceWarning:diagnosticState.preferenceWarning,
      limitations:['Logical requests, not final HTTP payloads.','Missing usage counters cannot distinguish provider omission from adapter loss.',
        'Live records are cleared on restart; explicitly archived measurements persist.',
        'Runtime fingerprint covers the dependency manifest, not the full runtime tree. Workspace fingerprint is observed at the first collected turn.',
        'Changes are local facts, not explanations of provider cache behavior.']};
  };
  ctx.effect(() => ctx.webServer.register({kind:'prefix',path:'/desktop-diagnostics',handler:async(req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const rejected=ctx.connection.requestRejection(req);
    if(rejected){res.writeHead(rejected).end('Authentication required');return;}
    const url=new URL(req.url,'http://127.0.0.1');
    const json=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
    try {
      if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/api/health'){
        const value=desktopHealth(ctx,{actions:actionsHealth,snapshotBridge:snapshotPipe.enabled});
        json(value.coreReady?200:503,value);return;
      }
      if(url.pathname.startsWith('/desktop-diagnostics/api/desktop/')){await desktop.handle(req,res,url);return;}
      if(url.pathname==='/desktop-diagnostics/self-test'||url.pathname==='/desktop-diagnostics/self-test.js'||url.pathname.startsWith('/desktop-diagnostics/api/self-test/')||(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('selfTest'))){await selfTest.handle(req,res,url);return;}
      if(url.pathname==='/desktop-diagnostics/artifacts'||url.pathname==='/desktop-diagnostics/artifacts.js'||url.pathname.startsWith('/desktop-diagnostics/api/artifacts/')||(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('artifact'))){await artifacts.handle(req,res,url);return;}
      if(url.pathname==='/desktop-diagnostics/changes'||url.pathname==='/desktop-diagnostics/changes.js'||url.pathname.startsWith('/desktop-diagnostics/api/changes/')){await changes.handle(req,res,url);return;}
      if(url.pathname==='/desktop-diagnostics/cache'||url.pathname==='/desktop-diagnostics/cache.js'||url.pathname.startsWith('/desktop-diagnostics/api/cache/')||(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('cacheProbe'))){await cache.handle(req,res,url);return;}
      if(url.pathname.startsWith('/desktop-diagnostics/api/recovery/')||url.pathname==='/desktop-diagnostics/recovery'||url.pathname==='/desktop-diagnostics/recovery.js'){await recovery.handle(req,res,url);return;}
      if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/api/appearance'){json(200,readAppearance());return;}
      if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/theme.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8'}).end(desktopThemeCss);return;}
      if(req.method==='GET'&&url.pathname==='/desktop-diagnostics/theme.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(desktopThemeScript);return;}
      if(url.pathname==='/desktop-diagnostics/actions'||url.pathname==='/desktop-diagnostics/actions.js'||url.pathname.startsWith('/desktop-diagnostics/api/actions/')) {
        await (await actionsReady).handle(req,res,url);return;
      }
      if(req.method==='GET') {
        if(url.pathname==='/desktop-diagnostics/compare'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(comparisonHtml);return;}
        if(url.pathname==='/desktop-diagnostics/compare.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(comparisonScript);return;}
        if(url.pathname==='/desktop-diagnostics/comparison.mjs'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(await readFile(new URL('./diagnostic-comparison.mjs',import.meta.url),'utf8'));return;}
        if(url.pathname==='/desktop-diagnostics/api/history'){json(200,await store.list());return;}
        if(url.pathname==='/desktop-diagnostics/api/measurement'){json(200,await store.read(url.searchParams.get('id')));return;}
        if(url.pathname==='/desktop-diagnostics'||url.pathname==='/desktop-diagnostics/') {
          res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(diagnosticHtml);return;
        }
        if(url.pathname==='/desktop-diagnostics/page.js') {
          res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(diagnosticScript);return;
        }
        if(url.pathname==='/desktop-diagnostics/api/snapshot') {json(200,snapshot(url.searchParams.get('session')));return;}
        if(url.pathname==='/desktop-diagnostics/api/export') {
          const comparison=url.searchParams.get('comparison');
          const report=comparison?comparisons.get(comparison):url.searchParams.get('id')?await store.read(url.searchParams.get('id')):snapshot(url.searchParams.get('session'));
          if(!report){json(404,{error:'Export expired'});return;}
          const md=url.searchParams.get('format')==='md';
          const data=md ? comparison?comparisonMarkdown(report):markdownReport(report) : JSON.stringify(report,null,2);
          res.writeHead(200,{'content-type':md?'text/markdown; charset=utf-8':'application/json; charset=utf-8',
            'content-disposition':`attachment; filename="DSHDesktop-diagnostics-${Date.now()}.${md?'md':'json'}"`}).end(data);return;
        }
      }
      if(req.method==='POST') {
        if(req.headers.origin!==`http://${req.headers.host}`||req.headers['content-type']!=='application/json') {json(403,{error:'Same-origin JSON required'});return;}
        const limit=url.pathname.endsWith('/compare')?25*1024*1024:4096;
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>limit){json(413,{error:'Body too large'});return;}chunks.push(chunk);}
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(url.pathname==='/desktop-diagnostics/api/compare'){
          const result=compareReports(data.a,data.b),id=randomUUID();comparisons.set(id,result);if(comparisons.size>20)comparisons.delete(comparisons.keys().next().value);
          json(200,{id,result});return;
        }
        if(url.pathname==='/desktop-diagnostics/api/measurement/start'){
          if(!diagnosticState.preferences.enabled||typeof data.session!=='string'||!capture.snapshot().records.some(r=>r.session===data.session)||measurements.size>=32){json(400,{error:'Enable collection and select a known session'});return;}
          const id=randomUUID(),m={id,session:data.session,startedAt:new Date().toISOString(),label:String(data.label??'Task').slice(0,120),
            dropped:capture.dropped,toolsDropped:telemetry.dropped,complete:!capture.snapshot().records.some(r=>r.session===data.session&&r.status==='running')};
          measurements.set(id,m);if(workspacePaths.has(data.session))m.workspace=await workspaceFingerprint(workspacePaths.get(data.session),capture);json(200,m);return;
        }
        if(url.pathname==='/desktop-diagnostics/api/measurement/finish'){
          const m=measurements.get(data.id);if(!m){json(404,{error:'Measurement not found'});return;}
          const report=selectReport(snapshot(m.session),{session:m.session,from:Date.parse(m.startedAt)});
          report.measurement={...report.measurement,id:m.id,label:m.label,startedAt:m.startedAt,endedAt:new Date().toISOString(),quality:['PASS','FAIL'].includes(data.quality)?data.quality:'UNKNOWN',acceptanceKind:'manual',
            complete:m.complete&&report.records.length>0&&m.dropped===capture.dropped&&m.toolsDropped===telemetry.dropped&&!report.records.some(r=>r.status==='running')&&!report.tools.some(r=>r.status==='running')};
          report.workspace=m.workspace??{complete:false};
          const saved=await store.save(report);measurements.delete(m.id);json(200,saved);return;
        }
        if(url.pathname==='/desktop-diagnostics/api/measurement/save'){
          const report=selectReport(snapshot(data.session),{session:data.session||undefined,purpose:data.purpose||undefined,turn:Number.isSafeInteger(data.turn)?data.turn:undefined});
          report.measurement={...report.measurement,label:String(data.label??'Retained window').slice(0,120),quality:'UNKNOWN',complete:false};
          json(200,await store.save(report));return;
        }
        if(url.pathname==='/desktop-diagnostics/api/preferences') {
          if(typeof data.enabled!=='boolean'||['spillMode','skillMode'].some(k=>data[k]!==undefined&&!['native','compact','restore'].includes(data[k]))||['autoArchive','repoSummary'].some(k=>data[k]!==undefined&&typeof data[k]!=='boolean')) {json(400,{error:'Invalid preferences'});return;}
          const patch={enabled:data.enabled};for(const k of ['spillMode','skillMode','autoArchive','repoSummary'])if(data[k]!==undefined)patch[k]=data[k];
          await saveDiagnosticPreferences(patch);
          // Stopping collection also drops in-flight observations; streams continue unchanged.
          if(!data.enabled){capture.active.clear();capture.continuity.clear();telemetry.suspend();boundaries.clear();turns.clear();for(const m of measurements.values())m.complete=false;}
          json(200,snapshot());return;
        }
        if(url.pathname==='/desktop-diagnostics/api/clear'){capture.clear();boundaries.clear();nativeStats.clear();telemetry.clear();turns.clear();workspaces.clear();workspacePaths.clear();for(const m of measurements.values())m.complete=false;json(200,snapshot());return;}
      }
      json(404,{error:'Not found'});
    }catch{if(!res.headersSent)json(500,{error:'Diagnostic operation failed; no conversation data was changed'});else res.end();}
  }}));
}
export function markdownReport(report) {
  const safe=value=>String(value??'—').replace(/[|\r\n`<>]/g,' ');
  return ['# DSHDesktop 会话诊断',`导出：${report.exportedAt}`,`Desktop ${report.configuration.desktopVersion} · DSH ${report.configuration.dshVersion}`,
    `Run ${report.runId} · Scope ${report.keyScopeId} · Fingerprint v${report.fingerprintSchemaVersion}`,
    `工具内联预算：${report.configuration.effectiveSpillBytes} bytes；保留 ${report.records.length} 条；淘汰/丢弃 ${report.dropped} 条。`,
    '只含当前进程保留的逻辑请求元数据；输入为累计使用量，不是当前上下文。未知值以 — 表示。缓存变化的原因不能由本地指纹判定。',
    ['| 请求 / 会话 | 用途 / 模型 | 总输入 / 未缓存 / cache read / 输出 | 首输出 / 总耗时 ms | 状态 / 本地变化 |',
    '|---|---|---|---|---|',...report.records.map(r=>`| ${safe(r.id)} / ${safe(r.session)} | ${safe(r.purpose)} / ${safe(r.model)} | ${[r.usage.aggregateInputTokens,r.usage.inputTokens,r.usage.cacheReadTokens,r.usage.outputTokens].map(safe).join(' / ')} | ${safe(r.firstOutputMs?.toFixed(1))} / ${safe(r.durationMs?.toFixed(1))} | ${safe(r.status)} / ${safe(r.comparison?.facts?.join(', ')??r.continuity?.reasons?.join(', '))} |`)].join('\n'),''].join('\n\n');
}
