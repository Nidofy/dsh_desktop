/** Independent schema-v1 receipt selections retain historical observations without changing T11 or old diagnostics. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { object } from '../connections/store.ts'
import { unlinked } from '../selftest/store.ts'
import { publishRecord, readRecord } from '../workbench/verification-storage.ts'
import type { VerificationView, VerificationRunId } from '../workbench/verification.ts'
import type { ComparisonSelection, ExperimentId, ExperimentCaseId } from './comparison.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const LIMIT = 64 * 1024
/** Immutable archive identity retained by the caller before admission; a missing record does not authorize a retry. */
export type ComparisonRecordId = Branded<'nidofy.ComparisonRecordId'>
/** Time-specific receipt projection; these fields never provide execution or model-send authority. */
export interface ReceiptCheckpoint {
  phase: VerificationView['phase']
  acceptanceRevision: number
  logAvailable: boolean
  receipt: null | {
    runId: VerificationRunId
    completedAt: number
    sourceFingerprint: string | null
    inputFingerprint: string | null
    configRevision: number
    coverage: 'complete' | 'unknown'
    tests: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'UNKNOWN'
    acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED'
    freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'
    logDigest: string | null
    logComplete: boolean
  }
}
/** Private local archive of explicit selections, not a provider report or proof that a factor changed. */
export interface TaskComparisonRecord {
  schemaVersion: 1
  kind: 'receipt-task-comparison'
  source: 'local-verification-owner'
  id: ComparisonRecordId
  recordedAt: number
  selection: ComparisonSelection
  checkpoints: { a: ReceiptCheckpoint; b: ReceiptCheckpoint }
}
function keys(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).length !== names.length || Object.keys(value).some(key => !names.includes(key))) throw Error('EXPERIMENT_RECORD_INVALID')
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('EXPERIMENT_RECORD_INVALID')
  return value
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw Error('EXPERIMENT_ID_INVALID')
  return value
}
function fingerprint(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw Error('EXPERIMENT_RECORD_INVALID')
  return value
}
function oneOf<T extends string>(value: unknown, names: readonly T[]): T {
  if (typeof value !== 'string' || !names.includes(value as T)) throw Error('EXPERIMENT_RECORD_INVALID')
  return value as T
}
/** Parse only explicit grouping/run references; measured fields supplied by the caller are refused.
 * @param input - Authenticated selection or a schema-validated archive field.
 * @returns Bounded identities and absolute workspace references; canonicalization belongs to the live owner.
 */
export function parseComparisonSelection(input: unknown): ComparisonSelection {
  const row = object(input)
  keys(row, ['experimentId', 'caseId', 'factor', 'a', 'b'])
  const select = (value: unknown) => {
    const ref = object(value); keys(ref, ['workspace', 'runId'])
    if (typeof ref.workspace !== 'string' || !isAbsolute(ref.workspace) || ref.workspace.length > 4096
      || ref.workspace.includes('\0') || !ref.workspace.isWellFormed()) throw Error('EXPERIMENT_WORKSPACE_INVALID')
    return { workspace: ref.workspace, runId: brandString<VerificationRunId>(identity(ref.runId)) }
  }
  return { experimentId: brandString<ExperimentId>(identity(row.experimentId)),
    caseId: brandString<ExperimentCaseId>(identity(row.caseId)), factor: oneOf(row.factor, ['notebook', 'cache']),
    a: select(row.a), b: select(row.b) }
}
/** Capture the current independent T11 observation without changing acceptance or execution facts.
 * @param view - Actual VerificationOwner result.
 * @returns Small historical checkpoint; missing receipts stay null.
 */
export function receiptCheckpoint(view: VerificationView): ReceiptCheckpoint {
  const receipt = view.receipt
  return { phase: view.phase, acceptanceRevision: view.acceptanceRevision, logAvailable: view.logAvailable,
    receipt: receipt ? { runId: receipt.runId, completedAt: receipt.completedAt,
      sourceFingerprint: receipt.sourceFingerprint, inputFingerprint: receipt.inputFingerprint,
      configRevision: receipt.configRevision, coverage: receipt.coverage, tests: receipt.tests,
      acceptance: receipt.acceptance, freshness: receipt.freshness,
      logDigest: receipt.log.digest, logComplete: receipt.log.complete } : null }
}
function checkpoint(input: unknown, runId: VerificationRunId): ReceiptCheckpoint {
  const row = object(input); keys(row, ['phase', 'acceptanceRevision', 'logAvailable', 'receipt'])
  if (typeof row.logAvailable !== 'boolean') throw Error('EXPERIMENT_RECORD_INVALID')
  let receipt: ReceiptCheckpoint['receipt'] = null
  if (row.receipt !== null) {
    const r = object(row.receipt)
    keys(r, ['runId', 'completedAt', 'sourceFingerprint', 'inputFingerprint', 'configRevision', 'coverage',
      'tests', 'acceptance', 'freshness', 'logDigest', 'logComplete'])
    if (r.runId !== runId || typeof r.logComplete !== 'boolean') throw Error('EXPERIMENT_RECORD_INVALID')
    receipt = { runId, completedAt: integer(r.completedAt), sourceFingerprint: fingerprint(r.sourceFingerprint),
      inputFingerprint: fingerprint(r.inputFingerprint), configRevision: integer(r.configRevision),
      coverage: oneOf(r.coverage, ['complete', 'unknown']), tests: oneOf(r.tests, ['NOT_RUN', 'PASSED', 'FAILED', 'UNKNOWN']),
      acceptance: oneOf(r.acceptance, ['PENDING', 'ACCEPTED', 'REJECTED']), freshness: oneOf(r.freshness, ['CURRENT', 'STALE', 'UNKNOWN']),
      logDigest: fingerprint(r.logDigest), logComplete: r.logComplete }
  }
  const phase = oneOf(row.phase, ['LEGACY', 'PENDING', 'INTERRUPTED', 'COMMITTED'])
  if ((phase === 'COMMITTED') !== (receipt !== null)) throw Error('EXPERIMENT_RECORD_INVALID')
  return { phase, acceptanceRevision: integer(row.acceptanceRevision), logAvailable: row.logAvailable, receipt }
}
/** Validate a complete bounded record without trusting its claimed source or executing its selected task.
 * @param bytes - Exact UTF-8 JSON text; old diagnostic reports and unknown fields/versions refuse.
 * @returns Validated historical selection; imports must independently recheck the current local T11 owner.
 */
export function parseComparisonRecord(bytes: string): TaskComparisonRecord {
  if (!bytes.isWellFormed() || Buffer.byteLength(bytes) > LIMIT) throw Error('EXPERIMENT_RECORD_LIMIT')
  const row = object(JSON.parse(bytes))
  if (row.schemaVersion !== 1) throw Error('EXPERIMENT_VERSION_UNSUPPORTED')
  keys(row, ['schemaVersion', 'kind', 'source', 'id', 'recordedAt', 'selection', 'checkpoints'])
  if (row.kind !== 'receipt-task-comparison' || row.source !== 'local-verification-owner') throw Error('EXPERIMENT_SOURCE_REFUSED')
  const selection = parseComparisonSelection(row.selection), points = object(row.checkpoints)
  keys(points, ['a', 'b'])
  return { schemaVersion: 1, kind: 'receipt-task-comparison', source: 'local-verification-owner',
    id: brandString<ComparisonRecordId>(identity(row.id)), recordedAt: integer(row.recordedAt), selection,
    checkpoints: { a: checkpoint(points.a, selection.a.runId), b: checkpoint(points.b, selection.b.runId) } }
}

/** Quota-managed immutable records retain twenty selections; no record or unknown residue is silently deleted. */
export class TaskComparisonStore {
  /** Owner-selected directory inside the existing native quota namespace; callers cannot choose a publication path. */
  readonly directory: string
  constructor(home: string, private readonly storage: Pick<StorageService, 'write'>) {
    this.directory = join(home, 'nidofy-extras', 'experiments', 'records-v1')
  }
  private path(id: string): string { return join(this.directory, identity(id) + '.json') }
  /** Read exact bounded bytes without allocations, repairs or a command replay.
   * @param id - Caller-retained archive identity.
   * @returns Validated historical record, or null when no publication is observable.
   */
  async read(id: string): Promise<TaskComparisonRecord | null> {
    const path = this.path(id); await unlinked(path)
    let info
    try { info = await lstat(path) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
    if (!info.isFile() || info.nlink !== 1 || info.size > LIMIT) throw Error('EXPERIMENT_RECORD_INVALID')
    const bytes = await readRecord(path)
    if (!bytes) throw Error('EXPERIMENT_RECORD_CHANGED')
    const after = await lstat(path)
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || bytes.length > LIMIT) throw Error('EXPERIMENT_RECORD_CHANGED')
    const record = parseComparisonRecord(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (record.id !== id) throw Error('EXPERIMENT_RECORD_INVALID')
    return record
  }
  /** Scan complete bounded history; unreadable/future records refuse instead of disappearing from the list.
   * @returns At most twenty records; temporary/lock residues count toward the entry and byte ceilings.
   */
  async list(): Promise<TaskComparisonRecord[]> {
    return (await this.scan()).records.sort((a, b) => b.recordedAt - a.recordedAt || b.id.localeCompare(a.id))
  }
  private async scan(): Promise<{ records: TaskComparisonRecord[]; bytes: number; entries: number }> {
    await unlinked(this.directory)
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { records: [], bytes: 0, entries: 0 }; throw error }
    if (names.length > 80) throw Error('EXPERIMENT_HISTORY_LIMIT')
    const records: TaskComparisonRecord[] = []
    let bytes = 0
    for (const name of names) {
      const info = await lstat(join(this.directory, name))
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('EXPERIMENT_HISTORY_INVALID')
      bytes += info.size
      if (bytes > 22 * LIMIT + 4096) throw Error('EXPERIMENT_HISTORY_LIMIT')
      if (name.endsWith('.json') && UUID.test(name.slice(0, -5))) {
        const record = await this.read(name.slice(0, -5))
        if (!record) throw Error('EXPERIMENT_RECORD_CHANGED')
        records.push(record)
      } else if (name !== 'history.lock' && !/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/u.test(name)) {
        throw Error('EXPERIMENT_HISTORY_INVALID')
      }
    }
    if (records.length > 20) throw Error('EXPERIMENT_HISTORY_LIMIT')
    return { records, bytes, entries: names.length }
  }
  /** Admit lock/publication bytes through the existing native quota and exclusively publish one record.
   * @param record - Full locally observed or independently checked imported selection.
   * @param signal - Checked before publication; late cancellation never denies an observed committed record.
   */
  async save(record: TaskComparisonRecord, signal: AbortSignal): Promise<void> {
    const bytes = JSON.stringify(parseComparisonRecord(JSON.stringify(record))), path = this.path(record.id)
    signal.throwIfAborted(); await unlinked(path)
    await this.storage.write(this.directory, 2 * Buffer.byteLength(bytes) + 4096, async () => {
      signal.throwIfAborted(); await unlinked(this.directory); await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await withFileLock(join(this.directory, 'history'), async () => {
        signal.throwIfAborted()
        const { records: rows, bytes: retained, entries } = await this.scan()
        if (rows.some(row => row.id === record.id)) throw Error('EXPERIMENT_RECORD_EXISTS')
        if (rows.length >= 20) throw Error('EXPERIMENT_HISTORY_LIMIT')
        if (entries + 2 > 80 || retained + 2 * Buffer.byteLength(bytes) > 22 * LIMIT + 4096) throw Error('EXPERIMENT_HISTORY_LIMIT')
        signal.throwIfAborted()
        if (!await publishRecord(path, bytes)) throw Error('EXPERIMENT_RECORD_EXISTS')
      })
    })
  }
}
