// Shared by the local UI, archive and runner. Imports are projected, never trusted verbatim.
const text=v=>typeof v==='string'?v.slice(0,256):null;
const number=v=>Number.isFinite(v)&&v>=0?v:null;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{24,64}$/.test(v)?v:null;
const fields=(value,keys,convert)=>Object.fromEntries(keys.map(k=>[k,convert(value?.[k])]));
const numbers=['inputTokens','aggregateInputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','reasoningTokens','totalTokens'];
export function normalizeReport(input) {
  if(!input||![1,2].includes(input.schemaVersion)||!Array.isArray(input.records)||input.records.length>2000)throw Error('Unsupported report or too many requests');
  const records=input.records.map(r=>({
    ...fields(r,['id','session','purpose','startedAt','endedAt','provider','model','effort','status'],text),
    ...fields(r,['durationMs','firstOutputMs','firstTextMs','turn','step','toolCallCount','messageCount','toolCount'],number),
    usage:fields(r.usage,numbers,number),
    fingerprint:{complete:r.fingerprint?.complete===true,...fields(r.fingerprint,['system','tools','toolsSerializationOrder','skillCatalog','projectInstructions','model','config'],hash)},
    continuity:{...fields(r.continuity,['sequence','timeSincePreviousComparableRequest','interveningRequestCount'],number),reasons:(r.continuity?.reasons??[]).slice(0,16).map(text)},
  }));
  const measurement=input.measurement??{};
  return {schemaVersion:2,sourceSchemaVersion:[1,2].includes(input.sourceSchemaVersion)?input.sourceSchemaVersion:input.schemaVersion,
    ...fields(input,['runId','keyScopeId','exportedAt'],text),fingerprintSchemaVersion:number(input.fingerprintSchemaVersion),dropped:number(input.dropped),
    configuration:{...fields(input.configuration,['desktopVersion','dshVersion','nodeVersion','api','connectionId','runtimeManifestHash','overlayHash'],text),
      ...fields(input.configuration,['effectiveSpillBytes','effectiveSkillDescription'],number),repoSummary:input.configuration?.repoSummary===true},
    measurement:{...fields(measurement,['id','label','startedAt','endedAt','session','purpose','acceptanceId'],text),
      quality:['PASS','FAIL','UNKNOWN'].includes(measurement.quality)?measurement.quality:'UNKNOWN',
      acceptanceKind:['external','manual'].includes(measurement.acceptanceKind)?measurement.acceptanceKind:'manual',
      complete:measurement.complete===true,turn:number(measurement.turn),from:number(measurement.from),to:number(measurement.to)},
    workspace:{...fields(input.workspace,['vcs'],text),...fields(input.workspace,['revision','state'],hash),complete:input.workspace?.complete===true},
    records,toolsAvailable:input.toolsAvailable!==false&&Array.isArray(input.tools),tools:(Array.isArray(input.tools)?input.tools:[]).slice(-2000).map(t=>({
      ...fields(t,['id','session','name','parent','startedAt','endedAt','status','targetHash','skillHash','timingSource'],text),
      ...fields(t,['turn','step','durationMs'],number),nested:t.nested===true})),
    toolsDropped:number(input.toolsDropped),
  };
}
export function selectReport(input,scope={}) {
  const report=normalizeReport(input);
  const match=r=>(!scope.session||r.session===scope.session)&&(!scope.purpose||r.purpose===scope.purpose)&&
    (scope.turn==null||r.turn===scope.turn)&&(scope.from==null||Date.parse(r.startedAt)>=scope.from)&&(scope.to==null||Date.parse(r.startedAt)<=scope.to);
  const records=report.records.filter(match),tools=report.tools.filter(t=>match({...t,purpose:'conversation'}));
  if(records.length!==report.records.length||tools.length!==report.tools.length)report.measurement={...report.measurement,complete:false,startedAt:null,endedAt:null};
  report.records=records;report.tools=tools;
  report.measurement={...report.measurement,...fields(scope,['session','purpose'],text),...fields(scope,['turn','from','to'],number)};
  return report;
}
export function unionMs(intervals) {
  const sorted=intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0]);
  let total=0,end=-Infinity;
  for(const [a,b] of sorted){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return total;
}
export function summarize(report) {
  const rows=report.records, sum=field=>{const known=rows.filter(r=>r.usage[field]!=null);return {value:known.length?known.reduce((n,r)=>n+r.usage[field],0):null,known:known.length,total:rows.length};};
  const eligible=rows.filter(r=>r.usage.aggregateInputTokens>0&&r.usage.cacheReadTokens!=null&&r.usage.cacheReadTokens<=r.usage.aggregateInputTokens);
  const total=eligible.reduce((n,r)=>n+r.usage.aggregateInputTokens,0);
  const intervals=rows.map(r=>[Date.parse(r.startedAt),Date.parse(r.startedAt)+r.durationMs]);
  const tools=report.tools??[], top=tools.filter(t=>!t.nested), groups=Object.create(null);
  for(const t of tools){const key=(t.nested?'PTC / ':'')+t.name;const g=groups[key]??={calls:0,completed:0,errors:0,unsettled:0,durationMs:0};g.calls++;g.completed+=t.status==='completed';g.errors+=t.status==='error';g.unsettled+=t.status==='running';g.durationMs+=t.durationMs??0;}
  const seen=new Set();let repeatedReads=0;
  for(const t of tools.filter(t=>t.name==='read'&&t.targetHash)){const k=t.session+':'+t.targetHash;if(seen.has(k))repeatedReads++;seen.add(k);}
  const start=Date.parse(report.measurement?.startedAt),end=Date.parse(report.measurement?.endedAt);
  return {requests:rows.length,...Object.fromEntries(numbers.map(k=>[k,sum(k)])),
    cacheRate:{value:total?eligible.reduce((n,r)=>n+r.usage.cacheReadTokens,0)/total:null,known:eligible.length,total:rows.length},
    wallMs:Number.isFinite(start)&&end>=start?end-start:null,
    requestUnionMs:unionMs(intervals),toolUnionMs:report.toolsAvailable===false?null:unionMs(top.filter(t=>t.durationMs!=null).map(t=>[Date.parse(t.startedAt),Date.parse(t.startedAt)+t.durationMs])),
    toolCalls:report.toolsAvailable===false?null:top.length,nestedCalls:report.toolsAvailable===false?null:tools.length-top.length,toolGroups:groups,repeatedReads:report.toolsAvailable===false?null:repeatedReads,
    skillLoads:report.toolsAvailable===false?null:tools.filter(t=>t.name==='skill').length,toolErrors:report.toolsAvailable===false?null:tools.filter(t=>t.status==='error').length};
}
export function compareReports(aInput,bInput) {
  const a=normalizeReport(aInput),b=normalizeReport(bInput),checks=[];
  const add=(name,x,y,experiment=false)=>checks.push({name,a:x??null,b:y??null,result:x==null||y==null?'UNKNOWN':JSON.stringify(x)===JSON.stringify(y)?'SAME':experiment?'EXPERIMENT':'DIFFERENT'});
  add('fingerprint version',a.fingerprintSchemaVersion,b.fingerprintSchemaVersion);add('key scope',a.keyScopeId,b.keyScopeId);
  const comparable=a.keyScopeId&&a.keyScopeId===b.keyScopeId&&a.fingerprintSchemaVersion===b.fingerprintSchemaVersion;
  for(const k of ['desktopVersion','dshVersion','nodeVersion','runtimeManifestHash','overlayHash','connectionId','effectiveSpillBytes','effectiveSkillDescription','repoSummary'])add(k,a.configuration[k],b.configuration[k],['effectiveSpillBytes','effectiveSkillDescription','repoSummary'].includes(k));
  for(const k of ['provider','model','effort'])add(k,unique(a.records,k),unique(b.records,k));
  for(const k of ['system','tools','skillCatalog','projectInstructions'])add(k,comparable?fingerprints(a,k):null,comparable?fingerprints(b,k):null);
  for(const k of ['revision','state'])add('workspace '+k,comparable&&a.workspace.complete?a.workspace[k]:null,comparable&&b.workspace.complete?b.workspace[k]:null);
  const validity=checks.some(c=>c.result==='DIFFERENT')?'NOT_MATCHED':checks.some(c=>c.result==='UNKNOWN')?'PARTIALLY_MATCHED':'MATCHED';
  const quality=a.measurement.quality==='PASS'&&b.measurement.quality==='PASS'&&a.measurement.acceptanceKind==='external'&&b.measurement.acceptanceKind==='external'&&a.measurement.acceptanceId&&a.measurement.acceptanceId===b.measurement.acceptanceId;
  const sa=summarize(a),sb=summarize(b),deltas={};
  for(const k of ['requests','wallMs','toolCalls','aggregateInputTokens','inputTokens','outputTokens']){
    const x=sa[k]&&typeof sa[k]==='object'?sa[k].value:sa[k],y=sb[k]&&typeof sb[k]==='object'?sb[k].value:sb[k];
    const coverageComplete=sa[k]&&typeof sa[k]==='object'?sa[k].total>0&&sa[k].known===sa[k].total&&sb[k].known===sb[k].total:k==='toolCalls'?a.toolsAvailable&&b.toolsAvailable&&a.toolsDropped===0&&b.toolsDropped===0:k==='wallMs'?a.measurement.complete&&b.measurement.complete:true;
    deltas[k]={a:x,b:y,percent:x>0&&y!=null?(y-x)/x*100:null,coverageComplete:!!coverageComplete};
  }
  return {schemaVersion:2,kind:'comparison',validity,quality:quality?'SAME_ACCEPTANCE_PASS':'NOT_QUALITY_EQUIVALENT',
    efficiencyEligible:!!quality&&a.measurement.complete&&b.measurement.complete&&validity!=='NOT_MATCHED'&&Object.values(deltas).every(d=>d.coverageComplete),
    checks,deltas,a:sa,b:sb,limitations:['PASS means the same acceptance checks passed, not proof of equal quality.','Unknown coverage is not zero. Local continuity is not provider cache state.','Tool spans include dispatch/wait; overlapping durations are not additive.']};
}
function unique(rows,k){const list=[...new Set(rows.map(r=>r[k]))];return list.length&&list.every(Boolean)?list.sort():null;}
function fingerprints(report,k){return report.records.length&&report.records.every(r=>r.fingerprint.complete&&r.fingerprint[k])?[...new Set(report.records.map(r=>r.fingerprint[k]))].sort():null;}
export function comparisonMarkdown(result) {
  const safe=v=>String(v??'—').replace(/[|\r\n`<>]/g,' ');
  return ['# DSHDesktop A/B',`${result.validity} · ${result.quality}`, 'B 相对 A；负数表示减少。缺失覆盖和不同质量不能解释为效率提升。',
    '| Metric | A | B | Change % |','|---|---|---|---|',...Object.entries(result.deltas).map(([k,v])=>`| ${k} | ${safe(v.a)} | ${safe(v.b)} | ${v.percent?.toFixed(2)??'—'} |`),
    '',...result.checks.map(c=>`- ${c.name}: ${c.result}`),'',...result.limitations].join('\n');
}
