'use strict';
const invoke = window.__TAURI__.core.invoke;
const $ = id => document.getElementById(id);
let report = '';
async function refresh() {
  try {
    const d = await invoke('diagnostics');
    $('health').textContent = d.backendHealth;
    $('detail').textContent = d.detail;
    report = Object.entries(d).map(([k,v]) => `${k}: ${v ?? '—'}`).join('\n');
    $('diagnostics').textContent = report;
  } catch { $('detail').textContent = '无法读取桌面诊断信息'; }
}
function updateEndpoint() {
  const anthropic = $('api').value === 'anthropic-messages';
  $('url').placeholder = anthropic ? 'http://your-server' : 'http://your-server/v1';
  $('url-help').textContent = anthropic
    ? '填写 API 根地址，也接受末尾 /v1；不要填写完整 /messages 路径。'
    : '填写 API 基础地址（通常以 /v1 结尾），不要填写完整 /chat/completions 路径。';
  let base = $('url').value.trim().replace(/\/+$/, '');
  if (anthropic) base = base.replace(/\/v1$/, '');
  $('endpoint').textContent = base ? `请求地址：${base}${anthropic ? '/v1/messages' : '/chat/completions'}` : '';
}
function updateModelRows() {
  const rows = [...$('models').children];
  if (!rows.some(row => row.querySelector('input[type=radio]').checked) && rows.length)
    rows[0].querySelector('input[type=radio]').checked = true;
  rows.forEach((row, i) => {
    row.querySelector('.model-id').setAttribute('aria-label', `模型 ${i + 1} ID`);
    row.querySelector('input[type=radio]').setAttribute('aria-label', `将模型 ${i + 1} 设为默认`);
    const remove = row.querySelector('button');
    remove.disabled = rows.length === 1;
    remove.setAttribute('aria-label', `删除模型 ${i + 1}`);
  });
  $('add-model').disabled = rows.length >= 100;
}
function addModel(id = '', selected = false) {
  const row = document.createElement('div'); row.className = 'model-row';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'default-model'; radio.checked = selected;
  const label = document.createElement('label'); label.className = 'default-model'; label.append(radio, '默认');
  const input = document.createElement('input'); input.className = 'model-id'; input.value = id; input.required = true; input.maxLength = 256; input.placeholder = '模型 ID，例如 deepseek-chat';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '删除';
  remove.onclick = () => { row.remove(); updateModelRows(); };
  row.append(label, input, remove); $('models').append(row); updateModelRows();
  return input;
}
$('add-model').onclick = () => { if ($('models').children.length < 100) addModel().focus(); };
$('api').onchange = updateEndpoint; $('url').oninput = updateEndpoint;
invoke('connection').then(c => {
  $('provider').value = c.providerName; $('url').value = c.baseUrl; $('api').value = c.api || 'openai-completions';
  const models = c.models ?? (c.model ? [c.model] : ['']);
  for (const id of models.length ? models : ['']) addModel(id, id === c.model);
  updateEndpoint(); $('connection-fields').disabled = false; $('message').textContent = '';
}).catch(e => { $('message').textContent = `无法读取配置：${e}。请修复后重新打开设置。`; });
$('settings').addEventListener('submit',async event=>{
  event.preventDefault();
  const rows = [...$('models').children];
  const models = rows.map(row => row.querySelector('.model-id').value.trim());
  if (models.some(id => !id) || new Set(models).size !== models.length) {
    $('message').textContent = '请填写不重复且非空的模型 ID。'; return;
  }
  const selected = rows.findIndex(row => row.querySelector('input[type=radio]').checked);
  if (selected < 0) { $('message').textContent = '请选择默认模型。'; return; }
  $('connection-fields').disabled = true;
  try {
    await invoke('save_connection',{connection:{providerName:$('provider').value.trim(),baseUrl:$('url').value.trim(),api:$('api').value,models,model:models[selected]},apiKey:$('key').value});
    $('key').value=''; $('message').textContent='已保存，正在重启引擎。';
  } catch(e){$('message').textContent=String(e);} finally{$('connection-fields').disabled=false;}
});
for(const [id,cmd] of [['logs','open_logs'],['restart','restart_engine'],['quit','quit_app']]) $(id).onclick=()=>invoke(cmd).catch(e=>{$('message').textContent=String(e);});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report);$('message').textContent='Diagnostics copied';}catch{$('message').textContent='请选中诊断信息复制';}};
refresh();setInterval(refresh,1000);
