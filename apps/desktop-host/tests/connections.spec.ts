import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConnectionStore, profileFrom } from '../src/connections/store.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const profile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] }
async function fixture(fault?: (point: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-connections-')); roots.push(root)
  const keys = new Map<string, string>()
  const secrets = { get: (ref: string) => Promise.resolve(keys.get(ref)),
    set: (ref: string, key: string) => { keys.set(ref, key); return Promise.resolve() },
    unset: (ref: string) => { keys.delete(ref); return Promise.resolve() } }
  const store = new ConnectionStore(root, secrets, () => {}, 0, fault)
  await store.open()
  return { root, keys, secrets, store, save: (expectedRevision: number, key = 'synthetic-A', connection = 'one') => store.mutate({
    action: 'save', operationId: randomUUID(), connection, expectedRevision, profile, key,
  }) }
}

it('isolates same-model connections and retains A across updates until its last lease releases', async () => {
  const { store, save, keys, root } = await fixture()
  await save(0)
  const first = store.state.current.one!
  const a = store.acquire(first)
  await save(1, 'synthetic-B')
  await save(2, 'synthetic-C', 'two')
  const b = store.acquire(store.state.current.one!)
  const c = store.acquire(store.state.current.two!)
  expect([a.key, b.key, c.key]).toEqual(['synthetic-A', 'synthetic-B', 'synthetic-C'])
  await store.collect(); expect(keys.size).toBe(3)
  a.release(); await store.collect(); expect(keys.size).toBe(2)
  expect(() => store.acquire(first)).toThrow('CONNECTION_RETIRED')
  expect(await readFile(join(root, 'state.json'), 'utf8')).not.toContain('synthetic-')
  expect(JSON.stringify(store.status())).not.toContain('synthetic-')
  b.release(); c.release(); await store.close()
})

it('serializes conflicting saves, rejects stale CAS, and reconciles a lost ACK by operation ID', async () => {
  const { store } = await fixture()
  const op = { action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 0, profile, key: 'synthetic' }
  const [a, b] = await Promise.allSettled([store.mutate(op), store.mutate({ ...op, operationId: randomUUID() })])
  expect(a.status).toBe('fulfilled'); expect(b.status).toBe('rejected')
  const retried = await store.mutate(op)
  expect(retried).toMatchObject({ committed: true, desiredRevision: 1, appliedRevision: 1, operationId: op.operationId })
  expect((await store.inspect(op.operationId)).routeDigest).toBe(retried.routeDigest)
  await store.close()
})

it('persists an opaque cache partition across keep edits and rotates it on explicit credential replacement', async () => {
  const { store, save, root, secrets } = await fixture()
  await save(0)
  const first = store.state.revisions.find(row => row.id === store.state.current.one)!
  await store.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 1,
    profile: { ...profile, displayName: 'Renamed' }, credential: { mode: 'keep' } })
  const kept = store.state.revisions.find(row => row.id === store.state.current.one)!
  expect(kept.id).not.toBe(first.id)
  expect(kept.credentialPartition).toBe(first.credentialPartition)
  await store.close()
  const reopened = new ConnectionStore(root, secrets, () => {})
  await reopened.open()
  expect(reopened.state.revisions.find(row => row.id === kept.id)?.credentialPartition).toBe(first.credentialPartition)
  await reopened.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 2,
    profile, credential: { mode: 'replace', value: 'synthetic-B' } })
  expect(reopened.state.revisions.find(row => row.id === reopened.state.current.one)?.credentialPartition)
    .not.toBe(first.credentialPartition)
  expect(await readFile(join(root, 'state.json'), 'utf8')).not.toContain('synthetic-')
  await reopened.close()
})

it.each(['prepared', 'credential-staged', 'committed', 'applied'])('recovers an interruption at %s without half-published credentials', async (point) => {
  let armed = true
  const { store, root, secrets, keys } = await fixture(async (at) => {
    if (at === point && armed) { armed = false; throw new Error('SIMULATED_PROCESS_LOSS') }
  })
  const operationId = randomUUID()
  await expect(store.mutate({ action: 'save', operationId, connection: 'one', expectedRevision: 0, profile, key: 'synthetic' })).rejects.toThrow('PROCESS_LOSS')
  await store.close()
  const restarted = new ConnectionStore(root, secrets, () => {}, 0)
  await restarted.open()
  const committed = point === 'committed' || point === 'applied'
  expect(await restarted.inspect(operationId)).toMatchObject({ committed, appliedRevision: committed ? 1 : 0 })
  expect(keys.size).toBe(committed ? 1 : 0)
  expect(restarted.hostEpoch).not.toBe(store.hostEpoch)
  await restarted.close()
})

it('revokes outstanding leases and refuses direct sends even while the old revision is retained', async () => {
  const { store, save } = await fixture()
  await save(0)
  const lease = store.acquire(store.state.current.one!)
  await store.mutate({ action: 'revoke', operationId: randomUUID(), expectedRevision: 1, connection: 'one' })
  expect(() =>{  lease.check() }).toThrow('LEASE_REVOKED')
  expect(() => store.acquire(lease.revision.id)).toThrow('REVOKED')
  lease.release(); await store.collect(); expect(store.status().retainedRevisions).toBe(0)
  await store.close()
})

it('inherits catalog defaults independently and rejects unsupported transport changes and credentials in profiles', () => {
  expect(profileFrom({ catalogProvider: 'deepseek' }).catalogProvider).toBe('deepseek')
  expect(() => profileFrom({ catalogProvider: 'not-a-real-catalog' })).toThrow()
  expect(() => profileFrom({ ...profile, proxy: 'http://proxy' })).toThrow('UNSUPPORTED_CONNECTION_FIELD')
  expect(() => profileFrom({ ...profile, apiKey: 'secret' })).toThrow('UNSUPPORTED_CONNECTION_FIELD')
  expect(() => profileFrom({ ...profile, baseURL: 'https://key:secret@example.com' })).toThrow('INVALID_ENDPOINT')
})
