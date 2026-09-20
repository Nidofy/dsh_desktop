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
    row.querySelector('.context-window').setAttribute('aria-label', `模型 ${i + 1} 上下文容量 tokens`);
    row.querySelector('.max-tokens').setAttribute('aria-label', `模型 ${i + 1} 最大输出 tokens`);
    row.querySelector('input[type=radio]').setAttribute('aria-label', `将模型 ${i + 1} 设为默认`);
    const remove = row.querySelector('button');
    remove.disabled = rows.length === 1;
    remove.setAttribute('aria-label', `删除模型 ${i + 1}`);
  });
  $('add-model').disabled = rows.length >= 100;
}
function addModel(id = '', selected = false, limits) {
  const row = document.createElement('div'); row.className = 'model-row';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'default-model'; radio.checked = selected;
  const label = document.createElement('label'); label.className = 'default-model'; label.append(radio, '默认');
  const input = document.createElement('input'); input.className = 'model-id'; input.value = id; input.required = true; input.maxLength = 256; input.placeholder = '模型 ID，例如 deepseek-chat';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '删除';
  remove.onclick = () => { row.remove(); updateModelRows(); };
  const capacity = document.createElement('div'); capacity.className = 'model-capacity';
  const numberField = (title, className, value, min, max) => {
    const label = document.createElement('label'); label.textContent = title;
    const field = document.createElement('input'); field.type = 'number'; field.className = className;
    field.required = true; field.min = min; field.max = max; field.step = '1'; field.value = value;
    label.append(field); capacity.append(label); return field;
  };
  const isGlm = value => /^glm-5\.3(?:-flash)?(?:\[1m\])?$/i.test(value.trim());
  const defaults = () => isGlm(input.value) ? [1000000,128000] : [32768,4096];
  const context = numberField('上下文容量（tokens）', 'context-window', limits?.contextWindow ?? defaults()[0], 1024, 100000000);
  const output = numberField('最大输出（tokens）', 'max-tokens', limits?.maxTokens ?? defaults()[1], 1, 99999999);
  let limitsEdited = !!limits;
  const presetLabel = document.createElement('label'); presetLabel.textContent = '上下文快捷设置';
  const preset = document.createElement('select');
  for (const [value, text] of [['','自定义'],['32768','32K · 32,768'],['131072','128K · 131,072'],['200000','200K · 200,000'],['1000000','1M · 1,000,000']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; preset.append(option);
  }
  const sync = () => {
    preset.value = [...preset.options].some(o => o.value === context.value) ? context.value : '';
    output.setCustomValidity(Number(output.value) >= Number(context.value) ? '最大输出必须小于上下文容量。' : '');
  };
  preset.onchange = () => { limitsEdited = true; if (preset.value) context.value = preset.value; sync(); };
  context.oninput = output.oninput = () => { limitsEdited = true; sync(); }; sync();
  presetLabel.append(preset); capacity.append(presetLabel);
  const note = document.createElement('small'); note.className = 'capacity-note';
  note.textContent = 'GLM 5.3 默认 1M / 128,000；其他模型回退为 32,768 / 4,096。请按服务限制调整。';
  const glmPreset = document.createElement('button'); glmPreset.type = 'button'; glmPreset.className = 'secondary glm-preset'; glmPreset.textContent = 'GLM：1M 上下文 / 128,000 最大输出';
  glmPreset.onclick = () => { context.value = '1000000'; output.value = '128000'; limitsEdited = true; sync(); };
  const suffix = document.createElement('button'); suffix.type = 'button'; suffix.className = 'secondary suffix-fix';
  suffix.textContent = '移除 [1m] 后缀并设为 1M / 128,000';
  const updateSuffix = () => { suffix.hidden = !/^glm-.*\[1m\]$/i.test(input.value.trim()); glmPreset.hidden = !isGlm(input.value); };
  input.oninput = () => { if (!limitsEdited) { [context.value,output.value] = defaults(); sync(); } updateSuffix(); }; updateSuffix();
  suffix.onclick = () => { input.value = input.value.trim().replace(/\[1m\]$/i, ''); context.value = '1000000'; output.value = '128000'; limitsEdited = true; sync(); updateSuffix(); };
  row.append(label, input, remove, capacity, note, glmPreset, suffix); $('models').append(row); updateModelRows();
  return input;
}
$('add-model').onclick = () => { if ($('models').children.length < 100) addModel().focus(); };
$('api').onchange = updateEndpoint; $('url').oninput = updateEndpoint;
invoke('connection').then(c => {
  $('provider').value = c.providerName; $('url').value = c.baseUrl; $('api').value = c.api || 'openai-completions';
  const models = c.models ?? (c.model ? [c.model] : ['']);
  for (const id of models.length ? models : ['']) addModel(id, id === c.model, c.modelLimits?.[id]);
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
  $('message').textContent = '正在保存、同步 DSH 设置并等待新引擎就绪…';
  try {
    const modelLimits = Object.fromEntries(rows.map((row, i) => [models[i], {
      contextWindow: Number(row.querySelector('.context-window').value),
      maxTokens: Number(row.querySelector('.max-tokens').value)
    }]));
    await invoke('save_connection',{connection:{providerName:$('provider').value.trim(),baseUrl:$('url').value.trim(),api:$('api').value,models,model:models[selected],modelLimits},apiKey:$('key').value});
    for (const row of rows) row.querySelector('.capacity-note').textContent = '请按当前服务的实际限制设置，1M = 1,000,000 tokens。';
    $('key').value=''; $('message').textContent='已保存并同步，新的引擎已就绪。旧对话的容量统计将在下一轮请求刷新。';
  } catch(e){$('message').textContent=String(e);} finally{$('connection-fields').disabled=false;}
});
for(const [id,cmd] of [['logs','open_logs'],['restart','restart_engine'],['quit','quit_app']]) $(id).onclick=()=>invoke(cmd).catch(e=>{$('message').textContent=String(e);});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report);$('message').textContent='Diagnostics copied';}catch{$('message').textContent='请选中诊断信息复制';}};
refresh();setInterval(refresh,1000);
