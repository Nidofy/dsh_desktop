/** Real Electron, production Main/preload, built Web and complete isolated Desktop profile. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, cp, writeFile, readFile, readdir, symlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const repo = resolve(import.meta.dirname, '../../../..')
const desktopRequire = createRequire(join(repo, 'apps/desktop/package.json'))
const webRequire = createRequire(join(repo, 'apps/web/package.json'))
const { _electron } = webRequire('playwright')
// The npm entry may download a missing binary; qualification uses only the retained local runtime.
const electron = join(repo, 'apps/desktop/.desktop-build/targets/win-x64/electron/electron.exe')
const evidence = process.argv[2] === undefined ? join(repo, '.build/dispatch/evidence/companion-carrier') : resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, 'carrier-'))
await mkdir(join(root, 'workspace-a'), { recursive: true })
await mkdir(join(root, 'workspace-b'), { recursive: true })
const application = join(root, 'app'), project = join(root, 'project'), profile = join(root, 'data/harness/profiles/desktop')
const primary = join(root, 'runtime/primary-runtime')
for (const dir of [application, project, profile, primary, join(application, 'resources')]) await mkdir(dir, { recursive: true })
const { version } = JSON.parse(await readFile(join(repo, 'apps/desktop/package.json'), 'utf8'))
const { version: pnpmVersion } = JSON.parse(await readFile(join(repo, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8'))
const { DESKTOP_HOST_PROTOCOL_VERSION } = await import(pathToFileURL(join(repo, 'apps/desktop/lib/types/host-protocol.js')).href)
const nodeVersion = execFileSync(electron, ['-p', 'process.versions.node'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8' }).trim()
await cp(join(repo, 'apps/desktop/lib'), join(application, 'lib'), { recursive: true })
await cp(join(repo, 'apps/desktop/renderer'), join(application, 'renderer'), { recursive: true })
await cp(join(repo, 'apps/desktop/resources'), join(application, 'resources'), { recursive: true })
const desktopManifest = JSON.parse(await readFile(join(repo, 'apps/desktop/package.json'), 'utf8'))
for (const name of Object.keys(desktopManifest.dependencies)) {
  const target = join(application, 'node_modules', name)
  await mkdir(resolve(target, '..'), { recursive: true })
  await symlink(await realpath(join(repo, 'apps/desktop/node_modules', name)), target, 'junction')
}
for (const scope of ['@deepseek-ai', '@nidofy']) {
  const installed = join(repo, 'node_modules/.pnpm/node_modules', scope)
  await mkdir(join(project, 'node_modules', scope), { recursive: true })
  for (const name of await readdir(installed)) await symlink(await realpath(join(installed, name)), join(project, 'node_modules', scope, name), 'junction')
}
await mkdir(join(root, 'resources'), { recursive: true })
await cp(join(repo, 'native/nidofy-protection/target/release/nidofy-protection.exe'), join(root, 'resources/nidofy-protection.exe'))
await cp(join(repo, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
await mkdir(join(primary, 'dependencies/node/bin'), { recursive: true })
await cp(process.execPath, join(primary, 'dependencies/node/bin/node.exe'))
await writeFile(join(application, 'package.json'), JSON.stringify({ name: 'companion-carrier-qualification', version, type: 'module', dshDistribution: {
  schemaVersion: 1, kind: 'intranet', revision: 1, productName: 'Nidofy DSH Intranet', protocol: 'nidofy-dsh-intranet', dataDirectory: 'Nidofy DSH Intranet', updates: 'offline',
} }))
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'companion-carrier-runtime', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version, '@deepseek-ai/dsh-desktop-host': version }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
await writeFile(join(project, 'desktop-runtime.json'), JSON.stringify({ schemaVersion: 1, release: { schemaVersion: 1, version, nodeVersion, pnpmVersion, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION }, platform: process.platform, arch: process.arch, files: [], sharedPackages: ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'].map(name => ({ name, version, path: 'node_modules/' + name })) }))
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'companion-carrier-profile', private: true, type: 'module', nidofyBundleEnrollment: 1, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@nidofy/dsh-desktop-bundle'] } } }))
const patch = JSON.parse('[]')
patch.push({ id: 'webserver', config: { host: '127.0.0.1', port: 0 } }, ...['llm-deepseek', 'llm-deepseek-account', 'session-title-llm', 'agent-instructions', 'hmr'].map(id => ({ id, disabled: true })))
patch.push({ insert: [{ id: 'companion-qualification-host', name: pathToFileURL(join(repo, 'apps/desktop/tests/fixtures/companion-host.mjs')).href }] })
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patch))
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name)))
const logs = [], errors = [], steps = []
let secondApplicationProbe
const app = await _electron.launch({ executablePath: electron, args: [join(repo, 'apps/desktop/tests/fixtures/companion-main.mjs')], timeout: 60000,
  env: { ...environment, DSH_COMPANION_QUALIFICATION_ROOT: root, NIDOFY_DESKTOP_DATA_ROOT: join(root, 'data'), USERPROFILE: root, HOME: root, TEMP: root, TMP: root,
    DSH_DESKTOP_DSH_DIR: project, DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primary, DSH_DESKTOP_PNPM_ENTRY: join(repo, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs'), DSH_DESKTOP_OPEN_DEVTOOLS: '0' } })
try {
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)))
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)))
  const context = app.context()
  const settledShot = async (page, name) => {
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))) })
    await page.screenshot({ path: join(root, name) })
  }
  await context.addInitScript(() => {
    const observation = {}
    globalThis.__companionQualification = observation
    Object.defineProperty(globalThis, '__ModuleLoader__', { configurable: true, set(target) {
      Object.defineProperty(globalThis, '__ModuleLoader__', { configurable: true, writable: true, value: target })
      const create = target.create.bind(target)
      target.create = function(options) {
        const prototype = options.staticModules['@deepseek-ai/cordis'].RegistryService.prototype, plugin = prototype.plugin
        prototype.plugin = function(...args) { prototype.plugin = plugin; observation.ctx = this.ctx.root; return plugin.apply(this, args) }
        observation.modules = create(options); return observation.modules
      }
    } })
    if (location.protocol === 'dsh-app:' && location.hostname === 'app') localStorage.setItem('dsh.locale', 'en')
  })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForURL('dsh-app://app/')
  await page.reload()
  await page.waitForFunction(() => globalThis.__companionQualification?.ctx?.get('companion')?.view.getSnapshot().connected, null, { timeout: 60000 })
  const view = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot())
  const id = await page.evaluate(() => window.dshDesktop.windowIdentity())
  assert.equal(view.scope.windowId, id)
  assert.match(view.scope.hostEpoch, /^[a-f0-9-]{36}$/)
  steps.push('production-main-preload-authenticated-companion-bootstrap')
  const streamBaseUrl = await page.evaluate(async () => (await window.dshDesktopBoot.ready()).streamBaseUrl)
  const observeStream = async target => target.evaluate(baseUrl => new Promise(resolve => {
    const socket = new WebSocket(baseUrl.replace('http:', 'ws:') + '/api/remote.mux')
    const timer = setTimeout(() => finish('unobserved'), 10000)
    const finish = value => { clearTimeout(timer); socket.close(); resolve(value) }
    socket.addEventListener('open', () => finish('accepted'), { once: true })
    socket.addEventListener('error', () => finish('refused'), { once: true })
  }), streamBaseUrl)
  const observeApplicationAuthority = target => target.evaluate(async () => {
    const attempt = async action => { try { await action(); return 'accepted' } catch (error) { return String(error) } }
    return { boot: await attempt(() => window.dshDesktopBoot.ready()),
      locale: await attempt(() => window.__DSH_LOCALE__.read()),
      product: await attempt(() => window.dshDesktop.deviceInfo()) }
  })
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'qualification-unowned-frame'; frame.srcdoc = '<p>Isolated child stream probe</p>'; document.body.append(frame) })
  await page.frameLocator('#qualification-unowned-frame').getByText('Isolated child stream probe').waitFor()
  const childFrame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())
  assert.ok(childFrame)
  assert.equal(await observeStream(childFrame), 'refused')
  await page.locator('#qualification-unowned-frame').evaluate(frame => frame.remove())
  steps.push('actual-child-frame-stream-refusal')
  const sessions = await page.evaluate(async paths => {
    const ctx = globalThis.__companionQualification.ctx, ids = []
    for (const path of paths) { const workspace = await ctx.workspaces.create({ path }); ids.push(await ctx.sessions.create({ workspaceId: workspace.workspaceId })) }
    ctx.uiWorkspace.openSession(ids[0]); return ids
  }, [join(root, 'workspace-a'), join(root, 'workspace-b')])
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope.sessionId === id, sessions[0])
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.uiSession.mainBinding.getSnapshot()?.session.getSnapshot().openState === 'open')
  await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; ctx.locale.setLocale('en'); ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).setDraft('未发送草稿与附件') })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1800, 950) })
  await page.locator('.nidofy-dock').waitFor()
  await page.locator('.nidofy-character img').evaluate(async image => { await image.decode() })
  const petChecks = await page.evaluate(async () => {
    const ctx = globalThis.__companionQualification.ctx, call = async (path, input) => {
      const response = await fetch(path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(input) })
      if (!response.ok) throw Error(await response.text()); return response.json()
    }
    await call('/api/companion-qualification', {action:'seed-old-pet'})
    let status = await call('/api/nidofy-extras/status', {})
    await call('/api/nidofy-extras/preferences', {...status.preferences,pets:true})
    const scope = ctx.companion.view.getSnapshot().scope
    const before = await call('/api/nidofy-extras/pet/snapshot',{id:'1'})
    if (before.state.items.some(row=>row.sessionId===scope.sessionId)) throw Error('Old Session must be outside recent pet feed')
    const invoke = (action,input={}) => window.nidofyWorkbench.coordinatePet(scope,{actionId:crypto.randomUUID(),action,target:'1',expiry:Date.now()+10000,...input})
    await invoke('bind')
    const bound = await call('/api/nidofy-extras/pet/snapshot',{id:'1'})
    if (bound.settings.pinned!==scope.sessionId || !bound.state.items.some(row=>row.sessionId===scope.sessionId&&row.source==='snapshot'&&row.reaction===null)) throw Error('Old Session binding was not cold loaded')
    await invoke('mute'); const muted = await call('/api/nidofy-extras/pet/snapshot',{id:'1'})
    if (!muted.settings.quiet) throw Error('Mute did not reach original preference owner')
    await invoke('unmute'); await invoke('interact')
    const snapshot=await call('/api/nidofy-extras/pet/snapshot',{id:'1'}),prefs=(await call('/api/nidofy-extras/status',{})).preferences
    const command={actionId:crypto.randomUUID(),action:'mute',target:'1',sessionId:scope.sessionId,scopeVersion:prefs.revision,generation:snapshot.state.generation,expiry:Date.now()+10000}
    await call('/api/nidofy-extras/pet/coordinate',command)
    const duplicate=await fetch('/api/nidofy-extras/pet/coordinate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})
    if (duplicate.status!==400||(await duplicate.json()).error!=='PET_COMMAND_DUPLICATE')throw Error('Duplicate command was accepted')
    let expired='accepted';try{await invoke('interact',{expiry:Date.now()-1})}catch{expired='refused'}
    if(expired!=='refused')throw Error('Expired native command was accepted')
    let wrongScope='accepted';try{await window.nidofyWorkbench.coordinatePet({...scope,windowId:scope.windowId+1},{actionId:crypto.randomUUID(),action:'bind',target:'1',expiry:Date.now()+10000})}catch{wrongScope='refused'}
    if(wrongScope!=='refused')throw Error('Cross-window pet scope was accepted')
    await invoke('unbind');status=await call('/api/nidofy-extras/status',{});await call('/api/nidofy-extras/preferences',{...status.preferences,pets:false})
    if(!ctx.companion.view.getSnapshot().connected)throw Error('Pet disable broke companion')
    return {oldSession:scope.sessionId,oldLoaded:true,duplicate:'refused',expired,wrongScope,requests:(await call('/api/companion-qualification',{action:'inspect'})).requests}
  })
  assert.equal(petChecks.requests,0)
  await page.evaluate(async () => {
    const status=await(await fetch('/api/nidofy-extras/status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()
    const response=await fetch('/api/nidofy-extras/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...status.preferences,pets:true})})
    if(!response.ok)throw Error(await response.text())
  })
  let petWindow
  for(let index=0;index<100&&!petWindow;index++){
    petWindow=context.pages().find(target=>!target.isClosed()&&target.url().includes('/assets/pet/index.html'))
    if(!petWindow)await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert.ok(petWindow,'Actual pet BrowserWindow must exist')
  await petWindow.waitForURL('dsh-app://app/api/nidofy-extras/assets/pet/index.html?id=1')
  const rootScope = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope)
  const petSender = await petWindow.evaluate(async scope => {
    try { await window.nidofyWorkbench.coordinatePet(scope,{actionId:crypto.randomUUID(),action:'bind',target:'1',expiry:Date.now()+10000});return 'accepted' }
    catch { return 'refused' }
  }, rootScope)
  assert.equal(petSender,'refused')
  await page.evaluate(async () => {
    const status=await(await fetch('/api/nidofy-extras/status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()
    const response=await fetch('/api/nidofy-extras/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...status.preferences,pets:false})})
    if(!response.ok)throw Error(await response.text())
  })
  steps.push('actual-pet-window-refuses-companion-command-sender')
  steps.push('actual-electron-pet-coordination-old-session-expiry-duplicate-cross-window-disable-zero-model-calls')
  const facts = await page.evaluate(async () => {
    const owner = globalThis.__companionQualification.ctx.companion
    return (await owner.refresh(owner.view.getSnapshot().scope)).facts
  })
  assert.equal(facts.sessionId, sessions[0])
  assert.equal(facts.cwd, join(root, 'workspace-a'))
  assert.equal(facts.notebook.availability, 'available')
  assert.equal(facts.notebook.value.scope.generation, facts.generation)
  assert.equal(facts.notices.every(row => row.receipt === null), true)
  steps.push('actual-electron-read-only-physical-facts-no-invented-verification')
  await page.evaluate(async () => {
    const ctx = globalThis.__companionQualification.ctx, sessionId = ctx.companion.view.getSnapshot().scope.sessionId
    const call = async (path, body) => {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw Error(await response.text())
      return response.json()
    }
    await call('/api/companion-qualification', { action: 'seed-search', sessionId })
    const notebook = await call('/api/nidofy-notebook/synchronize', { sessionId })
    const events = await call('/api/nidofy-notebook/events', { sessionId })
    const source = events.findLast(row => row.text.includes('隔离中文连接超时原文'))
    if (!source) throw Error('Missing real original Hint evidence')
    await call('/api/nidofy-notebook/update', { sessionId, delta: { scope: notebook.scope, baseRevision: notebook.revision,
      cursors: { evidenceThrough: source.seq }, operations: [{ action: 'ADD', id: '', kind: 'next',
        text: 'Actual user correction remains active', seq: source.seq, quote: '隔离中文连接超时原文', pinned: true }] } })
  })
  await page.getByRole('button', { name: 'Recent facts', exact: true }).click()
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.some(row => row.kind === 'unfinished'))
  const beforeCorrection = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope)
  await page.locator('.nidofy-notebook-surface > button.nidofy-row').click()
  await page.locator('.nidofy-notebook .nidofy-change-list button').filter({ hasText: 'Actual user correction remains active' }).click()
  console.log('notebook-edit-labels', JSON.stringify(await page.locator('.nidofy-notebook label').allTextContents()))
  // The controlled textarea's default text participates in its wrapping label; match the owned prefix.
  await page.getByLabel(/^(Working note|工作笔记)/).fill('Actual user correction refreshed immediately')
  await page.getByLabel(/^(Category|分类)$/).selectOption('constraint')
  await page.getByRole('button', { name: /^(Save revision|保存版本)$/ }).click()
  await page.waitForFunction(() => { const view = globalThis.__companionQualification.ctx.companion.view.getSnapshot()
    return view.facts?.notebook.value?.active.some(note => note.kind === 'constraint' && note.text === 'Actual user correction refreshed immediately')
      && !view.hints.some(row => row.kind === 'unfinished') })
  assert.deepEqual(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope), beforeCorrection)
  await page.locator('.nidofy-notebook .nidofy-change-list button').filter({ hasText: 'Actual user correction refreshed immediately' }).click()
  await page.getByLabel(/^(Category|分类)$/).selectOption('next')
  await page.getByRole('button', { name: /^(Save revision|保存版本)$/ }).click()
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints
    .some(row => row.kind === 'unfinished' && row.source.text === 'Actual user correction refreshed immediately'))
  await page.locator('.nidofy-notebook-surface > button.nidofy-row').click()
  steps.push('actual-electron-notebook-edit-withdraws-old-hint-and-restores-corrected-source-without-scope-change')
  await settledShot(page, 'hints-en-wide.png')
  await page.evaluate(() => globalThis.__companionQualification.ctx.locale.setLocale('zh'))
  await settledShot(page, 'hints-zh-wide.png')
  await page.evaluate(() => globalThis.__companionQualification.ctx.locale.setLocale('en'))
  const hint = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.find(row => row.kind === 'unfinished'))
  await page.locator('.nidofy-hints article').filter({ hasText: 'Actual user correction refreshed immediately' })
    .getByRole('button', { name: 'Ignore this hint', exact: true }).click()
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hintPreferences?.ignored.includes(id), hint.hintId)
  assert.equal(await page.evaluate(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.some(row => row.hintId === id), hint.hintId), false)
  await page.evaluate(async () => {
    const owner = globalThis.__companionQualification.ctx.companion, scope = owner.view.getSnapshot().scope
    await owner.preferHints(scope, 'reset')
    const hint = owner.view.getSnapshot().hints.find(row => row.kind === 'unfinished')
    await owner.preferHints(scope, 'snooze', hint.hintId, Date.now() + 15 * 60 * 1000)
  })
  assert.equal(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.some(row => row.kind === 'unfinished')), false)
  await page.evaluate(async () => {
    const owner = globalThis.__companionQualification.ctx.companion
    await owner.preferHints(owner.view.getSnapshot().scope, 'reset')
  })
  await page.getByRole('button', { name: 'Mute hints for this project', exact: true }).click()
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hintPreferences?.muted.length === 1)
  assert.equal(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.length), 0)
  await page.reload()
  await page.waitForFunction(() => globalThis.__companionQualification?.ctx?.companion?.view.getSnapshot().connected)
  await page.getByRole('button', { name: 'Recent facts', exact: true }).click()
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().facts !== null)
  assert.equal(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.length), 0)
  await page.getByRole('button', { name: 'Unmute hints for this project', exact: true }).click()
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().hints.some(row => row.kind === 'unfinished'))
  await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[1])
  await page.waitForFunction(() => { const view = globalThis.__companionQualification.ctx.companion.view.getSnapshot()
    return view.returnCard !== null && view.returnCard.hints.every(row => view.hintPreferences.offered.includes(row.hintId)) })
  await settledShot(page, 'return-card-en-wide.png')
  await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[0])
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().facts?.sessionId === id, sessions[0])
  await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[1])
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().facts?.sessionId === id, sessions[1])
  assert.equal(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().returnCard), null)
  await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[0])
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().facts?.sessionId === id, sessions[0])
  await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx
    ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).setDraft('未发送草稿与附件') })
  steps.push('actual-electron-hint-ignore-snooze-exact-project-mute-reload-restore-and-return-dedup-zero-model-calls')
  await settledShot(page, 'en-wide.png')
  const composer = page.locator('[data-composer-input][contenteditable="true"]')
  await composer.click()
  await composer.press('ArrowLeft')
  await page.locator('input[type="file"]').evaluate(input => { const transfer = new DataTransfer(); const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='), character => character.charCodeAt(0)); transfer.items.add(new File([bytes], 'synthetic.png', { type: 'image/png' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot().attachmentIds.length === 1 })
  const caretBefore = await composer.evaluate(() => { const selection = getSelection(); return { anchor: selection.anchorNode?.textContent, anchorOffset: selection.anchorOffset, focus: selection.focusNode?.textContent, focusOffset: selection.focusOffset } })
  const draftBefore = await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot() })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(820, 850) })
  const trigger = page.getByRole('button', { name: 'Open companion', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  assert.equal(await dialog.count(), 1)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await trigger.evaluate(button => button === document.activeElement), true)
  const draftAfter = await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot() })
  assert.deepEqual(draftAfter, draftBefore)
  const caretAfter = await composer.evaluate(() => { const selection = getSelection(); return { anchor: selection.anchorNode?.textContent, anchorOffset: selection.anchorOffset, focus: selection.focusNode?.textContent, focusOffset: selection.focusOffset } })
  assert.deepEqual(caretAfter, caretBefore)
  steps.push('native-narrow-modal-composition-escape-focus-draft-attachment-caret-retention')
  await trigger.click()
  await page.evaluate(() => globalThis.__companionQualification.ctx.locale.setLocale('zh'))
  await page.getByRole('button', { name: '关闭小鲸', exact: true }).waitFor()
  await settledShot(page, 'zh-narrow.png')
  const layout = await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); const front = document.elementFromPoint(rect.left + 20, rect.top + 30); return { fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, foreground: element.contains(front), color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, dpi: devicePixelRatio } })
  assert.equal(layout.fits, true); assert.equal(layout.foreground, true)
  await page.evaluate(() => globalThis.__companionQualification.ctx.theme.setTheme('dark'))
  await settledShot(page, 'zh-narrow-dark.png')
  const dark = await dialog.evaluate(element => getComputedStyle(element).backgroundColor)
  assert.notEqual(dark, layout.background)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await settledShot(page, 'zh-narrow-dark-zoom.png')
  assert.equal(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await page.evaluate(() => globalThis.__companionQualification.ctx.theme.setTheme('light'))
  steps.push('native-bilingual-light-dark-host-dpi-and-zoom-fitting')
  await page.keyboard.press('Escape')
  const stale = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope)
  await page.evaluate(ids => { const ctx = globalThis.__companionQualification.ctx; for (let i = 0; i < 15; i++) ctx.uiWorkspace.openSession(ids[i % 2]); ctx.uiWorkspace.openSession(ids[1]) }, sessions)
  const refused = await page.evaluate(async scope => { try { await globalThis.__companionQualification.ctx.companion.open(scope, 'builds'); return false } catch { return true } }, stale)
  assert.equal(refused, true)
  await page.waitForFunction(id => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope.sessionId === id, sessions[1])
  steps.push('native-rapid-session-switch-refuses-stale-full-scope')
  await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; ctx.companion.follow(ctx.companion.view.getSnapshot().scope) })
  await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[0])
  assert.equal(await page.evaluate(id => globalThis.__companionQualification.ctx.companion.attention.getSnapshot().scope.sessionId === id, sessions[1]), true)
  await page.evaluate(() => globalThis.__companionQualification.ctx.companion.releaseAttention())
  await page.evaluate(() => globalThis.__companionQualification.ctx.get('connection').reconnect())
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().connected)
  steps.push('native-attention-reference-and-real-websocket-reconnect')
  for (const enabled of [false, true]) {
    const result = await page.evaluate(async enabled => { const response = await fetch('/api/companion-qualification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'notebook', enabled }) }); if (!response.ok) throw Error(await response.text()); return response.json() }, enabled)
    assert.equal(result.notebook, enabled)
    await page.waitForFunction(enabled => globalThis.__companionQualification.ctx.companion.view.getSnapshot().notebook === (enabled ? 'available' : 'disabled'), enabled)
    assert.equal(await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().connected), true)
    assert.equal(result.requests, 0)
  }
  steps.push('actual-host-client-notebook-hot-disable-enable-zero-model-requests')
  const control = action => page.evaluate(async action => { const response = await fetch('/api/companion-qualification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }); if (!response.ok) throw Error(await response.text()); return response.json() }, action)
  await app.evaluate(({ app }) => { globalThis.__qualificationTargets = []; app.on('browser-window-created', (_event, window) => { globalThis.__qualificationTargets.push(window) }) })
  for (const mode of ['switch', 'reconnect']) {
  await page.waitForFunction(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.uiSession.mainBinding.getSnapshot()?.session.getSnapshot().openState === 'open' && ctx.companion.view.getSnapshot().scope.sessionId !== null })
  await control('hold')
  await app.evaluate(() => { globalThis.__qualificationTargets = [] })
  await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; globalThis.__qualificationNavigation = ctx.companion.open(ctx.companion.view.getSnapshot().scope, 'builds').then(() => 'opened', () => 'cancelled') })
  for (let attempt = 0; ; attempt++) { if ((await control('inspect')).entered) break; if (attempt >= 100) throw Error('Slow native target did not enter actual Host request'); await new Promise(done => setTimeout(done, 20)) }
  assert.deepEqual(await app.evaluate(() => globalThis.__qualificationTargets.map(window => ({ visible: window.isVisible(), destroyed: window.isDestroyed() }))), [{ visible: false, destroyed: false }])
  if (mode === 'switch') await page.evaluate(id => globalThis.__companionQualification.ctx.uiWorkspace.openSession(id), sessions[1])
  else await page.evaluate(() => globalThis.__companionQualification.ctx.get('connection').reconnect())
  assert.equal(await page.evaluate(() => globalThis.__qualificationNavigation), 'cancelled')
  assert.equal(await app.evaluate(() => globalThis.__qualificationTargets.every(window => window.isDestroyed())), true)
  await control('release')
  await page.waitForFunction(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().connected)
  steps.push('actual-scoped-ipc-cancels-destroys-hidden-target-on-' + mode)
  }
  await page.waitForFunction(() => {
    const ctx = globalThis.__companionQualification.ctx, binding = ctx.uiSession.mainBinding.getSnapshot()
    const scope = ctx.companion.view.getSnapshot().scope
    return binding?.session.getSnapshot().openState === 'open' && ctx.workspaces.list.getSnapshot().phase === 'ready'
      && scope.workspaceId !== null && scope.sessionId === binding.sessionId
  })
  const extraWindow = app.waitForEvent('window')
  await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.companion.open(ctx.companion.view.getSnapshot().scope, 'builds') })
  const second = await extraWindow
  second.on('pageerror', error => errors.push(error.message))
  await second.waitForURL('dsh-app://app/api/nidofy/workbench/ui**')
  const secondId = await second.evaluate(() => window.dshDesktop.windowIdentity())
  const firstScope = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope)
  assert.notEqual(firstScope.windowId, secondId)
  const crossWindowRefused = await second.evaluate(async scope => { try { await window.nidofyWorkbench.openPanel('builds', undefined, scope); return false } catch { return true } }, firstScope)
  assert.equal(crossWindowRefused, true)
  const auxiliaryAuthority = await observeApplicationAuthority(second)
  assert.match(auxiliaryAuthority.boot, /DESKTOP_APPLICATION_DOCUMENT_REFUSED/)
  assert.match(auxiliaryAuthority.locale, /DESKTOP_APPLICATION_DOCUMENT_REFUSED/)
  assert.notEqual(auxiliaryAuthority.product, 'accepted')
  assert.equal(await observeStream(second), 'refused')
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.id === id).destroy(), secondId)
  steps.push('actual-app-workbench-dual-window-native-identity-and-cross-sender-refusal')
  await page.waitForFunction(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.uiSession.mainBinding.getSnapshot()?.session.getSnapshot().openState === 'open' && ctx.companion.view.getSnapshot().scope.sessionId !== null })
  const original = '引用前的未发送草稿'
  await page.evaluate(async original => {
    const ctx = globalThis.__companionQualification.ctx, scope = ctx.companion.view.getSnapshot().scope
    ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).setDraft(original)
    const response = await fetch('/api/companion-qualification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'seed-search', sessionId: scope.sessionId }) })
    if (!response.ok) throw Error(await response.text())
  }, original)
  await page.getByRole('button', { name: '打开小鲸', exact: true }).click()
  await page.getByRole('button', { name: '工作笔记与历史', exact: true }).click()
  await page.getByLabel('检索历史', { exact: true }).fill('连接')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: /隔离中文连接超时原文/ }).click()
  assert.equal(await page.evaluate(() => { const ctx = globalThis.__companionQualification.ctx; return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot().draft }), original)
  await page.getByRole('button', { name: '将引用插入草稿', exact: true }).click()
  await page.waitForFunction(original => { const ctx = globalThis.__companionQualification.ctx; return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot().draft.startsWith(original + '\n\n历史引用：') }, original)
  assert.equal((await control('inspect')).requests, 0)
  await settledShot(page, 'zh-history-reference.png')
  steps.push('actual-electron-chinese-source-preview-explicit-draft-reference-zero-model-calls')
  const historyProject = await page.evaluate(async () => {
    const sessionId = globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope.sessionId
    const response = await fetch('/api/companion-qualification', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'seed-project-search', sessionId }) })
    if (!response.ok) throw Error(await response.text())
    return (await response.json()).historyProject
  })
  await page.getByRole('button', { name: '选择项目工作区', exact: true }).click()
  await page.getByLabel(historyProject.linked.title + ' · ' + historyProject.linked.path, { exact: true }).check()
  await page.getByRole('button', { name: '保存项目关联', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '移除项目关联' && !button.disabled))
  await page.getByLabel(historyProject.linked.title + ' · ' + historyProject.linked.path, { exact: true }).scrollIntoViewIfNeeded()
  await settledShot(page, 'zh-history-project-selection.png')
  await page.getByLabel('检索范围', { exact: true }).selectOption('project')
  await page.getByLabel('检索历史', { exact: true }).fill('连接超时')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: /显式关联工作树的连接超时原文/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: /未关联工作树不得泄漏/ }).count(), 0)
  await page.getByRole('button', { name: /显式关联工作树的连接超时原文/ }).click()
  await page.getByRole('button', { name: '将引用插入草稿', exact: true }).click()
  await page.waitForFunction(() => {
    const ctx = globalThis.__companionQualification.ctx
    return ctx.conversation.input.for(ctx.uiSession.mainBinding.getSnapshot().ctx).state.getSnapshot().draft.includes('显式关联工作树的连接超时原文')
  })
  await settledShot(page, 'zh-explicit-history-project.png')
  await page.getByRole('button', { name: '移除项目关联', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '移除项目关联' && button.disabled))
  assert.equal((await control('inspect')).requests, 0)
  steps.push('actual-electron-explicit-workspace-project-search-reference-unlinked-refusal-and-removal-zero-model-calls')
  {
    const created = app.waitForEvent('window'), failures = []
    await app.evaluate(({ BrowserWindow }, preload) => { const window = new BrowserWindow({ show: false, width: 820, height: 850, webPreferences: { preload, sandbox: true, nodeIntegration: false, contextIsolation: true } }); void window.loadURL('dsh-app://app/') }, join(application, 'lib/preload-app.cjs'))
    const rootPage = await created
    rootPage.on('pageerror', error => failures.push(error.message))
    await rootPage.waitForURL('dsh-app://app/')
    const nativeId = await rootPage.evaluate(() => window.dshDesktop.windowIdentity())
    const beforeReload = await observeApplicationAuthority(rootPage)
    const stream = await observeStream(rootPage)
    await rootPage.reload()
    const afterReload = await observeApplicationAuthority(rootPage)
    secondApplicationProbe = { actualWindowId: nativeId, beforeReload, afterReload, stream, pageErrors: failures,
      qualification: 'REFUSED_UNOWNED_CONVERSATION_ROOT' }
    for (const authority of [beforeReload, afterReload]) {
      assert.match(authority.boot, /DESKTOP_APPLICATION_DOCUMENT_REFUSED/)
      assert.match(authority.locale, /DESKTOP_APPLICATION_DOCUMENT_REFUSED/)
      assert.notEqual(authority.product, 'accepted')
    }
    assert.equal(stream, 'refused')
    assert.equal(await observeStream(rootPage), 'refused')
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.id === id).destroy(), nativeId)
    steps.push('actual-unowned-complete-root-refused-before-after-reload-and-destroyed')
  }
  const beforeReloadScope = await page.evaluate(() => globalThis.__companionQualification.ctx.companion.view.getSnapshot().scope)
  await page.reload()
  await page.waitForFunction(() => globalThis.__companionQualification?.ctx?.get('companion')?.view.getSnapshot().connected, null, { timeout: 60000 })
  assert.equal(await page.evaluate(() => window.dshDesktop.windowIdentity()), id)
  assert.equal(await page.evaluate(async scope => { try { await window.nidofyWorkbench.openPanel('builds', undefined, scope); return false } catch { return true } }, beforeReloadScope), true)
  assert.equal(await observeStream(page), 'accepted')
  steps.push('actual-owned-root-reload-rejects-old-scope-and-restores-stream')
  console.log(JSON.stringify({ root, view, sessions, errors, steps }))
  assert.deepEqual(errors, [])
} finally {
  await writeFile(join(root, 'main.log'), logs.join('').replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
  await writeFile(join(root, 'result.json'), JSON.stringify({ errors, steps, secondApplicationProbe }, null, 2) + '\n')
  await app.evaluate(({ Menu }) => { const menu = Menu.getApplicationMenu(); const exit = menu?.items.flatMap(item => item.submenu?.items ?? []).find(item => item.role === 'quit'); if (exit?.click) exit.click(); else throw Error('No application quit entry') }).catch(() => {})
  await app.close()
}
