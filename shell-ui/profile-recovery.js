'use strict';
// Shares the settings form's busy/dirty guard; only native recovery writes files.
(() => {
  let state, pending = false;
  const candidate = () => state?.candidates.find(row => row.source === $('recovery-source').value);
  function controls() {
    const blocked = pending || profileBusy;
    $('recovery-load').disabled = blocked;
    $('recovery-source').disabled = blocked || !state;
    $('recovery-confirm').disabled = blocked || profileDirty || !candidate()?.available;
    $('recovery-restore').disabled = blocked || profileDirty || !candidate()?.available || !$('recovery-confirm').checked;
    $('recovery-unsaved').hidden = !profileDirty;
    if (profileDirty) $('recovery-confirm').checked = false;
  }
  function show() {
    $('recovery-confirm').checked = false;
    const container = $('recovery-preview'); container.replaceChildren();
    const row = candidate();
    const note = text => { const p = document.createElement('p'); p.textContent = text; container.append(p); };
    if (row) {
      if (!row.available) note(row.error || '此备份不可用');
      else {
        for (const profile of row.profiles) {
          const card = document.createElement('div'); card.className = 'model-row recovery-row';
          const name = document.createElement('strong'); name.textContent = profile.name + (profile.active ? ' · 下次启动所选连接' : '');
          const endpoint = document.createElement('p'); endpoint.textContent = `${profile.endpoint} · ${profile.api} · ${profile.models} 个模型`;
          const readiness = document.createElement('p'); readiness.textContent = `${profile.credentialAvailable ? '凭据可读取' : '凭据缺失或不可读取，恢复后需重新填写'}；${profile.networkReady ? '网络配置路径检查通过（未测试连通性）' : '网络配置或 CA 路径需修复'}`;
          card.append(name, endpoint, readiness); container.append(card);
        }
        if (row.removedProfiles.length) note(`回退后暂不显示的连接：${row.removedProfiles.join('、')}。其历史目录保留，可通过「上一次回退前的配置」恢复列表。`);
      }
    }
    controls();
  }
  async function preview(success = '') {
    pending = true; controls();
    try {
      const previous = $('recovery-source').value;
      state = await invoke('connection_recovery', {source:null, token:null});
      $('recovery-source').replaceChildren();
      for (const row of state.candidates) {
        const option = document.createElement('option'); option.value = row.source; option.textContent = row.label + (row.available ? '' : ' · 不可用'); $('recovery-source').append(option);
      }
      $('recovery-source').value = state.candidates.find(row => row.source === previous && row.available)?.source ?? state.candidates.find(row => row.available)?.source ?? state.candidates[0]?.source ?? '';
      $('recovery-status').textContent = success || (state.currentStatus === 'INVALID' ? '当前配置无法读取。请选择可用备份；损坏的当前文件会原样保留。' : '请选择备份并检查内容。凭据和 CA 的可用性以本机检查为准。');
      show();
    } catch (error) { state = undefined; $('recovery-source').replaceChildren(); $('recovery-preview').replaceChildren(); $('recovery-confirm').checked = false; $('recovery-status').textContent = `${success ? success + '；' : ''}无法预览备份：${error}`; }
    finally { pending = false; controls(); }
  }
  $('recovery-load').onclick = () => preview();
  $('recovery-source').onchange = show;
  $('recovery-confirm').onchange = controls;
  document.addEventListener('profile-controls-updated', controls);
  $('recovery-restore').onclick = async () => {
    const row = candidate();
    if (pending || profileBusy || profileDirty || !row?.available || !$('recovery-confirm').checked) return;
    pending = true; profileBusy = true; profileControls(); $('connection-fields').disabled = true;
    $('recovery-status').textContent = '正在保留当前配置并恢复所选备份…';
    let success = '';
    try {
      renderCatalog(await invoke('connection_recovery', {source:row.source, token:row.token}));
      success = '已恢复配置，当前引擎不变。任务结束后点击「切换到此连接并重启」应用。';
      $('message').textContent = success;
    } catch (error) {
      // Drop the token after any failure; never replay an uncertain write.
      state = undefined; $('recovery-source').replaceChildren(); $('recovery-preview').replaceChildren();
      $('recovery-status').textContent = `恢复未确认完成：${error}。请重新载入连接并预览备份后再操作。`;
    } finally {
      $('recovery-confirm').checked = false; pending = false; profileBusy = false;
      $('connection-fields').disabled = !catalog; profileControls();
    }
    if (success) await preview(success);
  };
  controls();
})();
