/** Real native quota, managed PiAi, local synthetic SSE and official cold journals; no paid endpoints, Agent or project commands. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { bootServices, credentialMemory } from './connection-backend.ts'
import { verificationFixture } from './verification-fixture.ts'
import { mockServer, closeMockServers } from '../../../packages/llm/llm-pi-ai/tests/mock-server.ts'
import { installConnections } from '../src/connections/runtime.ts'
import { DesktopEgressPolicy, distributionEgress } from '../src/connections/egress.ts'
import { object } from '../src/connections/store.ts'
import { TaskRequestOwner } from '../src/experiments/task-requests.ts'
import { TaskRequestInputs } from '../src/experiments/task-inputs.ts'
import { prepareDesktopCachePayload } from '@nidofy/dsh-desktop-extras/cache'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installContextV2 } from '@nidofy/dsh-desktop-extras/context'
import { NotebookV2Store } from '@nidofy/dsh-desktop-extras/notebook'

const events = [JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic task response' }, finish_reason: null }] }),
  JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } } }), '[DONE]']
async function fixture(script: Parameters<typeof mockServer>[0] = [{ events }]) {
  const f = await verificationFixture(undefined, true), server = await mockServer(script)
  const directory = join(process.cwd(), '.build/dispatch/evidence/relay-24/input-roots')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, randomUUID() + '.json'), JSON.stringify({ root: f.root, server: server.url,
    synthetic: true, paidRequests: 0, agents: 0, commands: 0 }) + '\n', { flag: 'wx' })
  console.info('Retained synthetic task-request root:', f.root)
  await bootServices(f.ctx, credentialMemory())
  const policy = new DesktopEgressPolicy(f.home, distributionEgress({ schemaVersion: 1, revision: 'task-local-v1', origins: [server.url] }, false))
  f.ctx.provide('outboundHttp', policy); policy.bind(f.ctx)
  const store = await installConnections(f.ctx, join(f.home, 'nidofy-connections'))
  const profile = { api: 'openai-completions', baseURL: server.url + '/v1', models: [{ id: 'task-alias' }],
    defaultContextWindow: 8192, defaultMaxTokens: 64, retryPolicy: { mode: 'normal', maxRetries: 0 } }
  await store.mutate({ action: 'save', operationId: randomUUID(), connection: 'local', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-private-key' } })
  const owner = new TaskRequestOwner(f.ctx, f.home, store, f.storage)
  onTestFinished(async () => { await owner.close(); await closeMockServers() })
  const input = { experimentId: randomUUID(), caseId: randomUUID(), connection: 'local', model: 'task-alias',
    text: '完整合成任务\nReturn a private analysis. No commands.', maxOutputTokens: 64 }
  const prepare = async (patch = {}) => object(await owner.request('task-prepare', { ...input, ...patch }))
  const settle = async (id: string) => {
    await expect.poll(async () => object(await owner.request('task-read', { id })).status, { timeout: 15000 }).not.toBe('RUNNING')
    return object(await owner.request('task-read', { id }))
  }
  const run = async () => { const plan = await prepare(), id = randomUUID()
    await owner.request('task-start', { id, ticket: plan.ticket, accepted: true }); return { id, result: await settle(id) } }
  return { ...f, server, store, profile, owner, policy, input, prepare, settle, run,
    base: join(f.home, 'nidofy-extras/experiments/task-requests-v1') }
}
async function notebookFixture() {
  const f = await fixture(), notes = join(f.home, 'nidofy-extras/notebooks'), controller = new AbortController()
  const policy = { enabled: false, revision: 0, signal: controller.signal }
  const budgets = { maxActiveEntries: 64, maxActiveBytes: 16384, maxDeltaBytes: 16384, maxEvidenceBytes: 65536, maxHistoryBytes: 1048576 }
  await f.ctx.plugin(SessionStore); await f.ctx.plugin(SystemPrompt); await f.ctx.plugin(ToolRuntime)
  await f.ctx.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions'), compression: 'none' })
  const session = Session.create(SessionId('synthetic-notebook-' + randomUUID()))
  const event = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic notebook source' }] }), { surfaceOp: 'append' })
  const writer = await f.ctx.sessionPersistence.create(session.header)
  try { await writer.append([event]); await writer.flush() } finally { await writer.close() }
  const observation = await f.ctx.sessionPersistence.observeDurable(session.id)
  const scope = { sessionId: session.id, generation: observation.generation }, store = new NotebookV2Store(notes, budgets)
  await store.publish(0, scope, { scope, baseRevision: 0, cursors: { evidenceThrough: 0 }, operations: [
    { action: 'ADD', id: 'synthetic-note', kind: 'constraint', text: 'Never run commands for this analysis', seq: 0, quote: 'Synthetic notebook source' },
  ] }, observation.events, 'user', new AbortController().signal)
  await store.close()
  installContextV2(f.ctx, notes, budgets, () => policy, { maxCachedSessions: 8, recentEventLimit: 10, recentScanEvents: 64 })
  const flush = vi.fn(() => { throw Error('SYNTHETIC_FLUSH_FORBIDDEN') })
  f.ctx.on('session/flush', flush)
  return { ...f, session, policy, flush, notes, budgets, scope, sourceEvents: observation.events }
}
it.skipIf(process.platform !== 'win32')('sends one independently confirmed task from a flushed official cold input cut without filling an omitted cache counter', async () => {
  const f = await fixture(), prepared = vi.spyOn(f.ctx.llm, 'prepareCall'), plan = await f.prepare()
  expect(prepared).not.toHaveBeenCalled(); expect(f.server.requests).toEqual([])
  expect(plan).toMatchObject({ budget: { requests: 1, retries: 0 }, maxOutputTokens: 64,
    exactModelVersion: null, factors: { notebook: 'NOT_INJECTED', cache: 'UNKNOWN' }, projectWrites: false, tools: false })
  const id = randomUUID(); await f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })
  const result = await f.settle(id)
  expect(result).toMatchObject({ status: 'COMPLETED', terminal: { dispatched: true, streamComplete: true },
    counts: { dispatches: 1, providerWireRequests: null, inputTokens: 5, outputTokens: 3, cacheReadTokens: null },
    dispatchInput: { model: 'task-alias', maxTokens: 64, messages: [{ content: [{ type: 'text', text: f.input.text }] }] },
    receipt: null, quality: 'UNKNOWN', exactModelVersion: null, efficiencyEligible: false })
  const body = object(f.server.requests[0]), messages = body.messages
  expect(messages).toEqual([{ role: 'user', content: f.input.text }])
  expect(body.tools).toBeUndefined(); expect(f.server.requests).toHaveLength(1); expect(f.counts().commands).toBe(0)
  expect(f.store.status().activeLeases).toBe(0)
  const original = await readFile(join(f.base, id, 'dispatch.json'))
  const cold = new TaskRequestInputs(f.home, id, f.storage)
  try { expect(await cold.read(new AbortController().signal)).toEqual(result) } finally { await cold.close() }
  expect(await readFile(join(f.base, id, 'dispatch.json'))).toEqual(original)
  await expect(f.owner.request('task-start', { id: randomUUID(), ticket: plan.ticket, accepted: true })).rejects.toThrow('EXPERIMENT_CONFIRMATION_EXPIRED')
  expect(f.server.requests).toHaveLength(1)
}, 60000)
it.skipIf(process.platform !== 'win32').each(['failure', 'missing', 'tools'])('retains %s as independent unqualified accounting without another dispatch', async (kind) => {
  const script = kind === 'failure' ? [{ status: 500, body: '{"error":{"message":"synthetic failure"}}' }]
    : kind === 'tools' ? [{ events: [JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [
      { index: 0, id: 'unrequested', type: 'function', function: { name: 'shell', arguments: '{}' } }] }, finish_reason: null }] }), '[DONE]'] }]
      : [{ events: events.map(value => value.replace(',"prompt_tokens_details":{"cached_tokens":0}', '')) }]
  const f = await fixture(script), { result } = await f.run()
  expect(f.server.requests).toHaveLength(1); expect(f.counts().commands).toBe(0)
  expect(object(result.counts).cacheReadTokens).toBeNull(); expect(result.efficiencyEligible).toBe(false)
  if (kind !== 'missing') expect(result.status).not.toBe('COMPLETED')
}, 60000)
it.skipIf(process.platform !== 'win32').each(['connection', 'policy'])('rejects changed %s confirmation before input allocation or sending', async (changed) => {
  const f = await fixture(), plan = await f.prepare(), id = randomUUID()
  if (changed === 'connection') await f.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'local', expectedRevision: 1,
    profile: f.profile, credential: { mode: 'keep' } })
  else await writeFile(join(f.home, 'nidofy-connections/egress.json'), JSON.stringify({ schemaVersion: 1, revision: 1, profile: [], workspaces: [] }))
  await expect(f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })).rejects.toThrow()
  expect(f.server.requests).toEqual([]); expect(await f.owner.request('task-read', { id })).toBeNull()
}, 60000)
it.skipIf(process.platform !== 'win32')('refuses self-reported metrics, oversized full input, missing confirmation and native quota admission', async () => {
  const f = await fixture(), plan = await f.prepare()
  await expect(f.prepare({ text: '中'.repeat(16 * 1024) })).rejects.toThrow('EXPERIMENT_TASK_INPUT_INVALID')
  await expect(f.prepare({ requests: 5 })).rejects.toThrow('EXPERIMENT_TASK_INPUT_INVALID')
  await expect(f.owner.request('task-start', { id: randomUUID(), ticket: plan.ticket, accepted: false })).rejects.toThrow('EXPERIMENT_TASK_INPUT_INVALID')
  const denied = vi.spyOn(f.storage, 'reserve').mockRejectedValueOnce(Error('STORAGE_RESERVE_FAILED'))
  await expect(f.owner.request('task-start', { id: randomUUID(), ticket: plan.ticket, accepted: true })).rejects.toThrow('STORAGE_RESERVE_FAILED')
  denied.mockRestore(); expect(f.server.requests).toEqual([])
  await expect(f.owner.request('task-read', { id: randomUUID(), inputTokens: 0 })).rejects.toThrow('EXPERIMENT_TASK_INPUT_INVALID')
}, 60000)
it.skipIf(process.platform !== 'win32')('cancels and drains a held provider and never reuses the prepared confirmation', async () => {
  const f = await fixture([{ events, delayMs: 500 }]), plan = await f.prepare(), id = randomUUID()
  await f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })
  await expect.poll(() => f.server.requests.length, { timeout: 15000 }).toBe(1)
  await f.owner.request('task-cancel', { id })
  expect(await f.settle(id)).toMatchObject({ status: 'CANCELLED', terminal: { dispatched: true, streamComplete: false } })
  expect(f.store.status().activeLeases).toBe(0); expect(f.server.requests).toHaveLength(1)
}, 60000)
it.skipIf(process.platform !== 'win32')('preserves an uncertain official input commit, sends zero requests and reads its interrupted journal without repair', async () => {
  const f = await fixture(), plan = await f.prepare(), id = randomUUID(), write = f.storage.write.bind(f.storage)
  const spy = vi.spyOn(f.storage, 'write').mockImplementation(async (path, bytes, work) => {
    const result = await write(path, bytes, work)
    if (path === join(f.base, id)) throw Error('SYNTHETIC_WRITE_ACK_UNKNOWN')
    return result
  })
  await f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })
  const result = await f.settle(id)
  expect(result).toMatchObject({ status: 'UNKNOWN', counts: { dispatches: 0 }, dispatchInput: null })
  expect(f.server.requests).toEqual([]); spy.mockRestore()
  expect(await readdir(join(f.base, id, 'sessions'))).not.toEqual([])
}, 60000)
it.skipIf(process.platform !== 'win32')('refuses ten unfinished task roots without deleting or replaying their original intent bytes', async () => {
  const f = await fixture(), plan = await f.prepare(), base = f.base
  await mkdir(base, { recursive: true })
  const rows: { file: string; bytes: string }[] = []
  for (let index = 0; index < 10; index++) {
    const id = randomUUID(), root = join(base, id), { ticket: _ticket, expiresAt: _expires,
      budget: _budget, tools: _tools, projectWrites: _writes, exactModelVersion: _version, factors: _factors, ...intent } = plan
    await mkdir(root)
    const file = join(root, 'intent.json'), bytes = JSON.stringify({ ...intent, id, startedAt: Date.now() })
    await writeFile(file, bytes); rows.push({ file, bytes })
  }
  await expect(f.owner.request('task-start', { id: randomUUID(), ticket: plan.ticket, accepted: true })).rejects.toThrow('EXPERIMENT_TASK_HISTORY_LIMIT')
  expect(f.server.requests).toEqual([])
  for (const row of rows) expect(await readFile(row.file, 'utf8')).toBe(row.bytes)
}, 60000)
it.skipIf(process.platform !== 'win32')('refuses retained null or future intents without treating corrupted task data as missing', async () => {
  const f = await fixture(), id = randomUUID(), root = join(f.base, id)
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'intent.json'), 'null')
  await expect(f.owner.request('task-read', { id })).rejects.toThrow('EXPERIMENT_TASK_RECORD_INVALID')
  const futureId = randomUUID(), future = join(f.base, futureId)
  await mkdir(future); await writeFile(join(future, 'intent.json'), '{"schemaVersion":99}')
  await expect(f.owner.request('task-read', { id: futureId })).rejects.toThrow()
  expect(await readFile(join(root, 'intent.json'), 'utf8')).toBe('null')
  expect(await readFile(join(future, 'intent.json'), 'utf8')).toBe('{"schemaVersion":99}')
  expect(f.server.requests).toEqual([])
}, 60000)

it.skipIf(process.platform !== 'win32').each(['native', 'off', 'session'] as const)(
  'retains the actually applied %s cache hint and official provider response identity independently of current preferences', async (mode) => {
    const reported = events.map(value => value === '[DONE]' ? value
      : JSON.stringify({ ...object(JSON.parse(value)), model: 'synthetic-model-2026-10-11' }))
    const f = await fixture([{ events: reported }]), policy = { mode, models: ['task-alias'] }
    f.ctx.on('llm-pi-ai/prepare-payload', scope => prepareDesktopCachePayload(scope, policy,
      { home: f.home, key: Buffer.alloc(32, 7), preferenceRevision: 0 }))
    const { id, result } = await f.run()
    expect(result).toMatchObject({ exactModelVersion: null, executionObservation: { payloads: 1,
      cache: { policy: { mode, models: ['task-alias'] }, preferenceRevision: 0, api: 'openai-completions', applied: true,
        hint: mode === 'native' ? 'NATIVE' : mode === 'off' ? 'REMOVED' : 'SESSION_KEY' },
      response: { status: 'REPORTED', model: 'synthetic-model-2026-10-11' } } })
    const wire = object(f.server.requests[0])
    if (mode === 'session') expect(wire.prompt_cache_key).toMatch(/^dsh_/u)
    else expect(wire.prompt_cache_key).toBeUndefined()
    const path = join(f.base, id, 'execution-observation.json'), original = await readFile(path)
    expect(original.toString()).not.toContain('dsh_'); expect(original.toString()).not.toContain('synthetic-private-key')
    policy.mode = 'native'; policy.models.length = 0
    expect(await f.owner.request('task-read', { id })).toEqual(result)
    expect(await readFile(path)).toEqual(original)
    await writeFile(join(f.root, 'original-observation.json'), original, { flag: 'wx' })
    const row = object(JSON.parse(original.toString())), observation = object(row.observation)
    const { preferenceRevision: _revision, ...withoutRevision } = object(observation.cache)
    await writeFile(path, JSON.stringify({ ...row, observation: { ...observation, cache: withoutRevision } }))
    const legacy = object(await f.owner.request('task-read', { id }))
    expect(object(object(legacy.executionObservation).cache).preferenceRevision).toBeNull()
    expect(legacy.counts).toEqual(result.counts)
    expect(f.server.requests).toHaveLength(1); expect(f.counts().commands).toBe(0)
  }, 60000)
it.skipIf(process.platform !== 'win32')('refuses unsupported or mismatched observation sidecars without reading present settings or resending', async () => {
  const f = await fixture(), { id } = await f.run(), path = join(f.base, id, 'execution-observation.json')
  const original = await readFile(path), row = object(JSON.parse(original.toString())), observation = object(row.observation)
  expect(observation.cache).toBeNull(); expect(observation.response).toEqual({ status: 'UNOBSERVED', model: null })
  const invalid = JSON.stringify({ ...row, schemaVersion: 99 })
  await writeFile(path, invalid)
  await expect(f.owner.request('task-read', { id })).rejects.toThrow('EXPERIMENT_OBSERVATION_INVALID')
  expect(await readFile(path, 'utf8')).toBe(invalid)
  await writeFile(path, JSON.stringify({ ...row, observation: { ...observation, response: { status: 'REPORTED', model: 'forged' } } }))
  await expect(f.owner.request('task-read', { id })).rejects.toThrow('EXPERIMENT_OBSERVATION_CONFLICT')
  expect(f.server.requests).toHaveLength(1)
}, 60000)
it.skipIf(process.platform !== 'win32')('previews and sends the exact committed Notebook owner input without synchronization, Agent creation or source writes', async () => {
  const f = await notebookFixture(), capture = await f.ctx.nidofyNotebookV2.input(f.session.id, new AbortController().signal)
  const plan = await f.prepare({ notebookSessionId: f.session.id }), id = randomUUID()
  expect(plan.notebookInput).toEqual(capture); expect(f.server.requests).toEqual([]); expect(f.flush).not.toHaveBeenCalled()
  expect(capture.policy).toEqual({ autoOrganize: false, revision: 0 }); expect(capture.text).toContain('Never run commands')
  await f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })
  const result = await f.settle(id)
  expect(result).toMatchObject({ status: 'COMPLETED', factors: { notebook: 'CAPTURED_INPUT' }, notebookInput: capture, receipt: null })
  expect(object(result.dispatchInput).messages).toMatchObject([{ content: [{ text: f.input.text }, { text: '\n\n' + capture.text }] }])
  expect(object(f.server.requests[0]).messages).toEqual([{ role: 'user', content: f.input.text + '\n\n' + capture.text }])
  expect(f.flush).not.toHaveBeenCalled(); expect(f.counts().commands).toBe(0); expect(f.server.requests).toHaveLength(1)
  const original = await readFile(join(f.base, id, 'notebook-input.json'))
  f.policy.revision++
  expect(await f.owner.request('task-read', { id })).toEqual(result)
  expect(await readFile(join(f.base, id, 'notebook-input.json'))).toEqual(original)
}, 60000)
it.skipIf(process.platform !== 'win32').each(['settings', 'notes', 'generation'])(
  'refuses changed Notebook %s after confirmation and retains zero sends and no task intent', async (changed) => {
    const f = await notebookFixture(), plan = await f.prepare({ notebookSessionId: f.session.id }), id = randomUUID()
    if (changed === 'settings') f.policy.revision++
    else if (changed === 'notes') {
      const store = new NotebookV2Store(f.notes, f.budgets)
      try { await store.publish(1, f.scope, { scope: f.scope, baseRevision: 1, cursors: { evidenceThrough: 0 }, operations: [
        { action: 'UPDATE', id: 'synthetic-note', expectedRevision: 1, kind: 'constraint', text: 'Changed committed note',
          seq: 0, quote: 'Synthetic notebook source' },
      ] }, f.sourceEvents, 'user', new AbortController().signal) } finally { await store.close() }
    } else {
      const directory = join(f.home, 'sessions', '_no-cwd', f.session.id)
      const name = (await readdir(directory)).find(name => /^session(?:\.v\d+)?\.jsonl$/u.test(name))
      if (!name) throw Error('Expected official source generation')
      const path = join(directory, name), replacement = join(f.root, 'replacement-source.bytes')
      await copyFile(path, join(f.root, 'original-source.bytes')); await copyFile(path, replacement); await rename(replacement, path)
    }
    await expect(f.owner.request('task-start', { id, ticket: plan.ticket, accepted: true })).rejects.toThrow()
    expect(f.server.requests).toEqual([]); expect(await f.owner.request('task-read', { id })).toBeNull()
    expect(f.flush).not.toHaveBeenCalled()
  }, 60000)
it.skipIf(process.platform !== 'win32')('reads original journals without sidecars and refuses new admission beside unknown retained residue', async () => {
  const f = await fixture()
  const oldWriter = vi.spyOn(TaskRequestInputs.prototype, 'settle').mockImplementation(function (this: TaskRequestInputs, terminal, stream) {
    oldWriter.mockRestore()
    return this.settle(terminal, stream)
  })
  const { id, result } = await f.run()
  oldWriter.mockRestore()
  expect(result.executionObservation).toBeNull(); expect(result.notebookInput).toBeNull()
  expect(result.status).toBe('COMPLETED'); expect(f.server.requests).toHaveLength(1)
  const files = await readdir(join(f.base, id))
  expect(files).not.toContain('execution-observation.json'); expect(files).not.toContain('notebook-input.json')
  const path = join(f.base, id, 'unknown-retained.bytes'), bytes = 'Preserve this unknown residue'
  await writeFile(path, bytes)
  const plan = await f.prepare()
  await expect(f.owner.request('task-start', { id: randomUUID(), ticket: plan.ticket, accepted: true }))
    .rejects.toThrow('EXPERIMENT_TASK_RECORD_INVALID')
  expect(await readFile(path, 'utf8')).toBe(bytes); expect(f.server.requests).toHaveLength(1)
}, 60000)
it.skipIf(process.platform !== 'win32')('cancels an unconfirmed Notebook preview read with its HTTP lifetime without allocating a task or sending', async () => {
  const f = await notebookFixture(), entered = Promise.withResolvers<undefined>(), controller = new AbortController()
  const reserve = vi.spyOn(f.storage, 'reserve')
  vi.spyOn(f.ctx.nidofyNotebookV2, 'input').mockImplementationOnce((_id, signal) => new Promise((_resolve, reject) => {
    entered.resolve(undefined)
    signal.addEventListener('abort', () => { reject(signal.reason instanceof Error ? signal.reason : Error('SYNTHETIC_PREVIEW_CLOSED')) }, { once: true })
  }))
  const pending = f.owner.request('task-prepare', { ...f.input, notebookSessionId: f.session.id }, controller.signal)
  const rejected = expect(pending).rejects.toThrow('SYNTHETIC_PREVIEW_CLOSED')
  await entered.promise; controller.abort(Error('SYNTHETIC_PREVIEW_CLOSED')); await rejected
  expect(reserve).not.toHaveBeenCalled(); expect(f.server.requests).toEqual([]); expect(f.flush).not.toHaveBeenCalled()
}, 60000)
