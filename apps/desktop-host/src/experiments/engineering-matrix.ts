/** Confirmed bounded matrices execute independent engineering turns sequentially and archive each drained result. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { lstat, mkdir } from 'node:fs/promises'
import type { StorageService, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { object } from '../connections/store.ts'
import { unlinked } from '../selftest/store.ts'
import { publishRecord, readRecord } from '../workbench/verification-storage.ts'
import { parseEngineeringPreview, type EngineeringTaskOwner } from './engineering-tasks.ts'
import { engineeringDirectoryNames } from './engineering-resources.ts'

type MatrixId = Branded<'nidofy.EngineeringMatrixId'>
type Row = { id: Branded<'nidofy.EngineeringTaskId'>; ticket: string; preview: Record<string, unknown> }
type Budget = { requests: number; outputTokens: number; durationMs: number }
type Plan = { rows: Row[]; budget: Budget; expiresAt: number }
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const LIMIT = 1024 * 1024
function id(input: unknown): MatrixId {
  if (typeof input !== 'string' || !UUID.test(input)) throw Error('EXPERIMENT_MATRIX_INPUT_INVALID')
  return brandString<MatrixId>(input)
}
function fields(row: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(row).length !== names.length || Object.keys(row).some(key => !names.includes(key))) throw Error('EXPERIMENT_MATRIX_INPUT_INVALID')
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw Error('EXPERIMENT_MATRIX_BUDGET_INVALID')
  return value
}
function parseBudget(value: unknown): Budget {
  const row = object(value); fields(row, ['requests', 'outputTokens', 'durationMs'])
  return { requests: integer(row.requests, 32), outputTokens: integer(row.outputTokens, 262144),
    durationMs: integer(row.durationMs, 60000) }
}
function code(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.message) ? error.message : 'EXPERIMENT_MATRIX_UNCONFIRMED'
}

/** Independent aggregate budgets grant only their displayed rows; unknown or failed work stops all later rows. */
export class EngineeringMatrixOwner {
  private readonly base: string
  private readonly plans = new Map<string, Plan>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private active: { id: MatrixId; controller: AbortController; signal: AbortSignal; done: Promise<void>; row: string | null } | undefined
  private records: Promise<unknown> = Promise.resolve()
  private stopped = false
  constructor(home: string, private readonly tasks: EngineeringTaskOwner, private readonly storage: Pick<StorageService, 'reserve' | 'write'>) {
    this.base = join(home, 'nidofy-extras/experiments/matrices-v1')
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.records.catch(() => {}).then(work); this.records = next; return next
  }
  private async prepare(data: Record<string, unknown>, signal: AbortSignal) {
    for (const [ticket, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(ticket)
    fields(data, ['rows', 'budget'])
    if (!Array.isArray(data.rows) || data.rows.length < 2 || data.rows.length > 4) throw Error('EXPERIMENT_MATRIX_INPUT_INVALID')
    const budget = parseBudget(data.budget), rows: Row[] = []
    let requests = 0, output = 0, expiresAt = Date.now() + 120000
    for (const value of data.rows) {
      signal.throwIfAborted()
      const preview = object(await this.tasks.request('engineering-prepare', object(value), signal))
      const input = object(preview.input), rowBudget = object(input.budget)
      requests += integer(rowBudget.requests, 8)
      output += integer(rowBudget.requests, 8) * integer(rowBudget.outputTokensPerRequest, 8192)
      if (requests > budget.requests || output > budget.outputTokens) throw Error('EXPERIMENT_MATRIX_BUDGET_EXHAUSTED')
      if (rows.length) {
        const first = object(rows[0]?.preview.input)
        if (input.experimentId !== first.experimentId || input.caseId !== first.caseId || input.text !== first.text) {
          throw Error('EXPERIMENT_MATRIX_TASK_MISMATCH')
        }
      }
      const ticket = id(preview.ticket); expiresAt = Math.min(expiresAt, integer(preview.expiresAt, Number.MAX_SAFE_INTEGER))
      const { ticket: _ticket, expiresAt: _expiresAt, ...retained } = preview
      parseEngineeringPreview(retained)
      rows.push({ id: brandString<Branded<'nidofy.EngineeringTaskId'>>(randomUUID()), ticket, preview: retained })
    }
    if (this.plans.size >= 8) throw Error('EXPERIMENT_CONFIRMATION_LIMIT')
    const ticket = randomUUID(), result = { ticket, expiresAt, budget, plannedRequests: requests, allocatedOutputTokens: output,
      rows: rows.map(row => ({ id: row.id, preview: row.preview })), efficiencyEligible: false, quality: 'UNKNOWN' }
    if (Buffer.byteLength(JSON.stringify(result)) > LIMIT) throw Error('EXPERIMENT_MATRIX_RESULT_LIMIT')
    this.plans.set(ticket, { rows, budget, expiresAt }); return result
  }
  private publish(root: string, name: string, value: object): Promise<void> {
    return this.serialize(async () => {
      await unlinked(root)
      if (!(await lstat(root)).isDirectory()) throw Error('EXPERIMENT_MATRIX_PATH_REFUSED')
      const bytes = JSON.stringify(value), names = await engineeringDirectoryNames(root, 16, undefined, 'EXPERIMENT_MATRIX_STORAGE_LIMIT')
      let size = 0
      for (const name of names) { const info = await lstat(join(root, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('EXPERIMENT_MATRIX_PATH_REFUSED'); size += info.size }
      if (names.length >= 16 || Buffer.byteLength(bytes) > LIMIT || size + 2 * Buffer.byteLength(bytes) > 2 * LIMIT) throw Error('EXPERIMENT_MATRIX_STORAGE_LIMIT')
      if (!await publishRecord(join(root, name), bytes)) throw Error('EXPERIMENT_MATRIX_RECORD_EXISTS')
    })
  }
  private async start(data: Record<string, unknown>) {
    fields(data, ['id', 'ticket', 'accepted']); const runId = id(data.id), ticket = id(data.ticket)
    if (data.accepted !== true) throw Error('EXPERIMENT_MATRIX_CONFIRMATION_REQUIRED')
    const plan = this.plans.get(ticket); this.plans.delete(ticket)
    if (!plan || plan.expiresAt < Date.now()) throw Error('EXPERIMENT_CONFIRMATION_EXPIRED')
    if (this.active) throw Error('EXPERIMENT_MATRIX_BUSY')
    const controller = new AbortController()
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(Object.assign(Error('EXPERIMENT_MATRIX_TIMEOUT'), { name: 'TimeoutError' })) },
      plan.budget.durationMs)
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal, deadline.signal])
    let finish!: () => void
    const active = { id: runId, controller, signal, row: null as string | null, done: new Promise<void>((resolve) => { finish = resolve }) }
    this.active = active
    const root = join(this.base, runId)
    let quota: Awaited<ReturnType<StorageService['reserve']>> | undefined
    try {
      quota = await this.storage.reserve('node:engineering-matrix', 2 * LIMIT, LIMIT, brandString<StorageOperationId>(runId))
      const lease = quota
      await lease.run(() => this.storage.write(this.base, 4096, async () => {
        await unlinked(this.base); await mkdir(this.base, { recursive: true, mode: 0o700 })
        await withFileLock(join(this.base, 'admission'), async () => {
          const names = await engineeringDirectoryNames(this.base, 21, signal, 'EXPERIMENT_MATRIX_STORAGE_LIMIT')
          let roots = 0, unsettled = 0, totalBytes = 0
          for (const name of names) {
            if (name === 'admission.lock') {
              const info = await lstat(join(this.base, name))
              if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw Error('EXPERIMENT_MATRIX_PATH_REFUSED')
              totalBytes += info.size; continue
            }
            id(name); roots++
            const value = await this.read(name, signal); if (!value) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
            for (const file of await engineeringDirectoryNames(join(this.base, name), 16, signal, 'EXPERIMENT_MATRIX_STORAGE_LIMIT')) {
              totalBytes += (await lstat(join(this.base, name, file))).size
            }
            if (!value.terminal) unsettled++
          }
          if (roots >= 20 || unsettled >= 10 || totalBytes + 4 * LIMIT > 44 * LIMIT + 4096) throw Error('EXPERIMENT_MATRIX_STORAGE_LIMIT')
          signal.throwIfAborted(); await mkdir(root, { mode: 0o700 })
          await this.publish(root, 'intent.json', { schemaVersion: 1, kind: 'engineering-matrix', id: runId, startedAt: Date.now(),
            budget: plan.budget, rows: plan.rows.map(row => ({ id: row.id, preview: row.preview })) })
        })
      }))
      void (async () => {
        let status = 'UNKNOWN', diagnostic: string | null = null, completed = 0
        try {
          for (const row of plan.rows) {
            signal.throwIfAborted(); active.row = row.id
            await this.tasks.request('engineering-start', { id: row.id, ticket: row.ticket, accepted: true })
            let value: Record<string, unknown>
            for (;;) {
              signal.throwIfAborted()
              value = object(await this.tasks.request('engineering-read', { id: row.id }))
              if (value.status !== 'RUNNING') break
              await new Promise<void>(resolve => setTimeout(resolve, 20))
            }
            const receipts = Array.isArray(value.receipts) ? value.receipts.map(receipt => object(receipt).selection) : []
            await lease.run(() => this.publish(root, `round-${completed + 1}.json`, { schemaVersion: 1, kind: 'engineering-round',
              runId: row.id, status: value.status, counts: value.counts, receipts }))
            completed++; active.row = null
            if (value.status !== 'COMPLETED') throw Error('EXPERIMENT_MATRIX_ROW_UNCONFIRMED')
          }
          status = 'COMPLETED'
        } catch (error) {
          diagnostic = code(error)
          status = signal.aborted ? signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' : 'STOPPED'
        } finally {
          if (active.row) {
            await this.tasks.request('engineering-cancel', { id: active.row }).catch(() => { /* A settled/unknown child is read; it is never resubmitted. */ })
            const result = await this.tasks.request('engineering-read', { id: active.row }).catch(() => null)
            if (result) {
              const value = object(result)
              const receipts = Array.isArray(value.receipts) ? value.receipts.map(receipt => object(receipt).selection) : []
              if (value.terminal) {
                await lease.terminal(() => this.publish(root, `round-${completed + 1}.json`, { schemaVersion: 1, kind: 'engineering-round',
                  runId: active.row, status: value.status, counts: value.counts, receipts }))
                completed++
              }
            }
          }
          await lease.terminal(() => this.publish(root, 'terminal.json', { schemaVersion: 1, kind: 'engineering-matrix-terminal',
            id: runId, endedAt: Date.now(), status, diagnostic, recordedRounds: completed }))
        }
      })().finally(() => {
        void lease.release().catch(() => { /* Unknown native charges remain retained. */ })
          .finally(() => { clearTimeout(timer); this.active = undefined; finish() })
      }).catch(() => { /* Missing terminal publication reads INTERRUPTED without another row dispatch. */ })
      return { id: runId, status: 'RUNNING', canCancel: true }
    } catch (error) {
      await quota?.release().catch(() => { /* Unknown native charges remain retained. */ })
      clearTimeout(timer); this.active = undefined; finish(); throw error
    }
  }
  private async read(runId: string, signal: AbortSignal) {
    const root = join(this.base, id(runId)), files = await this.serialize(async () => {
      const bytes = await readRecord(join(root, 'intent.json')); if (!bytes) return null
      const names = await engineeringDirectoryNames(root, 16, signal, 'EXPERIMENT_MATRIX_STORAGE_LIMIT')
      const files = new Map<string, Buffer>(); let size = 0
      if (names.length > 16) throw Error('EXPERIMENT_MATRIX_STORAGE_LIMIT')
      for (const name of names) {
        const info = await lstat(join(root, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('EXPERIMENT_MATRIX_PATH_REFUSED')
        size += info.size; if (size > 2 * LIMIT) throw Error('EXPERIMENT_MATRIX_STORAGE_LIMIT')
        const bytes = await readRecord(join(root, name)); if (!bytes) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID'); files.set(name, bytes)
      }
      return { files, running: this.active?.id === runId }
    })
    if (!files) return null
    const retained = files.files, running = files.running
    const original = retained.get('intent.json'); if (!original) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
    const intent = object(JSON.parse(original.toString('utf8')))
    fields(intent, ['schemaVersion', 'kind', 'id', 'startedAt', 'budget', 'rows']); const budget = parseBudget(intent.budget)
    integer(intent.startedAt, Number.MAX_SAFE_INTEGER)
    if (intent.schemaVersion !== 1 || intent.kind !== 'engineering-matrix' || intent.id !== runId || !Array.isArray(intent.rows)
      || intent.rows.length < 2 || intent.rows.length > 4) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
    const rounds: Record<string, unknown>[] = []
    let requests = 0, output = 0
    const first = parseEngineeringPreview(object(intent.rows[0]).preview)
    for (const value of intent.rows) {
      const row = object(value); fields(row, ['id', 'preview']); id(row.id)
      const input = parseEngineeringPreview(row.preview)
      if (input.experimentId !== first.experimentId || input.caseId !== first.caseId || input.text !== first.text) {
        throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      }
      requests += input.budget.requests; output += input.budget.requests * input.budget.outputTokensPerRequest
    }
    if (requests > budget.requests || output > budget.outputTokens) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
    if (new Set(intent.rows.map(row => object(row).id)).size !== intent.rows.length) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
    for (const name of [...retained.keys()].sort()) {
      if (name === 'intent.json' || name === 'terminal.json') continue
      if (!/^round-[1-4]\.json$/u.test(name)) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      if (name !== `round-${rounds.length + 1}.json`) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      const bytes = retained.get(name); if (!bytes) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      const round = object(JSON.parse(bytes.toString('utf8')))
      fields(round, ['schemaVersion', 'kind', 'runId', 'status', 'counts', 'receipts'])
      const row = object(intent.rows[rounds.length])
      if (round.schemaVersion !== 1 || round.kind !== 'engineering-round' || round.runId !== row.id) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      const current = object(await this.tasks.request('engineering-read', { id: row.id }, signal))
      if (JSON.stringify(object(current.intent).input) !== JSON.stringify(object(row.preview).input)) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      const resourceBudget = object(row.preview).resourceBudget
      const shellBudget = object(row.preview).shellBudget
      if (shellBudget !== undefined && JSON.stringify(current.shellBudget) !== JSON.stringify(shellBudget)) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      if (resourceBudget !== undefined && (current.resourceAllocation === null
        || JSON.stringify(object(current.resourceAllocation).budget) !== JSON.stringify(resourceBudget))) {
        throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      }
      if (JSON.stringify(current.counts) !== JSON.stringify(round.counts) || current.status !== round.status) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      const receipts = Array.isArray(current.receipts) ? current.receipts.map(receipt => object(receipt).selection) : []
      if (JSON.stringify(receipts) !== JSON.stringify(round.receipts)) throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      rounds.push(round)
    }
    const bytes = retained.get('terminal.json'), terminal = bytes ? object(JSON.parse(bytes.toString('utf8'))) : null
    if (terminal) {
      fields(terminal, ['schemaVersion', 'kind', 'id', 'endedAt', 'status', 'diagnostic', 'recordedRounds'])
      integer(terminal.endedAt, Number.MAX_SAFE_INTEGER)
      if (terminal.schemaVersion !== 1 || terminal.kind !== 'engineering-matrix-terminal' || terminal.id !== runId
        || Number(terminal.endedAt) < Number(intent.startedAt)
        || terminal.diagnostic !== null && (typeof terminal.diagnostic !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/u.test(terminal.diagnostic))
        || terminal.recordedRounds !== rounds.length || !['COMPLETED', 'STOPPED', 'UNKNOWN', 'CANCELLED', 'TIMEOUT'].includes(String(terminal.status))
        || terminal.status === 'COMPLETED' && (terminal.diagnostic !== null || rounds.length !== intent.rows.length
          || rounds.some(row => row.status !== 'COMPLETED'))) {
        throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
      }
    }
    signal.throwIfAborted()
    const result = { intent, terminal, rounds, status: terminal?.status ?? (running ? 'RUNNING' : 'INTERRUPTED'),
      counts: { providerWireRequests: null, ...Object.fromEntries(['dispatches', 'inputTokens', 'outputTokens', 'cacheReadTokens'].map((key) => {
        let total = 0, complete = terminal?.status === 'COMPLETED'
        for (const row of rounds) {
          const value = object(row.counts)[key]
          if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) complete = false
          else { total += value; if (!Number.isSafeInteger(total)) complete = false }
        }
        return [key, complete ? total : null]
      })) }, quality: 'UNKNOWN', efficiencyEligible: false }
    if (Buffer.byteLength(JSON.stringify(result)) > LIMIT) throw Error('EXPERIMENT_MATRIX_RESULT_LIMIT')
    return result
  }
  private async export(runId: string, signal: AbortSignal) {
    const matrix = await this.read(runId, signal)
    if (!matrix?.terminal) throw Error('EXPERIMENT_MATRIX_EXPORT_UNCONFIRMED')
    const active = this.active
    if (active?.id === runId) await active.done
    signal.throwIfAborted()
    const report = { schemaVersion: 1, kind: 'engineering-matrix-report', source: { id: runId, startedAt: matrix.intent.startedAt },
      matrix: { intent: matrix.intent, terminal: matrix.terminal, rounds: matrix.rounds } }
    if (Buffer.byteLength(JSON.stringify(report)) > LIMIT) throw Error('EXPERIMENT_MATRIX_RESULT_LIMIT')
    return report
  }
  private async import(data: Record<string, unknown>, signal: AbortSignal) {
    fields(data, ['report'])
    if (typeof data.report !== 'string' || !data.report.isWellFormed() || data.report.includes('\0')
      || Buffer.byteLength(data.report) > LIMIT) throw Error('EXPERIMENT_MATRIX_INPUT_INVALID')
    const report = object(JSON.parse(data.report)); fields(report, ['schemaVersion', 'kind', 'source', 'matrix'])
    const source = object(report.source); fields(source, ['id', 'startedAt'])
    if (report.schemaVersion !== 1 || report.kind !== 'engineering-matrix-report') throw Error('EXPERIMENT_MATRIX_RECORD_INVALID')
    const runId = id(source.id), original = await this.export(runId, signal)
    if (JSON.stringify(report) !== JSON.stringify(original)) throw Error('EXPERIMENT_MATRIX_IMPORT_SOURCE_UNCONFIRMED')
    // Import validates this journal's original references; it never creates a root, repairs a Session or replays a row.
    return this.read(runId, signal)
  }
  /** Prepare/confirm an explicit aggregate budget, read original round checkpoints or cancel and drain without retries.
   * @param method - Independent matrix operation; no model tool or alternate launcher is exposed.
   * @param data - Complete authenticated JSON; each row uses the engineering owner's current factor and permission checks.
   * @param signal - HTTP/read lifetime; confirmed work has its own cancellation owner.
   * @returns Group and original run references; missing publication never authorizes a replay.
   */
  request(method: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.stopped) return Promise.reject(Error('EXPERIMENT_STOPPING'))
    const lifetime = AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []])
    const work = (async () => {
      if (method === 'matrix-prepare') return this.prepare(data, lifetime)
      if (method === 'matrix-start') return this.start(data)
      if (method === 'matrix-import') return this.import(data, lifetime)
      if (method === 'matrix-export') { fields(data, ['id']); return this.export(id(data.id), lifetime) }
      if (!['matrix-read', 'matrix-cancel'].includes(method)) throw Error('EXPERIMENT_MATRIX_INPUT_INVALID')
      fields(data, ['id']); const runId = id(data.id), active = this.active
      if (method === 'matrix-cancel') {
        if (!active || active.id !== runId) throw Error('EXPERIMENT_MATRIX_CHANGED')
        active.controller.abort(Error('CANCELLED')); await active.done
      }
      const value = await this.read(runId, lifetime)
      if (value?.terminal && active?.id === runId) await active.done
      return value && { ...value, canCancel: this.active?.id === runId && !this.active.controller.signal.aborted }
    })()
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* The initiating caller receives failures. */ })
    return work
  }
  /** Revoke previews, stop subsequent rows and await the active child, native writers and every current read. */
  async close(): Promise<void> {
    this.stopped = true; this.plans.clear(); this.lifetime.abort(); this.active?.controller.abort(Error('CANCELLED'))
    await Promise.allSettled(this.pending); await this.active?.done
  }
}
