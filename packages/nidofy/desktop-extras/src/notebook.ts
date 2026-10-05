/** Versioned working notes; immutable revisions retain evidence and user corrections. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { object, text } from './state.ts'

/** Notebook categories describe current work rather than a chronological summary. */
export const notebookKinds = ['objective', 'constraint', 'decision', 'file', 'verification', 'failure', 'issue', 'next'] as const
import type { ActiveNotebookProjection, Note, Notebook, NotebookBudgets, NotebookHistoryPage, NotebookHistoryRecord, NotebookLimits, NotebookMigrateRecord, NotebookScope, NotebookStorageAdmission, NotebookStorageWrite, NotebookV2 } from './shared/notebook-types.ts'
export type { ActiveNotebookProjection, Note, Notebook, NotebookBudgets, NotebookHistoryPage, NotebookHistoryRecord, NotebookLimits, NotebookMigrateRecord, NotebookRetireRecord, NotebookRestoreRecord, NotebookScope, NotebookStorageAdmission, NotebookStorageWrite, NotebookV2, NotebookV2Candidate } from './shared/notebook-types.ts'
/** Empty notebooks have no processed source events. */
export function emptyNotebook(sessionId: string): Notebook {
  return { schemaVersion: 1, sessionId, revision: 0, sourceThrough: -1, entries: [] }
}
function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw Error('NOTEBOOK_INVALID_NUMBER')
  return value
}
function note(value: unknown): Note {
  const p = object(value), kind = text(p.kind, 32)
  if (!notebookKinds.includes(kind as Note['kind']) || typeof p.pinned !== 'boolean' || typeof p.active !== 'boolean') throw Error('NOTEBOOK_INVALID_ENTRY')
  return { id: text(p.id, 80), kind: kind as Note['kind'], text: text(p.text, 2048), seq: integer(p.seq, 0), quote: text(p.quote, 512), pinned: p.pinned, active: p.active, revision: integer(p.revision, 1) }
}
/** Validate durable or model-supplied notebook bytes before they become state. */
export function parseNotebook(value: unknown, sessionId: string, limits: NotebookLimits): Notebook {
  const p = object(value)
  if (p.schemaVersion !== 1 || p.sessionId !== sessionId || !Array.isArray(p.entries)) throw Error('NOTEBOOK_INVALID_STATE')
  const result: Notebook = { schemaVersion: 1, sessionId, revision: integer(p.revision, 0),
    sourceThrough: integer(p.sourceThrough, -1), entries: p.entries.map(note) }
  if (new Set(result.entries.map(row => row.id)).size !== result.entries.length || result.entries.some(row => row.revision > result.revision)) throw Error('NOTEBOOK_INVALID_STATE')
  bounded(result, limits)
  return result
}
function bounded(value: Notebook, limits: NotebookLimits): void {
  if (value.entries.length > limits.maxEntries || Buffer.byteLength(JSON.stringify(value)) > limits.maxBytes) throw Error('NOTEBOOK_BUDGET_EXCEEDED')
}
/** Apply an explicit delta with source checks; models cannot change pinned entries. */
export function applyNotebookDelta(previous: Notebook, input: unknown, events: readonly SessionEvent[], actor: 'user' | 'model', limits: NotebookLimits): Notebook {
  const p = object(input)
  if (p.baseRevision !== previous.revision) throw Error('NOTEBOOK_REVISION_CONFLICT')
  const through = integer(p.sourceThrough, -1)
  if (through < previous.sourceThrough || through >= events.length) throw Error('NOTEBOOK_SOURCE_CONFLICT')
  if (!Array.isArray(p.operations) || p.operations.length > limits.maxEntries) throw Error('NOTEBOOK_INVALID_DELTA')
  const next = structuredClone(previous), seen = new Set<string>()
  next.revision++; next.sourceThrough = through
  for (const raw of p.operations) {
    const op = object(raw), id = text(op.id, 80), prior = next.entries.find(row => row.id === id)
    if (seen.has(id)) throw Error('NOTEBOOK_DUPLICATE_OPERATION')
    seen.add(id)
    if (op.action === 'KEEP') { if (!prior) throw Error('NOTEBOOK_ENTRY_MISSING'); continue }
    if (prior?.pinned && actor === 'model') throw Error('NOTEBOOK_PINNED')
    if (op.action === 'REMOVE') {
      if (!prior) throw Error('NOTEBOOK_ENTRY_MISSING')
      prior.active = false; prior.revision = next.revision; continue
    }
    if (op.action !== 'ADD' && op.action !== 'UPDATE') throw Error('NOTEBOOK_INVALID_ACTION')
    if ((op.action === 'ADD') === Boolean(prior)) throw Error('NOTEBOOK_ENTRY_CONFLICT')
    // An explicit expected revision prevents silently overwriting a changed decision.
    if (prior && op.expectedRevision !== prior.revision) throw Error('NOTEBOOK_ENTRY_CONFLICT')
    const row = note({ ...op, pinned: actor === 'user' ? op.pinned === true : false, active: true, revision: next.revision })
    const source = events[row.seq]
    if (!source || row.seq > through || !row.quote.trim() || !extractSessionEventText(source).includes(row.quote)) throw Error('NOTEBOOK_EVIDENCE_MISMATCH')
    // A note or checkpoint is not fresh evidence for another note.
    if (source.type !== 'assistant/message' && source.type !== 'tool/result'
      && !(source.type === 'user/message' && source.data.source.kind === 'user')) throw Error('NOTEBOOK_ORIGINAL_SOURCE_REQUIRED')
    if (prior) next.entries[next.entries.indexOf(prior)] = row
    else next.entries.push(row)
  }
  bounded(next, limits)
  return next
}
/** Atomic current pointer plus immutable revision files; no partial cursor publication. */
export class NotebookStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly home: string, readonly limits: NotebookLimits) {}
  private directory(sessionId: string): string { return join(this.home, createHash('sha256').update(sessionId).digest('hex')) }
  async read(sessionId: string): Promise<Notebook> {
    let bytes: string
    try { bytes = await readFile(join(this.directory(sessionId), 'current.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyNotebook(sessionId); throw error }
    const value: unknown = JSON.parse(bytes)
    return parseNotebook(value, sessionId, this.limits)
  }
  update(sessionId: string, input: unknown, events: readonly SessionEvent[], actor: 'user' | 'model', signal?: AbortSignal): Promise<Notebook> {
    const operation = this.queue.catch(() => { /* A rejected operation must not block later revisions. */ }).then(async () => {
      signal?.throwIfAborted()
      const previous = await this.read(sessionId)
      const next = applyNotebookDelta(previous, input, events, actor, this.limits)
      signal?.throwIfAborted()
      const dir = this.directory(sessionId), bytes = JSON.stringify(next) + '\n'
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(join(dir, `revision-${next.revision}-${randomUUID()}.json`), bytes, { flag: 'wx', mode: 0o600 })
      signal?.throwIfAborted()
      await writeFileAtomic(join(dir, 'current.json'), bytes, { mode: 0o600 })
      return next
    })
    this.queue = operation
    return operation
  }
  async close(): Promise<void> { await this.queue.catch(() => { /* The original caller receives write failures. */ }) }
}

// --- v2: separated active set, append-only history journal and dual cursors ---

/** Stored v2 state plus `historyBytes`, the committed length of the history journal on disk. */
interface StoredNotebookV2 extends NotebookV2 { historyBytes: number }

/** Committed v2 state of one session directory with its derived id index and disk accounting. */
interface LoadedNotebookV2 {
  stored: StoredNotebookV2
  committed: boolean
  records: NotebookHistoryRecord[]
  used: Set<string>
  retired: Map<string, Note>
  journalSize: number
  currentSize: number
  diskBytes: number
}

/** Largest history page one readHistory call may return; larger requests fail instead of paging unbounded. */
const HISTORY_PAGE_MAX = 256
/** History page size when the caller states no limit. */
const HISTORY_PAGE_DEFAULT = 50
/** Structural v1 validation without legacy budget caps; conversion preserves whatever was already published. */
const UNBOUNDED: NotebookLimits = { maxEntries: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER }

/** Storage admission enforcing only the local history budget; the future quota owner replaces this object. */
const localHistoryAdmission: NotebookStorageAdmission = {
  admit(write: NotebookStorageWrite): void {
    if (write.currentBytes + write.maxWriteBytes > write.limitBytes) throw Error('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
  },
}

/** Reject budgets that are not positive safe integers before any state depends on them. */
function validateBudgets(budgets: NotebookBudgets): void {
  const values = [budgets.maxActiveEntries, budgets.maxActiveBytes, budgets.maxDeltaBytes,
    budgets.maxEvidenceBytes, budgets.maxHistoryBytes]
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('NOTEBOOK_BUDGETS_INVALID')
  }
}

/** Fixed sort by id; the active set and every projection use this one order. */
function byId(left: Note, right: Note): number { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0 }

/** Fresh uncommitted state for a scope no v1 or v2 publication ever reached. */
function emptyStoredV2(scope: NotebookScope): StoredNotebookV2 {
  return { schemaVersion: 2, scope: { sessionId: scope.sessionId, generation: scope.generation }, revision: 0,
    cursors: { evidenceThrough: -1, commitThrough: -1 }, active: [], historyRevision: 0, historyBytes: 0 }
}

/** Canonical state bytes written identically to the immutable revision file and to current.json. */
function storedV2Bytes(stored: StoredNotebookV2): string {
  return JSON.stringify({ schemaVersion: 2, scope: { sessionId: stored.scope.sessionId, generation: stored.scope.generation },
    revision: stored.revision, cursors: { evidenceThrough: stored.cursors.evidenceThrough, commitThrough: stored.cursors.commitThrough },
    active: stored.active, historyRevision: stored.historyRevision, historyBytes: stored.historyBytes }) + '\n'
}

/** Deterministic committed projection of the active set; equal revisions serialize to equal bytes. */
function projectV2(stored: StoredNotebookV2): ActiveNotebookProjection {
  return { scope: { sessionId: stored.scope.sessionId, generation: stored.scope.generation },
    revision: stored.revision, entries: stored.active.map(row => ({ ...row })) }
}

/** Parse one committed journal line; unreadable bytes are corruption, not a notebook error. */
function parseJsonLine(line: string): unknown {
  try { return JSON.parse(line) as unknown } catch { throw Error('NOTEBOOK_CORRUPT_STATE') }
}

/** Parse committed current.json bytes; unreadable bytes are corruption, not a notebook error. */
function parseJsonState(bytes: string): unknown {
  try { return JSON.parse(bytes) as unknown } catch { throw Error('NOTEBOOK_CORRUPT_STATE') }
}

/** Validate durable or supplied v2 bytes before they become state; a different scope generation is a conflict, not corruption. */
function parseStoredV2(value: unknown, scope: NotebookScope): StoredNotebookV2 {
  const p = object(value), s = object(p.scope), cursors = object(p.cursors)
  if (p.schemaVersion !== 2 || typeof s.sessionId !== 'string' || s.sessionId === ''
    || typeof s.generation !== 'number' || !Number.isSafeInteger(s.generation) || s.generation < 0) throw Error('NOTEBOOK_INVALID_STATE')
  if (s.sessionId !== scope.sessionId || s.generation !== scope.generation) throw Error('NOTEBOOK_SCOPE_CONFLICT')
  if (!Array.isArray(p.active)) throw Error('NOTEBOOK_INVALID_STATE')
  const revision = integer(p.revision, 0), active = p.active.map(note)
  let previous: string | null = null
  for (const row of active) {
    if (!row.active || row.revision > revision || previous !== null && row.id <= previous) throw Error('NOTEBOOK_INVALID_STATE')
    previous = row.id
  }
  return { schemaVersion: 2, scope: { sessionId: scope.sessionId, generation: scope.generation }, revision,
    cursors: { evidenceThrough: integer(cursors.evidenceThrough, -1), commitThrough: integer(cursors.commitThrough, -1) },
    active, historyRevision: integer(p.historyRevision, 0), historyBytes: integer(p.historyBytes, 0) }
}

/** Validate one history journal record from durable bytes. */
function parseHistoryRecord(value: unknown): NotebookHistoryRecord {
  const p = object(value)
  const historyRevision = integer(p.historyRevision, 1), atRevision = integer(p.atRevision, 0)
  if (p.action === 'migrate') {
    if (historyRevision !== 1 || p.generation !== null) throw Error('NOTEBOOK_CORRUPT_STATE')
    const row = p.note === null ? null : note(p.note)
    if (row !== null && row.active) throw Error('NOTEBOOK_CORRUPT_STATE')
    return { action: 'migrate', historyRevision, atRevision, generation: null, legacySourceThrough: integer(p.legacySourceThrough, -1), note: row }
  }
  if (p.action === 'retire' || p.action === 'restore') {
    const generation = integer(p.generation, 0)
    if (p.action === 'retire') {
      const row = note(p.note)
      if (row.active) throw Error('NOTEBOOK_CORRUPT_STATE')
      return { action: 'retire', historyRevision, atRevision, generation, note: row }
    }
    return { action: 'restore', historyRevision, atRevision, generation, id: text(p.id, 80) }
  }
  throw Error('NOTEBOOK_CORRUPT_STATE')
}

/**
 * Parse the committed journal prefix and verify its grouping in one pass: records form
 * consecutive non-empty groups numbered 1..`historyRevision`, one `atRevision` per group,
 * and migration records appear only in an all-migration first group.
 */
function parseJournal(content: string, stored: StoredNotebookV2): NotebookHistoryRecord[] {
  if (content === '') {
    if (stored.historyRevision !== 0) throw Error('NOTEBOOK_CORRUPT_STATE')
    return []
  }
  if (!content.endsWith('\n')) throw Error('NOTEBOOK_CORRUPT_STATE')
  const records = content.split('\n').slice(0, -1).map(line => parseHistoryRecord(parseJsonLine(line)))
  let groupRevision = 0, groupAtRevision = 0, migrateSeen = false, nonMigrateSeen = false
  for (const record of records) {
    if (record.historyRevision !== groupRevision) {
      if (record.historyRevision !== groupRevision + 1) throw Error('NOTEBOOK_CORRUPT_STATE')
      groupRevision = record.historyRevision
      groupAtRevision = record.atRevision
    } else if (record.atRevision !== groupAtRevision) throw Error('NOTEBOOK_CORRUPT_STATE')
    if (record.action === 'migrate') {
      if (groupRevision !== 1 || nonMigrateSeen) throw Error('NOTEBOOK_CORRUPT_STATE')
      migrateSeen = true
    } else if (groupRevision === 1) {
      if (migrateSeen) throw Error('NOTEBOOK_CORRUPT_STATE')
      nonMigrateSeen = true
    }
  }
  if (groupRevision !== stored.historyRevision) throw Error('NOTEBOOK_CORRUPT_STATE')
  return records
}

/** Derived history index: every used id plus the latest retired content per id. */
interface HistoryIndex { used: Set<string>; retired: Map<string, Note> }

/** Replay committed records into the used-id index and the latest retired content per id. */
function indexRecords(records: readonly NotebookHistoryRecord[], active: readonly Note[]): HistoryIndex {
  const used = new Set(active.map(row => row.id)), retired = new Map<string, Note>()
  for (const record of records) {
    if (record.action === 'restore') { used.add(record.id); retired.delete(record.id); continue }
    if (record.note === null) continue
    used.add(record.note.id)
    retired.set(record.note.id, record.note)
  }
  if (active.some(row => retired.has(row.id))) throw Error('NOTEBOOK_CORRUPT_STATE')
  return { used, retired }
}

/** Read UTF-8 text when present; absence is `undefined`, other failures propagate. */
async function readOptionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

/** Read file bytes when present; absence is `undefined`, other failures propagate. */
async function readOptionalBytes(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

/** Sum of actual file sizes in the v2 namespace, including any crash residue. */
async function measureDisk(directory: string): Promise<number> {
  let names: string[]
  try { names = await readdir(directory) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
  let total = 0
  for (const name of names) total += (await stat(join(directory, name))).size
  return total
}

/** Actual history-journal size on disk, so a fresh state still fences crash residue before appending. */
async function journalSizeOf(v2: string): Promise<number> {
  try { return (await stat(join(v2, 'history.jsonl'))).size }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
}

/** Content-derived immutable state-file name, so a retried identical write reuses one bounded file. */
function revisionFileName(revision: number, bytes: string): string {
  return `revision-${revision}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.json`
}

/** Status of the content-derived final name: absent, identical reusable bytes, or different bytes. */
type RevisionTwinStatus = 'absent' | 'identical' | 'conflict'

/**
 * Read the content-derived final name once. `conflict` means the path holds different bytes;
 * whether those bytes were ever committed cannot be determined from the file, its name or its
 * revision number, so callers must refuse instead of replacing them.
 */
async function revisionTwinStatus(v2: string, revision: number, bytes: string): Promise<RevisionTwinStatus> {
  const existing = await readOptionalText(join(v2, revisionFileName(revision, bytes)))
  if (existing === undefined) return 'absent'
  return existing === bytes ? 'identical' : 'conflict'
}

/** Rename with bounded retries for transient Windows scanner interference, mirroring dsh-atomic-write. */
async function renameWithRetry(temp: string, target: string): Promise<void> {
  let delay = 20
  for (let attempt = 0;; attempt++) {
    try { await rename(temp, target); return }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') || attempt >= 8) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 200)
  }
}

/**
 * Publish one immutable state file without ever exposing a partial final path: the complete
 * bytes first go to an exclusive-create temporary sibling, and the content-derived final name
 * receives them only through a rename of that complete temporary. An identical final file is
 * reused without writing. A final file holding any different bytes is left untouched and the
 * publish fails with `NOTEBOOK_IMMUTABLE_CONFLICT`: parse failures, invalid fields or an
 * unknown schema version do not show that the file was never committed, so no overwrite,
 * downgrade or deletion is performed and the original bytes stay available for diagnosis.
 * Committed generations under other names are never written.
 */
async function writeStateFile(v2: string, revision: number, bytes: string): Promise<void> {
  const target = join(v2, revisionFileName(revision, bytes))
  const twin = await revisionTwinStatus(v2, revision, bytes)
  if (twin === 'identical') return
  if (twin === 'conflict') throw Error('NOTEBOOK_IMMUTABLE_CONFLICT')
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
    await renameWithRetry(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch((cleanupError: unknown) => {
      // A cleanup failure never masks the original write failure; the orphan temp stays counted.
      void cleanupError
    })
    throw error
  }
}

/**
 * Atomic v2 store separating the bounded active set from an append-only history journal.
 * Retired ids are never reusable; a publish appends journal records, publishes one
 * content-derived immutable revision file through a complete temporary (so a failed write
 * never exposes a partial final path), then atomically replaces `current.json`, and
 * `historyBytes` in that pointer fences the committed journal prefix. A partial write or abort
 * leaves the committed state untouched and its residue fenced: the same store instance
 * re-observes the real journal on the next publish, truncates the uncommitted tail to the
 * committed length, and reuses identical revision bytes; a pre-existing final file holding
 * different bytes is refused untouched with a diagnostic, because whether it was ever
 * committed cannot be determined. All methods serialize through one queue; one store instance
 * owns a home directory and concurrent instances are unsupported, matching the v1 store.
 */
export class NotebookV2Store {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly cache = new Map<string, LoadedNotebookV2>()
  private readonly admission: NotebookStorageAdmission
  constructor(private readonly home: string, readonly budgets: NotebookBudgets, admission?: NotebookStorageAdmission) {
    validateBudgets(budgets)
    this.admission = admission ?? localHistoryAdmission
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => { /* A rejected operation must not block later revisions. */ }).then(operation)
    this.queue = task
    return task
  }
  private directory(sessionId: string): string { return join(this.home, createHash('sha256').update(sessionId).digest('hex')) }

  /** Read the committed active projection of one scope.
   * @param scope - Session and generation whose notebook is read.
   * @returns deterministic projection sorted by id, empty for an unpublished scope. A read that
   * triggers the lazy v1 conversion runs it to completion; only publish takes a signal.
   */
  readActive(scope: NotebookScope): Promise<ActiveNotebookProjection> {
    return this.enqueue(async () => projectV2((await this.loadScope(scope)).stored))
  }

  /** Read one bounded page of committed history records, oldest first.
   * @param scope - Session and generation whose journal is read.
   * @param pageToken - Record offset carried from the previous page; defaults to the first page.
   * @param limit - Page size between 1 and 256; defaults to 50.
   * @returns the committed records from the requested offset and the next page token, or null at the end.
   */
  readHistory(scope: NotebookScope, pageToken?: number | null, limit?: number): Promise<NotebookHistoryPage> {
    return this.enqueue(async () => {
      const loaded = await this.loadScope(scope), token = pageToken ?? 0, size = limit ?? HISTORY_PAGE_DEFAULT
      if (!Number.isSafeInteger(token) || token < 0 || token > loaded.records.length
        || !Number.isSafeInteger(size) || size < 1 || size > HISTORY_PAGE_MAX) throw Error('NOTEBOOK_INVALID_PAGE')
      const end = Math.min(token + size, loaded.records.length)
      return { scope: { sessionId: scope.sessionId, generation: scope.generation }, revision: loaded.stored.revision,
        historyRevision: loaded.stored.historyRevision, records: structuredClone(loaded.records.slice(token, end)),
        nextToken: end < loaded.records.length ? end : null }
    })
  }

  /** Validate and atomically publish one candidate delta against a committed revision.
   * @param expectedRevision - Committed revision the caller observed; a mismatch rejects the publish.
   * @param scope - Session and generation; differs from the stored scope only after an explicit rebind decision.
   * @param candidate - `{ operations, cursors }` delta; ADD/UPDATE carry `id, kind, text, seq, quote` and UPDATE also `expectedRevision`.
   * @param events - Session events of the observed generation; cited evidence must be an original event inside the checked prefix.
   * @param actor - `model` publishes cannot touch pinned notes or restore retired ones.
   * @param signal - Aborts before the first disk write — including the lazy v1 conversion this
   * publish triggers — and before the commit pointer; partial writes never publish, and their
   * residue is fenced off and truncated by the next attempt.
   * @returns the committed v2 revision.
   */
  publish(expectedRevision: number, scope: NotebookScope, candidate: unknown, events: readonly SessionEvent[], actor: 'user' | 'model', signal?: AbortSignal): Promise<NotebookV2> {
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      const loaded = await this.loadScope(scope, signal)
      const stored = loaded.stored
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('NOTEBOOK_INVALID_NUMBER')
      if (expectedRevision !== stored.revision) throw Error('NOTEBOOK_REVISION_CONFLICT')
      const p = object(candidate)
      if (!Array.isArray(p.operations) || p.operations.length > this.budgets.maxActiveEntries) throw Error('NOTEBOOK_INVALID_DELTA')
      if (Buffer.byteLength(JSON.stringify(p.operations)) > this.budgets.maxDeltaBytes) throw Error('NOTEBOOK_DELTA_BUDGET_EXCEEDED')
      const cursors = object(p.cursors === undefined ? {} : p.cursors)
      let evidenceThrough = stored.cursors.evidenceThrough, commitThrough = stored.cursors.commitThrough
      if (cursors.evidenceThrough !== undefined) {
        const value = integer(cursors.evidenceThrough, -1)
        if (value < evidenceThrough || value >= events.length) throw Error('NOTEBOOK_CURSOR_CONFLICT')
        evidenceThrough = value
      }
      if (cursors.commitThrough !== undefined) {
        const value = integer(cursors.commitThrough, -1)
        if (value < commitThrough || value >= events.length) throw Error('NOTEBOOK_CURSOR_CONFLICT')
        commitThrough = value
      }
      const active = structuredClone(stored.active) as Note[]
      const nextRevision = stored.revision + 1, nextHistoryRevision = stored.historyRevision + 1
      const newRecords: NotebookHistoryRecord[] = []
      const seen = new Set<string>()
      let evidenceBytes = 0
      const checkEvidence = (row: Note): void => {
        const source = events[row.seq]
        if (row.seq > evidenceThrough || !source || !row.quote.trim() || !extractSessionEventText(source).includes(row.quote)) throw Error('NOTEBOOK_EVIDENCE_MISMATCH')
        if (source.type !== 'assistant/message' && source.type !== 'tool/result'
          && !(source.type === 'user/message' && source.data.source.kind === 'user')) throw Error('NOTEBOOK_ORIGINAL_SOURCE_REQUIRED')
        evidenceBytes += Buffer.byteLength(row.quote)
        if (evidenceBytes > this.budgets.maxEvidenceBytes) throw Error('NOTEBOOK_EVIDENCE_BUDGET_EXCEEDED')
      }
      for (const raw of p.operations) {
        const op = object(raw), id = text(op.id, 80), prior = active.find(row => row.id === id)
        if (seen.has(id)) throw Error('NOTEBOOK_DUPLICATE_OPERATION')
        seen.add(id)
        if (op.action === 'KEEP') { if (!prior) throw Error('NOTEBOOK_ENTRY_MISSING'); continue }
        if (op.action === 'REMOVE') {
          if (!prior) throw Error('NOTEBOOK_ENTRY_MISSING')
          if (prior.pinned && actor === 'model') throw Error('NOTEBOOK_PINNED')
          active.splice(active.indexOf(prior), 1)
          newRecords.push({ action: 'retire', historyRevision: nextHistoryRevision, atRevision: nextRevision, generation: scope.generation, note: { ...prior, active: false, revision: nextRevision } })
          continue
        }
        if (op.action === 'RESTORE') {
          if (actor === 'model') throw Error('NOTEBOOK_RESTORE_FORBIDDEN')
          if (prior) throw Error('NOTEBOOK_ENTRY_CONFLICT')
          const retiredNote = loaded.retired.get(id)
          if (!retiredNote) throw Error('NOTEBOOK_ENTRY_MISSING')
          active.push({ ...retiredNote, active: true, revision: nextRevision })
          newRecords.push({ action: 'restore', historyRevision: nextHistoryRevision, atRevision: nextRevision, generation: scope.generation, id })
          continue
        }
        if (op.action !== 'ADD' && op.action !== 'UPDATE') throw Error('NOTEBOOK_INVALID_ACTION')
        if (op.action === 'ADD' && prior) throw Error('NOTEBOOK_ENTRY_CONFLICT')
        if (op.action === 'ADD' && loaded.used.has(id)) throw Error('NOTEBOOK_ID_REUSED')
        if (op.action === 'UPDATE') {
          if (!prior) throw Error('NOTEBOOK_ENTRY_MISSING')
          if (prior.pinned && actor === 'model') throw Error('NOTEBOOK_PINNED')
          if (op.expectedRevision !== prior.revision) throw Error('NOTEBOOK_ENTRY_CONFLICT')
        }
        const row = note({ ...op, pinned: actor === 'user' ? op.pinned === true : false, active: true, revision: nextRevision })
        checkEvidence(row)
        if (prior) active[active.indexOf(prior)] = row
        else active.push(row)
      }
      active.sort(byId)
      const historyRecords = newRecords
      const append = historyRecords.length > 0 ? historyRecords.map(record => JSON.stringify(record)).join('\n') + '\n' : ''
      const appendBytes = Buffer.byteLength(append)
      const next: StoredNotebookV2 = { schemaVersion: 2, scope: { sessionId: scope.sessionId, generation: scope.generation },
        revision: nextRevision, cursors: { evidenceThrough, commitThrough }, active,
        historyRevision: historyRecords.length > 0 ? nextHistoryRevision : stored.historyRevision,
        historyBytes: stored.historyBytes + appendBytes }
      const projection = projectV2(next)
      if (next.active.length > this.budgets.maxActiveEntries || Buffer.byteLength(JSON.stringify(projection)) > this.budgets.maxActiveBytes) throw Error('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
      const stateBytes = storedV2Bytes(next), stateSize = Buffer.byteLength(stateBytes)
      const directory = this.directory(scope.sessionId), v2 = join(directory, 'v2')
      // Refuse before any disk mutation when the content-derived final name holds different
      // bytes: whether they were ever committed is unknown, so nothing may be overwritten.
      const twin = await revisionTwinStatus(v2, next.revision, stateBytes)
      if (twin === 'conflict') throw Error('NOTEBOOK_IMMUTABLE_CONFLICT')
      // Observe the real journal before any mutation: an earlier partial write may have left an
      // uncommitted tail that the committed `historyBytes` must fence off again.
      const actualJournal = await journalSizeOf(v2)
      if (actualJournal < stored.historyBytes) throw Error('NOTEBOOK_CORRUPT_STATE')
      const journalResidue = actualJournal - stored.historyBytes
      if (journalResidue !== 0) {
        await truncate(join(v2, 'history.jsonl'), stored.historyBytes)
        loaded.diskBytes -= journalResidue
        loaded.journalSize = stored.historyBytes
      }
      // Reserve the write peak: appended journal bytes, the immutable revision file unless the
      // identical content file already exists, and the atomic replacement temporary for current.
      const revisionReuse = twin === 'identical'
      const writePeak = appendBytes + (revisionReuse ? 0 : stateSize) + stateSize
      const write: NotebookStorageWrite = { scope, currentBytes: loaded.diskBytes,
        maxWriteBytes: writePeak, limitBytes: this.budgets.maxHistoryBytes }
      await this.admission.admit(write)
      signal?.throwIfAborted()
      try {
        await mkdir(v2, { recursive: true, mode: 0o700 })
        if (append !== '') await appendFile(join(v2, 'history.jsonl'), append, 'utf8')
        await writeStateFile(v2, next.revision, stateBytes)
        signal?.throwIfAborted()
        await writeFileAtomic(join(v2, 'current.json'), stateBytes, { mode: 0o600 })
      } catch (error) {
        // A partial write invalidates the cached disk accounting; the next load re-measures.
        this.cache.delete(scope.sessionId)
        throw error
      }
      loaded.stored = next
      loaded.committed = true
      loaded.records.push(...historyRecords)
      const index = indexRecords(loaded.records, next.active)
      loaded.used = index.used
      loaded.retired = index.retired
      loaded.journalSize = next.historyBytes
      // Account the committed net change, not the reserved peak: the journal grew by the append,
      // one immutable file was added unless reused, and current replaced its predecessor.
      loaded.diskBytes += appendBytes + (revisionReuse ? 0 : stateSize) + stateSize - loaded.currentSize
      loaded.currentSize = stateSize
      return structuredClone({ schemaVersion: next.schemaVersion, scope: next.scope, revision: next.revision,
        cursors: next.cursors, active: next.active, historyRevision: next.historyRevision })
    })
  }

  /** Drain the queue so dispose waits for in-flight publications. */
  async close(): Promise<void> { await this.queue.catch(() => { /* The original caller receives write failures. */ }) }

  /** Load one scope inside the queue: cached when current matches, otherwise from disk with lazy v1 conversion.
   * @param scope - Session and generation whose state is loaded.
   * @param signal - Publish signal forwarded into the lazy conversion; absent for uncancellable reads.
   */
  private async loadScope(scope: NotebookScope, signal?: AbortSignal): Promise<LoadedNotebookV2> {
    const cached = this.cache.get(scope.sessionId)
    if (cached && cached.committed && cached.stored.scope.generation === scope.generation) {
      const bytes = await readOptionalText(join(this.directory(scope.sessionId), 'v2', 'current.json'))
      if (bytes === storedV2Bytes(cached.stored)) return cached
    }
    const directory = this.directory(scope.sessionId), v2 = join(directory, 'v2')
    const current = await readOptionalText(join(v2, 'current.json'))
    if (current !== undefined) {
      const stored = parseStoredV2(parseJsonState(current), scope)
      const journal = await readOptionalBytes(join(v2, 'history.jsonl')) ?? Buffer.alloc(0)
      if (journal.length < stored.historyBytes) throw Error('NOTEBOOK_CORRUPT_STATE')
      const records = parseJournal(journal.subarray(0, stored.historyBytes).toString('utf8'), stored)
      const index = indexRecords(records, stored.active)
      const loaded: LoadedNotebookV2 = { stored, committed: true, records, used: index.used, retired: index.retired,
        journalSize: journal.length, currentSize: Buffer.byteLength(current), diskBytes: await measureDisk(v2) }
      this.cache.set(scope.sessionId, loaded)
      return loaded
    }
    const legacy = await readOptionalText(join(directory, 'current.json'))
    if (legacy === undefined) return await this.freshScope(scope, v2)
    return this.migrateScope(scope, v2, legacy, signal)
  }

  /** Cache and return the unpublished empty state of a scope no v1 or v2 publication reached. */
  private async freshScope(scope: NotebookScope, v2: string): Promise<LoadedNotebookV2> {
    const loaded: LoadedNotebookV2 = { stored: emptyStoredV2(scope), committed: false, records: [], used: new Set<string>(),
      retired: new Map<string, Note>(), journalSize: await journalSizeOf(v2), currentSize: 0, diskBytes: await measureDisk(v2) }
    this.cache.set(scope.sessionId, loaded)
    return loaded
  }

  /**
   * Copy-convert a v1 notebook into the v2 namespace inside the queue. The v1 `current.json`
   * and revision files keep their exact bytes; cursors restart at -1 and the legacy
   * `sourceThrough` survives only as migration metadata. Retrying after a failed commit pointer
   * skips identical journal bytes at their fixed path and reuses the content-derived immutable
   * revision file, so no duplicates accumulate. A missing pointer with higher revision files
   * present is refused — their commit status is unknown — and any pre-existing immutable file
   * holding different bytes refuses the conversion before a single write. A publish signal
   * aborts before the first disk write and before the commit pointer, leaving the v1 notebook
   * untouched.
   */
  private async migrateScope(scope: NotebookScope, v2: string, legacyBytes: string, signal?: AbortSignal): Promise<LoadedNotebookV2> {
    let legacy: Notebook
    try {
      legacy = parseNotebook(JSON.parse(legacyBytes) as unknown, scope.sessionId, UNBOUNDED)
    } catch (error) {
      throw new Error('NOTEBOOK_MIGRATION_REFUSED', { cause: error })
    }
    signal?.throwIfAborted()
    if (legacy.revision === 0 && legacy.entries.length === 0 && legacy.sourceThrough < 0) return await this.freshScope(scope, v2)
    // With the selector missing, higher revision files leave the commit status of that
    // namespace unknown; converting again could overwrite unpublished-or-committed bytes, so
    // refuse with a repairable diagnostic.
    let pending: string[]
    try { pending = await readdir(v2) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') pending = []; else throw error }
    if (pending.some((name) => { const match = /^revision-(\d+)-/.exec(name); return match !== null && Number(match[1]) > legacy.revision })) throw Error('NOTEBOOK_CORRUPT_STATE')
    const active = legacy.entries.filter(row => row.active).sort(byId)
    const retired = legacy.entries.filter(row => !row.active)
    const records: NotebookMigrateRecord[] = retired.map(noteRow => ({ action: 'migrate' as const, historyRevision: 1, atRevision: legacy.revision, generation: null, legacySourceThrough: legacy.sourceThrough, note: noteRow }))
    if (records.length === 0 && legacy.sourceThrough >= 0) records.push({ action: 'migrate', historyRevision: 1, atRevision: legacy.revision, generation: null, legacySourceThrough: legacy.sourceThrough, note: null })
    const journal = records.length > 0 ? records.map(record => JSON.stringify(record)).join('\n') + '\n' : ''
    const stored: StoredNotebookV2 = { schemaVersion: 2, scope: { sessionId: scope.sessionId, generation: scope.generation },
      revision: legacy.revision, cursors: { evidenceThrough: -1, commitThrough: -1 }, active,
      historyRevision: records.length > 0 ? 1 : 0, historyBytes: Buffer.byteLength(journal) }
    if (active.length > this.budgets.maxActiveEntries || Buffer.byteLength(JSON.stringify(projectV2(stored))) > this.budgets.maxActiveBytes) throw Error('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
    const stateBytes = storedV2Bytes(stored), stateSize = Buffer.byteLength(stateBytes)
    // Refuse before any write — journal included — when the content-derived immutable name holds
    // different bytes; whether they were ever committed is unknown and they must survive.
    const twin = await revisionTwinStatus(v2, stored.revision, stateBytes)
    if (twin === 'conflict') throw Error('NOTEBOOK_IMMUTABLE_CONFLICT')
    // Retryable writes are skipped when identical bytes already exist, so a recovery attempt near
    // the budget reserves only what it actually writes.
    const journalReuse = journal === '' || await readOptionalText(join(v2, 'history.jsonl')) === journal
    const revisionReuse = twin === 'identical'
    const write: NotebookStorageWrite = { scope, currentBytes: await measureDisk(v2),
      maxWriteBytes: (journalReuse ? 0 : Buffer.byteLength(journal)) + (revisionReuse ? 0 : stateSize) + stateSize,
      limitBytes: this.budgets.maxHistoryBytes }
    await this.admission.admit(write)
    signal?.throwIfAborted()
    try {
      await mkdir(v2, { recursive: true, mode: 0o700 })
      if (!journalReuse && journal !== '') await writeFileAtomic(join(v2, 'history.jsonl'), journal, { mode: 0o600 })
      await writeStateFile(v2, stored.revision, stateBytes)
      signal?.throwIfAborted()
      await writeFileAtomic(join(v2, 'current.json'), stateBytes, { mode: 0o600 })
    } catch (error) {
      // A partial conversion invalidates the cached disk accounting; the next load re-measures.
      this.cache.delete(scope.sessionId)
      throw error
    }
    const index = indexRecords(records, active)
    const loaded: LoadedNotebookV2 = { stored, committed: true, records, used: index.used, retired: index.retired,
      journalSize: stored.historyBytes, currentSize: stateSize, diskBytes: await measureDisk(v2) }
    this.cache.set(scope.sessionId, loaded)
    return loaded
  }
}
