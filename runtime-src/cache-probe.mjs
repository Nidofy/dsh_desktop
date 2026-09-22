import {randomUUID,createHash} from 'node:crypto';
import {usageMetadata} from './diagnostic-capture.mjs';

export const probeSessionPrefix='desktop-cache-probe-';
export class ProbePreparationError extends Error {
  constructor(code){super(code);this.code=code;}
}
class ProbePersistenceError extends Error {}
const preparationMessages={MODEL_UNAVAILABLE:'所选模型已不可用，请刷新模型列表。',RETRIES_ENABLED:'此连接启用了自动重试，无法保证探针请求上限；请恢复桌面连接的零重试配置后再运行。',CONTEXT_BUDGET:'合成输入超过保守上下文预算，请选择更短的输入。',CONFIGURATION_CHANGED:'准备期间连接配置发生变化，探针未发出；请刷新后重试。'};
export function validateProbe(input){
  if(!input||Object.keys(input).some(k=>!['model','inputBytes','requests','accepted','fingerprint'].includes(k))||input.accepted!==true)throw Error('请确认合成探针的请求预算。');
  if(typeof input.model!=='string'||!input.model.length||input.model.length>256)throw Error('请选择模型。');
  if(![2048,8192,32768].includes(input.inputBytes)||![4,6].includes(input.requests))throw Error('探针预算无效。');
  if(input.fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(input.fingerprint))throw Error('配置标识无效。');
  return {model:input.model,inputBytes:input.inputBytes,requests:input.requests,...(input.fingerprint?{fingerprint:input.fingerprint}:{})};
}
export function syntheticInput(runId,group,bytes){
  // Each group diverges near byte zero, before any realistic cache block. The
  // suffix is stable across repeats. No date, workspace, rules or live history.
  const seed=createHash('sha256').update(runId+':'+group).digest('hex');
  let text=seed+'\nSynthetic cache measurement. Read the data and reply only OK.\n';
  for(let i=0;text.length<bytes;i++)text+=createHash('sha256').update(seed+':'+i).digest('hex')+' This is synthetic measurement data.\n';
  return text.slice(0,bytes);
}
export function summarizeProbe(rows){
  const withUsage=rows.filter(r=>r.usage.cacheReadTokens!==null);
  const positive=rows.filter(r=>r.usage.cacheReadTokens>0);
  const repeated=rows.filter(r=>r.repeat>1);
  return {requests:rows.length,adapterCounterCoverage:withUsage.length,positiveReadRequests:positive.length,
    repeatPositiveReadRequests:repeated.filter(r=>r.usage.cacheReadTokens>0).length,
    conclusion:positive.length?'ADAPTER_REPORTED_CACHE_READ':'INCONCLUSIVE',
    rawProviderCounterCoverage:'UNKNOWN',
    note:'计数来自 DSH 适配层。零值可能是未命中或适配层补零；接口接受字段、耗时降低均不能单独证明缓存生效。'};
}
export class CacheProbe {
  constructor({prepare,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),persist=async()=>{},setTimer=setTimeout,clearTimer=clearTimeout,admit=async()=>({run:work=>work(),release:async()=>{}})}){
    this.prepare=prepare;this.now=now;this.pause=pause;this.persist=persist;this.current=null;this.controller=null;
    this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.admit=admit;
  }
  start(input){
    const options=validateProbe(input);
    if(this.controller)throw Error('已有探针正在运行，请等待结束或取消。');
    const id=randomUUID(),controller=new AbortController();this.controller=controller;
    const report={schemaVersion:1,id,status:'RUNNING',startedAt:this.now(),model:options.model,
      budget:{...options,maxOutputTokensPerRequest:64,totalInputBytes:options.inputBytes*options.requests,timeoutMs:120000,retries:0},
      rows:[],summary:summarizeProbe([])};
    this.current=report;
    this.done=this.run(report,options,controller).finally(()=>{this.controller=null;});
    return this.snapshot();
  }
  snapshot(){return this.current?structuredClone(this.current):null;}
  cancel(id){if(!this.current||!this.controller||this.current.id!==id)throw Error('探针已变化，请刷新。');this.controller.abort('USER_CANCELLED');}
  async run(report,options,controller){
    let lease;try{lease=await this.admit(controller.signal);}catch{report.status=controller.signal.aborted?'CANCELLED':'REFUSED';report.error='本机记录空间不足或无法确认，探针未发送请求。';report.endedAt=this.now();return;}
    try{return await lease.run(()=>this.runReserved(report,options,controller));}finally{await lease.release().catch(()=>{report.persistenceWarning='存储预留释放未确认，请查看本机存储总览。';});}
  }
  async runReserved(report,options,controller){
    const timer=this.setTimer(()=>controller.abort('TIMEOUT'),report.budget.timeoutMs);timer?.unref?.();
    const signal=controller.signal;
    const checkpoint=async()=>{try{await this.persist(this.snapshot());}catch{throw new ProbePersistenceError();}};
    try{
      await checkpoint();
      // Preparation must freeze all calls against one unchanged configuration
      // and refuse automatic retries before any charged network request starts.
      const prepared=await this.prepare(options,signal);
      if(signal.aborted)throw Error('Aborted');
      report.configuration=prepared.configuration;
      for(let i=0;i<options.requests;i++){
        if(signal.aborted)break;
        const group=i<options.requests/2?'A':'B',repeat=i%(options.requests/2)+1;
        const began=this.now(),row={group,repeat,status:'RUNNING',firstOutputMs:null,durationMs:null,usage:usageMetadata(null)};
        report.rows.push(row);
        try{
          const text=syntheticInput(report.id,group,options.inputBytes);
          const call=prepared.calls[i];
          const stream=call.stream({...call.config,signal,sessionId:probeSessionPrefix+report.id+'-'+group,
            messages:[{id:report.id+'-'+group,role:'user',content:[{type:'text',text}],source:{kind:'plugin',plugin:'desktop-cache-probe'}}]});
          for await(const chunk of stream){
            if(signal.aborted)break;
            if(row.firstOutputMs===null&&['text-delta','reasoning-delta','tool-call-delta'].includes(chunk.type))row.firstOutputMs=this.now()-began;
            if(chunk.type==='usage')row.usage=usageMetadata(chunk.usage);
            if(chunk.type==='finish'){
              row.status={stop:'COMPLETED','max-tokens':'OUTPUT_LIMIT','tool-calls':'UNEXPECTED_TOOL_CALL',error:'FAILED',aborted:'CANCELLED'}[chunk.reason?.kind]??'UNKNOWN';
              const code=chunk.reason?.failure?.status;if(Number.isInteger(code)&&code>=100&&code<=599)row.httpStatus=code;
            }
          }
        }catch{row.status=signal.aborted?'CANCELLED':'FAILED';}
        finally{row.durationMs=this.now()-began;if(row.status==='RUNNING')row.status=signal.aborted?'CANCELLED':'UNKNOWN';report.summary=summarizeProbe(report.rows);}
        await checkpoint();
        if(!['COMPLETED','OUTPUT_LIMIT'].includes(row.status))break;
        if(i+1<options.requests&&!signal.aborted)await this.pause(500);
      }
      report.status=signal.aborted?(signal.reason==='TIMEOUT'?'TIMEOUT':'CANCELLED'):report.rows.length===options.requests&&report.rows.every(r=>['COMPLETED','OUTPUT_LIMIT'].includes(r.status))?'COMPLETED':'FAILED';
    }catch(error){
      report.status=signal.aborted?(signal.reason==='TIMEOUT'?'TIMEOUT':'CANCELLED'):report.rows.length?'FAILED':'REFUSED';
      report.error=error instanceof ProbePersistenceError?(report.rows.length?'结果保存失败，探针已停止；已发出的请求仍可能计费。':'无法保存运行记录，探针未向服务发送请求。'):error instanceof ProbePreparationError?preparationMessages[error.code]??'探针准备失败。':'探针未能按限定预算准备或执行；请检查连接状态、模型及重试设置。';
    }
    finally{
      this.clearTimer(timer);report.endedAt=this.now();report.summary=summarizeProbe(report.rows);
      try{await this.persist(this.snapshot());}catch{report.persistenceWarning='探针已结束，但结果未能保存。';}
    }
  }
}
export function exportProbe(report){
  // Local UI can show a model ID; shareable exports contain no endpoint, model,
  // profile name, session ID, output text, credential or administrator note.
  const valid=validateProbe({model:'redacted',inputBytes:report.budget.inputBytes,requests:report.budget.requests,accepted:true});
  const number=value=>Number.isFinite(value)&&value>=0?value:null;
  const statuses=['RUNNING','COMPLETED','FAILED','REFUSED','TIMEOUT','CANCELLED','UNKNOWN','INTERRUPTED','OUTPUT_LIMIT','UNEXPECTED_TOOL_CALL'];
  const rows=report.rows.slice(0,6).map(r=>({group:['A','B'].includes(r.group)?r.group:'UNKNOWN',repeat:[1,2,3].includes(r.repeat)?r.repeat:null,
    status:statuses.includes(r.status)?r.status:'UNKNOWN',firstOutputMs:number(r.firstOutputMs),durationMs:number(r.durationMs),usage:usageMetadata(r.usage)}));
  const budget={inputBytes:valid.inputBytes,requests:valid.requests,maxOutputTokensPerRequest:64,totalInputBytes:valid.inputBytes*valid.requests,timeoutMs:120000,retries:0};
  return {schemaVersion:1,kind:'synthetic-cache-probe',status:statuses.includes(report.status)?report.status:'UNKNOWN',budget,rows,
    summary:summarizeProbe(rows),configurationFingerprint:/^[a-f0-9]{64}$/.test(report.configuration?.fingerprint)?report.configuration.fingerprint:null,
    keyScope:/^[a-f0-9]{64}$/.test(report.configuration?.keyScope)?report.configuration.keyScope:null,
    api:['openai-completions','anthropic-messages'].includes(report.configuration?.api)?report.configuration.api:'unknown',startedAt:number(report.startedAt),endedAt:number(report.endedAt)};
}
export function probeMarkdown(report){
  const r=exportProbe(report);
  return ['# DSH 合成缓存探针',`状态：${r.status}`,`结论：${r.summary.conclusion}`,r.summary.note,
    `适配层缓存计数覆盖：${r.summary.adapterCounterCoverage}/${r.summary.requests}；原始服务计数覆盖：UNKNOWN`,
    '', '| 组 | 重复 | 状态 | 缓存读取 tokens | 首输出 ms | 总耗时 ms |','|---|---:|---|---:|---:|---:|',
    ...r.rows.map(v=>`| ${v.group} | ${v.repeat} | ${v.status} | ${v.usage.cacheReadTokens??'未知'} | ${v.firstOutputMs??'未知'} | ${v.durationMs??'未知'} |`),''].join('\n');
}
