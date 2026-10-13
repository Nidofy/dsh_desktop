/** Real production Main/preload, built Web/Client and authenticated T19 UI on fresh synthetic data. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, cp, writeFile, readFile, readdir, symlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { runProviderUi } from './selftest-provider-ui.mjs'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(repo, 'apps/web/package.json'))
const { _electron } = require('playwright')
// The npm Electron entry can download; only this retained physical runtime is eligible.
const electron = join(repo, 'apps/desktop/.desktop-build/targets/win-x64/electron/electron.exe')
const evidence = resolve(process.argv[2] ?? join(repo, '.build/dispatch/evidence/selftest-carrier'))
await mkdir(evidence, { recursive: true })
const record = await mkdtemp(join(evidence, 'carrier-'))
const root = await mkdtemp(join(tmpdir(), 'dsh-selftest-carrier-'))
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
await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'selftest-carrier-qualification', version, type: 'module', dshDistribution: {
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
const logs = [], errors = [], steps = [], requests = [], reports = []
let carrier, failure, shutdown, observation, observeOwner
const providerMode = process.argv[3] === 'provider'
let cancelled = false
process.on('message', message => {
  if (message?.type !== 'cancel') return
  cancelled = true
  if (carrier) void carrier.evaluate(({ app }) => { app.quit() }).catch(() => {})
})
try {
  if (cancelled) throw Error('Carrier cancelled before launch')
  carrier = await _electron.launch({ executablePath: electron, args: [join(import.meta.dirname, 'selftest-carrier-main.mjs')], timeout: 60000,
    env: { ...environment, DSH_SELFTEST_CARRIER_ROOT: root, NIDOFY_DESKTOP_DATA_ROOT: join(root, 'data'),
      USERPROFILE: root, HOME: root, TEMP: root, TMP: root, TMPDIR: root,
      DSH_DESKTOP_DSH_DIR: project, DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primaryRuntime,
      DSH_DESKTOP_PNPM_ENTRY: join(repo, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs'), DSH_DESKTOP_OPEN_DEVTOOLS: '0' },
  })
  carrier.process().stdout?.on('data', chunk => logs.push(String(chunk)))
  carrier.process().stderr?.on('data', chunk => logs.push(String(chunk)))
  const context = carrier.context()
  // Test-only observation of actual assembled Client services; no product API or Session is added.
  await context.addInitScript(() => {
    const observation = {}
    globalThis.__selftestCarrier = observation
    Object.defineProperty(globalThis, '__ModuleLoader__', { configurable: true, set(target) {
      Object.defineProperty(globalThis, '__ModuleLoader__', { configurable: true, writable: true, value: target })
      const create = target.create.bind(target)
      target.create = function(options) {
        const prototype = options.staticModules['@deepseek-ai/cordis'].RegistryService.prototype, plugin = prototype.plugin
        prototype.plugin = function(...args) { prototype.plugin = plugin; observation.ctx = this.ctx.root; return plugin.apply(this, args) }
        return create(options)
      }
    } })
    if (location.protocol === 'dsh-app:' && location.hostname === 'app') localStorage.setItem('dsh.locale', 'en')
  })
  context.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/nidofy/workbench/selftest/')) {
      requests.push({ method: request.url().split('/').at(-1), data: request.postDataJSON() })
    }
  })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const main = await carrier.firstWindow()
  main.on('pageerror', error => errors.push(error.message))
  await main.waitForURL('dsh-app://app/')
  await main.reload()
  await main.waitForFunction(() => globalThis.__selftestCarrier?.ctx?.get('companion')?.view.getSnapshot().connected, null, { timeout: 60000 })
  assert.equal(await main.evaluate(() => globalThis.__selftestCarrier.ctx.uiSession.mainBinding.getSnapshot()), undefined)
  const boot = await main.evaluate(() => window.dshDesktopBoot.ready())
  const native = await carrier.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id,
    ...Object.fromEntries(['sandbox', 'contextIsolation', 'nodeIntegration', 'webSecurity'].map(key => [key, window.webContents.getLastWebPreferences()[key]])),
  })))
  assert.equal(native.length, 1)
  assert.deepEqual(native[0], { id: native[0].id, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
  const versions = await carrier.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }))
  assert.ok(versions.electron && versions.chrome)
  assert.equal((await fetch(boot.streamBaseUrl + '/api/nidofy/workbench/selftest/ui')).status, 401)
  steps.push('production-main-sandboxed-preload-built-client-local-protocol-and-unauthenticated-http-refusal')
  const auxiliary = carrier.waitForEvent('window')
  await main.evaluate(() => window.nidofyWorkbench.openPanel('pets'))
  let dashboard = await auxiliary
  await dashboard.waitForURL('dsh-app://app/api/nidofy-extras/ui**')
  await dashboard.waitForFunction(() => document.querySelector('[data-tab="pets"]').getAttribute('aria-selected') === 'true')
  await dashboard.locator('[data-tab="selftest"]').click()
  await dashboard.locator('#selfcheck').click()
  await dashboard.waitForURL('dsh-app://app/api/nidofy/workbench/selftest/ui**')
  await dashboard.getByRole('heading', { name: 'Electron self-test', exact: true }).waitFor()
  const request = (page, method, data = {}) => page.evaluate(async ({ method, data }) => {
    const response = await fetch('/api/nidofy/workbench/selftest/' + method, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
    if (!response.ok) throw Error(await response.text())
    return response.json()
  }, { method, data })
  const observe = page => page.evaluate(async () => {
    const response = await fetch('/api/selftest-qualification')
    if (!response.ok) throw Error(await response.text())
    return response.json()
  })
  observeOwner = () => observe(main)
  const safePreload = await dashboard.evaluate(async () => ({ identity: await window.dshDesktop.windowIdentity(),
    require: typeof globalThis.require, process: typeof globalThis.process,
    boot: await window.dshDesktopBoot.ready().then(() => 'accepted', error => String(error)),
  }))
  assert.equal(safePreload.require, 'undefined')
  assert.equal(safePreload.process, 'undefined')
  assert.match(safePreload.boot, /DESKTOP_APPLICATION_DOCUMENT_REFUSED/)
  assert.notEqual(safePreload.identity, native[0].id)
  steps.push('personal-extensions-selftest-navigation-auxiliary-preload-and-conversation-bootstrap-refusal')
  const shot = async (page, name) => {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(record, name), fullPage: true })
  }
  const counts = () => Object.fromEntries(['start', 'connection-prepare', 'connection-capacity', 'export'].map(method => [method, requests.filter(row => row.method === method).length]))
  for (const [locale, title, capacity] of [['en', 'Electron self-test', 'Read retained input capacity'], ['zh-CN', 'Electron 自检中心', '读取输入保留容量']]) {
    if (locale !== 'en') await dashboard.goto('dsh-app://app/api/nidofy/workbench/selftest/ui?locale=' + locale)
    await dashboard.getByRole('heading', { name: title, exact: true }).waitFor()
    const before = counts()
    await dashboard.getByRole('button', { name: capacity, exact: true }).click()
    await dashboard.waitForFunction(() => document.querySelector('#capacity-status').textContent.endsWith(' · OK'))
    assert.deepEqual(await request(dashboard, 'connection-capacity'), { roots: 0, unsettled: 0, available: true, code: 'OK' })
    assert.equal(counts().start, before.start)
    assert.equal(counts()['connection-prepare'], before['connection-prepare'])
    await shot(dashboard, locale + '-capacity.png')
  }
  observation = await observe(dashboard)
  assert.deepEqual(observation, { modelRequests: 0, createdAgents: 0 })
  steps.push('bilingual-real-renderer-capacity-read-zero-allocation-preparation-model-and-agent')
  if (providerMode) {
    const result = await runProviderUi({ main, dashboard, request, observe, shot, root, home, project, record, steps, requests })
    reports.push(...result.reports)
    observation = await observe(main)
    assert.deepEqual(observation, { modelRequests: result.modelRequests, createdAgents: 0 })
    assert.deepEqual(errors, [])
  } else {
  await dashboard.getByRole('button', { name: '运行本机检查', exact: true }).click()
  await dashboard.waitForFunction(() => /流程: (COMPLETED|FAILED|TIMEOUT|CANCELLED)/.test(document.querySelector('#status').textContent), null, { timeout: 90000 })
  const id = await dashboard.evaluate(() => sessionStorage.getItem('nidofy-selftest-id'))
  const report = await request(dashboard, 'read', { id })
  reports.push(report)
  assert.equal(report.status, 'COMPLETED', JSON.stringify(report))
  assert.equal(report.mode, 'local')
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.budget.modelRequests, 0)
  assert.ok(report.rows.some(row => row.id === 'prefix' && row.status === 'PASS' && row.metrics.requests === 0))
  assert.ok(report.rows.some(row => row.id === 'node' && row.status === 'PASS'))
  assert.ok(report.rows.some(row => row.id === 'webview' && row.status === 'UNKNOWN'))
  assert.ok(report.rows.slice(-2).every(row => row.status === 'UNKNOWN'))
  assert.equal(requests.filter(row => row.method === 'start').length, 1)
  await shot(dashboard, 'zh-local-completed.png')
  steps.push('actual-renderer-single-explicit-local-run-native-quota-and-node-mode-report-field-unknown')
  const reportPath = join(home, 'nidofy-extras/selftests/reports', id + '.json')
  const beforeBytes = await readFile(reportPath)
  const beforeView = counts()
  await dashboard.reload()
  await dashboard.waitForFunction(() => document.querySelector('#status').textContent.startsWith('流程: COMPLETED'))
  assert.equal(counts().start, beforeView.start)
  assert.deepEqual(await readFile(reportPath), beforeBytes)
  await dashboard.goto('dsh-app://app/api/nidofy/workbench/selftest/ui?locale=en')
  await dashboard.waitForFunction(() => document.querySelector('#status').textContent === 'Workflow: COMPLETED')
  await shot(dashboard, 'en-local-completed.png')
  const exported = await request(dashboard, 'export', { id })
  assert.ok(!('id' in exported))
  assert.ok(!JSON.stringify(exported).includes(root))
  assert.deepEqual(await readFile(reportPath), beforeBytes)
  assert.deepEqual(await observe(dashboard), { modelRequests: 0, createdAgents: 0 })
  steps.push('bilingual-report-reload-history-export-original-bytes-retained-zero-replay')
  await carrier.evaluate(({ session }, { directory, sender }) => {
    globalThis.__selftestDownloads = []
    globalThis.__selftestDownloadListener = (_event, item, contents) => {
      if (contents.id !== sender) { item.cancel(); return }
      const name = item.getFilename(), filename = name === 'DSH-selftest.json' ? 'export.json' : name === 'DSH-selftest.md' ? 'export.md' : undefined
      if (!filename) { item.cancel(); return }
      const row = { name, state: 'started', bytes: 0 }
      globalThis.__selftestDownloads.push(row)
      item.setSavePath(directory + '/' + filename)
      item.once('done', (_done, state) => { row.state = state; row.bytes = item.getReceivedBytes() })
    }
    session.defaultSession.on('will-download', globalThis.__selftestDownloadListener)
  }, { directory: record, sender: await carrier.evaluate(({ BrowserWindow }, id) =>
    BrowserWindow.getAllWindows().find(window => window.id === id).webContents.id, safePreload.identity) })
  const downloaded = async count => {
    const deadline = Date.now() + 10000
    for (;;) {
      const rows = await carrier.evaluate(() => globalThis.__selftestDownloads)
      if (rows.length >= count && rows.at(-1).state !== 'started') {
        assert.equal(rows.at(-1).state, 'completed', JSON.stringify(rows)); return
      }
      if (Date.now() > deadline) throw Error('No completed native Electron download: ' + JSON.stringify(rows))
      await new Promise(done => setTimeout(done, 20))
    }
  }
  await dashboard.getByRole('button', { name: 'Export JSON', exact: true }).click()
  await downloaded(1)
  assert.deepEqual(JSON.parse(await readFile(join(record, 'export.json'), 'utf8')), exported)
  await dashboard.getByRole('button', { name: 'Export Markdown', exact: true }).click()
  await downloaded(2)
  assert.ok(!(await readFile(join(record, 'export.md'), 'utf8')).includes(root))
  assert.deepEqual(await readFile(reportPath), beforeBytes)
  await carrier.evaluate(({ session }) => session.defaultSession.off('will-download', globalThis.__selftestDownloadListener))
  steps.push('real-chromium-json-markdown-downloads-whitelist-and-no-report-write')
  await dashboard.close()
  observation = await observe(main)
  assert.deepEqual(observation, { modelRequests: 0, createdAgents: 0 })
  assert.deepEqual(await request(main, 'read', { id }), report)
  assert.deepEqual(await readFile(reportPath), beforeBytes)
  assert.deepEqual(errors, [])
  steps.push('auxiliary-close-keeps-owned-root-and-committed-report-zero-model-or-agent')
  }
  await writeFile(join(record, 'carrier-observation.json'), JSON.stringify({ versions, native, safePreload, requests, reports }, null, 2) + '\n')
} catch (error) {
  failure = String(error)
  observation = await observeOwner?.().catch(() => undefined) ?? observation
  console.error(error)
  throw error
} finally {
  if (carrier) {
    try {
      await carrier.evaluate(({ app }) => { app.quit() })
      await carrier.close()
      shutdown = 'exited'
    } catch (error) {
      shutdown = String(error)
      failure ??= 'Carrier shutdown failed: ' + shutdown
      const child = carrier.process()
      child.kill()
      if (child.exitCode === null) await new Promise(done => child.once('close', done))
    }
  }
  await writeFile(join(record, 'main.log'), logs.join('').replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
  await cp(join(root, 'host-observations.jsonl'), join(record, 'host-observations.jsonl')).catch(error => { if (error.code !== 'ENOENT') throw error })
  await writeFile(join(record, 'result.json'), JSON.stringify({ root, steps, errors, failure, shutdown,
    modelRequests: observation?.modelRequests ?? null, createdAgents: observation?.createdAgents ?? null,
    paidRequests: failure ? null : 0, installer: 'UNKNOWN', gateway: 'UNKNOWN',
    qualification: failure ? 'FAILED' : providerMode ? 'DEVELOPMENT_RENDERER_SYNTHETIC_PROVIDER_UI' : 'DEVELOPMENT_RENDERER_LOCAL_SELFTEST',
  }, null, 2) + '\n')
}
if (process.connected) process.disconnect()
if (failure) throw Error(failure)
console.log(JSON.stringify({ root, steps, ...observation, paidRequests: 0 }))
