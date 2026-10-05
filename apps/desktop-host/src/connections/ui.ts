/** Localized editor served only through authenticated Desktop connection routes.
 * @param chinese - Whether the shell selected simplified Chinese.
 * @returns Complete local HTML document; no credentials are rendered into it.
 */
export function connectionsHtml(chinese: boolean): string {
  const t = chinese ? {
    title: '连接与数据迁移', intro: '保存后新请求采用新配置；正在进行的请求和重试保留原连接。',
    connection: '连接标识', name: '显示名称', protocol: 'API 协议', base: 'Base URL', models: '模型 ID（每行一个；留空继承目录）',
    catalog: '继承内置目录（可选，例如 deepseek）', key: 'API Key（留空保留已存凭据；缺 Key 连接必须输入）', save: '保存并应用', refresh: '重新读取',
    revoke: '撤销此连接', list: '已配置连接', applied: '配置已生效', source: '旧版数据根目录', version: '旧桌面版本',
    import: '导入到独立副本', hint: '请先退出旧桌面。导入不修改原目录，不复制凭据或启动计划。',
    ready: '副本已准备。连接需要重新绑定 Key。数据根目录：', failed: '操作未确认，请重新读取状态。',
    status: '状态', empty: '尚无托管连接。', details: '应用回执与导入结果',
    avail: { available: '凭据可用', 'missing-credential': '缺 Key，需重新绑定', 'backend-unavailable': '凭据后端不可用', revoked: '已撤销', unknown: '状态未知' },
    mode: { 'cleanup-pending': '有待清理的凭据引用', 'invalid-state': '配置文件不可读，已禁止覆盖保存', 'recovery-pending': '凭据清理未完成，已暂缓新保存，请重新读取' },
    protection: '任务文件保护', workspace: '工作区绝对路径', paths: '保护的相对文件路径（每行一个）',
    arm: '启用保护', disarm: '停用所选范围', scopes: '读取保护范围', snapshots: '查看快照记录', scope: '范围 ID（停用时填写）',
  } : {
    title: 'Connections and migration', intro: 'New requests use saved changes; active requests and retries keep their original connection.',
    connection: 'Connection ID', name: 'Display name', protocol: 'API protocol', base: 'Base URL', models: 'Model IDs (one per line; blank inherits catalog)',
    catalog: 'Catalog source (optional, e.g. deepseek)', key: 'API key (blank keeps the stored credential; required when a key is missing)', save: 'Save and apply', refresh: 'Reload',
    revoke: 'Revoke connection', list: 'Configured connections', applied: 'Configuration applied', source: 'Legacy data root', version: 'Legacy Desktop version',
    import: 'Import into a separate copy', hint: 'Quit the old Desktop first. Import preserves the source and does not copy credentials or activate schedules.',
    ready: 'Copy ready. Bind connection keys again. Data root:', failed: 'Operation unconfirmed. Reload to reconcile.',
    status: 'Status', empty: 'No managed connections.', details: 'Application receipt and import result',
    avail: { available: 'credential stored', 'missing-credential': 'key missing; bind again', 'backend-unavailable': 'credential backend unavailable', revoked: 'revoked', unknown: 'availability unknown' },
    mode: { 'cleanup-pending': 'credential cleanup pending', 'invalid-state': 'configuration unreadable; overwriting saves are blocked', 'recovery-pending': 'credential cleanup unfinished; new saves are paused, reload to reconcile' },
    protection: 'Task file protection', workspace: 'Absolute workspace path', paths: 'Relative files to protect (one per line)',
    arm: 'Enable protection', disarm: 'Disable selected scope', scopes: 'Read scopes', snapshots: 'List snapshots', scope: 'Scope ID (for disabling)',
  }
  return `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><meta charset="utf-8"><title>${t.title}</title>
<style>body{font:15px system-ui;background:#f5f7fb;color:#1b263b;margin:0}main{max-width:820px;margin:36px auto;padding:0 24px}section{background:white;border:1px solid #dde3ee;border-radius:14px;padding:24px;margin:18px 0}label{display:block;margin:14px 0 5px;font-weight:600}input,textarea,select{box-sizing:border-box;width:100%;padding:10px;border:1px solid #bcc7d8;border-radius:7px;font:inherit}button{cursor:pointer;padding:10px 15px;border:1px solid #c0cada;border-radius:7px;background:#fff;margin:12px 8px 0 0}#save{background:#285bd5;color:white}button:disabled{opacity:.5}p{line-height:1.6;color:#526078}#status{white-space:pre-wrap;padding:12px;background:#edf3ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}</style>
<main><h1>${t.title}</h1><p>${t.intro}</p><section><h2>${t.list}</h2><div id="list"></div>
${[['connection', t.connection], ['name', t.name], ['base', t.base], ['catalog', t.catalog]].map(([id, label]) => `<label for="${id}">${label}</label><input id="${id}">`).join('')}
<label for="protocol">${t.protocol}</label><select id="protocol"><option>openai-completions</option><option>anthropic-messages</option></select><label for="models">${t.models}</label><textarea id="models" rows="3"></textarea><label for="key">${t.key}</label><input id="key" type="password" autocomplete="off"><button id="save">${t.save}</button><button id="refresh">${t.refresh}</button><button id="revoke">${t.revoke}</button></section>
<section><h2>${t.import}</h2><p>${t.hint}</p><label for="source">${t.source}</label><input id="source"><label for="version">${t.version}</label><select id="version"><option>0.2.5-rc.1</option><option>0.2.0</option></select><button id="import">${t.import}</button></section><h3>${t.status}</h3><div id="status" role="status"></div><details><summary>${t.details}</summary><pre id="receipt"></pre></details></main>
<section style="max-width:772px;margin:18px auto"><h2>${t.protection}</h2><label for="workspace">${t.workspace}</label><input id="workspace"><label for="paths">${t.paths}</label><textarea id="paths"></textarea><label for="scope">${t.scope}</label><input id="scope"><button id="scopes">${t.scopes}</button><button id="arm">${t.arm}</button><button id="disarm">${t.disarm}</button><button id="snapshots">${t.snapshots}</button></section>
<script>const t=${JSON.stringify(t)};const el=id=>document.getElementById(id);let state,operation,importOperation,importSource,scopeState;
async function call(method,args){const r=await fetch('/api/nidofy/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const result=await r.json();if(!r.ok)throw Error(result.error);return result}
function show(value,message){el('receipt').textContent=JSON.stringify(value,null,2);el('status').textContent=message}
async function refresh(){state=await call('status',{operationId:operation});el('list').replaceChildren();if(!state.connections.length)el('list').textContent=t.empty;for(const row of [...state.connections,...(state.importedConnections||[]).filter(row=>!state.connections.some(saved=>saved.connection===row.connection))]){const b=document.createElement('button');b.textContent=(row.profile.displayName||row.connection)+(row.availability?' · '+(t.avail[row.availability]??row.availability):'');b.onclick=()=>{el('connection').value=row.connection;el('name').value=row.profile.displayName||'';el('protocol').value=row.profile.api||'openai-completions';el('base').value=row.profile.baseURL||'';el('catalog').value=row.profile.catalogProvider||'';el('models').value=(row.profile.models||[]).map(m=>m.id).join('\\n');el('key').value=''};el('list').append(b)}const banner=state.recovery==='ready'?'':((t.mode[state.cleanupRecord==='journal'?'recovery-pending':state.recovery]||'')+(state.recoveryDiagnostic?'('+state.recoveryDiagnostic+')':'')+' — ');show(state,banner+(state.desiredRevision===state.appliedRevision?t.applied:t.failed))}
async function run(fn){for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn()}catch(e){show({error:String(e),operationId:operation},t.failed+' '+String(e))}finally{for(const b of document.querySelectorAll('button'))b.disabled=false}}
el('refresh').onclick=()=>run(refresh);el('save').onclick=()=>run(async()=>{operation=crypto.randomUUID();const prior=[...state.connections,...(state.importedConnections||[])].find(row=>row.connection===el('connection').value)?.profile||{};const profile={...prior,displayName:el('name').value||el('connection').value,api:el('protocol').value,baseURL:el('base').value};const ids=el('models').value.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);profile.models=ids.map(id=>prior.models?.find(model=>model.id===id)||({id}));if(el('catalog').value)profile.catalogProvider=el('catalog').value;else delete profile.catalogProvider;const key=el('key').value;try{await call('mutate',{action:'save',operationId:operation,expectedRevision:state.desiredRevision,connection:el('connection').value,profile,credential:key?{mode:'replace',value:key}:{mode:'keep'}})}finally{el('key').value=''}await refresh()});
el('revoke').onclick=()=>run(async()=>{operation=crypto.randomUUID();await call('mutate',{action:'revoke',operationId:operation,expectedRevision:state.desiredRevision,connection:el('connection').value});await refresh()});
el('import').onclick=()=>run(async()=>{const source=el('source').value+'|'+el('version').value;if(source!==importSource){importSource=source;importOperation=crypto.randomUUID()}const value=await call('import',{source:el('source').value,sourceVersion:el('version').value,operationId:importOperation});show(value,t.ready+'\\n'+value.dataRoot)});
async function scopes(){scopeState=await call('protection',{action:'scopes'});show(scopeState,t.protection)}
el('scopes').onclick=()=>run(scopes);el('snapshots').onclick=()=>run(async()=>show(await call('protection',{action:'list'}),t.snapshots));
el('arm').onclick=()=>run(async()=>{if(!scopeState)await scopes();await call('protection',{action:'arm',workspace:el('workspace').value,paths:el('paths').value.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean),revision:scopeState.revision});await scopes()});
el('disarm').onclick=()=>run(async()=>{if(!scopeState)await scopes();await call('protection',{action:'disarm',id:el('scope').value,revision:scopeState.revision});await scopes()});run(refresh);</script></html>`
}
