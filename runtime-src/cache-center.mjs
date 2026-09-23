import {mkdir,open,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {CacheProbe,ProbePreparationError,exportProbe,probeMarkdown} from './cache-probe.mjs';
import {writeAtomic} from './project-actions.mjs';
import {storageAdmission} from './storage-admission.mjs';
import {cacheHtml,cacheScript} from './cache-page.mjs';
import {diagnosticState} from './diagnostic-state.mjs';
import {CACHE_KEY_BRIDGE_VERSION} from './desktop-cache-key.mjs';
import {readHarnessSetting} from './harness-settings.mjs';
import {sourceCredential,sourceProviderPolicies} from './source-provider-control.mjs';

const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const FEATURES=['automaticCaching','promptCacheKey','cacheControl','longRetention'];
const STATES=['unknown','supported','unsupported'];
async function readJson(path,limit=65536){
  const file=await open(path,'r');try{const buffer=Buffer.alloc(limit+1);const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>limit)throw Error('Size limit');return JSON.parse(buffer.subarray(0,bytesRead));}finally{await file.close();}
}
export function adapterCapabilities(profile){
  const api=profile?.api??'unknown',retention=profile?.cacheRetention??'native-default';
  return {api,retention,cacheControlFormat:profile?.compat?.cacheControlFormat??(api==='anthropic-messages'?'anthropic-native':'native-detection'),
    source:'bundled-dsh-'+(diagnosticState.engineVersion??'0.1.5-rc.2'),independentCustomEndpointCacheKey:api==='openai-completions'?'DESKTOP_BRIDGE':'NOT_APPLICABLE',
    cacheKeyBridgeVersion:CACHE_KEY_BRIDGE_VERSION,cacheKeyMode:profile?.desktopCacheKey?.mode??'native',
    cacheKeyModels:profile?.desktopCacheKey?.models??[],cacheKeyPersistence:diagnosticState.keyPersistence,
    notes:api==='openai-completions'?[
      '桌面扩展支持独立关闭或按会话生成 prompt_cache_key；仅用于明确勾选的模型，不自动附加 24h。原生兼容模式保留旧的 long 耦合行为。',
      diagnosticState.keyPersistence==='ephemeral'?'当前指纹密钥是临时的，重启会改变会话缓存路由键。':'会话键由本机持久密钥生成，按连接、模型和会话隔离；重置诊断指纹也会使后续路由键变化。',
      '未配置 cacheControlFormat 时沿用原生适配器检测；请求接受不等于缓存参数生效。'
    ]:api==='anthropic-messages'?['Anthropic 适配器已经生成原生 cache_control；不要重复注入。none 关闭显式标记，short 使用默认保留，long 在支持时请求 1h TTL。']:['当前连接尚未配置受支持的模型协议。'],
    serverCapability:'UNKNOWN'};
}
export function installCacheCenter(ctx,home,key){
  const directory=join(home,'desktop-cache-probes'),declarationPath=join(home,'desktop-cache-capabilities.json');
  let declarations={},declarationWarning=null,writing=Promise.resolve();
  const ready=(async()=>{try{const value=await readJson(declarationPath);if(value.version!==1||!value.models||Array.isArray(value.models)||Object.keys(value.models).length>100)throw Error();declarations=value.models;}catch(error){if(error.code!=='ENOENT')declarationWarning='能力声明文件无法读取；当前显示未知，重新保存可修复。';}})();
  const profile=()=>{const route=diagnosticState.managedProvider??'desktop-internal',current=readHarnessSetting(ctx,'llm-pi-ai')?.providers?.[route],policy=sourceProviderPolicies()?.[route]?.desktopCacheKey;return current&&policy?{...current,desktopCacheKey:policy}:current;};
  const fingerprint=()=>{
    const current=profile();
    // Include credential rotation and routing without exposing these values.
    const environment=Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS'].map(k=>[k,process.env[k]??null]));
    const authTag=createHmac('sha256',key).update(sourceCredential(current?.apiKeyEnv)?.value??process.env[current?.apiKeyEnv]??'').digest('hex');
    return createHmac('sha256',key).update(JSON.stringify({home,profile:current??null,environment,authTag,cacheKeyBridgeVersion:CACHE_KEY_BRIDGE_VERSION})).digest('hex');
  };
  const route=()=>diagnosticState.managedProvider??'desktop-internal';
  const models=async()=>ctx.llm.listProviders&&!ctx.llm.listProviders().some(p=>p.id===route())?[]:await ctx.llm.listModels(route());
  async function persist(report){
    const encoded=JSON.stringify(report);if(Buffer.byteLength(encoded)>65536)throw Error('Report size limit');
    await mkdir(directory,{recursive:true});await writeAtomic(join(directory,report.id+'.json'),encoded);
    const files=(await readdir(directory)).filter(f=>ID.test(f.slice(0,-5))&&f.endsWith('.json'));
    if(files.length>30){const rows=await Promise.all(files.map(async file=>({file,time:(await readJson(join(directory,file)).catch(()=>null))?.startedAt??0})));rows.sort((a,b)=>a.time-b.time);for(const row of rows.slice(0,rows.length-30))await unlink(join(directory,row.file));}
  }
  const probe=new CacheProbe({persist,admit:signal=>storageAdmission.acquire(directory,2*1024*1024,{signal}),prepare:async(options,signal)=>{
    if(!(await models()).some(m=>m.id===options.model))throw new ProbePreparationError('MODEL_UNAVAILABLE');
    const before=fingerprint(),calls=[];
    if(options.fingerprint!==before)throw new ProbePreparationError('CONFIGURATION_CHANGED');
    for(let i=0;i<options.requests;i++){
      const call=await ctx.llm.prepareCall({provider:route(),model:options.model,maxTokens:64},signal);
      if(call.retryPolicy.maxRetries!==0)throw new ProbePreparationError('RETRIES_ENABLED');
      if(call.context?.contextWindow && options.inputBytes+320>call.context.contextWindow)throw new ProbePreparationError('CONTEXT_BUDGET');
      calls.push(call);
    }
    if(before!==fingerprint())throw new ProbePreparationError('CONFIGURATION_CHANGED');
    return {calls,configuration:{fingerprint:createHmac('sha256',key).update(before+':'+options.model).digest('hex'),
      keyScope:createHmac('sha256',key).update('desktop-cache-probe-scope-v1').digest('hex'),...adapterCapabilities(profile())}};
  }});
  ctx.effect(()=>async()=>{if(probe.controller){probe.cancel(probe.current.id);await probe.done;}});
  async function state(){
    await ready;const currentFingerprint=fingerprint();
    const choices=(await models()).map(({id,name})=>({id,name}));
    const caps=Object.fromEntries(choices.map(({id})=>{
      const saved=Object.hasOwn(declarations,id)?declarations[id]:undefined,stale=saved?.fingerprint!==currentFingerprint;
      return [id,{source:saved?'user-declared':'unknown',stale:!!saved&&stale,updatedAt:saved?.updatedAt??null,
        features:Object.fromEntries(FEATURES.map(k=>[k,STATES.includes(saved?.features?.[k])?saved.features[k]:'unknown']))}];
    }));
    return {models:choices,fingerprint:currentFingerprint,capabilities:caps,adapter:adapterCapabilities(profile()),warning:declarationWarning,current:probe.snapshot()};
  }
  async function report(id){
    if(!ID.test(id??''))throw Error('Invalid identity');
    const live=probe.snapshot();if(live?.id===id)return live;
    const stored=await readJson(join(directory,id+'.json'));
    if(stored.id!==id||stored.schemaVersion!==1||!Array.isArray(stored.rows)||stored.rows.length>6||!stored.budget||!stored.summary)throw Error('Invalid report');
    if(stored.status==='RUNNING'){stored.status='INTERRUPTED';stored.error='引擎已退出；最后一次服务端请求结果可能未知，没有自动重跑。';}
    return stored;
  }
  return {probe,state,async handle(req,res,url){
    const json=(code,value)=>res.writeHead(code,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
    if(req.method==='GET'){
      if(url.pathname==='/desktop-diagnostics/cache'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(cacheHtml);return;}
      if(url.pathname==='/desktop-diagnostics/cache.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(cacheScript);return;}
      if(url.pathname==='/desktop-diagnostics/api/cache/state'){json(200,await state());return;}
      if(url.pathname==='/desktop-diagnostics/api/cache/history'){
        const files=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
        const items=[];for(const f of files.filter(f=>f.endsWith('.json')&&ID.test(f.slice(0,-5))).slice(0,100)){
          try{const r=await report(f.slice(0,-5));items.push({id:r.id,status:r.status,startedAt:r.startedAt,model:r.model});}catch{}
        }items.sort((a,b)=>b.startedAt-a.startedAt);json(200,items.slice(0,30));return;
      }
      if(url.pathname==='/desktop-diagnostics/api/cache/report'){json(200,await report(url.searchParams.get('id')));return;}
      if(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('cacheProbe')){
        const r=await report(url.searchParams.get('cacheProbe')),md=url.searchParams.get('format')==='md';
        res.writeHead(200,{'content-type':md?'text/markdown; charset=utf-8':'application/json; charset=utf-8','content-disposition':`attachment; filename="DSH-cache-probe.${md?'md':'json'}"`}).end(md?probeMarkdown(r):JSON.stringify(exportProbe(r),null,2));return;
      }
    }
    if(req.method==='POST'){
      if(req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json'){json(403,{error:'Same-origin JSON required'});return;}
      let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>4096){json(413,{error:'Body too large'});return;}chunks.push(chunk);}
      let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{json(400,{error:'Invalid JSON'});return;}
      if(url.pathname==='/desktop-diagnostics/api/cache/start'){
        if(value?.fingerprint!==fingerprint()){json(409,{error:'连接配置已经变化，请刷新后重新确认探针预算。'});return;}
        try{json(202,probe.start(value));}catch(error){json(409,{error:error.message});}return;
      }
      if(url.pathname==='/desktop-diagnostics/api/cache/cancel'){
        try{probe.cancel(value.id);json(200,{cancelRequested:true});}catch{json(409,{error:'探针已变化，请刷新。'});}return;
      }
      if(url.pathname==='/desktop-diagnostics/api/cache/capabilities'){
        if(value.fingerprint!==fingerprint()){json(409,{error:'连接配置已经变化，请刷新后重新确认能力。'});return;}
        if(typeof value.model!=='string'||!(await models()).some(m=>m.id===value.model)||!value.features||Object.keys(value.features).length!==FEATURES.length||FEATURES.some(k=>!STATES.includes(value.features[k]))){json(400,{error:'能力声明无效'});return;}
        await ready;const commit=writing.catch(()=>{}).then(async()=>{
          const ids=(await models()).map(m=>m.id);
          if(value.fingerprint!==fingerprint()||!ids.includes(value.model))throw Error('连接配置已经变化，请刷新。');
          const next={...Object.fromEntries(Object.entries(declarations).filter(([id])=>ids.includes(id))),[value.model]:{fingerprint:value.fingerprint,updatedAt:Date.now(),features:Object.fromEntries(FEATURES.map(k=>[k,value.features[k]]))}};
          await writeAtomic(declarationPath,JSON.stringify({version:1,models:next}));declarations=next;declarationWarning=null;
        });writing=commit;await commit;json(200,{saved:true});return;
      }
    }
    json(404,{error:'Not found'});
  }};
}
