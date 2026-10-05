import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConnectionStore } from '../src/connections/store.ts'
import type { RevisionId, SecretStore } from '../src/connections/store.ts'

const injection = vi.hoisted(() => ({ failCleanup: false }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (original) => {
  const real = await original<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...real, writeFileAtomic: async (...args: Parameters<typeof real.writeFileAtomic>) => {
    if (injection.failCleanup && args[0].endsWith('cleanup.json')) throw new Error('SYNTHETIC_LEDGER_DENIED')
    return real.writeFileAtomic(...args)
  } }
})

const roots: string[] = []
afterEach(async () => {
  injection.failCleanup = false
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const profile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] }

/** Synthetic credential backend with injectable get/unset faults, shared across simulated restarts. */
interface Backend extends SecretStore {
  values: Map<string, string>
  failGet: boolean
  failUnset: boolean
  beforeGet?: ((ref: string) => Promise<void>) | undefined
  onSet?: (() => void) | undefined
}

async function directory(): Promise<{ root: string; backend: Backend }> {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-connections-')); roots.push(root)
  const values = new Map<string, string>()
  const backend: Backend = { values, failGet: false, failUnset: false,
    get: async (ref) => {
      await backend.beforeGet?.(ref)
      if (backend.failGet) throw new Error('SYNTHETIC_BACKEND_DOWN')
      return values.get(ref)
    },
    set: async (ref, key) => { values.set(ref, key); backend.onSet?.() },
    unset: async (ref) => {
      if (backend.failUnset) throw new Error('SYNTHETIC_UNSET_DOWN')
      values.delete(ref)
    } }
  return { root, backend }
}

const open = (root: string, backend: Backend, fault?: (point: string) => Promise<void>): Promise<ConnectionStore> =>
  (async () => { const store = new ConnectionStore(root, backend, () => {}, 0, fault); await store.open(); return store })()

const save = (store: ConnectionStore, expectedRevision: number, credential: unknown, connection = 'one', extra: Record<string, unknown> = {}) =>
  store.mutate({ action: 'save', operationId: randomUUID(), connection, expectedRevision, profile,
    ...(credential === null ? {} : typeof credential === 'string' ? { key: credential } : { credential }),
    ...extra })

const healthOf = (store: ConnectionStore, id: RevisionId | string) =>
  store.health.find(row => row.revisionId === id)?.availability.kind

const refOf = (id: RevisionId | string): string => `NIDOFY_REV_${id.replaceAll('-', '_')}`

it('loads the directory and repairs when the active connection is missing its key', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const first = store.state.current.one!
  await store.close()
  backend.values.delete(refOf(first))
  const restarted = await open(root, backend)
  expect(healthOf(restarted, first)).toBe('missing-credential')
  const observed = restarted.status()
  expect(observed.recovery).toBe('ready')
  expect(observed.connections[0]).toMatchObject({ connection: 'one', configured: false, availability: 'missing-credential' })
  expect(() => restarted.acquire(first)).toThrow('CONNECTION_MISSING_CREDENTIAL')
  await save(restarted, 1, 'synthetic-rebound')
  expect(() => restarted.acquire(restarted.state.current.one!)).not.toThrow()
  await restarted.close()
})

it('keeps the healthy connection usable when an inactive connection is missing its key', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A', 'one')
  await save(store, 1, 'synthetic-B', 'two')
  const two = store.state.current.two!
  await store.close()
  backend.values.delete(refOf(two))
  const restarted = await open(root, backend)
  expect(healthOf(restarted, restarted.state.current.one!)).toBe('available')
  expect(healthOf(restarted, two)).toBe('missing-credential')
  expect(restarted.acquire(restarted.state.current.one!).key).toBe('synthetic-A')
  expect(() => restarted.acquire(two)).toThrow('CONNECTION_MISSING_CREDENTIAL')
  await restarted.close()
})

it('reports an old retained revision missing its key without dragging down the current route', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const first = store.state.current.one!
  await save(store, 1, 'synthetic-B')
  await store.close()
  backend.values.delete(refOf(first))
  const restarted = await open(root, backend)
  expect(healthOf(restarted, first)).toBe('missing-credential')
  expect(healthOf(restarted, restarted.state.current.one!)).toBe('available')
  expect(restarted.acquire(restarted.state.current.one!).key).toBe('synthetic-B')
  await restarted.close()
})

it('stays diagnosable and repairable when every connection is unavailable', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A', 'one')
  await save(store, 1, 'synthetic-B', 'two')
  await store.close()
  backend.values.clear()
  const restarted = await open(root, backend)
  const observed = restarted.status()
  expect(observed.recovery).toBe('ready')
  expect(observed.revisions.map(row => row.availability.kind)).toEqual(['missing-credential', 'missing-credential'])
  await save(restarted, 2, 'synthetic-rebound', 'one')
  expect(restarted.acquire(restarted.state.current.one!).key).toBe('synthetic-rebound')
  await restarted.close()
})

it('surfaces backend failures as backend-unavailable health with a stable code', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  await store.close()
  backend.failGet = true
  const restarted = await open(root, backend)
  expect(restarted.health).toEqual([{ revisionId: restarted.state.current.one!,
    availability: { kind: 'backend-unavailable', diagnosticCode: 'SYNTHETIC_BACKEND_DOWN' } }])
  expect(() => restarted.acquire(restarted.state.current.one!)).toThrow('CONNECTION_BACKEND_UNAVAILABLE')
  expect(() => restarted.acquire(restarted.state.current.one!)).toThrow('CONNECTION_BACKEND_UNAVAILABLE')
  backend.failGet = false
  const recovered = await restarted.inspect()
  expect(recovered.revisions[0]?.availability).toEqual({ kind: 'available' })
  await restarted.close()
})

it('does not read secrets of revoked revisions', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  await save(store, 1, 'synthetic-B')
  const retained = store.state.revisions.map(row => row.id)
  await store.mutate({ action: 'revoke', operationId: randomUUID(), expectedRevision: 2, connection: 'one' })
  expect(store.status().connections).toHaveLength(0)
  const reads: string[] = []
  backend.beforeGet = (ref) => { reads.push(ref); return Promise.resolve() }
  const observed = await store.inspect()
  expect(observed.revisions.map(row => row.revisionId)).toEqual(retained)
  expect(observed.revisions.map(row => row.availability)).toEqual([
    { kind: 'revoked' }, { kind: 'revoked' },
  ])
  expect(reads).toEqual([])
  await store.close()
})

it('keeps the stored credential for non-secret saves and never shares references between revisions', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const first = store.state.current.one!
  const held = store.acquire(first)
  await save(store, 1, { mode: 'keep' }, 'one', { profile: { ...profile, displayName: 'renamed' } })
  const second = store.state.current.one!
  expect(second).not.toBe(first)
  expect(store.acquire(second).key).toBe('synthetic-A')
  expect(held.key).toBe('synthetic-A')
  expect([...backend.values.keys()]).toHaveLength(2)
  held.release()
  await store.collect()
  expect([...backend.values.keys()]).toEqual([refOf(second)])
  expect(store.acquire(second).key).toBe('synthetic-A')
  await store.close()
})

it('re-resolves the current secret for keep instead of trusting the process cache', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  backend.values.clear()
  await expect(save(store, 1, { mode: 'keep' })).rejects.toThrow('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
  const rejected = store.status()
  expect(rejected.desiredRevision).toBe(1)
  expect(rejected.retainedRevisions).toBe(1)
  expect(backend.values.size).toBe(0)
  await save(store, 1, 'synthetic-C')
  expect(store.acquire(store.state.current.one!).key).toBe('synthetic-C')
  await store.close()
})

it('refuses keep when the backend rejects the read and leaves the durable state untouched', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  backend.failGet = true
  await expect(save(store, 1, { mode: 'keep' })).rejects.toThrow('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
  backend.failGet = false
  const observed = store.status()
  expect(observed.desiredRevision).toBe(1)
  expect(observed.retainedRevisions).toBe(1)
  expect(backend.values.size).toBe(1)
  await save(store, 1, 'synthetic-C')
  expect(store.acquire(store.state.current.one!).key).toBe('synthetic-C')
  await store.close()
})

it('rejects keep without a current revision or a readable key and rejects ambiguous credential input', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await expect(save(store, 0, { mode: 'keep' })).rejects.toThrow('CONNECTION_KEEP_WITHOUT_CURRENT')
  await save(store, 0, 'synthetic-A')
  await store.close()
  backend.values.clear()
  const restarted = await open(root, backend)
  await expect(save(restarted, 1, { mode: 'keep' })).rejects.toThrow('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
  await expect(save(restarted, 1, { mode: 'replace', value: '' })).rejects.toThrow('INVALID_CREDENTIAL')
  await expect(save(restarted, 1, null)).rejects.toThrow('INVALID_CREDENTIAL')
  await expect(restarted.mutate({ action: 'save', operationId: randomUUID(), connection: 'one', expectedRevision: 1,
    profile, key: 'synthetic-A', credential: { mode: 'replace', value: 'synthetic-B' } })).rejects.toThrow('INVALID_CONNECTION_REQUEST')
  await restarted.close()
})

it('holds the previous complete routing view while a new publication resolves', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const old = store.state.current.one!
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let armed = false
  backend.onSet = () => { armed = true }
  backend.beforeGet = () => (armed ? gate : Promise.resolve())
  const updating = save(store, 1, 'synthetic-B')
  while (store.status().desiredRevision !== 2) await new Promise(resolve => setTimeout(resolve, 2))
  const mid = store.status()
  expect(mid).toMatchObject({ desiredRevision: 2, appliedRevision: 1 })
  expect(store.state.current.one).toBe(old)
  expect(mid.connections[0]).toMatchObject({ revision: old, availability: 'available', configured: true })
  const served = store.acquire(store.state.current.one!)
  expect(served.key).toBe('synthetic-A')
  served.release()
  release(); backend.beforeGet = undefined; backend.onSet = undefined
  await updating
  const after = store.status()
  expect(after).toMatchObject({ desiredRevision: 2, appliedRevision: 2 })
  expect(store.state.current.one!).not.toBe(old)
  expect(store.acquire(store.state.current.one!).key).toBe('synthetic-B')
  await store.close()
})

it('holds the revoked-away routing view until the revocation publication completes', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A', 'one')
  await save(store, 1, 'synthetic-B', 'two')
  const one = store.state.current.one!
  const twoRef = refOf(store.state.current.two!)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let secondRead!: () => void
  const publicationRead = new Promise<void>((resolve) => { secondRead = resolve })
  let twoReads = 0
  backend.beforeGet = (ref) => {
    if (ref === twoRef) {
      twoReads++
      // The first read belongs to the pre-commit recovery apply; gate only the
      // publication apply that runs after the revocation is durably committed.
      if (twoReads === 2) { secondRead(); return gate }
    }
    return Promise.resolve()
  }
  const revoking = store.mutate({ action: 'revoke', operationId: randomUUID(), expectedRevision: 2, connection: 'one' })
  await publicationRead
  const mid = store.status()
  expect(mid).toMatchObject({ desiredRevision: 3, appliedRevision: 2 })
  expect(store.state.current.one).toBe(one)
  expect(store.acquire(one).key).toBe('synthetic-A')
  release(); backend.beforeGet = undefined
  await revoking
  expect(store.state.current.one).toBeUndefined()
  expect(() => store.acquire(one)).toThrow('CONNECTION_REVOKED')
  await store.close()
})

it('keeps the recovery obligation in the journal when unset and ledger writes both fail, refusing new writes', async () => {
  const { root, backend } = await directory()
  const committed = await open(root, backend)
  await save(committed, 0, 'synthetic-A')
  await committed.close()
  let armed = true
  const staging = await open(root, backend, async (at) => {
    if (at === 'credential-staged' && armed) { armed = false; throw new Error('SIMULATED_PROCESS_LOSS') }
  })
  await expect(save(staging, 1, 'synthetic-orphan')).rejects.toThrow('PROCESS_LOSS')
  const orphan = [...backend.values.keys()].find(ref => backend.values.get(ref) === 'synthetic-orphan')!
  await staging.close()
  backend.failUnset = true
  injection.failCleanup = true
  const resumed = await open(root, backend)
  const degraded = resumed.status()
  expect(degraded).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'journal' })
  expect(degraded.connections[0]).toMatchObject({ connection: 'one', availability: 'available' })
  expect(resumed.acquire(resumed.state.current.one!).key).toBe('synthetic-A')
  await expect(save(resumed, 1, 'synthetic-B')).rejects.toThrow('CONNECTION_RECOVERY_PENDING')
  backend.failUnset = false
  injection.failCleanup = false
  const healed = await resumed.inspect()
  expect(healed).toMatchObject({ recovery: 'ready', cleanupRecord: 'none' })
  expect(backend.values.has(orphan)).toBe(false)
  await save(resumed, 1, 'synthetic-B')
  expect(resumed.acquire(resumed.state.current.one!).key).toBe('synthetic-B')
  await resumed.close()
})

it('recovers the journal-recorded obligation after a cold restart once the backend heals', async () => {
  const { root, backend } = await directory()
  let armed = true
  const first = await open(root, backend, async (at) => {
    if (at === 'credential-staged' && armed) { armed = false; throw new Error('SIMULATED_PROCESS_LOSS') }
  })
  await expect(save(first, 0, 'synthetic-orphan')).rejects.toThrow('PROCESS_LOSS')
  const orphan = [...backend.values.keys()][0]!
  await first.close()
  backend.failUnset = true
  injection.failCleanup = true
  const degraded = await open(root, backend)
  expect(degraded.status()).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'journal' })
  await degraded.close()
  backend.failUnset = false
  injection.failCleanup = false
  const restarted = await open(root, backend)
  const observed = restarted.status()
  expect(observed).toMatchObject({ recovery: 'ready', cleanupRecord: 'none' })
  expect(backend.values.has(orphan)).toBe(false)
  expect(await stat(join(root, 'journal.json')).catch(() => null)).toBeNull()
  expect(await stat(join(root, 'cleanup.json')).catch(() => null)).toBeNull()
  await restarted.close()
})

it('keeps the repair path open when recover cannot unset an uncommitted candidate', async () => {
  const { root, backend } = await directory()
  let armed = true
  const store = await open(root, backend, async (at) => {
    if (at === 'prepared' && armed) { armed = false; throw new Error('SIMULATED_PROCESS_LOSS') }
  })
  await expect(save(store, 0, 'synthetic-A')).rejects.toThrow('PROCESS_LOSS')
  await store.close()
  backend.failUnset = true
  const degraded = await open(root, backend)
  expect(degraded.status()).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'ledger' })
  await save(degraded, 0, 'synthetic-B')
  expect(degraded.acquire(degraded.state.current.one!).key).toBe('synthetic-B')
  backend.failUnset = false
  const repaired = await degraded.inspect()
  expect(repaired).toMatchObject({ recovery: 'ready', cleanupRecord: 'none' })
  expect([...backend.values.keys()]).toEqual([refOf(degraded.state.current.one!)])
  await degraded.close()
})

it('drops retired revisions from keys and health at collection', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const old = store.state.current.one!
  await save(store, 1, 'synthetic-B')
  const before = store.status()
  await store.collect()
  const after = store.status()
  expect(after.revisions.map(row => row.revisionId)).toEqual([store.state.current.one!])
  expect(after.healthRevision).toBeGreaterThan(before.healthRevision)
  expect(after.retainedRevisions).toBe(1)
  expect(healthOf(store, old)).toBeUndefined()
  expect(() => store.acquire(old)).toThrow('CONNECTION_RETIRED')
  expect(backend.values.has(refOf(old))).toBe(false)
  await store.close()
})

it('keeps a leased revision retained and healthy until its lease releases', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const old = store.state.current.one!
  const lease = store.acquire(old)
  await save(store, 1, 'synthetic-B')
  await store.collect()
  const held = store.status()
  expect(held.revisions.some(row => row.revisionId === old)).toBe(true)
  expect(healthOf(store, old)).toBe('available')
  expect(backend.values.has(refOf(old))).toBe(true)
  expect(lease.key).toBe('synthetic-A')
  lease.release()
  await store.collect()
  expect(store.status().revisions.some(row => row.revisionId === old)).toBe(false)
  expect(backend.values.has(refOf(old))).toBe(false)
  await store.close()
})

it('refuses new leases inside the retirement fence and reclaims only after the exchange', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const old = store.state.current.one!
  await save(store, 1, 'synthetic-B')
  const current = store.state.current.one!
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const publicationRead = new Promise<void>((resolve) => { entered = resolve })
  let armed = false, currentReads = 0
  backend.beforeGet = (ref) => {
    if (!armed) return Promise.resolve()
    if (ref === refOf(current)) {
      currentReads++
      if (currentReads === 2) { entered(); return gate }
    }
    return Promise.resolve()
  }
  armed = true
  const collecting = store.collect(Date.now() + 1000)
  await publicationRead
  expect(() => store.acquire(old)).toThrow('CONNECTION_RETIRING')
  expect(() => store.acquire(old)).toThrow('CONNECTION_RETIRING')
  const served = store.acquire(store.state.current.one!)
  expect(served.key).toBe('synthetic-B')
  served.release()
  release(); backend.beforeGet = undefined
  await collecting
  expect(store.state.revisions.some(row => row.id === old)).toBe(false)
  expect(backend.values.has(refOf(old))).toBe(false)
  expect(() => store.acquire(old)).toThrow('CONNECTION_RETIRED')
  await store.close()
})

it('reports the journal as the cleanup record immediately when collection unsets fail with the ledger', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const old = store.state.current.one!
  await save(store, 1, 'synthetic-B')
  backend.failUnset = true
  injection.failCleanup = true
  await store.collect(Date.now() + 1000)
  const degraded = store.status()
  expect(degraded).toMatchObject({ recovery: 'cleanup-pending', cleanupRecord: 'journal' })
  expect(await stat(join(root, 'cleanup.json')).catch(() => null)).toBeNull()
  expect(await readFile(join(root, 'journal.json'), 'utf8')).toContain(refOf(old))
  expect(() => store.acquire(old)).toThrow('CONNECTION_RETIRED')
  await expect(save(store, 2, 'synthetic-C')).rejects.toThrow('CONNECTION_RECOVERY_PENDING')
  expect(store.status().cleanupRecord).toBe('journal')
  backend.failUnset = false
  injection.failCleanup = false
  const healed = await store.inspect()
  expect(healed).toMatchObject({ recovery: 'ready', cleanupRecord: 'none' })
  expect(backend.values.has(refOf(old))).toBe(false)
  expect(await stat(join(root, 'journal.json')).catch(() => null)).toBeNull()
  expect(await stat(join(root, 'cleanup.json')).catch(() => null)).toBeNull()
  await store.close()
})

it('reports health changes without touching configuration state', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  const durableBefore = await readFile(join(root, 'state.json'), 'utf8')
  const before = store.status()
  backend.values.clear()
  const after = await store.inspect()
  expect(after.desiredRevision).toBe(before.desiredRevision)
  expect(after.healthRevision).toBeGreaterThan(before.healthRevision)
  expect(after.revisions[0]?.availability).toEqual({ kind: 'missing-credential' })
  expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(durableBefore)
  await store.close()
})

it('exchanges the key and health maps as a whole, never half-applied', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A', 'one')
  await save(store, 1, 'synthetic-B', 'two')
  const settled = store.status()
  backend.values.delete(refOf(store.state.current.two!))
  let watching = false
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const twoRef = refOf(store.state.current.two!)
  backend.beforeGet = (ref) => {
    if (watching && ref === twoRef) { entered(); return new Promise(resolve => setTimeout(resolve, 25)) }
    return Promise.resolve()
  }
  watching = true
  const applying = store.inspect()
  await enteredPromise
  const midflight = store.status()
  expect(midflight.healthRevision).toBe(settled.healthRevision)
  expect(midflight.revisions.map(row => row.availability.kind)).toEqual(['available', 'available'])
  const swapped = await applying
  expect(swapped.healthRevision).toBe(settled.healthRevision + 1)
  expect(swapped.revisions.map(row => row.availability.kind)).toEqual(['available', 'missing-credential'])
  backend.beforeGet = undefined
  await store.close()
})

it('preserves a corrupt owner file, diagnoses it, and refuses overwriting saves', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  await store.close()
  const corrupt = '{"schemaVersion":1,"revision":1,"broken'
  await writeFile(join(root, 'state.json'), corrupt)
  const restarted = await open(root, backend)
  const observed = restarted.status()
  expect(observed.recovery).toBe('invalid-state')
  expect(observed.recoveryDiagnostic).toBe('INVALID_CONNECTION_JSON')
  expect(restarted.health).toEqual([])
  await expect(save(restarted, 1, 'synthetic-B')).rejects.toThrow('CONNECTION_INVALID_STATE')
  await expect(restarted.collect()).resolves.toBeUndefined()
  expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(corrupt)
  await expect(restarted.inspect()).resolves.toMatchObject({ recovery: 'invalid-state' })
  await restarted.close()
})

it('treats a corrupt journal as invalid-state without touching its bytes', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  await save(store, 0, 'synthetic-A')
  await store.close()
  const corrupt = 'not-json-at-all'
  await writeFile(join(root, 'journal.json'), corrupt)
  const restarted = await open(root, backend)
  expect(restarted.status()).toMatchObject({ recovery: 'invalid-state', recoveryDiagnostic: 'INVALID_CONNECTION_JSON' })
  await expect(save(restarted, 1, 'synthetic-B')).rejects.toThrow('CONNECTION_INVALID_STATE')
  expect(await readFile(join(root, 'journal.json'), 'utf8')).toBe(corrupt)
  await restarted.close()
})

it('rejects a concurrent save with an explicit conflict whichever credential modes race', async () => {
  const { root, backend } = await directory()
  const store = await open(root, backend)
  const operationId = randomUUID()
  const first = store.mutate({ action: 'save', operationId, connection: 'one', expectedRevision: 0, profile,
    credential: { mode: 'replace', value: 'synthetic-A' } })
  const second = save(store, 0, { mode: 'keep' })
  const [a, b] = await Promise.allSettled([first, second])
  expect(a.status).toBe('fulfilled')
  expect(b.status).toBe('rejected')
  if (b.status === 'rejected') {
    expect(b.reason).toBeInstanceOf(Error)
    expect(String(b.reason)).toContain('CONNECTION_CONFLICT')
  }
  expect((await store.inspect(operationId)).committed).toBe(true)
  await store.close()
})

it('keeps every observation, durable file, and cleanup ledger free of secret values', async () => {
  const { root, backend } = await directory()
  let armed = true
  const store = await open(root, backend, async (at) => {
    if (at === 'prepared' && armed) { armed = false; throw new Error('SIMULATED_PROCESS_LOSS') }
  })
  await expect(save(store, 0, 'synthetic-A')).rejects.toThrow('PROCESS_LOSS')
  await save(store, 0, 'synthetic-B')
  await store.close()
  for (const name of ['state.json', 'cleanup.json', 'journal.json']) {
    const path = join(root, name)
    try { expect(await readFile(path, 'utf8')).not.toContain('synthetic-') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const restarted = await open(root, backend)
  expect(JSON.stringify(restarted.status())).not.toContain('synthetic-')
  expect(JSON.stringify(await restarted.inspect(randomUUID()))).not.toContain('synthetic-')
  await restarted.close()
})
