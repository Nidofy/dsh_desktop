'use strict';
(() => {
  const groups = [
    ['connections', '连接与模型', ['connection-section']],
    ['snapshots', '文件快照', ['task-snapshots', 'snap-records-section']],
    ['storage', '存储管理', ['desktop-storage']],
    ['maintenance', '备份与凭据', ['profile-recovery', 'credential-cleanup']],
    ['diagnostics', '运行状态', ['runtime-status-section']],
  ];
  const nav = document.getElementById('settings-tabs');
  const content = document.getElementById('settings-panels');
  const buttons = [], panels = [];
  const select = (id, focus = false) => {
    if (!groups.some(group => group[0] === id)) id = 'connections';
    for (let i = 0; i < groups.length; i++) {
      const active = groups[i][0] === id;
      buttons[i].setAttribute('aria-selected', String(active));
      buttons[i].tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
      if (active && focus) buttons[i].focus();
    }
    history.replaceState(null, '', '#' + id);
  };
  for (const [id, title, sections] of groups) {
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'tab-' + id; button.textContent = title;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'panel-' + id);
    button.onclick = () => select(id);
    const panel = document.createElement('div'); panel.id = 'panel-' + id;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    for (const section of sections) panel.append(document.getElementById(section));
    nav.append(button); content.append(panel); buttons.push(button); panels.push(panel);
  }
  nav.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % groups.length;
    if (event.key === 'ArrowLeft') next = (index + groups.length - 1) % groups.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = groups.length - 1;
    if (next !== undefined) { event.preventDefault(); select(groups[next][0], true); }
  });
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));
  document.addEventListener('desktop-show-settings', event => select(event.detail));
  document.addEventListener('desktop-navigate', event => {
    select(event.detail.tab);
    if(event.detail.tab==='snapshots' && typeof event.detail.workspace==='string') { document.getElementById('snap-workspace').value=event.detail.workspace; }
  });
  select(location.hash.slice(1));
})();
