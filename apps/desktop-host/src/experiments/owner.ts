/** Authenticated T20 comparisons retain existing receipts; only a separate explicit task confirmation can send a request. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { realpath } from 'node:fs/promises'
import type { VerificationOwner } from '../workbench/verification.ts'
import { compareReceipts, type TaskComparison } from './comparison.ts'
import type { TaskModelLineageOwner } from './model-lineage.ts'
import type { TaskRequestOwner } from './task-requests.ts'
import type { EngineeringTaskOwner } from './engineering-tasks.ts'
import type { EngineeringMatrixOwner } from './engineering-matrix.ts'
import { parseComparisonRecord, parseComparisonSelection, receiptCheckpoint, TaskComparisonStore,
  type ComparisonRecordId, type TaskComparisonRecord } from './records.ts'

/** Comparison and task-request dispatcher drains each independent owner before T11 closes; no model tool is registered. */
export class TaskComparisonOwner {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private stopping = false
  private readonly store: TaskComparisonStore | undefined
  constructor(private readonly verification: Pick<VerificationOwner, 'inspect'>, home: string,
    storage?: Pick<StorageService, 'write'>, private readonly modelLineage?: TaskModelLineageOwner,
    private readonly taskRequests?: TaskRequestOwner, private readonly engineering?: EngineeringTaskOwner,
    private readonly matrix?: EngineeringMatrixOwner) {
    if (storage) this.store = new TaskComparisonStore(home, storage)
  }
  private async compare(input: unknown, signal: AbortSignal): Promise<TaskComparison> {
    signal.throwIfAborted()
    const selection = parseComparisonSelection(input)
    selection.a.workspace = await realpath(selection.a.workspace); selection.b.workspace = await realpath(selection.b.workspace)
    const a = await this.verification.inspect(selection.a.workspace, selection.a.runId)
    signal.throwIfAborted()
    const b = await this.verification.inspect(selection.b.workspace, selection.b.runId)
    signal.throwIfAborted()
    const comparison = compareReceipts(selection, a, b)
    if (Buffer.byteLength(JSON.stringify(comparison)) > 64 * 1024) throw Error('EXPERIMENT_COMPARISON_LIMIT')
    return comparison
  }
  private storage(): TaskComparisonStore {
    if (!this.store) throw Error('STORAGE_OWNER_UNAVAILABLE')
    return this.store
  }
  /** Dispatch explicit receipt reads/archives or independent confirmed task requests; caller-supplied metrics refuse.
   * @param method - Comparison owner operation.
   * @param data - Authenticated JSON; workspace is the existing workbench display selection.
   * @param signal - Caller lifetime, combined with Host unload cancellation.
   * @returns Actual receipt or independent request facts; missing publication never authorizes a replay.
   */
  request(method: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.stopping) return Promise.reject(Error('EXPERIMENT_STOPPING'))
    const lifetime = AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []])
    const work = this.dispatch(method, data, lifetime)
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* The authenticated initiating caller receives failures. */ })
    return work
  }
  private async dispatch(method: string, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (method.startsWith('matrix-')) {
      if (!this.matrix) throw Error('EXPERIMENT_MATRIX_OWNER_UNAVAILABLE')
      return this.matrix.request(method, data, signal)
    }
    if (method.startsWith('engineering-')) {
      if (!this.engineering) throw Error('EXPERIMENT_ENGINEERING_OWNER_UNAVAILABLE')
      return this.engineering.request(method, data, signal)
    }
    if (method.startsWith('task-')) {
      if (!this.taskRequests) throw Error('EXPERIMENT_TASK_OWNER_UNAVAILABLE')
      return this.taskRequests.request(method, data, signal)
    }
    const allowed: Record<string, readonly string[]> = { compare: ['selection'], record: ['id', 'selection'],
      list: [], read: ['id'], import: ['report'], 'model-step': ['selection', 'side'] }
    const fields = allowed[method]
    if (!fields || Object.keys(data).some(key => key !== 'workspace' && !fields.includes(key))
      || fields.some(key => !Object.hasOwn(data, key))) throw Error('EXPERIMENT_INPUT_INVALID')
    signal.throwIfAborted()
    if (method === 'model-step') {
      if (data.side !== 'a' && data.side !== 'b') throw Error('EXPERIMENT_INPUT_INVALID')
      if (!this.modelLineage) throw Error('EXPERIMENT_MODEL_OWNER_UNAVAILABLE')
      const selection = parseComparisonSelection(data.selection), selected = selection[data.side]
      selected.workspace = await realpath(selected.workspace)
      const lineage = await this.modelLineage.read(selected, signal)
      signal.throwIfAborted()
      return lineage
    }
    if (method === 'compare') return this.compare(data.selection, signal)
    if (method === 'record') {
      if (typeof data.id !== 'string') throw Error('EXPERIMENT_ID_INVALID')
      const comparison = await this.compare(data.selection, signal)
      const record: TaskComparisonRecord = { schemaVersion: 1, kind: 'receipt-task-comparison', source: 'local-verification-owner',
        id: brandString<ComparisonRecordId>(data.id), recordedAt: Date.now(), selection: comparison.selection,
        checkpoints: { a: receiptCheckpoint(comparison.a), b: receiptCheckpoint(comparison.b) } }
      await this.storage().save(record, signal)
      return record
    }
    if (method === 'import') {
      if (typeof data.report !== 'string') throw Error('EXPERIMENT_INPUT_INVALID')
      const record = parseComparisonRecord(data.report), live = await this.compare(record.selection, signal)
      // Imported labels/source strings cannot attest a local receipt or an old acceptance decision.
      if (JSON.stringify(live.selection) !== JSON.stringify(record.selection)
        || live.a.phase !== 'COMMITTED' || live.b.phase !== 'COMMITTED'
        || JSON.stringify(record.checkpoints) !== JSON.stringify({ a: receiptCheckpoint(live.a), b: receiptCheckpoint(live.b) })) {
        throw Error('EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
      }
      await this.storage().save(record, signal)
      return record
    }
    if (method === 'list') {
      const rows = await this.storage().list(); signal.throwIfAborted()
      return rows.map(({ id, recordedAt, selection }) => ({ id, recordedAt, selection }))
    }
    if (typeof data.id !== 'string') throw Error('EXPERIMENT_ID_INVALID')
    const record = await this.storage().read(data.id)
    signal.throwIfAborted()
    if (!record) return null
    const comparison = await this.compare(record.selection, signal)
    return { record, comparison, changedSinceRecord: JSON.stringify(record.checkpoints)
      !== JSON.stringify({ a: receiptCheckpoint(comparison.a), b: receiptCheckpoint(comparison.b) }) }
  }
  /** Reject new operations, cancel reads before publication and await every current quota writer/inspection. */
  async close(): Promise<void> {
    this.stopping = true; this.lifetime.abort()
    await this.matrix?.close(); await this.engineering?.close(); await this.taskRequests?.close(); await Promise.allSettled(this.pending)
  }
}
