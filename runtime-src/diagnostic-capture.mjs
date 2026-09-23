import {createHmac, randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

export const fingerprintSchemaVersion = 1;
const MAX_BYTES = 4 * 1024 * 1024, MAX_MESSAGES = 2048;
export function fingerprintRequest(options, key, configuration = {}, limits = {}) {
  const start = performance.now(), budget = {bytes:0, nodes:0};
  const maxBytes = limits.maxBytes ?? MAX_BYTES, deadline = start + (limits.maxMs ?? 16);
  function digest(value, ordered = false) {
    const h = createHmac('sha256', key).update('DSHDesktop:fingerprint:v1\0');
    function put(s) {
      budget.bytes += Buffer.byteLength(s);
      if (budget.bytes > maxBytes || performance.now() > deadline) throw new Error('budget');
      h.update(s);
    }
    function visit(v, depth = 0) {
      if (++budget.nodes > 100000 || depth > 64) throw new Error('budget');
      if (v === null || typeof v === 'boolean' || typeof v === 'number') {
        if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('unsupported');
        put(JSON.stringify(v));
      } else if (typeof v === 'string') {
        // Reject before allocating the escaped representation of a huge string.
        if (v.length > maxBytes - budget.bytes) throw new Error('budget');
        put(JSON.stringify(v));
      } else if (Array.isArray(v)) {
        if (v.length > 100000) throw new Error('budget');
        put('['); for (let i=0;i<v.length;i++) {if(i)put(',');visit(v[i],depth+1);} put(']');
      } else if (v && Object.getPrototypeOf(v) === Object.prototype) {
        const keys = Object.keys(v).filter(k => v[k] !== undefined);
        if (!ordered) keys.sort();
        put('{'); for(let i=0;i<keys.length;i++) {if(i)put(',');put(JSON.stringify(keys[i]));put(':');visit(v[keys[i]],depth+1);} put('}');
      } else throw new Error('unsupported');
    }
    visit(value); return h.digest('hex');
  }
  const result = {complete:false, messages:[]};
  try {
    if (!Array.isArray(options.messages) || options.messages.length > MAX_MESSAGES) throw new Error('budget');
    result.system = digest({system:options.system ?? null, messages:options.messages.filter(m => m.role === 'system')});
    result.tools = digest(options.tools ?? []);
    result.toolsSerializationOrder = digest(options.tools ?? [], true);
    result.skillCatalog = digest(options.messages.filter(m=>m.source?.kind==='skill-catalog').map(m=>({content:m.content,source:m.source})));
    result.projectInstructions = digest(options.messages.filter(m=>m.source?.kind==='agent-instructions').map(m=>({content:m.content,source:m.source})));
    result.model = digest({provider:options.provider,model:options.model});
    result.config = digest({configuration,reasoningEffort:options.reasoningEffort ?? null,
      temperature:options.temperature ?? null,maxTokens:options.maxTokens ?? null,stop:options.stop ?? null});
    for (const message of options.messages) result.messages.push(digest(message));
    result.complete = true;
  } catch { result.incompleteReason = 'budget-or-unsupported-value'; }
  result.analyzedBytes = budget.bytes;
  result.analysisMs = performance.now() - start;
  return result;
}
export function classify(previous, current) {
  const facts = [];
  if (current.purpose === 'compaction') facts.push('COMPACTION');
  if (!previous || !previous.fingerprint.complete || !current.fingerprint.complete) return {facts:[...facts,'NOT_COMPARABLE']};
  const a = previous.fingerprint, b = current.fingerprint;
  for (const [field,fact] of [['system','SYSTEM_CHANGED'],['tools','TOOLS_CHANGED'],['model','MODEL_CHANGED'],['config','CONFIG_CHANGED']]) {
    if(a[field] !== b[field]) facts.push(fact);
  }
  if (a.tools === b.tools && a.toolsSerializationOrder !== b.toolsSerializationOrder) facts.push('TOOLS_SERIALIZATION_ORDER_CHANGED');
  let prefix = 0;
  while (prefix < a.messages.length && prefix < b.messages.length && a.messages[prefix] === b.messages[prefix]) prefix++;
  if (prefix !== a.messages.length || prefix !== b.messages.length) facts.push('MESSAGES_CHANGED');
  return {previousRequestId:previous.id, facts:facts.length ? facts : ['NO_LOCAL_CHANGE'],
    unchangedMessagePrefix:prefix, firstChangedMessage:prefix < Math.max(a.messages.length,b.messages.length) ? prefix : null};
}
const tokenFields = ['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'];
export function usageMetadata(usage) {
  const fields = Object.fromEntries(tokenFields.map(k => [k, Number.isSafeInteger(usage?.[k]) && usage[k] >= 0 ? usage[k] : null]));
  // Missing cache counters remain unknown; do not invent a zero cache hit rate.
  const aggregateInput = fields.totalTokens !== null && fields.outputTokens !== null && fields.totalTokens >= fields.outputTokens
    ? fields.totalTokens - fields.outputTokens : null;
  return {...fields, aggregateInputTokens:aggregateInput, source:'dsh-adapter',
    cacheReporting:fields.cacheReadTokens === null ? 'unavailable-at-logical-boundary' : 'reported',
    aggregateInputSource:aggregateInput === null ? 'unavailable' : 'derived-from-total-minus-output'};
}
export class Capture {
  constructor({key,configuration={},maxRecords=500,maxBytes=10*1024*1024}) {
    this.key=key;this.configuration=configuration;this.maxRecords=maxRecords;this.maxBytes=maxBytes;
    this.records=[];this.bytes=0;this.active=new Map();this.dropped=0;this.failures=0;this.runId=randomUUID();
    this.keyScopeId=this.id('scope-v1');
    this.sequence=0;this.continuity=new Map();
  }
  id(value) { return createHmac('sha256',this.key).update(Buffer.isBuffer(value)?value:String(value)).digest('hex').slice(0,24); }
  begin(options,configuration=this.configuration) {
    if(this.active.size>=64) {this.dropped++;return null;}
    const session=options.sessionId ? this.id(options.sessionId) : null;
    const purpose=['compaction','session-title'].includes(options.purpose) ? options.purpose : options.sessionId ? 'conversation' : 'unknown';
    const record={id:randomUUID(),session,purpose,startedAt:new Date().toISOString(),
      provider:String(options.provider ?? '').slice(0,256),model:String(options.model ?? '').slice(0,256),
      effort:['off','minimal','low','medium','high','xhigh','max'].includes(options.reasoningEffort) ? options.reasoningEffort : 'unspecified-or-custom',
      messageCount:options.messages?.length ?? 0,toolCount:options.tools?.length ?? 0,
      fingerprint:fingerprintRequest(options,this.key,configuration),status:'running',usage:usageMetadata(null),
      firstOutputMs:null,firstTextMs:null,toolCallCount:0};
    const previous=session ? this.records.findLast(r=>r.session===session&&r.purpose===purpose) : undefined;
    record.comparison=classify(previous,record);
    const scope=session ? session+':'+purpose : null, last=this.continuity.get(scope), sequence=++this.sequence;
    const reasons=[];
    if(!last)reasons.push(session?'SESSION_START':'UNKNOWN');
    if(sequence===1)reasons.push('ENGINE_RESTART');
    if(last) {
      for(const [field,fact] of [['model','MODEL_CHANGED'],['provider','PROVIDER_CHANGED'],['effort','EFFORT_CHANGED']])if(last[field]!==record[field])reasons.push(fact);
      if(Date.now()-last.time>300000)reasons.push('LONG_IDLE');
      if(sequence-last.sequence>1)reasons.push('INTERLEAVED_REQUEST');
    }
    record.continuity={reasons:reasons.length?reasons:['CONTINUE'],sequence,
      timeSincePreviousComparableRequest:last?Date.now()-last.time:null,interveningRequestCount:last?sequence-last.sequence-1:null};
    if(scope){this.continuity.delete(scope);this.continuity.set(scope,{time:Date.now(),sequence,model:record.model,provider:record.provider,effort:record.effort});if(this.continuity.size>500)this.continuity.delete(this.continuity.keys().next().value);}
    this.active.set(record.id,record);return record;
  }
  finish(record) {
    if(!this.active.delete(record.id))return;
    record.endedAt=new Date().toISOString();
    const bytes=Buffer.byteLength(JSON.stringify(record));
    if(bytes>this.maxBytes){this.dropped++;return;}
    this.records.push(record);this.bytes+=bytes;
    while(this.records.length>this.maxRecords||this.bytes>this.maxBytes) {
      this.bytes-=Buffer.byteLength(JSON.stringify(this.records.shift()));this.dropped++;
    }
  }
  clear() {this.records=[];this.bytes=0;this.active.clear();this.continuity.clear();this.dropped=0;}
  snapshot() {return {schemaVersion:2,fingerprintSchemaVersion,runId:this.runId,keyScopeId:this.keyScopeId,
    configuration:this.configuration,limits:{maxRecords:this.maxRecords,maxBytes:this.maxBytes,maxActive:64},
    retainedBytes:this.bytes,dropped:this.dropped,observerFailures:this.failures,
    records:[...this.records,...this.active.values()]};}
}
export function observeStream(capture, options, next, onBegin = () => {}, configuration=capture.configuration) {
  const configurationSnapshot=structuredClone(configuration);
  return (async function* () {
    let record;const started=performance.now();
    const safely=fn=>{try{fn();}catch{capture.failures++;}};
    safely(()=>{record=capture.begin(options,configurationSnapshot);if(record)onBegin(record);});
    try {
      for await (const chunk of await next()) {
        if(record) safely(()=>{
          const elapsed=performance.now()-started;
          if ((chunk.type==='text-delta'&&chunk.text)||(chunk.type==='reasoning-delta'&&chunk.text)||(chunk.type==='tool-call-delta'&&chunk.argumentsDelta)) record.firstOutputMs ??= elapsed;
          if(chunk.type==='text-delta'&&chunk.text)record.firstTextMs ??= elapsed;
          if(chunk.type==='block-start'&&chunk.blockType==='tool-call')record.toolCallCount++;
          if(chunk.type==='usage')record.usage=usageMetadata(chunk.usage);
          if(chunk.type==='finish') {
            record.status=['stop','tool-calls','max-tokens','aborted','error'].includes(chunk.reason?.kind)?chunk.reason.kind:'other-finish';
            const status=chunk.reason?.failure?.status;
            if(Number.isInteger(status)&&status>=100&&status<=599)record.httpStatus=status;
          }
        });
        yield chunk; // The original object, untouched; return/cancel closes the underlying iterator.
      }
    } catch(error) {if(record)record.status=options.signal?.aborted?'aborted':'error';throw error;}
    finally {if(record)safely(()=>{
      if(record.status==='running')record.status=options.signal?.aborted?'aborted':'closed-without-finish';
      record.durationMs=performance.now()-started;capture.finish(record);
    });}
  })();
}
