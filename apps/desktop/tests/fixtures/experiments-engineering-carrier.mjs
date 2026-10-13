/** Real production Main/preload, built Web/Client and authenticated T19 UI on fresh synthetic data. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, cp, writeFile, readFile, readdir, symlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(repo, 'apps/web/package.json'))
const { _electron } = require('playwright')
// The npm Electron entry can download; only this retained physical runtime is eligible.
const electron = join(repo, 'apps/desktop/.desktop-build/targets/win-x64/electron/electron.exe')
const evidence = resolve(process.argv[2] ?? join(repo, '.build/dispatch/evidence/relay-26/renderer'))
await mkdir(evidence, { recursive: true })
const record = await mkdtemp(join(evidence, 'carrier-'))
const root = await mkdtemp(join(tmpdir(), 'dsh-engineering-carrier-'))
const application = join(root, 'app'), project = join(root, 'project')
const home = join(root, 'data/harness'), profile = join(home, 'profiles/desktop')
const primaryRuntime = join(root, 'runtime/primary-runtime')
await writeFile(join(root, 'fixture-root.json'), JSON.stringify({ root, home, application, project, isolated: true }) + '\n')
await cp(join(root, 'fixture-root.json'), join(record, 'fixture-root.json'))
for (const directory of [application, project, profile, primaryRuntime, join(root, 'resources')]) {
  await mkdir(directory, { recursive: true })
}
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name)))
const { version } = JSON.parse(await readFile(join(repo, 'apps/desktop/package.json'), 'utf8'))
const { version: pnpmVersion } = JSON.parse(await readFile(join(repo, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8'))
const { DESKTOP_HOST_PROTOCOL_VERSION } = await import(pathToFileURL(join(repo, 'apps/desktop/lib/types/host-protocol.js')).href)
const nodeVersion = execFileSync(electron, ['-p', 'process.versions.node'], {
  env: { ...environment, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8',
}).trim()
for (const directory of ['lib', 'renderer', 'resources']) {
  await cp(join(repo, 'apps/desktop', directory), join(application, directory), { recursive: true })
}
const manifest = JSON.parse(await readFile(join(repo, 'apps/desktop/package.json'), 'utf8'))
for (const name of Object.keys(manifest.dependencies)) {
  const target = join(application, 'node_modules', name)
  await mkdir(resolve(target, '..'), { recursive: true })
  await symlink(await realpath(join(repo, 'apps/desktop/node_modules', name)), target, 'junction')
}
for (const scope of ['@deepseek-ai', '@nidofy']) {
  const installed = join(repo, 'node_modules/.pnpm/node_modules', scope)
  await mkdir(join(project, 'node_modules', scope), { recursive: true })
  for (const name of await readdir(installed)) {
    await symlink(await realpath(join(installed, name)), join(project, 'node_modules', scope, name), 'junction')
  }
}
await cp(join(repo, 'native/nidofy-protection/target/release/nidofy-protection.exe'), join(root, 'resources/nidofy-protection.exe'))
await cp(join(repo, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
await mkdir(join(primaryRuntime, 'dependencies/node/bin'), { recursive: true })
await cp(process.execPath, join(primaryRuntime, 'dependencies/node/bin/node.exe'))
await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'engineering-carrier-qualification', version, type: 'module', dshDistribution: {
  schemaVersion: 1, kind: 'personal', revision: 1, productName: 'Nidofy DSH Desktop', protocol: 'nidofy-dsh',
  dataDirectory: 'Nidofy DSH Desktop', updates: 'offline',
} }))
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'selftest-carrier-runtime', private: true, type: 'module',
  dependencies: { '@deepseek-ai/dsh': version, '@deepseek-ai/dsh-desktop-host': version },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}))
// Development descriptor and links qualify this carrier, never the installed resource inventory.
await writeFile(join(project, 'desktop-runtime.json'), JSON.stringify({ schemaVersion: 1,
  release: { schemaVersion: 1, version, nodeVersion, pnpmVersion, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
  platform: process.platform, arch: process.arch, files: [],
  sharedPackages: ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'].map(name => ({ name, version, path: 'node_modules/' + name })),
}))
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'selftest-carrier-profile', private: true, type: 'module',
  nidofyBundleEnrollment: 1, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@nidofy/dsh-desktop-bundle'] } },
}))
// The real first-use directory operation refuses this synthetic file. No OS Documents lookup or blank Session creation occurs.
const blockedDocuments = join(root, 'blocked-documents')
await writeFile(blockedDocuments, 'Synthetic directory refusal\n', { flag: 'wx' })
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
  ...['llm-deepseek', 'llm-deepseek-account', 'session-title-llm', 'agent-instructions', 'hmr'].map(id => ({ id, disabled: true })),
  { id: 'workspace-controller', config: { documentsDirectory: blockedDocuments } },
  { id: 'pwsh-sandbox', config: { pwshPath: join(environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe') } },
  { insert: [{ id: 'selftest-carrier-qualification', name: pathToFileURL(join(import.meta.dirname, 'selftest-carrier-probe.mjs')).href }] },
]))
const logs=[],errors=[],requests=[],steps=[]
let carrier,provider,dashboard,failure,shutdown,observation
const heldResponses=new Set();let providerHold=false
process.on('message',message=>{if(message?.type==='cancel'&&carrier)void carrier.evaluate(({app})=>app.quit()).catch(()=>{})})
try {
  carrier=await _electron.launch({executablePath:electron,args:[join(import.meta.dirname,'selftest-carrier-main.mjs')],timeout:60000,
    env:{...environment,DSH_SELFTEST_CARRIER_ROOT:root,NIDOFY_DESKTOP_DATA_ROOT:join(root,'data'),USERPROFILE:root,HOME:root,TEMP:root,TMP:root,TMPDIR:root,
      DSH_DESKTOP_DSH_DIR:project,DSH_DESKTOP_PRIMARY_RUNTIME_DIR:primaryRuntime,DSH_DESKTOP_PNPM_ENTRY:join(repo,'apps/desktop/node_modules/pnpm/bin/pnpm.mjs'),DSH_DESKTOP_OPEN_DEVTOOLS:'0'}})
  carrier.process().stdout?.on('data',bytes=>logs.push(String(bytes)));carrier.process().stderr?.on('data',bytes=>logs.push(String(bytes)))
  const context=carrier.context();context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)))
  context.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/nidofy/workbench/experiments/'))requests.push({method:request.url().split('/').at(-1),data:request.postDataJSON()})})
  const main=await carrier.firstWindow();main.on('pageerror',error=>errors.push(error.message))
  await main.waitForURL('dsh-app://app/');await main.waitForFunction(()=>window.dshDesktopBoot!==undefined)
  const boot=await main.evaluate(()=>window.dshDesktopBoot.ready())
  assert.equal((await fetch(boot.streamBaseUrl+'/api/nidofy/workbench/experiments/ui')).status,401)
  const auxiliary=carrier.waitForEvent('window');await main.evaluate(()=>window.nidofyWorkbench.openPanel('pets'))
  dashboard=await auxiliary;await dashboard.waitForURL('dsh-app://app/api/nidofy-extras/ui**')
  await dashboard.goto('dsh-app://app/api/nidofy/workbench/experiments/ui?locale=en')
  await dashboard.getByRole('heading',{name:'Task receipt comparisons',exact:true}).waitFor()
  const native=await carrier.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({id:window.id,
    ...Object.fromEntries(['sandbox','contextIsolation','nodeIntegration','webSecurity'].map(key=>[key,window.webContents.getLastWebPreferences()[key]]))})))
  assert.equal(native.length,2);assert.ok(native.every(row=>row.sandbox&&row.contextIsolation&&!row.nodeIntegration&&row.webSecurity))
  assert.deepEqual(await dashboard.evaluate(()=>({process:typeof globalThis.process,require:typeof globalThis.require})),{process:'undefined',require:'undefined'})
  const api=(page,path,data={})=>page.evaluate(async({path,data})=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error);return value},{path,data})
  const counts=()=>api(main,'/api/selftest-qualification')
  assert.deepEqual(await counts(),{modelRequests:0,createdAgents:0})
  steps.push('production-main-sandboxed-auxiliary-preload-authenticated-engineering-page-zero-blank-session')
  const {createServer}=await import('node:http'),{randomUUID}=await import('node:crypto')
  const wires=[]
  provider=createServer(async(request,response)=>{const parts=[];for await(const part of request)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString());wires.push(body)
    assert.equal(body.model,'engineering-renderer');assert.equal(request.headers.authorization,'Bearer synthetic-renderer-only')
    if(providerHold){heldResponses.add(response);response.once('close',()=>heldResponses.delete(response));response.writeHead(200,{'content-type':'text/event-stream'});response.write('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'Held synthetic renderer request'},finish_reason:null}]})+'\n\n');return}
    const first=!body.messages.some(message=>message.role==='tool'),delta=first?{role:'assistant',tool_calls:[{index:0,id:'renderer-action',type:'function',function:{name:'run_project_action',arguments:'{"id":"case"}'}}]}:{role:'assistant',content:'Original receipt is pending user acceptance.'}
    response.writeHead(200,{'content-type':'text/event-stream'});response.write('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
    response.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:first?'tool_calls':'stop'}],usage:{prompt_tokens:12,completion_tokens:5,prompt_tokens_details:{cached_tokens:3}}})+'\n\ndata: [DONE]\n\n')})
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve))
  await mkdir(join(project,'src'));await mkdir(join(project,'inputs'))
  await writeFile(join(project,'src/case.test.mjs'),"import{test}from'node:test';import assert from'node:assert/strict';test('renderer synthetic case',()=>assert.equal(1,1));\n")
  await writeFile(join(project,'inputs/case.json'),'{"tolerance":0}\n')
  const node=join(primaryRuntime,'dependencies/node/bin/node.exe'),quote=value=>"'"+value.replaceAll("'","''")+"'"
  const config={schemaVersion:1,actions:[{id:'case',label:'Reviewed renderer synthetic case',command:'& '+quote(node)+' --test --test-isolation=none --test-reporter=tap ./src/case.test.mjs',timeoutMs:10000,
    verification:{schemaVersion:1,intent:'Same explicit renderer case',parser:'node-tap-13/1',coverage:'complete',sources:['src'],inputs:['inputs'],toolchain:[node],parameters:{tolerance:0}}}]}
  const saved=await api(dashboard,'/api/nidofy/workbench/actions/save',{workspace:project,config})
  await api(dashboard,'/api/nidofy/workbench/actions/trust',{workspace:project,fingerprint:saved.fingerprint})
  await api(dashboard,'/api/nidofy/mutate',{action:'save',operationId:randomUUID(),connection:'engineering-renderer',expectedRevision:0,credential:{mode:'replace',value:'synthetic-renderer-only'},
    profile:{api:'openai-completions',baseURL:'http://127.0.0.1:'+provider.address().port+'/v1',models:[{id:'engineering-renderer'}],defaultContextWindow:32768,defaultMaxTokens:64,retryPolicy:{mode:'normal',maxRetries:0}}})
  const resourceBudget={workspaceBytes:33554432,workspaceEntries:1024,retainedWorkspaceBytes:536870912,sessionBytes:2097152,sessionDiskBytes:2097152,sessionEvents:4096}
  const fill=async()=>{for(const[id,value]of [['Source',project],['Paths','src\ninputs'],['Actions','case'],['Connection','engineering-renderer'],['Model','engineering-renderer'],['Text','Run the reviewed case once; report its retained receipt without user acceptance.']])await dashboard.locator('#engineering'+id).fill(value)
    await dashboard.locator('#engineeringResources').fill(JSON.stringify(resourceBudget))}
  for(const[locale,title]of [['en','Isolated engineering task'],['zh-CN','隔离工程任务']]) {
    if(locale!=='en')await dashboard.goto('dsh-app://app/api/nidofy/workbench/experiments/ui?locale='+locale)
    await dashboard.getByRole('heading',{name:title,exact:true}).waitFor();await fill();await dashboard.locator('#engineeringPrepare').click()
    await dashboard.locator('#engineeringConfirm').waitFor({state:'visible'});await dashboard.waitForFunction(()=>!document.querySelector('#engineeringConfirm').disabled)
    const preview=JSON.parse(await dashboard.locator('#engineeringPreview').textContent());assert.deepEqual(preview.resourceBudget,resourceBudget)
    assert.equal(wires.length,0);assert.deepEqual(await counts(),{modelRequests:0,createdAgents:0})
    await dashboard.screenshot({path:join(record,locale+'-engineering-preview.png'),fullPage:true})
    await dashboard.locator('#engineeringResources').fill(JSON.stringify({...resourceBudget,workspaceEntries:1023}))
    assert.equal(await dashboard.locator('#engineeringConfirm').isDisabled(),true)
    assert.equal(await dashboard.locator('#engineeringPreview').textContent(),'')
  }
  steps.push('actual-bilingual-renderer-full-resource-preview-edit-revocation-zero-dispatch')
  await fill();await dashboard.locator('#engineeringPrepare').click();await dashboard.waitForFunction(()=>!document.querySelector('#engineeringConfirm').disabled)
  await dashboard.locator('#engineeringConfirm').click();await dashboard.waitForFunction(()=>!!document.querySelector('#engineeringId').value)
  const id=await dashboard.locator('#engineeringId').inputValue(),deadline=Date.now()+45000
  let result
  for(;;){const response=dashboard.waitForResponse(value=>value.url().endsWith('/experiments/engineering-read')&&value.request().method()==='POST')
    await dashboard.locator('#engineeringRead').click();result=await(await response).json()
    if(result){await dashboard.waitForFunction(value=>document.querySelector('#engineeringResult').textContent===JSON.stringify(value,null,2),result);if(result.terminal)break}
    if(Date.now()>deadline)throw Error('Renderer engineering task did not settle');await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(result.status,'COMPLETED',JSON.stringify(result.terminal));assert.equal(result.receipts.length,1)
  assert.equal(result.receipts[0].view.receipt.tests,'PASSED');assert.equal(result.receipts[0].view.receipt.acceptance,'PENDING')
  assert.equal(result.resourceResult.diskPeakBytes,null);assert.equal(result.resourceResult.memoryPeakBytes,null)
  assert.equal(wires.length,2);assert.deepEqual(await counts(),{modelRequests:2,createdAgents:1})
  await dashboard.locator('#engineeringCompareA').fill(id);await dashboard.locator('#engineeringCompareB').fill(id);await dashboard.locator('#engineeringCompare').click()
  await dashboard.waitForFunction(()=>document.querySelectorAll('#engineeringComparisonMetrics table').length===2)
  const comparison=JSON.parse(await dashboard.locator('#engineeringComparison').textContent())
  assert.equal(comparison.task,'NOT_COMPARABLE');assert.deepEqual(comparison.resourceCounts.diskPeakBytes,{a:null,b:null,missing:2})
  assert.ok(comparison.resourceCounts.sessionDiskBytes.a>0)
  assert.equal(await dashboard.locator('#engineeringComparison').evaluate(element=>element.scrollHeight>element.clientHeight),true)
  await dashboard.screenshot({path:join(record,'zh-engineering-comparison.png'),fullPage:true})
  const grouping={experimentId:randomUUID(),caseId:randomUUID()},matrixRow={...grouping,source:project,paths:['src','inputs'],actionIds:['case'],
    connection:'engineering-renderer',model:'engineering-renderer',text:'Run the same reviewed renderer matrix case once.',resourceBudget,shellBudget:{outputBytes:8388608,retainedSpillBytes:134217728},
    budget:{requests:2,outputTokensPerRequest:64,outputTokens:128,toolCalls:2,actions:1,durationMs:30000}}
  await dashboard.locator('#matrixRows').fill(JSON.stringify([matrixRow,matrixRow]))
  await dashboard.locator('#matrixPrepare').click();await dashboard.waitForFunction(()=>!document.querySelector('#matrixConfirm').disabled)
  const matrixPreview=JSON.parse(await dashboard.locator('#matrixPreview').textContent())
  assert.equal(matrixPreview.rows.length,2);assert.ok(matrixPreview.rows.every(row=>JSON.stringify(row.preview.resourceBudget)===JSON.stringify(resourceBudget)))
  assert.equal(wires.length,2);await dashboard.locator('#matrixConfirm').click()
  const matrixId=await dashboard.locator('#matrixId').inputValue(),matrixDeadline=Date.now()+45000
  let matrix
  for(;;){const response=dashboard.waitForResponse(value=>value.url().endsWith('/experiments/matrix-read')&&value.request().method()==='POST')
    await dashboard.locator('#matrixRead').click();matrix=await(await response).json();if(matrix?.terminal)break
    if(Date.now()>matrixDeadline)throw Error('Renderer matrix did not settle');await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(matrix.status,'COMPLETED');assert.equal(matrix.rounds.length,2);assert.equal(matrix.counts.dispatches,4)
  assert.equal(wires.length,6);assert.deepEqual(await counts(),{modelRequests:6,createdAgents:3})
  const report=await api(dashboard,'/api/nidofy/workbench/experiments/matrix-export',{id:matrixId})
  const reportPath=join(record,'original-matrix-report.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
  await dashboard.locator('#matrixFile').setInputFiles(reportPath);await dashboard.locator('#matrixImport').click()
  await dashboard.waitForFunction(()=>document.querySelector('#matrixResult').textContent.includes('"COMPLETED"'))
  assert.deepEqual(JSON.parse(await dashboard.locator('#matrixResult').textContent()),matrix);assert.equal(wires.length,6)
  const futurePath=join(record,'future-matrix-report.json');await writeFile(futurePath,JSON.stringify({...report,schemaVersion:2})+'\n')
  await dashboard.locator('#matrixFile').setInputFiles(futurePath);await dashboard.locator('#matrixImport').click()
  await dashboard.waitForFunction(()=>document.querySelector('#matrixStatus').textContent.includes('EXPERIMENT_MATRIX_RECORD_INVALID'))
  assert.equal(wires.length,6)
  const foreignPath=join(record,'foreign-matrix-report.json');await writeFile(foreignPath,JSON.stringify({...report,source:{...report.source,startedAt:Number(report.source.startedAt)+1}})+'\n')
  await dashboard.locator('#matrixFile').setInputFiles(foreignPath);await dashboard.locator('#matrixImport').click()
  await dashboard.waitForFunction(()=>document.querySelector('#matrixStatus').textContent.includes('EXPERIMENT_MATRIX_IMPORT_SOURCE_UNCONFIRMED'))
  assert.equal(wires.length,6)
  steps.push('actual-renderer-future-and-altered-source-report-file-refusal-zero-replay')
  steps.push('actual-renderer-explicit-matrix-two-protected-turns-round-archive-report-file-validation-zero-replay')
  const directory=join(home,'nidofy-extras/experiments/engineering-v1',id),original=new Map()
  for(const name of await readdir(directory))original.set(name,await readFile(join(directory,name)))
  await dashboard.reload();assert.equal(await dashboard.locator('#engineeringId').inputValue(),'')
  assert.equal(wires.length,6);await dashboard.locator('#engineeringId').fill(id);await dashboard.locator('#engineeringRead').click()
  await dashboard.waitForFunction(()=>document.querySelector('#engineeringResult').textContent.includes('"COMPLETED"'))
  providerHold=true;await fill();await dashboard.locator('#engineeringPrepare').click();await dashboard.waitForFunction(()=>!document.querySelector('#engineeringConfirm').disabled)
  await dashboard.evaluate(()=>{const original=window.fetch;window.fetch=async function(input,init){const response=await original(input,init);if(String(input).endsWith('/experiments/engineering-start'))throw Error('Synthetic lost committed start response');return response}})
  await dashboard.locator('#engineeringConfirm').click();await dashboard.waitForFunction(()=>document.querySelector('#engineeringStatus').textContent.includes('Synthetic lost committed start response'))
  const pendingId=await dashboard.locator('#engineeringId').inputValue();assert.ok(pendingId)
  assert.equal(await dashboard.evaluate(()=>localStorage.getItem('nidofy-engineering-task-pending')),pendingId)
  const pendingDeadline=Date.now()+10000;while(wires.length<7){if(Date.now()>pendingDeadline)throw Error('Committed uncertain task did not enter synthetic provider');await new Promise(resolve=>setTimeout(resolve,20))}
  const beforeReload=requests.filter(row=>['engineering-start','engineering-read','engineering-cancel'].includes(row.method)).length
  await dashboard.reload();assert.equal(await dashboard.locator('#engineeringId').inputValue(),pendingId)
  assert.equal(requests.filter(row=>['engineering-start','engineering-read','engineering-cancel'].includes(row.method)).length,beforeReload)
  const cancelResponse=dashboard.waitForResponse(value=>value.url().endsWith('/experiments/engineering-cancel'))
  await dashboard.locator('#engineeringCancel').click();const cancelled=await(await cancelResponse).json()
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.counts.dispatches,1);assert.equal(cancelled.counts.actionAttempts,0)
  assert.equal(wires.length,7);assert.equal(heldResponses.size,0)
  assert.equal(await dashboard.evaluate(()=>localStorage.getItem('nidofy-engineering-task-pending')),null)
  await writeFile(join(record,'unknown-start-cancelled.json'),JSON.stringify(cancelled,null,2)+'\n')
  steps.push('actual-renderer-lost-committed-start-retains-id-reload-zero-automatic-read-resend-explicit-cancel-drains')
  await dashboard.locator('#matrixRows').fill(JSON.stringify([matrixRow,matrixRow]));await dashboard.locator('#matrixPrepare').click()
  await dashboard.waitForFunction(()=>!document.querySelector('#matrixConfirm').disabled);await dashboard.locator('#matrixConfirm').click()
  const cancelMatrixId=await dashboard.locator('#matrixId').inputValue(),matrixHoldDeadline=Date.now()+10000
  while(wires.length<8){if(Date.now()>matrixHoldDeadline)throw Error('Held matrix row did not enter provider');await new Promise(resolve=>setTimeout(resolve,20))}
  const matrixCancelResponse=dashboard.waitForResponse(value=>value.url().endsWith('/experiments/matrix-cancel'))
  await dashboard.locator('#matrixCancel').click();const cancelledMatrix=await(await matrixCancelResponse).json()
  assert.equal(cancelledMatrix.status,'CANCELLED');assert.equal(cancelledMatrix.rounds.length,1);assert.equal(cancelledMatrix.rounds[0].status,'CANCELLED')
  assert.equal(cancelledMatrix.counts.dispatches,null);assert.equal(wires.length,8);assert.equal(heldResponses.size,0)
  assert.equal(cancelledMatrix.intent.id,cancelMatrixId)
  await writeFile(join(record,'matrix-cancelled.json'),JSON.stringify(cancelledMatrix,null,2)+'\n')
  steps.push('actual-renderer-matrix-cancel-drains-retained-current-round-and-never-dispatches-next')
  await dashboard.close();assert.deepEqual(await counts(),{modelRequests:8,createdAgents:5})
  for(const[name,bytes]of original)assert.deepEqual(await readFile(join(directory,name)),bytes)
  assert.equal(wires.length,8);assert.deepEqual(errors,[])
  await writeFile(join(record,'matrix-result.json'),JSON.stringify(matrix,null,2)+'\n')
  await writeFile(join(record,'engineering-result.json'),JSON.stringify(result,null,2)+'\n')
  await writeFile(join(record,'engineering-comparison.json'),JSON.stringify(comparison,null,2)+'\n')
  steps.push('actual-renderer-confirmed-agent-protected-tap-receipt-resource-bytes-and-unknown-peak-table','actual-renderer-reload-read-identity-auxiliary-close-original-bytes-zero-replay')
  observation=await counts()
}catch(error){failure=String(error);if(dashboard&&!dashboard.isClosed()){await writeFile(join(record,'page-failure.json'),JSON.stringify(await dashboard.evaluate(()=>({url:location.href,status:document.querySelector('#engineeringStatus')?.textContent,result:document.querySelector('#engineeringResult')?.textContent})),null,2)+'\n');await dashboard.screenshot({path:join(record,'failed-renderer.png'),fullPage:true})}console.error(error);throw error}
finally {
  if(carrier){try{await carrier.evaluate(({app})=>app.quit());await carrier.close();shutdown='exited'}catch(error){shutdown=String(error);const child=carrier.process();child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('close',resolve))}}
  for(const response of heldResponses)response.destroy()
  if(provider)await new Promise(resolve=>provider.close(resolve))
  await writeFile(join(record,'main.log'),logs.join('').replace(/token=[A-Za-z0-9_-]+/g,'token=[redacted]'))
  await writeFile(join(record,'requests.json'),JSON.stringify(requests,null,2)+'\n')
  await writeFile(join(record,'result.json'),JSON.stringify({root,steps,errors,failure,shutdown,observation,paidRequests:failure?null:0,
    syntheticProviderHttpCalls:failure?null:8,actualProtectedActions:failure?null:3,completedEngineeringTasks:failure?null:3,completedMatrices:failure?null:1,
    renderer:failure?'FAILED':'DEVELOPMENT_ENGINEERING_UI',installer:'UNKNOWN'},null,2)+'\n')
}
if(process.connected)process.disconnect()
console.log(JSON.stringify({record,root,steps,...observation,paidRequests:0}))
