import { terminalStatus } from '@nidofy/dsh-desktop-extras/task-recovery'
import type { JobView } from '@deepseek-ai/dsh-jobs'
/** Durable receipt notifications, exclusive system claims and independent companion/handled state. */
import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { object } from '../connections/store.ts'
import type { CommittedVerification, ReceiptId, VerificationOwner } from './verification.ts'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import { publishRecord, readRecord } from './verification-storage.ts'

/** Deterministic source/result-revision/kind identity shared by all notification consumers. */
export type NoticeId = Branded<'nidofy.NoticeId'>
/** Durable identity of a single system-display attempt; an unknown attempt cannot be replayed. */
export type NoticeClaimId = Branded<'nidofy.NoticeClaimId'>
/** Identity of an actual official Session terminal at one physical generation and seq. */
export type SessionNoticeSourceId = Branded<'nidofy.SessionNoticeSourceId'>
/** Receipt and raw-durable Session terminals; approval continues to belong to the official approval service. */
export interface DurableNotice {
  schemaVersion: 1 | 2
  id: NoticeId
  sourceId: ReceiptId | SessionNoticeSourceId
  sourceType: 'receipt' | 'session' | 'job'
  jobSource?: { epoch: string; id: string; startedAt: number; finishedAt: number }
  sessionSource: { generation: string; seq: number; turn: number } | null
  sourceRevision: 1
  kind: 'completed' | 'failed' | 'cancelled' | 'awaiting-acceptance' | 'blocked' | 'limit-reached' | 'interrupted' | 'unknown'
  sequence: number
  scope: { workspace: string | null; sessionId: string | null }
  createdAt: number
  expiresAt: null
}
/** Independent outcomes; failed/unknown/suppressed system delivery never handles or removes the source. */
export interface NoticeDelivery {
  system: 'unclaimed' | 'claimed' | 'sent' | 'failed' | 'unknown' | 'suppressed'
  visibleToCompanion: true
  handled: boolean
}
/** One home-wide user choice persisted with exclusive revision CAS. */
export interface NoticePreferences { revision: number; enabled: boolean }
/** Persisted system-consumer position; attaching skips every historical notice present at that moment. */
export interface NoticeCursor { revision: number; sequence: number }
const hex = /^[a-f0-9]{64}$/
const uuid = /^[a-f0-9-]{36}$/
const numeric = /^\d{16}\.json$/
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const filename = (revision: number): string => String(revision).padStart(16, '0') + '.json'
function record(bytes: Buffer): Record<string, unknown> {
  const value: unknown = JSON.parse(bytes.toString('utf8')), row = object(value)
  if (row.schemaVersion !== 1) throw Error('NOTICE_SCHEMA_UNSUPPORTED')
  return row
}
function notice(bytes: Buffer): DurableNotice {
  const row = object(JSON.parse(bytes.toString('utf8')))
  if (row.schemaVersion !== 1 && row.schemaVersion !== 2) throw Error('NOTICE_SCHEMA_UNSUPPORTED')
  const scope = object(row.scope)
  const job = row.jobSource === undefined ? null : object(row.jobSource)
  const source = row.sessionSource === null ? null : object(row.sessionSource)
  if (typeof row.id !== 'string' || !hex.test(row.id) || typeof row.sourceId !== 'string'
    || row.sourceType !== 'receipt' && row.sourceType !== 'session' && row.sourceType !== 'job'
    || row.sourceType === 'receipt' && (!uuid.test(row.sourceId) || source !== null)
    || row.sourceType === 'session' && (!hex.test(row.sourceId) || source === null || typeof source.generation !== 'string'
      || !integer(source.seq) || !integer(source.turn) || typeof scope.sessionId !== 'string'
      || row.sourceId !== hash(JSON.stringify([scope.sessionId, source.generation, source.seq])))
    || row.sourceType === 'job' && (!job || source !== null || !hex.test(row.sourceId) || typeof scope.sessionId !== 'string'
      || typeof job.epoch !== 'string' || !uuid.test(job.epoch) || typeof job.id !== 'string' || !integer(job.startedAt) || !integer(job.finishedAt)
      || row.sourceId !== hash(JSON.stringify([job.epoch, job.id, scope.sessionId, job.startedAt, job.finishedAt])))
    || row.sourceType !== 'job' && job !== null
    || row.schemaVersion === 1 && (row.sourceType === 'job' || !['completed', 'failed', 'cancelled', 'awaiting-acceptance'].includes(String(row.kind)))
    || row.sourceRevision !== 1 || !['completed', 'failed', 'cancelled', 'awaiting-acceptance', 'blocked', 'limit-reached', 'interrupted', 'unknown'].includes(String(row.kind))
    || row.id !== hash(row.sourceId + ':1:' + String(row.kind)) || !integer(row.sequence) || row.sequence < 1
    || !integer(row.createdAt) || row.expiresAt !== null || scope.workspace !== null && typeof scope.workspace !== 'string'
    || scope.sessionId !== null && typeof scope.sessionId !== 'string') throw Error('NOTICE_RECORD_REFUSED')
  return { schemaVersion: row.schemaVersion, id: brandString<NoticeId>(row.id), sourceId: row.sourceType === 'receipt'
    ? brandString<ReceiptId>(row.sourceId) : brandString<SessionNoticeSourceId>(row.sourceId), sourceRevision: 1,
  ...(job ? { jobSource: {
    epoch: String(job.epoch), id: String(job.id), startedAt: Number(job.startedAt), finishedAt: Number(job.finishedAt) } } : {}),
  sourceType: row.sourceType, sessionSource: source === null ? null
    : { generation: String(source.generation), seq: Number(source.seq), turn: Number(source.turn) },
  kind: row.kind as DurableNotice['kind'], sequence: row.sequence,
  scope: { workspace: scope.workspace, sessionId: scope.sessionId }, createdAt: row.createdAt, expiresAt: null }
}

/** Notifications are written from committed receipts and reconciled after missed callbacks, never produced by UI polling. */
export class NotificationOwner {
  private readonly root: string
  private serial: Promise<unknown> = Promise.resolve()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly activeClaims = new Set<string>()
  private stopping = false
  constructor(home: string, private readonly verification: VerificationOwner) {
    this.root = join(home, 'desktop-actions', 'notifications')
  }
  private track<T>(start: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(Error('NOTICE_OWNER_STOPPING'))
    const work = start()
    this.pending.add(work)
    void work.finally(() => { this.pending.delete(work) }).catch(() => { /* The initiating caller observes the failure. */ })
    return work
  }
  private async names(path: string): Promise<string[]> {
    let names
    try { names = await readdir(path) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    if (names.length > 8192) throw Error('NOTICE_HISTORY_LIMIT')
    return names.filter(name => numeric.test(name)).sort()
  }
  private async notices(): Promise<DurableNotice[]> {
    const path = join(this.root, 'events'), rows: DurableNotice[] = []
    for (const name of await this.names(path)) {
      const bytes = await readRecord(join(path, name))
      if (!bytes) throw Error('NOTICE_RECORD_REFUSED')
      const row = notice(bytes)
      if (row.sequence !== rows.length + 1 || filename(row.sequence) !== name) throw Error('NOTICE_RECORD_REFUSED')
      rows.push(row)
    }
    return rows
  }
  /** Produce an idempotent notice only after the source's terminal publication.
   * @param event - Actual sync-confirmed VerificationOwner result, never caller-supplied status JSON.
   * @returns Complete unique notice; concurrent publication rechecks the durable sequence.
   */
  committed(event: CommittedVerification): Promise<DurableNotice> {
    const receipt = event.receipt, kind: DurableNotice['kind'] = receipt.cancelled ? 'cancelled'
      : receipt.interrupted || receipt.timedOut || receipt.exitCode !== 0 || receipt.tests === 'FAILED' ? 'failed' : 'awaiting-acceptance'
    return this.produce({ schemaVersion: 2, sourceId: event.receiptId, sourceType: 'receipt', sessionSource: null,
      sourceRevision: 1, kind, scope: { workspace: event.workspace, sessionId: event.scope?.sessionId ?? null },
      createdAt: receipt.completedAt, expiresAt: null })
  }
  /** Publish a Session terminal only inside its official generation-protected durable observation.
   * @param id - Official Session identity.
   * @param generation - Actual physical generation observed by the persistence owner.
   * @param workspace - Official immutable cwd, or null when absent.
   * @param event - Confirmed raw durable terminal, never a query-synthesized ending.
   * @returns Unique terminal notice; completed Session work is never a test-PASSED receipt.
   */
  sessionTerminal(id: SessionId, generation: SessionPersistenceGeneration, workspace: string | null,
    event: SessionEvent<'turn/end'>): Promise<DurableNotice> {
    const kind = terminalStatus(event.data.reason.kind).toLowerCase().replace('_', '-') as DurableNotice['kind']
    const sourceId = brandString<SessionNoticeSourceId>(hash(JSON.stringify([id, generation, event.seq])))
    return this.produce({ schemaVersion: 2, sourceId, sourceType: 'session',
      sessionSource: { generation, seq: event.seq, turn: event.data.turn }, sourceRevision: 1, kind,
      scope: { workspace, sessionId: id }, createdAt: event.time, expiresAt: null })
  }
  /** Retain a background job's observed terminal without copying its command or output.
   * @param epoch - Current process registry identity, preventing restarted job ID reuse.
   * @param job - Actual settled registry projection with an owning Session.
   * @param workspace - Owning Session directory, when present.
   * @returns Durable idempotent notice; this cannot reconstruct terminals missed during process death.
   */
  jobTerminal(epoch: string, job: JobView, workspace: string | null): Promise<DurableNotice> {
    if (!job.owner || !integer(job.finishedAt) || !['completed', 'failed', 'killed'].includes(job.status)) throw Error('NOTICE_JOB_SOURCE_INVALID')
    const sourceId = brandString<SessionNoticeSourceId>(hash(JSON.stringify([epoch, job.id, job.owner, job.startedAt, job.finishedAt])))
    return this.produce({ schemaVersion: 2, sourceId, sourceType: 'job', sessionSource: null,
      jobSource: { epoch, id: job.id, startedAt: job.startedAt, finishedAt: job.finishedAt }, sourceRevision: 1,
      kind: job.status === 'killed' ? 'cancelled' : job.status as 'completed' | 'failed',
      scope: { workspace, sessionId: job.owner }, createdAt: job.finishedAt, expiresAt: null })
  }
  private produce(source: Omit<DurableNotice, 'id' | 'sequence'>): Promise<DurableNotice> {
    if (this.stopping) return Promise.reject(Error('NOTICE_OWNER_STOPPING'))
    const task = this.serial.catch(() => {}).then(async () => {
      const id = brandString<NoticeId>(hash(source.sourceId + ':1:' + source.kind))
      for (let attempt = 0; attempt < 32; attempt++) {
        const rows = await this.notices(), prior = rows.find(row => row.id === id)
        if (prior) return prior
        const sequence = rows.length + 1
        const row: DurableNotice = { ...source, id, sequence }
        if (await publishRecord(join(this.root, 'events', filename(sequence)), JSON.stringify(row))) return row
      }
      throw Error('NOTICE_COMMIT_BUSY')
    })
    this.serial = task
    return this.track(() => task)
  }
  /** Reconcile missed result callbacks before establishing a new system baseline.
   * @returns Completion after every bounded retained receipt page is checked; no execution or display is replayed.
   */
  async reconcile(): Promise<void> {
    let after: string | null = null
    do {
      const page = await this.verification.committedRecords(after)
      for (const event of page.records) await this.committed(event)
      after = page.next
    } while (after !== null)
  }
  /** Read the home-wide preference without resetting it on restart.
   * @returns Last committed revision; absence means disabled revision zero.
   */
  async preferences(): Promise<NoticePreferences> {
    const path = join(this.root, 'preferences'), last = (await this.names(path)).at(-1)
    if (!last) return { revision: 0, enabled: false }
    const bytes = await readRecord(join(path, last))
    if (!bytes) throw Error('NOTICE_PREFERENCES_UNKNOWN')
    const row = record(bytes)
    if (!integer(row.revision) || filename(row.revision) !== last || typeof row.enabled !== 'boolean') throw Error('NOTICE_RECORD_REFUSED')
    return { revision: row.revision, enabled: row.enabled }
  }
  /** Commit an explicit user preference, refusing a stale multi-window edit.
   * @param expectedRevision - Last preference revision observed by the local user.
   * @param enabled - Whether Main may display new system notices.
   * @returns Committed preference; disabling leaves every notice and receipt available.
   */
  async configure(expectedRevision: unknown, enabled: unknown): Promise<NoticePreferences> {
    if (!integer(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER || typeof enabled !== 'boolean')
      throw Error('NOTICE_PREFERENCES_INVALID')
    return this.track(async () => {
      if ((await this.preferences()).revision !== expectedRevision) throw Error('NOTICE_PREFERENCES_CONFLICT')
      const row = { schemaVersion: 1, revision: expectedRevision + 1, enabled }
      if (!await publishRecord(join(this.root, 'preferences', filename(row.revision)), JSON.stringify(row)))
        throw Error('NOTICE_PREFERENCES_CONFLICT')
      return { revision: row.revision, enabled }
    })
  }
  /** Observe the one shared system consumption cursor.
   * @returns Durable position; absence is revision/sequence zero.
   */
  async cursor(): Promise<NoticeCursor> {
    const path = join(this.root, 'cursor'), last = (await this.names(path)).at(-1)
    if (!last) return { revision: 0, sequence: 0 }
    const bytes = await readRecord(join(path, last))
    if (!bytes) throw Error('NOTICE_CURSOR_UNKNOWN')
    const row = record(bytes)
    if (!integer(row.revision) || filename(row.revision) !== last || !integer(row.sequence)) throw Error('NOTICE_RECORD_REFUSED')
    return { revision: row.revision, sequence: row.sequence }
  }
  /** CAS the consumption position after inspecting a complete delivered page.
   * @param expectedRevision - Current shared cursor revision.
   * @param sequence - Observed sequence; movement backwards or beyond published events refuses.
   * @returns New durable cursor, with no system-display replay.
   */
  async advance(expectedRevision: unknown, sequence: unknown): Promise<NoticeCursor> {
    if (!integer(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER || !integer(sequence)) throw Error('NOTICE_CURSOR_INVALID')
    return this.track(async () => {
      const current = await this.cursor(), maximum = (await this.notices()).at(-1)?.sequence ?? 0
      if (current.revision !== expectedRevision) throw Error('NOTICE_CURSOR_CONFLICT')
      if (sequence < current.sequence || sequence > maximum) throw Error('NOTICE_CURSOR_INVALID')
      const row = { schemaVersion: 1, revision: expectedRevision + 1, sequence }
      if (!await publishRecord(join(this.root, 'cursor', filename(row.revision)), JSON.stringify(row))) throw Error('NOTICE_CURSOR_CONFLICT')
      return { revision: row.revision, sequence }
    })
  }
  /** Attach Main after initial startup or Host reconnection; historical notices remain visible without being displayed.
   * @returns Durable baseline and persisted preference.
   */
  async attach(): Promise<{ cursor: NoticeCursor; preferences: NoticePreferences }> {
    await this.reconcile()
    for (let attempt = 0; attempt < 32; attempt++) {
      const cursor = await this.cursor(), sequence = (await this.notices()).at(-1)?.sequence ?? 0
      try { return { cursor: await this.advance(cursor.revision, sequence), preferences: await this.preferences() } }
      catch (error) { if (!(error instanceof Error) || error.message !== 'NOTICE_CURSOR_CONFLICT') throw error }
    }
    throw Error('NOTICE_CURSOR_BUSY')
  }
  /** Read new notices for Main; this query never creates notifications.
   * @returns At most 100 new notices and current durable consumption/preference state.
   */
  async poll(): Promise<{ cursor: NoticeCursor; preferences: NoticePreferences; notices: DurableNotice[] }> {
    const cursor = await this.cursor()
    return { cursor, preferences: await this.preferences(),
      notices: (await this.notices()).filter(row => row.sequence > cursor.sequence).slice(0, 100) }
  }
  private async selected(id: unknown): Promise<DurableNotice> {
    if (typeof id !== 'string' || !hex.test(id)) throw Error('NOTICE_ID_INVALID')
    const row = (await this.notices()).find(row => row.id === id)
    if (!row) throw Error('NOTICE_UNKNOWN')
    return row
  }
  /** Claim at most one system attempt across windows and Hosts, after a successful preference/CAS check.
   * @param id - Durable notice identity.
   * @param prefsRevision - Preference revision observed by Main.
   * @returns One private display-attempt identity, or null for a previously claimed/handled/skipped notice.
   */
  async claim(id: unknown, prefsRevision: unknown): Promise<{ notice: DurableNotice; claimId: NoticeClaimId } | null> {
    return this.track(async () => {
      const row = await this.selected(id), preferences = await this.preferences(), cursor = await this.cursor()
      if (!preferences.enabled || preferences.revision !== prefsRevision || row.sequence <= cursor.sequence) return null
      if ((await this.delivery(row.id)).handled) return null
      const claimId = brandString<NoticeClaimId>(randomUUID())
      if (!await publishRecord(join(this.root, 'delivery', row.id, 'claim.json'),
        JSON.stringify({ schemaVersion: 1, claimId, preferencesRevision: prefsRevision }))) return null
      this.activeClaims.add(claimId)
      return { notice: row, claimId }
    })
  }
  /** Settle only the already-claimed display attempt; unknown delivery is retained without retry.
   * @param id - Notice identity.
   * @param claimId - Actual claimed attempt.
   * @param outcome - System display observation; handling the source is a separate user operation.
   * @returns Delivery state; a conflicting settlement refuses.
   */
  async settle(id: unknown, claimId: unknown, outcome: unknown): Promise<NoticeDelivery> {
    if (typeof claimId !== 'string' || !uuid.test(claimId) || !['sent', 'failed', 'unknown', 'suppressed'].includes(String(outcome)))
      throw Error('NOTICE_DELIVERY_INVALID')
    return this.track(async () => {
      const row = await this.selected(id), dir = join(this.root, 'delivery', row.id), bytes = await readRecord(join(dir, 'claim.json'))
      if (!bytes || record(bytes).claimId !== claimId) throw Error('NOTICE_CLAIM_CONFLICT')
      const result = JSON.stringify({ schemaVersion: 1, claimId, outcome })
      if (!await publishRecord(join(dir, 'result.json'), result)) {
        const prior = await readRecord(join(dir, 'result.json'))
        if (!prior || record(prior).outcome !== outcome) throw Error('NOTICE_DELIVERY_CONFLICT')
      }
      this.activeClaims.delete(claimId)
      return this.delivery(row.id)
    })
  }
  /** Read separate system-display, companion-visible and handled facts.
   * @param id - Existing notice.
   * @returns Unknown for an unsettled attempt from another/reopened owner; it cannot be displayed again.
   */
  async delivery(id: unknown): Promise<NoticeDelivery> {
    const row = await this.selected(id), dir = join(this.root, 'delivery', row.id)
    const claim = await readRecord(join(dir, 'claim.json')), result = await readRecord(join(dir, 'result.json'))
    let system: NoticeDelivery['system'] = 'unclaimed'
    if (claim) {
      const data = record(claim)
      if (typeof data.claimId !== 'string' || !uuid.test(data.claimId)) throw Error('NOTICE_RECORD_REFUSED')
      system = this.activeClaims.has(data.claimId) ? 'claimed' : 'unknown'
      if (result) {
        const outcome = record(result)
        if (outcome.claimId !== data.claimId || !['sent', 'failed', 'unknown', 'suppressed'].includes(String(outcome.outcome)))
          throw Error('NOTICE_RECORD_REFUSED')
        system = outcome.outcome as NoticeDelivery['system']
      }
    } else if (result) { throw Error('NOTICE_RECORD_REFUSED') }
    else if (row.sequence <= (await this.cursor()).sequence) { system = 'suppressed' }
    const handled = await readRecord(join(dir, 'handled.json'))
    if (handled && record(handled).handled !== true) throw Error('NOTICE_RECORD_REFUSED')
    return { system, visibleToCompanion: true, handled: handled !== null }
  }
  /** Mark explicit user handling without changing system delivery or verification acceptance.
   * @param id - Existing notice.
   * @returns Retained independent delivery state.
   */
  async handle(id: unknown): Promise<NoticeDelivery> {
    return this.track(async () => {
      const row = await this.selected(id)
      await publishRecord(join(this.root, 'delivery', row.id, 'handled.json'), JSON.stringify({ schemaVersion: 1, handled: true }))
      return this.delivery(row.id)
    })
  }
  /** Page all retained notices for user/companion lookup regardless of system preferences or cursor.
   * @param after - Sequence cursor, zero for the first page.
   * @returns At most 100 retained notices with independent delivery facts.
   */
  async list(after: unknown = 0): Promise<{ notices: (DurableNotice & { delivery: NoticeDelivery })[]; next: number | null }> {
    if (!integer(after)) throw Error('NOTICE_CURSOR_INVALID')
    const all = (await this.notices()).filter(row => row.sequence > after), page = all.slice(0, 100)
    const notices = await Promise.all(page.map(async row => ({ ...row, delivery: await this.delivery(row.id) })))
    return { notices, next: all.length > 100 ? page.at(-1)?.sequence ?? null : null }
  }
  /** Read the latest notices for an explicit Session/workspace without consuming system delivery.
   * @param sessionId - Official Session identity selected by the authenticated observer.
   * @param workspace - Official cwd; receipt notices without a Session match only this exact directory.
   * @returns At most 16 source identities and independent delivery facts, newest first.
   */
  async forScope(sessionId: SessionId, workspace: string | null): Promise<(DurableNotice & { delivery: NoticeDelivery })[]> {
    const rows = (await this.notices()).filter(row => row.scope.sessionId === sessionId
      || row.scope.sessionId === null && workspace !== null && row.scope.workspace === workspace).slice(-16).reverse()
    return Promise.all(rows.map(async row => ({ ...row, delivery: await this.delivery(row.id) })))
  }
  /** Refuse new writes and drain every admitted operation before releasing the composition. */
  async close(): Promise<void> { this.stopping = true; await Promise.allSettled(this.pending); this.activeClaims.clear() }
}
