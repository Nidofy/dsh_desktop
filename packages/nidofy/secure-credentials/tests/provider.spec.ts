/** Full official provider behavior over an explicitly substituted encryption backend. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { boot, cleanup, config, directory, storageDirectory, SubstituteProtector } from './harness.ts'

afterEach(cleanup)
const ref = credentialRef('T02_SYNTHETIC_KEY')
const key = credentialKey('llm-pi-ai', 'openai-codex')

it('writes, restarts, rotates and revokes both key spaces without plaintext disk or exported metadata', async () => {
  const home = await directory()
  const backend = new SubstituteProtector()
  const first = await boot(config(home), backend)
  const references: string[] = [], records: string[] = []
  first.ctx.on('credentials/reference-updated', (ref) => { references.push(ref) })
  first.ctx.on('credentials/record-updated', (key) => { records.push(key) })
  await first.provider.set(ref, 'synthetic-reference-A')
  await first.provider.modifyRecord(key, async () => ({ kind: 'grant',
    payload: { refresh: 'synthetic-refresh-A', nested: [true, null, 3] } }))
  expect(references).toEqual([ref])
  expect(records).toEqual([key])
  await first.ctx.fiber.dispose()
  const second = await boot(config(home), backend)
  expect(await second.provider.resolve(ref)).toEqual({ value: 'synthetic-reference-A', source: 'windows-dpapi' })
  expect(await second.provider.describeRecord(key)).toEqual({ configured: true, kind: 'grant', writable: true })
  expect(await second.provider.listRecords()).toEqual([{ key, kind: 'grant' }])
  expect(await second.provider.modifyRecord(key, async () => undefined)).toEqual({ kind: 'grant',
    payload: { refresh: 'synthetic-refresh-A', nested: [true, null, 3] } })
  await second.provider.set(ref, 'synthetic-reference-B')
  await second.provider.modifyRecord(key, async () => ({ kind: 'api-key', env: { AWS_PROFILE: 'synthetic-profile' } }))
  const metadata = JSON.stringify([await second.provider.describe(ref), await second.provider.listRecords(),
    await second.provider.describeRecord(key)])
  expect(metadata).not.toContain('synthetic-')
  const disk = await readFile(join(await storageDirectory(home), 'current.json'), 'utf8')
  expect(disk).not.toContain('synthetic-')
  expect(disk).not.toContain(ref)
  await second.provider.unset(ref)
  await second.provider.deleteRecord(key)
  await second.provider.deleteRecord(key)
  expect(await second.provider.resolve(ref)).toBeUndefined()
  expect(await second.provider.listRecords()).toEqual([])
})

it('polls complete external changes, contains listener failure and stops publication on unload', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const a = await boot(config(home), backend)
  const b = await boot({ ...config(home), refreshIntervalMs: 10 }, backend)
  await b.provider.resolve(ref)
  const seen: string[] = []
  b.ctx.on('credentials/reference-updated', () => { throw new Error('synthetic-listener-error') })
  b.ctx.on('credentials/reference-updated', (reference) => { seen.push(reference) })
  await a.provider.set(ref, 'synthetic-polled')
  await expect.poll(() => seen).toEqual([ref])
  await b.ctx.fiber.dispose()
  await a.provider.set(ref, 'synthetic-after-unload')
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(seen).toEqual([ref])
})

it('announces a committed identical set/modify and keeps a declined mutation isolated', async () => {
  const { provider, ctx } = await boot(config(await directory()), new SubstituteProtector())
  const seen: string[] = []
  ctx.on('credentials/reference-updated', (reference) => { seen.push(reference) })
  ctx.on('credentials/record-updated', (record) => { seen.push(record) })
  await provider.set(ref, 'synthetic-same'); await provider.set(ref, 'synthetic-same')
  await provider.modifyRecord(key, async () => ({ kind: 'grant', payload: 1 }))
  await provider.modifyRecord(key, async current => current)
  await provider.modifyRecord(key, async (current) => { Object.assign(current!, { payload: 2 }); return undefined })
  expect(await provider.readRecord(key)).toEqual({ kind: 'grant', payload: 1 })
  expect(seen).toEqual([ref, ref, key, key])
})

it('keeps inherited environment read-only, stores above dotenv and refuses fallback on backend denial', async () => {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([
    { source: 'process', values: { T02_ENV_KEY: 'synthetic-env', T02_SYNTHETIC_KEY: '' } },
    { source: 'project-env', values: { T02_SYNTHETIC_KEY: 'synthetic-project' } },
    { source: 'user-env', values: { T02_SYNTHETIC_KEY: 'synthetic-user' } },
  ]))
  const backend = new SubstituteProtector()
  const { provider } = await boot(config(await directory()), backend, ctx)
  const inherited = credentialRef('T02_ENV_KEY')
  expect(await provider.describe(inherited)).toEqual({ configured: true, source: 'env', writable: false })
  await expect(provider.set(inherited, 'synthetic-managed')).rejects.toMatchObject({ code: 'SECURE_ENV_SHADOWED' })
  await expect(provider.unset(inherited)).rejects.toMatchObject({ code: 'SECURE_ENV_SHADOWED' })
  expect((await provider.resolve(ref))?.source).toBe('project-env')
  await provider.set(ref, 'synthetic-managed')
  expect((await provider.resolve(ref))?.source).toBe('windows-dpapi')
  backend.refused = true
  await expect(provider.resolve(ref)).rejects.toThrow('SECURE_BACKEND_UNAVAILABLE')
  await expect(provider.describe(ref)).rejects.toThrow('SECURE_BACKEND_UNAVAILABLE')
  await expect(provider.readRecord(key)).rejects.toThrow('SECURE_BACKEND_UNAVAILABLE')
  expect((await provider.resolve(inherited))?.source).toBe('env')
  backend.refused = false
  await provider.unset(ref)
  expect((await provider.resolve(ref))?.source).toBe('project-env')
})

it('serializes concurrent token refreshes against fresh disk state and observes external changes', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const a = await boot(config(home), backend), b = await boot(config(home), backend)
  await a.provider.modifyRecord(key, async () => ({ kind: 'grant', payload: 0 }))
  await b.provider.readRecord(key)
  const seen: string[] = []
  b.ctx.on('credentials/record-updated', (key) => { seen.push(key) })
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).provider.modifyRecord(key,
    async current => ({ kind: 'grant',
      payload: current?.kind === 'grant' && typeof current.payload === 'number' ? current.payload + 1 : 1 }))))
  expect(await b.provider.readRecord(key)).toEqual({ kind: 'grant', payload: 12 })
  expect(seen.length).toBeGreaterThan(0)
  const read = await b.provider.readRecord(key)
  if (read?.kind === 'grant') Object.assign(read, { payload: 'synthetic-tamper' })
  expect(await b.provider.readRecord(key)).toEqual({ kind: 'grant', payload: 12 })
})

it('rejects invalid/oversized durable values without changing selected bytes', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const { provider } = await boot({ ...config(home), maxPlaintextBytes: 1024 }, backend)
  await provider.modifyRecord(key, async () => ({ kind: 'api-key' }))
  const path = join(await storageDirectory(home), 'current.json')
  const before = await readFile(path)
  for (const payload of [NaN, undefined, new Date(), [undefined]]) {
    await expect(provider.modifyRecord(key, async () => ({ kind: 'grant', payload }))).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  }
  await expect(provider.modifyRecord(key, async () => ({ kind: 'api-key', key: '' }))).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  await expect(provider.set(ref, '')).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  await expect(provider.set(ref, '汉'.repeat(400))).rejects.toThrow('SECURE_SIZE_LIMIT')
  expect(await readFile(path)).toEqual(before)
  await writeFile(path, '{"version":99,"secret":"synthetic-corruption"}')
  await expect(provider.resolve(ref)).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  await expect(provider.set(ref, 'synthetic-new')).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  expect(await readFile(path, 'utf8')).toContain('synthetic-corruption')
})

it('boots with a refused backend, recovers after repair and drains in-flight work on disposal', async () => {
  const backend = new SubstituteProtector(); backend.refused = true
  const { provider, ctx } = await boot(config(await directory()), backend)
  await expect(provider.resolve(ref)).rejects.toMatchObject({ code: 'SECURE_BACKEND_UNAVAILABLE', message: 'SECURE_BACKEND_UNAVAILABLE' })
  backend.refused = false
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const operation = provider.modifyRecord(key, async () => { entered(); await gate; return { kind: 'grant', payload: 1 } })
  await ready
  let settled = false
  const disposing = ctx.fiber.dispose().then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(settled).toBe(false)
  release()
  await operation; await disposing
  await expect(provider.readRecord(key)).rejects.toThrow('SECURE_DISPOSED')
})

it('isolates application, profile and canonical home identity', async () => {
  const home = await directory(), backend = new SubstituteProtector()
  const a = await boot(config(home), backend)
  await a.provider.set(ref, 'synthetic-isolated')
  const specs = [{ ...config(home), applicationId: 'other-app' },
    { ...config(home), profileId: 'other-profile' }, config(await directory())]
  for (const spec of specs) {
    const b = await boot(spec, backend)
    expect(await b.provider.resolve(ref)).toBeUndefined()
  }
  const alias = await boot({ ...config(home), dshHome: join(home, '.') }, backend)
  expect((await alias.provider.resolve(ref))?.value).toBe('synthetic-isolated')
})

it('stores valid references that coincide with Object prototype names', async () => {
  const { provider } = await boot(config(await directory()), new SubstituteProtector())
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const reference = credentialRef(name)
    expect(await provider.resolve(reference)).toBeUndefined()
    await provider.set(reference, 'synthetic-prototype-reference')
    expect((await provider.resolve(reference))?.value).toBe('synthetic-prototype-reference')
    await provider.unset(reference)
    expect(await provider.resolve(reference)).toBeUndefined()
  }
})
