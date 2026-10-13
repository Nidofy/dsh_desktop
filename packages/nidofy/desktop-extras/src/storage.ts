/** Distribution quota client; the native ledger serializes all participating Hosts. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { object } from './state.ts'

/** Caller-retained identity used to query an operation whose ACK was lost. */
export type StorageOperationId = Branded<'nidofy.StorageOperationId'>
/** Random owner registration bound by the helper to the actual process creation identity. */
export type HostEpoch = Branded<'nidofy.StorageHostEpoch'>
/** Physical distribution-directory identity returned by Windows, not a format version. */
export type ManagedRootId = Branded<'nidofy.ManagedRootId'>
/** Durable grant identity; possession of this identifier alone confers no authority. */
export type QuotaLeaseId = Branded<'nidofy.QuotaLeaseId'>
/** Sync-confirmed native grant. This receipt is not a commit receipt for the writer's own data. */
export interface QuotaMetadata {
  readonly id: QuotaLeaseId
  readonly operationId: StorageOperationId
  readonly rootId: ManagedRootId
  readonly reservedBytes: number
  readonly terminalBytes: number
}
/** Unknown never authorizes replay or releases capacity. */
export type QuotaInspection = { status: 'unknown' } | (QuotaMetadata & { status: 'reserved' | 'settled'; phase: string })
/** Ledger capacity observation; cached lengths are not a current admission scan. */
export interface QuotaStatus {
  /** Physical distribution identity. */
  rootId: ManagedRootId
  /** Null for status-only observation; recovery reports whether writers were drained. */
  drained: boolean | null
  /** Current reconciled length only after successful drained recovery. */
  measuredBytes: number | null
  /** Last ledger measurement, possibly stale. */
  observedBytes: number
  /** Ordinary and independent terminal grants still charged. */
  reservedBytes: number
  /** Ordinary grants still charged. */
  ordinaryBytes: number
  /** Terminal grants still charged; lowering capacity does not revoke them. */
  terminalBytes: number
  /** Current managed capacity; not the disk size. */
  limitBytes: number
  /** Disk space withheld from managed reservations. */
  safetyBytes: number
  /** Number of unsettled operations, without capabilities or tokens. */
  pendingOperations: number
  /** Status never scans; recovery may remain incomplete or fail explicitly. */
  scan: 'not-run' | 'complete' | 'incomplete'
  /** Current journal length. */
  ledgerBytes: number
  /** Journal ceiling; reaching it requires explicit future capacity maintenance. */
  ledgerLimitBytes: number
}
/** One writer must finish all its work before requesting settlement. */
export interface QuotaLease extends QuotaMetadata {
  run<T>(work: () => Promise<T>): Promise<T>
  terminal<T>(work: () => Promise<T>): Promise<T>
  release(): Promise<QuotaInspection>
}
/** One fresh import, authorized by the original physical root; unknown work cannot be resumed. */
export interface ImportLease extends QuotaLease {
  write<T>(path: string, bytes: number, work: () => Promise<T>): Promise<T>
  publish(): Promise<Record<string, unknown>>
  abort(): Promise<Record<string, unknown>>
}
/** Product quota settings; the existing ledger retains its capacity until explicitly configured. */
export interface Config {
  /** Application-owned Windows helper, never supplied by an API request. */
  executable: string
  /** Initial distribution managed limit; existing ledger settings survive process restart. */
  limitBytes: number
  /** Available volume space kept outside managed reservations. */
  safetyBytes: number
}
export const name = 'nidofy-storage'
export const Config: z<Config> = z.object({
  executable: z.string().required(),
  limitBytes: z.number().step(1).min(1024 * 1024).max(Number.MAX_SAFE_INTEGER).default(512 * 1024 * 1024),
  safetyBytes: z.number().step(1).min(1024 * 1024).max(Number.MAX_SAFE_INTEGER).default(64 * 1024 * 1024),
})
declare module '@deepseek-ai/cordis' { interface Context { nidofyStorage: StorageService } }
type Capability = { token: string; ordinaryLeft: number; terminalLeft: number }
type WriteContext = { lease: QuotaLease; terminal: boolean }
function inspection(value: Record<string, unknown>): QuotaInspection {
  if (value.status === 'unknown') return { status: 'unknown' }
  if ((value.status !== 'reserved' && value.status !== 'settled') || typeof value.phase !== 'string'
    || typeof value.id !== 'string' || typeof value.operationId !== 'string' || typeof value.rootId !== 'string'
    || typeof value.reservedBytes !== 'number' || !Number.isSafeInteger(value.reservedBytes) || value.reservedBytes < 0
    || typeof value.terminalBytes !== 'number' || !Number.isSafeInteger(value.terminalBytes) || value.terminalBytes < 0)
    throw Error('STORAGE_ACK_UNKNOWN')
  return { status: value.status, phase: value.phase, id: brandString<QuotaLeaseId>(value.id),
    operationId: brandString<StorageOperationId>(value.operationId), rootId: brandString<ManagedRootId>(value.rootId),
    reservedBytes: value.reservedBytes, terminalBytes: value.terminalBytes }
}
function capacity(value: Record<string, unknown>): QuotaStatus {
  const bytes = (name: string): number => {
    const n = value[name]
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw Error('STORAGE_ACK_UNKNOWN')
    return n
  }
  if (typeof value.rootId !== 'string' || !['not-run', 'complete', 'incomplete'].includes(String(value.scan))
    || value.drained !== null && typeof value.drained !== 'boolean'
    || value.measuredBytes !== null && (typeof value.measuredBytes !== 'number'
      || !Number.isSafeInteger(value.measuredBytes) || value.measuredBytes < 0)) throw Error('STORAGE_ACK_UNKNOWN')
  return { rootId: brandString<ManagedRootId>(value.rootId), drained: value.drained,
    measuredBytes: value.measuredBytes, scan: value.scan as QuotaStatus['scan'], observedBytes: bytes('observedBytes'),
    reservedBytes: bytes('reservedBytes'), ordinaryBytes: bytes('ordinaryBytes'), terminalBytes: bytes('terminalBytes'),
    limitBytes: bytes('limitBytes'), safetyBytes: bytes('safetyBytes'), pendingOperations: bytes('pendingOperations'),
    ledgerBytes: bytes('ledgerBytes'), ledgerLimitBytes: bytes('ledgerLimitBytes') }
}

/** The helper ACK follows file sync; EOF/timeout is unknown and never releases a reservation.
 * @param executable - Application-owned helper.
 * @param home - Canonicalizable distribution home.
 * @param command - Trusted caller's bounded command.
 * @returns Parsed helper response after child close.
 */
export function callStorageHelper(executable: string, home: string, command: object): Promise<Record<string, unknown>> {
  if (!isAbsolute(executable)) return Promise.reject(Error('STORAGE_HELPER_REQUIRED'))
  return new Promise((accept, reject) => {
    const child = execFile(executable, [home], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
      env: { SystemRoot: process.env.SystemRoot, windir: process.env.windir, TEMP: process.env.TEMP, TMP: process.env.TMP },
    }, (error, stdout) => {
      if (error) { reject(Error('STORAGE_ACK_UNKNOWN')); return }
      try {
        const response = object(JSON.parse(stdout))
        if (response.ok !== true) throw Error(typeof response.error === 'string' && /^[A-Z_]+$/.test(response.error)
          ? response.error : 'STORAGE_ACK_UNKNOWN')
        accept(object(response.value))
      } catch (error) { reject(error instanceof Error ? error : Error('STORAGE_ACK_UNKNOWN', { cause: error })) }
    })
    // execFile's close callback owns settlement, including EPIPE and kill/timeout cases.
    child.stdin?.on('error', () => { /* The close callback reports an unknown acknowledgement. */ })
    child.stdin?.end(JSON.stringify(command))
  })
}

/** Host owner of the quota client and write contexts; no in-memory map grants global capacity. */
export class StorageService extends Service {
  /** Registration identity for this owner instance; process creation time proves its lifetime. */
  readonly epoch: HostEpoch = brandString<HostEpoch>(randomUUID())
  private ready: Promise<void> | undefined
  private stopping = false
  private readonly writes = new AsyncLocalStorage<WriteContext>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly taskLeases = new Map<string, QuotaLease>()
  private readonly capabilities = new WeakMap<QuotaLease, Capability>()
  constructor(ctx: Context, readonly home: string, readonly config: Config) { super(ctx, 'nidofyStorage') }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* The caller receives the error. */ })
    return work
  }
  private request(request: object): Promise<Record<string, unknown>> {
    return this.track(callStorageHelper(this.config.executable, this.home, { action: 'quota', request: { ownerEpoch: this.epoch, ...request } }))
  }
  private open(): Promise<void> {
    return this.ready ??= this.request({ action: 'open', pid: process.pid,
      limitBytes: this.config.limitBytes, safetyBytes: this.config.safetyBytes }).then(() => {}).catch((error: unknown) => {
      // Owner registration is idempotent; retrying it never replays a writer or a reservation.
      this.ready = undefined; throw error
    })
  }
  /** Query after a lost acknowledgement; unknown is never authorization to replay.
   * @param operationId - Retained operation identity.
   * @returns Persisted reserved/settled observation or explicit unknown.
   */
  async inspect(operationId: StorageOperationId): Promise<QuotaInspection> {
    await this.open(); return inspection(await this.request({ action: 'inspect', operationId }))
  }
  /** Observe cached measurement and outstanding charges without reclaiming or rescanning.
   * Journal opening retains its sync/partial-tail repair rules and may register this Host.
   * @returns Ledger state without private authority; a current scan requires explicit recover.
   */
  async status(): Promise<QuotaStatus> { await this.open(); return capacity(await this.request({ action: 'status' })) }
  /** Change admission capacity without revoking any existing ordinary or terminal grant.
   * @param limitBytes - New managed limit.
   * @returns Sync-confirmed setting.
   */
  async configure(limitBytes: number): Promise<Record<string, unknown>> {
    await this.open(); return this.request({ action: 'configure', limitBytes })
  }
  /** Recover only when all recorded processes/writers are confirmed drained.
   * @returns The new measured total, or a retained charge/refusal when identity or scan is unknown.
   */
  async recover(): Promise<QuotaStatus> { await this.open(); return capacity(await this.request({ action: 'recover' })) }
  /** Reserve a write peak and a separate terminal allowance before starting side effects.
   * @param scope - Trusted writer/command kind.
   * @param maxWriteBytes - Upper bound including temporary copies.
   * @param terminalBytes - Independent allowance for terminal records.
   * @param operationId - Caller-retained identity, generated before sending the request.
   * @returns A process-owned capability whose release rescans only after writers drain.
   */
  async reserve(scope: string, maxWriteBytes: number, terminalBytes: number,
    operationId: StorageOperationId = brandString<StorageOperationId>(randomUUID())): Promise<QuotaLease> {
    return this.acquire(scope, maxWriteBytes, terminalBytes, operationId)
  }
  private async acquire(scope: string, maxWriteBytes: number, terminalBytes: number, operationId: StorageOperationId,
    action = 'reserve', fingerprint = ''): Promise<QuotaLease> {
    if (this.stopping) throw Error('STORAGE_STOPPING')
    await this.open()
    const token = randomUUID() + randomUUID()
    const request = { action, operationId, scope, maxWriteBytes, terminalBytes, token, fingerprint }
    // Retain operationId in the thrown error for the caller's inspect path; never retry an unknown operation automatically.
    let grant: QuotaInspection
    try { grant = inspection(await this.request(request)) }
    catch (cause) { throw Object.assign(Error('STORAGE_RESERVE_FAILED', { cause }), { operationId }) }
    if (grant.status !== 'reserved' || grant.operationId !== operationId) throw Object.assign(Error('STORAGE_ACK_UNKNOWN'), { operationId })
    let released = false, release: Promise<QuotaInspection> | undefined
    const jobs = new Set<Promise<unknown>>()
    const enter = <T>(work: () => Promise<T>, terminal: boolean): Promise<T> => {
      if (released || this.stopping && !terminal) return Promise.reject(Error('STORAGE_STOPPING'))
      const pending = this.writes.run({ lease, terminal }, async () => work())
      jobs.add(pending); void this.track(pending)
      void pending.finally(() => jobs.delete(pending)).catch(() => { /* Caller owns the work failure. */ })
      return pending
    }
    const lease: QuotaLease = { ...grant, operationId,
      run: work => enter(work, false), terminal: work => enter(work, true),
      release: () => release ??= (async () => {
        released = true
        await Promise.allSettled(jobs)
        return inspection(await this.request({ action: 'settle', operationId, token }))
      })(),
    }
    this.capabilities.set(lease, { token, ordinaryLeft: maxWriteBytes, terminalLeft: terminalBytes })
    return lease
  }
  /** Resolve imports through the native physical root, including an explicitly adopted home.
   * @returns Original distribution imports path; no import destination is created.
   */
  async importRoot(): Promise<string> {
    await this.open()
    const result = await this.request({ action: 'import-root' })
    if (typeof result.path !== 'string' || !isAbsolute(result.path)) throw Error('STORAGE_ACK_UNKNOWN')
    return result.path
  }
  /** Inspect or explicitly reconcile/adopt a persisted import; never replays its content writer.
   * @param action - Inspect reads ledger state; review verifies the committed directory and receipt. Recover/adopt are mutations.
   * @param operationId - Caller-retained import and quota identity.
   * @returns Persisted phase and original physical-root paths, without a capability.
   */
  async importOperation(action: 'inspect' | 'review' | 'recover' | 'adopt', operationId: StorageOperationId): Promise<Record<string, unknown>> {
    await this.open(); return this.request({ action: 'import-' + action, operationId })
  }
  /** Admit one fresh isolated import with a cumulative physical-write ceiling.
   * @param operationId - Durable import/quota identity; an existing identity refuses replay.
   * @param fingerprint - Validated source preview fingerprint.
   * @param maxWriteBytes - Explicit ceiling covering copies, successors and metadata temporaries.
   * @returns Private writer/publication authority bound by native to the exact staging identity.
   */
  async beginImport(operationId: StorageOperationId, fingerprint: string, maxWriteBytes: number): Promise<ImportLease> {
    const lease = await this.acquire('node:import', maxWriteBytes, 0, operationId, 'import-start', fingerprint)
    const command = (action: string, extra: object = {}): Promise<Record<string, unknown>> =>
      this.request({ action, operationId, token: this.capability(lease).token, ...extra })
    return { ...lease,
      write: (path, bytes, work) => lease.run(async () => {
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('STORAGE_RESERVATION_INVALID')
        await command('import-write', { path, maxWriteBytes: bytes })
        return work()
      }),
      publish: () => command('import-publish'), abort: () => command('import-abort'),
    }
  }
  private capability(lease: QuotaLease): Capability {
    const capability = this.capabilities.get(lease)
    if (!capability) throw Error('STORAGE_LEASE_UNKNOWN')
    return capability
  }
  /** Run a bounded Node write inside an existing lease or acquire a new one.
   * @param path - Owned path inside the home, never a project or runtime target.
   * @param bytes - Complete additional write peak.
   * @param work - Actual writer completion promise.
   * @returns Writer result; a settlement failure retains charges and does not undo its commit.
   */
  async write<T>(path: string, bytes: number, work: () => Promise<T>): Promise<T> {
    await this.validatePath(path)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('STORAGE_RESERVATION_INVALID')
    const active = this.writes.getStore()
    if (active) {
      const key = active.terminal ? 'terminalLeft' : 'ordinaryLeft'
      const capability = this.capability(active.lease)
      if (capability[key] < bytes) throw Error('STORAGE_LEASE_EXHAUSTED')
      capability[key] -= bytes
      return work()
    }
    const lease = await this.reserve('node:write', Math.max(1, bytes), 0)
    try { return await lease.run(work) }
    finally { await lease.release().catch((error: unknown) => { this.diagnostic(error) }) }
  }
  /** Refuse unmeasured destinations and existing linked ancestors before admission.
   * @param path - Managed home destination, including a not-yet-created file.
   */
  async validatePath(path: string): Promise<void> {
    const rel = relative(resolve(this.home), resolve(path))
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw Error('STORAGE_PATH_REFUSED')
    const managedDirectories = ['nidofy-extras', 'nidofy-connections', 'desktop-actions', 'desktop-changes', 'desktop-artifact-exports']
    const managedFiles = ['nidofy-import-connections.json', 'desktop-artifacts.json']
    if (!managedDirectories.some(name => rel === name || rel.startsWith(name + sep)) && !managedFiles.includes(rel))
      throw Error('STORAGE_PATH_REFUSED')
    let cursor = resolve(path)
    while (true) {
      const probe = cursor === parse(cursor).root && cursor.startsWith('\\\\?\\') ? cursor.slice(4) : cursor
      try { if ((await lstat(probe)).isSymbolicLink()) throw Error('STORAGE_LINK_REFUSED') }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error }
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  }
  private diagnostic(error: unknown): void {
    try { this.ctx.logger.warn('Storage settlement remains reserved: ' + String(error)) }
    catch (sinkError) { /* Completed writes retain their result even when diagnostics fail. */ void sinkError }
  }
  /** Execute native commands using capabilities absent from UI/model JSON.
   * @param command - Trusted protection dispatcher command.
   * @returns Helper result after its actual process exits; unknown work retains the reservation.
   */
  async native(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = command.action, binding = command.binding === undefined ? {} : object(command.binding)
    const key = typeof binding.requestId === 'string' ? binding.requestId : ''
    let lease: QuotaLease | undefined, terminal = false
    if (action === 'begin') {
      lease = await this.reserve('native:task', 34 * 1024 * 1024, 1024 * 1024)
      this.taskLeases.set(key, lease)
    } else if (action === 'end') {
      lease = this.taskLeases.get(key); terminal = true
      if (!lease) throw Error('STORAGE_LEASE_UNKNOWN')
    } else if (action === 'ui') {
      const request = object(command.request)
      const scopes: Record<string, [string, number]> = { arm: ['scope', 512 * 1024], disarm: ['scope', 512 * 1024],
        capture: ['capture', 34 * 1024 * 1024], restore: ['restore', 34 * 1024 * 1024], seal: ['seal', 512 * 1024],
        importArchive: ['import', 256 * 1024 * 1024], export: ['export', 256 * 1024 * 1024] }
      const selected = typeof request.action === 'string' ? scopes[request.action] : undefined
      if (selected) lease = await this.reserve('native:' + selected[0], selected[1], 1024 * 1024)
    }
    let result: Record<string, unknown>
    try {
      result = await this.track(callStorageHelper(this.config.executable, this.home, lease
        ? { action: 'authorized', command, lease: { operationId: lease.operationId, token: this.capability(lease).token } } : command))
    } catch (error) {
      if (error instanceof Error && lease) Object.assign(error, { operationId: lease.operationId })
      // The native import checks this revision before writing any archive payload; its child has closed.
      if (lease && error instanceof Error && error.message === 'PROTECTION_ARCHIVE_PREVIEW_CONFLICT') {
        await lease.release().catch((failure: unknown) => { this.diagnostic(failure) })
      }
      throw error
    }
    if (lease && (action !== 'begin' || result.status === 'DISABLED')) {
      if (terminal) this.taskLeases.delete(key)
      await lease.release().catch((error: unknown) => { this.diagnostic(error) })
    }
    return result
  }
  /** Stop admission and await all acquired child/writer completions; unknown leases remain persisted. */
  async close(): Promise<void> {
    this.stopping = true
    while (this.pending.size) await Promise.allSettled(this.pending)
  }
}
/** Mount the product owner; the native ledger remains authoritative across module/Host instances.
 * @param ctx - Desktop product composition.
 * @param config - Validated helper and initial capacity settings.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.executable)) throw Error('STORAGE_HELPER_REQUIRED')
  const owner = new StorageService(ctx, resolveDshHome(), config)
  ctx.effect(() => () => owner.close())
}
