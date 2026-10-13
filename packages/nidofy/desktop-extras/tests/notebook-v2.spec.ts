import { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
/** v2 store behavior: separated active set, bounded history journal, dual cursors, v1 copy conversion, and partial-write recovery. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { NotebookStore, NotebookV2Store } from '../src/notebook.ts'
import { notebookActiveInput } from '../src/notebook-input.ts'
import type { NotebookBudgets, NotebookScope, NotebookStorageAdmission, NotebookStorageWrite } from '../src/notebook.ts'

/** Fault injection for partial-write windows; disabled flags pass every call straight through. */
const injection = vi.hoisted(() => ({ failRevision: false, failCurrent: false, partialRevision: false,
  abortAfterRevision: undefined as AbortController | undefined }))
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  return { ...real, writeFile: async (...args: Parameters<typeof real.writeFile>) => {
    const path = args[0]
    const revision = typeof path === 'string' && path.includes('revision-')
    if (injection.failRevision && revision) throw Error('REVISION_WRITE_FAILED')
    if (injection.partialRevision && revision && typeof path === 'string' && path.endsWith('.tmp')) {
      // The underlying write creates the temporary and stops after a short byte prefix.
      const content = typeof args[1] === 'string' ? args[1] : ''
      await real.writeFile(path, content.slice(0, 18), args[2])
      throw Error('PARTIAL_REVISION_WRITE')
    }
    await real.writeFile(...args)
    if (revision) injection.abortAfterRevision?.abort()
  } }
})
vi.mock('@deepseek-ai/dsh-atomic-write', async (original) => {
  const real = await original<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...real, writeFileAtomic: async (...args: Parameters<typeof real.writeFileAtomic>) => {
    if (injection.failCurrent && args[0].replaceAll('\\', '/').endsWith('/v2/current.json')) throw Error('CURRENT_WRITE_FAILED')
    return real.writeFileAtomic(...args)
  } }
})
afterEach(() => {
  injection.failRevision = false
  injection.failCurrent = false
  injection.partialRevision = false
  injection.abortAfterRevision = undefined
})

/** Actual on-disk byte sum of the v2 namespace, mirroring the store's accounting input. */
const measureDirectory = async (home: string): Promise<number> => {
  const names = await readdir(v2Directory(home)).catch(() => [] as string[])
  let total = 0
  for (const name of names) total += (await stat(join(v2Directory(home), name))).size
  return total
}

const budgets: NotebookBudgets = { maxActiveEntries: 8, maxActiveBytes: 4096, maxDeltaBytes: 4096,
  maxEvidenceBytes: 2048, maxHistoryBytes: 512 * 1024 }
const scope: NotebookScope = { sessionId: 'session', generation: SessionPersistenceGeneration('test-file-3') }
const directory = (home: string): string => join(home, createHash('sha256').update('session').digest('hex'))
const v2Directory = (home: string): string => join(directory(home), 'v2')
const event = (body: string, seq: number, kind: 'user' | 'system-prompt'): SessionEvent => ({ type: 'user/message', seq: SessionSeq(seq), time: seq + 1, data: createUserMessage({ content: [{ type: 'text', text: body }], source: kind === 'user' ? { kind: 'user' } : { kind: 'system-prompt' } }), surfaceOp: 'append' })
const events: SessionEvent[] = [
  event('把官方引擎保留下来。测试计划已列出，尚未验证。', 0, 'user'),
  event('Second original event confirms cursor advancement.', 1, 'user'),
  event('injected prompt snapshot is not fresh evidence', 2, 'system-prompt'),
]
const add = (id: string, seq = 0, quote = '官方引擎') => ({ action: 'ADD', id, kind: 'constraint', text: `note ${id}`, seq, quote, pinned: false })

it('refuses an already committed numeric v2 generation without changing its files or cursors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-legacy-generation-'))
  const store = new NotebookV2Store(home, budgets)
  onTestFinished(async () => { await store.close(); await rm(home, { recursive: true, force: true }) })
  await mkdir(v2Directory(home), { recursive: true })
  const bytes = JSON.stringify({ schemaVersion: 2, scope: { sessionId: scope.sessionId, generation: 17 }, revision: 4,
    cursors: { evidenceThrough: 12, commitThrough: 19 }, active: [], historyRevision: 0, historyBytes: 0 }) + '\n'
  const path = join(v2Directory(home), 'current.json')
  await writeFile(path, bytes)
  await expect(store.readCommitted(scope)).rejects.toThrow('NOTEBOOK_GENERATION_REBIND_REQUIRED')
  await expect(store.publish(4, scope, { operations: [] }, events, 'model')).rejects.toThrow('NOTEBOOK_GENERATION_REBIND_REQUIRED')
  expect(await readFile(path, 'utf8')).toBe(bytes)
  expect(await readdir(v2Directory(home))).toEqual(['current.json'])
})

it('reads detached committed cursors on warm and cold stores and excludes failed publication residue', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-committed-'))
  const store = new NotebookV2Store(home, budgets)
  onTestFinished(async () => { await store.close(); await rm(home, { recursive: true, force: true }) })
  expect(await store.readCommitted(scope)).toMatchObject({ revision: 0, active: [], cursors: { evidenceThrough: -1, commitThrough: -1 } })
  await store.publish(0, scope, { operations: [add('committed')], cursors: { evidenceThrough: 0, commitThrough: 1 } }, events, 'model')
  const selected = await store.readCommitted(scope)
  expect(selected).toMatchObject({ revision: 1, cursors: { evidenceThrough: 0, commitThrough: 1 } })
  expect(selected).not.toHaveProperty('historyBytes')
  selected.scope.generation = SessionPersistenceGeneration('test-file-99'); selected.cursors.commitThrough = 99
  selected.active[0]!.text = 'caller mutation'
  expect(await store.readCommitted(scope)).toMatchObject({ scope, cursors: { commitThrough: 1 }, active: [{ text: 'note committed' }] })
  injection.failCurrent = true
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'committed' }],
    cursors: { evidenceThrough: 1, commitThrough: 2 } }, events, 'user')).rejects.toThrow('CURRENT_WRITE_FAILED')
  injection.failCurrent = false
  const expected = await store.readCommitted(scope), cold = new NotebookV2Store(home, budgets)
  try {
    expect(expected).toMatchObject({ revision: 1, historyRevision: 0, cursors: { evidenceThrough: 0, commitThrough: 1 } })
    expect(await cold.readCommitted(scope)).toEqual(expected)
    await expect(cold.readCommitted({ ...scope, generation: SessionPersistenceGeneration('test-file-99') })).rejects.toThrow('NOTEBOOK_SCOPE_CONFLICT')
  } finally { await cold.close() }
})

it('cancels a committed read before creating a lazy converted namespace', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-read-cancel-'))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 4096 }), store = new NotebookV2Store(home, budgets)
  onTestFinished(async () => { await legacy.close(); await store.close(); await rm(home, { recursive: true, force: true }) })
  await legacy.update(scope.sessionId, { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  const controller = new AbortController(); controller.abort()
  await expect(store.readCommitted(scope, controller.signal)).rejects.toThrow()
  await expect(stat(v2Directory(home))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await store.readCommitted(scope)).toMatchObject({ revision: 1, active: [{ id: 'legacy' }],
    cursors: { evidenceThrough: -1, commitThrough: -1 } })
})

it('keeps accepting notes after a thousand add-and-retire cycles while history stays queryable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-cycles-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, { ...budgets, maxHistoryBytes: 4 * 1024 * 1024 })
  for (let index = 0; index < 1000; index++) {
    const id = `note-${index}`
    const base = index === 0 ? { cursors: { evidenceThrough: 0 } } : {}
    await store.publish(index * 2, scope, { operations: [add(id)], ...base }, events, 'model')
    await store.publish(index * 2 + 1, scope, { operations: [{ action: 'REMOVE', id }] }, events, 'user')
  }
  const final = await store.publish(2000, scope, { operations: [add('after-thousand')] }, events, 'model')
  expect(final.revision).toBe(2001)
  expect(final.historyRevision).toBe(1000)
  const projection = await store.readActive(scope)
  expect(projection.entries.map(row => row.id)).toEqual(['after-thousand'])
  expect(projection.entries.every(row => row.active)).toBe(true)
  await expect(store.publish(final.revision, scope, { operations: [add('note-0')] }, events, 'model')).rejects.toThrow('NOTEBOOK_ID_REUSED')
  const page = await store.readHistory(scope, 0, 5)
  expect(page.records[0]).toMatchObject({ action: 'retire', historyRevision: 1, atRevision: 2, generation: SessionPersistenceGeneration('test-file-3'), note: { id: 'note-0', active: false } })
  expect(page.nextToken).toBe(5)
  const activeBeforeClose = JSON.stringify(projection)
  await store.close()
  const reopened = new NotebookV2Store(home, { ...budgets, maxHistoryBytes: 4 * 1024 * 1024 })
  expect(JSON.stringify(await reopened.readActive(scope))).toBe(activeBeforeClose)
  const tail = await reopened.readHistory(scope, 995, 10)
  expect(tail.records.at(-1)).toMatchObject({ action: 'retire', note: { id: 'note-999', active: false } })
  expect(tail.nextToken).toBeNull()
  await reopened.close()
}, 240_000)

it('projects only the active set in stable id order and keeps pinned notes protected', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-projection-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  const first = await store.publish(0, scope, { operations: [add('alpha'), add('beta'), { ...add('pinned-one'), kind: 'objective', text: 'pinned objective', pinned: true }], cursors: { evidenceThrough: 0 } }, events, 'user')
  expect(first.active.map(row => row.id)).toEqual(['alpha', 'beta', 'pinned-one'])
  expect(first.active.find(row => row.id === 'pinned-one')?.pinned).toBe(true)
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'pinned-one' }] }, events, 'model')).rejects.toThrow('NOTEBOOK_PINNED')
  const retired = await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'alpha' }] }, events, 'user')
  expect(retired.active.map(row => row.id)).toEqual(['beta', 'pinned-one'])
  const projection = await store.readActive(scope)
  expect(JSON.stringify(projection)).not.toContain('note alpha')
  expect(JSON.stringify(await store.readActive(scope))).toBe(JSON.stringify(projection))
  await store.close()
  expect(JSON.stringify(await new NotebookV2Store(home, budgets).readActive(scope))).toBe(JSON.stringify(projection))
})

it('reports oversized pinned notes as a repairable budget error instead of dropping them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-budget-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const candidate = { operations: [{ action: 'ADD', id: 'pinned', kind: 'constraint', text: '这是一条必须保留的置顶中文注记，用于验证字节预算按 UTF-8 实际字节数计算。', seq: 0, quote: '官方引擎', pinned: true }], cursors: { evidenceThrough: 0 } }
  const small = new NotebookV2Store(home, { ...budgets, maxActiveBytes: 128 })
  await expect(small.publish(0, scope, candidate, events, 'user')).rejects.toThrow('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
  await small.close()
  const untouched = new NotebookV2Store(home, { ...budgets, maxActiveBytes: 128 })
  expect(await untouched.readActive(scope)).toMatchObject({ revision: 0, entries: [] })
  await untouched.close()
  const repaired = new NotebookV2Store(home, budgets)
  await expect(repaired.publish(0, scope, candidate, events, 'user')).resolves.toMatchObject({ revision: 1, active: [{ id: 'pinned', pinned: true }] })
  await repaired.close()
})

it('enforces UTF-8 byte limits exactly on the complete active injection', async () => {
  const homes = await Promise.all([1, 2, 3].map(async () => mkdtemp(join(tmpdir(), 'nidofy-notes-v2-bytes-'))))
  onTestFinished(async () => { await Promise.all(homes.map(home => rm(home, { recursive: true, force: true }))) })
  const operation = [{ ...add('中文', 0), text: '汉'.repeat(50) }]
  const measured = new NotebookV2Store(homes[0]!, { ...budgets, maxActiveBytes: 1_000_000 })
  await measured.publish(0, scope, { operations: operation, cursors: { evidenceThrough: 0 } }, events, 'model')
  const exact = Buffer.byteLength(notebookActiveInput(await measured.readActive(scope), budgets))
  await measured.close()
  const atCap = new NotebookV2Store(homes[1]!, { ...budgets, maxActiveBytes: exact })
  await expect(atCap.publish(0, scope, { operations: operation, cursors: { evidenceThrough: 0 } }, events, 'model')).resolves.toMatchObject({ revision: 1 })
  await atCap.close()
  const overCap = new NotebookV2Store(homes[2]!, { ...budgets, maxActiveBytes: exact - 1 })
  await expect(overCap.publish(0, scope, { operations: operation, cursors: { evidenceThrough: 0 } }, events, 'model')).rejects.toThrow('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
  await overCap.close()
})

it('rejects fabricated quotes, unchecked evidence positions and non-original sources', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-source-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await expect(store.publish(0, scope, { operations: [{ ...add('fake'), quote: '完全不存在的引用' }], cursors: { evidenceThrough: 0 } }, events, 'model')).rejects.toThrow('NOTEBOOK_EVIDENCE_MISMATCH')
  const ahead = { ...add('ahead', 1, 'Second original event') }
  await expect(store.publish(0, scope, { operations: [ahead], cursors: { evidenceThrough: 0 } }, events, 'model')).rejects.toThrow('NOTEBOOK_EVIDENCE_MISMATCH')
  await expect(store.publish(0, scope, { operations: [{ ...add('injected', 2, 'injected prompt snapshot') }], cursors: { evidenceThrough: 2 } }, events, 'model')).rejects.toThrow('NOTEBOOK_ORIGINAL_SOURCE_REQUIRED')
  const longEvents = [...events, event(`长事件一${'甲'.repeat(600)}`, 3, 'user'), event(`长事件二${'乙'.repeat(600)}`, 4, 'user')]
  await expect(store.publish(0, scope, { operations: [{ ...add('heavy1', 3, '甲'.repeat(512)) }, { ...add('heavy2', 4, '乙'.repeat(512)) }], cursors: { evidenceThrough: 4 } }, longEvents, 'model')).rejects.toThrow('NOTEBOOK_EVIDENCE_BUDGET_EXCEEDED')
  const published = await store.publish(0, scope, { operations: [ahead], cursors: { evidenceThrough: 1 } }, events, 'model')
  expect(published.cursors).toEqual({ evidenceThrough: 1, commitThrough: -1 })
  await expect(store.publish(1, scope, { operations: [], cursors: { evidenceThrough: 0 } }, events, 'model')).rejects.toThrow('NOTEBOOK_CURSOR_CONFLICT')
  await expect(store.publish(1, scope, { operations: [{ action: 'ADD', id: 'delta', kind: 'next', text: '汉'.repeat(2048), seq: 0, quote: '官方引擎' }, { ...add('delta2') }], cursors: {} }, events, 'model')).rejects.toThrow('NOTEBOOK_DELTA_BUDGET_EXCEEDED')
  await store.close()
})

it('serializes concurrent publishes so exactly one compare-and-swap wins', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-cas-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await store.publish(0, scope, { operations: [add('one'), add('two')], cursors: { evidenceThrough: 0 } }, events, 'user')
  const writes = await Promise.allSettled([
    store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'one' }] }, events, 'user'),
    store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'two' }] }, events, 'user'),
  ])
  expect(writes.map(row => row.status).sort()).toEqual(['fulfilled', 'rejected'])
  const after = await store.readActive(scope)
  expect(after.revision).toBe(2)
  const remaining = after.entries[0]!.id
  await expect(store.publish(2, scope, { operations: [{ action: 'UPDATE', id: remaining, expectedRevision: 0, kind: 'next', text: 'stale update', seq: 0, quote: '官方引擎' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_ENTRY_CONFLICT')
  await expect(store.publish(99, scope, { operations: [] }, events, 'user')).rejects.toThrow('NOTEBOOK_REVISION_CONFLICT')
  await expect(store.publish(2, { sessionId: 'session', generation: SessionPersistenceGeneration('test-file-4') }, { operations: [] }, events, 'user')).rejects.toThrow('NOTEBOOK_SCOPE_CONFLICT')
  await expect(store.readActive({ sessionId: 'session', generation: SessionPersistenceGeneration('test-file-4') })).rejects.toThrow('NOTEBOOK_SCOPE_CONFLICT')
  await store.close()
})

it('restores retired notes on explicit request and keeps the full timeline queryable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-restore-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await store.publish(0, scope, { operations: [{ ...add('goal'), pinned: true }], cursors: { evidenceThrough: 0 } }, events, 'user')
  await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'goal' }] }, events, 'user')
  await expect(store.publish(2, scope, { operations: [{ action: 'RESTORE', id: 'goal' }] }, events, 'model')).rejects.toThrow('NOTEBOOK_RESTORE_FORBIDDEN')
  const restored = await store.publish(2, scope, { operations: [{ action: 'RESTORE', id: 'goal' }] }, events, 'user')
  expect(restored.active).toMatchObject([{ id: 'goal', pinned: true, revision: 3 }])
  await expect(store.publish(3, scope, { operations: [{ action: 'RESTORE', id: 'goal' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_ENTRY_CONFLICT')
  await expect(store.publish(3, scope, { operations: [{ action: 'RESTORE', id: 'missing' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_ENTRY_MISSING')
  await store.publish(3, scope, { operations: [{ action: 'REMOVE', id: 'goal' }] }, events, 'user')
  const timeline = await store.readHistory(scope)
  expect(timeline.records.map(row => row.action)).toEqual(['retire', 'restore', 'retire'])
  expect(timeline.historyRevision).toBe(3)
  await store.close()
})

it('advances cursors on an empty delta and validates operation identities', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-cursors-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  const empty = await store.publish(0, scope, { operations: [], cursors: { evidenceThrough: 1, commitThrough: 0 } }, events, 'model')
  expect(empty).toMatchObject({ revision: 1, historyRevision: 0, cursors: { evidenceThrough: 1, commitThrough: 0 } })
  await expect(store.publish(1, scope, { operations: [{ action: 'KEEP', id: 'absent' }] }, events, 'model')).rejects.toThrow('NOTEBOOK_ENTRY_MISSING')
  await expect(store.publish(1, scope, { operations: [add('dup'), { action: 'REMOVE', id: 'dup' }] }, events, 'model')).rejects.toThrow('NOTEBOOK_DUPLICATE_OPERATION')
  await expect(store.publish(1, scope, { operations: [{ action: 'PURGE', id: 'dup' }] }, events, 'model')).rejects.toThrow('NOTEBOOK_INVALID_ACTION')
  await store.close()
  const restarted = new NotebookV2Store(home, budgets)
  const confirmed = await restarted.publish(1, scope, { operations: [] }, events, 'model')
  expect(confirmed.cursors).toEqual({ evidenceThrough: 1, commitThrough: 0 })
  await restarted.close()
})

it('copy-converts a v1 notebook without touching its bytes and keeps conversion idempotent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-migrate-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
  await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [
    { action: 'ADD', id: 'keep-me', kind: 'constraint', text: 'Keep the official engine', seq: 0, quote: '把官方引擎保留下来', pinned: true },
    { action: 'ADD', id: 'retired-one', kind: 'next', text: 'Plan the test run', seq: 0, quote: '把官方引擎保留下来', pinned: false },
  ] }, events, 'user')
  await legacy.update('session', { baseRevision: 1, sourceThrough: 0, operations: [{ action: 'REMOVE', id: 'retired-one' }] }, events, 'user')
  await legacy.close()
  const legacyBytes = await readFile(join(directory(home), 'current.json'), 'utf8')
  const legacyRevisions = (await readdir(directory(home))).filter(name => name.startsWith('revision-'))

  const store = new NotebookV2Store(home, budgets)
  const projection = await store.readActive(scope)
  expect(projection).toMatchObject({ revision: 2, entries: [{ id: 'keep-me', pinned: true, active: true }] })
  expect(projection.entries).toHaveLength(1)
  const history = await store.readHistory(scope)
  expect(history.records).toMatchObject([{ action: 'migrate', atRevision: 2, generation: null, legacySourceThrough: 0, note: { id: 'retired-one', active: false, revision: 2 } }])
  const published = await store.publish(2, scope, { operations: [add('new-after-migration')], cursors: { evidenceThrough: 0 } }, events, 'model')
  expect(published.revision).toBe(3)
  expect(published.cursors).toEqual({ evidenceThrough: 0, commitThrough: -1 })
  await expect(store.publish(3, scope, { operations: [add('retired-one')] }, events, 'user')).rejects.toThrow('NOTEBOOK_ID_REUSED')
  await store.close()

  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
  expect((await readdir(directory(home))).filter(name => name.startsWith('revision-'))).toHaveLength(legacyRevisions.length)

  // Crash before the commit pointer: a journal without current.json re-converts to the same bytes.
  const crashed = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-crash-'))
  onTestFinished(() => rm(crashed, { recursive: true, force: true }))
  await mkdir(directory(crashed), { recursive: true })
  await copyFile(join(directory(home), 'current.json'), join(directory(crashed), 'current.json'))
  const completeJournal = await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')
  await mkdir(v2Directory(crashed), { recursive: true })
  await writeFile(join(v2Directory(crashed), 'history.jsonl'), completeJournal, 'utf8')
  const recovered = new NotebookV2Store(crashed, budgets)
  expect(JSON.stringify(await recovered.readActive(scope))).toBe(JSON.stringify({ scope, revision: 2, entries: projection.entries }))
  await recovered.close()
  expect(await readFile(join(v2Directory(crashed), 'history.jsonl'), 'utf8')).toBe(completeJournal)
})

it('refuses unknown legacy formats without overwriting them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-unknown-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await mkdir(directory(home), { recursive: true })
  const unknown = JSON.stringify({ schemaVersion: 99, sessionId: 'session', revision: 4, sourceThrough: 2, entries: [] })
  await writeFile(join(directory(home), 'current.json'), unknown, 'utf8')
  const store = new NotebookV2Store(home, budgets)
  await expect(store.readActive(scope)).rejects.toThrow('NOTEBOOK_MIGRATION_REFUSED')
  await expect(store.readHistory(scope)).rejects.toThrow('NOTEBOOK_MIGRATION_REFUSED')
  await store.close()
  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(unknown)
  expect(await stat(v2Directory(home)).catch(() => null)).toBeNull()
})

it('fences crash residue beyond the committed journal prefix and truncates it on the next publish', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-residue-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await store.publish(0, scope, { operations: [add('first')], cursors: { evidenceThrough: 0 } }, events, 'model')
  await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'first' }] }, events, 'user')
  const committed = await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')
  await store.close()
  await writeFile(join(v2Directory(home), 'history.jsonl'), committed + '{"action":"retire","historyRevision":2,garbage\n', 'utf8')
  const fenced = new NotebookV2Store(home, budgets)
  expect((await fenced.readHistory(scope)).records).toHaveLength(1)
  expect(await fenced.readActive(scope)).toMatchObject({ revision: 2, entries: [] })
  await fenced.publish(2, scope, { operations: [add('second')] }, events, 'model')
  expect(await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')).toBe(committed)
  await fenced.close()

  await writeFile(join(v2Directory(home), 'history.jsonl'), committed.slice(0, -8), 'utf8')
  await expect(new NotebookV2Store(home, budgets).readActive(scope)).rejects.toThrow('NOTEBOOK_CORRUPT_STATE')
})

it('preserves crash residue on admission refusal and preserves a selected commit on failed settlement', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-quota-tail-')), first = new NotebookV2Store(home, budgets)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await first.publish(0, scope, { operations: [add('first')], cursors: { evidenceThrough: 0 } }, events, 'model'); await first.close()
  const journal = join(v2Directory(home), 'history.jsonl'), residue = 'uncommitted and retained\n'
  await writeFile(journal, residue)
  const denied = new NotebookV2Store(home, budgets, { admit: () => { throw Error('QUOTA_DENIED') } })
  await expect(denied.publish(1, scope, { operations: [] }, events, 'user')).rejects.toThrow('QUOTA_DENIED')
  expect(await readFile(journal, 'utf8')).toBe(residue); await denied.close()
  let settled = false
  const accepted = new NotebookV2Store(home, budgets, { admit: () => ({ run: work => work(), settle: async () => {
    settled = true; throw Error('SETTLEMENT_UNKNOWN')
  } }) })
  expect((await accepted.publish(1, scope, { operations: [] }, events, 'user')).revision).toBe(2)
  expect(settled).toBe(true); expect(await readFile(journal, 'utf8')).toBe(''); await accepted.close()
  const cold = new NotebookV2Store(home, budgets)
  expect((await cold.readSelected(scope)).revision).toBe(2); await cold.close()
})

it('bounds local history disk without deleting evidence and exposes one admission seam', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-disk-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const writes: NotebookStorageWrite[] = []
  const observing: NotebookStorageAdmission = {
    admit: (write) => {
      writes.push({ ...write, scope: { ...write.scope } })
      if (write.currentBytes + write.maxWriteBytes > write.limitBytes) throw Error('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
    },
  }
  const small: NotebookBudgets = { ...budgets, maxHistoryBytes: 3072 }
  const store = new NotebookV2Store(home, small, observing)
  await store.publish(0, scope, { operations: [add('survivor')], cursors: { evidenceThrough: 0 } }, events, 'model')
  let revision = 1, index = 0, refused: string | undefined
  while (refused === undefined) {
    const id = `cycle-${index++}`
    try {
      const added = await store.publish(revision, scope, { operations: [add(id)] }, events, 'model')
      await store.publish(added.revision, scope, { operations: [{ action: 'REMOVE', id }] }, events, 'user')
      revision = added.revision + 1
    } catch (error) {
      refused = (error as Error).message
    }
  }
  expect(refused).toBe('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
  const active = await store.readActive(scope)
  expect(active.entries.map(row => row.id)).toContain('survivor')
  expect((await store.readHistory(scope)).records.length).toBeGreaterThan(0)
  expect(writes.length).toBeGreaterThan(1)
  expect(writes.every(write => write.scope.sessionId === 'session' && write.limitBytes === small.maxHistoryBytes
    && write.currentBytes >= 0 && write.maxWriteBytes > 0)).toBe(true)
  expect([...writes].sort((left, right) => left.currentBytes - right.currentBytes).map(write => write.currentBytes))
    .toEqual(writes.map(write => write.currentBytes))
  await store.close()

  const repaired = new NotebookV2Store(home, budgets)
  const current = await repaired.readActive(scope)
  await repaired.publish(current.revision, scope, { operations: [{ action: 'REMOVE', id: current.entries.at(-1)!.id }] }, events, 'user')
  await repaired.close()

  const blocked = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-blocked-'))
  onTestFinished(() => rm(blocked, { recursive: true, force: true }))
  const refusing: NotebookStorageAdmission = { admit: () => { throw Error('NOTEBOOK_HISTORY_BUDGET_EXCEEDED') } }
  const denied = new NotebookV2Store(blocked, budgets, refusing)
  await expect(denied.publish(0, scope, { operations: [add('never')], cursors: { evidenceThrough: 0 } }, events, 'model')).rejects.toThrow('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
  await denied.close()
  expect(await stat(v2Directory(blocked)).catch(() => null)).toBeNull()
})

it('publishes nothing when aborted before the commit', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-abort-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await store.publish(0, scope, { operations: [add('committed')], cursors: { evidenceThrough: 0 } }, events, 'model')
  const controller = new AbortController()
  controller.abort()
  await expect(store.publish(1, scope, { operations: [add('aborted')] }, events, 'model', controller.signal)).rejects.toThrow()
  expect(await store.readActive(scope)).toMatchObject({ revision: 1, entries: [{ id: 'committed' }] })
  await store.close()
  expect(await new NotebookV2Store(home, budgets).readActive(scope)).toMatchObject({ revision: 1, entries: [{ id: 'committed' }] })
})

for (const mode of ['immutable-write-failure', 'abort-after-immutable', 'current-write-failure'] as const) {
  it('recovers a same-instance retry after ' + mode + ' without corrupting durable history', async () => {
    const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-retry-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const store = new NotebookV2Store(home, budgets)
    await store.publish(0, scope, { operations: [add('a'), add('b')], cursors: { evidenceThrough: 0 } }, events, 'user')
    const controller = new AbortController()
    if (mode === 'immutable-write-failure') injection.failRevision = true
    else if (mode === 'abort-after-immutable') injection.abortAfterRevision = controller
    else injection.failCurrent = true
    await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'a' }] }, events, 'user', controller.signal)).rejects.toThrow()
    injection.failRevision = false
    injection.failCurrent = false
    injection.abortAfterRevision = undefined
    expect(await store.readActive(scope)).toMatchObject({ revision: 1, entries: [{ id: 'a' }, { id: 'b' }] })
    await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'b' }] }, events, 'user')
    const projection = await store.readActive(scope)
    expect(projection.entries.map(row => row.id)).toEqual(['a'])
    const history = await store.readHistory(scope)
    expect(history.records.map(row => row.action === 'retire' ? row.note.id : row.action)).toEqual(['b'])
    const journal = await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')
    expect(journal.split('\n').filter(line => line !== '')).toHaveLength(1)
    expect(JSON.parse(journal.split('\n')[0]!)).toMatchObject({ action: 'retire', note: { id: 'b' } })
    await store.close()
    const cold = new NotebookV2Store(home, budgets)
    expect(await cold.readActive(scope)).toMatchObject(projection)
    expect((await cold.readHistory(scope)).records).toEqual(history.records)
    const revisions = (await readdir(v2Directory(home))).filter(name => name.startsWith('revision-2-'))
    // An aborted or failed commit after the rename leaves one complete unreferenced twin beside
    // the differently composed retry; a failure before any write leaves none.
    expect(revisions.length).toBe(mode === 'immutable-write-failure' ? 1 : 2)
    await cold.close()
  })
}

it('recovers a same-instance retry of the identical publish after a current-write failure', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-current-retry-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookV2Store(home, budgets)
  await store.publish(0, scope, { operations: [add('first')], cursors: { evidenceThrough: 0 } }, events, 'model')
  injection.failCurrent = true
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'first' }] }, events, 'user')).rejects.toThrow('CURRENT_WRITE_FAILED')
  injection.failCurrent = false
  const retried = await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'first' }] }, events, 'user')
  expect(retried.revision).toBe(2)
  const journal = await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')
  expect(journal.split('\n').filter(line => line !== '')).toHaveLength(1)
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-2-'))).toHaveLength(1)
  await store.close()
  expect(await new NotebookV2Store(home, budgets).readActive(scope)).toMatchObject({ revision: 2, entries: [] })
})

it('accounts committed net disk, not reserved peaks, and reaches one admission verdict across restarts', async () => {
  const homes = await Promise.all([1, 2, 3].map(async () => mkdtemp(join(tmpdir(), 'nidofy-notes-v2-net-'))))
  onTestFinished(async () => { await Promise.all(homes.map(home => rm(home, { recursive: true, force: true }))) })
  const writes: NotebookStorageWrite[] = []
  const observing: NotebookStorageAdmission = { admit: (write) => { writes.push({ ...write, scope: { ...write.scope } }) } }
  const first = new NotebookV2Store(homes[0]!, budgets, observing)
  await first.publish(0, scope, { operations: [] }, events, 'user')
  const afterOne = await measureDirectory(homes[0]!)
  await first.publish(1, scope, { operations: [] }, events, 'user')
  expect(writes.at(-1)?.currentBytes).toBe(afterOne)
  const afterTwo = await measureDirectory(homes[0]!)
  const currentSize = (await stat(join(v2Directory(homes[0]!), 'current.json'))).size
  // The third empty publish peaks at exactly this boundary: allowed at ==, refused one byte below,
  // and a reopened store on the same directory reaches the same verdict.
  const boundary = afterTwo + currentSize * 2
  await first.close()
  for (const [home, limit, verdict] of [[homes[1]!, boundary, true], [homes[2]!, boundary - 1, false]] as const) {
    const store = new NotebookV2Store(home, { ...budgets, maxHistoryBytes: limit })
    await store.publish(0, scope, { operations: [] }, events, 'user')
    await store.publish(1, scope, { operations: [] }, events, 'user')
    const attempt = store.publish(2, scope, { operations: [] }, events, 'user')
    if (verdict) await expect(attempt).resolves.toMatchObject({ revision: 3 })
    else await expect(attempt).rejects.toThrow('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
    await store.close()
    const reopened = new NotebookV2Store(home, { ...budgets, maxHistoryBytes: limit })
    if (verdict) expect((await reopened.readActive(scope)).revision).toBe(3)
    else await expect(reopened.publish(2, scope, { operations: [] }, events, 'user')).rejects.toThrow('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
    await reopened.close()
  }
})

it('measures journal growth and failure residue honestly against the real directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-residue-accounting-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const writes: NotebookStorageWrite[] = []
  const observing: NotebookStorageAdmission = { admit: (write) => { writes.push({ ...write, scope: { ...write.scope } }) } }
  const store = new NotebookV2Store(home, budgets, observing)
  await store.publish(0, scope, { operations: [add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'model')
  injection.failRevision = true
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')).rejects.toThrow('REVISION_WRITE_FAILED')
  injection.failRevision = false
  // Admission includes the crash residue. Only an accepted retry truncates it; the following
  // steady state must match the next admission's measured input exactly.
  await store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')
  const afterRetry = await measureDirectory(home)
  await store.publish(2, scope, { operations: [] }, events, 'user')
  expect(writes.at(-1)?.currentBytes).toBe(afterRetry)
  await store.close()
  const reopened = new NotebookV2Store(home, budgets)
  const page = await reopened.readHistory(scope)
  expect(page.records.map(row => row.action === 'retire' ? row.note.id : row.action)).toEqual(['doomed'])
  await reopened.close()
})

it('bounds migration retries to one immutable revision per legacy revision even near the disk cap', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-migration-retry-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
  await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  await legacy.close()
  const legacyBytes = await readFile(join(directory(home), 'current.json'), 'utf8')
  const store = new NotebookV2Store(home, budgets)
  injection.failCurrent = true
  await expect(store.readActive(scope)).rejects.toThrow('CURRENT_WRITE_FAILED')
  await expect(store.readActive(scope)).rejects.toThrow('CURRENT_WRITE_FAILED')
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-1-'))).toHaveLength(1)
  injection.failCurrent = false
  expect((await store.readActive(scope)).revision).toBe(1)
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-1-'))).toHaveLength(1)
  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
  await store.close()

  // A budget that fits the conversion exactly still recovers after a failed pointer write,
  // because the retry reuses the journal and revision bytes instead of writing them again.
  const tight = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-migration-tight-'))
  onTestFinished(() => rm(tight, { recursive: true, force: true }))
  await mkdir(directory(tight), { recursive: true })
  await copyFile(join(directory(home), 'current.json'), join(directory(tight), 'current.json'))
  const fileSize = async (path: string): Promise<number> => (await stat(path).catch(() => null))?.size ?? 0
  const journalSize = await fileSize(join(v2Directory(home), 'history.jsonl'))
  const limit = journalSize + 2 * await fileSize(join(v2Directory(home), 'current.json'))
  const nearCap = new NotebookV2Store(tight, { ...budgets, maxHistoryBytes: limit })
  injection.failCurrent = true
  await expect(nearCap.readActive(scope)).rejects.toThrow('CURRENT_WRITE_FAILED')
  injection.failCurrent = false
  await expect(nearCap.readActive(scope)).resolves.toMatchObject({ revision: 1 })
  expect((await readdir(v2Directory(tight))).filter(name => name.startsWith('revision-1-'))).toHaveLength(1)
  await nearCap.close()
})

it('aborts a lazy conversion during admission without writing any v2 file and retries cleanly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-migration-abort-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
  await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  await legacy.close()
  const legacyBytes = await readFile(join(directory(home), 'current.json'), 'utf8')
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const store = new NotebookV2Store(home, budgets, { admit: async () => { enter(); await gate } })
  const controller = new AbortController()
  const publishing = store.publish(1, scope, { operations: [] }, events, 'user', controller.signal)
  const rejected = expect(publishing).rejects.toThrow()
  await entered
  controller.abort()
  release()
  await rejected
  expect(await stat(v2Directory(home)).catch(() => null)).toBeNull()
  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
  const retry = new NotebookV2Store(home, budgets)
  // The uncancellable conversion binds revision 1, then the retried empty publish commits revision 2.
  await expect(retry.publish(1, scope, { operations: [] }, events, 'user')).resolves.toMatchObject({ revision: 2 })
  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
  await retry.close()
  await store.close()
})

for (const mode of ['warm-retry', 'cold-retry'] as const) {
  it('recovers an identical candidate after a partially written immutable temporary (' + mode + ')', async () => {
    const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-partial-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const store = new NotebookV2Store(home, budgets)
    const first = await store.publish(0, scope, { operations: [add('kept'), add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'user')
    injection.partialRevision = true
    await expect(store.publish(first.revision, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')).rejects.toThrow('PARTIAL_REVISION_WRITE')
    injection.partialRevision = false
    // The failure leaves the committed state untouched and never exposes a final-path partial.
    expect(await store.readActive(scope)).toMatchObject({ revision: 1, entries: [{ id: 'doomed' }, { id: 'kept' }] })
    expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-2-'))).toHaveLength(0)
    expect((await readdir(v2Directory(home))).filter(name => name.endsWith('.tmp'))).toHaveLength(0)
    // Warm retries on the same instance; cold closes first and reopens from disk.
    const retried = mode === 'warm-retry' ? store : (await store.close(), new NotebookV2Store(home, budgets))
    const published = await retried.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')
    expect(published.revision).toBe(2)
    await retried.close()
    const cold = new NotebookV2Store(home, budgets)
    const projection = await cold.readActive(scope)
    expect(projection.entries.map(row => row.id)).toEqual(['kept'])
    const revisions = (await readdir(v2Directory(home))).filter(name => name.startsWith('revision-2-'))
    expect(revisions).toHaveLength(1)
    expect(await readFile(join(v2Directory(home), revisions[0]!), 'utf8')).toContain('"revision":2')
    expect((await cold.readHistory(scope)).records.map(row => row.action === 'retire' ? row.note.id : row.action)).toEqual(['doomed'])
    await cold.close()
  })
}

it('refuses a malformed residue at the final path and keeps its bytes for diagnosis', async () => {
  const complete = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-twin-source-'))
  const residue = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-twin-'))
  onTestFinished(async () => {
    await Promise.all([rm(complete, { recursive: true, force: true }), rm(residue, { recursive: true, force: true })])
  })
  const reference = new NotebookV2Store(complete, budgets)
  await reference.publish(0, scope, { operations: [add('kept'), add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'user')
  await reference.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')
  await reference.close()
  const twinName = (await readdir(v2Directory(complete))).find(name => name.startsWith('revision-2-'))!
  const twinBytes = await readFile(join(v2Directory(complete), twinName), 'utf8')
  const store = new NotebookV2Store(residue, budgets)
  await store.publish(0, scope, { operations: [add('kept'), add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'user')
  // Place a truncated file at the content-derived final path. Whether it was ever committed
  // cannot be determined from its bytes, so the publish must refuse instead of replacing it.
  const damaged = twinBytes.slice(0, 18)
  await writeFile(join(v2Directory(residue), twinName), damaged, 'utf8')
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_IMMUTABLE_CONFLICT')
  expect(await readFile(join(v2Directory(residue), twinName), 'utf8')).toBe(damaged)
  expect((await store.readActive(scope)).revision).toBe(1)
  expect(await stat(join(v2Directory(residue), 'history.jsonl')).catch(() => null)).toBeNull()
  await expect(store.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_IMMUTABLE_CONFLICT')
  expect(await readFile(join(v2Directory(residue), twinName), 'utf8')).toBe(damaged)
  await store.close()
})

it('refuses to overwrite a complete immutable twin whose commit status is unknown', async () => {
  const complete = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-foreign-source-'))
  const target = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-foreign-'))
  onTestFinished(async () => {
    await Promise.all([rm(complete, { recursive: true, force: true }), rm(target, { recursive: true, force: true })])
  })
  const reference = new NotebookV2Store(complete, budgets)
  await reference.publish(0, scope, { operations: [add('kept'), add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'user')
  await reference.publish(1, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')
  await reference.close()
  const twinName = (await readdir(v2Directory(complete))).find(name => name.startsWith('revision-2-'))!
  const store = new NotebookV2Store(target, budgets)
  const first = await store.publish(0, scope, { operations: [add('kept'), add('doomed')], cursors: { evidenceThrough: 0 } }, events, 'user')
  // A complete revision-1 state file at the revision-2 content-derived name: not provably
  // uncommitted, so the publish must refuse and leave the twin byte-identical.
  const foreign = (await readdir(v2Directory(target))).find(name => name.startsWith('revision-1-'))!
  const foreignBytes = await readFile(join(v2Directory(target), foreign), 'utf8')
  await mkdir(v2Directory(target), { recursive: true })
  await writeFile(join(v2Directory(target), twinName), foreignBytes, 'utf8')
  await expect(store.publish(first.revision, scope, { operations: [{ action: 'REMOVE', id: 'doomed' }] }, events, 'user')).rejects.toThrow('NOTEBOOK_IMMUTABLE_CONFLICT')
  expect(await readFile(join(v2Directory(target), twinName), 'utf8')).toBe(foreignBytes)
  expect((await store.readActive(scope)).revision).toBe(1)
  await store.close()
})

it('recovers a lazy conversion whose immutable temporary was partially written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-migration-partial-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
  await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  await legacy.close()
  const legacyBytes = await readFile(join(directory(home), 'current.json'), 'utf8')
  const store = new NotebookV2Store(home, budgets)
  injection.partialRevision = true
  await expect(store.readActive(scope)).rejects.toThrow('PARTIAL_REVISION_WRITE')
  injection.partialRevision = false
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-1-'))).toHaveLength(0)
  const projection = await store.readActive(scope)
  expect(projection).toMatchObject({ revision: 1, entries: [{ id: 'legacy' }] })
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-1-'))).toHaveLength(1)
  expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
  await store.close()
  expect(await new NotebookV2Store(home, budgets).readActive(scope)).toMatchObject(projection)
})

it('accounts the temporary and residue of a partially written immutable within the same budget', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-partial-budget-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
  await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  await legacy.close()
  const writes: NotebookStorageWrite[] = []
  const observing: NotebookStorageAdmission = { admit: (write) => { writes.push({ ...write, scope: { ...write.scope } }) } }
  const probe = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-partial-probe-'))
  onTestFinished(() => rm(probe, { recursive: true, force: true }))
  const probeLegacy = new NotebookStore(probe, { maxEntries: 8, maxBytes: 8192 })
  await probeLegacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
  await probeLegacy.close()
  const sizing = new NotebookV2Store(probe, budgets)
  await sizing.readActive(scope)
  const probeFiles = await readdir(v2Directory(probe))
  let footprint = 0
  for (const name of probeFiles) footprint += (await stat(join(v2Directory(probe), name))).size
  // The conversion fits exactly: journal plus two state-sized writes (temporary then current).
  const limit = footprint
  const store = new NotebookV2Store(home, { ...budgets, maxHistoryBytes: limit }, observing)
  injection.partialRevision = true
  await expect(store.readActive(scope)).rejects.toThrow('PARTIAL_REVISION_WRITE')
  injection.partialRevision = false
  const afterFailure = await measureDirectory(home)
  // The retry's admission must see exactly the measured post-failure bytes and still fit.
  await expect(store.readActive(scope)).resolves.toMatchObject({ revision: 1 })
  expect(writes.every(write => write.currentBytes + write.maxWriteBytes <= limit)).toBe(true)
  expect(writes).toHaveLength(2)
  expect(writes[1]?.currentBytes).toBe(afterFailure)
  expect((await readdir(v2Directory(home))).filter(name => name.startsWith('revision-1-'))).toHaveLength(1)
  await store.close()
  await sizing.close()
})

for (const damage of ['truncated', 'unknown-version'] as const) {
  it(`refuses cold recovery over a committed immutable damaged after pointer loss (${damage})`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'nidofy-notes-v2-committed-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const legacy = new NotebookStore(home, { maxEntries: 8, maxBytes: 8192 })
    await legacy.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('legacy')] }, events, 'user')
    await legacy.close()
    const legacyBytes = await readFile(join(directory(home), 'current.json'), 'utf8')
    const initial = new NotebookV2Store(home, budgets)
    expect(await initial.readActive(scope)).toMatchObject({ revision: 1 })
    await initial.close()
    // The conversion really published this revision: the immutable bytes equal committed current.
    const committedCurrent = await readFile(join(v2Directory(home), 'current.json'), 'utf8')
    const revisionPath = join(v2Directory(home), (await readdir(v2Directory(home))).find(name => name.startsWith('revision-1-'))!)
    expect(await readFile(revisionPath, 'utf8')).toBe(committedCurrent)
    const historyBytes = await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')
    const committed = JSON.parse(committedCurrent) as Record<string, unknown>
    const damaged = damage === 'truncated'
      ? committedCurrent.slice(0, 18)
      : JSON.stringify({ ...committed, schemaVersion: 99 })
    await writeFile(revisionPath, damaged, 'utf8')
    await rm(join(v2Directory(home), 'current.json'))
    const cold = new NotebookV2Store(home, budgets)
    await expect(cold.readActive(scope)).rejects.toThrow('NOTEBOOK_IMMUTABLE_CONFLICT')
    await cold.close()
    // The damaged bytes survive untouched for diagnosis; no new current, journal and v1 unchanged.
    expect(await readFile(revisionPath, 'utf8')).toBe(damaged)
    expect(await stat(join(v2Directory(home), 'current.json')).catch(() => null)).toBeNull()
    expect(await readFile(join(v2Directory(home), 'history.jsonl'), 'utf8')).toBe(historyBytes)
    expect(await readFile(join(directory(home), 'current.json'), 'utf8')).toBe(legacyBytes)
    const again = new NotebookV2Store(home, budgets)
    await expect(again.readActive(scope)).rejects.toThrow('NOTEBOOK_IMMUTABLE_CONFLICT')
    await again.close()
    expect(await readFile(revisionPath, 'utf8')).toBe(damaged)
  })
}
