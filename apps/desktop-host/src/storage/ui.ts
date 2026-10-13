import { managementUi, managementConfirm } from '@nidofy/dsh-desktop-extras/management-ui'
/** Authenticated local-user storage management; scripts call Host APIs, never the filesystem.
 * @param chinese - Whether simplified Chinese is selected.
 * @returns Localized quota/inventory page with explicit state-changing recovery.
 */
export function storageHtml(chinese: boolean): string {
  const t = chinese ? {
    title: '存储与配额', intro: '配额覆盖发行版受管数据，不是全磁盘容量。原生会话、工程、运行时和凭据排除在外。',
    refresh: '读取状态', quota: '共享发行根配额', inventory: '当前 home 与 imports 的只读观察',
    unknown: '未知', measured: '本次完整计量', observed: '账本上次计量（可能过期）', reserved: '仍保留的总预留',
    ordinary: '普通写预留', terminal: '独立终态预留', pending: '未结算操作', safety: '磁盘安全余量',
    ledger: '账本已用 / 上限', limit: '受管额度（字节）', apply: '更改额度',
    configureHint: '降低额度会拒绝新的申请，已授普通与终态空间仍保留。额度更改响应丢失时先读取状态，不自动重试。',
    recovery: '保守恢复与重扫', confirm: '我理解恢复会同步账本；未排空、扫描失败或 unknown 会继续保留预留。',
    recover: '执行恢复', recoveryHint: '恢复可能结算已确认排空的操作；它不是纯观察。不会重放任务或删除未知文件。',
    notRun: '本次尚未重扫；不把缓存长度当成完整当前计量。', incomplete: '写入者尚未排空或扫描不完整；预留仍保留。',
    complete: '已排空并完成重扫。', loading: '正在读取…', failed: '操作未确认。保留上次观察，请读取状态核对。',
    ready: '状态已读取。', configured: '额度已确认更改；预留仍按账本保留。',
    operation: '按操作标识查询', operationId: '操作 ID', inspect: '查询操作',
    unknownOperation: '操作结果 unknown：没有重放或释放授权。', reservedOperation: '操作仍占预留，请等待排空后显式恢复。',
    settledOperation: '操作已结算；这不证明任务成功或文件断电耐久。', invalid: '请输入正的安全整数字节数。',
    inventoryBytes: '本 home 观察到的字节', issues: '未知或不可读项', inventoryHint: '这项观察不授额度，与共享账本不是同一次原子扫描。',
    inventoryIncomplete: '总量不完整，不能显示为零容量。', records: '展开观察详情', back: '返回连接',
    snapshots: '快照管理', workspace: '工程绝对路径', paths: '相对文件路径（每行一个）', capture: '采集所选文件', seal: '固定结束状态',
    listSnapshots: '读取快照', choose: '请选择快照', preview: '预览逐项恢复', restore: '恢复勾选文件', restoreConfirm: '我确认只恢复勾选文件；部分失败不会自动重试。',
    archive: '快照归档', archiveHint: '导入归档只保存快照，不会恢复工程。校验后再明确导入，恢复需独立选择文件。',
    destination: '归档输出目录（工程及快照存储之外）', export: '导出所选快照', directory: '归档目录', verify: '校验归档', importArchive: '导入已校验归档',
    importConfirm: '我确认只导入已校验快照，不自动恢复工程。', sealed: '已固定', unsealed: '未固定', rows: '逐项结果',
    verified: '归档已校验；可明确导入。', previewRequired: '请先选择快照并取得当前预览。', selectionRequired: '请选择至少一个文件。',
    unconfirmedSnapshot: '快照操作未确认；保留已有文件。请按操作 ID 查询，unknown 不重放。', cleanup: '清理预览', cleanupHint: '清理执行尚未开放。未知数据、恢复备份和活动预留不会自动删除。', cleanupPreview: '读取只读清理预览', cleanupDeferred: '仅列出缓存/暂存候选。执行需未来原生复核与排空，不授予删除权限。',
  } : {
    title: 'Storage and quota', intro: 'Quota covers distribution-managed data, not the whole disk. Native sessions, projects, runtimes and credentials are excluded.',
    refresh: 'Read status', quota: 'Shared distribution quota', inventory: 'Read-only observation of this home and imports',
    unknown: 'Unknown', measured: 'Complete measurement this time', observed: 'Last ledger measurement (may be stale)', reserved: 'Retained total reservations',
    ordinary: 'Ordinary write reservations', terminal: 'Independent terminal reservations', pending: 'Unsettled operations', safety: 'Disk safety space',
    ledger: 'Journal used / ceiling', limit: 'Managed limit (bytes)', apply: 'Change capacity',
    configureHint: 'Lower capacity refuses new grants; existing ordinary and terminal space stays reserved. If the response is lost, read status before another edit.',
    recovery: 'Conservative recovery and rescan', confirm: 'I understand recovery synchronizes the ledger; undrained work, failed scans and unknown results retain reservations.',
    recover: 'Run recovery', recoveryHint: 'Recovery may settle confirmed drained operations. It changes ledger state, never replays tasks or deletes unknown files.',
    notRun: 'No rescan this time; cached lengths are not a complete current measurement.', incomplete: 'Writers are undrained or scanning is incomplete; reservations remain charged.',
    complete: 'Writers drained and rescan complete.', loading: 'Reading…', failed: 'Operation unconfirmed. Last observations are retained; read status to reconcile.',
    ready: 'Status read.', configured: 'Capacity change acknowledged; reservations remain owned by the ledger.',
    operation: 'Inspect an operation', operationId: 'Operation ID', inspect: 'Inspect operation',
    unknownOperation: 'Operation unknown: no authority to replay or release.', reservedOperation: 'Operation still reserved. Wait for writers to drain before explicit recovery.',
    settledOperation: 'Operation settled; this does not prove task success or file power-loss durability.', invalid: 'Enter a positive safe integer byte count.',
    inventoryBytes: 'Observed bytes in this home', issues: 'Unknown or unreadable items', inventoryHint: 'This observation grants no capacity and is separate from the shared ledger scan.',
    inventoryIncomplete: 'Incomplete total; do not interpret it as zero capacity.', records: 'Observation details', back: 'Back to connections',
    snapshots: 'Snapshot management', workspace: 'Absolute project path', paths: 'Relative file paths (one per line)', capture: 'Capture selected files', seal: 'Fix end state',
    listSnapshots: 'Read snapshots', choose: 'Select a snapshot', preview: 'Preview file restoration', restore: 'Restore checked files', restoreConfirm: 'Restore only checked files. Partial failures will not retry automatically.',
    archive: 'Snapshot archives', archiveHint: 'Import only stores the snapshot. It does not restore the project. Verify before explicit import, then choose restoration files separately.',
    destination: 'Archive output directory (outside project and snapshot storage)', export: 'Export selected snapshot', directory: 'Archive directory', verify: 'Verify archive', importArchive: 'Import verified archive',
    importConfirm: 'Import only this verified snapshot; do not restore the project automatically.', sealed: 'End state fixed', unsealed: 'End state not fixed', rows: 'Per-file results',
    verified: 'Archive verified; explicit import is available.', previewRequired: 'Select a snapshot and obtain its current preview first.', selectionRequired: 'Select at least one file.',
    unconfirmedSnapshot: 'Snapshot operation unconfirmed. Existing files remain. Inspect its operation ID; unknown results cannot replay.', cleanup: 'Cleanup preview', cleanupHint: 'Cleanup execution is unavailable. Unknown data, recovery backups and active reservations are never deleted automatically.', cleanupPreview: 'Read cleanup preview', cleanupDeferred: 'Cache/staging candidates only. Execution needs future native rechecks and writer drain; no deletion is authorized.',
  }
  const locale = chinese ? '?locale=zh-CN' : ''
  const fields = { measuredBytes: t.measured, observedBytes: t.observed, reservedBytes: t.reserved,
    ordinaryBytes: t.ordinary, terminalBytes: t.terminal, pendingOperations: t.pending, safetyBytes: t.safety }
  return `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>body{font:15px system-ui;margin:0;background:#f5f7fb;color:#1b263b}main{max-width:900px;margin:24px auto;padding:0 20px}section{background:white;border:1px solid #dde3ee;border-radius:12px;padding:20px;margin:16px 0}p{line-height:1.6}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}dt,dd{margin:0;overflow-wrap:anywhere}label{display:block;margin:14px 0}input{box-sizing:border-box;max-width:100%;font:inherit;padding:8px}input[type=checkbox]{margin-right:8px}button{font:inherit;padding:9px 14px;margin:8px 8px 0 0;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){body{background:#161a22;color:#e5eaf2}section{background:#202634;border-color:#455066}}@media(max-width:480px){main{padding:0 12px}section{padding:14px}dl{grid-template-columns:minmax(0,1fr)}}</style>${managementUi()}
<main><h1>${t.title}</h1><p>${t.intro}</p><a href="/api/nidofy/ui${locale}">${t.back}</a><button id="refresh">${t.refresh}</button><p id="status" role="status"></p>
<section><h2>${t.quota}</h2><p id="scan"></p><dl>${Object.entries(fields).map(([id, label]) => `<dt>${label}</dt><dd id="${id}">${t.unknown}</dd>`).join('')}<dt>${t.ledger}</dt><dd id="ledger">${t.unknown}</dd></dl><label for="limit">${t.limit}</label><input id="limit" type="number" min="1" step="1"><button id="configure" disabled>${t.apply}</button><p>${t.configureHint}</p></section>
<section><h2>${t.recovery}</h2><p>${t.recoveryHint}</p><label><input id="confirm" type="checkbox">${t.confirm}</label><button id="recover" disabled>${t.recover}</button></section>
<section><h2>${t.operation}</h2><label for="operationId">${t.operationId}</label><input id="operationId" autocomplete="off"><button id="inspect">${t.inspect}</button><p id="operationStatus" role="status"></p></section>
<section><h2>${t.inventory}</h2><p>${t.inventoryHint}</p><dl><dt>${t.measured}</dt><dd id="inventoryMeasured">${t.unknown}</dd><dt>${t.inventoryBytes}</dt><dd id="inventoryObserved">${t.unknown}</dd></dl><p id="inventoryState"></p><details><summary>${t.records}</summary><pre id="inventoryDetails"></pre></details></section>
<section><h2>${t.snapshots}</h2><label for="snapshotWorkspace">${t.workspace}</label><input id="snapshotWorkspace"><label for="snapshotPaths">${t.paths}</label><textarea id="snapshotPaths" rows="4" style="width:100%;box-sizing:border-box"></textarea><button id="capture">${t.capture}</button><button id="snapshotList">${t.listSnapshots}</button><label for="snapshot">${t.choose}</label><select id="snapshot" style="max-width:100%"><option value="">${t.choose}</option></select><button id="seal" disabled>${t.seal}</button><button id="preview" disabled>${t.preview}</button><div id="restoreRows"></div><label><input id="restoreConfirm" type="checkbox">${t.restoreConfirm}</label><button id="restore" disabled>${t.restore}</button><p id="snapshotStatus" role="status"></p><details><summary>${t.rows}</summary><pre id="snapshotResult"></pre></details></section>
<section><h2>${t.archive}</h2><p>${t.archiveHint}</p><label for="archiveDestination">${t.destination}</label><input id="archiveDestination"><button id="export" disabled>${t.export}</button><label for="archiveDirectory">${t.directory}</label><input id="archiveDirectory"><button id="verify">${t.verify}</button><label><input id="importConfirm" type="checkbox">${t.importConfirm}</label><button id="importArchive" disabled>${t.importArchive}</button><p id="archiveStatus" role="status"></p></section>
<section><h2>${t.cleanup}</h2><p>${t.cleanupHint}</p><button id="cleanupPreview">${t.cleanupPreview}</button><p id="cleanupStatus"></p><ul id="cleanupItems"></ul></section></main>
<script>${managementConfirm(chinese)}const t=${JSON.stringify(t)},el=id=>document.getElementById(id);let state,busy=false,restorePreview,verifiedArchive,snapshotItems=[];
async function api(method,input){const r=await fetch('/api/nidofy/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok){if(data.operationId)el('operationId').value=data.operationId;throw Error(data.error)}return data}
const number=value=>typeof value==='number'?String(value):t.unknown;
function controls(){for(const b of document.querySelectorAll('button'))b.disabled=busy;el('configure').disabled=busy||!state;el('recover').disabled=busy||!state||!el('confirm').checked;for(const id of ['preview','export'])el(id).disabled=busy||!el('snapshot').value;const selected=snapshotItems.find(row=>row.id===el('snapshot').value);el('seal').disabled=busy||!selected||selected.sealed||!!selected.task;el('restore').disabled=busy||!restorePreview||!el('restoreConfirm').checked||!document.querySelector('#restoreRows input:checked');el('importArchive').disabled=busy||!verifiedArchive||!el('importConfirm').checked}
function showQuota(value){state=value;for(const id of ${JSON.stringify(Object.keys(fields))})el(id).textContent=number(value[id]);el('ledger').textContent=number(value.ledgerBytes)+' / '+number(value.ledgerLimitBytes);el('limit').value=String(value.limitBytes);el('scan').textContent=value.scan==='complete'?t.complete:value.scan==='incomplete'?t.incomplete:t.notRun}
async function inventory(){try{const value=await api('storage',{action:'status'});el('inventoryMeasured').textContent=number(value.measuredBytes);el('inventoryObserved').textContent=number(value.observedBytes);el('inventoryState').textContent=value.scan==='complete'?t.complete:t.inventoryIncomplete;el('inventoryDetails').textContent=JSON.stringify(value.issues,null,2)}catch(error){el('inventoryMeasured').textContent=t.unknown;el('inventoryState').textContent=t.failed+' '+String(error)}}
async function refresh(){try{showQuota(await api('quota',{action:'status'}))}finally{await inventory()}}
async function run(work){busy=true;controls();el('status').textContent=t.loading;try{const message=await work();el('status').textContent=message||t.ready}catch(error){el('status').textContent=t.failed+' '+String(error)}finally{busy=false;controls()}}
el('refresh').onclick=()=>run(refresh);el('confirm').onchange=controls;
el('configure').onclick=()=>run(async()=>{const limitBytes=Number(el('limit').value);if(!Number.isSafeInteger(limitBytes)||limitBytes<1)throw Error(t.invalid);await api('quota',{action:'configure',limitBytes});await refresh();return t.configured});
el('recover').onclick=()=>run(async()=>{el('confirm').checked=false;showQuota(await api('quota',{action:'recover'}));await inventory();return state.drained?t.complete:t.incomplete});
el('inspect').onclick=()=>run(async()=>{const value=await api('quota',{action:'inspect',operationId:el('operationId').value.trim()});el('operationStatus').textContent=value.status==='unknown'?t.unknownOperation:value.status==='settled'?t.settledOperation:t.reservedOperation});
function invalidateRestore(){restorePreview=undefined;el('restoreRows').replaceChildren();el('restoreConfirm').checked=false;controls()}
function invalidateArchive(){verifiedArchive=undefined;el('importConfirm').checked=false;el('archiveStatus').textContent='';controls()}
el('snapshot').onchange=invalidateRestore;el('archiveDirectory').oninput=invalidateArchive;el('restoreConfirm').onchange=controls;el('importConfirm').onchange=controls;
async function snapshotList(){invalidateRestore();const value=await api('protection',{action:'list'}),prior=el('snapshot').value;snapshotItems=value.items;el('snapshot').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent=t.choose;el('snapshot').append(blank);for(const row of value.items){const o=document.createElement('option');o.value=row.id;o.textContent=row.id+' · '+row.workspace+' · '+(row.sealed?t.sealed:t.unsealed);el('snapshot').append(o)}el('snapshot').value=[...el('snapshot').options].some(o=>o.value===prior)?prior:''}
async function snapshotAction(action){return run(async()=>{try{const value=await action();el('snapshotResult').textContent=JSON.stringify(value,null,2);el('snapshotStatus').textContent=t.ready}catch(error){invalidateRestore();invalidateArchive();el('snapshotStatus').textContent=t.unconfirmedSnapshot+' '+String(error);throw error}})}
el('snapshotList').onclick=()=>run(snapshotList);
el('capture').onclick=()=>snapshotAction(async()=>{const paths=el('snapshotPaths').value.split(/\\r?\\n/).map(p=>p.trim()).filter(Boolean);if(!paths.length)throw Error(t.selectionRequired);const result=await api('protection',{action:'capture',workspace:el('snapshotWorkspace').value,paths});await snapshotList();return result});
el('seal').onclick=()=>snapshotAction(async()=>{const result=await api('protection',{action:'seal',id:el('snapshot').value});await snapshotList();return result});
el('preview').onclick=()=>run(async()=>{invalidateRestore();const id=el('snapshot').value,value=await api('protection',{action:'preview',id});if(id!==el('snapshot').value)return;restorePreview={...value,id};for(const row of value.rows){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=row.path;check.disabled=row.status!=='READY';check.onchange=controls;label.append(check,document.createTextNode(row.path+' · '+row.status+' · '+row.message));el('restoreRows').append(label)}});
el('restore').onclick=()=>snapshotAction(async()=>{const paths=[...document.querySelectorAll('#restoreRows input:checked')].map(check=>check.value);if(!restorePreview||!paths.length)throw Error(t.previewRequired);const request={action:'restore',id:restorePreview.id,paths,expectedRevision:restorePreview.revision};invalidateRestore();return api('protection',request)});
el('export').onclick=()=>snapshotAction(async()=>{const value=await api('protection',{action:'export',id:el('snapshot').value,destination:el('archiveDestination').value});invalidateArchive();el('archiveDirectory').value=value.directory;return value});
el('verify').onclick=()=>run(async()=>{invalidateArchive();const directory=el('archiveDirectory').value,value=await api('protection',{action:'verifyArchive',directory});if(directory!==el('archiveDirectory').value)return;verifiedArchive={...value,directory};el('archiveStatus').textContent=t.verified+' '+value.files+' / '+value.bytes});
el('importArchive').onclick=()=>snapshotAction(async()=>{if(!verifiedArchive)throw Error(t.previewRequired);const request={action:'importArchive',directory:verifiedArchive.directory,expectedRevision:verifiedArchive.revision};invalidateArchive();const result=await api('protection',request);await snapshotList();return result});
el('cleanupPreview').onclick=()=>run(async()=>{const value=await api('cleanup-preview',{action:'preview'});el('cleanupStatus').textContent=t.cleanupDeferred+' '+t.reserved+': '+number(value.reservedBytes);el('cleanupItems').replaceChildren();for(const row of value.items){const li=document.createElement('li');li.textContent=row.path+' · '+row.bytes;el('cleanupItems').append(li)}for(const row of value.issues){const li=document.createElement('li');li.textContent=row.path+' · '+row.code;el('cleanupItems').append(li)}});run(refresh);</script></html>`
}
