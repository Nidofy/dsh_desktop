/** Quota-admitted checkpoints and read-only interrupted recovery for T19. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { checks, codes } from './catalogue.ts'
import type { CheckCode, CheckMetrics, CheckRow, SelfTestReport, SelfTestRunId } from './types.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const LIMIT = 64 * 1024
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('SELFTEST_RECORD_INVALID')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw Error('SELFTEST_RECORD_INVALID')
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('SELFTEST_RECORD_INVALID')
  return value
}
function code(value: unknown): CheckCode {
  if (typeof value !== 'string' || !codes.includes(value as CheckCode)) throw Error('SELFTEST_RECORD_INVALID')
  return value as CheckCode
}
function decode(value: unknown): SelfTestReport {
  const p = record(value)
  if (p.schemaVersion !== 1 && p.schemaVersion !== 2) throw Error('SELFTEST_VERSION_UNSUPPORTED')
  keys(p, ['schemaVersion', 'kind', 'id', 'mode', 'status', 'startedAt', 'endedAt', 'warning', 'budget', 'rows'])
  if (p.kind !== 'electron-self-test' || (p.schemaVersion === 1 ? p.mode !== 'local' : p.mode !== 'provider')
    || typeof p.id !== 'string' || !UUID.test(p.id)
    || !['RUNNING', 'COMPLETED', 'CANCELLED', 'TIMEOUT', 'INTERRUPTED', 'FAILED'].includes(String(p.status))
    || !Array.isArray(p.rows) || p.rows.length !== checks.length) throw Error('SELFTEST_RECORD_INVALID')
  const budget = record(p.budget)
  keys(budget, p.mode === 'local' ? ['modelRequests', 'timeoutMs', 'retries'] : ['modelRequests', 'timeoutMs', 'retries', 'maxOutputTokens'])
  if (budget.timeoutMs !== 180000 || budget.retries !== 0 || (p.mode === 'local' ? budget.modelRequests !== 0
    : !Number.isSafeInteger(budget.modelRequests) || Number(budget.modelRequests) < 1 || Number(budget.modelRequests) > 5
      || budget.maxOutputTokens !== 64)) throw Error('SELFTEST_RECORD_INVALID')
  const rows = p.rows.map((value: unknown, index): CheckRow => {
    const row = record(value), metrics = record(row.metrics)
    const expected = checks[index]
    keys(row, ['id', 'phase', 'status', 'code', 'durationMs', 'metrics'])
    keys(metrics, ['bytes', 'files', 'requests', 'quotaRefusals', 'exitCode', 'cancelled', 'timedOut', 'inputTokens', 'outputTokens', 'cacheReadTokens'])
    if (!expected || row.id !== expected[0] || !['PENDING', 'RUNNING', 'SETTLED'].includes(String(row.phase))
      || !['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED'].includes(String(row.status))) throw Error('SELFTEST_RECORD_INVALID')
    const measured: CheckMetrics = {}
    for (const key of ['bytes', 'files', 'requests', 'quotaRefusals', 'exitCode', 'cancelled', 'timedOut', 'inputTokens', 'outputTokens', 'cacheReadTokens'] as const) {
      if (metrics[key] !== undefined) {
        const value = numeric(metrics[key])
        if (!Number.isSafeInteger(value) || (key === 'cancelled' || key === 'timedOut') && value > 1) {
          throw Error('SELFTEST_RECORD_INVALID')
        }
        measured[key] = value
      }
    }
    if (measured.requests !== undefined && measured.requests > Number(budget.modelRequests)) throw Error('SELFTEST_RECORD_INVALID')
    if (row.status === 'PASS' && (row.phase !== 'SETTLED' || row.code !== 'OK')) throw Error('SELFTEST_RECORD_INVALID')
    return { id: expected[0], phase: row.phase as CheckRow['phase'], status: row.status as CheckRow['status'],
      code: code(row.code), durationMs: row.durationMs === null ? null : numeric(row.durationMs), metrics: measured }
  })
  if (rows.reduce((total, row) => total + (row.metrics.requests ?? 0), 0) > Number(budget.modelRequests)) throw Error('SELFTEST_RECORD_INVALID')
  const report: SelfTestReport = { schemaVersion: p.schemaVersion, kind: 'electron-self-test', id: brandString<SelfTestRunId>(p.id),
    mode: p.mode === 'local' ? 'local' : 'provider',
    status: p.status as SelfTestReport['status'], startedAt: numeric(p.startedAt),
    endedAt: p.endedAt === null ? null : numeric(p.endedAt),
    warning: p.warning === null ? null : code(p.warning),
    budget: { modelRequests: Number(budget.modelRequests), timeoutMs: 180000, retries: 0,
      ...p.mode === 'provider' ? { maxOutputTokens: 64 } : {} }, rows }
  if (rows.slice(-2).some(row => row.status !== 'UNKNOWN' || row.code !== 'FIELD_UNVERIFIED')
    || report.status === 'RUNNING' && report.endedAt !== null) throw Error('SELFTEST_RECORD_INVALID')
  return report
}

/** Reject linked ancestors before reading or publishing an owner-selected path.
 * @param path - Complete owner-selected destination.
 */
export async function unlinked(path: string): Promise<void> {
  let cursor = resolve(path)
  for (;;) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('SELFTEST_PATH_REFUSED') }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error }
    const parent = dirname(cursor)
    if (parent === cursor) return
    cursor = parent
  }
}

/** Strict checkpoint owner; damaged/future records are retained and block writes instead of disappearing from history. */
export class SelfTestStore {
  readonly directory: string
  constructor(home: string, private readonly storage: Pick<StorageService, 'write'>) {
    this.directory = join(home, 'nidofy-extras', 'selftests', 'reports')
  }
  private path(id: string): string {
    if (!UUID.test(id)) throw Error('SELFTEST_ID_INVALID')
    return join(this.directory, id + '.json')
  }
  /** Validate one exact caller identity without starting work.
   * @param id - Caller-retained UUID.
   * @returns Branded identity accepted by this owner.
   */
  identity(id: string): SelfTestRunId { this.path(id); return brandString<SelfTestRunId>(id) }
  private async raw(id: string): Promise<SelfTestReport | null> {
    const path = this.path(id)
    await unlinked(path)
    let info
    try { info = await lstat(path, { bigint: true }) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(LIMIT)) throw Error('SELFTEST_RECORD_INVALID')
    const file = await open(path, 'r')
    try {
      const before = await file.stat({ bigint: true }), bytes = Buffer.alloc(LIMIT + 1)
      let count = 0
      while (count < bytes.length) {
        const part = await file.read(bytes, count, bytes.length - count, null)
        if (!part.bytesRead) break
        count += part.bytesRead
      }
      const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true })
      if (count > LIMIT || BigInt(count) !== before.size || before.dev !== info.dev || before.ino !== info.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink() || current.nlink !== 1n) {
        throw Error('SELFTEST_RECORD_CHANGED')
      }
      const report = decode(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))))
      if (report.id !== id) throw Error('SELFTEST_RECORD_INVALID')
      return report
    } finally { await file.close() }
  }
  /** Read without writes or replay; an unsettled checkpoint has unknown side effects.
   * @param id - Exact retained run identity.
   * @returns Cold recovery projection, or null (which does not authorize another start).
   */
  async read(id: string): Promise<SelfTestReport | null> {
    const report = await this.raw(id)
    if (report?.status === 'RUNNING') {
      report.status = 'INTERRUPTED'; report.warning = 'PROCESS_INTERRUPTED'
      for (const row of report.rows) {
        if (row.phase === 'RUNNING') { row.status = 'UNKNOWN'; row.code = 'PROCESS_INTERRUPTED' }
        if (row.phase === 'PENDING') { row.status = 'SKIPPED'; row.code = 'PROCESS_INTERRUPTED' }
      }
    }
    return report
  }
  private async history(): Promise<SelfTestReport[]> {
    await unlinked(this.directory)
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
    if (names.length > 80) throw Error('SELFTEST_HISTORY_LIMIT')
    const reports: SelfTestReport[] = []
    let retainedBytes = 0
    for (const name of names) {
      const info = await lstat(join(this.directory, name))
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('SELFTEST_HISTORY_INVALID')
      retainedBytes += info.size
      // Twenty full reports plus replacement/publication space and lock metadata, including crash residue.
      if (retainedBytes > 22 * LIMIT + 4096) throw Error('SELFTEST_HISTORY_LIMIT')
      if (UUID.test(name.slice(0, -5)) && name.endsWith('.json')) {
        const report = await this.raw(name.slice(0, -5))
        if (report) reports.push(report)
      } else if (!name.endsWith('.tmp') && !name.endsWith('.lock')) throw Error('SELFTEST_HISTORY_INVALID')
    }
    return reports.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
  }
  /** Bounded history metadata; unsupported records remain visible as an explicit refusal.
   * @returns At most twenty retained identities.
   */
  async list(): Promise<Pick<SelfTestReport, 'id' | 'startedAt' | 'status'>[]> {
    const reports = await this.history()
    if (reports.length > 20) throw Error('SELFTEST_HISTORY_LIMIT')
    return reports.map(({ id, startedAt, status }) => ({ id, startedAt, status: status === 'RUNNING' ? 'INTERRUPTED' : status }))
  }
  /** Publish a complete checkpoint after validation and quota admission.
   * @param report - Full report whose result fields are already sanitized.
   * @param initial - Exclusive initial intent; an existing identity never replays.
   */
  async save(report: SelfTestReport, initial = false): Promise<void> {
    const value = decode(report), bytes = JSON.stringify(value), path = this.path(value.id)
    if (Buffer.byteLength(bytes) > LIMIT) throw Error('SELFTEST_REPORT_LIMIT')
    await unlinked(path)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await withFileLock(join(this.directory, 'history'), async () => {
      const prior = await this.raw(value.id), history = await this.history()
      if (initial && prior) throw Error('SELFTEST_RUN_EXISTS')
      if (!initial && (!prior || prior.status !== 'RUNNING')) throw Error('SELFTEST_RUN_CONFLICT')
      // Cold interrupted reports remain evidence. Only known terminal reports are eligible for retention.
      const excess = Math.max(0, history.length + (prior ? 0 : 1) - 20)
      const obsolete = history.filter(row => row.id !== value.id && row.status !== 'RUNNING').reverse().slice(0, excess)
      if (obsolete.length < excess) throw Error('SELFTEST_HISTORY_LIMIT')
      await this.storage.write(path, Math.max(1, Buffer.byteLength(bytes) * 2),
        () => writeFileAtomic(path, bytes, { mode: 0o600, dirMode: 0o700 }))
      for (const row of obsolete) { await unlinked(this.path(row.id)); await unlink(this.path(row.id)) }
    })
  }
  /** Rebuild an export through a field whitelist; internal identities are omitted.
   * @param report - Validated live or cold report.
   * @returns Secret-free bounded JSON report.
   */
  export(report: SelfTestReport): Omit<SelfTestReport, 'id'> {
    const value = decode(report)
    return { schemaVersion: value.schemaVersion, kind: value.kind, mode: value.mode, status: value.status, startedAt: value.startedAt,
      endedAt: value.endedAt, warning: value.warning, budget: { ...value.budget }, rows: value.rows.map(row => ({
        id: row.id, phase: row.phase, status: row.status, code: row.code, durationMs: row.durationMs, metrics: { ...row.metrics },
      })) }
  }
}
