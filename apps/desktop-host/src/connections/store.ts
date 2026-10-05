/** Single-owner connection publication with per-revision health, explicit credential ownership, and a recovery journal. */
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, unlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { Config, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Immutable managed connection revision identifier. */
export type RevisionId = Branded<'NidofyConnectionRevision'>
/** Connection editor publication operation identifier. */
export type OperationId = Branded<'NidofyConnectionOperation'>
/** One revision's availability; health is diagnostic and never blocks loading the directory. */
export type RevisionAvailability =
  | { kind: 'available' }
  | { kind: 'missing-credential' }
  | { kind: 'backend-unavailable'; diagnosticCode: string }
  | { kind: 'revoked' }
/** Published health of one retained revision; carries no secret material. */
export interface RevisionHealth { revisionId: RevisionId; availability: RevisionAvailability }
/** Secret ownership for one save; `keep` copies the CAS-hit current revision's value into the new revision's own reference. */
export type CredentialEdit = { mode: 'keep' } | { mode: 'replace'; value: string }
/** Connection facts persisted independently of the secret value. */
export interface Revision {
  id: RevisionId
  connection: string
  createdAt: number
  profile: PiAiProviderProfile
  credential: string
  policyRevision: number
  transportLease: 'host-network-v1'
}
/** Committed route selection and retained revisions; keys never enter this document. */
export interface ConnectionState {
  schemaVersion: 1
  revision: number
  current: Record<string, RevisionId>
  revisions: Revision[]
  revoked: string[]
  operations: OperationId[]
}
/** Secret references whose unset failed; retried idempotently without blocking configuration routes. */
interface CleanupLedger { schemaVersion: 1; refs: string[] }
/** Where the durable record of pending cleanup references currently lives. */
export type CleanupRecord = 'none' | 'ledger' | 'journal'
/** Official credential service operations required by the transaction owner. */
export interface SecretStore {
  get(ref: string): Promise<string | undefined>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}
const empty = (): ConnectionState => ({ schemaVersion: 1, revision: 0, current: {}, revisions: [], revoked: [], operations: [] })
const idPattern = /^[a-z][a-z0-9-]{0,63}$/
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** A secret-free stability code for a credential-backend or owner-directory failure.
 * @param error - Backend or decode failure whose message must not leak into observations.
 * @returns An uppercase diagnostic code, never the raw message.
 */
function diagnosticOf(error: unknown): string {
  if (error instanceof SyntaxError) return 'INVALID_CONNECTION_JSON'
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) return code
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'CONNECTION_STATE_UNREADABLE'
}

/** Adapt the save wire form to exactly one credential edit: legacy `key` means replace; mixing or omitting a mode is rejected.
 * @param request - Parsed mutate request carrying `key`, `credential`, or neither.
 * @returns The explicit keep or replace edit for this save.
 */
function credentialEditOf(request: Record<string, unknown>): CredentialEdit {
  const legacy = 'key' in request, managed = 'credential' in request
  if (legacy && managed) throw new Error('INVALID_CONNECTION_REQUEST')
  if (managed) {
    const edit = object(request.credential)
    if (edit.mode === 'keep') return { mode: 'keep' }
    if (edit.mode !== 'replace') throw new Error('INVALID_CREDENTIAL')
  }
  const value = managed ? object(request.credential).value : request.key
  if (typeof value !== 'string' || value.length === 0 || value.length > 16384 || /[\r\n\0]/.test(value)) throw new Error('INVALID_CREDENTIAL')
  return { mode: 'replace', value }
}

/** Refuse non-object wire data before accessing fields.
 * @param value - Parsed wire or durable JSON value.
 * @returns Object fields or a validation error.
 */
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_OBJECT')
  return value as Record<string, unknown>
}
/** Validate connection facts using the same schema and catalog as the upstream adapter.
 * @param value - User-supplied connection profile, excluding secrets and transport changes.
 * @returns Normalized profile that can be persisted and reopened.
 */
export function profileFrom(value: unknown): PiAiProviderProfile {
  const raw = object(value)
  const allowed = new Set(['catalogProvider', 'displayName', 'api', 'baseURL', 'models', 'modelOverrides', 'compat',
    'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'reasoning', 'thinkingBudgets', 'cacheRetention',
    'timeoutMs', 'streamIdleTimeoutMs', 'retryPolicy'])
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new Error('UNSUPPORTED_CONNECTION_FIELD')
  if (raw.api !== undefined && raw.api !== 'openai-completions' && raw.api !== 'anthropic-messages') throw new Error('UNSUPPORTED_PROTOCOL')
  if (raw.baseURL !== undefined) {
    if (typeof raw.baseURL !== 'string') throw new Error('INVALID_ENDPOINT')
    const url = new URL(raw.baseURL)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('INVALID_ENDPOINT')
  }
  const parsed = structuredClone(Config({ providers: { 'nidofy-validation': raw } })
    .providers.get()['nidofy-validation']) as PiAiProviderProfile | undefined
  if (parsed === undefined) throw new Error('INVALID_PROFILE')
  // An explicit managed ref prevents catalog-native ambient authentication.
  resolveProfiles({ 'nidofy-validation': { ...parsed, apiKeyEnv: 'NIDOFY_VALIDATION' } })
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => allowed.has(key) && value !== undefined))
}

/** Owns durable publication; adapter leases use the exact Revision objects returned here.
 * Loading is total: a missing key, an unavailable backend, or a corrupt owner file never
 * blocks the directory from opening, so the repair entry stays reachable. `state` is the
 * published, servable view — routing, keys, health, and appliedRevision exchange in one
 * synchronous step — while the durable desired configuration may run one revision ahead
 * while a publication resolves. Unavailable revisions report per-revision health and
 * reject their routes with stable codes instead of switching accounts, models, or ambient
 * credentials. */
export class ConnectionStore {
  readonly hostEpoch = brandString<Branded<'NidofyHostEpoch'>>(randomUUID())
  /** Published, servable view exchanged as one unit with keys, health, and appliedRevision. */
  state: ConnectionState = empty()
  appliedRevision = 0
  /** Monotonic only within this host epoch; health publication never writes configuration state. */
  healthRevision = 0
  /** Published per-revision health; exchanged whole, never row by row. */
  health: readonly RevisionHealth[] = []
  /** Stability code of an unreadable owner file; the original bytes stay on disk and block writes, not loading. */
  invalidState: string | undefined

  constructor(readonly directory: string, private readonly secrets: SecretStore,
    private readonly publish: (state: ConnectionState) => void,
    readonly retentionMs = 60_000,
    private readonly fault: (point: string) => Promise<void> = () => Promise.resolve()) {}

  private desired: ConnectionState = empty()
  private tail: Promise<void> = Promise.resolve()
  private readonly counts = new Map<string, number>()
  private keys = new Map<string, string>()
  private pendingCleanup: string[] = []
  private journalObligation = false
  /** Revisions inside an in-flight retirement transaction; new leases on them are refused
   * so a live lease can never outlive the revision, profile, and reference it pinned. */
  private retiring: Set<RevisionId> | undefined
  private stopped = false

  /** Owner-directory recovery mode exposed on every observation. */
  private get recovery(): 'ready' | 'cleanup-pending' | 'invalid-state' {
    if (this.invalidState !== undefined) return 'invalid-state'
    if (this.pendingCleanup.length > 0) return 'cleanup-pending'
    return 'ready'
  }

  /** Where pending cleanup references are durably recorded; `journal` blocks new writes. */
  private get cleanupRecord(): CleanupRecord {
    if (this.journalObligation) return 'journal'
    if (this.pendingCleanup.length > 0) return 'ledger'
    return 'none'
  }

  /** Recover a killed writer before making any managed provider visible. */
  async open(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.exclusive(() => this.recover())
  }

  private async read(name: string): Promise<unknown> {
    const path = join(this.directory, name)
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('INVALID_CONNECTION_FILE')
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }

  private decode(raw: unknown): ConnectionState {
    const value = object(raw)
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
      || !Array.isArray(value.revisions) || !Array.isArray(value.revoked) || !Array.isArray(value.operations)) throw new Error('CONNECTION_SCHEMA_UNSUPPORTED')
    const current = object(value.current)
    const revisions = value.revisions.map((item) => {
      const row = object(item)
      if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.connection !== 'string' || !idPattern.test(row.connection)
        || typeof row.credential !== 'string' || row.credential !== `NIDOFY_REV_${row.id.replaceAll('-', '_')}`
        || typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.policyRevision)
        || row.transportLease !== 'host-network-v1') throw new Error('INVALID_CONNECTION_REVISION')
      return { id: brandString<RevisionId>(row.id), connection: row.connection, credential: row.credential,
        createdAt: row.createdAt, policyRevision: Number(row.policyRevision),
        transportLease: 'host-network-v1' as const, profile: profileFrom(row.profile) }
    })
    if (new Set(revisions.map(row => row.id)).size !== revisions.length
      || Object.entries(current).some(([id, ref]) => !idPattern.test(id) || !revisions.some(row => row.id === ref && row.connection === id))
      || value.revoked.some(ref => typeof ref !== 'string' || !uuid.test(ref))
      || value.operations.some(ref => typeof ref !== 'string' || !uuid.test(ref))) throw new Error('INVALID_CONNECTION_STATE')
    return { schemaVersion: 1, revision: Number(value.revision), current: current as Record<string, RevisionId>, revisions,
      revoked: value.revoked as string[], operations: value.operations as OperationId[] }
  }

  private async readCleanup(): Promise<string[]> {
    const raw = await this.read('cleanup.json')
    if (raw === undefined) return []
    const value = object(raw)
    if (value.schemaVersion !== 1 || !Array.isArray(value.refs)
      || value.refs.some(ref => typeof ref !== 'string' || !ref.startsWith('NIDOFY_REV_'))) throw new Error('INVALID_CONNECTION_CLEANUP')
    return value.refs as string[]
  }

  private async writeCleanup(refs: string[]): Promise<void> {
    const path = join(this.directory, 'cleanup.json')
    if (refs.length === 0) {
      try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      return
    }
    await writeFileAtomic(path, JSON.stringify({ schemaVersion: 1, refs } satisfies CleanupLedger), { mode: 0o600 })
  }

  /** Retry pending unsets idempotently; a reference the committed state still owns is dropped, a failing unset stays recorded. */
  private async drainCleanup(): Promise<void> {
    if (this.pendingCleanup.length === 0) return
    const referenced = new Set(this.desired.revisions.map(row => row.credential))
    const remaining: string[] = []
    for (const ref of this.pendingCleanup) {
      if (referenced.has(ref)) continue
      try { await this.secrets.unset(ref) } catch (_unset) { remaining.push(ref) }
    }
    this.pendingCleanup = remaining
    try { await this.writeCleanup(remaining) } catch (_record) {
      // The on-disk ledger may still list cleaned references; unset is idempotent, so the next drain retries safely.
    }
  }

  private async recover(): Promise<void> {
    this.invalidState = undefined
    this.journalObligation = false
    let committed: ConnectionState, journal: ConnectionState | undefined, cleanup: string[]
    try {
      committed = this.decode(await this.read('state.json') ?? empty())
      const journalRaw = await this.read('journal.json')
      journal = journalRaw === undefined ? undefined : this.decode(journalRaw)
      cleanup = await this.readCleanup()
    } catch (error) {
      // Corrupt or unreadable owner files keep their original bytes; the empty published
      // view keeps the repair entry reachable while all writes are refused.
      this.desired = empty()
      this.pendingCleanup = []
      this.invalidState = diagnosticOf(error)
      await this.apply(empty())
      return
    }
    this.desired = committed
    this.pendingCleanup = cleanup
    if (journal !== undefined) {
      const failed: string[] = []
      for (const row of journal.revisions) {
        if (committed.revisions.some(saved => saved.id === row.id)) continue
        if (committed.revisions.some(saved => saved.credential === row.credential)) continue
        try { await this.secrets.unset(row.credential) } catch (_unset) { failed.push(row.credential) }
      }
      if (failed.length > 0) {
        const merged = [...new Set([...this.pendingCleanup, ...failed])]
        this.pendingCleanup = merged
        try { await this.writeCleanup(merged) } catch (_record) {
          // The journal remains the only durable record of these references: it must not be
          // overwritten by a new transaction, so writes are refused until the obligation
          // moves into the cleanup ledger or the unsets succeed on a later recovery.
          this.journalObligation = true
          await this.apply(committed)
          return
        }
      }
      await unlink(join(this.directory, 'journal.json'))
    }
    await this.drainCleanup()
    await this.apply(committed)
  }

  /** Resolve every retained revision of the target, then exchange routing, keys, health,
   * and appliedRevision in one synchronous step.
   *
   * Every publicly observable field is committed before `publish` runs, so synchronous
   * notification listeners (the LLM runtime's `llm/adapters-updated`) read one coherent
   * version. A `publish` failure leaves that observation committed while the route
   * registration may be stale; the next `apply` re-registers through `publish`, and a
   * retried operation reaches it through the idempotency window or `recover`. */
  private async apply(target: ConnectionState): Promise<void> {
    const resolved = new Map<string, string>()
    const health: RevisionHealth[] = []
    for (const row of target.revisions) {
      if (target.revoked.includes(row.id)) {
        health.push({ revisionId: row.id, availability: { kind: 'revoked' } })
        continue
      }
      let key: string | undefined
      try { key = await this.secrets.get(row.credential) } catch (error) {
        health.push({ revisionId: row.id, availability: { kind: 'backend-unavailable', diagnosticCode: diagnosticOf(error) } })
        continue
      }
      if (key === undefined || key.length === 0) { health.push({ revisionId: row.id, availability: { kind: 'missing-credential' } }); continue }
      resolved.set(row.id, key)
      health.push({ revisionId: row.id, availability: { kind: 'available' } })
    }
    // No observer can see a half-applied view: readers keep the previous complete routing,
    // key, and health maps until this synchronous block exchanges all of them, and every
    // field a listener can read through status() is settled before publish fires.
    this.state = target
    this.keys = resolved
    this.health = health
    this.healthRevision++
    this.appliedRevision = target.revision
    this.publish(target)
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(() => withFileLock(join(this.directory, 'owner'), work))
    this.tail = pending.then(() => {}, () => {})
    return pending
  }

  /** Re-resolve the value a keep edit copies; keep requires this connection's current revision to read back from the backend.
   * @param connection - CAS-hit connection whose current revision owns the secret to copy.
   * @returns The backend-resolved value copied into the new revision's own reference.
   */
  private async keptValue(connection: string): Promise<string> {
    const current = this.desired.current[connection]
    if (current === undefined) throw new Error('CONNECTION_KEEP_WITHOUT_CURRENT')
    const row = this.desired.revisions.find(item => item.id === current)
    let value: string | undefined
    try { value = row === undefined ? undefined : await this.secrets.get(row.credential) } catch (_resolve) {
      throw new Error('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
    }
    if (value === undefined || value.length === 0) throw new Error('CONNECTION_KEEP_CREDENTIAL_UNAVAILABLE')
    return value
  }

  /** Commit or revoke one connection. Retrying an operation ID observes its prior commit.
   * @param input - Validated at this wire entry, including operation ID and expected revision.
   * @returns Applied state and the committed operation observation; an error may require reconciliation.
   */
  mutate(input: unknown): Promise<ReturnType<ConnectionStore['status']>> {
    const request = object(input)
    if (typeof request.operationId !== 'string' || !uuid.test(request.operationId)
      || typeof request.connection !== 'string' || !idPattern.test(request.connection)
      || !Number.isSafeInteger(request.expectedRevision)) return Promise.reject(new Error('INVALID_CONNECTION_REQUEST'))
    const operationId = brandString<OperationId>(request.operationId), connection = request.connection
    return this.exclusive(async () => {
      if (this.stopped) throw new Error('CONNECTION_OWNER_STOPPED')
      await this.recover()
      if (this.invalidState !== undefined) throw new Error('CONNECTION_INVALID_STATE')
      if (this.cleanupRecord === 'journal') throw new Error('CONNECTION_RECOVERY_PENDING')
      if (this.desired.operations.includes(operationId)) return this.status(operationId)
      if (request.expectedRevision !== this.desired.revision) throw new Error('CONNECTION_CONFLICT')
      const next = structuredClone(this.desired)
      next.revision++
      next.operations = [...next.operations.slice(-255), operationId]
      let row: Revision | undefined
      let value = ''
      if (request.action === 'revoke') {
        if (!next.current[connection]) throw new Error('CONNECTION_NOT_FOUND')
        for (const item of next.revisions) if (item.connection === connection && !next.revoked.includes(item.id)) next.revoked.push(item.id)
        const { [connection]: _removed, ...current } = next.current
        next.current = current
      } else if (request.action === 'save') {
        const edit = credentialEditOf(request)
        value = edit.mode === 'replace' ? edit.value : await this.keptValue(connection)
        const id = brandString<RevisionId>(randomUUID())
        row = { id, connection, createdAt: Date.now(), profile: profileFrom(request.profile),
          credential: `NIDOFY_REV_${id.replaceAll('-', '_')}`, policyRevision: next.revision, transportLease: 'host-network-v1' }
        next.revisions.push(row); next.current[connection] = id
      } else throw new Error('INVALID_CONNECTION_ACTION')
      if (Object.keys(next.current).length > 64 || next.revisions.length > 512
        || Buffer.byteLength(JSON.stringify(next)) > 4 * 1024 * 1024) throw new Error('CONNECTION_CAPACITY')
      await writeFileAtomic(join(this.directory, 'journal.json'), JSON.stringify(next), { mode: 0o600 })
      await this.fault('prepared')
      if (row) await this.secrets.set(row.credential, value)
      await this.fault('credential-staged')
      await writeFileAtomic(join(this.directory, 'state.json'), JSON.stringify(next), { mode: 0o600 })
      await this.fault('committed')
      this.desired = next
      await this.apply(next)
      await unlink(join(this.directory, 'journal.json'))
      await this.fault('applied')
      return this.status(operationId)
    })
  }

  /** Return desired/applied observations and a digest containing no credential values.
   * @param operationId - Optional operation to inspect within the retained idempotency window.
   * @returns Current process observations; use inspect after an uncertain operation result.
   */
  status(operationId?: string) {
    return { hostEpoch: this.hostEpoch, desiredRevision: this.desired.revision, appliedRevision: this.appliedRevision,
      healthRevision: this.healthRevision, revisions: this.health, recovery: this.recovery, cleanupRecord: this.cleanupRecord,
      ...(this.invalidState === undefined ? {} : { recoveryDiagnostic: this.invalidState }),
      operationId, committed: operationId === undefined ? undefined : this.desired.operations.some(id => id === operationId),
      routeDigest: digest({ current: this.desired.current,
        revisions: this.desired.revisions.map(({ credential: _credential, ...row }) => row), revoked: this.desired.revoked }),
      connections: Object.entries(this.state.current).map(([connection, id]) => {
        const row = this.state.revisions.find(item => item.id === id)
        return { connection, revision: id, profile: row?.profile, configured: this.keys.has(id),
          availability: this.health.find(item => item.revisionId === id)?.availability.kind ?? 'unknown' }
      }), retainedRevisions: this.state.revisions.length, activeLeases: [...this.counts.values()].reduce((a, b) => a + b, 0) }
  }

  /** Reconcile disk after a lost ACK or interrupted publish, then report actual application.
   * @param operationId - Optional operation whose durable commit is queried.
   * @returns Reconciled desired/applied state for this Host epoch; an invalid owner directory reports itself instead of throwing.
   */
  inspect(operationId?: string): Promise<ReturnType<ConnectionStore['status']>> {
    return this.exclusive(async () => { await this.recover(); return this.status(operationId) })
  }

  /** Hold one immutable credential and transport policy until release; revocation remains live.
   * @param id - Retained revision selected for this request or retry.
   * @returns Owned lease; callers release it after completion and check before sending.
   */
  acquire(id: RevisionId): { revision: Revision; key: string; check(): void; release(): void } {
    const revision = this.state.revisions.find(row => row.id === id), key = this.keys.get(id)
    if (this.stopped) throw new Error('CONNECTION_OWNER_STOPPED')
    // A revision inside a retirement transaction is refused for its whole commit window,
    // not just at selection time: acquire is synchronous, so this check cannot miss a
    // lease granted between the retirement plan and the published exchange.
    if (this.retiring?.has(id)) throw new Error('CONNECTION_RETIRING')
    if (!revision) throw new Error('CONNECTION_RETIRED')
    if (this.state.revoked.includes(id)) throw new Error('CONNECTION_REVOKED')
    if (!key) {
      // Unavailable routes fail with their health code instead of switching credentials.
      const availability = this.health.find(row => row.revisionId === id)?.availability
      if (availability?.kind === 'backend-unavailable') throw new Error('CONNECTION_BACKEND_UNAVAILABLE')
      throw new Error('CONNECTION_MISSING_CREDENTIAL')
    }
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1)
    let released = false
    return { revision, key, check: () => {
      if (released || this.stopped || this.state.revoked.includes(id)) throw new Error('CONNECTION_LEASE_REVOKED')
    }, release: () => {
      if (released) return
      released = true
      const count = (this.counts.get(id) ?? 1) - 1
      if (count === 0) this.counts.delete(id); else this.counts.set(id, count)
    } }
  }

  /** Retire unreferenced revisions only after the rollback window and all retry/stream leases.
   * New leases on a retiring revision are refused for the whole commit window; already-held
   * leases keep their revision, profile, and reference out of the retirement plan.
   * @param now - Current retirement clock, injectable for deterministic qualification.
   */
  collect(now = Date.now()): Promise<void> {
    return this.exclusive(async () => {
      await this.recover()
      if (this.invalidState !== undefined || this.cleanupRecord === 'journal') return
      const active = new Set(Object.values(this.desired.current))
      const retired = this.desired.revisions.filter(row => !active.has(row.id)
        && !this.counts.has(row.id) && now - row.createdAt >= this.retentionMs)
      this.retiring = retired.length > 0 ? new Set(retired.map(row => row.id)) : undefined
      try {
        if (retired.length > 0) {
          const next = { ...this.desired, revisions: this.desired.revisions.filter(row => !retired.includes(row)),
            revoked: this.desired.revoked.filter(id => !retired.some(row => row.id === id)) }
          // Journal retains retired refs so an interrupted deletion is repeated at startup.
          await writeFileAtomic(join(this.directory, 'journal.json'), JSON.stringify(this.desired), { mode: 0o600 })
          await writeFileAtomic(join(this.directory, 'state.json'), JSON.stringify(next), { mode: 0o600 })
          this.desired = next
          await this.apply(next)
        }
      } finally {
        this.retiring = undefined
      }
      const failed: string[] = []
      for (const row of retired) {
        try { await this.secrets.unset(row.credential) } catch (_unset) { failed.push(row.credential) }
      }
      for (const ref of this.pendingCleanup) {
        if (this.desired.revisions.some(row => row.credential === ref)) continue
        try { await this.secrets.unset(ref) } catch (_unset) { failed.push(ref) }
      }
      this.pendingCleanup = [...new Set(failed)]
      let recorded = true
      try { await this.writeCleanup(this.pendingCleanup) } catch (_record) {
        // The previous ledger still lists the remaining references for the next drain.
        recorded = false
      }
      if (retired.length > 0 && !recorded && failed.some(ref => retired.some(row => row.credential === ref))) {
        // The journal naming the retired references is the only durable record of those
        // failed unsets: report the obligation immediately and refuse new writes until it
        // reaches the cleanup ledger or a later recovery unsets succeed.
        this.journalObligation = true
        return
      }
      if (retired.length > 0 && recorded) await unlink(join(this.directory, 'journal.json'))
    })
  }

  /** Drain writes before dropping process-local credentials. */
  async close(): Promise<void> { this.stopped = true; await this.tail; this.keys = new Map<string, string>() }
}
