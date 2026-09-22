'use strict';
(() => {
  const $ = id => document.getElementById('snap-' + id);
  const invoke = window.__TAURI__.core.invoke;
  let profileId = null, items = [], preview = null, busy = false;
  let scopes = {revision:0,items:[]};
  let browsing = null;
  let navigation = null, seenNavigation = null;
  const selectedScope = () => scopes.items.find(item=>item.id===$('scope-select').value);
  const labels = {READY:'可恢复',UNCHANGED:'内容未变化',CONFLICT:'冲突 · 保持当前',UNAVAILABLE:'无法检查',RESTORED:'已恢复',INTERRUPTED:'结果未确认 · 请人工核对',ROLLED_BACK:'写入失败 · 已恢复到操作前'};
  const selected = () => items.find(item => item.id === $('select').value);
  function controls() {
    const item = selected();
    $('load').disabled = busy || profileBusy; $('fields').disabled = busy || profileBusy || !profileId;
    $('seal').disabled = busy || !item || item.sealed || Boolean(item.task);
    $('preview').disabled = busy || !item?.sealed;
    $('details').disabled = busy || !item;
    $('navigation-load').disabled = busy || profileBusy || !navigation;
    $('restore').disabled = busy || !preview || !$('rows').querySelector('input:checked');
    $('scope-edit').disabled = busy || !selectedScope();
    $('disarm').disabled = busy || !selectedScope();
    $('export').disabled = busy || !item;
    $('parent').disabled = busy || !browsing?.directory;
    $('add-files').disabled = busy || !browsing || !$('file-list').querySelector('input:checked');
  }
  function clearPreview() { preview = null; $('rows').replaceChildren(); controls(); }
  function clearBrowser() { browsing=null; $('file-list').replaceChildren(); $('browse-info').textContent=''; controls(); }
  async function browse(directory='') {
    const workspace=$('workspace').value.trim();
    clearBrowser();
    const value=await request('browse',{workspace,directory}); browsing={...value,inputWorkspace:workspace};
    $('browse-info').textContent=`目录：${value.directory||'/'} · ${value.rows.length} 项${value.truncated?' · 列表已截断；请进入子目录或直接填写相对路径':''}。保存范围时还会检查文件类型和总大小。`;
    for(const row of value.rows) {
      if(row.kind==='directory') {const button=document.createElement('button');button.type='button';button.textContent=`文件夹：${row.name}`;button.onclick=()=>perform(()=>browse(row.path));$('file-list').append(button);}
      else {const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');check.type='checkbox';check.value=row.path;check.disabled=!row.selectable;check.onchange=controls;text.textContent=`${row.name} · ${(row.bytes/1024).toFixed(1)} KiB${row.selectable?'':' · 超过 8 MiB'}`;label.className='snapshot-row';label.append(check,text);$('file-list').append(label);}
    }
  }
  async function request(action, data = {}) { return invoke('task_snapshots', {profileId,request:{action,...data}}); }
  function renderScopes(value) {
    scopes=value; $('scope-select').replaceChildren(new Option('请选择工作区',''));
    for(const item of scopes.items) $('scope-select').append(new Option(`${item.workspace} · ${item.paths.length} 个文件`,item.id));
    $('scope-info').textContent=`当前连接已启用 ${scopes.items.length} 个工作区。停止自动快照不会删除已有备份；已确认开始的任务仍可结束封存。`;
    controls();
  }
  async function perform(work, success, failureHint = '请重新载入状态后检查，不会自动重试。') {
    if (busy || profileBusy) return; busy = true; controls(); $('message').textContent = '正在处理，请等待…';
    try { await work(); if (success) $('message').textContent = success; }
    catch (error) { clearPreview(); $('records-section').hidden=true; $('records').replaceChildren(); $('message').textContent = String(error) + '。' + failureHint; }
    finally { busy = false; controls(); }
  }
  function describe() {
    $('records-section').hidden=true; $('records').replaceChildren(); $('records-info').textContent='';
    clearPreview(); const item = selected();
    const state = !item ? '' : item.sealed ? '结束状态已固定，后续编辑会触发冲突' : item.task ? item.admission === 'CONFIRMED' ? '任务开始已确认，结束状态未确认；不会手动补采或自动重放' : '任务开始未确认；保留备份，不能恢复' : '尚未记录结束状态；在任务完成且停止写入后记录一次';
    $('info').textContent = item ? `${item.workspace} · ${item.count} 个指定文件${item.task ? ` · 会话 ${item.task.sessionId} / 轮次 ${item.task.turn}` : ''} · ${state}` : '';
    controls();
  }
  async function history(id = '') {
    const value = await request('list'); items = value.items;
    $('storage').textContent = `本机存储：${value.storagePath}${value.incomplete ? ` · ${value.incomplete} 份未完成采集保留在此目录中` : ''}。恢复前备份也保存在此；不会自动删除。`;
    $('select').replaceChildren(new Option('请选择快照', ''));
    for (const item of items) $('select').append(new Option(`${new Date(item.createdAt).toLocaleString()} · ${item.count} 个文件 · ${item.sealed ? '可预览' : item.task ? '任务边界未完整确认' : '待记录结束'}`, item.id));
    $('select').value = id; describe();
  }
  function render(value) {
    preview = value; $('rows').replaceChildren();
    for (const row of value.rows) {
      const label = document.createElement('label'), check = document.createElement('input'), text = document.createElement('span');
      check.type = 'checkbox'; check.value = row.path; check.disabled = row.status !== 'READY'; check.onchange = controls;
      text.textContent = `${row.path} · ${labels[row.status] ?? '未知状态'} — ${row.message}`;
      label.className = 'snapshot-row'; label.append(check, text); $('rows').append(label);
    }
    controls();
  }
  async function loadProfile(id='') {
    profileId = null; items = []; clearBrowser(); renderScopes({revision:0,items:[]}); $('automatic-status').textContent=''; $('archive-result').textContent=''; $('select').replaceChildren(new Option('请选择快照','')); $('storage').textContent = ''; $('info').textContent = ''; clearPreview(); const diagnostics = await invoke('diagnostics');
    if (!diagnostics.activeProfileId) throw Error('当前连接尚未就绪');
    profileId = diagnostics.activeProfileId;
    try { renderScopes(await request('scopes')); await history(id); } catch(error) { profileId=null; throw error; }
    $('automatic-status').textContent=diagnostics.snapshotStatus??'当前引擎尚无自动快照结果';
    $('message').textContent = `当前连接：${diagnostics.activeProfileName}。快照只保存在本机；已载入 ${items.length} 份。`;
  }
  $('load').onclick = () => perform(()=>loadProfile());
  document.addEventListener('desktop-diagnostics-updated',event=>{
    const d=event.detail,n=d.snapshotNavigation;
    if(n?.requestId===seenNavigation||!n?.id||!n?.requestId)return;
    seenNavigation=n.requestId; navigation={...n,profileId:d.activeProfileId};
    $('navigation-note').hidden=false;$('navigation-load').hidden=false;
    $('navigation-note').textContent='来自变更面板的任务快照：'+n.id+'。载入只查看记录，当前输入的文件范围会保留。';
    document.dispatchEvent(new CustomEvent('desktop-show-settings',{detail:'snapshots'}));
    $('navigation-note').scrollIntoView({block:'center'});controls();
  });
  document.addEventListener('profile-controls-updated',controls);
  $('navigation-load').onclick=()=>perform(async()=>{
    const target=navigation;if(!target)return;
    const d=await invoke('diagnostics');if(d.activeProfileId!==target.profileId)throw Error('连接已变化，请从当前连接的变更面板重新打开');
    await loadProfile(target.id);if(!selected())throw Error('对应快照已不可用或已移出当前快照库');
    await showDetails(target.id);
    if(navigation?.requestId===target.requestId){navigation=null;$('navigation-load').hidden=true;$('navigation-note').textContent='已定位任务快照。请检查记录后，再明确预览和选择要恢复的文件。';}
  });
  const backupLabels={VERIFIED:'内容校验通过',UNVERIFIED:'与记录不匹配 / 无法验证',MISSING:'缺失',UNAVAILABLE:'无法读取',NOT_NEEDED:'原状态不存在，无需内容备份',NOT_CREATED:'尚无恢复前备份'};
  const recoveryLabels={NOT_ATTEMPTED:'未执行恢复',UNKNOWN:'结果未知 / 记录不完整',RESTORED:'记录为已恢复',ROLLED_BACK:'记录为写入失败后回滚',INTERRUPTED:'结果未确认'};
  async function showDetails(id) {
    $('records').replaceChildren();$('records-info').textContent='';$('records-section').hidden=true;
    const value=await request('details',{id});
    $('records-section').hidden=false;$('records-info').textContent=`快照 ${value.snapshot.id} · 存储：${value.storagePath} · ${value.endRecordedAt?'结束记录：'+new Date(value.endRecordedAt).toLocaleString():'结束状态未完整确认'}`;
    const state=s=>!s?'未知':s.kind==='absent'?'文件不存在':`${s.bytes} 字节 · SHA-256 ${s.sha256}`;
    for(const row of value.rows){
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent=`${row.path} · ${recoveryLabels[row.recovery.status]??'未知记录'}`;details.append(summary);
      const add=text=>{const p=document.createElement('p');p.textContent=text;p.style.overflowWrap='anywhere';details.append(p);};
      add('开始状态：'+state(row.before));add('结束状态：'+state(row.end));
      for(const [title,b] of [['原始备份',row.originalBackup],['恢复前备份',row.recoveryBackup]])add(`${title}：${backupLabels[b.status]??'未知'}${b.name?' · '+b.name:''}${b.sha256?' · SHA-256 '+b.sha256:''}`);
      if(row.recovery.preparedAt)add('恢复准备时间：'+new Date(row.recovery.preparedAt).toLocaleString());
      if(row.recovery.completedAt)add('结果记录时间：'+new Date(row.recovery.completedAt).toLocaleString());
      $('records').append(details);
    }
  }
  $('details').onclick=()=>perform(async()=>{if(selected())await showDetails(selected().id);},'已读取保存记录；尚未检查当前工程内容。');
  $('select').onchange = describe;
  $('scope-select').onchange = controls;
  $('scope-edit').onclick = () => { const item=selectedScope(); if(!item)return; clearBrowser(); $('workspace').value=item.workspace; $('paths').value=item.paths.join('\n'); $('workspace').closest('details').open=true; };
  $('workspace').oninput=clearBrowser;
  $('browse').onclick=()=>perform(()=>browse());
  $('parent').onclick=()=>perform(()=>browse(browsing?.directory.split('/').slice(0,-1).join('/')??''));
  $('add-files').onclick=()=>perform(async()=>{
    if(!browsing||browsing.inputWorkspace!==$('workspace').value.trim())throw Error('工作区已变化，请重新浏览');
    const paths=$('paths').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean), seen=new Set(paths.map(s=>s.toLowerCase()));
    for(const item of $('file-list').querySelectorAll('input:checked'))if(!seen.has(item.value.toLowerCase())){paths.push(item.value);seen.add(item.value.toLowerCase());}
    if(paths.length>128)throw Error('范围超过 128 个文件，请缩小选择');
    $('paths').value=paths.join('\n');for(const item of $('file-list').querySelectorAll('input:checked'))item.checked=false;
    $('workspace').closest('details').open=true;
  },'已加入文件范围；请检查后手动保存或启用自动快照。');
  function archiveReceipt(value) { $('archive-result').textContent=`校验通过：${value.files} 个文件 · ${(value.bytes/1024/1024).toFixed(2)} MiB · 原工作区：${value.workspace}。未修改工程。`; }
  $('archive-path').oninput=()=>{$('archive-result').textContent='';};
  $('export').onclick=()=>perform(async()=>{$('archive-result').textContent='';const item=selected();if(!item)return;const value=await request('export',{id:item.id,destination:$('export-parent').value.trim()});$('archive-path').value=value.directory;archiveReceipt(value);},'归档导出并校验完成；原快照保留。');
  $('verify-archive').onclick=()=>perform(async()=>{$('archive-result').textContent='';archiveReceipt(await request('verifyArchive',{directory:$('archive-path').value.trim()}));},'归档内容校验通过。');
  $('import-archive').onclick=()=>perform(async()=>{$('archive-result').textContent='';const value=await request('importArchive',{directory:$('archive-path').value.trim()});await history(value.snapshot.id);$('archive-result').textContent='已导回快照库。工程尚未修改；请检查工作区和范围后，单独预览恢复。';},'已导回快照；同编号的原有快照不会被覆盖。');
  $('arm').onclick = () => perform(async()=>{renderScopes(await request('arm',{workspace:$('workspace').value.trim(),paths:$('paths').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),revision:scopes.revision}));},'已保存自动快照范围，从下一轮任务开始生效。');
  $('disarm').onclick = () => perform(async()=>{const item=selectedScope();if(item)renderScopes(await request('disarm',{id:item.id,revision:scopes.revision}));},'此工作区已停止自动快照，已有备份保留。');
  $('capture').onclick = () => perform(async () => {
    clearPreview(); const item = await request('capture', {workspace:$('workspace').value.trim(),paths:$('paths').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)});
    await history(item.id);
  }, '开始快照已保存。任务结束后请固定结束状态，再预览恢复。');
  $('seal').onclick = () => perform(async () => {
    const id = selected()?.id; if (!id) return; await request('seal',{id}); await history(id); render(await request('preview',{id}));
  }, '结束状态已固定；请选择需要恢复的文件。');
  $('preview').onclick = () => perform(async () => { const id = selected()?.id; if (id) render(await request('preview',{id})); }, '预览已更新。恢复时仍会再次核对并锁定文件。');
  $('restore').onclick = () => perform(async () => {
    const id = selected()?.id, paths = [...$('rows').querySelectorAll('input:checked')].map(input => input.value);
    if (!id || !paths.length) return; render(await request('restore',{id,paths})); await showDetails(id);
  }, '所选恢复操作已完成；恢复前备份保存在本机快照目录。', '此前成功恢复的文件不会自动撤销；请重新载入状态。');
  controls();
})();
