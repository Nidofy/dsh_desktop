'use strict';
(() => {
  let preview, busy = false;
  const selected = new Set();
  function controls() {
    const blocked = busy || profileBusy;
    $('credential-scan').disabled = blocked;
    $('credential-confirm').disabled = blocked || profileDirty || !selected.size;
    if (profileDirty) $('credential-confirm').checked = false;
    $('credential-clean').disabled = blocked || profileDirty || !selected.size || !$('credential-confirm').checked;
    for (const input of $('credential-rows').querySelectorAll('input')) input.disabled = blocked;
    $('credential-summary').textContent = `已选择 ${selected.size} 项；每次最多 128 项。${profileDirty ? '请先保存或放弃未保存的连接修改。' : ''}`;
  }
  function invalidate() {
    preview = undefined; selected.clear(); $('credential-rows').replaceChildren(); $('credential-confirm').checked = false;
  }
  $('credential-scan').onclick = async () => {
    if (busy || profileBusy) return;
    invalidate(); $('credential-receipts').replaceChildren(); busy = true; controls();
    $('credential-status').textContent = '正在检查本机配置引用和凭据元数据…';
    try {
      preview = await invoke('credential_cleanup', {selection:null});
      $('credential-status').textContent = `共 ${preview.total} 项连接凭据；引用保护 ${preview.referenced} 项，近期写入保护 ${preview.recent} 项，可清理 ${preview.rows.length} 项。${preview.rows.length > 128 ? '显示前 128 项，清理后可重新扫描。' : ''}`;
      for (const row of preview.rows.slice(0,128)) {
        const label = document.createElement('label'); label.className = 'snapshot-row';
        const input = document.createElement('input'); input.type = 'checkbox';
        const text = document.createElement('span'); text.textContent = `${row.id}\n写入时间：${new Date(row.writtenAt).toLocaleString()}`;
        input.onchange = () => {if(input.checked) selected.add(row.id); else selected.delete(row.id); $('credential-confirm').checked = false; controls();};
        label.append(input,text); $('credential-rows').append(label);
      }
    } catch(error) {invalidate(); $('credential-status').textContent = `无法扫描：${error}`;}
    finally {busy = false; controls();}
  };
  $('credential-confirm').onchange = controls;
  document.addEventListener('profile-controls-updated', controls);
  $('credential-clean').onclick = async () => {
    if (busy || profileBusy || profileDirty || !preview || !selected.size || !$('credential-confirm').checked) return;
    const selection = {token:preview.token,ids:[...selected]};
    busy = true; profileBusy = true; profileControls(); $('connection-fields').disabled = true; controls();
    $('credential-receipts').replaceChildren();
    try {
      const receipts = await invoke('credential_cleanup', {selection});
      const statuses = {DELETED:'已删除',ALREADY_MISSING:'已不存在',CHANGED:'凭据已变化，保留',REFUSED:'未删除'};
      for (const row of receipts) {const p = document.createElement('p'); p.textContent = `${statuses[row.status] || '结果未知'} · ${row.id}`; $('credential-receipts').append(p);}
      $('credential-status').textContent = '清理结束。可重新扫描检查剩余凭据；未完成的项目不会自动重试。';
    } catch(error) {$('credential-status').textContent = `清理未确认完成：${error}。请重新扫描，不自动重试。`;}
    finally {invalidate(); busy = false; profileBusy = false; $('connection-fields').disabled = !catalog; profileControls(); controls();}
  };
  controls();
})();
