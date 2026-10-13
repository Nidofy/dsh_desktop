/** Desktop policy denial uses real local sinks, adapters, credential leases and quota refusal. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkspaceRegistry, Workspace } from '@deepseek-ai/dsh-workspace'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { StorageService, StorageOperationId, ManagedRootId, QuotaLeaseId } from '@nidofy/dsh-desktop-extras/storage'
import { PiAiAdapter, resolveProfiles, authContextFrom, credentialStoreFrom } from '@deepseek-ai/dsh-llm-pi-ai'
import { DesktopEgressPolicy, distributionEgress } from '../src/connections/egress.ts'
import { installConnections } from '../src/connections/runtime.ts'
import { bootServices, credentialMemory } from './connection-backend.ts'
import { mockServer, textEvents, closeMockServers } from '../../../packages/llm/llm-pi-ai/tests/mock-server.ts'
import { discoverModels } from '../../../packages/llm/llm-pi-ai/src/discovery.ts'
import { DeepSeekAdapter } from '../../../packages/llm/llm-deepseek/src/adapter.ts'
import { DeepSeekFileStore } from '../../../packages/llm/llm-deepseek/src/file-store.ts'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek-api-key'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { options as messagesOptions, textEvents as messagesEvents } from '../../../packages/llm/llm-deepseek/tests/helpers.ts'
import { startHttpMcpFixture } from '../../../packages/mcp/mcp-client/tests/http-fixture.ts'
import { startConnection, resolveReconnectPolicy } from '../../../packages/mcp/mcp-client/src/connection.ts'
import { Config as mcpConfig } from '../../../packages/mcp/mcp-client/src/index.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'

const cleanup: Array<() => Promise<void>> = []
const readHooks = vi.hoisted(() => ({ afterRead: undefined as ((path: unknown) => void) | undefined }))
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  return { ...real, readFile: async (...args: Parameters<typeof real.readFile>) => {
    const result = await real.readFile(...args)
    readHooks.afterRead?.(args[0])
    return result
  } }
})
afterEach(async () => {
  readHooks.afterRead = undefined
  while (cleanup.length) await cleanup.pop()!()
  await closeMockServers()
})
async function fixture(allowed: readonly string[] | null = null) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-egress-'))
  const index = resolve('.build/dispatch/evidence/relay-25/input-roots')
  await mkdir(index, { recursive: true })
  await writeFile(join(index, 'egress-' + randomUUID() + '.json'), JSON.stringify({ root: home,
    synthetic: true, retained: true, kind: 'http-policy-unit', paidRequests: 0 }) + '\n', { flag: 'wx' })
  const ctx = new Context(), memory = credentialMemory()
  await bootServices(ctx, memory)
  cleanup.push(() => ctx.fiber.dispose())
  const policy = new DesktopEgressPolicy(home, distributionEgress({ schemaVersion: 1, revision: 'fixture-1', origins: allowed }, false))
  policy.bind(ctx); ctx.provide('outboundHttp', policy)
  const quota = { refused: false }
  const storage: Pick<StorageService, 'write' | 'reserve'> = {
    write: async <T>(_path: string, _bytes: number, work: () => Promise<T>) => {
      if (quota.refused) throw Error('SYNTHETIC_QUOTA_REFUSED')
      return work()
    },
    reserve: async (_scope: string, maxWriteBytes: number, terminalBytes: number, operationId?: StorageOperationId) => {
      const metadata = { id: brandString<QuotaLeaseId>(randomUUID()),
        operationId: operationId ?? brandString<StorageOperationId>(randomUUID()),
        rootId: brandString<ManagedRootId>(randomUUID()),
        reservedBytes: maxWriteBytes, terminalBytes }
      return { ...metadata, run: async work => work(), terminal: async work => work(),
        release: async () => ({ ...metadata, status: 'settled' as const, phase: 'settled' }) }
    },
  }
  ctx.provide('nidofyStorage', storage as StorageService)
  const path = join(home, 'nidofy-connections', 'egress.json')
  await mkdir(join(home, 'nidofy-connections'))
  const set = (profile: readonly string[] | null, revision = 1,
    workspaces: Array<{ id: string; path: string; origins: readonly string[] | null }> = []) =>
    writeFile(path, JSON.stringify({ schemaVersion: 1, revision, profile, workspaces }))
  return { home, ctx, memory, policy, path, set, quota }
}
async function collect(stream: AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
const message = () => createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })

it('sends allowed requests with the original auth headers and refuses a different origin before its sink sees bytes', async () => {
  const first = await mockServer([{ body: '{}' }]), second = await mockServer([{ body: '{}' }])
  const { policy } = await fixture([first.url, second.url]), lease = await policy.prepare(first.url)
  await lease.fetchFor()(first.url, { headers: { authorization: 'Bearer SYNTHETIC', 'x-api-key': 'SYNTHETIC', cookie: 'SYNTHETIC' } })
  expect(first.headers[0]).toMatchObject({ authorization: 'Bearer SYNTHETIC', 'x-api-key': 'SYNTHETIC', cookie: 'SYNTHETIC' })
  await expect(lease.fetchFor()(second.url)).rejects.toThrow('EGRESS_ORIGIN_CHANGED')
  expect(second.paths).toEqual([])
})

it.each([301, 302, 303, 307, 308])('rejects redirect %i even when its target origin is allowed', async (status) => {
  const sink = await mockServer([{ body: '{}' }])
  const source = await mockServer([{ status, headers: { location: sink.url } }])
  const { policy } = await fixture([source.url, sink.url])
  await expect((await policy.prepare(source.url)).fetchFor()(source.url, { method: 'POST', body: '{}', headers: { authorization: 'Bearer SYNTHETIC', 'x-api-key': 'SYNTHETIC' } })).rejects.toThrow()
  expect(source.paths).toHaveLength(1); expect(sink.paths).toEqual([])
})

it('refuses widening and same-revision byte edits after preparation; a fresh prepare observes the new policy', async () => {
  const endpoint = await mockServer([{ body: '{}' }]), f = await fixture([endpoint.url])
  await f.set([endpoint.url])
  const lease = await f.policy.prepare(endpoint.url)
  await f.set(null, 2)
  await expect(lease.fetchFor()(endpoint.url)).rejects.toThrow('EGRESS_REVISION_CHANGED')
  const next = await f.policy.prepare(endpoint.url)
  await f.set([], 2)
  await expect(next.fetchFor()(endpoint.url)).rejects.toThrow('EGRESS_REVISION_CHANGED')
  await expect(f.policy.prepare(endpoint.url)).rejects.toThrow('EGRESS_TARGET_REFUSED')
  expect(endpoint.paths).toEqual([])
})

it('uses exact real Workspace attachment and rejects its revocation; unscoped calls cannot bypass narrower rules', async () => {
  const endpoint = await mockServer([{ body: '{}' }]), f = await fixture([endpoint.url])
  const sessionId = SessionId('actual-session'), id = WorkspaceId('actual-workspace')
  let attached = true
  const workspace: Pick<Workspace, 'id' | 'path' | 'sessionIds'> = { id, path: f.home, sessionIds: [sessionId] }
  f.ctx.provide('workspaceRegistry', { list: () => attached ? [workspace] : [] } as WorkspaceRegistry)
  await f.set(null, 1, [{ id, path: f.home, origins: [endpoint.url] }])
  const lease = await f.policy.prepare(endpoint.url)
  await lease.check(sessionId)
  attached = false
  await expect(lease.fetchFor(sessionId)(endpoint.url)).rejects.toThrow('EGRESS_WORKSPACE_CHANGED')
  await f.set(null, 2, [{ id, path: f.home, origins: [] }])
  const narrowed = await f.policy.prepare(endpoint.url)
  await narrowed.checkConfiguration()
  await expect(narrowed.fetchFor()(endpoint.url)).rejects.toThrow('EGRESS_WORKSPACE_REFUSED')
  expect(endpoint.paths).toEqual([])
})

it('CAS-saves through quota, cold-reads committed settings and preserves malformed/future bytes', async () => {
  const f = await fixture()
  const input = { action: 'save', expectedRevision: 0, policy: { schemaVersion: 1, revision: 0, profile: [], workspaces: [] } }
  const saved = await f.policy.request(input)
  expect(saved.policy.revision).toBe(1)
  await expect(f.policy.request(input)).rejects.toThrow('EGRESS_POLICY_CONFLICT')
  const cold = new DesktopEgressPolicy(f.home, distributionEgress(undefined, false))
  cleanup.push(() => cold.close())
  expect((await cold.request({ action: 'status' })).policy).toEqual(saved.policy)
  for (const bytes of ['broken JSON', '{"schemaVersion":99}']) {
    await writeFile(f.path, bytes)
    await expect(f.policy.prepare('https://synthetic.invalid')).rejects.toThrow()
    await expect(f.policy.request(input)).rejects.toThrow()
    expect(await readFile(f.path, 'utf8')).toBe(bytes)
  }
})

it('refuses Workspace revocation during the final policy read before sending headers', async () => {
  const endpoint = await mockServer([{ body: '{}' }]), f = await fixture([endpoint.url])
  const sessionId = SessionId('final-read-session'), id = WorkspaceId('final-read-workspace')
  let attached = true, reads = 0
  const workspace: Pick<Workspace, 'id' | 'path' | 'sessionIds'> = { id, path: f.home, sessionIds: [sessionId] }
  f.ctx.provide('workspaceRegistry', { list: () => attached ? [workspace] : [] } as WorkspaceRegistry)
  await f.set(null, 1, [{ id, path: f.home, origins: [endpoint.url] }])
  const lease = await f.policy.prepare(endpoint.url)
  readHooks.afterRead = (path) => { if (path === f.path && ++reads === 2) attached = false }
  await expect(lease.fetchFor(sessionId)(endpoint.url, { headers: { authorization: 'Bearer SYNTHETIC' } }))
    .rejects.toThrow('EGRESS_WORKSPACE_CHANGED')
  expect(endpoint.paths).toEqual([])
})

it('rejects quota before policy publication and rejects new requests after disposal', async () => {
  const f = await fixture()
  f.quota.refused = true
  await expect(f.policy.request({ action: 'save', expectedRevision: 0, policy: { schemaVersion: 1, revision: 0, profile: [], workspaces: [] } })).rejects.toThrow('SYNTHETIC_QUOTA_REFUSED')
  expect((await f.policy.request({ action: 'status' })).policy.revision).toBe(0)
  await f.policy.close()
  await expect(f.policy.prepare('https://synthetic.invalid')).rejects.toThrow('EGRESS_OWNER_STOPPED')
})

it('rejects a managed save before journal or secrets, then sends an allowed managed prepared call', async () => {
  const endpoint = await mockServer([{ events: textEvents }]), f = await fixture([endpoint.url])
  const store = await installConnections(f.ctx, join(f.home, 'connections'))
  const profile = { api: 'openai-completions', baseURL: endpoint.url,
    models: [{ id: 'synthetic-model' }], retryPolicy: { mode: 'normal', maxRetries: 0 } }
  const request = { action: 'save', operationId: randomUUID(), connection: 'local', expectedRevision: 0,
    profile: { ...profile, baseURL: 'https://refused.invalid' }, credential: { mode: 'replace', value: 'SYNTHETIC' } }
  await expect(store.mutate(request)).rejects.toThrow('EGRESS_TARGET_REFUSED')
  expect(f.memory.values.size).toBe(0); expect(store.state.revision).toBe(0)
  await store.mutate({ ...request, operationId: randomUUID(), profile })
  const call = await f.ctx.llm.prepareCall({ provider: 'nidofy-local', model: 'synthetic-model' })
  const chunks = await collect(call.stream({ ...call.config, messages: [message()] }))
  expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'hello' }))
  expect(endpoint.headers[0]?.authorization).toBe('Bearer SYNTHETIC')
  const pending = await f.ctx.llm.prepareCall({ provider: 'nidofy-local', model: 'synthetic-model' })
  await f.set([])
  const denied = await collect(pending.stream({ ...pending.config, messages: [message()] }))
  expect(denied.at(-1)).toMatchSnapshot()
  expect(endpoint.paths).toHaveLength(1)
})

it('binds official PiAi policy at prepare and rejects a later policy edit without provider traffic', async () => {
  const endpoint = await mockServer([{ events: textEvents }]), f = await fixture([endpoint.url])
  const profiles = resolveProfiles({ local: { api: 'openai-completions', baseURL: endpoint.url, models: [{ id: 'synthetic-model' }], apiKeyEnv: 'SYNTHETIC_KEY' } })
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve('SYNTHETIC'),
    auth: { authContext: authContextFrom(f.ctx), credentials: credentialStoreFrom(f.ctx) }, prepareHttp: url => f.policy.prepare(url) })
  const call = await adapter.prepareCall('local', 'synthetic-model')
  await f.set(null)
  await expect(collect(call.stream({ provider: 'local', model: 'synthetic-model', messages: [message()] })))
    .rejects.toThrow('EGRESS_REVISION_CHANGED')
  expect(endpoint.paths).toEqual([])
})

it('keeps intranet default-deny and refuses credentialed targets and unbounded packaged permission', async () => {
  expect(distributionEgress(undefined, true).origins).toEqual([])
  expect(() => distributionEgress({ schemaVersion: 1, revision: 'unsafe', origins: null }, true)).toThrow('EGRESS_DISTRIBUTION_INVALID')
  const f = await fixture()
  await expect(f.policy.prepare('https://SYNTHETIC:KEY@synthetic.invalid')).rejects.toThrow('EGRESS_TARGET_INVALID')
})

it('uses discovery authorization before key resolution and refuses its redirect sink', async () => {
  const sink = await mockServer([{ body: '{}' }]), source = await mockServer([{ status: 307, headers: { location: sink.url } }])
  const f = await fixture([source.url, sink.url])
  await expect(discoverModels({ baseURL: source.url, api: 'openai-completions', apiKey: 'SYNTHETIC' },
    undefined, url => f.policy.prepare(url))).rejects.toThrow()
  expect(source.headers[0]?.authorization).toBe('Bearer SYNTHETIC'); expect(sink.paths).toEqual([])
})

it('sends actual DeepSeek Messages and Files requests through the captured policy and refuses later sends', async () => {
  const endpoint = await mockServer([{ events: messagesEvents.map(value => JSON.stringify(value)) }, { body: '{"data":[],"has_more":false}' }])
  const f = await fixture([endpoint.url])
  const adapter = new DeepSeekAdapter({ options: () => resolveAdapterOptions({ baseURL: endpoint.url }),
    resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'SYNTHETIC' } }),
    resolveUserId: () => 'SYNTHETIC_USER' as AnonymousUserId,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }), prepareHttp: url => f.policy.prepare(url) })
  const call = await adapter.prepareCall('deepseek-official', 'deepseek-v4-flash')
  const chunks = await collect(call.stream(messagesOptions()))
  expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'Hello 世界' }))
  const lease = await f.policy.prepare(endpoint.url), files = new DeepSeekFileStore()
  const connection = { baseURL: endpoint.url, headers: { 'x-api-key': 'SYNTHETIC' }, fetch: lease.fetchFor() }
  expect(await files.reclaimOldestOwned(connection, 1)).toBe(0)
  expect(endpoint.paths).toEqual(['/v1/messages', '/v1/files?limit=1000'])
  const prepared = await adapter.prepareCall('deepseek-official', 'deepseek-v4-flash')
  await f.set([])
  await expect(collect(prepared.stream(messagesOptions()))).rejects.toThrow()
  await expect(files.reclaimOldestOwned(connection, 1)).rejects.toThrow()
  expect(endpoint.paths).toHaveLength(2)
})

it('uses the real MCP HTTP negotiation transport and refuses a new denied generation before its endpoint receives bytes', async () => {
  const endpoint = await startHttpMcpFixture(); cleanup.push(endpoint.close)
  const f = await fixture([new URL(endpoint.url).origin])
  const tools: Pick<ToolRuntime, 'register'> = { register: _definition => () => {} }
  f.ctx.provide('tools', tools as ToolRuntime)
  const config = mcpConfig({ transport: 'streamable-http', url: endpoint.url,
    headers: { authorization: 'Bearer SYNTHETIC' }, serverName: 'fixture', reconnect: { enabled: false } })
  const handle = startConnection(f.ctx, config, resolveReconnectPolicy({ enabled: false }, 'fixture'))
  cleanup.push(() => handle.dispose())
  expect(await handle.ready).toEqual({})
  expect(endpoint.authorization.length).toBeGreaterThan(0)
  expect(endpoint.authorization.every(value => value === 'Bearer SYNTHETIC')).toBe(true)
  await f.set([])
  const before = endpoint.authorization.length
  const denied = startConnection(f.ctx, config, resolveReconnectPolicy({ enabled: false }, 'fixture'))
  cleanup.push(() => denied.dispose())
  expect((await denied.ready).error).toBeInstanceOf(Error)
  expect(endpoint.authorization).toHaveLength(before)
})
