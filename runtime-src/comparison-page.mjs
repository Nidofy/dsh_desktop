export const comparisonHtml=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSHDesktop · A/B 实验</title>
<style>body{margin:0}main{max-width:1400px;margin:auto;padding:28px}h1{margin:0}h2{font-size:19px}p,small{color:var(--dsw-alias-label-tertiary)}a{color:var(--dsw-alias-link)}button,select,input{font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:7px;max-width:100%;box-sizing:border-box}button{cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}section{padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:16px 0;background:var(--dsw-alias-bg-base)}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}label{display:flex;gap:6px;align-items:center;flex-wrap:wrap}table{border-collapse:collapse;width:100%}td,th{padding:7px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2)}.scroll{overflow:auto}#notice{color:var(--dsw-alias-state-warn-label);min-height:24px}.timeline{max-height:430px;overflow:auto}.lane{display:grid;grid-template-columns:170px 1fr;align-items:center;height:29px;font-size:12px}.track{height:14px;background:var(--dsw-alias-bg-module-platform);position:relative}.bar{height:100%;position:absolute;min-width:2px;background:var(--dsw-alias-state-business-primary)}.tool{background:var(--dsw-alias-state-success-primary)}.first{position:absolute;height:100%;background:var(--dsw-alias-state-warn-primary);left:0;top:0}.status{padding:12px;background:var(--dsw-alias-bg-module-platform)}.label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}@media(max-width:850px){.grid{grid-template-columns:1fr}main{padding:14px}}</style>
<link rel="stylesheet" href="/desktop-diagnostics/theme.css"><script src="/desktop-diagnostics/theme.js" defer></script><script type="module" src="/desktop-diagnostics/compare.js"></script><main><a href="/desktop-diagnostics">← 会话诊断</a><h1>A/B 实验比较</h1><p>选择两次任务，比较用量、耗时、缓存读取和测试结果。</p>
<div class="grid" id="sources"></div><div class="controls"><button id="compare">比较 A / B</button><a id="json">导出比较 JSON</a><a id="md">导出比较 Markdown</a></div><p id="notice" role="status"></p><div id="result"></div>
<div class="grid"><section><h2>A · 请求 / 工具时间线</h2><div id="timelineA" class="timeline"></div></section><section><h2>B · 请求 / 工具时间线</h2><div id="timelineB" class="timeline"></div></section></div>
<p>蓝色：请求；黄色：首输出等待（可能为思考或工具参数）；绿色：工具 call 至 result，包含等待。每行独立显示，重叠时间不相加。</p></main></html>`;
export const comparisonScript=String.raw`
import {normalizeReport,selectReport,summarize} from './comparison.mjs';
const $=id=>document.getElementById(id),sources={},selected={};
const el=(tag,text)=>{const x=document.createElement(tag);if(text!=null)x.textContent=text;return x;};
const fmt=v=>v==null?'—':typeof v==='number'?v.toLocaleString('zh-CN',{maximumFractionDigits:2}):String(v);
async function api(path,data){const r=await fetch('/desktop-diagnostics/api/'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('请求失败 '+r.status);return r.json();}
function control(panel,label,id,type='input'){const wrap=el('label',label),node=el(type);node.id=id;wrap.append(node);panel.append(wrap);return node;}
function adopt(side,data){sources[side]=normalizeReport(data);const sessions=[...new Set(sources[side].records.map(r=>r.session).filter(Boolean))];$(side+'session').replaceChildren(new Option('全部会话',''),...sessions.map(id=>new Option(id.slice(0,12),id)));$(side+'info').textContent='请求 '+sources[side].records.length+' · '+(sources[side].measurement.label??'未归档范围')+' · '+sources[side].measurement.quality+' · '+(sources[side].measurement.complete?'完整边界':'范围可能不完整');}
for(const side of ['A','B']){
 const section=el('section'),h=el('h2',side+' · 数据来源'),controls=el('div');controls.className='controls';section.append(h,controls);
 const live=el('button','当前记录'),file=control(controls,'导入 JSON',side+'file');file.type='file';file.accept='.json';controls.prepend(live);
 const history=control(controls,'本地归档',side+'history','select');history.append(new Option('选择归档',''));
 const filters=el('div');filters.className='controls';section.append(filters);
 control(filters,'会话',side+'session','select').append(new Option('全部会话',''));
 control(filters,'Turn',side+'turn').type='number';
 const purpose=control(filters,'用途',side+'purpose','select');for(const [label,value] of [['全部',''],['对话','conversation'],['压缩','compaction'],['标题','session-title']])purpose.append(new Option(label,value));
 for(const field of ['from','to'])control(filters,field==='from'?'起始时间':'截止时间',side+field).type='datetime-local';
 const info=el('p','尚未选择数据');info.id=side+'info';section.append(info);$('sources').append(section);
 live.onclick=()=>api('snapshot').then(d=>adopt(side,d)).catch(error);
 file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>12*1024*1024)throw Error('文件超过 12 MiB');adopt(side,JSON.parse(await f.text()));}catch(e){error(e);}};
 history.onchange=()=>{if(history.value)api('measurement?id='+encodeURIComponent(history.value)).then(d=>adopt(side,d)).catch(error);};
 api('history').then(list=>{for(const item of list)history.append(new Option((item.measurement?.label??'无法读取')+' · '+(item.measurement?.startedAt??item.id),item.id));}).catch(error);
}
function error(e){$('notice').textContent=e.message;}
function scope(side){return {session:$(side+'session').value||undefined,purpose:$(side+'purpose').value||undefined,turn:$(side+'turn').value===''?undefined:Number($(side+'turn').value),from:$(side+'from').value?Date.parse($(side+'from').value):undefined,to:$(side+'to').value?Date.parse($(side+'to').value):undefined};}
function table(headers,rows){const wrap=el('div');wrap.className='scroll';const t=el('table'),thead=el('thead'),hr=el('tr');for(const h of headers)hr.append(el('th',h));thead.append(hr);t.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const value of row)tr.append(el('td',fmt(value)));body.append(tr);}t.append(body);wrap.append(t);return wrap;}
function waterfall(side,r){const rows=[...r.records.map((x,i)=>({...x,label:'LLM #'+(i+1)+' '+x.purpose,tool:false})),...r.tools.map(x=>({...x,label:(x.nested?'PTC ':'')+x.name,tool:true}))].filter(x=>Number.isFinite(Date.parse(x.startedAt))&&x.durationMs!=null).sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));
 const target=$('timeline'+side);target.replaceChildren();if(!rows.length){target.textContent='没有可用的完成区间';return;}const start=Math.min(...rows.map(x=>Date.parse(x.startedAt))),end=Math.max(...rows.map(x=>Date.parse(x.startedAt)+x.durationMs)),span=Math.max(1,end-start);
 for(const x of rows){const lane=el('div'),label=el('span',x.label+' · '+(x.durationMs/1000).toFixed(2)+'s'),track=el('div'),bar=el('div');lane.className='lane';label.className='label';label.title=x.label+' '+x.status;track.className='track';bar.className='bar'+(x.tool?' tool':'');bar.style.left=((Date.parse(x.startedAt)-start)/span*100)+'%';bar.style.width=(x.durationMs/span*100)+'%';if(!x.tool&&x.firstOutputMs!=null){const first=el('span');first.className='first';first.style.width=Math.min(100,x.firstOutputMs/Math.max(1,x.durationMs)*100)+'%';bar.append(first);}track.append(bar);lane.append(label,track);target.append(lane);}
}
$('compare').onclick=async()=>{try{
 if(!sources.A||!sources.B)throw Error('请为 A 和 B 选择数据');
 for(const side of ['A','B']){selected[side]=selectReport(sources[side],scope(side));waterfall(side,selected[side]);}
 const {id,result:r}=await api('compare',{a:selected.A,b:selected.B});const root=$('result');root.replaceChildren();
 const status=el('p',r.validity+' · '+r.quality+' · '+(r.efficiencyEligible?'满足同验收对比条件（仍需检查覆盖与混杂因素）':'仅显示数值差异，不作效率提升结论'));status.className='status';root.append(status);
 const labels={requests:'请求数',wallMs:'测量墙钟 ms',toolCalls:'工具调用',aggregateInputTokens:'累计总输入',inputTokens:'累计未缓存输入',outputTokens:'累计输出'};
 root.append(table(['指标','A','B','B 相对 A %','覆盖完整'],Object.entries(r.deltas).map(([k,v])=>[labels[k]??k,v.a,v.b,v.percent,v.coverageComplete?'是':'否'])));
 const coverage=el('section');coverage.append(el('h2','覆盖与执行统计'));coverage.append(table(['项目','A','B'],[['缓存读取比例',r.a.cacheRate.value,r.b.cacheRate.value],['缓存比例覆盖',r.a.cacheRate.known+'/'+r.a.cacheRate.total,r.b.cacheRate.known+'/'+r.b.cacheRate.total],['总输入覆盖',r.a.aggregateInputTokens.known+'/'+r.a.aggregateInputTokens.total,r.b.aggregateInputTokens.known+'/'+r.b.aggregateInputTokens.total],['请求区间并集 ms',r.a.requestUnionMs,r.b.requestUnionMs],['工具区间并集 ms',r.a.toolUnionMs,r.b.toolUnionMs],['PTC 子调用',r.a.nestedCalls,r.b.nestedCalls],['Skill 加载',r.a.skillLoads,r.b.skillLoads],['重复 read 目标',r.a.repeatedReads,r.b.repeatedReads],['工具失败',r.a.toolErrors,r.b.toolErrors]]));root.append(coverage);
 for(const side of ['A','B']){const tools=el('section');tools.append(el('h2',side+' · 工具 / Skill'));tools.append(table(['工具','调用','完成','失败','未结束'],Object.entries(r[side.toLowerCase()].toolGroups).map(([name,g])=>[name,g.calls,g.completed,g.errors,g.unsettled])));root.append(tools);}
 const checks=el('section');checks.append(el('h2','可重复性检查'),table(['条件','结果','A','B'],r.checks.map(c=>[c.name,c.result,Array.isArray(c.a)?c.a.join(', '):c.a,Array.isArray(c.b)?c.b.join(', '):c.b])));root.append(checks);
 for(const format of ['json','md'])$(format).href='/desktop-diagnostics/api/export?comparison='+id+'&format='+format;
 $('notice').textContent='已比较。导出只包含汇总元数据；原始导入文件保留在此页面内存中。';
 }catch(e){error(e);}};
`;
