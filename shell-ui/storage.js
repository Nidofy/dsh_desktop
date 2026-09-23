'use strict';
(() => {
  let inventory, scannedProfile, busy = false, selected = new Map(), visible = [];
  const key = row => row.category + '/' + row.id;
  const size = n => `${(n / 1024 / 1024).toFixed(2)} MiB`;
  let globalBusy=false,globalQuota;
  const quotaControls=()=>{
    $('storage-global').disabled=globalBusy;
    $('storage-quota-limit').disabled=globalBusy||!globalQuota;
    $('storage-quota-save').disabled=globalBusy||!globalQuota||!$('storage-quota-limit').checkValidity();
  };
  function renderGlobal(value){
    globalQuota=value;$('storage-global-rows').replaceChildren();$('storage-quota-limit').value=value.limitBytes/1024/1024;
    $('storage-global-status').textContent=`已统计 ${size(value.bytes)} · ${value.files} 个文件；桌面记录总配额 ${size(value.limitBytes)}，正在预留 ${size(value.reservedBytes)}。${value.complete?'可用额度 '+size(value.availableBytes)+'。':'统计不完整，无法判断剩余额度；暂不接受新的存储预留。'}已接入诊断、探针、自检、比较基线、项目操作、导出暂存及文件快照。`;
    for(const row of value.profiles){const p=document.createElement('p');p.textContent=`${row.id==='legacy'?'工作区共享记录':row.id} · ${size(row.bytes)} · ${row.files} 个文件${row.complete?'':' · 统计不完整'}\n${row.home}`;p.style.overflowWrap='anywhere';$('storage-global-rows').append(p);}
    for(const warning of value.warnings){const p=document.createElement('p');p.textContent=warning;$('storage-global-rows').append(p);}
  }
  $('storage-global').onclick=async()=>{
    if(globalBusy)return;globalBusy=true;globalQuota=undefined;quotaControls();$('storage-global-rows').replaceChildren();$('storage-global-status').textContent='正在检查全部本机连接的受管目录…';
    try{
      renderGlobal(await invoke('global_storage_stats'));
    }catch(error){$('storage-global-status').textContent=`无法完成全局扫描：${error}`;}
    finally{globalBusy=false;quotaControls();}
  };
  $('storage-quota-limit').oninput=quotaControls;
  $('storage-quota-save').onclick=async()=>{
    if(globalBusy||!globalQuota||!$('storage-quota-limit').checkValidity())return;
    const expectedRevision=globalQuota.quotaRevision,limitBytes=Number($('storage-quota-limit').value)*1024*1024;
    globalBusy=true;quotaControls();$('storage-quota-status').textContent='正在保存总配额…';
    try{renderGlobal(await invoke('set_storage_quota',{expectedRevision,limitBytes}));$('storage-quota-status').textContent='总配额已保存并即时生效。已有记录与任务预留保留，不需要重启引擎。';}
    catch(error){globalQuota=undefined;$('storage-quota-status').textContent=`未确认保存：${error}。请重新扫描后检查，不会自动重试。`;}
    finally{globalBusy=false;quotaControls();}
  };
  function controls() {
    const blocked = busy || profileBusy;
    for (const id of ['storage-load','storage-days','storage-backups']) $(id).disabled = blocked;
    $('storage-profile').disabled = blocked || !$('storage-profile').options.length;
    $('storage-scan').disabled = blocked || !$('storage-profile').value;
    $('storage-category').disabled = blocked || !inventory;
    $('storage-select').disabled = $('storage-clear').disabled = blocked || !inventory;
    $('storage-confirm').disabled = blocked || !selected.size;
    $('storage-clean').disabled = blocked || !selected.size || !$('storage-confirm').checked;
    for (const input of $('storage-rows').querySelectorAll('input')) input.disabled = blocked || (input.dataset.backup === 'true' && !$('storage-backups').checked);
    $('storage-summary').textContent = `已选择 ${selected.size} 份 · ${size([...selected.values()].reduce((n,row)=>n+row.bytes,0))}；每次最多 200 份。`;
  }
  function invalidate() { inventory = undefined; selected.clear(); $('storage-rows').replaceChildren(); $('storage-confirm').checked = false; controls(); }
  function render() {
    selected.clear(); $('storage-confirm').checked = false; $('storage-rows').replaceChildren();
    const rows = inventory?.rows.filter(row => !$('storage-category').value || row.category === $('storage-category').value) ?? [];
    visible = rows.slice(0,200);
    const message = document.createElement('p'); message.textContent = `此类别共 ${rows.length} 份符合保留时间的记录，显示最早 ${visible.length} 份。清理后重新扫描可查看剩余记录。`; $('storage-rows').append(message);
    for (const row of visible) {
      const label = document.createElement('label'); label.className = 'snapshot-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.backup = String(row.category === 'snapshots');
      input.onchange = () => { if (input.checked) selected.set(key(row),row); else selected.delete(key(row)); $('storage-confirm').checked = false; controls(); };
      const text = document.createElement('span'); text.textContent = `${row.label} · ${size(row.bytes)} · ${row.files} 个文件 · ${new Date(row.modifiedAt).toLocaleString()}\n${row.id}`;
      label.append(input,text); $('storage-rows').append(label);
    }
    controls();
  }
  async function scan(preserveReceipts = false) {
    if (busy || profileBusy || !$('storage-profile').value) return;
    invalidate(); if (!preserveReceipts) $('storage-receipts').replaceChildren(); busy = true; controls();
    const profileId = $('storage-profile').value;
    $('storage-status').textContent = '正在扫描本机受管记录…';
    try {
      inventory = await invoke('desktop_storage',{profileId,days:Number($('storage-days').value),selection:null}); scannedProfile = profileId;
      $('storage-category').replaceChildren(new Option('全部类别',''));
      for (const [value,label] of new Map(inventory.rows.map(row => [row.category,row.label]))) $('storage-category').append(new Option(label,value));
      $('storage-status').textContent = `已识别受管记录 ${size(inventory.managedBytes)}（含保留期内记录，不含原生会话等其他数据）。位置：${inventory.home}${inventory.warnings.length ? '\n部分项目未能检查，统计不完整：\n'+inventory.warnings.join('\n') : ''}`;
      render();
    } catch (error) { $('storage-status').textContent = `扫描失败：${error}`; }
    finally { busy = false; controls(); }
  }
  $('storage-load').onclick = async () => {
    if (busy || profileBusy) return; invalidate(); busy = true; controls();
    try {
      const list = await invoke('connection_profiles'); $('storage-profile').replaceChildren(new Option('工作区共享记录','shared'));
      for (const p of list.profiles.filter(p=>p.id!=='legacy')) $('storage-profile').append(new Option(p.connection.providerName+' · 旧版记录',p.id));
      $('storage-profile').value = 'shared'; $('storage-status').textContent = '选择连接和保留时间后扫描。清理可作用于未启用连接，但仍会重启当前引擎。';
    } catch(error) { $('storage-profile').replaceChildren(); $('storage-status').textContent = `无法载入连接：${error}`; }
    finally { busy = false; controls(); }
  };
  $('storage-profile').onchange = $('storage-days').onchange = invalidate;
  $('storage-category').onchange = render;
  $('storage-scan').onclick = () => scan();
  $('storage-clear').onclick = render;
  $('storage-select').onclick = () => {
    const inputs = [...$('storage-rows').querySelectorAll('input')];
    for (const [i,row] of visible.entries()) if (row.category !== 'snapshots') { selected.set(key(row),row); inputs[i].checked = true; }
    $('storage-confirm').checked = false; controls();
  };
  $('storage-backups').onchange = render;
  $('storage-confirm').onchange = controls;
  document.addEventListener('profile-controls-updated', controls);
  $('storage-clean').onclick = async () => {
    if (busy || profileBusy || !selected.size || !$('storage-confirm').checked || scannedProfile !== $('storage-profile').value) return;
    if ([...selected.values()].some(row=>row.category==='snapshots') && !$('storage-backups').checked) return;
    const selection = [...selected.values()].map(({category,id,token})=>({category,id,token}));
    busy = true; profileBusy = true; profileControls(); $('connection-fields').disabled = true; controls();
    $('storage-status').textContent = '正在停止引擎并清理所选记录。完成后重新启动，不自动重发任务。'; $('storage-receipts').replaceChildren();
    try {
      const ticket=await window.confirmEngineChange('停止引擎并清理所选记录');
      const receipts = await invoke('desktop_storage',{profileId:scannedProfile,days:Number($('storage-days').value),selection,ticket});
      for (const row of receipts) { const p = document.createElement('p'); p.textContent = `${row.status === 'DELETED' ? '已清理' : row.status === 'PARTIAL' ? '部分完成' : '未清理'} · ${row.id} · ${row.deletedFiles} 个文件 / ${size(row.freedBytes)} · ${row.message}`; $('storage-receipts').append(p); }
      const p = document.createElement('p'); p.textContent = '清理结束，引擎正在重新启动。请查看顶部引擎状态；失败或部分完成的记录不会自动重试。'; $('storage-receipts').prepend(p);
    } catch(error) { $('storage-receipts').textContent = `清理结果未确认：${error}。重新扫描并检查引擎状态，不自动重试。`; }
    finally { busy = false; profileBusy = false; $('connection-fields').disabled = !catalog; invalidate(); profileControls(); }
    await scan(true);
  };
  controls();
})();
