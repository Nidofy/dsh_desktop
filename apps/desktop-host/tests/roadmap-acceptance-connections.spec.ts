/** T25 independent acceptance: missing-credential startup and repair reachability of the connection owner.
 * Characterizes present behavior against migration/roadmap/contracts-v1.md §连接可用性; requirement gaps
 * are recorded in migration/roadmap/handoffs/T25.md, not silently asserted as satisfied. */
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConnectionStore } from '../src/connections/store.ts'
import type { ConnectionState } from '../src/connections/store.ts'

const profile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

/** Synthetic secret backend standing in for the external credential store; maps credential refs to synthetic keys. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 't25-connections-'))
  roots.push(root)
  const keys = new Map<string, string>()
  const secrets = {
    get: (ref: string) => Promise.resolve(keys.get(ref)),
    set: (ref: string, key: string) => { keys.set(ref, key); return Promise.resolve() },
    unset: (ref: string) => { keys.delete(ref); return Promise.resolve() },
  }
  const published: number[] = []
  const open = () => new ConnectionStore(root, secrets, (state: ConnectionState) => { published.push(state.revision) }, 0)
  const save = (store: ConnectionStore, expectedRevision: number, key: string, connection: string) => store.mutate({
    action: 'save', operationId: randomUUID(), connection, expectedRevision, profile, key,
  })
  return { root, keys, secrets, published, open, save }
}

it('opens an empty first-launch state with no credentials at all and publishes it', async () => {
  const { open, published } = await harness()
  const store = open()
  await store.open()
  const status = store.status()
  expect(status).toMatchObject({ desiredRevision: 0, appliedRevision: 0, retainedRevisions: 0 })
  expect(status.connections).toEqual([])
  expect(published).toEqual([0])
  await store.close()
})

it('publishes both revisions when the first secret is missing and keeps the later connection usable', async () => {
  const { keys, published, open, save } = await harness()
  const writer = open()
  await save(writer, 0, 't25-synthetic-A', 'primary')
  await save(writer, 1, 't25-synthetic-B', 'backup')
  const refA = [...keys.keys()][0]!
  await writer.close()
  const setupPublications = published.length
  // Fault injection: the external backend loses the secret of the FIRST saved revision.
  keys.delete(refA)
  const restarted = open()
  await restarted.open()
  expect(published.slice(setupPublications)).toEqual([2])
  const status = restarted.status()
  expect(status).toMatchObject({ desiredRevision: 2, appliedRevision: 2, recovery: 'ready', cleanupRecord: 'none' })
  expect(status.connections.map(row => row.connection).sort()).toEqual(['backup', 'primary'])
  expect(status.connections.find(row => row.connection === 'primary')).toMatchObject({ configured: false, availability: 'missing-credential' })
  expect(status.connections.find(row => row.connection === 'backup')).toMatchObject({ configured: true, availability: 'available' })
  expect(() => restarted.acquire(restarted.state.current.primary!)).toThrow('CONNECTION_MISSING_CREDENTIAL')
  const lease = restarted.acquire(restarted.state.current.backup!)
  expect(lease.key).toBe('t25-synthetic-B')
  lease.release()
  expect(JSON.stringify(status)).not.toContain('t25-synthetic-')
  await restarted.close()
})

it('publishes both revisions when the later secret is missing and keeps the first connection usable', async () => {
  const { keys, published, open, save } = await harness()
  const writer = open()
  await save(writer, 0, 't25-synthetic-A', 'primary')
  await save(writer, 1, 't25-synthetic-B', 'backup')
  const refB = [...keys.keys()][1]!
  await writer.close()
  const setupPublications = published.length
  // Fault injection: the backend loses the LATER saved revision's secret only.
  keys.delete(refB)
  const restarted = open()
  await restarted.open()
  expect(published.slice(setupPublications)).toEqual([2])
  const status = restarted.status()
  expect(status.appliedRevision).toBe(2)
  expect(status.desiredRevision).toBe(2)
  const byConnection = new Map(status.connections.map(row => [row.connection, row.configured]))
  expect(byConnection.get('primary')).toBe(true)
  expect(byConnection.get('backup')).toBe(false)
  expect(status.connections.find(row => row.connection === 'backup')?.availability).toBe('missing-credential')
  expect(() => restarted.acquire(restarted.state.current.backup!)).toThrow('CONNECTION_MISSING_CREDENTIAL')
  const lease = restarted.acquire(restarted.state.current.primary!)
  expect(lease.key).toBe('t25-synthetic-A')
  lease.release()
  await restarted.close()
})

it('repairs an unavailable connection with replace while keep still refuses the missing secret', async () => {
  const { keys, published, open, save } = await harness()
  const writer = open()
  await save(writer, 0, 't25-synthetic-A', 'primary')
  const refA = [...keys.keys()][0]!
  await writer.close()
  const setupPublications = published.length
  keys.delete(refA)
  const restarted = open()
  await restarted.open()
  expect((await restarted.inspect()).connections[0]?.availability).toBe('missing-credential')
  await expect(restarted.mutate({ action: 'save', operationId: randomUUID(), connection: 'primary',
    expectedRevision: 1, profile, credential: { mode: 'keep' } })).rejects.toThrow('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
  await save(restarted, 1, 't25-synthetic-replacement', 'primary')
  const recovered = await restarted.inspect()
  expect(recovered).toMatchObject({ desiredRevision: 2, appliedRevision: 2 })
  expect(recovered.connections.every(row => row.configured)).toBe(true)
  expect(published.slice(setupPublications)).toContain(2)
  expect(keys.has(refA)).toBe(false)
  const lease = restarted.acquire(restarted.state.current.primary!)
  expect(lease.key).toBe('t25-synthetic-replacement')
  lease.release()
  await restarted.close()
})

it('starts up with healthy connections when only an already-revoked revision lost its secret', async () => {
  const { keys, open, save } = await harness()
  const writer = open()
  await save(writer, 0, 't25-synthetic-A', 'primary')
  await save(writer, 1, 't25-synthetic-B', 'backup')
  const refA = [...keys.keys()][0]!
  await writer.mutate({ action: 'revoke', operationId: randomUUID(), expectedRevision: 2, connection: 'primary' })
  await writer.close()
  keys.delete(refA)
  const restarted = open()
  await restarted.open()
  const status = restarted.status()
  expect(status.appliedRevision).toBe(status.desiredRevision)
  expect(status.connections).toHaveLength(1)
  const lease = restarted.acquire(restarted.state.current.backup!)
  expect(lease.key).toBe('t25-synthetic-B')
  lease.release()
  await restarted.close()
})
