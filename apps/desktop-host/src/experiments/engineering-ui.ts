/** Bilingual independent engineering confirmation retains uncertain identities and never automatically dispatches or retries. */
const english = {
  title: 'Isolated engineering task', help: 'Copy the selected complete inputs into a fresh workspace, then let one bounded Agent turn choose only the reviewed build/test actions. Review the full task, copy input closure, exact commands and independent budget before confirming. Tests and user acceptance remain separate.',
  source: 'Source workspace', paths: 'Complete relative input roots (one per line)', actions: 'Reviewed action IDs (one per line)',
  notebook: 'Optional committed Notebook source Session',
  experiment: 'Experiment identity (UUID; generated when blank)', case: 'Case identity (UUID; generated when blank)',
  cache: 'Optional current Desktop cache mode to confirm', unchanged: 'No cache factor confirmation',
  connection: 'Managed connection', model: 'Model', text: 'Complete task text', budget: 'Independent request, output, tool, action and time limits (JSON)',
  shell: 'Complete Shell output and retained spill limits (JSON)',
  resources: 'Copy, retained-copy and logical Session checkpoint limits (JSON)',
  resourceHelp: 'Resource limits are checked between operations and after drainage. Action-time disk peaks and Host memory peaks remain unknown. Existing copies and outputs are retained on refusal.',
  prepare: 'Preview isolated task', confirm: 'Confirm input, copied workspace, commands and budget', id: 'Retained engineering identity',
  read: 'Read retained engineering task', cancel: 'Cancel and drain engineering task', error: 'Operation was not confirmed',
  unknown: 'Keep this identity and read it; do not resubmit an unconfirmed start.', absent: 'No retained intent is observable; this does not authorize a retry.',
}
const chinese: typeof english = {
  title: '隔离工程任务', help: '将选定的完整输入复制到新工作区，再由一个有界 Agent turn 只选择已审阅的构建／测试动作。确认前检查完整任务、复制输入闭包、准确命令和独立预算。测试与用户验收分别保留。',
  source: '来源工作区', paths: '完整的相对输入根（每行一个）', actions: '已审阅动作 ID（每行一个）',
  notebook: '可选已提交 Notebook 源 Session',
  experiment: '实验身份（UUID；空白时生成）', case: '算例身份（UUID；空白时生成）',
  cache: '可选需要确认的当前 Desktop 缓存模式', unchanged: '不确认缓存因素',
  connection: '受管连接', model: '模型', text: '完整任务文本', budget: '独立请求、输出、工具、动作及时间限额（JSON）',
  shell: '完整 Shell 输出及保留 spill 限额（JSON）',
  resources: '副本、保留副本及逻辑 Session 检查点限额（JSON）',
  resourceHelp: '资源限额在操作之间及排空后检查。动作期间磁盘峰值和 Host 内存峰值保持未知。拒绝后保留已有副本和输出。',
  prepare: '预览隔离任务', confirm: '确认输入、复制工作区、命令及预算', id: '保留工程任务身份',
  read: '读取保留工程任务', cancel: '取消并排空工程任务', error: '操作结果未确认',
  unknown: '保留此身份并读取；不要重新提交尚未确认的启动。', absent: '尚未观察到保留意图；这不授予重试权限。',
}
/** Render explicit engineering controls; edits revoke a preview and page closure only aborts its HTTP/read lifetime.
 * @param zh - Selected page locale.
 * @returns Localized controls with complete private input rendering and independent retained start identity.
 */
export function engineeringTaskControls(zh: boolean): { html: string; script: string } {
  const t = zh ? chinese : english
  const budget = { requests: 2, outputTokensPerRequest: 64, outputTokens: 128, toolCalls: 2, actions: 1, durationMs: 30000 }
  const resourceBudget = { workspaceBytes: 32 * 1024 * 1024, workspaceEntries: 1024,
    retainedWorkspaceBytes: 512 * 1024 * 1024, sessionBytes: 2 * 1024 * 1024, sessionDiskBytes: 2 * 1024 * 1024, sessionEvents: 4096 }
  const shellBudget = { outputBytes: 8 * 1024 * 1024, retainedSpillBytes: 128 * 1024 * 1024 }
  return { html: `<section><h2>${t.title}</h2><p>${t.help}</p>${[['Experiment', t.experiment], ['Case', t.case], ['Source', t.source], ['Connection', t.connection], ['Model', t.model], ['Notebook', t.notebook]].map(([id, label]) => `<label>${label}<input id="engineering${id}"></label>`).join('')}<label>${t.cache}<select id="engineeringCache"><option value="">${t.unchanged}</option><option value="native">native</option><option value="off">off</option><option value="session">session</option></select></label>${[['Paths', t.paths], ['Actions', t.actions], ['Text', t.text]].map(([id, label]) => `<label>${label}<textarea id="engineering${id}" rows="3"></textarea></label>`).join('')}<label>${t.budget}<textarea id="engineeringBudget" rows="3">${JSON.stringify(budget)}</textarea></label><p>${t.resourceHelp}</p><label>${t.resources}<textarea id="engineeringResources" rows="3">${JSON.stringify(resourceBudget)}</textarea></label><label>${t.shell}<textarea id="engineeringShell" rows="2">${JSON.stringify(shellBudget)}</textarea></label><button id="engineeringPrepare">${t.prepare}</button><pre id="engineeringPreview"></pre><button id="engineeringConfirm" disabled>${t.confirm}</button><label>${t.id}<input id="engineeringId"></label><button id="engineeringRead">${t.read}</button><button id="engineeringCancel" disabled>${t.cancel}</button><pre id="engineeringResult"></pre><p id="engineeringStatus" role="status"></p></section>`,
    script: String.raw`{const engineeringText=${JSON.stringify(t)},engineeringKey='nidofy-engineering-task-pending';let engineeringEpoch=0,engineeringPlan=null,engineeringStarting=false;const retained=localStorage.getItem(engineeringKey);if(retained)$('engineeringId').value=retained;
const engineeringInvalidate=()=>{engineeringEpoch++;engineeringPlan=null;$('engineeringPreview').textContent='';$('engineeringConfirm').disabled=true};for(const id of ['Experiment','Case','Source','Connection','Model','Paths','Actions','Text','Budget','Resources','Shell','Notebook','Cache'])$('engineering'+id).oninput=engineeringInvalidate;$('engineeringId').oninput=()=>{$('engineeringCancel').disabled=true;engineeringEpoch++;$('engineeringResult').textContent=''};
const engineeringAction=fn=>async()=>{try{$('engineeringStatus').textContent='';await fn()}catch(error){if(!closed)$('engineeringStatus').textContent=engineeringText.error+': '+error.message}};
$('engineeringPrepare').onclick=engineeringAction(async()=>{if(engineeringStarting)return;if(localStorage.getItem(engineeringKey))throw Error(engineeringText.unknown);engineeringInvalidate();if(!$('engineeringExperiment').value)$('engineeringExperiment').value=crypto.randomUUID();if(!$('engineeringCase').value)$('engineeringCase').value=crypto.randomUUID();const current=engineeringEpoch,value=await api('experiments/engineering-prepare',{experimentId:$('engineeringExperiment').value,caseId:$('engineeringCase').value,text:$('engineeringText').value,connection:$('engineeringConnection').value,model:$('engineeringModel').value,source:$('engineeringSource').value,paths:$('engineeringPaths').value.split(/\r?\n/).filter(Boolean),actionIds:$('engineeringActions').value.split(/\r?\n/).filter(Boolean),budget:JSON.parse($('engineeringBudget').value),resourceBudget:JSON.parse($('engineeringResources').value),shellBudget:JSON.parse($('engineeringShell').value),...$('engineeringNotebook').value?{notebookSessionId:$('engineeringNotebook').value}:{},...$('engineeringCache').value?{cacheMode:$('engineeringCache').value}:{}});if(closed||current!==engineeringEpoch)return;engineeringPlan=value;$('engineeringPreview').textContent=JSON.stringify(value,null,2);$('engineeringConfirm').disabled=false});
$('engineeringConfirm').onclick=engineeringAction(async()=>{if(!engineeringPlan||engineeringStarting)return;const chosen=engineeringPlan,id=crypto.randomUUID(),current=++engineeringEpoch;engineeringPlan=null;engineeringStarting=true;$('engineeringConfirm').disabled=true;localStorage.setItem(engineeringKey,id);$('engineeringId').value=id;try{const value=await api('experiments/engineering-start',{id,ticket:chosen.ticket,accepted:true});if(!closed&&current===engineeringEpoch){$('engineeringCancel').disabled=value?.canCancel!==true;$('engineeringResult').textContent=JSON.stringify(value,null,2)}}catch(error){if(!closed)$('engineeringStatus').textContent=engineeringText.unknown+' '+id+' · '+error.message}finally{engineeringStarting=false}});
for(const [id,method] of [['engineeringRead','engineering-read'],['engineeringCancel','engineering-cancel']])$(id).onclick=engineeringAction(async()=>{const current=++engineeringEpoch,chosen=$('engineeringId').value,value=await api('experiments/'+method,{id:chosen});if(closed||current!==engineeringEpoch||$('engineeringId').value!==chosen)return;$('engineeringCancel').disabled=value?.canCancel!==true;$('engineeringResult').textContent=value?JSON.stringify(value,null,2):engineeringText.absent;if(value?.terminal&&localStorage.getItem(engineeringKey)===chosen)localStorage.removeItem(engineeringKey)});
}` }
}
