/** Connection API replay over a real HTTP server and the real connection/request waterfall. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection'
import { installConnectionApi } from '../src/connections/api.ts'
import { bootServices, credentialMemory } from './connection-backend.ts'
import type { CredentialMemory } from './connection-backend.ts'

const injection = vi.hoisted(() => ({ failLedger: false }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (original) => {
  const real = await original<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...real, writeFileAtomic: async (...args: Parameters<typeof real.writeFileAtomic>) => {
    if (injection.failLedger && args[0].endsWith('cleanup.json')) throw new Error('SYNTHETIC_LEDGER_DENIED')
    return real.writeFileAtomic(...args)
  } }
})

/** Registration-only tools stand-in: the workbench installs two tools at mount, and the
 * replayed connection endpoints never dispatch tools. The real ToolRuntime cannot mount
 * here because its systemPrompt injection is not a desktop-host dependency. */
const toolsStandIn = (): ToolRuntime => {
  const standIn: Pick<ToolRuntime, 'register'> = { register: () => () => {} }
  return standIn as ToolRuntime
}

const profile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] }
const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  injection.failLedger = false
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Serve the registered connection/request listeners over a real local HTTP server on an ephemeral port. */
async function serve(ctx: Context): Promise<string> {
  const server = createServer((request, response) => {
    void ctx.waterfall('connection/request', request, response, () => {
      response.writeHead(404)
      response.end('{}')
      return Promise.resolve()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

const post = async (base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

/** A fully booted epoch: services, connection API installed, and its endpoints served over HTTP. */
async function booted(memory: CredentialMemory, home: string): Promise<{ ctx: Context; base: string }> {
  const ctx = new Context()
  await bootServices(ctx, memory)
  ctx.provide('tools', toolsStandIn())
  await installConnectionApi(ctx, home)
  return { ctx, base: await serve(ctx) }
}

it('replays the repair flows over HTTP: keep, replace, legacy wire, conflict, and backend refusal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-api-')); roots.push(home)
  const memory = credentialMemory()
  const { ctx, base } = await booted(memory, home)
  try {
    const page = await fetch(`${base}/api/nidofy/ui?locale=zh-CN`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toContain('留空保留已存凭据')

    const empty = await post(base, '/api/nidofy/status', {})
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({ recovery: 'ready', cleanupRecord: 'none', connections: [] })

    const replaced = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 0, profile, credential: { mode: 'replace', value: 'synthetic-A' } })
    expect(replaced.status).toBe(200)
    expect(replaced.body).toMatchObject({ desiredRevision: 1, recovery: 'ready' })

    const kept = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 1, profile: { ...profile, displayName: 'renamed' }, credential: { mode: 'keep' } })
    expect(kept.status).toBe(200)
    expect(kept.body).toMatchObject({ desiredRevision: 2 })
    expect((kept.body.connections as Record<string, unknown>[])[0]).toMatchObject({ availability: 'available' })

    const legacy = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'two', expectedRevision: 2, profile, key: 'synthetic-legacy' })
    expect(legacy.status).toBe(200)
    expect(legacy.body).toMatchObject({ desiredRevision: 3 })

    const conflicted = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 0, profile, credential: { mode: 'replace', value: 'synthetic-X' } })
    expect(conflicted.status).toBe(409)
    expect(conflicted.body).toEqual({ error: 'CONNECTION_CONFLICT' })

    memory.values.clear()
    const keepRejected = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 3, profile, credential: { mode: 'keep' } })
    expect(keepRejected.status).toBe(400)
    expect(keepRejected.body).toEqual({ error: 'CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE' })

    const rebound = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 3, profile, credential: { mode: 'replace', value: 'synthetic-C' } })
    expect(rebound.status).toBe(200)
    expect((rebound.body.connections as Record<string, unknown>[]).find(row => row.connection === 'one'))
      .toMatchObject({ availability: 'available' })
    const finalStatus = await post(base, '/api/nidofy/status', {})
    expect(JSON.stringify(finalStatus.body)).not.toContain('synthetic-')
  } finally { await ctx.fiber.dispose() }
})

it('reports an invalid owner directory on status and refuses its saves over HTTP', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-api-')); roots.push(home)
  const memory = credentialMemory()
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(home, 'nidofy-connections'))
  await writeFile(join(home, 'nidofy-connections', 'state.json'), '{"schemaVersion":1,"broken')
  const { ctx, base } = await booted(memory, home)
  try {
    const observed = await post(base, '/api/nidofy/status', {})
    expect(observed.status).toBe(200)
    expect(observed.body).toMatchObject({ recovery: 'invalid-state', recoveryDiagnostic: 'INVALID_CONNECTION_JSON' })
    const refused = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 0, profile, credential: { mode: 'replace', value: 'synthetic-A' } })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ error: 'CONNECTION_INVALID_STATE' })
  } finally { await ctx.fiber.dispose() }
})

it('keeps the authenticated repair surface reporting when the owner cannot install', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-api-')); roots.push(home)
  const memory = credentialMemory()
  await writeFile(join(home, 'nidofy-connections'), 'a file where the owner directory belongs')
  const ctx = new Context()
  await bootServices(ctx, memory)
  ctx.provide('tools', toolsStandIn())
  await expect(installConnectionApi(ctx, home)).resolves.toBeUndefined()
  const base = await serve(ctx)
  try {
    const page = await fetch(`${base}/api/nidofy/ui`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('blank keeps the stored credential')
    const observed = await post(base, '/api/nidofy/status', {})
    expect(observed.status).toBe(503)
    expect(observed.body.error).toBe('CONNECTION_OWNER_UNAVAILABLE')
    expect(String(observed.body.diagnosticCode)).toMatch(/^[A-Z][A-Z0-9_]+$/)
    const refused = await post(base, '/api/nidofy/mutate', { action: 'save', operationId: randomUUID(),
      connection: 'one', expectedRevision: 0, profile, credential: { mode: 'replace', value: 'synthetic-A' } })
    expect(refused.status).toBe(503)
    expect(refused.body.error).toBe('CONNECTION_OWNER_UNAVAILABLE')
  } finally { await ctx.fiber.dispose() }
})

it('reports the collection obligation accurately over HTTP collect', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-api-')); roots.push(home)
  const memory = credentialMemory()
  const { ctx, base } = await booted(memory, home)
  const mutate = (expectedRevision: number, value: string) => post(base, '/api/nidofy/mutate', { action: 'save',
    operationId: randomUUID(), connection: 'one', expectedRevision, profile, credential: { mode: 'replace', value } })
  try {
    await mutate(0, 'synthetic-A')
    await mutate(1, 'synthetic-B')
    // Backdate both revisions past the production retention window for this replay.
    const durable = JSON.parse(await readFile(join(home, 'nidofy-connections', 'state.json'), 'utf8')) as { revisions: { createdAt: number }[] }
    const aged = Date.now() - 120_000
    for (const row of durable.revisions) row.createdAt = aged
    await writeFile(join(home, 'nidofy-connections', 'state.json'), JSON.stringify(durable))

    memory.failUnset = true
    injection.failLedger = true
    const collected = await post(base, '/api/nidofy/collect', {})
    expect(collected.status).toBe(200)
    expect(collected.body).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'journal' })
    const observed = await post(base, '/api/nidofy/status', {})
    expect(observed.body).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'journal' })
    expect(await stat(join(home, 'nidofy-connections', 'cleanup.json')).catch(() => null)).toBeNull()
    const refused = await mutate(2, 'synthetic-C')
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ error: 'CONNECTION_RECOVERY_PENDING' })

    memory.failUnset = false
    injection.failLedger = false
    const healed = await post(base, '/api/nidofy/status', {})
    expect(healed.body).toMatchObject({ recovery: 'ready', cleanupRecord: 'none' })
    expect(await stat(join(home, 'nidofy-connections', 'journal.json')).catch(() => null)).toBeNull()
    expect([...memory.values.keys()]).toHaveLength(1)
  } finally { await ctx.fiber.dispose() }
})

it('keeps non-owner installation failures visible instead of masking them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-api-')); roots.push(home)
  const memory = credentialMemory()
  const { mkdir } = await import('node:fs/promises')
  // A directory where the import manifest must be a file: the read fails after the
  // owner installed, and the failure stays visible to the installer's caller.
  await mkdir(join(home, 'nidofy-import-connections.json'))
  const ctx = new Context()
  await bootServices(ctx, memory)
  ctx.provide('tools', toolsStandIn())
  await expect(installConnectionApi(ctx, home)).rejects.toThrow()
  const base = await serve(ctx)
  try {
    // The handler registered before the failing subsystem stays installed on the context.
    const observed = await post(base, '/api/nidofy/status', {})
    expect(observed.status).toBe(200)
    expect(observed.body).toMatchObject({ recovery: 'ready' })
  } finally { await ctx.fiber.dispose() }
})
