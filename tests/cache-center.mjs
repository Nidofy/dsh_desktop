import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {installCacheCenter} from '../runtime-src/cache-center.mjs';
const home=await mkdtemp(resolve('.build/cache-center-')),savedEnv=process.env.CACHE_PROBE_UNIT_KEY;
let provider={api:'openai-completions',baseURL:'http://synthetic.invalid/v1',apiKeyEnv:'CACHE_PROBE_UNIT_KEY',cacheRetention:'short'},prepared=0,sent=0,retry=0,mutate=false,cleanup;
const ctx={get:()=>({get:()=>({providers:{'desktop-internal':provider}})}),effect:fn=>{cleanup=fn();},llm:{
  async listModels(){return [{id:'model-a',name:'Test A'},{id:'constructor',name:'Prototype key'}];},
  async prepareCall(config){prepared++;if(mutate){mutate=false;provider={...provider,cacheRetention:'long'};}return {config,retryPolicy:{maxRetries:retry},context:{contextWindow:65536},async *stream(){sent++;yield {type:'usage',usage:{inputTokens:10,outputTokens:2,totalTokens:12}};yield {type:'finish',reason:{kind:'stop'}};}};}
}};
process.env.CACHE_PROBE_UNIT_KEY='synthetic-a';
const center=installCacheCenter(ctx,home,Buffer.alloc(32,7));center.probe.pause=async()=>{};
async function api(path,body,headers={}){
  let code,text;const req={method:body===undefined?'GET':'POST',headers:{host:'127.0.0.1:1234',origin:'http://127.0.0.1:1234','content-type':'application/json',...headers},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  const res={writeHead(c){code=c;return this;},end(v){text=v;return this;}};
  await center.handle(req,res,new URL('http://127.0.0.1:1234/desktop-diagnostics/api/cache/'+path));
  return {code,data:JSON.parse(text)};
}
try{
  let state=(await api('state')).data;assert.equal(prepared,0);assert.equal(sent,0);assert.equal(state.capabilities.constructor.source,'unknown');
  const first=state.fingerprint;process.env.CACHE_PROBE_UNIT_KEY='synthetic-b';state=(await api('state')).data;assert.notEqual(first,state.fingerprint,'credential rotation invalidates capability declarations without exposing credentials');
  assert(!JSON.stringify(state).includes('synthetic-b'));assert(!JSON.stringify(state).includes('synthetic.invalid'));
  const features={automaticCaching:'supported',promptCacheKey:'unknown',cacheControl:'unsupported',longRetention:'unknown'};
  assert.equal((await api('capabilities',{model:'model-a',fingerprint:state.fingerprint,features})).code,200);
  assert.equal((await api('state')).data.capabilities['model-a'].source,'user-declared');
  const request={model:'model-a',fingerprint:state.fingerprint,inputBytes:2048,requests:4,accepted:true};
  assert.equal((await api('start',request,{origin:'https://elsewhere.invalid'})).code,403);assert.equal(sent,0);
  assert.equal((await api('start',{...request,fingerprint:first})).code,409);assert.equal(sent,0);
  assert.equal((await api('start',request)).code,202);await center.probe.done;assert.equal(sent,4);assert.equal(center.probe.snapshot().status,'COMPLETED');
  assert.equal((await api('history')).data.length,1);
  const record=(await api('report?id='+center.probe.current.id)).data;assert.equal(record.summary.conclusion,'INCONCLUSIVE');
  retry=1;await api('start',request);await center.probe.done;assert.equal(center.probe.snapshot().status,'REFUSED');assert.equal(sent,4,'retry-enabled adapter refused before dispatch');retry=0;
  mutate=true;await api('start',request);await center.probe.done;assert.equal(center.probe.snapshot().status,'REFUSED');assert.equal(sent,4,'configuration change while preparing refuses all calls');
  assert.equal((await api('state')).data.capabilities['model-a'].stale,true);
  ctx.llm.listProviders=()=>[];assert.deepEqual((await api('state')).data.models,[],'unconfigured connection renders an empty model list without network requests');
}finally{await cleanup();if(savedEnv===undefined)delete process.env.CACHE_PROBE_UNIT_KEY;else process.env.CACHE_PROBE_UNIT_KEY=savedEnv;}
console.log('PASS cache center: read-only state, metadata-only declarations, credential/config invalidation, cross-origin rejection, normal adapter dispatch, retry/config-change refusal before requests, persistence');
