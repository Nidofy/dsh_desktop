export const actionsHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSHDesktop · 项目操作</title>
<style>body{margin:0}main{max-width:1200px;margin:auto;padding:28px}h1{margin:0;font-size:26px}h2{font-size:18px}p,small{color:var(--dsw-alias-label-tertiary)}section{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:20px;margin:20px 0}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,input,select,textarea,a.button{font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:8px 12px}button,a.button{cursor:pointer;text-decoration:none}button:hover{background:var(--dsw-alias-interactive-bg-hover)}button:disabled{opacity:.45;cursor:default}input{flex:1;min-width:240px}textarea{width:100%;box-sizing:border-box;min-height:250px;font:13px/1.5 Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;font:13px/1.6 Consolas,monospace}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.action{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:14px}.action b{display:block;font-size:17px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid var(--dsw-alias-border-l2);padding:9px;white-space:nowrap}#notice{min-height:24px;color:var(--dsw-alias-state-warn-label)}#trust{color:var(--dsw-alias-state-success-primary)}a{color:var(--dsw-alias-link)}@media(max-width:650px){main{padding:14px}section{padding:14px}}</style>
<link rel="stylesheet" href="/desktop-diagnostics/theme.css"><script src="/desktop-diagnostics/theme.js" defer></script><script src="/desktop-diagnostics/actions.js" defer></script></head><body><main>
<div class="bar"><h1>项目操作</h1><a href="/desktop-diagnostics">会话诊断</a></div>
<p>一处配置构建、测试和回归。界面与 Agent 共用执行后端，同一工作区按顺序运行。</p>
<section><div class="bar"><input id="workspace" aria-label="工作区绝对路径" placeholder="工作区绝对路径"><button id="load">打开工作区</button></div><p id="notice" role="status"></p><small id="trust"></small></section>
<section><h2>可用操作</h2><div id="actions" class="grid"></div><p>界面执行使用工作区写入权限；Agent 执行遵守会话当前权限。构建工具需在本机安装。命令可包含显式的构建环境初始化脚本；超时可能被引擎上限收紧。</p></section>
<section><h2>配置与信任</h2><p>首次读取项目内的 <code>.dsh/project-actions.json</code>；保存后使用本机配置。命令是 PowerShell 脚本，执行前请检查。环境变量以明文保存，请勿在此填写密钥。可用 artifacts 数组声明产物路径（相对工作区，如 reports/result.csv）；执行日志自动关联。</p><textarea id="config" aria-label="项目操作配置" spellcheck="false"></textarea><p><label><input id="reviewed" type="checkbox" style="min-width:auto"> 我已检查完整配置，允许界面与 Agent 按各自权限执行</label></p><div class="bar"><button id="save">保存本机配置</button><button id="approve" disabled>信任已保存配置</button><button id="revoke" disabled>撤销信任</button></div><p>信任仅适用于当前工作区及完整配置。配置变化后需重新信任；排队中的操作会在执行前再次检查。</p></section>
<section><div class="bar"><h2>执行记录</h2><button id="refresh">刷新</button><a id="artifacts-link" href="/desktop-diagnostics/artifacts">文件与产物</a></div><p>保留最近 100 份完成记录，每份日志最多 1 MiB。日志可能含项目内容，仅保存在本机。INTERRUPTED 表示未确认最终结果，不会自动重跑。</p><div class="scroll"><table><thead><tr><th>开始时间</th><th>操作</th><th>状态</th><th>耗时</th><th>退出码</th><th>操作</th></tr></thead><tbody id="runs"></tbody></table></div><pre id="log">选择一条记录查看日志。</pre></section>
</main></body></html>`;

export const actionsScript = String.raw`
'use strict';
const $=id=>document.getElementById(id);
let current, root='', dirty=false, busy=false, renderedActions='', renderedRuns='';
const sample={schemaVersion:1,actions:[{id:'test',label:'运行测试',command:'Write-Output "请在这里配置工程测试命令"',cwd:'.',timeoutMs:600000,env:{}}]};
async function api(path,data){const response=await fetch('/desktop-diagnostics/api/actions/'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error??'请求失败');return result;}
function message(error){$('notice').textContent=error?.message??String(error);}
function render(updateEditor=false){
 $('artifacts-link').href='/desktop-diagnostics/artifacts?workspace='+encodeURIComponent(root);
 $('trust').textContent=(current.trusted?'已信任':'尚未信任')+' · '+(current.source==='desktop'?'本机配置':'项目配置')+' · '+current.workspace;
 if(updateEditor){$('config').value=JSON.stringify(current.config.actions.length?current.config:sample,null,2);dirty=!current.config.actions.length;$('reviewed').checked=false;}
 $('approve').disabled=dirty||current.trusted||!current.config.actions.length||!$('reviewed').checked;
 $('revoke').disabled=!current.trusted;
 const actionSignature=root+current.fingerprint+current.trusted;
 if(actionSignature!==renderedActions){renderedActions=actionSignature;
  $('actions').replaceChildren(...current.config.actions.map(action=>{const card=document.createElement('div');card.className='action';const title=document.createElement('b');title.textContent=action.label;const command=document.createElement('pre');command.textContent=action.command;const button=document.createElement('button');button.textContent='运行';button.disabled=!current.trusted;button.onclick=()=>perform(async()=>{await api('start',{workspace:root,id:action.id});await refresh();});card.append(title,command,button);return card;}));
  if(!current.config.actions.length)$('actions').textContent='暂无操作。编辑下方配置并保存，然后检查并信任。';
 }
 const runSignature=root+JSON.stringify(current.runs);
 if(runSignature!==renderedRuns){renderedRuns=runSignature;
  $('runs').replaceChildren(...current.runs.map(run=>{const tr=document.createElement('tr');for(const value of [new Date(run.createdAt).toLocaleString(),run.label,run.status+(run.persistenceFailed?'（记录未保存）':''),run.durationMs==null?'—':(run.durationMs/1000).toFixed(1)+'s',run.exitCode??'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}const td=document.createElement('td');const show=document.createElement('button');show.textContent='查看';show.onclick=()=>perform(async()=>{$('log').textContent=run.message??run.status;if(run.logAvailable){const log=await api('log?workspace='+encodeURIComponent(root)+'&id='+run.id);$('log').textContent=(run.logTruncated?'[日志截断，仅保留部分输出]\n':'')+log.text;}});td.append(show);if(['RUNNING','QUEUED'].includes(run.status)){const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>perform(async()=>{await api('cancel',{workspace:root,id:run.id});await refresh();});td.append(cancel);}tr.append(td);return tr;}));
 }
}
async function refresh(editor=false){if(!root)return;const expected=root;const value=await api('inspect?workspace='+encodeURIComponent(root));if(expected!==root)return;if(current&&current.fingerprint!==value.fingerprint){$('reviewed').checked=false;if(!dirty)editor=true;}current=value;render(editor);}
async function perform(action){if(busy)return;busy=true;try{$('notice').textContent='';await action();}catch(error){message(error);}finally{busy=false;}}
$('load').onclick=()=>perform(async()=>{const value=await api('inspect?workspace='+encodeURIComponent($('workspace').value.trim()));root=value.workspace;current=value;$('log').textContent='选择一条记录查看日志。';render(true);localStorage.setItem('dsh-actions-workspace',root);});
$('refresh').onclick=()=>perform(()=>refresh());
$('config').oninput=()=>{dirty=true;$('reviewed').checked=false;$('approve').disabled=true;};
$('reviewed').onchange=()=>{if(current)render();};
$('save').onclick=()=>perform(async()=>{if(!root)throw Error('请先打开工作区');const config=JSON.parse($('config').value);current=await api('save',{workspace:root,config});dirty=false;render(true);$('notice').textContent='已保存，请检查命令后信任。';});
$('approve').onclick=()=>perform(async()=>{if(!current||dirty||!$('reviewed').checked)throw Error('请先保存并检查完整配置');current=await api('trust',{workspace:root,fingerprint:current.fingerprint});$('reviewed').checked=false;render();});
$('revoke').onclick=()=>perform(async()=>{current=await api('revoke',{workspace:root});render();});
const supplied=new URLSearchParams(location.search).get('workspace');$('workspace').value=supplied??localStorage.getItem('dsh-actions-workspace')??'';
setInterval(()=>{if(!busy&&root&&document.visibilityState==='visible')perform(()=>refresh());},2500);
`;
