export const diagnosticHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSHDesktop · 会话诊断</title>
<style>
body{margin:0}main{max-width:1360px;margin:auto;padding:32px}h1{font-size:26px;margin:0}p{color:var(--dsw-alias-label-tertiary)}header,.actions,.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header{justify-content:space-between}.tag{color:var(--dsw-alias-state-success-primary)}section{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;margin:20px 0}button,select,a.button{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);padding:8px 12px;border-radius:6px;font:inherit;cursor:pointer;text-decoration:none}button:hover,a.button:hover{background:var(--dsw-alias-interactive-bg-hover)}button:disabled{opacity:.5}label{display:flex;gap:8px;align-items:center}#notice{color:var(--dsw-alias-state-warn-label);min-height:24px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.card{padding:14px;background:var(--dsw-alias-bg-module-platform);border-radius:8px}.card b{font-size:23px;display:block}.card span,small{color:var(--dsw-alias-label-tertiary)}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;white-space:nowrap}th,td{padding:10px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2)}th{color:var(--dsw-alias-label-tertiary);font-weight:500}tbody tr{cursor:pointer}tbody tr:hover,tbody tr.selected{background:var(--dsw-alias-interactive-bg-hover)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 Consolas,monospace;max-height:540px;overflow:auto}#detail{user-select:text}.muted{color:var(--dsw-alias-label-tertiary)}@media(max-width:700px){main{padding:16px}section{padding:12px}}
</style><link rel="stylesheet" href="/desktop-diagnostics/theme.css"><script src="/desktop-diagnostics/theme.js" defer></script><script src="/desktop-diagnostics/page.js" defer></script></head><body><main>
<header><div><span class="tag">DSH DESKTOP / LOCAL DIAGNOSTICS</span><h1>会话诊断</h1></div><div class="actions"><button id="refresh">刷新</button><a id="json" class="button">导出 JSON</a><a id="md" class="button">导出 Markdown</a></div></header>
<p>查看请求用量、耗时和缓存读取情况。</p>
<nav class="feature-nav" aria-label="工作区工具"><a class="button" href="/desktop-diagnostics/compare">A/B 实验比较 →</a> <a class="button" href="/desktop-diagnostics/actions">项目操作 →</a> <a class="button" href="/desktop-diagnostics/recovery">任务状态与恢复 →</a> <a class="button" href="/desktop-diagnostics/cache">缓存验证 →</a> <a class="button" href="/desktop-diagnostics/changes">变更查看 →</a> <a class="button" href="/desktop-diagnostics/artifacts">文件与产物 →</a> <a class="button" href="/desktop-diagnostics/self-test">自检中心 →</a></nav>
<section><div class="controls"><label><input type="checkbox" id="enabled">采集轻量元数据</label><label>工具输出实验<select id="spill"><option value="native">原生 · 50,000 bytes</option><option value="compact">紧凑 · 24,000 bytes</option></select></label><button id="save">保存设置</button><button id="clear">清空当前记录</button></div>
<p>采集开关立即生效。工具预算在下次重启引擎时应用；请等任务结束后通过 应用 → 重启引擎 重启。它仅缩短部分工具结果的内联预览，完整结果仍可按需读取。</p><div id="notice" role="status"></div><small id="config"></small></section>
<section><h2>任务测量与实验</h2><div class="controls"><label>Skill 描述<select id="skill"><option value="">保持现有配置</option><option value="native">原生 · 500 字符</option><option value="compact">紧凑 · 250 字符</option><option value="restore">恢复首次实验前配置</option></select></label><label><input id="autoArchive" type="checkbox">自动归档每轮</label><label><input id="repoSummary" type="checkbox">启用 repo_summary 实验工具</label></div><p>Skill / repo_summary 待引擎重启生效。归档仅含元数据，最多 100 份 / 50 MiB，超限淘汰最旧记录。</p><div class="controls"><label>测量名称<input id="measurementLabel" maxlength="120" placeholder="本次任务"></label><button id="measureStart">开始测量所选会话</button><select id="measurement"><option value="">选择进行中的测量</option></select><select id="quality"><option>UNKNOWN</option><option>PASS</option><option>FAIL</option></select><button id="measureFinish">结束并归档</button><button id="archive">归档当前保留范围</button></div><small id="experiments"></small></section>
<div class="controls"><label>会话<select id="session"><option value="">全部会话</option></select></label><span id="coverage" class="muted"></span></div>
<section class="cards" id="cards"></section><p id="native-stats"></p>
<section><h2>最近请求</h2><p>输入与输出是所选记录的累计用量；— 表示适配层未提供。首输出包含思考或工具参数，首可见文本另见详情。</p><div class="scroll"><table><thead><tr><th>时间 / 会话</th><th>用途 / 模型</th><th>总输入</th><th>未缓存</th><th>缓存读取</th><th>输出</th><th>首输出 / 总时长</th><th>状态</th><th>本地变化</th></tr></thead><tbody id="rows"></tbody></table></div><p id="empty">暂无请求。运行一次任务后，这里会自动更新。</p></section>
<section><h2>请求详情</h2><p>消息位置从 0 开始。指纹未完成、首条记录或缺少会话关联时，显示 NOT_COMPARABLE。不同 key scope 或指纹版本不能直接比较。</p><pre id="detail">选择一条请求查看元数据。</pre></section>
<footer class="muted">实时记录在引擎重启后清空，已归档测量在本机保留。不保存提示词、代码、工具参数或请求头。指纹可关联同一用户数据，分享前请检查模型名称与用量信息。</footer>
</main></body></html>`;

export const diagnosticScript = String.raw`
'use strict';
const $=id=>document.getElementById(id);
let latest,selected,dirty=false,spillDirty=false,skillDirty=false,busy=false;
let requestedSession=new URLSearchParams(location.search).get('sessionId'),sessionTarget=null;
const fmt=v=>v==null?'—':Number(v).toLocaleString('zh-CN');
const seconds=v=>v==null?'—':(v/1000).toFixed(2)+'s';
async function api(path,data){const r=await fetch('/desktop-diagnostics/api/'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('诊断请求失败 ('+r.status+')，请重新打开会话诊断。');return r.json();}
function render(){
 const s=latest,session=$('session').value;
 const sessions=[...new Set(s.records.map(r=>r.session).filter(Boolean))];
 if(sessionTarget&&!sessions.includes(sessionTarget))sessions.push(sessionTarget);
 $('session').replaceChildren(new Option('全部会话',''),...sessions.map(id=>new Option(id.slice(0,12),id)));
 if(sessions.includes(session))$('session').value=session;
 else if(sessionTarget)$('session').value=sessionTarget;
 const records=s.records.filter(r=>!$('session').value||r.session===$('session').value);
 if(!dirty){$('enabled').checked=s.enabled;$('spill').value=s.preferences.spillMode??(s.configuration.effectiveSpillBytes===24000?'compact':'native');$('skill').value=s.preferences.skillMode??'';$('autoArchive').checked=s.preferences.autoArchive===true;$('repoSummary').checked=s.preferences.repoSummary===true;}
 const measurement=$('measurement').value;$('measurement').replaceChildren(new Option('选择进行中的测量',''),...(s.activeMeasurements??[]).map(m=>new Option(m.label+' · '+m.session.slice(0,8),m.id)));if((s.activeMeasurements??[]).some(m=>m.id===measurement))$('measurement').value=measurement;
 $('experiments').textContent='当前 Skill 描述 '+s.configuration.effectiveSkillDescription+' 字符 · repo_summary '+(s.configuration.repoSummary?'已启用':'未启用')+' · 归档失败 '+(s.archiveFailures??0)+' · 工具记录 '+(s.tools?.length??0)+'（淘汰 '+(s.toolsDropped??0)+'）';
 const desired=s.preferences.spillMode==='compact'?24000:s.preferences.spillMode==='native'?50000:s.configuration.effectiveSpillBytes;
 $('config').textContent='Desktop '+s.configuration.desktopVersion+' · DSH '+s.configuration.dshVersion+' · 当前工具预算 '+fmt(s.configuration.effectiveSpillBytes)+' bytes'+(desired!==s.configuration.effectiveSpillBytes?' · 实验设置待重启':'')+' · '+(s.keyPersistence==='ephemeral'?'临时指纹密钥（跨重启不可比）':'Windows 用户级稳定指纹')+' · 保留 '+s.records.length+' / '+s.limits.maxRecords+' · 淘汰/丢弃 '+s.dropped+' · 观察器异常 '+s.observerFailures+(s.preferenceWarning?' · 设置读取失败，使用默认值':'');
 const known=field=>records.filter(r=>r.usage[field]!=null);
 const sum=field=>{const rows=known(field);return rows.length?fmt(rows.reduce((n,r)=>n+r.usage[field],0)):'—';};
 const cards=[['请求',fmt(records.length)],['累计总输入',sum('aggregateInputTokens')],['累计未缓存输入',sum('inputTokens')],['累计缓存读取',sum('cacheReadTokens')],['累计输出',sum('outputTokens')],['失败 / 取消',records.filter(r=>r.status==='error').length+' / '+records.filter(r=>r.status==='aborted').length]];
 $('cards').replaceChildren(...cards.map(([label,value])=>{const d=document.createElement('div');d.className='card';const b=document.createElement('b');b.textContent=value;const span=document.createElement('span');span.textContent=label;d.append(b,span);return d;}));
 $('coverage').textContent='总输入覆盖 '+known('aggregateInputTokens').length+'/'+records.length+' · cache read 覆盖 '+known('cacheReadTokens').length+'/'+records.length+'（未报告项不按零计算）';
 const native=s.nativeSessionStats[$('session').value];
 $('native-stats').textContent=native?'DSH 原生整会话统计（范围与上方保留请求不同）：'+fmt(native.turns)+' 轮 / '+fmt(native.steps)+' 步 · 模型 '+seconds(native.llmMs)+' · 工具累计 '+seconds(native.toolMs)+'（并行区间可能重叠，不是任务墙钟时长）':'选择会话可查看 DSH 原生模型与工具时间；尚未收到原生统计时不估算。';
 $('rows').replaceChildren(...records.slice().reverse().map(r=>{const tr=document.createElement('tr');if(r.id===selected)tr.className='selected';const fields=[new Date(r.startedAt).toLocaleTimeString()+' / '+(r.session?.slice(0,8)??'未知'),r.purpose+' / '+r.model,fmt(r.usage.aggregateInputTokens),fmt(r.usage.inputTokens),fmt(r.usage.cacheReadTokens),fmt(r.usage.outputTokens),seconds(r.firstOutputMs)+' / '+seconds(r.durationMs),r.status,r.comparison.facts.join(', ')];for(const f of fields){const td=document.createElement('td');td.textContent=f;tr.append(td);}tr.onclick=()=>{selected=r.id;render();};return tr;}));
 $('empty').hidden=records.length>0;
 const current=records.find(r=>r.id===selected);$('detail').textContent=current?JSON.stringify(current,null,2):'选择一条请求查看元数据。';
 for(const format of ['json','md'])$(''+format).href='/desktop-diagnostics/api/export?format='+format+'&session='+encodeURIComponent($('session').value);
}
async function refresh(){if(busy)return;try{if(requestedSession){const info=await api('desktop/context?session='+encodeURIComponent(requestedSession));sessionTarget=info.diagnosticSession;requestedSession=null;}latest=await api('snapshot');render();}catch(e){$('notice').textContent=e.message;}}
$('enabled').onchange=()=>{dirty=true;};$('spill').onchange=()=>{dirty=true;spillDirty=true;};
 $('spill').append(new Option('恢复首次实验前配置','restore'));$('skill').onchange=()=>{dirty=true;skillDirty=true;};for(const key of ['autoArchive','repoSummary'])$(key).onchange=()=>{dirty=true;};
$('session').onchange=()=>{sessionTarget=null;render();};$('refresh').onclick=refresh;
async function action(path,data){busy=true;$('save').disabled=$('clear').disabled=true;try{latest=await api(path,data);dirty=false;spillDirty=false;skillDirty=false;render();$('notice').textContent=path==='clear'?'当前记录已清空。':'已保存。采集开关已生效；工具预算如有变化，待任务结束后重启引擎应用。';}catch(e){$('notice').textContent=e.message;}finally{busy=false;$('save').disabled=$('clear').disabled=false;}}
$('save').onclick=()=>action('preferences',{enabled:$('enabled').checked,autoArchive:$('autoArchive').checked,repoSummary:$('repoSummary').checked,...(spillDirty?{spillMode:$('spill').value}:{}),...(skillDirty&&$('skill').value?{skillMode:$('skill').value}:{})});
async function measurementAction(path,data){try{await api('measurement/'+path,data);$('notice').textContent=path==='start'?'测量已开始。完成任务后结束并归档。':'已归档，可在 A/B 页面选择。';await refresh();}catch(e){$('notice').textContent=e.message;}}
$('measureStart').onclick=()=>{$('session').value?measurementAction('start',{session:$('session').value,label:$('measurementLabel').value||'Task'}):$('notice').textContent='请先选择一个会话。';};
$('measureFinish').onclick=()=>measurementAction('finish',{id:$('measurement').value,quality:$('quality').value});
$('archive').onclick=()=>measurementAction('save',{session:$('session').value,label:$('measurementLabel').value||'Retained window'});
$('clear').onclick=()=>action('clear',{});
refresh();setInterval(()=>{if(!document.hidden)refresh();},3000);
`;
