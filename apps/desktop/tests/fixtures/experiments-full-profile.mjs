/** Built supported Desktop profile, synthetic isolated project and authenticated T20 reads; all roots and logs are retained. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { runTaskRequestsProfile } from './experiments-task-profile.mjs'
import { runEngineeringTasksProfile } from './experiments-engineering-profile.mjs'
import { runEngineeringTimeoutProfile } from './experiments-engineering-timeout.mjs'

const repo = resolve(import.meta.dirname, '../../../..'), baseEvidence = resolve(process.argv[2])
await mkdir(baseEvidence, { recursive: true })
const evidence = await mkdtemp(join(baseEvidence, 'host-')), root = await mkdtemp(join(tmpdir(), 'dsh-experiments-host-'))
const home = join(root, 'home'), profile = join(root, 'profile'), project = join(root, 'project'), runtime = join(root, 'runtime/primary-runtime')
await writeFile(join(evidence, 'fixture-root.json'), JSON.stringify({ root, home, profile, project, isolated: true,
  commandName: process.env.DSH_DISPATCH_COMMAND_NAME ?? null }) + '\n')
if (['task', 'engineering', 'engineering-timeout', 'engineering-refusal'].includes(process.argv[3])) {
  const index = resolve(baseEvidence, '../input-roots')
  await mkdir(index, { recursive: true })
  await writeFile(join(index, 'full-profile-' + randomUUID() + '.json'), JSON.stringify({ root, home, profile, project,
    evidence, mode: process.argv[3], synthetic: true, retained: true,
    commandName: process.env.DSH_DISPATCH_COMMAND_NAME ?? null }) + '\n', { flag: 'wx' })
}
const projections = [], children = new Set(), observations = []
process.on('message', message => { if (message?.type === 'cancel') for (const child of children) child.kill() })
try {
  await mkdir(home); await mkdir(profile); await mkdir(join(project, 'src'), { recursive: true }); await mkdir(join(project, 'inputs'))
  for (const scope of ['@deepseek-ai', '@nidofy']) {
    const installed = join(repo, 'node_modules/.pnpm/node_modules', scope), target = join(profile, 'node_modules', scope)
    await mkdir(target, { recursive: true })
    for (const name of await readdir(installed)) {
      const path = join(target, name)
      await symlink(await realpath(join(installed, name)), path, 'junction'); projections.push(path)
    }
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'isolated-experiment-profile', private: true, type: 'module',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@nidofy/dsh-desktop-bundle'] } } }))
  if (['task', 'engineering'].includes(process.argv[3])) await cp(join(import.meta.dirname, 'experiments-notebook-source.mjs'),
    join(profile, 'experiments-notebook-source.mjs'))
  if (process.argv[3] === 'engineering') await cp(join(import.meta.dirname, 'experiments-session-resource-observer.mjs'),
    join(profile, 'experiments-session-resource-observer.mjs'))
  await cp(join(repo, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
  await mkdir(join(runtime, 'dependencies/node/bin'), { recursive: true })
  const node = join(runtime, 'dependencies/node/bin/node.exe')
  await cp(process.execPath, node)
  const patch = join(root, 'distribution.patch.json')
  await writeFile(patch, JSON.stringify([{ id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'pwsh-sandbox', config: { pwshPath: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' } },
    ...process.argv[3] === 'engineering-refusal' ? [{ id: 'sandbox-policy', config: { mode: 'danger-full-access', workspaceRoot: project } }] : [],
    ...['llm-deepseek', 'llm-deepseek-account', 'session-title-llm', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics', 'agent-instructions']
      .map(id => ({ id, disabled: true })),
    { insert: [{ id: 'experiment-profile-observation', name: pathToFileURL(join(import.meta.dirname, 'selftest-profile-probe.mjs')).href },
      ...['task', 'engineering'].includes(process.argv[3]) ? [{ id: 'experiment-notebook-source',
        name: pathToFileURL(join(profile, 'experiments-notebook-source.mjs')).href }] : [],
      ...process.argv[3] === 'engineering' ? [{ id: 'experiment-session-resource-observer',
        name: pathToFileURL(join(profile, 'experiments-session-resource-observer.mjs')).href }] : []] }]))
  await writeFile(join(project, 'src/case.test.mjs'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('same isolated case',()=>assert.equal(1,1));\n")
  await writeFile(join(project, 'inputs/case.json'), '{"tolerance":0}\n')
  function launch() {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(path|systemroot|windir|comspec|pathext)$/iu.test(name)))
    const child = spawn(process.execPath, [...process.argv[3] === 'engineering-timeout' ? ['--expose-gc'] : [],
      join(repo, 'apps/desktop-host/lib/index.js'), profile, profile, runtime], { cwd: profile,
      env: { ...env, DSH_HOME: home, HOME: root, USERPROFILE: root, TEMP: root, TMP: root, TMPDIR: root,
        DSH_DESKTOP_DISTRIBUTION_PATCH: patch, DSH_DESKTOP_DISTRIBUTION_KIND: 'personal',
        DSH_DESKTOP_PROTECTION_HELPER: join(repo, 'native/nidofy-protection/target/release/nidofy-protection.exe') },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
    children.add(child)
    const messages = [], output = []
    child.stdout.on('data', bytes => output.push(String(bytes))); child.stderr.on('data', bytes => output.push(String(bytes)))
    child.on('message', message => messages.push(message))
    const done = new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('close', async (code, signal) => {
        await writeFile(join(evidence, 'host-' + child.pid + '.log'), output.join('').replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
        accept({ code, signal })
      })
    })
    return { child, done, async api() {
      const deadline = Date.now() + 45000
      while (!messages.some(row => row.type === 'ready' || row.type === 'fatal')) {
        if (child.exitCode !== null || Date.now() > deadline) throw Error('Host readiness failed: ' + output.join(''))
        await new Promise(accept => setTimeout(accept, 20))
      }
      const ready = messages.find(row => row.type === 'ready' || row.type === 'fatal')
      assert.equal(ready.type, 'ready', ready.diagnostic ?? output.join(''))
      const base = new URL(ready.url).origin, exchange = await fetch(ready.url, { redirect: 'manual' })
      assert.equal(exchange.status, 303)
      const cookie = exchange.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie)
      return { base, cookie, async post(method, data = {}, status = 200) {
        const response = await fetch(base + '/api/nidofy/workbench/' + method, { method: 'POST',
          headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(45000) })
        const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value
      }, async counts() {
        const response = await fetch(base + '/api/selftest-qualification', { headers: { cookie, origin: base } })
        assert.equal(response.status, 200); return response.json()
      } }
    }, async collect() {
      const count = messages.filter(row => row.type === 'collected').length
      child.send({ type: 'collect' }); const deadline = Date.now() + 5000
      while (messages.filter(row => row.type === 'collected').length === count) {
        if (Date.now() > deadline) throw Error('Explicit fixture GC did not acknowledge')
        await new Promise(resolve => setTimeout(resolve,20))
      }
      assert.equal(messages.filter(row => row.type === 'collected').at(-1).available,true)
    }, async stop() {
      child.send({ type: 'shutdown' }); const timeout = setTimeout(() => child.kill(), 45000)
      try { assert.deepEqual(await done, { code: 0, signal: null }); children.delete(child) } finally { clearTimeout(timeout) }
    } }
  }
  let host = launch(), api = await host.api()
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/experiments/ui')).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/experiments/compare', { method: 'POST',
    headers: { cookie: api.cookie, origin: 'https://foreign.invalid' }, body: '{}' })).status, 403)
  for (const [locale, title] of [['en', 'Task receipt comparisons'], ['zh-CN', '任务回执比较']]) {
    const response = await fetch(api.base + '/api/nidofy/workbench/experiments/ui?locale=' + locale, { headers: { cookie: api.cookie } })
    assert.equal(response.status, 200); assert.match(await response.text(), new RegExp(title))
  }
  assert.deepEqual(await api.post('experiments/list'), [])
  assert.deepEqual(await api.counts(), { modelRequests: 0, createdAgents: 0 })
  observations.push('supported-full-profile-authentication-origin-bilingual-page-zero-model-and-agent')
  if (process.argv[3] === 'engineering') {
    await runEngineeringTasksProfile({ host, api, launch, evidence, root, home, project, node })
  } else if (['engineering-timeout', 'engineering-refusal'].includes(process.argv[3])) {
    await runEngineeringTimeoutProfile({ host, api, launch, evidence, root, home, project, node })
  } else if (process.argv[3] === 'task') {
    await runTaskRequestsProfile({ host, api, launch, evidence, root, home })
  } else {
  const quote = value => "'" + value.replaceAll("'", "''") + "'"
  const config = { schemaVersion: 1, actions: [{ id: 'case', label: 'Isolated equal case',
    command: '& ' + quote(node) + ' --test --test-isolation=none --test-reporter=tap ./src/case.test.mjs', timeoutMs: 10000,
    verification: { schemaVersion: 1, intent: 'Same isolated acceptance case', parser: 'node-tap-13/1', coverage: 'complete',
      sources: ['src'], inputs: ['inputs'], toolchain: [node], parameters: { tolerance: 0 } } }] }
  const saved = await api.post('actions/save', { workspace: project, config })
  await api.post('actions/trust', { workspace: project, fingerprint: saved.fingerprint })
  async function run() {
    const run = await api.post('actions/start', { workspace: project, id: 'case' }), deadline = Date.now() + 45000
    let view
    do {
      view = await api.post('verification/inspect', { workspace: project, id: run.id })
      if (Date.now() > deadline) throw Error('Actual receipt did not settle')
      await new Promise(accept => setTimeout(accept, 20))
    } while (view.phase === 'PENDING')
    assert.equal(view.phase, 'COMMITTED'); assert.equal(view.receipt.tests, 'PASSED', JSON.stringify(view))
    return run.id
  }
  const a = await run(), b = await run()
  const selection = { experimentId: randomUUID(), caseId: randomUUID(), factor: 'cache', a: { workspace: project, runId: a }, b: { workspace: project, runId: b } }
  const comparison = await api.post('experiments/compare', { selection })
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/experiments/model-step', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection, side: 'a' }) })).status, 401)
  assert.equal((await fetch(api.base + '/api/nidofy/workbench/experiments/model-step', { method: 'POST',
    headers: { cookie: api.cookie, origin: 'https://foreign.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ selection, side: 'a' }) })).status, 403)
  const lineage = await api.post('experiments/model-step', { selection, side: 'a' })
  assert.equal(lineage.status, 'UNKNOWN'); assert.equal(lineage.diagnostic, 'EXPERIMENT_MODEL_SOURCE_UNAVAILABLE')
  assert.equal(lineage.counts.requests, null); assert.equal(lineage.taskTotals, null); assert.equal(lineage.exactModelVersion, null)
  assert.equal((await api.post('experiments/model-step', { selection, side: 'a', inputTokens: 0 }, 400)).error, 'EXPERIMENT_INPUT_INVALID')
  await writeFile(join(evidence, 'model-step.json'), JSON.stringify(lineage, null, 2) + '\n')
  observations.push('authenticated-model-step-desktop-source-unknown-no-retrospective-counts')
  assert.equal(comparison.task, 'UNKNOWN'); assert.equal(comparison.quality, 'UNKNOWN')
  assert.equal(comparison.efficiencyEligible, false); assert.deepEqual(comparison.counts.requests, { a: null, b: null, missing: 2 })
  assert.deepEqual(comparison.counts.tests, { a: 1, b: 1, missing: 0 })
  await api.post('verification/accept', { workspace: project, id: a, expectedRevision: 0, decision: 'ACCEPTED' })
  const id = randomUUID(), record = await api.post('experiments/record', { id, selection })
  const path = join(home, 'nidofy-extras/experiments/records-v1', id + '.json'), before = await readFile(path)
  await api.post('verification/accept', { workspace: project, id: b, expectedRevision: 0, decision: 'ACCEPTED' })
  assert.equal((await api.post('experiments/read', { id })).changedSinceRecord, true)
  const refusal = await api.post('experiments/import', { report: JSON.stringify({ ...record, id: randomUUID() }) }, 400)
  assert.equal(refusal.error, 'EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
  await writeFile(join(evidence, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n')
  await writeFile(join(evidence, 'record.json'), before)
  await writeFile(join(evidence, 'receipt-a.json'), JSON.stringify(await api.post('verification/inspect', { workspace: project, id: a }), null, 2) + '\n')
  await writeFile(join(evidence, 'receipt-b.json'), JSON.stringify(await api.post('verification/inspect', { workspace: project, id: b }), null, 2) + '\n')
  assert.deepEqual(await api.counts(), { modelRequests: 0, createdAgents: 0 })
  observations.push('actual-protected-shell-two-tap-receipts-independent-acceptance-quota-archive-import-refusal')
  await host.stop(); host = launch(); api = await host.api()
  const cold = await api.post('experiments/read', { id })
  assert.equal(cold.comparison.quality, 'BOTH_ACCEPTED'); assert.equal(cold.comparison.task, 'UNKNOWN'); assert.equal(cold.changedSinceRecord, true)
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await api.counts(), { modelRequests: 0, createdAgents: 0 })
  await writeFile(join(project, 'inputs/case.json'), '{"tolerance":1}\n')
  const changed = await api.post('experiments/read', { id })
  assert.equal(changed.comparison.task, 'NOT_COMPARABLE'); assert.deepEqual(await readFile(path), before)
  assert.deepEqual(await api.counts(), { modelRequests: 0, createdAgents: 0 })
  await host.stop()
  observations.push('cold-restart-read-original-record-bytes-source-change-no-replay')
  await writeFile(join(evidence, 'summary.json'), JSON.stringify({ observations, root, actualActions: 2, modelRequests: 0, createdAgents: 0,
    renderer: 'UNKNOWN', taskRunner: 'NOT_IMPLEMENTED', modelInput: 'UNAVAILABLE', installer: 'UNKNOWN' }, null, 2) + '\n')
  console.log(JSON.stringify({ evidence, root, observations, actualActions: 2, modelRequests: 0, createdAgents: 0 }))
  }
} finally {
  for (const child of children) { child.kill(); await new Promise(accept => {
    if (child.exitCode !== null || child.signalCode !== null) accept(); else child.once('close', accept)
  }) }
  for (const path of projections) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (process.connected) process.disconnect()
}
