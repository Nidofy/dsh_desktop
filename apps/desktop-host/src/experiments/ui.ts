import { managementUi, managementConfirm } from '@nidofy/dsh-desktop-extras/management-ui'
/** Bilingual local-user receipt comparison; reads never execute tasks and uncertain records are only inspected. */
import { taskRequestControls } from './task-ui.ts'
import { engineeringTaskControls } from './engineering-ui.ts'
import { engineeringMatrixControls } from './matrix-ui.ts'
import { engineeringComparisonControls } from './engineering-comparison-ui.ts'
const english = {
  title: 'Task receipt comparisons', workspace: 'Workspace', load: 'Load retained receipts', more: 'Load more receipts',
  factor: 'Requested factor', notebook: 'Notebook', cache: 'Cache', a: 'Run A', b: 'Run B', compare: 'Read comparison',
  intro: 'Select two existing runs. Source, input, configuration, tests and acceptance are checked independently. Full model inputs, model versions and factor settings are currently unobserved; task efficiency remains unknown.',
  archive: 'Save selection record', history: 'Load saved selections', inspect: 'Inspect pending record', export: 'Export private selection JSON',
  import: 'Import selection JSON', importHelp: 'Imports must match current local receipts. Files contain workspace paths and receipt identities. Unsupported or changed evidence is refused; no task runs during import.',
  verification: 'Receipt input match', task: 'Task comparability', quality: 'Independent acceptance', unknown: 'Unknown',
  matched: 'Matched', different: 'Different', notComparable: 'Not directly comparable', bothAccepted: 'Both accepted', rejected: 'Rejected',
  checks: 'Comparison evidence', metric: 'Metric', missing: 'Missing sides', requests: 'Model calls', inputTokens: 'Input tokens',
  outputTokens: 'Output tokens', cacheReadTokens: 'Cache-read tokens', tests: 'Parsed tests', freshness: 'Current input freshness',
  acceptance: 'User acceptance', source: 'Source bytes', input: 'Input bytes', configuration: 'Configuration revision',
  command: 'Execution configuration', coverage: 'Input coverage', log: 'Complete retained logs', intent: 'Task intent',
  'distinct-runs': 'Distinct executions', 'committed-receipts': 'Committed receipts', 'model-version': 'Model version',
  'model-input': 'Full model-visible input', 'factor-state': 'Observed factor settings',
  ready: 'Ready', saved: 'Selection saved', changed: 'Current receipt observations differ from this saved selection.',
  unchanged: 'Current receipt observations match this saved selection.', empty: 'No saved selections', error: 'Operation was not confirmed',
  uncertain: 'Keep this record identity and inspect it. An unknown response does not authorize automatic resubmission.',
  choose: 'Select two retained runs first', tooLarge: 'Selection file exceeds 64 KiB', noRecord: 'No publication is observable; the record remains unconfirmed.',
  efficiency: 'No efficiency or equal-quality conclusion is available.', group: 'Experiment / case', recorded: 'Recorded at',
  openA: 'Open original receipt A', openB: 'Open original receipt B',
  modelA: 'Inspect selecting model step A', modelB: 'Inspect selecting model step B', modelTitle: 'Model step evidence',
  receiptMetrics: 'Command receipts do not bind a complete model run. Model token and cache totals are not available here; use Engineering task comparisons below for its separately recorded request coverage.', modelHelp: 'This private view can include complete task text and tool schemas. Counts cover only the step that selected the action. A logged input prefix is not a confirmed dispatch input. Exact model version and historical Notebook/cache policy remain unknown.',
}
const chinese: typeof english = {
  title: '任务回执比较', workspace: '工作区', load: '加载保留回执', more: '加载更多回执',
  factor: '计划比较的因素', notebook: 'Notebook', cache: '缓存', a: '运行 A', b: '运行 B', compare: '读取比较',
  intro: '选择两个已有运行。源码、输入、配置、测试和验收分别检查。目前尚未观察完整模型输入、模型版本和因素设置；任务效率保持未知。',
  archive: '保存选择记录', history: '加载已保存选择', inspect: '检查待确认记录', export: '导出私密选择 JSON',
  import: '导入选择 JSON', importHelp: '导入必须与当前本机回执一致。文件包含工作区路径和回执身份。未知格式或已变化证据会被拒绝；导入不会执行任务。',
  verification: '回执输入匹配', task: '任务可比性', quality: '独立验收', unknown: '未知',
  matched: '匹配', different: '不同', notComparable: '不可直接比较', bothAccepted: '均已验收', rejected: '已拒绝',
  checks: '比较证据', metric: '指标', missing: '缺失侧数', requests: '模型调用', inputTokens: '输入 tokens',
  outputTokens: '输出 tokens', cacheReadTokens: '缓存读取 tokens', tests: '解析的测试数', freshness: '当前输入新鲜度',
  acceptance: '用户验收', source: '源码字节', input: '输入字节', configuration: '配置修订',
  command: '执行配置', coverage: '输入覆盖', log: '完整保留日志', intent: '任务意图',
  'distinct-runs': '独立执行', 'committed-receipts': '已提交回执', 'model-version': '模型版本',
  'model-input': '完整模型可见输入', 'factor-state': '已观察因素设置',
  ready: '准备就绪', saved: '选择已保存', changed: '当前回执观察与已保存选择不同。',
  unchanged: '当前回执观察与已保存选择一致。', empty: '没有已保存选择', error: '操作结果未确认',
  uncertain: '保留此记录身份并查询。响应未知不会自动重新提交。',
  choose: '请先选择两个保留运行', tooLarge: '选择文件超过 64 KiB', noRecord: '尚未观察到发布；记录仍未确认。',
  efficiency: '目前不能得出效率或质量相同的结论。', group: '实验／算例', recorded: '记录时间',
  openA: '打开原回执 A', openB: '打开原回执 B',
  modelA: '检查 A 的模型选择 step', modelB: '检查 B 的模型选择 step', modelTitle: '模型 step 证据',
  receiptMetrics: '命令回执不绑定完整模型运行，因此此处不提供模型 token 与缓存合计。下方工程任务比较使用其独立记录的请求覆盖。', modelHelp: '此私密视图可能包含完整任务文本和工具定义。计数仅覆盖选择该动作的 step。日志输入前缀不等于已确认发送输入。准确模型版本和历史 Notebook／缓存策略仍保持未知。',
}
/** Render an authenticated comparison page without embedding paths, credentials or historical reports.
 * @param zh - Whether to render the Chinese locale.
 * @returns Self-contained receipt selection/history controls with no automatic task or request start.
 */
export function experimentsHtml(zh: boolean): string {
  const t = zh ? chinese : english
  const task = taskRequestControls(zh)
  const engineering = engineeringTaskControls(zh)
  const matrix = engineeringMatrixControls(zh)
  const engineeringComparison = engineeringComparisonControls(zh)
  return String.raw`<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>:root{font:14px/1.6 system-ui;color:#172b3a;background:#f5f7f9}*{box-sizing:border-box}main{max-width:1100px;margin:auto;padding:24px}section{background:white;border:1px solid #dce3ea;border-radius:12px;padding:20px;margin:16px 0}h1{margin:0}h2{font-size:19px}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:end}label{display:grid;gap:6px;min-width:0;flex:1}button,input,select{font:inherit;border:1px solid #bac8d3;border-radius:7px;padding:8px;max-width:100%;min-width:0}button{background:white;cursor:pointer}button:disabled{opacity:.5;cursor:default}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #dce3ea;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto}.scroll{overflow-x:auto}#status{overflow-wrap:anywhere}@media(max-width:600px){main{padding:12px}section{padding:14px}.row label{flex-basis:100%}}</style>${managementUi()}
<main><a href="/api/nidofy/workbench/ui?tab=builds&locale=${zh ? 'zh-CN' : 'en'}">${zh ? '返回工程工作台' : 'Back to workbench'}</a><h1>${t.title}</h1><p>${t.intro}</p><section><div class="row"><label>${t.workspace}<input id="workspace"></label><button id="load">${t.load}</button><button id="more" disabled>${t.more}</button></div><div class="row"><label>${t.a}<select id="a"></select></label><label>${t.b}<select id="b"></select></label><label>${t.factor}<select id="factor"><option value="notebook">${t.notebook}</option><option value="cache">${t.cache}</option></select></label><button id="compare">${t.compare}</button><button id="archive" disabled>${t.archive}</button></div><pre id="identity"></pre><div id="result"></div></section>
${task.html}
${engineering.html}
${engineeringComparison.html}
${matrix.html}
<section><h2>${t.modelTitle}</h2><p>${t.modelHelp}</p><button id="modelA" disabled>${t.modelA}</button><button id="modelB" disabled>${t.modelB}</button><pre id="model"></pre></section>
<section><button id="history">${t.history}</button><button id="inspect" disabled>${t.inspect}</button><button id="export" disabled>${t.export}</button><div id="records"></div><p>${t.importHelp}</p><label>${t.import}<input id="file" type="file" accept="application/json,.json"></label><button id="import">${t.import}</button><pre id="record"></pre></section><p id="status" role="status">${t.ready}</p></main>
<script>${managementConfirm(zh)}const t=${JSON.stringify(t)},$=id=>document.getElementById(id),esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let epoch=0,next=null,selection=null,record=null,closed=false;const lifetime=new AbortController(),key='nidofy-task-comparison-pending';let pending=localStorage.getItem(key);$('inspect').disabled=!pending;
const label=value=>({MATCHED:t.matched,NOT_MATCHED:t.different,NOT_COMPARABLE:t.notComparable,UNKNOWN:t.unknown,BOTH_ACCEPTED:t.bothAccepted,REJECTED:t.rejected,SAME:t.matched,DIFFERENT:t.different}[value]??value);
const action=fn=>async()=>{try{$('status').textContent='';await fn()}catch(error){if(!closed)$('status').textContent=t.error+': '+error.message}};
async function api(method,data={}){const response=await fetch('/api/nidofy/workbench/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:lifetime.signal});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||t.error),{code:value.error});return value}
let modelEpoch=0;function clearModel(){modelEpoch++;$('modelA').disabled=true;$('modelB').disabled=true;$('model').textContent=''}
function invalidate(){epoch++;selection=null;record=null;$('archive').disabled=true;$('export').disabled=true;$('result').replaceChildren();$('identity').textContent='';$('record').textContent='';clearModel()}
$('workspace').oninput=()=>{invalidate();next=null;$('a').replaceChildren();$('b').replaceChildren();$('more').disabled=true};for(const id of ['a','b','factor'])$(id).onchange=invalidate;
function render(value){clearModel();selection=value.selection;$('modelA').disabled=false;$('modelB').disabled=false;$('identity').textContent=t.group+': '+value.selection.experimentId+' / '+value.selection.caseId+'\nA: '+value.selection.a.runId+'\nB: '+value.selection.b.runId;const facts=['tests','freshness','acceptance'];$('result').innerHTML='<p>'+esc(t.verification)+': '+esc(label(value.verification))+' · '+esc(t.task)+': '+esc(label(value.task))+' · '+esc(t.quality)+': '+esc(label(value.quality))+'</p><p>'+esc(t.efficiency)+'</p><p>'+esc(t.receiptMetrics)+'</p><div class="scroll"><table><tr><th>'+esc(t.metric)+'</th><th>A</th><th>B</th><th>'+esc(t.missing)+'</th></tr>'+Object.entries(value.counts).filter(([name])=>!['requests','inputTokens','outputTokens','cacheReadTokens'].includes(name)).map(([name,row])=>'<tr><td>'+esc(t[name])+'</td><td>'+esc(row.a)+'</td><td>'+esc(row.b)+'</td><td>'+esc(row.missing)+'</td></tr>').join('')+'</table><table><tr><th>'+esc(t.checks)+'</th><th>A</th><th>B</th></tr>'+facts.map(name=>'<tr><td>'+esc(t[name])+'</td><td>'+esc(value.a.receipt?.[name])+'</td><td>'+esc(value.b.receipt?.[name])+'</td></tr>').join('')+'</table><table>'+value.checks.map(row=>'<tr><td>'+esc(t[row.name])+'</td><td>'+esc(label(row.result))+'</td></tr>').join('')+'</table></div>';for(const [side,title] of [['a',t.openA],['b',t.openB]]){const link=document.createElement('a');link.textContent=title;link.href='/api/nidofy/workbench/ui?'+new URLSearchParams({tab:'builds',locale:'${zh?'zh-CN':'en'}',workspace:value.selection[side].workspace,receipt:value.selection[side].runId});const paragraph=document.createElement('p');paragraph.append(link);$('result').append(paragraph)}}
async function receipts(more=false){const workspace=$('workspace').value;if(!more){invalidate();next=null;$('a').replaceChildren();$('b').replaceChildren()}const current=epoch,value=await api('verification/list',{workspace,...more?{after:next}:{}});if(closed||current!==epoch||workspace!==$('workspace').value)return;for(const id of value.ids)for(const side of ['a','b']){const option=document.createElement('option');option.value=id;option.textContent=id;$(side).append(option)}if(!more&&$('b').options.length>1)$('b').selectedIndex=1;next=value.next;$('more').disabled=!next}
$('load').onclick=action(()=>receipts());$('more').onclick=action(()=>receipts(true));
$('compare').onclick=action(async()=>{if(!$('a').value||!$('b').value)throw Error(t.choose);const current=++epoch;selection=null;record=null;clearModel();$('archive').disabled=true;$('export').disabled=true;const workspace=$('workspace').value,request={experimentId:crypto.randomUUID(),caseId:crypto.randomUUID(),factor:$('factor').value,a:{workspace,runId:$('a').value},b:{workspace,runId:$('b').value}},value=await api('experiments/compare',{selection:request});if(closed||current!==epoch)return;selection=value.selection;render(value);$('archive').disabled=!!pending;$('modelA').disabled=false;$('modelB').disabled=false});
for(const [id,side] of [['modelA','a'],['modelB','b']])$(id).onclick=action(async()=>{if(!selection)return;const current=epoch,modelCurrent=++modelEpoch,chosen=selection;$('model').textContent='';const value=await api('experiments/model-step',{selection:chosen,side});if(closed||current!==epoch||modelCurrent!==modelEpoch||chosen!==selection)return;$('model').textContent=JSON.stringify(value,null,2)});
function remember(id){pending=id;localStorage.setItem(key,id);$('inspect').disabled=false;$('archive').disabled=true}
function confirmed(value){record=value;pending=null;localStorage.removeItem(key);$('inspect').disabled=true;$('export').disabled=false;$('record').textContent=t.recorded+': '+new Date(value.recordedAt).toISOString()+'\n'+value.id;$('status').textContent=t.saved}
$('archive').onclick=action(async()=>{if(!selection||pending)return;const current=epoch,id=crypto.randomUUID(),chosen=selection;remember(id);try{const value=await api('experiments/record',{id,selection:chosen});if(!closed&&current===epoch)confirmed(value)}catch(error){if(!closed)$('status').textContent=t.uncertain+' '+id+' · '+error.message}});
$('inspect').onclick=action(async()=>{if(!pending)return;const current=epoch,id=pending,value=await api('experiments/read',{id});if(closed||current!==epoch||id!==pending)return;if(!value){$('status').textContent=t.noRecord+' '+id;return}confirmed(value.record);render(value.comparison);$('status').textContent=value.changedSinceRecord?t.changed:t.unchanged});
$('history').onclick=action(async()=>{const current=epoch,rows=await api('experiments/list');if(closed||current!==epoch)return;$('records').replaceChildren();if(!rows.length)$('records').textContent=t.empty;for(const row of rows){const button=document.createElement('button');button.textContent=new Date(row.recordedAt).toISOString()+' · '+row.id;button.onclick=action(async()=>{const selected=++epoch;selection=null;clearModel();$('archive').disabled=true;$('export').disabled=true;const value=await api('experiments/read',{id:row.id});if(closed||selected!==epoch)return;if(!value){$('status').textContent=t.noRecord;return}record=value.record;render(value.comparison);$('record').textContent=row.id;$('export').disabled=false;$('status').textContent=value.changedSinceRecord?t.changed:t.unchanged});$('records').append(button)}});
$('export').onclick=action(async()=>{if(!record)return;const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='task-selection-'+record.id+'.json';link.click();URL.revokeObjectURL(url)});
$('import').onclick=action(async()=>{if(pending){$('status').textContent=t.uncertain+' '+pending;return}const file=$('file').files[0];if(!file)return;if(file.size>64*1024)throw Error(t.tooLarge);const report=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),parsed=JSON.parse(report);if(typeof parsed.id!=='string')throw Error(t.error);const current=epoch;remember(parsed.id);try{const value=await api('experiments/import',{report});if(!closed&&current===epoch)confirmed(value)}catch(error){if(!closed){if(['EXPERIMENT_VERSION_UNSUPPORTED','EXPERIMENT_SOURCE_REFUSED','EXPERIMENT_RECORD_INVALID','EXPERIMENT_RECORD_LIMIT','EXPERIMENT_ID_INVALID','EXPERIMENT_WORKSPACE_INVALID','EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED'].includes(error.code)){pending=null;localStorage.removeItem(key);$('inspect').disabled=true;$('archive').disabled=!selection;$('status').textContent=t.error+': '+error.message}else $('status').textContent=t.uncertain+' '+parsed.id+' · '+error.message}}});
${task.script}
${engineering.script}
${engineeringComparison.script}
${matrix.script}
window.addEventListener('pagehide',()=>{closed=true;lifetime.abort()});const params=new URLSearchParams(location.search);$('workspace').value=params.get('workspace')??'';
</script></html>`
}
