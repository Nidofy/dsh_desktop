/** Authenticated local history verifies phrase, trigram and recent-substring candidates against raw durable sources. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { NotebookReadOptions } from './shared/notebook-types.ts'
import { readNotebookObservation } from './notebook-commit.ts'
import type { HistoryGroups } from './history-groups.ts'
import type { HistoryAuthority } from './shared/notebook-types.ts'
import type { HistorySubstringIndex } from './history-index.ts'

/** Original-event locator; a digest detects a changed event within the same physical generation. */
export interface HistoryHit {
  sessionId: SessionId
  generation: SessionPersistenceGeneration
  seq: SessionSeq
  type: SessionEvent['type']
  role: 'user' | 'assistant' | 'tool'
  digest: string
  snippet: string
  surface: string
  /** Project searches bind every later preview and citation to this association revision. */
  authority?: HistoryAuthority
}
/** Search does not claim exhaustive substring recall outside the configured recent-source window. */
export interface HistoryPage {
  items: HistoryHit[]
  substringIncomplete: boolean
  scannedSessions: number
  scannedEvents: number
  indexedEvents?: number
  indexRecovered?: boolean
}
/** Revalidated original material; only an explicit user action may copy it to a draft. */
export interface HistorySource extends HistoryHit { text: string }

function digest(event: SessionEvent): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex')
}
function role(event: SessionEvent): HistoryHit['role'] | undefined {
  if (event.type === 'user/message' && event.data.source.kind === 'user') return 'user'
  if (event.type === 'assistant/message') return 'assistant'
  if (event.type === 'tool/result') return 'tool'
  return undefined
}

/** Uses explicit user associations and disposable local indexes without model requests. */
export class LocalHistorySearch {
  /** @param ctx - Existing authenticated local-user composition.
   * @param reads - Shared recent-source, result and metadata bounds.
   * @param maxBytes - Complete original and locator UTF-8 budget.
   * @param groups - Optional explicit association owner; absent refuses project search.
   * @param index - Optional disposable trigram index; absent keeps the bounded recent supplement.
   */
  constructor(private readonly ctx: Context, private readonly reads: NotebookReadOptions,
    private readonly maxBytes: number, private readonly groups?: HistoryGroups, private readonly index?: HistorySubstringIndex) {}

  private async allowed(caller: SessionId, target: SessionId, workspace: boolean | 'project', signal: AbortSignal,
    authority?: HistoryAuthority): Promise<void> {
    signal.throwIfAborted()
    if (workspace === 'project') {
      if (!this.groups || !authority) throw Error('HISTORY_PROJECT_REQUIRED')
      await this.groups.validate(caller, target, authority, signal)
      return
    }
    if (caller === target) return
    if (!workspace) throw Error('HISTORY_SCOPE_REFUSED')
    const current = await this.ctx.sessionPersistence.stat(caller, { signal })
    const records = current?.header.cwd === undefined ? [] : await this.ctx.sessionQuery.filterSessions([
      { kind: 'id', values: [target] }, { kind: 'cwd', values: [current.header.cwd] },
    ], signal)
    if (records.length !== 1) throw Error('HISTORY_SCOPE_REFUSED')
  }

  /** Search verified local candidates inside the explicitly selected Session, cwd or associated project.
   * @param caller - Current authenticated UI Session.
   * @param query - Literal query, never an FTS expression.
   * @param workspace - False selects the current Session; true uses exact cwd; project requires explicit associations.
   * @param signal - Scope/lifecycle cancellation.
   * @returns Verified original locators and explicit substring coverage limits.
   */
  async search(caller: SessionId, query: string, workspace: boolean | 'project', signal: AbortSignal): Promise<HistoryPage> {
    const persistence = this.ctx.sessionPersistence
    const callerMeta = await persistence.stat(caller, { signal })
    if (!callerMeta) throw Error('HISTORY_SOURCE_UNAVAILABLE')
    if (workspace && callerMeta.header.cwd === undefined) throw Error('WORKSPACE_REQUIRED')
    const authority = workspace === 'project' ? await this.groups?.capture(caller, signal) : undefined
    if (workspace === 'project' && !authority) throw Error('HISTORY_PROJECT_REQUIRED')
    const filters = authority ? [{ kind: 'cwd' as const, values: authority.members.map(member => member.path) }]
      : workspace && callerMeta.header.cwd !== undefined ? [{ kind: 'cwd' as const, values: [callerMeta.header.cwd] }]
        : [{ kind: 'id' as const, values: [caller] }]
    const records = await this.ctx.sessionQuery.filterSessions(filters, signal)
    const lexical = workspace
      ? (await this.ctx.sessionQuery.searchSessions({ query, sessionFilters: filters }, { signal })).items.map(row => row.bestMatch)
      : (await this.ctx.sessionQuery.searchEvents({ sessionId: caller, query }, { signal })).items
    const substringSessions = new Set(records.slice(0, this.reads.maxCachedSessions).map(row => row.header.id))
    const selected = new Set(substringSessions)
    for (const hit of lexical) selected.add(hit.sessionId)
    let bytes = 0
    const page: HistoryPage = { items: [], substringIncomplete: records.length > this.reads.maxCachedSessions,
      scannedSessions: 0, scannedEvents: 0 }
    const hits = new Map<string, HistoryHit>()
    for (const id of selected) {
      await this.allowed(caller, id, workspace, signal, authority)
      const observation = await readNotebookObservation(this.ctx, id, signal)
      if (authority ? !authority.members.some(member => member.path === observation.meta.cwd)
        : workspace && observation.meta.cwd !== callerMeta.header.cwd) throw Error('HISTORY_SCOPE_REFUSED')
      const recentStart = Math.max(0, observation.events.length - this.reads.recentScanEvents)
      const indexOwner = this.index
      const indexed = indexOwner && Array.from(query).length >= 3 && substringSessions.has(id)
        ? await persistence.withGeneration(id, observation.generation, async () => {
          if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
          await this.allowed(caller, id, workspace, signal, authority)
          const result = await indexOwner.search(observation, query, signal)
          await this.allowed(caller, id, workspace, signal, authority)
          return result
        }, { signal }) : undefined
      if (recentStart > 0 && !indexed || indexed?.incomplete) page.substringIncomplete = true
      if (indexed) {
        page.indexedEvents = (page.indexedEvents ?? 0) + indexed.indexedEvents
        page.indexRecovered = (page.indexRecovered ?? false) || indexed.recovered
      }
      const phrase = new Map(lexical.filter(hit => hit.sessionId === id).map(hit => [hit.seq, hit]))
      const candidates = new Map((substringSessions.has(id) ? observation.events.slice(recentStart) : []).map(event => [event.seq, event]))
      for (const seq of phrase.keys()) { const event = observation.events[seq]; if (event) candidates.set(seq, event) }
      for (const seq of indexed?.seqs ?? []) { const event = observation.events[seq]; if (event) candidates.set(event.seq, event) }
      for (const event of candidates.values()) {
        signal.throwIfAborted()
        const lexicalHit = phrase.get(event.seq)
        page.scannedEvents++
        const speaker = role(event)
        if (!speaker) continue
        const text = extractSessionEventText(event)
        const match = text.indexOf(query)
        if (!lexicalHit && match < 0) continue
        const hit: HistoryHit = { sessionId: id, generation: observation.generation, seq: event.seq,
          type: event.type, role: speaker, digest: digest(event),
          snippet: lexicalHit?.snippet ?? text,
          surface: lexicalHit?.surface ?? 'original', ...authority ? { authority } : {} }
        // Complete original plus its returned locator counts against the existing UTF-8 evidence budget.
        const charge = Buffer.byteLength(JSON.stringify({ ...hit, text }))
        if (bytes + charge > this.maxBytes) { page.substringIncomplete = true; continue }
        bytes += charge
        hits.set(String(id) + ':' + String(event.seq), hit)
      }
      page.scannedSessions++
    }
    page.items = [...hits.values()].slice(0, this.reads.recentEventLimit)
    if (hits.size > page.items.length) page.substringIncomplete = true
    // Source and group membership are checked again after every asynchronous source load.
    for (const hit of page.items) {
      if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
      await persistence.withGeneration(hit.sessionId, hit.generation, async () => {
        if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
        await this.allowed(caller, hit.sessionId, workspace, signal, authority)
      }, { signal })
    }
    const current = await persistence.stat(caller, { signal })
    if (!current || current.header.cwd !== callerMeta.header.cwd) throw Error('HISTORY_SCOPE_REFUSED')
    if (authority) await this.groups?.validate(caller, undefined, authority, signal)
    if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
    signal.throwIfAborted()
    return page
  }

  /** Read a selected locator from the raw durable source after scope and generation validation.
   * @param caller - Current authenticated UI Session.
   * @param hit - Previously returned locator; all source identity fields must still match.
   * @param workspace - Same explicit Session, exact-cwd or project selection as the original search.
   * @param signal - Scope/lifecycle cancellation.
   * @returns Complete bounded original text; stale, changed and unrelated sources refuse.
   */
  async source(caller: SessionId, hit: Pick<HistoryHit, 'sessionId' | 'generation' | 'seq' | 'digest' | 'authority'>,
    workspace: boolean | 'project', signal: AbortSignal): Promise<HistorySource> {
    const persistence = this.ctx.sessionPersistence
    const callerMeta = await persistence.stat(caller, { signal })
    if (!callerMeta) throw Error('HISTORY_SOURCE_UNAVAILABLE')
    await this.allowed(caller, hit.sessionId, workspace, signal, hit.authority)
    const observation = await readNotebookObservation(this.ctx, hit.sessionId, signal)
    if (hit.authority ? !hit.authority.members.some(member => member.path === observation.meta.cwd)
      : workspace && observation.meta.cwd !== callerMeta.header.cwd) throw Error('HISTORY_SCOPE_REFUSED')
    const event = observation.events[hit.seq], speaker = event && role(event)
    if (observation.generation !== hit.generation || !event || !speaker || digest(event) !== hit.digest) throw Error('HISTORY_SOURCE_CHANGED')
    const source: HistorySource = { ...hit, seq: event.seq, type: event.type, role: speaker,
      snippet: '', surface: 'original', text: extractSessionEventText(event) }
    if (Buffer.byteLength(JSON.stringify(source)) > this.maxBytes) throw Error('HISTORY_SOURCE_LIMIT')
    if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
    return persistence.withGeneration(hit.sessionId, hit.generation, async () => {
      if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
      await this.allowed(caller, hit.sessionId, workspace, signal, hit.authority)
      const current = await persistence.stat(caller, { signal })
      if (!current || current.header.cwd !== callerMeta.header.cwd) throw Error('HISTORY_SCOPE_REFUSED')
      if (workspace === 'project' && hit.authority) await this.groups?.validate(caller, hit.sessionId, hit.authority, signal)
      if (this.ctx.sessionPersistence.identity !== persistence.identity) throw Error('HISTORY_SOURCE_CHANGED')
      signal.throwIfAborted()
      return source
    }, { signal })
  }
}
