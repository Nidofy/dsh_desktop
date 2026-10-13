/** Disposable generation-bound checkpoints feed local SQLite trigram search; originals remain authoritative. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, lstat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionDurableObservation } from '@deepseek-ai/dsh-session-persistence'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { object, readJson } from './state.ts'
interface Document { seq: number; text: string }
interface Checkpoint { schemaVersion: 1; sessionId: string; generation: string; through: number; anchor: string; documents: Document[] }
/** Index work and recall limits remain separate from verified source results. */
export interface HistoryIndexResult { seqs: number[]; indexedEvents: number; recovered: boolean; incomplete: boolean }
function hash(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function checkpoint(raw: unknown): Checkpoint {
  const wrapper = object(raw), value = object(wrapper.value)
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1) throw Error('HISTORY_INDEX_VERSION_UNSUPPORTED')
  if (value.schemaVersion !== 1 || typeof value.sessionId !== 'string' || typeof value.generation !== 'string'
    || typeof value.through !== 'number' || !Number.isSafeInteger(value.through) || value.through < -1
    || typeof value.anchor !== 'string' || !Array.isArray(value.documents) || wrapper.checksum !== hash(value)) throw Error('HISTORY_INDEX_CORRUPT')
  let previous = -1
  const documents = value.documents.map((raw) => {
    const document = object(raw)
    if (typeof document.seq !== 'number' || !Number.isSafeInteger(document.seq) || document.seq <= previous
      || document.seq > Number(value.through) || typeof document.text !== 'string') throw Error('HISTORY_INDEX_CORRUPT')
    previous = document.seq
    return { seq: document.seq, text: document.text }
  })
  return { schemaVersion: 1, sessionId: value.sessionId, generation: value.generation,
    through: value.through, anchor: value.anchor, documents }
}

/** One lifecycle owns queued index operations; callers close only after their source jobs drain. */
export class HistorySubstringIndex {
  private readonly directory: string
  private db: DatabaseSync | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  /** @param ctx - Actual local composition, including optional distribution quota.
   * @param home - Managed Notebook home; no source Session path is written.
   * @param maxBytes - Complete checkpoint namespace budget, including temporaries and corruption backups.
   * @param batchEvents - Event batch size before yielding to cancellation.
   * @param resultLimit - Maximum candidate locators; a lookahead reports further matches.
   */
  constructor(private readonly ctx: Context, home: string, private readonly maxBytes: number, private readonly batchEvents: number,
    private readonly resultLimit: number) {
    this.directory = join(home, 'history-substrings-v1')
  }
  /** Reconcile only appended raw events in the same physical generation, then search literal trigrams.
   * @param observation - Official confirmed raw prefix and actual physical identity.
   * @param query - Literal query of at least three Unicode codepoints.
   * @param signal - Request/lifecycle cancellation before checkpoint publication and result return.
   * @returns Candidate seqs plus actual incremental work; capacity refusal retains the recent-window fallback.
   */
  search(observation: SessionDurableObservation, query: string, signal: AbortSignal): Promise<HistoryIndexResult> {
    const task = this.tail.catch(() => { /* A failed read does not disable later index reconstruction. */ })
      .then(() => this.run(observation, query, signal))
    this.tail = task
    return task
  }
  private async run(observation: SessionDurableObservation, query: string, signal: AbortSignal): Promise<HistoryIndexResult> {
    signal.throwIfAborted()
    if (this.closed) throw Error('HISTORY_INDEX_CLOSED')
    const path = join(this.directory, createHash('sha256').update(observation.meta.id).digest('hex') + '.json')
    let previous: Checkpoint | undefined, recovered = false
    try { previous = checkpoint(await readJson(path, this.maxBytes)) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') previous = undefined
      else {
        signal.throwIfAborted()
        if (!(error instanceof SyntaxError) && (!(error instanceof Error)
          || !['HISTORY_INDEX_CORRUPT', 'INVALID_OBJECT'].includes(error.message))) throw error
        await rename(path, path + '.corrupt-' + randomUUID())
        recovered = true
      }
    }
    const anchor = observation.events.at(-1), anchorHash = anchor ? hash(anchor) : ''
    const priorAnchor = previous ? observation.events[previous.through] : undefined
    const reusable = previous?.sessionId === observation.meta.id && previous.generation === observation.generation
      && previous.through <= observation.durableThrough
      && previous.anchor === (previous.through < 0 ? '' : priorAnchor ? hash(priorAnchor) : null)
    const next: Checkpoint = reusable && previous ? { ...previous, documents: [...previous.documents] }
      : { schemaVersion: 1, sessionId: observation.meta.id, generation: observation.generation, through: -1, anchor: '', documents: [] }
    const start = next.through + 1
    let indexedEvents = 0
    let retainedBytes = Buffer.byteLength(JSON.stringify(next))
    for (let index = start; index <= observation.durableThrough; index++) {
      signal.throwIfAborted()
      const event = observation.events[index]
      if (!event) throw Error('HISTORY_SOURCE_CHANGED')
      const original = event.type === 'assistant/message' || event.type === 'tool/result'
        || event.type === 'user/message' && event.data.source.kind === 'user'
      if (original) {
        const document = { seq: event.seq, text: extractSessionEventText(event) }
        retainedBytes += Buffer.byteLength(JSON.stringify(document)) + 1
        if (retainedBytes > this.maxBytes) return { seqs: [], indexedEvents, recovered, incomplete: true }
        next.documents.push(document)
      }
      indexedEvents++
      if (indexedEvents % this.batchEvents === 0) await setImmediate(undefined, { signal })
    }
    next.through = observation.durableThrough; next.anchor = anchorHash
    const bytes = JSON.stringify({ checksum: hash(next), value: next }), size = Buffer.byteLength(bytes)
    if (size > this.maxBytes) return { seqs: [], indexedEvents, recovered, incomplete: true }
    if (!reusable || indexedEvents > 0) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      let used = 0
      for (const file of await readdir(this.directory)) {
        const info = await lstat(join(this.directory, file))
        if (!info.isFile() || info.isSymbolicLink()) throw Error('HISTORY_INDEX_FILE_REFUSED')
        used += info.size
      }
      if (used + size > this.maxBytes) return { seqs: [], indexedEvents, recovered, incomplete: true }
      signal.throwIfAborted()
      const storage = this.ctx.get('nidofyStorage')
      const write = () => { signal.throwIfAborted(); return writeFileAtomic(path, bytes, { mode: 0o600 }) }
      await (storage ? storage.write(path, size * 2, write) : write())
    }
    signal.throwIfAborted()
    if (!this.db) {
      const { DatabaseSync } = await import('node:sqlite')
      this.db = new DatabaseSync(':memory:')
      this.db.exec("CREATE VIRTUAL TABLE documents USING fts5(text, seq UNINDEXED, tokenize='trigram case_sensitive 1')")
    }
    // Each operation installs one bounded source. This avoids retaining another cross-Session event cache.
    const db = this.db
    db.exec('BEGIN')
    try {
      db.exec('DELETE FROM documents')
      const insert = db.prepare('INSERT INTO documents(text, seq) VALUES (?, ?)')
      for (const [index, document] of next.documents.entries()) {
        signal.throwIfAborted()
        insert.run(document.text, document.seq)
        if ((index + 1) % this.batchEvents === 0) await setImmediate(undefined, { signal })
      }
      signal.throwIfAborted(); db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    const rows = db.prepare('SELECT seq FROM documents WHERE documents MATCH ? ORDER BY CAST(seq AS INTEGER) DESC LIMIT ?')
      .all('"' + query.replaceAll('"', '""') + '"', this.resultLimit + 1)
    const seqs = rows.slice(0, this.resultLimit).map((row) => {
      if (typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq)) throw Error('HISTORY_INDEX_CORRUPT')
      return row.seq
    })
    signal.throwIfAborted()
    return { seqs, indexedEvents, recovered, incomplete: rows.length > this.resultLimit }
  }
  /** Reject new operations and wait for SQLite use to stop before closing.
   * @returns Resolution after every queued operation settles and the local database closes.
   */
  async close(): Promise<void> {
    this.closed = true
    await this.tail.catch(() => { /* Initiators retain failed-operation results. */ })
    this.db?.close(); this.db = undefined
  }
}
