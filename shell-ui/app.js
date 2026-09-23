'use strict';
const invoke = window.__TAURI__.core.invoke;
const $ = id => document.getElementById(id);
let report = '';
let catalog, selectedProfile = null, profileDirty = false, profileBusy = false, builtinProvider = null;
let latestDiagnostics=null;
function updateProviderStatuses(){
  for(const row of $('provider-rows').children){
    const id=row.dataset.profileId,current=latestDiagnostics?.activeProfileId===id;
    const applied=current && latestDiagnostics.backendHealth==='ready' && !latestDiagnostics.activeProfileNeedsApply;
    row.querySelector('.provider-state').textContent=applied?'当前连接':current&&latestDiagnostics.activeProfileNeedsApply?'配置待应用':current&&latestDiagnostics.backendHealth==='failed'?'启动失败':'已保存';
    const button=row.querySelector('.profile-apply');button.textContent=applied?'已应用':'应用';button.dataset.applied=String(applied);button.disabled=profileBusy||applied;
  }
}
const providerPresets = window.desktopProviderCatalog;
function profileControls() {
  $('delete-profile').disabled = profileBusy || profileDirty || !selectedProfile;
  $('activate-profile').disabled = profileBusy || profileDirty || !selectedProfile;
  $('profile-select').disabled = profileBusy || !catalog;
  for (const id of ['new-profile','add-provider','deepseek-preset','close-provider','cancel-provider']) $(id).disabled = profileBusy || !catalog;
  for(const button of $('provider-rows').querySelectorAll('button')) button.disabled = profileBusy || button.dataset.applied==='true';
  $('reload-profiles').disabled = profileBusy;
  document.dispatchEvent(new Event('profile-controls-updated'));
}
function markProfileDirty() { profileDirty = true; profileControls(); }
async function refresh() {
  try {
    const d = await invoke('diagnostics');
    latestDiagnostics=d;updateProviderStatuses();
    $('health').textContent = d.backendHealth;
    $('detail').textContent = d.detail;
    $('profile-status').textContent = d.activeProfileId ? `当前引擎：${d.activeProfileName} · ${d.backendHealth}` : '引擎尚未载入连接';
    report = Object.entries(d).map(([k,v]) => `${k}: ${v!=null&&typeof v==='object'?JSON.stringify(v):v??'—'}`).join('\n');
    $('diagnostics').textContent = report;
    document.dispatchEvent(new CustomEvent('desktop-diagnostics-updated',{detail:d}));
  } catch { $('detail').textContent = '无法读取桌面诊断信息'; }
}
function updateEndpoint() {
  const anthropic = $('api').value === 'anthropic-messages';
  $('cache-markers').disabled = anthropic || ['automatic','long'].includes($('cache-retention').value);
  if ($('cache-markers').disabled) $('cache-markers').checked = false;
  $('cache-key-mode').disabled = anthropic;
  if (anthropic && $('cache-key-mode').value === 'session') $('cache-key-mode').value = 'off';
  updateCacheKeyRows();
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
function updateCacheKeyRows() {
  for (const field of document.querySelectorAll('.cache-key-model')) field.disabled = $('api').value !== 'openai-completions' || $('cache-key-mode').value !== 'session';
}
function addModel(id = '', selected = false, limits, cacheKeyAllowed = false, capability) {
  const row = document.createElement('div'); row.className = 'model-row';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'default-model'; radio.checked = selected;
  const label = document.createElement('label'); label.className = 'default-model'; label.append(radio, '默认');
  const input = document.createElement('input'); input.className = 'model-id'; input.value = id; input.required = true; input.maxLength = 256; input.placeholder = '模型 ID，例如 deepseek-chat';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '删除';
  remove.onclick = () => { row.remove(); updateModelRows(); markProfileDirty(); };
  const keyLabel = document.createElement('label'); keyLabel.className = 'capacity-note';
  const cacheKey = document.createElement('input'); cacheKey.type = 'checkbox'; cacheKey.className = 'cache-key-model'; cacheKey.checked = cacheKeyAllowed;
  keyLabel.append(cacheKey, '已确认此模型的服务支持 prompt_cache_key');
  const capacity = document.createElement('div'); capacity.className = 'model-capacity';
  const numberField = (title, className, value, min, max) => {
    const label = document.createElement('label'); label.textContent = title;
    const field = document.createElement('input'); field.type = 'number'; field.className = className;
    field.required = true; field.min = min; field.max = max; field.step = '1'; field.value = value;
    label.append(field); capacity.append(label); return field;
  };
  const isGlm = value => /^glm-5\.3(?:-flash)?(?:\[1m\])?$/i.test(value.trim());
  const defaults = () => [32768,4096];
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
  note.textContent = '容量为客户端保护上限，请按服务文档调整。模型名称不会自动确定网关能力。';
  row.capability=capability??{source:builtinProvider?'preset':'unknown',reasoning:null};
  const capabilityLabel=document.createElement('label');capabilityLabel.textContent=`能力来源：${row.capability.source} · 推理档位`;
  const reasoning=document.createElement('select');for(const [value,text] of [['keep','保留当前声明'],['none','未知 / 不发送推理参数'],['off,low,medium,high','已确认：off / low / medium / high'],['off,minimal,low,medium,high,xhigh,max','已确认：全部档位']])reasoning.add(new Option(text,value));
  reasoning.onchange=()=>{row.capability=reasoning.value==='keep'?(capability??{source:'unknown',reasoning:null}):{source:'user',reasoning:reasoning.value==='none'?[]:reasoning.value.split(',')};};capabilityLabel.append(reasoning);capacity.append(capabilityLabel);
  const glmPreset = document.createElement('button'); glmPreset.type = 'button'; glmPreset.className = 'secondary glm-preset'; glmPreset.textContent = 'GLM：1M 上下文 / 128,000 最大输出';
  glmPreset.onclick = () => { context.value = '1000000'; output.value = '128000'; limitsEdited = true; sync(); };
  const suffix = document.createElement('button'); suffix.type = 'button'; suffix.className = 'secondary suffix-fix';
  suffix.textContent = '移除 [1m] 后缀并设为 1M / 128,000';
  const updateSuffix = () => { suffix.hidden = !/^glm-.*\[1m\]$/i.test(input.value.trim()); glmPreset.hidden = !isGlm(input.value); };
  input.oninput = () => { row.capability={source:'unknown',reasoning:null};reasoning.value='none';cacheKey.checked = false; if (!limitsEdited) { [context.value,output.value] = defaults(); sync(); } updateSuffix(); }; updateSuffix();
  suffix.onclick = () => { cacheKey.checked = false; input.value = input.value.trim().replace(/\[1m\]$/i, ''); context.value = '1000000'; output.value = '128000'; limitsEdited = true; sync(); updateSuffix(); markProfileDirty(); };
  row.append(label, input, remove, capacity, note, glmPreset, suffix, keyLabel); $('models').append(row); updateModelRows(); updateCacheKeyRows();
  return input;
}
$('add-model').onclick = () => { if ($('models').children.length < 100) { addModel().focus(); markProfileDirty(); } };
function openProviderEditor(mode) {
  if (profileBusy) return;
  if (profileDirty) { $('message').textContent='请先保存当前修改，或点击取消。'; return; }
  renderProfile(null);
  $('settings').hidden=false;
  $('known-provider-label').hidden=mode!=='known';
  $('provider-editor-title').textContent=mode==='deepseek'?'DeepSeek 官方连接':mode==='known'?'添加提供方':'添加自定义提供方';
  if(mode!=='custom') applyProviderPreset(mode==='deepseek'?'deepseek':$('known-provider').value);
  else { $('provider-custom-settings').open=true; $('provider').focus(); }
}
function applyProviderPreset(id) {
  const preset=providerPresets.find(p=>p.id===id); if(!preset)return;
  // A different provider must never inherit the previous draft's API key.
  $('key').value=''; builtinProvider=id;
  $('provider').value=preset.name; $('api').value=preset.api; $('url').value=preset.baseUrl;
  $('models').replaceChildren();
  for(const model of preset.models) addModel(model.id,model.id===preset.model,model);
  $('provider-preset-summary').textContent=`${preset.name} · ${preset.models.length} 个模型 · 默认 ${preset.model}`;
  $('provider-preset-summary').hidden=false;
  $('provider-custom-settings').open=false;
  $('cache-retention').value=preset.api==='anthropic-messages'?'short':'automatic';$('cache-key-mode').value='off';$('cache-markers').checked=false;
  $('key').required=true;
  updateEndpoint();markProfileDirty();$('key').focus();
  $('message').textContent='填写 API Key 后保存。地址、协议和模型已自动配置。';
}
for(const preset of providerPresets.filter(p=>p.id!=='deepseek')) $('known-provider').add(new Option(preset.name,preset.id));
$('known-provider').onchange=()=>applyProviderPreset($('known-provider').value);
$('deepseek-preset').onclick=()=>openProviderEditor('deepseek');
$('add-provider').onclick=()=>openProviderEditor('known');
function closeProviderEditor(){
  if(profileBusy)return;
  renderProfile(catalog.activeId);$('settings').hidden=true;
  $('message').textContent='';
}
$('close-provider').onclick=$('cancel-provider').onclick=closeProviderEditor;
$('cache-retention').onchange = updateEndpoint;
$('cache-key-mode').onchange = updateCacheKeyRows;
$('api').onchange = updateEndpoint; $('url').oninput = updateEndpoint;
function proxyFields() {
  const custom = $('proxy-mode').value === 'explicit';
  $('proxy-url').disabled = $('no-proxy').disabled = !custom;
  $('proxy-url').required = custom;
}
function renderProfile(id) {
  selectedProfile = id;
  $('known-provider-label').hidden=true; $('provider-preset-summary').hidden=true; $('key').required=false;
  $('provider-custom-settings').open=true;
  const profile = catalog.profiles.find(p => p.id === id);
  const c = profile?.connection ?? {providerName:'新连接',baseUrl:'',model:''};
  builtinProvider=c.builtinProvider??null;
  $('key').required=!profile; $('key').placeholder=profile?'留空以保留已保存的 API Key':'输入 API Key';
  $('provider-editor-title').textContent=profile?`编辑 ${c.providerName}`:'添加自定义提供方';
  $('profile-select').value = id ?? '';
  $('models').replaceChildren(); $('key').value = '';
  $('provider').value = c.providerName; $('url').value = c.baseUrl; $('api').value = c.api || 'openai-completions';
  $('url').readOnly = false; $('api').disabled = false;
  $('request-timeout').value = (c.timeoutMs ?? 300000) / 1000;
  $('idle-timeout').value = (c.streamIdleTimeoutMs ?? 300000) / 1000;
  $('cache-retention').value = c.cache?.retention ?? (profile ? 'native' : 'automatic');
  $('cache-markers').checked = c.cache?.anthropicMarkers ?? false;
  $('cache-key-mode').value = c.cache?.keyMode ?? (profile ? 'native' : 'off');
  $('proxy-mode').value = profile?.network.proxyMode ?? 'inherit';
  $('proxy-url').value = profile?.network.proxyUrl ?? '';
  $('no-proxy').value = profile?.network.noProxy ?? '';
  $('ca-file').value = profile?.network.caFile ?? '';
  proxyFields();
  const models = c.models ?? (c.model ? [c.model] : ['']);
  for (const id of models.length ? models : ['']) addModel(id, id === c.model, c.modelLimits?.[id], c.cache?.keyModels?.includes(id),c.modelCapabilities?.[id]);
  updateEndpoint(); $('connection-fields').disabled = false; profileDirty = false; profileControls();
  $('message').textContent = $('settings').hidden ? '' : profile ? 'API Key 留空可保留现有密钥。' : '填写连接和模型后保存。';
}
function renderCatalog(value, id = value.activeId) {
  catalog = value; $('profile-select').replaceChildren(); $('provider-rows').replaceChildren();
  for (const profile of catalog.profiles) {
    if(profile.connection.baseUrl){
      const row=document.createElement('div');row.className='provider-row';row.dataset.profileId=profile.id;
      const name=document.createElement('strong');name.textContent=profile.connection.providerName;
      const meta=document.createElement('small');meta.className='provider-state';
      const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';edit.setAttribute('aria-label',`编辑 ${profile.connection.providerName}`);
      edit.onclick=()=>{if(profileDirty){$('message').textContent='请先保存当前修改，或点击取消。';return;}renderProfile(profile.id);$('settings').hidden=false;$('key').focus();};
      const use=document.createElement('button');use.type='button';use.className='profile-apply';
      use.onclick=()=>{if(profileDirty){$('message').textContent='请先保存当前修改，或点击取消。';return;}renderProfile(profile.id);$('activate-profile').onclick();};
      const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.setAttribute('aria-label',`删除 ${profile.connection.providerName}`);
      remove.onclick=()=>{if(profileDirty){$('message').textContent='请先保存当前修改，或点击取消。';return;}renderProfile(profile.id);$('delete-profile').onclick();};
      const actions=document.createElement('div');actions.className='actions';actions.append(edit,use,remove);
      row.append(name,meta,actions);$('provider-rows').append(row);
    }

    const option = document.createElement('option'); option.value = profile.id;
    option.textContent = profile.connection.providerName + (profile.id === catalog.activeId ? ' · 已选择' : '');
    $('profile-select').append(option);
  }
  updateProviderStatuses();
  renderProfile(id);
}
async function loadProfiles() {
  profileBusy = true; profileControls(); $('connection-fields').disabled = true;
  try { renderCatalog(await invoke('connection_profiles')); }
  catch(e) { catalog = undefined; selectedProfile = null; profileDirty = false; $('profile-select').replaceChildren(); $('key').value = ''; $('message').textContent = `无法读取连接配置：${e}。原文件未改变，可在下方预览配置备份。`; }
  finally { profileBusy = false; profileControls(); }
}
$('profile-select').onchange = () => {
  if (profileDirty) { $('profile-select').value = selectedProfile ?? ''; $('message').textContent = '当前有未保存内容。请先保存，或点击重新载入放弃修改。'; return; }
  renderProfile($('profile-select').value);
};
$('new-profile').onclick = () => openProviderEditor('custom');
$('reload-profiles').onclick = async()=>{await loadProfiles();$('settings').hidden=true;};
$('proxy-mode').onchange = proxyFields;
$('settings').addEventListener('input', markProfileDirty);
$('settings').addEventListener('invalid',()=>{$('provider-custom-settings').open=true;},true);
$('settings').addEventListener('change', markProfileDirty);
$('models').addEventListener('click', event => { if (event.target.closest('button')) markProfileDirty(); });
$('activate-profile').onclick = async () => {
  profileBusy = true; profileControls(); $('connection-fields').disabled = true;
    $('message').textContent = '正在检查并应用连接，核心服务就绪后生效…';
  try {
      const mode=await invoke('connection_apply_mode',{id:selectedProfile,revision:catalog.revision});
      const ticket=mode==='next-request'?null:await window.confirmEngineChange('应用所选连接（代理或企业 CA 变化需要重载）');
    await invoke('activate_connection_profile', {id:selectedProfile,revision:catalog.revision,ticket});
    renderCatalog(await invoke('connection_profiles'), selectedProfile);
    await refresh();
      $('message').textContent = mode==='next-request'?'提供方已更新，下一次模型请求生效；正在执行的请求保持原配置。':'连接已就绪，工作区与会话已保留。';
    } catch(e) { $('message').textContent = String(e); }
  finally { profileBusy = false; $('connection-fields').disabled = false; profileControls(); }
};
loadProfiles();
$('settings').addEventListener('submit',async event=>{
  event.preventDefault();
  const rows = [...$('models').children];
  const models = rows.map(row => row.querySelector('.model-id').value.trim());
  if (models.some(id => !id) || new Set(models).size !== models.length) {
    $('message').textContent = '请填写不重复且非空的模型 ID。'; return;
  }
  const selected = rows.findIndex(row => row.querySelector('input[type=radio]').checked);
  if (selected < 0) { $('message').textContent = '请选择默认模型。'; return; }
  const keyModels = rows.filter(row => row.querySelector('.cache-key-model').checked).map(row => row.querySelector('.model-id').value.trim());
  if ($('cache-key-mode').value === 'session' && !keyModels.length) { $('message').textContent = '请至少勾选一个已确认支持缓存键的模型。'; return; }
  $('connection-fields').disabled = true;
  profileBusy = true; profileControls();
  $('message').textContent = '正在保存连接…';
  try {
    const modelLimits = Object.fromEntries(rows.map((row, i) => [models[i], {
      contextWindow: Number(row.querySelector('.context-window').value),
      maxTokens: Number(row.querySelector('.max-tokens').value)
    }]));
    const modelCapabilities=Object.fromEntries(rows.map((row,i)=>[models[i],row.capability]));
    const updated = await invoke('save_connection_profile',{id:selectedProfile,revision:catalog.revision,connection:{builtinProvider,providerName:$('provider').value.trim(),baseUrl:$('url').value.trim(),api:$('api').value,models,model:models[selected],modelLimits,modelCapabilities,timeoutMs:Number($('request-timeout').value)*1000,streamIdleTimeoutMs:Number($('idle-timeout').value)*1000,cache:{retention:$('cache-retention').value,anthropicMarkers:$('cache-markers').checked,keyMode:$('cache-key-mode').value,keyModels}},network:{proxyMode:$('proxy-mode').value,proxyUrl:$('proxy-mode').value==='explicit'?$('proxy-url').value.trim():'',noProxy:$('proxy-mode').value==='explicit'?$('no-proxy').value.trim():'',caFile:$('ca-file').value.trim()},apiKey:$('key').value});
    renderCatalog(updated,selectedProfile ?? updated.profiles.find(p=>!catalog.profiles.some(old=>old.id===p.id)).id);
    $('key').value=''; $('settings').hidden=true;await refresh();$('message').textContent='连接已保存。点击提供方旁的“应用”生效。';
  } catch(e){$('message').textContent=String(e);} finally{profileBusy=false;$('connection-fields').disabled=false;profileControls();}
});
for(const [id,cmd] of [['logs','open_logs'],['quit','quit_app']]) $(id).onclick=()=>invoke(cmd).catch(e=>{$('message').textContent=String(e);});
async function requestRestart(repairWorkspaces=false){if(profileBusy)return;profileBusy=true;try{const ticket=await window.confirmEngineChange(repairWorkspaces===true?'修复重复工作区并重启':'重启引擎');await invoke('restart_engine',{ticket,repairWorkspaces:repairWorkspaces===true});}catch(e){$('message').textContent=String(e);}finally{profileBusy=false;}}
$('restart').onclick=()=>requestRestart();$('repair-workspaces').onclick=()=>requestRestart(true);window.addEventListener('desktop-restart-request',()=>requestRestart());
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report);$('message').textContent='Diagnostics copied';}catch{$('message').textContent='请选中诊断信息复制';}};
refresh();setInterval(refresh,1000);
$('session-diagnostics').onclick=()=>invoke('open_session_diagnostics').catch(e=>{$('message').textContent=String(e);});
const resetKey=document.createElement('button');resetKey.textContent='重置诊断指纹（下次重启生效）';resetKey.className='secondary';
resetKey.onclick=async()=>{try{await invoke('reset_diagnostic_key');$('message').textContent='诊断密钥已重置。重启引擎后指纹与旧导出不可直接比较，已启用的会话缓存键也会变化。';}catch(e){$('message').textContent=String(e);}};
$('session-diagnostics').after(resetKey);

$('delete-profile').onclick=()=>{
  const selected=catalog.profiles.find(p=>p.id===selectedProfile);
  if(!selected || profileBusy || profileDirty)return;
  if(selectedProfile===latestDiagnostics?.activeProfileId){$('message').textContent='请先应用另一个连接，再删除当前运行连接。';return;}
  const active=selectedProfile===catalog.activeId,others=catalog.profiles.filter(p=>p.id!==selectedProfile);
  $('delete-profile-summary').textContent=`删除“${selected.connection.providerName}”？工作区、会话和历史记录保留。`+(active?' 当前连接将停止，请先结束运行中的任务。':'');
  $('delete-replacement-label').hidden=!active || !others.length;
  $('delete-replacement').replaceChildren(...others.map(p=>new Option(p.connection.providerName,p.id)));
  $('delete-profile-dialog').showModal();
};
$('delete-profile-cancel').onclick=()=>$('delete-profile-dialog').close();
$('delete-profile-confirm').onclick=async()=>{
  if(profileBusy || profileDirty || !selectedProfile)return;
  const id=selectedProfile,replacementId=id===catalog.activeId?$('delete-replacement').value || null:null;
  $('delete-profile-dialog').close();profileBusy=true;profileControls();$('connection-fields').disabled=true;
  try {renderCatalog(await invoke('delete_connection_profile',{id,replacementId,revision:catalog.revision}));await refresh();$('message').textContent='连接已删除，工作区与会话已保留。';}
  catch(error){$('message').textContent=String(error);}
  finally{profileBusy=false;$('connection-fields').disabled=false;profileControls();}
};

