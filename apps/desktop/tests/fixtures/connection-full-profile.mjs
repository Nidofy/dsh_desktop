/** Qualify the current built Host entry, complete profile, Office registration and real Agent with synthetic keys. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'
import { load, dump } from 'js-yaml'

const repo = resolve(import.meta.dirname, '../../../..')
const evidence = resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'nidofy-full-profile-'))
await writeFile(join(evidence, 'fixture-root.json'), JSON.stringify({ root, evidence, isolated: true }) + '\n')
const project = join(root, 'project'), home = join(root, 'home'), source = join(root, 'runtime', 'primary-runtime')
const observations = []
const providerCalls = []
const proxyCalls = []
const tlsErrors = []
const children = new Set()
let heldRequest
let cancelled = false
process.on('message', message => {
  if (message?.type !== 'cancel') return
  cancelled = true; heldRequest?.release.resolve()
  for (const child of children) child.kill()
  provider.closeAllConnections()
  for (const stream of tunnels) stream.destroy()
})
const providerResponse = async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  assert.equal(body.model, 'local-model')
  assert.match(request.headers.authorization, /^Bearer synthetic-/)
  providerCalls.push({ model: body.model, stream: body.stream, tls: request.socket.encrypted === true })
  if (heldRequest !== undefined) { heldRequest.entered.resolve(); await heldRequest.release.promise }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const delta of [{ role: 'assistant', content: '' }, { content: 'Local provider completed.' }]) {
    response.write('data: ' + JSON.stringify({ id: 'local-completion', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
  }
  response.end('data: ' + JSON.stringify({ id: 'local-completion', object: 'chat.completion.chunk', model: body.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n')
}
const provider = createServer(providerResponse)
// Test-only certificate/key. Trust is scoped to a child launch; no system certificate store changes.
const tlsProvider = createHttpsServer({ key: await readFile(join(import.meta.dirname, 'connection-test-server.key')),
  cert: await readFile(join(import.meta.dirname, 'connection-test-server.pem')) }, providerResponse)
tlsProvider.on('tlsClientError', error => tlsErrors.push(error.code ?? error.name))
const proxy = createServer((request, response) => {
  const url = new URL(request.url)
  assert.equal(url.hostname, 'model.connection.invalid')
  proxyCalls.push(url.host)
  const upstream = httpRequest({ hostname: '127.0.0.1', port: provider.address().port, path: url.pathname,
    method: request.method, headers: request.headers }, result => {
    response.writeHead(result.statusCode, result.headers); result.pipe(response)
  })
  upstream.on('error', error => response.destroy(error)); request.pipe(upstream)
})
const tunnels = new Set()
proxy.on('connect', (request, socket, head) => {
  assert.equal(request.url, 'model.connection.invalid:80')
  proxyCalls.push(request.url)
  const upstream = connect(provider.address().port, '127.0.0.1', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  for (const stream of [socket, upstream]) {
    tunnels.add(stream); stream.once('close', () => tunnels.delete(stream)); stream.on('error', () => { socket.destroy(); upstream.destroy() })
  }
})
const projections = []
try {
provider.listen(0, '127.0.0.1'); await once(provider, 'listening')
tlsProvider.listen(0, '127.0.0.1'); await once(tlsProvider, 'listening')
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
const providerUrl = 'http://127.0.0.1:' + provider.address().port + '/v1'
await mkdir(project, { recursive: true }); await mkdir(home, { recursive: true })
for (const scope of ['@deepseek-ai', '@nidofy']) {
  const installed = join(repo, 'node_modules/.pnpm/node_modules', scope), target = join(project, 'node_modules', scope)
  await mkdir(target, { recursive: true })
  for (const name of await readdir(installed)) {
    const projection = join(target, name)
    await symlink(await realpath(join(installed, name)), projection, process.platform === 'win32' ? 'junction' : 'dir')
    projections.push(projection)
  }
}
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'desktop-connection-qualification', private: true, type: 'module',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@nidofy/dsh-desktop-bundle'] } } }))
await cp(join(repo, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
await mkdir(join(source, 'dependencies/node/bin'), { recursive: true })
await cp(process.execPath, join(source, 'dependencies/node/bin', process.platform === 'win32' ? 'node.exe' : 'node'))
const patch = join(root, 'distribution.patch.json')
const patches = [
  { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
  ...['llm-deepseek', 'llm-deepseek-account', 'session-title-llm', 'session-telemetry-otel', 'desktop-product-telemetry',
    'product-analytics', 'agent-instructions'].map(id => ({ id, disabled: true })),
  { id: 'agent-preset-registry', config: { default: 'minimal' } },
  { insert: [{ id: 'connection-qualification', name: pathToFileURL(join(import.meta.dirname, 'connection-profile-probe.mjs')).href }] },
]
await writeFile(patch, JSON.stringify(patches))

function launch(extraEnv = {}) {
  if (cancelled) throw Error('Qualification cancelled')
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name)))
  const child = spawn(process.execPath, [join(repo, 'apps/desktop-host/lib/index.js'), project, project, source], {
    cwd: project, env: { ...env, DSH_HOME: home, USERPROFILE: root, HOME: root, TEMP: root, TMP: root, TMPDIR: root,
      DSH_DESKTOP_DISTRIBUTION_PATCH: patch,
      DSH_DESKTOP_DISTRIBUTION_KIND: 'personal',
      DSH_DESKTOP_PROTECTION_HELPER: join(repo, 'native/nidofy-protection/target/release/nidofy-protection.exe'),
      ...extraEnv,
    }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  })
  children.add(child)
  const messages = [], output = []
  const logs = join(evidence, 'host-' + String(child.pid) + '.log')
  child.stdout.on('data', chunk => output.push(String(chunk))); child.stderr.on('data', chunk => output.push(String(chunk)))
  const completed = new Promise((done, reject) => { child.once('error', reject); child.once('close', async (code, signal) => {
    await writeFile(logs, output.join('').replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]')); done({ code, signal })
  }) })
  child.completion = completed
  child.on('message', message => messages.push(message))
  const until = async predicate => {
    const deadline = Date.now() + 45000
    while (!predicate()) {
      if (child.exitCode !== null) throw Error('Host exited before expected IPC: ' + output.join(''))
      if (Date.now() > deadline) throw Error('Host IPC timed out: ' + output.join(''))
      await new Promise(done => setTimeout(done, 10))
    }
  }
  const startup = (async () => { await until(() => messages.some(row => ['ready', 'fatal'].includes(row.type))); return messages.find(row => ['ready', 'fatal'].includes(row.type)) })()
  return { child, messages, completed, startup, until, output,
    async stop() {
      if (child.connected) child.send({ type: 'shutdown' })
      const deadline = setTimeout(() => child.kill(), 45000)
      let result
      try { result = await completed } finally { clearTimeout(deadline) }
      assert.deepEqual(result, { code: 0, signal: null })
      assert.ok(messages.some(row => row.type === 'shutdown-complete'))
      children.delete(child)
    },
  }
}

async function authenticated(host) {
  const ready = await host.startup; assert.equal(ready.type, 'ready', ready.diagnostic ?? host.output.join(''))
  assert.ok(Array.isArray(ready.injections))
  const base = new URL(ready.url).origin
  const exchange = await fetch(ready.url, { redirect: 'manual' }); assert.equal(exchange.status, 303)
  const cookie = exchange.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie)
  const post = (method, input = {}) => fetch(base + '/api/nidofy/' + method, { method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(input) })
  const probe = async input => {
    const response = await fetch(base + '/api/connection-qualification', { method: 'POST', signal: AbortSignal.timeout(45000),
      headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(input) })
    assert.equal(response.status, 200, await response.clone().text()); return response.json()
  }
  return { base, cookie, post, probe }
}

async function removeRef(revision) {
  const path = join(home, '.credentials.yaml'), doc = load(await readFile(path, 'utf8'))
  const ref = 'NIDOFY_REV_' + revision.replaceAll('-', '_')
  assert.ok(Object.hasOwn(doc.refs, ref)); delete doc.refs[ref]
  await writeFile(path, dump(doc), { mode: 0o600 })
}

  let host = launch(), api = await authenticated(host)
  const facts = await api.probe({ action: 'facts' })
  assert.deepEqual(facts.skills, ['office-docx', 'office-pptx', 'office-xlsx'])
  assert.ok(facts.tools.includes('load_workspace_dependencies'))
  assert.equal(facts.queryPath, ':memory:')
  assert.equal((await fetch(api.base + '/')).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/ui')).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/companion', { method: 'POST', body: '{"action":"bootstrap"}' })).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/companion', { method: 'POST', headers: { cookie: api.cookie,
    origin: 'https://rejected.invalid' }, body: '{"action":"bootstrap"}' })).status, 403)
  const initialCompanion = await (await api.post('companion', { action: 'bootstrap' })).json()
  assert.match(initialCompanion.hostEpoch, /^[a-f0-9-]{36}$/)
  assert.equal(initialCompanion.notebook, 'available')
  assert.equal((await fetch(api.base + '/api/nidofy/status', { method: 'POST', headers: { cookie: api.cookie,
    origin: 'https://rejected.invalid' }, body: '{}' })).status, 403)
  assert.equal((await fetch(api.base + '/api/nidofy/deployment', { method: 'POST', body: '{"action":"status"}' })).status, 401)
  const managedFile = join(home, 'desktop-artifacts.json'), managedText = '{"version":1,"items":[]}'
  await writeFile(managedFile, managedText)
  const measured = await (await api.post('storage', { action: 'status' })).json()
  assert.equal(measured.scan, 'complete'); assert.equal(measured.measuredBytes, Buffer.byteLength(managedText))
  assert.equal(measured.admission, 'not-connected')
  const unknown = join(home, 'unknown-preserved.bin')
  await writeFile(unknown, 'unknown bytes retained')
  const incomplete = await (await api.post('storage', { action: 'status' })).json()
  assert.equal(incomplete.scan, 'incomplete'); assert.equal(incomplete.measuredBytes, null)
  assert.equal(await readFile(unknown, 'utf8'), 'unknown bytes retained'); await unlink(unknown)
  observations.push('storage-authenticated-readonly-incomplete-accounting')
  assert.equal((await fetch(api.base + '/api/nidofy/storage/ui')).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/quota', { method: 'POST', headers: { cookie: api.cookie,
    origin: 'https://rejected.invalid' }, body: '{"action":"status"}' })).status, 403)
  const quotaStatus = await (await api.post('quota', { action: 'status' })).json()
  assert.equal(quotaStatus.scan, 'not-run'); assert.equal(quotaStatus.measuredBytes, null)
  assert.equal((await (await api.post('quota', { action: 'inspect', operationId: 'unknown-operation-000001' })).json()).status, 'unknown')
  assert.equal((await (await api.post('quota', { action: 'recover' })).json()).drained, true)
  assert.equal((await api.post('quota', { action: 'reserve', maxWriteBytes: 1 })).status, 400)
  for (const chinese of [false, true]) {
    const page = await fetch(api.base + '/api/nidofy/storage/ui' + (chinese ? '?locale=zh-CN' : ''), { headers: { cookie: api.cookie } })
    const html = await page.text(), dom = new JSDOM(html), script = html.match(/<script>([\s\S]*)<\/script>/)[1]
    const document = dom.window.document
    new Script(script).runInNewContext({ document, fetch: (url, init) => fetch(new URL(url, api.base), {
      ...init, headers: { ...init.headers, cookie: api.cookie, origin: api.base } }) })
    const deadline = Date.now() + 10000
    while (document.getElementById('configure').disabled) { assert.ok(Date.now() < deadline); await new Promise(done => setTimeout(done, 10)) }
    assert.equal(document.getElementById('measuredBytes').textContent, chinese ? '未知' : 'Unknown')
    assert.equal(document.getElementById('recover').disabled, true)
    document.getElementById('cleanupPreview').click()
    while (document.getElementById('refresh').disabled) { assert.ok(Date.now() < deadline); await new Promise(done => setTimeout(done, 10)) }
    assert.equal(document.querySelectorAll('#cleanupItems input').length, 0)
    dom.window.close()
  }
  observations.push('authenticated-quota-status-explicit-recovery-bilingual-management')
  observations.push('complete-profile-office-ready-auth')
  const profile = { api: 'openai-completions', baseURL: providerUrl, models: [{ id: 'local-model', contextWindow: 32000, maxTokens: 1024 }] }
  const save = async (connection, expectedRevision, credential) => {
    const response = await api.post('mutate', { action: 'save', operationId: crypto.randomUUID(), connection, expectedRevision, profile, credential })
    assert.equal(response.status, 200, await response.clone().text())
  }
  await save('missing', 0, { mode: 'replace', value: 'synthetic-missing' })
  await save('valid', 1, { mode: 'replace', value: 'synthetic-valid' })
  const state = await (await api.post('status')).json()
  await host.stop(); await assert.rejects(fetch(api.base + '/api/nidofy/ui'))
  await removeRef(state.connections.find(row => row.connection === 'missing').revision)
  host = launch(); api = await authenticated(host)
  const restarted = await (await api.post('status')).json()
  const companion = await (await api.post('companion', { action: 'bootstrap' })).json()
  assert.notEqual(companion.hostEpoch, initialCompanion.hostEpoch)
  assert.equal(restarted.connections.find(row => row.connection === 'missing').availability, 'missing-credential')
  assert.equal(restarted.connections.find(row => row.connection === 'valid').availability, 'available')
  await writeFile(join(project, 'quota-protected.txt'), 'isolated protected input')
  const armed = await api.post('protection', { action: 'arm', workspace: project, paths: ['quota-protected.txt'], revision: 0 })
  assert.equal(armed.status, 200, await armed.clone().text())
  const missing = await api.probe({ sessionId: 'connection-keyless-recorded', provider: 'nidofy-missing' })
  const valid = await api.probe({ sessionId: 'connection-local-recorded', provider: 'nidofy-valid' })
  await writeFile(join(evidence, 'keyless-session.json'), JSON.stringify(missing, null, 2) + '\n')
  await writeFile(join(evidence, 'local-session.json'), JSON.stringify(valid, null, 2) + '\n')
  assert.equal(providerCalls.length, 1)
  assert.deepEqual(missing.events.at(-1).data.reason, { kind: 'error', error: { message: 'CONNECTION_MISSING_CREDENTIAL', code: 'UNKNOWN' } })
  assert.deepEqual(valid.events.at(-1).data.reason, { kind: 'completed' })
  assert.ok(JSON.stringify(valid).includes('Local provider completed.'))
  assert.ok(!JSON.stringify({ state, restarted, missing, valid }).includes('synthetic-'))
  observations.push('keyless-restart-real-agent-recording-valid-route')
  assert.equal((await api.post('workbench/notifications/attach')).status, 200)
  const terminalNotices = await (await api.post('workbench/notifications')).json()
  assert.deepEqual(terminalNotices.unavailable, [])
  const completedNotice = terminalNotices.notices.find(row => row.sourceType === 'session' && row.scope.sessionId === 'connection-local-recorded')
  const failedNotice = terminalNotices.notices.find(row => row.sourceType === 'session' && row.scope.sessionId === 'connection-keyless-recorded')
  assert.equal(completedNotice.kind, 'completed'); assert.equal(failedNotice.kind, 'failed')
  assert.equal(completedNotice.sessionSource.seq, valid.events.at(-1).seq)
  assert.equal(typeof completedNotice.sessionSource.generation, 'string')
  const providerCount = providerCalls.length
  const scopedNotices = await (await api.post('workbench/companion/notices', { sessionId: 'connection-local-recorded' })).json()
  assert.ok(scopedNotices.some(row => row.id === completedNotice.id))
  assert.ok(!scopedNotices.some(row => row.id === failedNotice.id))
  assert.ok(scopedNotices.length <= 16)
  const notebook = await (await api.post('workbench/companion/notebook', { sessionId: 'connection-local-recorded' })).json()
  assert.equal(notebook.availability, 'available')
  assert.equal(providerCalls.length, providerCount)
  assert.deepEqual(await (await api.post('workbench/notifications')).json(), terminalNotices)
  await writeFile(join(evidence, 'companion-facts.json'), JSON.stringify({ initialCompanion, companion, scopedNotices,
    notebookAvailable: notebook.availability, extraModelRequests: providerCalls.length - providerCount }, null, 2)+'\n')
  observations.push('authenticated-companion-actual-host-epoch-scoped-facts-no-notice-mutation-or-model-call')
  assert.match(completedNotice.sourceId, /^[a-f0-9]{64}$/)
  assert.equal(completedNotice.delivery.system, 'suppressed')
  assert.equal((await api.post('workbench/verification/inspect', { workspace: project, id: completedNotice.sourceId })).status, 400)
  await writeFile(join(evidence, 'session-terminal-notices.json'), JSON.stringify(terminalNotices, null, 2)+'\n')
  observations.push('raw-durable-session-terminal-generation-reference-no-test-receipt')
  const search = await api.probe({ action: 'search', query: 'Local' })
  assert.ok(search.items.some(row => row.header.id === 'connection-local-recorded'))
  // Execute through the actual authenticated Workbench/Shell/protection composition.
  const testPath = join(project, 'execution-evidence.test.mjs')
  await writeFile(testPath, "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('isolated', () => assert.equal(1,1));")
  const quoted = value => "'" + value.replaceAll("'", "''") + "'"
  const testCommand = '& ' + quoted(process.execPath) + ' --test --test-isolation=none --test-reporter=tap ' + quoted(testPath)
  const actionConfig = { schemaVersion: 1, actions: [{ id: 'local-evidence', label: 'Local evidence', command: testCommand, timeoutMs: 10000, verification: { schemaVersion: 1, intent: 'Run isolated Node test', parser: 'node-tap-13/1', coverage: 'unknown', sources: ['execution-evidence.test.mjs'], inputs: [], toolchain: [process.execPath], parameters: {} } }] }
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/actions/evidence', { method: 'POST', body: '{}' })).status, 401)
  const savedActionsResponse = await api.post('workbench/actions/save', { workspace: project, config: actionConfig })
  assert.equal(savedActionsResponse.status, 200, await savedActionsResponse.clone().text())
  const savedActions = await savedActionsResponse.json()
  assert.equal((await api.post('workbench/actions/trust', { workspace: project, fingerprint: savedActions.fingerprint })).status, 200)
  assert.equal((await api.post('workbench/notifications/configure', { expectedRevision: 0, enabled: true })).status, 200)
  assert.equal((await api.post('workbench/notifications/attach')).status, 200)
  const startedActionResponse = await api.post('workbench/actions/start', { workspace: project, id: 'local-evidence' })
  assert.equal(startedActionResponse.status, 200, await startedActionResponse.clone().text())
  const startedAction = await startedActionResponse.json(), actionDeadline = Date.now() + 20000
  let completedAction
  do {
    const actionView = await (await api.post('workbench/actions/inspect', { workspace: project })).json()
    completedAction = actionView.runs.find(row => row.id === startedAction.id)
    assert.ok(Date.now() < actionDeadline, JSON.stringify(completedAction))
    if (['QUEUED','RUNNING'].includes(completedAction.status)) await new Promise(done => setTimeout(done, 10))
  } while (['QUEUED','RUNNING'].includes(completedAction.status))
  if (completedAction.execution.outcome !== 'SUCCEEDED') {
    const readiness = await api.probe({ action: 'shell-readiness' })
    await writeFile(join(evidence, 'shell-readiness.json'), JSON.stringify(readiness, null, 2))
    assert.fail(JSON.stringify({ completedAction, readiness }))
  }
  const actionEvidenceResponse = await api.post('workbench/actions/evidence', { workspace: project, id: startedAction.id, parser: 'node-tap-13/1' })
  assert.equal(actionEvidenceResponse.status, 200, await actionEvidenceResponse.clone().text())
  const retainedEvidence = await actionEvidenceResponse.json()
  assert.equal(retainedEvidence.log.complete, true)
  assert.equal(retainedEvidence.log.tests.passed, 1)
  assert.equal(retainedEvidence.freshness, 'UNKNOWN'); assert.equal(retainedEvidence.receipt, null)
  assert.equal((await api.post('workbench/actions/evidence', { workspace: project, id: startedAction.id, parser: 'model-claim' })).status, 400)
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/verification/inspect', { method: 'POST', body: '{}' })).status, 401)
  let receiptView
  do {
    const response = await api.post('workbench/verification/inspect', { workspace: project, id: startedAction.id })
    assert.equal(response.status, 200, await response.clone().text()); receiptView = await response.json()
    assert.ok(Date.now() < actionDeadline, JSON.stringify(receiptView))
    if (receiptView.phase !== 'COMMITTED') await new Promise(done => setTimeout(done, 10))
  } while (receiptView.phase !== 'COMMITTED')
  assert.equal(receiptView.receipt.tests, 'PASSED'); assert.equal(receiptView.receipt.coverage, 'unknown')
  assert.equal(receiptView.receipt.freshness, 'UNKNOWN'); assert.equal(receiptView.receipt.acceptance, 'PENDING')
  assert.equal(receiptView.receipt.configRevision, savedActions.configRevision)
  const noticesDeadline = Date.now() + 10000
  let newNotices
  do {
    newNotices = await (await api.post('workbench/notifications/poll')).json()
    assert.ok(Date.now() < noticesDeadline)
    if (!newNotices.notices.length) await new Promise(done => setTimeout(done, 10))
  } while (!newNotices.notices.length)
  assert.equal(newNotices.notices.length, 1); const notice = newNotices.notices[0]
  assert.equal(notice.sourceId, startedAction.id); assert.equal(notice.kind, 'awaiting-acceptance')
  const claimed = await (await api.post('workbench/notifications/claim', { id: notice.id, prefsRevision: 1 })).json()
  assert.equal(claimed.notice.id, notice.id)
  assert.equal(await (await api.post('workbench/notifications/claim', { id: notice.id, prefsRevision: 1 })).json(), null)
  const delivered = await (await api.post('workbench/notifications/settle', { id: notice.id, claimId: claimed.claimId, outcome: 'unknown' })).json()
  assert.deepEqual(delivered, { system: 'unknown', visibleToCompanion: true, handled: false })
  await writeFile(testPath, "import { test } from 'node:test'; test('changed source', () => {});")
  const stale = await (await api.post('workbench/verification/inspect', { workspace: project, id: startedAction.id })).json()
  assert.equal(stale.receipt.freshness, 'STALE'); assert.equal(stale.receipt.tests, 'PASSED')
  const accepted = await (await api.post('workbench/verification/accept', { workspace: project, id: startedAction.id, expectedRevision: 0, decision: 'ACCEPTED' })).json()
  assert.equal(accepted.receipt.acceptance, 'ACCEPTED'); assert.equal(accepted.receipt.freshness, 'STALE')
  assert.equal((await api.post('workbench/verification/accept', { workspace: project, id: startedAction.id, expectedRevision: 0, decision: 'REJECTED' })).status, 409)
  await api.post('workbench/notifications/advance', { expectedRevision: newNotices.cursor.revision, sequence: notice.sequence })
  await writeFile(join(evidence, 'verification-and-notice.json'), JSON.stringify({ receiptView, stale, accepted, notice, delivered }, null, 2)+'\n')
  observations.push('authenticated-actual-shell-durable-receipt-stale-input-independent-acceptance')
  observations.push('durable-notice-single-claim-unknown-display-retained-source')
  const ledgerDeadline = Date.now() + 10000
  let journal
  for (;;) {
    try { journal = await readFile(join(root, '.nidofy-storage-v1', 'ledger.jsonl'), 'utf8'); break }
    catch (error) {
      if (error.code !== 'EBUSY' || Date.now() >= ledgerDeadline) throw error
      await new Promise(done => setTimeout(done, 10))
    }
  }
  const quotaLines = journal.trimEnd().split('\n')
  assert.ok(quotaLines.length > 3)
  // Parse only the grant scopes; process creation FILETIME remains native-owned u64 data.
  const quotaScopes = quotaLines.flatMap(line => Object.values(JSON.parse(line.slice(65)).leases).map(lease => lease.scope))
  assert.ok(quotaScopes.includes('connections:transaction'))
  assert.ok(quotaScopes.includes('native:task'))
  const legacySource = join(root, 'legacy-preview-source'); await mkdir(legacySource)
  const importedSessionDirectory = join(legacySource, 'sessions/_no-cwd/imported-cold-session')
  await mkdir(importedSessionDirectory, { recursive: true })
  const importedSourceBytes = JSON.stringify({ type: 'session', version: 0, id: 'imported-cold-session', createdAt: 1, delegationDepth: 0 }) + '\n'
  await writeFile(join(importedSessionDirectory, 'session.jsonl'), importedSourceBytes)
  const importOperation = crypto.randomUUID()
  const importPreview = await api.post('import', { action: 'preview', source: legacySource, sourceVersion: '0.2.0', operationId: importOperation })
  assert.equal(importPreview.status, 200)
  const plannedImport = await importPreview.json()
  assert.equal(plannedImport.status, 'PREVIEW'); assert.equal(plannedImport.execution, 'explicit-bounded-copy')
  const refusedImport = await api.post('import', { source: legacySource, sourceVersion: '0.2.0', operationId: crypto.randomUUID() })
  assert.equal((await refusedImport.json()).error, 'IMPORT_REQUEST_INVALID')
  const copiedImport = await api.post('import', { action: 'execute', source: legacySource, sourceVersion: '0.2.0',
    operationId: importOperation, expectedFingerprint: plannedImport.fingerprint, maxWriteBytes: 65536, confirm: true })
  assert.equal(copiedImport.status, 200)
  assert.equal((await copiedImport.json()).phase, 'ready')
  assert.equal((await (await api.post('import', { action: 'inspect', operationId: importOperation })).json()).phase, 'ready')
    const readyReview = await (await api.post('import', { action: 'review', operationId: importOperation })).json()
    assert.equal(readyReview.report.verification, 'official-session-readers-and-copy-digests')
    assert.equal(readyReview.launch, null)
  const adoptedImport = await (await api.post('import', { action: 'adopt', operationId: importOperation, confirm: true })).json()
  assert.equal(adoptedImport.phase, 'adopted')
    const adoptedReview = await (await api.post('import', { action: 'review', operationId: importOperation })).json()
    assert.equal(adoptedReview.launch.harnessHome, adoptedImport.home)
    assert.equal(adoptedReview.launch.switchesRunningHost, false)
    assert.notEqual(adoptedReview.runningHome, adoptedImport.home)
  const adoptedHost = launch({ DSH_HOME: adoptedImport.home })
  const adoptedApi = await authenticated(adoptedHost)
  const adoptedQuota = await (await adoptedApi.post('quota', { action: 'status' })).json()
  assert.equal(adoptedQuota.rootId, adoptedImport.rootId)
  const importedStored = await adoptedApi.probe({ action: 'stored', sessionId: 'imported-cold-session' })
  assert.equal(importedStored.header.id, 'imported-cold-session')
  assert.equal(await readFile(join(importedSessionDirectory, 'session.jsonl'), 'utf8'), importedSourceBytes)
  assert.equal((await (await adoptedApi.post('import', { action: 'inspect', operationId: importOperation })).json()).phase, 'adopted')
    const planManifest = join(root, 'paused-plan-manifest.json')
    await writeFile(planManifest, JSON.stringify({ schemaVersion: 1, items: [{ title: 'Isolated plan', prompt: 'Synthetic local task', scheduledAt: 1 }] }))
    const extrasPost = async (method, input) => {
      const response = await fetch(adoptedApi.base + '/api/nidofy-extras/' + method, { method: 'POST',
        headers: { cookie: adoptedApi.cookie, 'content-type': 'application/json', origin: adoptedApi.base }, body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text()); return response.json()
    }
    const pausedPlans = await extrasPost('schedule/import', { path: planManifest })
    assert.equal(pausedPlans.activated, 0)
    assert.equal(pausedPlans.paused[0].status, 'PAUSED')
    const planState = await extrasPost('schedule/list', {})
    assert.equal(planState.paused[0].status, 'PAUSED')
    assert.equal(planState.official.length, 0)
    observations.push('committed-category-review-launch-preparation-separate-paused-plans')
  await adoptedHost.stop()
  observations.push('bounded-import-explicit-adoption-cold-full-host-same-ledger')
  observations.push('actual-loader-shared-quota-connection-and-native-writers')
  await host.stop()
  await removeRef(state.connections.find(row => row.connection === 'valid').revision)
  host = launch(); api = await authenticated(host)
  assert.ok((await (await api.post('status')).json()).connections.every(row => row.availability === 'missing-credential'))
  for (const chinese of [false, true]) {
    const page = await fetch(api.base + '/api/nidofy/ui' + (chinese ? '?locale=zh-CN' : ''), { headers: { cookie: api.cookie } })
    assert.equal(page.status, 200)
    const html = await page.text(), dom = new JSDOM(html), script = html.match(/<script>([\s\S]*)<\/script>/)[1]
    const document = dom.window.document
    const requests = new Set()
    const browserFetch = (url, init) => {
      const promise = fetch(new URL(url, api.base), { ...init, headers: { ...init.headers, cookie: api.cookie, origin: api.base } })
      requests.add(promise); void promise.finally(() => requests.delete(promise)); return promise
    }
    new Script(script).runInNewContext({ document, fetch: browserFetch, crypto, AbortController })
    const settle = async predicate => {
      const deadline = Date.now() + 10000
      while (!predicate()) { assert.ok(Date.now() < deadline, document.getElementById('status').textContent); await new Promise(done => setTimeout(done, 10)) }
    }
    await settle(() => document.querySelectorAll('#list button').length === 2 && !document.getElementById('save').disabled)
    const choice = [...document.querySelectorAll('#list button')].find(row => row.textContent.startsWith('missing'))
    choice.click(); document.getElementById('key').value = 'synthetic-repaired'; document.getElementById('save').click()
    await settle(() => !document.getElementById('save').disabled)
    assert.equal(document.getElementById('key').value, '')
    assert.ok(!document.getElementById('receipt').textContent.includes('synthetic-repaired'))
    assert.equal((await (await api.post('status')).json()).connections.find(row => row.connection === 'missing').availability, 'available')
    await Promise.all(requests); dom.window.close()
  }
  observations.push('all-keyless-ready-authenticated-bilingual-dom-repair')
  heldRequest = { entered: Promise.withResolvers(), release: Promise.withResolvers() }
  const activeRequest = api.probe({ sessionId: 'connection-active-deployment-edit', provider: 'nidofy-missing' })
  await heldRequest.entered.promise
  const deploymentBefore = await (await api.post('deployment', { action: 'status' })).json()
  const deploymentSave = await api.post('deployment', { action: 'save', expectedRevision: deploymentBefore.revision,
    fields: { httpProxy: 'http://127.0.0.1:' + proxy.address().port, noProxy: 'bypass.connection.invalid' } })
  assert.equal(deploymentSave.status, 200)
  const savedDeployment = await deploymentSave.json()
  assert.equal(savedDeployment.fields.httpProxy.pending, true)
  assert.equal(savedDeployment.fields.httpProxy.applied.value, '')
  heldRequest.release.resolve()
  assert.deepEqual((await activeRequest).events.at(-1).data.reason, { kind: 'completed' })
  heldRequest = undefined
  // Editing deployment must not switch this process's dispatcher, including requests admitted before restart.
  await api.probe({ sessionId: 'connection-before-restart', provider: 'nidofy-missing' })
  assert.equal(proxyCalls.length, 0)
  await host.stop()
  host = launch(); api = await authenticated(host)
  const appliedDeployment = await (await api.post('deployment', { action: 'status' })).json()
  assert.equal(appliedDeployment.fields.httpProxy.pending, false)
  assert.equal(appliedDeployment.fields.httpProxy.source, 'user-env')
  const revision = (await (await api.post('status')).json()).desiredRevision
  const proxied = await api.post('mutate', { action: 'save', operationId: crypto.randomUUID(), connection: 'missing', expectedRevision: revision,
    profile: { ...profile, baseURL: 'http://model.connection.invalid/v1' }, credential: { mode: 'keep' } })
  assert.equal(proxied.status, 200)
  const proxiedSession = await api.probe({ sessionId: 'connection-proxy-recorded', provider: 'nidofy-missing' })
  assert.deepEqual(proxiedSession.events.at(-1).data.reason, { kind: 'completed' })
  assert.ok(proxyCalls.length > 0)
  const beforeBypass = proxyCalls.length
  const routes = await api.probe({ action: 'routes', urls: [providerUrl, 'http://bypass.connection.invalid/', 'http://model.connection.invalid/'] })
  assert.deepEqual(routes.routes, ['direct', 'direct', 'proxy'])
  assert.equal(proxyCalls.length, beforeBypass)
  await writeFile(join(evidence, 'deployment.json'), JSON.stringify({ savedDeployment, appliedDeployment,
    proxyConnections: proxyCalls.length, routes: routes.routes }, null, 2) + '\n')
  observations.push('deployment-save-pending-restart-real-proxy-loopback-bypass')
  const tlsRevision = (await (await api.post('status')).json()).desiredRevision
  assert.equal((await api.post('mutate', { action: 'save', operationId: crypto.randomUUID(), connection: 'missing', expectedRevision: tlsRevision,
    profile: { ...profile, baseURL: 'https://127.0.0.1:' + tlsProvider.address().port + '/v1', retryPolicy: { mode: 'normal', maxRetries: 0 } },
    credential: { mode: 'keep' } })).status, 200)
  const beforeTls = providerCalls.filter(row => row.tls).length
  const beforeTlsErrors = tlsErrors.length
  const untrusted = await api.probe({ sessionId: 'connection-ca-untrusted', provider: 'nidofy-missing' })
  assert.equal(untrusted.events.at(-1).data.reason.kind, 'error')
  assert.equal(untrusted.events.at(-1).data.reason.error.code, 'TRANSPORT')
  assert.equal(providerCalls.filter(row => row.tls).length, beforeTls)
  assert.ok(tlsErrors.length > beforeTlsErrors, 'The rejected Agent request must reach the local TLS handshake')
  await writeFile(join(evidence, 'ca-untrusted-session.json'), JSON.stringify(untrusted, null, 2) + '\n')
  await host.stop()
  host = launch({ NODE_EXTRA_CA_CERTS: join(import.meta.dirname, 'connection-test-ca.pem') }); api = await authenticated(host)
  const caDeployment = await (await api.post('deployment', { action: 'status' })).json()
  assert.equal(caDeployment.ca.configured, true)
  const trusted = await api.probe({ sessionId: 'connection-ca-trusted', provider: 'nidofy-missing' })
  assert.deepEqual(trusted.events.at(-1).data.reason, { kind: 'completed' })
  assert.equal(providerCalls.filter(row => row.tls).length, beforeTls + 1)
  await writeFile(join(evidence, 'ca-trusted-session.json'), JSON.stringify(trusted, null, 2) + '\n')
  await writeFile(join(evidence, 'ca.json'), JSON.stringify({ trustSource: 'isolated NODE_EXTRA_CA_CERTS launch', caConfigured: caDeployment.ca.configured,
    untrusted: 'transport failed during local TLS handshake before provider request', tlsErrors, trusted: 'completed real Agent request',
    limitations: ['Node-mode Host only; Electron page network and corporate gateways unqualified'] }, null, 2) + '\n')
  observations.push('custom-ca-untrusted-rejected-launch-trust-local-tls-recorded')
  const policyBefore = await (await api.post('egress', { action: 'status' })).json()
  assert.equal(policyBefore.distribution.revision, 'personal-v1')
  const refusalPolicy = { schemaVersion: 1, revision: policyBefore.policy.revision, profile: [], workspaces: [] }
  assert.equal((await api.post('egress', { action: 'save', expectedRevision: policyBefore.policy.revision, policy: refusalPolicy })).status, 200)
  const patchBeforeEgress = await api.probe({ action: 'egress-patch' })
  assert.deepEqual(await api.probe({ action: 'egress-edit' }), { error: 'EGRESS_TARGET_REFUSED' })
  assert.deepEqual(await api.probe({ action: 'egress-patch' }), patchBeforeEgress)
  const beforeEgressCalls = providerCalls.length
  const refusedByPolicy = await api.probe({ sessionId: 'egress-refused-session', provider: 'nidofy-missing' })
  assert.equal(refusedByPolicy.events.at(-1).data.reason.kind, 'error')
  assert.equal(refusedByPolicy.events.at(-1).data.reason.error.code, 'EGRESS_TARGET_REFUSED')
  assert.equal(providerCalls.length, beforeEgressCalls)
  await writeFile(join(evidence, 'egress.json'), JSON.stringify({ policy: refusalPolicy, configurationWriteRefused: true,
    configurationBytesPreserved: true, modelRequestRefused: true, additionalProviderRequests: 0,
    limitations: ['Node-mode complete Host only', 'Shell/Git/socket/worker/enterprise gateway unqualified'] }, null, 2) + '\n')
  observations.push('egress-policy-config-save-real-agent-denial-zero-provider-requests')
  host.child.send({ type: 'quit-inspection', requestId: 71 }); await host.until(() => host.messages.some(row => row.requestId === 71))
  assert.deepEqual(host.messages.find(row => row.requestId === 71), { type: 'quit-inspection', requestId: 71, activeTasks: false, scheduledTasks: false })
  await host.stop(); await assert.rejects(fetch(api.base + '/'))
  observations.push('quit-inspection-unload-ack-port-closed')
  const connections = join(home, 'nidofy-connections')
  await rename(connections, connections + '.retained')
  await writeFile(connections, 'preserved test obstruction')
  host = launch(); api = await authenticated(host)
  const unavailable = await api.post('status'); assert.equal(unavailable.status, 503)
  const diagnostic = await unavailable.json()
  assert.equal(diagnostic.error, 'CONNECTION_OWNER_UNAVAILABLE'); assert.match(diagnostic.diagnosticCode, /^[A-Z][A-Z0-9_]+$/)
  assert.equal((await fetch(api.base + '/api/nidofy/ui', { headers: { cookie: api.cookie } })).status, 200)
  await host.stop(); await assert.rejects(fetch(api.base + '/api/nidofy/ui'))
  assert.equal(await readFile(connections, 'utf8'), 'preserved test obstruction')
  await unlink(connections); await rename(connections + '.retained', connections)
  observations.push('owner-install-degraded-authenticated-repair-preserves-files')
  await mkdir(join(home, 'nidofy-import-connections.json'))
  host = launch(); const fatal = await host.startup
  assert.equal(fatal.type, 'fatal'); assert.ok(fatal.diagnostic.includes('EISDIR'))
  assert.deepEqual(await host.completed, { code: 1, signal: null }); assert.ok(!host.messages.some(row => row.type === 'ready'))
  children.delete(host.child)
  observations.push('non-owner-failure-fatal-before-ready')
  await writeFile(join(evidence, 'full-profile.json'), JSON.stringify({ observations, providerCalls, proxyConnections: proxyCalls.length, node: process.version,
    platform: process.platform, entry: 'apps/desktop-host/lib/index.js', profile: ['dsh-base', 'dsh-web-app', 'nidofy-desktop-bundle'],
    limitations: ['Node-mode Host; Electron shell and installer not executed', 'Office resource registration; document conversion and runtime tool preparation not executed'] }, null, 2) + '\n')
  console.log(JSON.stringify({ observations, providerCalls, proxyConnections: proxyCalls.length }))
} finally {
  heldRequest?.release.resolve()
  for (const child of children) {
    child.kill(); await child.completion.catch(() => undefined)
  }
  provider.closeAllConnections(); await new Promise(done => provider.close(done))
  tlsProvider.closeAllConnections(); await new Promise(done => tlsProvider.close(done))
  for (const stream of tunnels) stream.destroy()
  proxy.closeAllConnections(); await new Promise(done => proxy.close(done))
  // Remove only this fixture's junction; retain isolated files as evidence, without synthetic credential values.
  for (const projection of projections) await unlink(projection)
  await writeFile(join(home, '.credentials.yaml'), '', { mode: 0o600 })
  if (process.connected) process.disconnect()
}
