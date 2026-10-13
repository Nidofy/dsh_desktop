/** Isolated Loader profile with the actual WebServer, authentication and tools; no model request or Desktop shell. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { OwnerCredentials, credentialMemory } from './connection-backend.ts'
import type { CredentialMemory } from './connection-backend.ts'
import { installConnectionApi } from '../src/connections/api.ts'

/** Synthetic key references and serialized browser-session records; no environment credential fallback. */
class BrowserCredentials extends OwnerCredentials {
  private records = new Map<CredentialKey, CredentialRecord>()
  private tail = Promise.resolve()
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(this.records.get(key)) }
  override modifyRecord(key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    const task = this.tail.then(async () => {
      const next = await mutate(this.records.get(key))
      if (next) this.records.set(key, next)
      return this.records.get(key)
    })
    this.tail = task.then(() => undefined, () => undefined)
    return task
  }
}

/** Boot a private on-disk profile through Loader and install repair before reporting readiness.
 * @param home - isolated connection data root.
 * @param memory - shared synthetic reference state across restarts.
 * @returns real authenticated HTTP origin, signing-cookie exchange and POST helper.
 */
async function boot(home: string, memory: CredentialMemory) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  class ProfileCredentials extends BrowserCredentials {
    constructor(child: Context) { super(child, memory) }
  }
  Object.assign(ctx.loader.builtins, { credentials: ProfileCredentials,
    llm: LlmRuntime, prompt: SystemPrompt, tools: ToolRuntime, server: WebServer, connection: Connection,
    repair: { inject: ['tools', 'llm', 'connection', 'credentials'], apply(child: Context) { return installConnectionApi(child, home) } } })
  const path = join(home, 'cordis.yml')
  await writeFile(path, '- name: cordis:credentials\n- name: cordis:llm\n- name: cordis:prompt\n- name: cordis:tools\n- name: cordis:server\n  config:\n    host: 127.0.0.1\n    port: 0\n- name: cordis:connection\n- name: cordis:repair\n')
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  if (!ctx.get('connection')) throw Error('AUTH_FIXTURE_CONNECTION_NOT_ACTIVE')
  const base = 'http://127.0.0.1:' + String(ctx.webServer.port)
  ctx.effect(() => ctx.webServer.registerFallback((request, response) => {
    if (!ctx.connection.authorizeIndex(request, response)) return
    response.end('isolated-loader-ready')
  }))
  const exchange = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
  expect(exchange.status).toBe(303)
  const cookie = exchange.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw Error('Missing authentication cookie')
  const post = (method: string, input: object = {}) => fetch(base + '/api/nidofy/' + method,
    { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(input) })
  return { ctx, base, cookie, post }
}

const profile = { api: 'openai-completions', baseURL: 'https://unused.invalid/v1', models: [{ id: 'custom' }] }

it('keeps repair available after a keyless restart and enforces real cookie and origin admission', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-auth-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const memory = credentialMemory(), first = await boot(home, memory)
  const save = (connection: string, revision: number) => first.post('mutate', { action: 'save', connection, profile,
    operationId: randomUUID(), expectedRevision: revision, credential: { mode: 'replace', value: 'synthetic-auth-' + connection } })
  expect((await save('missing', 0)).status).toBe(200)
  expect((await save('valid', 1)).status).toBe(200)
  const initial = await (await first.post('status')).json() as { connections: { connection: string; revision: string }[] }
  const missing = initial.connections.find(row => row.connection === 'missing')!
  memory.values.delete('NIDOFY_REV_' + missing.revision.replaceAll('-', '_'))
  await first.ctx.fiber.dispose()
  const running = await boot(home, memory)
  expect((await fetch(running.base + '/api/nidofy/ui')).status).toBe(401)
  expect((await fetch(running.base + '/api/nidofy/status', { method: 'POST', headers: { cookie: running.cookie,
    origin: 'https://other.invalid' }, body: '{}' })).status).toBe(403)
  const page = await fetch(running.base + '/api/nidofy/ui', { headers: { cookie: running.cookie } })
  expect(page.status).toBe(200); expect(await page.text()).toContain('blank keeps the stored credential')
  const state = await (await running.post('status')).json() as { connections: { connection: string; availability: string }[] }
  expect(state.connections).toEqual(expect.arrayContaining([
    expect.objectContaining({ connection: 'missing', availability: 'missing-credential' }),
    expect.objectContaining({ connection: 'valid', availability: 'available' }),
  ]))
  memory.values.clear()
  const allMissing = await (await running.post('status')).json() as { connections: { availability: string }[] }
  expect(allMissing.connections.every(row => row.availability === 'missing-credential')).toBe(true)
  expect((await running.post('mutate', { action: 'save', connection: 'missing', expectedRevision: 2, profile,
    operationId: randomUUID(), credential: { mode: 'replace', value: 'synthetic-repaired' } })).status).toBe(200)
})

it('retains authenticated repair and stable diagnostics when the connection owner cannot install', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-auth-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'nidofy-connections'), 'preserved obstruction')
  const running = await boot(home, credentialMemory())
  const response = await running.post('status')
  expect(response.status).toBe(503)
  const result = await response.json() as { error: string; diagnosticCode: string }
  expect(result.error).toBe('CONNECTION_OWNER_UNAVAILABLE')
  expect(result.diagnosticCode).toMatch(/^[A-Z][A-Z0-9_]+$/)
  expect((await fetch(running.base + '/api/nidofy/ui', { headers: { cookie: running.cookie } })).status).toBe(200)
  const base = running.base
  await running.ctx.fiber.dispose()
  await expect(fetch(base + '/api/nidofy/ui')).rejects.toThrow()
})

it('keeps unrelated subsystem installation failures fatal to the Loader profile', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-auth-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, 'nidofy-import-connections.json'))
  await expect(boot(home, credentialMemory())).rejects.toThrow()
})
