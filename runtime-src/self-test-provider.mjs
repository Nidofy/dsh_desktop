import {CacheProbe,ProbePreparationError} from './cache-probe.mjs';
import {CheckResult,requireCheck,selfTestSessionPrefix} from './self-test.mjs';

export function providerSelfTests(ctx,cache){return async({options,signal,check,report})=>{
 let probeResult,toolCall;
 const unchanged=async()=>{if((await cache.state()).fingerprint!==options.fingerprint)throw new CheckResult('FAIL','CONFIGURATION_CHANGED');};
 await check('connection',async()=>{
  await unchanged();
  // Freeze all five calls before dispatch and refuse hidden adapter retries.
  toolCall=await ctx.llm.prepareCall({provider:'desktop-internal',model:options.model,maxTokens:64},signal);
  if(toolCall.retryPolicy.maxRetries!==0)throw new CheckResult('FAIL','RETRIES_ENABLED');
  let prepared;try{prepared=await cache.probe.prepare({...options,inputBytes:2048,requests:4},signal);}catch(error){throw new CheckResult('FAIL',error instanceof ProbePreparationError&&['RETRIES_ENABLED','CONFIGURATION_CHANGED'].includes(error.code)?error.code:'PROVIDER_FAILED');}
  await unchanged();
  const calls=prepared.calls.map(call=>({...call,async *stream(input){await unchanged();yield* call.stream(input);}}));
  const probe=new CacheProbe({prepare:async()=>({...prepared,calls})});
  const stop=()=>{if(probe.controller)probe.cancel(probe.current.id);};signal.addEventListener('abort',stop,{once:true});
  try{signal.throwIfAborted();probe.start({model:options.model,requests:4,inputBytes:2048,accepted:true});await probe.done;probeResult=probe.snapshot();report.configurationFingerprint=probeResult.configuration?.fingerprint??report.configurationFingerprint;
    if(probeResult.status!=='COMPLETED')throw new CheckResult('FAIL','PROVIDER_FAILED');return {metrics:{requests:probeResult.rows.length}};
  }finally{signal.removeEventListener('abort',stop);stop();}
 });
 await check('streaming',async()=>{if(!probeResult?.rows.length)throw new CheckResult('SKIPPED','PROVIDER_FAILED');requireCheck(probeResult.status==='COMPLETED'&&probeResult.rows.every(row=>row.firstOutputMs!==null&&['COMPLETED','OUTPUT_LIMIT'].includes(row.status)));return {metrics:{requests:probeResult.rows.length}};});
 await check('tool-call',async()=>{
  if(probeResult?.status!=='COMPLETED'||!toolCall)throw new CheckResult('SKIPPED','PROVIDER_FAILED');await unchanged();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort('TIMEOUT'),45000);timer.unref?.();const toolSignal=AbortSignal.any([signal,controller.signal]);let finish,blocks=[],outputBytes=0;
  try{for await(const chunk of toolCall.stream({...toolCall.config,signal:toolSignal,sessionId:selfTestSessionPrefix+report.id,
    messages:[{id:'synthetic-tool-check',role:'user',content:[{type:'text',text:'Synthetic self-test. Call desktop_self_test_echo exactly once with value "SYNTHETIC_OK". Do not return prose.'}],source:{kind:'plugin',plugin:'desktop-self-test'}}],
    tools:[{name:'desktop_self_test_echo',description:'Synthetic protocol check. Returns the fixed supplied string; performs no external action.',parameters:{type:'object',properties:{value:{type:'string',enum:['SYNTHETIC_OK']}},required:['value'],additionalProperties:false}}],
  })){
    outputBytes+=Buffer.byteLength(JSON.stringify(chunk));if(outputBytes>65536){controller.abort();throw new CheckResult('FAIL','PROVIDER_FAILED');}
    if(chunk.type==='block-end'&&chunk.block.type==='tool-call')blocks.push(chunk.block);
    if(chunk.type==='finish')finish=chunk.reason?.kind;
  }
  if(finish==='max-tokens')throw new CheckResult('UNKNOWN','OUTPUT_LIMIT');
  requireCheck(finish==='tool-calls'&&blocks.length===1&&blocks[0].name==='desktop_self_test_echo');const args=JSON.parse(blocks[0].arguments);requireCheck(args.value==='SYNTHETIC_OK'&&Object.keys(args).length===1);return {metrics:{requests:1}};
  }finally{clearTimeout(timer);controller.abort();}
 });
 await check('cache-counter',async()=>{if(!probeResult?.rows.length)throw new CheckResult('SKIPPED','PROVIDER_FAILED');const coverage=probeResult.summary.adapterCounterCoverage;if(!coverage)throw new CheckResult('UNKNOWN','NO_COUNTER');return {metrics:{requests:probeResult.rows.length,counterCoverage:coverage}};});
 await check('cache-repeat',async()=>{if(probeResult?.status!=='COMPLETED')throw new CheckResult('SKIPPED','PROVIDER_FAILED');const positive=probeResult.summary.repeatPositiveReadRequests;if(!positive)throw new CheckResult('UNKNOWN','NO_POSITIVE_CACHE_READ');return {metrics:{positiveRepeatReads:positive}};});
};}
