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
invoke('connection').then(c => { $('provider').value=c.providerName; $('url').value=c.baseUrl; $('model').value=c.model; }).catch(e=>{$('message').textContent=String(e);});
$('settings').addEventListener('submit',async event=>{
  event.preventDefault(); const button=event.submitter; button.disabled=true;
  try {
    await invoke('save_connection',{connection:{providerName:$('provider').value.trim(),baseUrl:$('url').value.trim(),model:$('model').value.trim()},apiKey:$('key').value});
    $('key').value=''; $('message').textContent='已保存，正在重启引擎。';
  } catch(e){$('message').textContent=String(e);} finally{button.disabled=false;}
});
for(const [id,cmd] of [['logs','open_logs'],['restart','restart_engine'],['quit','quit_app']]) $(id).onclick=()=>invoke(cmd).catch(e=>{$('message').textContent=String(e);});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report);$('message').textContent='Diagnostics copied';}catch{$('message').textContent='请选中诊断信息复制';}};
refresh();setInterval(refresh,1000);
