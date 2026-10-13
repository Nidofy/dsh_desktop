/** Explicit task-request controls retain uncertain run identities and require full-input and budget confirmation. */
const english = {
  title: 'Single task request', help: 'Send one private analysis task with no tools or project writes. Preview any explicitly selected Notebook input before confirming. Applied cache hints and provider-reported model names are observations; exact versions, provider caching and engineering task A/B remain unknown.',
  connection: 'Managed connection', model: 'Model', task: 'Complete task text', tokens: 'Maximum output tokens',
  notebook: 'Optional Notebook source Session',
  prepare: 'Prepare request', confirm: 'Confirm this input and budget; send once', cancel: 'Cancel and drain request',
  read: 'Read retained task request', id: 'Retained run identity', preview: 'Confirm the full private input, connection revisions and one-request budget below before sending.',
  unknown: 'The result is unconfirmed. Retain this run identity and read it; do not resubmit automatically.',
  error: 'Operation was not confirmed', absent: 'No retained intent is observable. This does not authorize resubmission.',
}
const chinese: typeof english = {
  title: '单次任务请求', help: '发送一项私密分析任务，不提供工具或工程写入。确认前预览显式选择的 Notebook 输入。已应用缓存提示和提供方报告的模型名称是观察事实；准确版本、提供方缓存与工程任务 A/B 仍保持未知。',
  connection: '受管连接', model: '模型', task: '完整任务文本', tokens: '输出 tokens 上限',
  notebook: '可选 Notebook 源 Session',
  prepare: '准备请求', confirm: '确认此输入与预算，发送一次', cancel: '取消并排空请求',
  read: '读取保留任务请求', id: '保留运行身份', preview: '发送前请确认下方完整私密输入、连接修订和单次请求预算。',
  unknown: '结果尚未确认。请保留此运行身份并读取，不要自动重新提交。',
  error: '操作结果未确认', absent: '尚未观察到保留意图；这不授予重新提交权限。',
}
/** Render controls without automatic preparation, sending, private reading or retry.
 * @param zh - Selected page locale.
 * @returns Localized markup and a scoped script; input edits invalidate pending confirmations.
 */
export function taskRequestControls(zh: boolean): { html: string; script: string } {
  const t = zh ? chinese : english
  return { html: `<section><h2>${t.title}</h2><p>${t.help}</p><div class="row"><label>${t.connection}<input id="taskConnection"></label><label>${t.model}<input id="taskModel"></label><label>${t.tokens}<input id="taskTokens" type="number" min="1" max="8192" value="64"></label></div><label>${t.notebook}<input id="taskNotebook"></label><label>${t.task}<textarea id="taskText" rows="5"></textarea></label><button id="taskPrepare">${t.prepare}</button><p>${t.preview}</p><pre id="taskPreview"></pre><button id="taskConfirm" disabled>${t.confirm}</button><div class="row"><label>${t.id}<input id="taskId"></label><button id="taskRead">${t.read}</button><button id="taskCancel" disabled>${t.cancel}</button></div><pre id="taskResult"></pre><p id="taskStatus" role="status"></p></section>`,
    script: String.raw`{const taskText=${JSON.stringify(t)},taskKey='nidofy-task-request-pending';let taskEpoch=0,plan=null,starting=false;const taskIdentity=localStorage.getItem(taskKey);if(taskIdentity)$('taskId').value=taskIdentity;
function taskInvalidate(){taskEpoch++;plan=null;$('taskPreview').textContent='';$('taskConfirm').disabled=true}
for(const id of ['taskConnection','taskModel','taskTokens','taskText','taskNotebook'])$(id).oninput=taskInvalidate;
$('taskId').oninput=()=>{$('taskCancel').disabled=true;taskEpoch++;$('taskResult').textContent=''};
const taskAction=fn=>async()=>{try{$('taskStatus').textContent='';await fn()}catch(error){if(!closed)$('taskStatus').textContent=taskText.error+': '+error.message}};
$('taskPrepare').onclick=taskAction(async()=>{if(starting)return;if(localStorage.getItem(taskKey))throw Error(taskText.unknown);taskInvalidate();const current=taskEpoch;const value=await api('experiments/task-prepare',{experimentId:crypto.randomUUID(),caseId:crypto.randomUUID(),connection:$('taskConnection').value,model:$('taskModel').value,text:$('taskText').value,maxOutputTokens:Number($('taskTokens').value),...$('taskNotebook').value?{notebookSessionId:$('taskNotebook').value}:{}});if(closed||current!==taskEpoch)return;plan=value;$('taskPreview').textContent=JSON.stringify(value,null,2);$('taskConfirm').disabled=false});
$('taskConfirm').onclick=taskAction(async()=>{if(!plan||starting)return;const chosen=plan,id=crypto.randomUUID(),current=++taskEpoch;starting=true;plan=null;$('taskConfirm').disabled=true;localStorage.setItem(taskKey,id);$('taskId').value=id;$('taskResult').textContent='';try{const value=await api('experiments/task-start',{id,ticket:chosen.ticket,accepted:true});if(!closed&&current===taskEpoch&&$('taskId').value===id){$('taskCancel').disabled=value?.canCancel!==true;$('taskResult').textContent=JSON.stringify(value,null,2)}}catch(error){if(!closed)$('taskStatus').textContent=taskText.unknown+' '+id+' · '+error.message}finally{starting=false}});
for(const [control,method] of [['taskRead','task-read'],['taskCancel','task-cancel']])$(control).onclick=taskAction(async()=>{const id=$('taskId').value,current=++taskEpoch;const value=await api('experiments/'+method,{id});if(closed||current!==taskEpoch||$('taskId').value!==id)return;$('taskCancel').disabled=value?.canCancel!==true;$('taskResult').textContent=value?JSON.stringify(value,null,2):taskText.absent;if(value?.terminal&&localStorage.getItem(taskKey)===id)localStorage.removeItem(taskKey)});
}` }
}
