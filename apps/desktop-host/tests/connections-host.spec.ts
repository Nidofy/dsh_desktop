import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@nidofy/dsh-desktop-extras'
import { installConnections } from '../src/connections/runtime.ts'
import type { ConnectionStore } from '../src/connections/store.ts'
import { bootServices, credentialMemory } from './connection-backend.ts'
import type { CredentialMemory } from './connection-backend.ts'

const profile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] }
const directories: string[] = []
const hosts: { teardown(): Promise<void> }[] = []

/** Boot one Host epoch: real LLM runtime, real credential service, and the connection owner under test. */
async function boot(directory: string, memory: CredentialMemory): Promise<{ ctx: Context; store: ConnectionStore }> {
  const ctx = new Context()
  await bootServices(ctx, memory)
  const store = await installConnections(ctx, directory)
  return { ctx, store }
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.teardown()))
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Drive the real agent/request waterfall the AgentLoop dispatches for each model call. */
function request(ctx: Context, agent: Agent, turn: number, step: number, provider: string): Promise<LlmCallConfig> {
  return agentEvents(ctx, agent).waterfall('agent/request', { turn, step, signal: new AbortController().signal },
    () => Promise.resolve({ provider, model: 'same' }))
}

const stepEnd = (turn: number, step: number): SessionEvent =>
  ({ type: 'step/end', data: { turn, step } }) as SessionEvent

it('installs with a missing key, keeps healthy routes, and rejects the missing route stably', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nidofy-host-')); directories.push(directory)
  const memory = credentialMemory()
  const first = await boot(directory, memory)
  await first.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-A' } })
  await first.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'two', expectedRevision: 1, profile,
    credential: { mode: 'replace', value: 'synthetic-B' } })
  const dropped = first.store.state.current.two!
  await first.ctx.fiber.dispose()

  memory.values.delete(`NIDOFY_REV_${dropped.replaceAll('-', '_')}`)
  const host = await boot(directory, memory)
  hosts.push({ teardown: () => host.ctx.fiber.dispose() })
  const observed = host.store.status()
  expect(observed.recovery).toBe('ready')
  expect(observed.connections.find(row => row.connection === 'one')).toMatchObject({ availability: 'available' })
  expect(observed.connections.find(row => row.connection === 'two')).toMatchObject({ availability: 'missing-credential' })

  const agent = { session: Session.create(SessionId('t01-degraded')) } as Agent
  expect(String(host.ctx.bail('nidofy/connection-route', 'nidofy-one'))).toMatch(/^nidofy-rev-[a-f0-9-]{36}--one$/)
  await expect(request(host.ctx, agent, 1, 0, 'nidofy-two')).rejects.toThrow('CONNECTION_MISSING_CREDENTIAL')
  await expect(request(host.ctx, agent, 1, 0, 'nidofy-two')).rejects.toThrow('CONNECTION_MISSING_CREDENTIAL')
  const routed = await request(host.ctx, agent, 1, 0, 'nidofy-one')
  expect(routed.provider.startsWith('nidofy-rev-')).toBe(true)
  expect(routed.provider.endsWith('--one')).toBe(true)
})

it('keeps in-flight revision A across a switch to B; new steps and later retries use B', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nidofy-host-')); directories.push(directory)
  const host = await boot(directory, credentialMemory())
  hosts.push({ teardown: () => host.ctx.fiber.dispose() })
  await host.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-A' } })
  const revisionA = host.store.state.current.one!
  const agent = { session: Session.create(SessionId('t01-pinning')) } as Agent

  const inFlight = await request(host.ctx, agent, 1, 0, 'nidofy-one')
  await host.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 1, profile,
    credential: { mode: 'replace', value: 'synthetic-B' } })
  const retryKeepsA = await request(host.ctx, agent, 1, 0, 'nidofy-one')
  const newStepUsesB = await request(host.ctx, agent, 1, 1, 'nidofy-one')

  expect(inFlight.provider).toBe(`nidofy-rev-${revisionA}--one`)
  expect(retryKeepsA.provider).toBe(`nidofy-rev-${revisionA}--one`)
  expect(newStepUsesB.provider).not.toBe(`nidofy-rev-${revisionA}--one`)
  expect(newStepUsesB.provider).toMatch(/^nidofy-rev-[a-f0-9-]{36}--one$/)

  host.ctx.emit('session/event', agent.session, stepEnd(1, 0))
  host.ctx.emit('session/event', agent.session, stepEnd(1, 1))
  const laterRetry = await request(host.ctx, agent, 1, 0, 'nidofy-one')
  expect(laterRetry.provider).not.toBe(`nidofy-rev-${revisionA}--one`)
})

it('serves the previous complete route selection while a delayed publication resolves', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nidofy-host-')); directories.push(directory)
  const memory = credentialMemory()
  const host = await boot(directory, memory)
  hosts.push({ teardown: () => host.ctx.fiber.dispose() })
  await host.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-A' } })
  const revisionA = host.store.state.current.one!
  const agent = { session: Session.create(SessionId('t01-window')) } as Agent

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let armed = false
  memory.onSet = () => { armed = true }
  memory.beforeGet = () => (armed ? gate : Promise.resolve())
  const updating = host.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 1,
    profile, credential: { mode: 'replace', value: 'synthetic-B' } })
  while (host.store.status().desiredRevision !== 2) await new Promise(resolve => setTimeout(resolve, 2))

  const midWindow = await request(host.ctx, agent, 2, 0, 'nidofy-one')
  expect(midWindow.provider).toBe(`nidofy-rev-${revisionA}--one`)
  const midView = host.store.status()
  expect(midView).toMatchObject({ desiredRevision: 2, appliedRevision: 1 })
  const midLease = host.store.acquire(host.store.state.current.one!)
  expect(midLease.key).toBe('synthetic-A')
  midLease.release()

  release(); memory.beforeGet = undefined; memory.onSet = undefined
  await updating
  const settled = await request(host.ctx, agent, 2, 1, 'nidofy-one')
  expect(settled.provider).not.toBe(`nidofy-rev-${revisionA}--one`)
  expect(settled.provider).toMatch(/^nidofy-rev-[a-f0-9-]{36}--one$/)
})

it('commits every public observation field before synchronous route notifications fire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nidofy-host-')); directories.push(directory)
  const memory = credentialMemory()
  const host = await boot(directory, memory)
  hosts.push({ teardown: () => host.ctx.fiber.dispose() })
  const observations: ReturnType<typeof host.store.status>[] = []
  host.ctx.on('llm/adapters-updated', () => { observations.push(host.store.status()) })
  await host.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-A' } })
  const published = observations.find(row => row.connections.length > 0)
  expect(published).toBeDefined()
  expect(published).toMatchObject({ desiredRevision: 1, appliedRevision: 1 })
  expect(published?.connections[0]).toMatchObject({ availability: 'available', configured: true })
  expect(observations.every(row => row.desiredRevision === row.appliedRevision)).toBe(true)
})

it('classifies fenced and retired old-revision prepares without account or model fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nidofy-host-')); directories.push(directory)
  const memory = credentialMemory()
  const host = await boot(directory, memory)
  hosts.push({ teardown: () => host.ctx.fiber.dispose() })
  const saveAction = (expectedRevision: number, value: string) => host.store.mutate({ action: 'save',
    operationId: randomUUID(), connection: 'one', expectedRevision, profile, credential: { mode: 'replace', value } })
  await saveAction(0, 'synthetic-A')
  const old = host.store.state.current.one!
  await saveAction(1, 'synthetic-B')
  const current = host.store.state.current.one!
  // Backdate both revisions past the production retention window; the next recover reads it.
  const durable = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as { revisions: { createdAt: number }[] }
  const aged = Date.now() - 120_000
  for (const row of durable.revisions) row.createdAt = aged
  await writeFile(join(directory, 'state.json'), JSON.stringify({ ...durable, revisions: durable.revisions }))

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const publicationRead = new Promise<void>((resolve) => { entered = resolve })
  let armed = false, currentReads = 0
  memory.beforeGet = (ref) => {
    if (!armed) return Promise.resolve()
    if (ref === `NIDOFY_REV_${current.replaceAll('-', '_')}`) {
      currentReads++
      if (currentReads === 2) { entered(); return gate }
    }
    return Promise.resolve()
  }
  armed = true
  const collecting = host.store.collect()
  await publicationRead

  await expect(host.ctx.llm.prepareCall({ provider: `nidofy-rev-${old}--one`, model: 'same' }))
    .rejects.toThrow('CONNECTION_RETIRING')
  const served = await host.ctx.llm.prepareCall({ provider: 'nidofy-one', model: 'same' })
  expect(served.config.provider).toBe('nidofy-one')

  release(); memory.beforeGet = undefined
  await collecting
  // After retirement the archive route itself is unregistered: the LLM layer refuses
  // with NO_ADAPTER instead of falling back to the current revision's account.
  await expect(host.ctx.llm.prepareCall({ provider: `nidofy-rev-${old}--one`, model: 'same' }))
    .rejects.toThrow('no adapter registered')
  await expect(host.ctx.llm.prepareCall({ provider: `nidofy-rev-${old}--one`, model: 'same' }))
    .rejects.toThrow('no adapter registered')
  expect(() => host.store.acquire(old)).toThrow('CONNECTION_RETIRED')
  const settled = await host.ctx.llm.prepareCall({ provider: 'nidofy-one', model: 'same' })
  expect(settled.config.provider).toBe('nidofy-one')
  expect(memory.values.has(`NIDOFY_REV_${old.replaceAll('-', '_')}`)).toBe(false)
  expect(memory.values.has(`NIDOFY_REV_${current.replaceAll('-', '_')}`)).toBe(true)
})
