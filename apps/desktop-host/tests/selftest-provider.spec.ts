/** Real managed PiAi/HTTP policies and official cold Session logs against a local synthetic SSE provider; no Agent or paid endpoint. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { StorageService, QuotaLeaseId, ManagedRootId, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { bootServices, credentialMemory } from './connection-backend.ts'
import { mockServer, closeMockServers } from '../../../packages/llm/llm-pi-ai/tests/mock-server.ts'
import { installConnections } from '../src/connections/runtime.ts'
import { DesktopEgressPolicy, distributionEgress } from '../src/connections/egress.ts'
import { SelfTestStore } from '../src/selftest/store.ts'
import { SelfTestRunner } from '../src/selftest/runner.ts'
import { SelfTestConnectionOwner } from '../src/selftest/provider.ts'
import { SelfTestInputs } from '../src/selftest/inputs.ts'

const usage = { prompt_tokens: 512, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 16 } }
const toolEvents = [JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [
  { index: 0, id: 'echo-local', type: 'function', function: { name: 'selftest_echo', arguments: '{"value":"synthetic"}' } },
] }, finish_reason: null }] }), JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage }), '[DONE]']
const textEvents = [JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] }),
  JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }), '[DONE]']

async function fixture(script: Parameters<typeof mockServer>[0] = [{ events: toolEvents },
  ...Array.from({ length: 4 }, () => ({ events: textEvents }))]) {
  const root = await mkdtemp(join(tmpdir(), 'selftest-provider-')), home = join(root, 'home'); await mkdir(home)
  const server = await mockServer(script), ctx = new Context(), memory = credentialMemory()
  await bootServices(ctx, memory)
  const storage: Pick<StorageService, 'write' | 'reserve'> = {
    write: async (_path, _bytes, work) => work(),
    reserve: async (_scope, reservedBytes, terminalBytes, operationId) => ({ id: brandString<QuotaLeaseId>(randomUUID()),
      rootId: brandString<ManagedRootId>('synthetic-root'), operationId: operationId ?? brandString<StorageOperationId>(randomUUID()),
      reservedBytes, terminalBytes, run: work => work(), terminal: work => work(), release: async () => ({ status: 'unknown' }) }),
  }
  const policy = new DesktopEgressPolicy(home, distributionEgress({ schemaVersion: 1, revision: 'synthetic-v1', origins: [server.url] }, false))
  ctx.provide('outboundHttp', policy); policy.bind(ctx)
  const store = await installConnections(ctx, join(home, 'nidofy-connections'))
  const profile = { api: 'openai-completions', baseURL: server.url + '/v1', models: [{ id: 'synthetic-model' }],
    defaultContextWindow: 8192, defaultMaxTokens: 64, retryPolicy: { mode: 'normal', maxRetries: 0 } }
  await store.mutate({ action: 'save', operationId: randomUUID(), connection: 'local', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-private-key' } })
  const reports = new SelfTestStore(home, storage), owner = new SelfTestConnectionOwner(ctx, home, store, storage)
  const failures: string[] = [], take = owner.take.bind(owner)
  vi.spyOn(owner, 'take').mockImplementation((ticket) => {
    const plan = take(ticket)
    return { ...plan, create: (id) => {
      const checks = plan.create(id)
      return { open: async (signal) => { try { await checks.open(signal) } catch (error) { failures.push(String(error)); throw error } },
        check: async (id, signal) => {
          try { return await checks.check(id, signal) } catch (error) { failures.push(String(error)); throw error }
        },
        close: () => checks.close() }
    } }
  })
  const runner = new SelfTestRunner(reports, storage, () => { throw Error('Unexpected local provider') }, owner)
  onTestFinished(async () => {
    await runner.close(); await ctx.fiber.dispose(); await closeMockServers(); await rm(root, { recursive: true, force: true })
  })
  const prepare = (requests = 5) => owner.prepare({ connection: 'local', model: 'synthetic-model', requests })
  const settle = async (id: string) => {
    await expect.poll(async () => (await runner.read(id))?.status, { timeout: 15000 }).not.toBe('RUNNING')
    const report = await runner.read(id); if (!report) throw Error('Missing report'); return report
  }
  return { root, home, ctx, memory, server, storage, store, profile, reports, owner, runner, prepare, settle, failures }
}

it('reads empty input capacity without allocating directories, reading credentials or preparing a call', async () => {
  const f = await fixture(), writes = vi.spyOn(f.storage, 'write'), prepare = vi.spyOn(f.ctx.llm, 'prepareCall')
  let credentialReads = 0
  f.memory.beforeGet = () => { credentialReads++; return Promise.resolve() }
  expect(await f.runner.request('connection-capacity', {})).toEqual({ roots: 0, unsettled: 0, available: true, code: 'OK' })
  await expect(lstat(join(f.home, 'nidofy-extras/selftests/inputs'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(f.runner.request('connection-capacity', { path: f.home })).rejects.toThrow('SELFTEST_INPUT_INVALID')
  expect(writes).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(credentialReads).toBe(0)
  expect(f.server.requests).toEqual([])
})

it('reports a full input namespace without inspecting or deleting its retained bytes', async () => {
  const f = await fixture(), base = join(f.home, 'nidofy-extras/selftests/inputs'); await mkdir(base, { recursive: true })
  const bytes: { path: string; value: string }[] = []
  for (let index = 0; index < 20; index++) {
    const path = join(base, randomUUID()); await mkdir(path)
    const file = join(path, 'preserved.txt'), value = 'Retained unknown input ' + String(index)
    await writeFile(file, value); bytes.push({ path: file, value })
  }
  expect(await f.runner.request('connection-capacity', {})).toEqual({ roots: 20, unsettled: null,
    available: false, code: 'SELFTEST_INPUT_LOG_LIMIT' })
  for (const row of bytes) expect(await readFile(row.path, 'utf8')).toBe(row.value)
  expect(await readdir(base)).toHaveLength(20); expect(f.server.requests).toEqual([])
})

it('cancels capacity reads and waits for their actual drain during owner shutdown', async () => {
  const f = await fixture(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const spy = vi.spyOn(SelfTestInputs.prototype, 'capacity').mockImplementation(async (signal) => {
    entered.resolve(undefined); await release.promise; signal.throwIfAborted()
    return { roots: 0, unsettled: 0, available: true, code: 'OK' }
  })
  onTestFinished(() => { spy.mockRestore() })
  const reading = f.runner.request('connection-capacity', {}), rejected = expect(reading).rejects.toThrow()
  await entered.promise
  let drained = false
  const closing = f.runner.close().then(() => { drained = true })
  await Promise.resolve(); expect(drained).toBe(false)
  await expect(f.runner.request('connection-capacity', {})).rejects.toThrow('SELFTEST_STOPPING')
  release.resolve(undefined); await rejected; await closing
  expect(drained).toBe(true); expect(f.server.requests).toEqual([])
})

it('confirms real independent revisions, sends exactly five logged fixed requests, and keeps exports secret-free', async () => {
  const f = await fixture(), confirmation = await f.prepare()
  expect(confirmation).toMatchObject({ configurationRevision: 1, policyRevision: { distribution: 'synthetic-v1', profile: 0 }, requests: 5, maxOutputTokens: 64, retries: 0 })
  expect(f.server.requests).toEqual([])
  const id = randomUUID(); await f.runner.start({ mode: 'provider', operationId: id, ticket: confirmation.ticket, accepted: true })
  const report = await f.settle(id)
  expect(report.status, JSON.stringify(f.failures)).toBe('COMPLETED'); expect(report.rows.filter(row => row.status === 'PASS')).toHaveLength(5)
  expect(report.rows.slice(-2).every(row => row.status === 'UNKNOWN')).toBe(true)
  expect(f.server.requests).toHaveLength(5); expect(f.store.status().activeLeases).toBe(0)
  expect(await f.runner.request('connection-capacity', {})).toEqual({ roots: 1, unsettled: 0, available: true, code: 'OK' })
  expect(f.server.requests).toHaveLength(5)
  const cold = new Context(); await cold.plugin(JsonlSessionPersistence, { root: join(f.home, 'nidofy-extras/selftests/inputs', id), compression: 'none' })
  try {
    const logs = await cold.sessionPersistence.list(); expect(logs).toHaveLength(5)
    for (const entry of logs) {
      const observed = await cold.sessionPersistence.observeDurable(entry.header.id)
      const session = Session.create(observed.meta.id, observed.events, observed.meta), header = session.requestHeader()!
      expect(header.config).toMatchObject({ model: 'synthetic-model', maxTokens: 64 })
      const body = f.server.requests[Number(String(entry.header.id).split('-').at(-1))] as { messages: { content: string }[]; max_tokens?: number; max_completion_tokens?: number; tools?: unknown[] }
      expect(body.max_tokens ?? body.max_completion_tokens).toBe(64)
      const firstContent = session.deriveMessages()[0]?.content[0]
      expect(body.messages[0]?.content).toBe(firstContent?.type === 'text' ? firstContent.text : undefined)
      expect(body.tools?.length ?? 0).toBe(header.tools?.length ?? 0)
    }
  } finally { await cold.fiber.dispose() }
  const exported = JSON.stringify(f.reports.export(report))
  for (const forbidden of [id, f.home, f.server.url, 'synthetic-model', 'synthetic-private-key', 'Call selftest_echo']) expect(exported).not.toContain(forbidden)
  await expect(f.runner.start({ mode: 'provider', operationId: randomUUID(), ticket: confirmation.ticket, accepted: true })).rejects.toThrow('SELFTEST_CONFIRMATION_EXPIRED')
})

it.each(['failure', 'max-tokens', 'missing-counter'])('stops after %s without retries, failover or supplemental requests', async (kind) => {
  const events = kind === 'max-tokens' ? toolEvents.map(event => event.replace('"finish_reason":"tool_calls"', '"finish_reason":"length"'))
    : toolEvents.map(event => event.replace('"cached_tokens":16', '"cached_tokens":0'))
  const f = await fixture(kind === 'failure' ? [{ status: 500, body: '{"error":{"message":"synthetic"}}' }] : [{ events }])
  const plan = await f.prepare(), id = randomUUID(); await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  const report = await f.settle(id)
  expect(report.status).toBe('FAILED'); expect(f.server.requests).toHaveLength(1)
  expect(report.rows.find(row => row.id === 'cache-repeat')?.status).toBe('SKIPPED')
  expect(f.store.status().activeLeases).toBe(0)
})

it.each(['connection', 'policy', 'owner'])('refuses stale %s before any actual send', async (changed) => {
  const f = await fixture(), plan = await f.prepare()
  if (changed === 'connection') await f.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'local', expectedRevision: 1,
    profile: f.profile, credential: { mode: 'keep' } })
  if (changed === 'policy') await writeFile(join(f.home, 'nidofy-connections/egress.json'), JSON.stringify({ schemaVersion: 1, revision: 1, profile: [], workspaces: [] }))
  if (changed === 'owner') f.ctx.set('outboundHttp', new DesktopEgressPolicy(f.home, distributionEgress(undefined, false)))
  const id = randomUUID(); await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  expect((await f.settle(id)).status).toBe('FAILED'); expect(f.server.requests).toEqual([])
})

it('refuses missing confirmation and reduced budgets, and stops after an uncertain input commit with zero sends', async () => {
  const f = await fixture(), plan = await f.prepare(1)
  await expect(f.runner.start({ mode: 'provider', operationId: randomUUID(), ticket: plan.ticket })).rejects.toThrow('SELFTEST_INPUT_INVALID')
  const write = f.storage.write.bind(f.storage)
  let inputWrites = 0
  vi.spyOn(f.storage, 'write').mockImplementation(async (path, bytes, work) => {
    if (path.includes('inputs') && ++inputWrites === 2) throw Error('SYNTHETIC_INPUT_COMMIT_UNKNOWN')
    return write(path, bytes, work)
  })
  const id = randomUUID(); await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  expect((await f.settle(id)).status).toBe('FAILED'); expect(f.server.requests).toEqual([])
  expect(await readdir(join(f.home, 'nidofy-extras/selftests/reports'))).toContain(id + '.json')
  expect((await readFile(join(f.home, 'nidofy-extras/selftests/reports', id + '.json'), 'utf8'))).not.toContain('synthetic-private-key')
})

it('honors a smaller confirmed request budget without partially starting the four-request cache measurement', async () => {
  const f = await fixture(), plan = await f.prepare(1), id = randomUUID()
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  const report = await f.settle(id)
  expect(report.rows.find(row => row.id === 'cache-repeat')).toMatchObject({ status: 'UNKNOWN', code: 'REQUEST_BUDGET_EXHAUSTED' })
  expect(f.server.requests).toHaveLength(1)
})

it('rechecks the captured HTTP policy after an actual request and sends no later cache request', async () => {
  const f = await fixture(), plan = await f.prepare(), id = randomUUID(), fetch = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await fetch(input, init)
    await writeFile(join(f.home, 'nidofy-connections/egress.json'), JSON.stringify({ schemaVersion: 1, revision: 1, profile: [], workspaces: [] }))
    return response
  })
  onTestFinished(() => { spy.mockRestore() })
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  const report = await f.settle(id)
  expect(report.status).toBe('FAILED'); expect(f.server.requests).toHaveLength(1)
  expect(report.rows.find(row => row.id === 'cache-repeat')?.status).toBe('SKIPPED')
})

it('cancels an actually started SSE request and drains the provider before returning or releasing its leases', async () => {
  const f = await fixture([{ events: toolEvents, delayMs: 1000 }]), plan = await f.prepare(), id = randomUUID()
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  await expect.poll(() => f.server.requests.length).toBe(1)
  const before = await readFile(join(f.reports.directory, id + '.json'))
  expect((await new SelfTestStore(f.home, f.storage).read(id))?.status).toBe('INTERRUPTED')
  expect(await readFile(join(f.reports.directory, id + '.json'))).toEqual(before)
  await f.runner.cancel(id)
  expect((await f.runner.read(id))?.status).toBe('CANCELLED')
  await f.server.responseClosed
  expect(f.server.requests).toHaveLength(1); expect(f.store.status().activeLeases).toBe(0)
})

it.each(['future-marker', 'ten-unsettled', 'entries'])('preserves retained input roots and refuses allocation for %s with no sends', async (kind) => {
  const f = await fixture(), base = join(f.home, 'nidofy-extras/selftests/inputs'), bytes: { path: string; value: string }[] = []
  await mkdir(base, { recursive: true })
  for (let index = 0; index < (kind === 'ten-unsettled' ? 10 : 1); index++) {
    const id = randomUUID(), root = join(base, id); await mkdir(root)
    const info = await lstat(root, { bigint: true }), path = join(root, 'owner.json')
    const value = JSON.stringify({ schemaVersion: kind === 'future-marker' ? 99 : 1, id,
      root: await realpath(root), identity: `${info.dev}:${info.ino}` })
    await writeFile(path, value); bytes.push({ path, value })
    if (kind === 'entries') for (const directory of ['first', 'second', 'third']) {
      const nested = join(root, directory); await mkdir(nested)
      for (let file = 0; file < 32; file++) await writeFile(join(nested, String(file)), '')
    }
  }
  if (kind === 'ten-unsettled') expect(await f.runner.request('connection-capacity', {})).toEqual({ roots: 10, unsettled: 10,
    available: false, code: 'SELFTEST_LEFTOVER_LIMIT' })
  else await expect(f.runner.request('connection-capacity', {})).rejects.toThrow(kind === 'future-marker'
    ? 'SELFTEST_PATH_REFUSED' : 'SELFTEST_INPUT_LOG_LIMIT')
  const plan = await f.prepare(), id = randomUUID()
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  expect((await f.settle(id)).status).toBe('FAILED'); expect(f.server.requests).toEqual([])
  expect(await readdir(base)).toHaveLength(bytes.length)
  for (const row of bytes) expect(await readFile(row.path, 'utf8')).toBe(row.value)
})

it('consumes an official generation-protection refusal after logging without sending or retrying', async () => {
  const f = await fixture(), plan = await f.prepare(), id = randomUUID()
  const spy = vi.spyOn(JsonlSessionPersistence.prototype, 'withGeneration').mockRejectedValueOnce(Error('SESSION_GENERATION_CHANGED'))
  onTestFinished(() => { spy.mockRestore() })
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  expect((await f.settle(id)).status).toBe('FAILED'); expect(f.server.requests).toEqual([])
  expect(spy).toHaveBeenCalledTimes(1)
  const cold = new Context(); await cold.plugin(JsonlSessionPersistence, {
    root: join(f.home, 'nidofy-extras/selftests/inputs', id), compression: 'none',
  })
  try { expect(await cold.sessionPersistence.list()).toHaveLength(1) } finally { await cold.fiber.dispose() }
})

it('admits generation-lock metadata through the storage owner and refuses dispatch quota before sending', async () => {
  const f = await fixture(), plan = await f.prepare(), id = randomUUID(), write = f.storage.write.bind(f.storage)
  let inputWrites = 0
  vi.spyOn(f.storage, 'write').mockImplementation(async (path, bytes, work) => {
    if (path.includes('inputs') && ++inputWrites === 3) throw Error('STORAGE_RESERVE_FAILED')
    return write(path, bytes, work)
  })
  await f.runner.start({ mode: 'provider', operationId: id, ticket: plan.ticket, accepted: true })
  expect((await f.settle(id)).status).toBe('FAILED'); expect(f.server.requests).toEqual([])
  expect(inputWrites).toBe(3); expect(f.store.status().activeLeases).toBe(0)
})
