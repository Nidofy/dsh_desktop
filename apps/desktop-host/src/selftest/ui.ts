import { managementUi, managementConfirm } from '@nidofy/dsh-desktop-extras/management-ui'
/** Authenticated local T19 dashboard; report viewing, polling and export never invoke a model. */
import type { CheckId } from './types.ts'

interface Copy {
  title: string
  intro: string
  local: string
  cancel: string
  refresh: string
  history: string
  json: string
  markdown: string
  note: string
  empty: string
  unknown: string
  progress: string
  check: string
  result: string
  scope: string
  code: string
  connections: string
  route: string
  budget: string
  prepare: string
  accept: string
  provider: string
  providerNote: string
  capacity: string
  capacityRoots: string
  capacityUnsettled: string
  capacityUnknown: string
  checks: Record<CheckId, readonly [string, string]>
}
const en: Copy = {
  title: 'Electron self-test', intro: 'Run fixed checks in a new isolated workspace. No user rules, user Skills or model requests are loaded.',
  local: 'Run local checks', cancel: 'Cancel and drain', refresh: 'Refresh', history: 'Report history',
  json: 'Export JSON', markdown: 'Export Markdown', note: 'COMPLETED means the workflow ended. Each PASS applies only to its measured scope. Field checks remain UNKNOWN.',
  empty: 'No retained report', unknown: 'The start outcome is unknown. Read this run again; do not resend it.', progress: 'Workflow',
  check: 'Check', result: 'Result', scope: 'Measured scope and limits', code: 'Code',
  connections: 'Load connection choices', route: 'Connection / model', budget: 'Maximum synthetic requests',
  prepare: 'Prepare confirmation', accept: 'I confirm this model, both revisions and the request budget.', provider: 'Run confirmed connection checks',
  providerNote: 'Connection checks send up to five fixed synthetic inputs to the selected model, with 64 output tokens per request. They may incur provider charges. No retry, failover or generated command execution. Failure or unknown evidence stops later requests. The exact inputs are retained privately; exports omit them.',
  capacity: 'Read retained input capacity', capacityRoots: 'Retained request inputs', capacityUnsettled: 'Unsettled or unknown runs',
  capacityUnknown: 'Not measured',
  checks: {
    node: ['Node carrier', 'Actual Electron Node-mode process and executable observation; no signature or SHA qualification.'],
    dsh: ['Runtime files', 'Installed production/resource inventory is unavailable.'],
    modules: ['Loaded modules', 'Actual installed Host/Client inventory is unavailable.'],
    webview: ['Electron renderer', 'Actual window, preload and local protocol require carrier evidence.'],
    storage: ['Atomic storage', 'Isolated UTF-8 write, replace, cold read and actual native quota refusal.'],
    shell: ['Shell', 'Fixed native command and independent file read under current execution policy.'],
    skills: ['Skills', 'Official filesystem provider loads only one explicit synthetic root; default roots disabled.'],
    'action-trust': ['Action trust', 'The real action executor refuses an untrusted synthetic action.'],
    'action-run': ['Action run', 'Fixed action, cold journal read and actual parsed isolated TAP log; user source coverage is unknown.'],
    'action-change': ['Action change', 'Changed synthetic configuration invalidates its old trust at execution.'],
    cancel: ['Cancellation', 'Cancel an actually started long command and await process/output drain; timeout is separate.'],
    git: ['Git', 'Fresh isolated repository, local baseline and independent changed-file comparison; no user Git config.'],
    hg: ['Mercurial', 'Fresh isolated repository and local comparison; a missing executable is skipped.'],
    artifact: ['Artifact changes', 'Changed synthetic bytes invalidate the real artifact lease reader.'],
    prefix: ['Durable prefix', 'Raw append/replacement, physical restore refusal, committed Notebook and prepared route/cache-hint classification; provider cache hits remain unqualified.'],
    recovery: ['Cold recovery', 'Read an unsettled synthetic checkpoint as INTERRUPTED/UNKNOWN without disk edits or replay; does not kill this Host.'],
    notification: ['Notification identity', 'Private actual receipt/notice owner deduplication; system display is disabled.'],
    'probe-failure': ['Local provider failure', 'Official preparation refuses locally before payload or send and stops later preparation; no real model or streaming retry measured.'],
    connection: ['Connection', 'One logged synthetic request on the confirmed model and real connection/HTTP revisions; local mode sends none.'],
    streaming: ['Streaming', 'Actual deltas and successful finish of the first request; no request in local mode.'],
    'tool-call': ['Tool protocol', 'Observe only the fixed echo tool and arguments; execute no model-generated commands.'],
    'cache-counter': ['Cache counters', 'Only actually reported cache usage qualifies; absent counters remain UNKNOWN.'],
    'cache-repeat': ['Repeated cache', 'Two 2-KiB groups repeated twice within the same five-request budget; actual positive cache read required.'],
    'native-acceptance': ['Native field acceptance', 'Actual window, notification, monitors, sleep and abnormal recovery require target-device evidence.'],
    egress: ['Network field acceptance', 'Application HTTP policy does not qualify Shell/Git/sockets/workers or global zero-egress.'],
  },
}
const zh: Copy = {
  title: 'Electron 自检中心', intro: '在新建隔离工作区执行固定检查，不加载用户规则、用户 Skills，不请求模型。',
  local: '运行本机检查', cancel: '取消并等待排空', refresh: '刷新', history: '报告历史',
  json: '导出 JSON', markdown: '导出 Markdown', note: 'COMPLETED 仅表示流程结束。PASS 只适用于该项实际测量范围，现场检查保持 UNKNOWN。',
  empty: '没有保留的报告', unknown: '启动结果未知，请重新读取这个运行，不要补发。', progress: '流程',
  check: '检查', result: '结果', scope: '测量范围与限制', code: '代码',
  connections: '读取连接选项', route: '连接 / 模型', budget: '合成请求次数上限', prepare: '准备确认',
  accept: '我确认此模型、两类修订和请求预算。', provider: '运行已确认的连接检查',
  providerNote: '连接检查向所选模型发送最多五次固定合成输入，每次最多输出 64 token，可能产生提供方费用。不重试、不故障转移、不执行模型生成命令。失败或未知证据即停止后续请求。完整输入私有保留，导出省略正文。',
  capacity: '读取输入保留容量', capacityRoots: '已保留的请求输入', capacityUnsettled: '未终结或未知运行', capacityUnknown: '未测量',
  checks: {
    node: ['Node 载体', '观察实际 Electron Node-mode 进程与可执行文件，不证明签名或 SHA 完整性。'],
    dsh: ['运行时文件', '尚无实际安装生产依赖与资源清单。'], modules: ['已加载模块', '尚无实际安装 Host/Client 清单。'],
    webview: ['Electron 窗口', '实际窗口、预加载与本地协议仍需载体证据。'],
    storage: ['原子存储', '隔离 UTF-8 写入、替换、冷读与真实原生配额拒绝。'],
    shell: ['Shell', '依当前执行权限运行固定原生命令，并独立读回合成文件。'],
    skills: ['Skills', '官方文件系统 provider 只加载显式合成目录，禁用默认目录。'],
    'action-trust': ['动作信任', '真实执行入口拒绝未信任合成操作。'],
    'action-run': ['动作执行', '固定操作、冷读 journal 与实际隔离 TAP 日志解析；用户源码覆盖仍未知。'],
    'action-change': ['动作变更', '合成配置改变后，原信任在执行入口失效。'],
    cancel: ['取消', '取消已实际启动的长命令并等待进程与输出排空，超时单列。'],
    git: ['Git', '新隔离仓库、本地基线与实际修改比较，不读取用户 Git 配置。'],
    hg: ['Mercurial', '新隔离仓库与本地比较，缺少可执行文件时跳过。'],
    artifact: ['产物变化', '合成字节变化后，真实产物租约读取入口拒绝旧引用。'],
    prefix: ['持久前缀', '测量原文追加／替换、物理恢复拒绝、已提交 Notebook 与准备路由／缓存键分类；提供方缓存命中仍未认证。'],
    recovery: ['中断冷读', '未终结合成检查点只读为 INTERRUPTED/UNKNOWN，不改磁盘或重放，不故意杀当前 Host。'],
    notification: ['通知身份', '私有真实回执/通知 owner 去重，禁用系统弹出。'],
    'probe-failure': ['本地 provider 失败', '官方准备入口在正文和发送前本地拒绝，停止后续准备；不测真实模型或流式重试。'],
    connection: ['连接', '依已确认模型、真实连接及 HTTP 修订发送一次已记录合成请求；本机模式零请求。'],
    streaming: ['流式输出', '首请求的实际增量及成功 finish；本机模式不发送请求。'],
    'tool-call': ['工具协议', '仅观察固定 echo 工具和参数，不执行模型生成命令。'],
    'cache-counter': ['缓存计数', '仅实际报告的缓存计数取得资格，缺失保持 UNKNOWN。'],
    'cache-repeat': ['重复缓存', '两组 2 KiB 输入各重复两次，共享五次请求预算，实际正 cache read 才 PASS。'],
    'native-acceptance': ['原生现场验收', '实际窗口、通知、跨屏、休眠和异常恢复需要目标设备证据。'],
    egress: ['网络现场验收', '应用 HTTP 策略不证明 Shell/Git/socket/worker 或系统全局零外联。'],
  },
}

/** Render localized report controls on the existing authenticated desktop carrier.
 * @param chinese - Actual desktop locale.
 * @returns Complete standalone dashboard; user data is inserted only with textContent.
 */
export function selftestHtml(chinese: boolean): string {
  const t = chinese ? zh : en
  return String.raw`<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>:root{color-scheme:light dark}body{font:var(--dsw-font-size,14px)/1.6 system-ui;margin:0;background:var(--dsw-bg,Canvas);color:var(--dsw-text,CanvasText)}main{max-width:1100px;padding:24px;margin:auto}button,select{font:inherit;padding:8px;max-width:100%}nav{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--dsw-border,GrayText);overflow-wrap:anywhere}td:last-child{min-width:180px}#report{overflow-x:auto}#status{overflow-wrap:anywhere}button:disabled{opacity:.5}@media(max-width:600px){main{padding:12px}}</style>${managementUi()}</head>
<body><main><a href="/api/nidofy-extras/ui?tab=selftest&locale=${chinese ? 'zh-CN' : 'en'}">${chinese ? '返回个人扩展' : 'Back to personal extensions'}</a><h1>${t.title}</h1><p>${t.intro}</p><p>${t.note}</p><nav><button id="start">${t.local}</button><button id="cancel" disabled>${t.cancel}</button><button id="refresh">${t.refresh}</button><button id="json" disabled>${t.json}</button><button id="markdown" disabled>${t.markdown}</button></nav>
<fieldset><legend>${t.route}</legend><p>${t.providerNote}</p><button id="capacity">${t.capacity}</button><p id="capacity-status" role="status"></p><button id="connections">${t.connections}</button><label>${t.route}<select id="route"></select></label><label>${t.budget}<select id="budget"><option>5</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label><button id="prepare">${t.prepare}</button><pre id="confirmation"></pre><label><input id="accept" type="checkbox">${t.accept}</label><button id="provider" disabled>${t.provider}</button></fieldset>
<label>${t.history}<select id="history"></select></label><p id="status" role="status">${t.empty}</p><p id="counts"></p><div id="report"><table><thead><tr><th>${t.check}</th><th>${t.result}</th><th>${t.code}</th><th>${t.scope}</th></tr></thead><tbody id="rows"></tbody></table></div></main>
<script>${managementConfirm(chinese)}(()=>{'use strict';const t=${JSON.stringify(t)},$=id=>document.getElementById(id);let selected=sessionStorage.getItem('nidofy-selftest-id'),active=null,closed=false,polling=false,plan=null,choices=[];
async function rpc(method,input={}){const r=await fetch('/api/nidofy/workbench/selftest/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const v=await r.json();if(!r.ok)throw Error(v.error||'SELFTEST_READ_UNCONFIRMED');return v}
function remember(id){selected=id;if(id)sessionStorage.setItem('nidofy-selftest-id',id);else sessionStorage.removeItem('nidofy-selftest-id')}
function state(){ $('start').disabled=Boolean(active);$('prepare').disabled=Boolean(active)||!choices.length;$('connections').disabled=Boolean(active);$('provider').disabled=Boolean(active)||!plan||!$('accept').checked||Date.now()>plan.expiresAt;$('cancel').disabled=!active||selected!==active;$('json').disabled=$('markdown').disabled=!selected}
function draw(r){$('rows').replaceChildren();if(!r){$('status').textContent=t.unknown;$('counts').textContent='';return}const counts={PASS:0,FAIL:0,UNKNOWN:0,SKIPPED:0};for(const row of r.rows){counts[row.status]++;const tr=document.createElement('tr');for(const text of [t.checks[row.id][0],row.status+' / '+row.phase,row.code,t.checks[row.id][1]]){const td=document.createElement('td');td.textContent=text;tr.append(td)}$('rows').append(tr)}$('counts').textContent=Object.entries(counts).map(([k,v])=>k+': '+v).join(' · ');$('status').textContent=t.progress+': '+r.status+(r.warning?' / '+r.warning:'');state()}
async function refresh(){const s=await rpc('list');active=s.activeId;$('history').replaceChildren();for(const row of s.history){const option=document.createElement('option');option.value=row.id;option.textContent=new Date(row.startedAt).toLocaleString()+' · '+row.status;$('history').append(option)}if(!selected)remember(active||s.history[0]?.id||null);if(selected)$('history').value=selected;state();if(selected)draw(await rpc('read',{id:selected}));else $('status').textContent=t.empty}
function action(id,work){$(id).onclick=async()=>{try{await work()}catch(e){$('status').textContent=e.message}finally{state()}}}
action('start',async()=>{const id=crypto.randomUUID();remember(id);active=id;state();try{draw(await rpc('start',{mode:'local',operationId:id}));await refresh()}catch(e){active=null;$('status').textContent=t.unknown+' '+e.message;throw Error($('status').textContent)}});
function discard(){plan=null;$('accept').checked=false;$('confirmation').textContent='';state()}$('route').onchange=$('budget').onchange=discard;$('accept').onchange=state;
action('connections',async()=>{discard();choices=await rpc('connection-options');$('route').replaceChildren();choices.forEach((row,index)=>{const option=document.createElement('option');option.value=index;option.textContent=row.connection+' / '+row.model;$('route').append(option)})});
action('capacity',async()=>{const c=await rpc('connection-capacity');$('capacity-status').textContent=t.capacityRoots+': '+c.roots+' / 20 · '+t.capacityUnsettled+': '+(c.unsettled===null?t.capacityUnknown:c.unsettled+' / 10')+' · '+c.code});
action('prepare',async()=>{discard();const row=choices[Number($('route').value)];if(!row)return;plan=await rpc('connection-prepare',{...row,requests:Number($('budget').value)});$('confirmation').textContent=JSON.stringify({connection:plan.connection,model:plan.model,connectionRevision:plan.connectionRevision,configurationRevision:plan.configurationRevision,policyRevision:plan.policyRevision,requests:plan.requests,maxOutputTokens:plan.maxOutputTokens,retries:plan.retries},null,2)});
action('provider',async()=>{if(!plan||!$('accept').checked)return;const ticket=plan.ticket;discard();const id=crypto.randomUUID();remember(id);active=id;state();try{draw(await rpc('start',{mode:'provider',operationId:id,ticket,accepted:true}));await refresh()}catch(e){active=null;throw Error(t.unknown+' '+e.message)}});
action('cancel',async()=>{if(selected!==active)return;const id=selected;await rpc('cancel',{id});await refresh()});action('refresh',refresh);$('history').onchange=async()=>{remember($('history').value);try{draw(await rpc('read',{id:selected}))}catch(e){$('status').textContent=e.message}state()};
function download(content,extension,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download='DSH-selftest.'+extension;a.click();URL.revokeObjectURL(url)}
action('json',async()=>{const r=await rpc('export',{id:selected});if(!r)throw Error(t.unknown);download(JSON.stringify(r,null,2),'json','application/json')});
action('markdown',async()=>{const r=await rpc('export',{id:selected});if(!r)throw Error(t.unknown);download(['# '+t.title,t.note,t.progress+': '+r.status,'','| '+[t.check,t.result,t.code,t.scope].join(' | ')+' |','|---|---|---|---|',...r.rows.map(row=>'| '+[t.checks[row.id][0],row.status,row.code,t.checks[row.id][1]].join(' | ')+' |'),''].join('\n'),'md','text/markdown')});
const timer=setInterval(async()=>{if(closed||polling||!active)return;polling=true;try{await refresh()}catch(e){$('status').textContent=e.message}finally{polling=false}},1000);window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer)});refresh().catch(e=>{$('status').textContent=e.message});})();</script></body></html>`
}
