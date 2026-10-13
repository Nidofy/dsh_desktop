/** Bounded self-test workflows; cancellation awaits check teardown and every result commit precedes the next check. */
import type { StorageService, QuotaLease, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { brandString } from '@deepseek-ai/dsh-brand'
import { checks } from './catalogue.ts'
import type { CheckId, CheckResult, SelfTestReport } from './types.ts'
import { SelfTestStore } from './store.ts'
import type { SelfTestConnectionOwner } from './provider.ts'

/** Check provider owns isolated resources and drains all requests/commands before returning. */
export interface LocalChecks {
  open(signal: AbortSignal): Promise<void>
  check(id: CheckId, signal: AbortSignal): Promise<CheckResult>
  close(): Promise<void>
}

/** Report service for isolated local checks and explicitly confirmed, fixed connection checks. */
export class SelfTestRunner {
  private active: {
    report: SelfTestReport
    published: SelfTestReport | null
    controller: AbortController
    done: Promise<void>
    create(): LocalChecks
  } | undefined
  private stopped = false
  constructor(readonly store: SelfTestStore, private readonly storage: Pick<StorageService, 'reserve'>,
    private readonly create: (id: string) => LocalChecks, private readonly connections?: SelfTestConnectionOwner) {}
  /** Persist intent before constructing the check provider or executing anything.
   * @param input - Authenticated JSON with mode and a fresh caller-retained operationId.
   * @returns Committed initial state; unknown responses are inspected, never retried.
   */
  async start(input: Record<string, unknown>): Promise<SelfTestReport> {
    if (this.stopped) throw Error('SELFTEST_STOPPING')
    if (this.active) throw Error('SELFTEST_BUSY')
    if (input.mode !== 'local' && (input.mode !== 'provider' || !this.connections)) throw Error('SELFTEST_MODE_UNAVAILABLE')
    const providerMode = input.mode === 'provider'
    if (typeof input.operationId !== 'string' || Object.keys(input).some(key => !(providerMode
      ? ['mode', 'operationId', 'ticket', 'accepted'] : ['mode', 'operationId']).includes(key))
      || providerMode && (typeof input.ticket !== 'string' || input.accepted !== true)) {
      throw Error('SELFTEST_INPUT_INVALID')
    }
    const id = this.store.identity(input.operationId), controller = new AbortController()
    const confirmation = providerMode && this.connections && typeof input.ticket === 'string'
      ? this.connections.take(input.ticket) : undefined
    const report: SelfTestReport = { schemaVersion: providerMode ? 2 : 1, kind: 'electron-self-test', id,
      mode: providerMode ? 'provider' : 'local', status: 'RUNNING',
      startedAt: Date.now(), endedAt: null, warning: null,
      budget: { modelRequests: confirmation?.requests ?? 0, timeoutMs: 180000, retries: 0,
        ...providerMode ? { maxOutputTokens: 64 } : {} },
      rows: checks.map(([check, group]) => ({ id: check, phase: group === (providerMode ? 'provider' : 'local') ? 'PENDING' : 'SETTLED',
        status: group === 'field' ? 'UNKNOWN' : 'SKIPPED', code: group === 'field' ? 'FIELD_UNVERIFIED' : 'NOT_SELECTED',
        durationMs: null, metrics: {} })) }
    // Reserve the process lane before the first await. close() also drains admission.
    let finish!: () => void
    const active = { report, published: null as SelfTestReport | null, controller,
      create: () => confirmation ? confirmation.create(id) : this.create(id),
      done: new Promise<void>((resolve) => { finish = resolve }) }
    this.active = active
    let lease: QuotaLease | undefined
    try {
      lease = await this.storage.reserve('node:selftest', 40 * 2 * 64 * 1024, 2 * 64 * 1024,
        brandString<StorageOperationId>(id))
      controller.signal.throwIfAborted()
      await lease.run(() => this.store.save(report, true))
      active.published = structuredClone(report)
      const initial = structuredClone(report)
      const admitted = lease
      void this.run(active, admitted).finally(() => {
        this.active = undefined; finish()
      }).catch((_error: unknown) => { /* The report records failures; a lost terminal commit remains interrupted on cold read. */ })
      return initial
    } catch (error) {
      await lease?.release().catch((_release: unknown) => { /* Unknown settlement retains the native charge. */ })
      this.active = undefined; finish(); throw error
    }
  }
  private async run(active: NonNullable<SelfTestRunner['active']>, lease: QuotaLease): Promise<void> {
    const { report, controller } = active
    const timeout = setTimeout(() => { controller.abort(Error('TIMEOUT')) }, report.budget.timeoutMs)
    timeout.unref()
    let provider: LocalChecks | undefined
    const persistence = { writable: true }
    const persist = async (terminal = false): Promise<void> => {
      try {
        await (terminal ? lease.terminal(() => this.store.save(report)) : lease.run(() => this.store.save(report)))
        active.published = structuredClone(report)
      }
      catch (error) { persistence.writable = false; report.warning = 'STORAGE_FAILED'; throw error }
    }
    try {
      controller.signal.throwIfAborted()
      provider = active.create()
      await provider.open(controller.signal)
      for (const [id, group] of checks) {
        if (group !== (report.mode === 'local' ? 'local' : 'provider')) continue
        controller.signal.throwIfAborted()
        const row = report.rows.find(row => row.id === id)
        if (!row) throw Error('SELFTEST_RECORD_INVALID')
        row.phase = 'RUNNING'; row.status = 'UNKNOWN'; row.code = 'EXECUTION_UNCONFIRMED'
        await persist()
        controller.signal.throwIfAborted()
        const started = performance.now()
        let unconfirmed = false
        try {
          const result = await provider.check(id, controller.signal)
          controller.signal.throwIfAborted()
          Object.assign(row, result)
          if (report.mode === 'provider' && result.status !== 'PASS') unconfirmed = true
        } catch (error) {
          const mismatch = error instanceof Error && error.message === 'SELFTEST_ASSERTION_FAILED'
          unconfirmed = !mismatch
          row.status = !controller.signal.aborted && mismatch ? 'FAIL' : 'UNKNOWN'; row.code = controller.signal.aborted
            ? controller.signal.reason instanceof Error && controller.signal.reason.message === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'
            : mismatch ? 'ASSERTION_FAILED' : 'EXECUTION_UNCONFIRMED'
        }
        row.phase = 'SETTLED'; row.durationMs = performance.now() - started
        await persist()
        if (unconfirmed) throw Error('SELFTEST_EXECUTION_UNCONFIRMED')
      }
      report.status = 'COMPLETED'
    } catch (_error) { report.status = 'FAILED'; report.warning ??= 'EXECUTION_UNCONFIRMED' }
    finally {
      clearTimeout(timeout)
      try { await provider?.close() }
      catch (_error) { report.warning ??= 'CLEANUP_FAILED'; report.status = 'FAILED' }
      if (controller.signal.aborted) {
        report.status = controller.signal.reason instanceof Error && controller.signal.reason.message === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'
        for (const row of report.rows) if (row.phase === 'PENDING') { row.phase = 'SETTLED'; row.code = report.status }
      }
      if (report.status === 'FAILED') for (const row of report.rows) if (row.phase === 'PENDING') {
        row.phase = 'SETTLED'; row.code = 'SOURCE_UNAVAILABLE'
      }
      report.endedAt = Date.now()
      // Do not blindly repeat a checkpoint whose commit outcome was unknown.
      if (persistence.writable) await persist(true).catch((_error: unknown) => { /* Cold read retains the last confirmed checkpoint. */ })
      await lease.release().catch((_error: unknown) => { report.warning ??= 'STORAGE_FAILED' })
    }
  }
  /** Observe the live committed workflow, otherwise cold-read without executing.
   * @param id - Exact caller-retained run identity.
   * @returns Current report, or null for unknown/expired history.
   */
  async read(id: string): Promise<SelfTestReport | null> {
    return this.active?.report.id === id ? structuredClone(this.active.published) : this.store.read(id)
  }
  /** Request cancellation and await provider/process teardown and terminal commit.
   * @param id - Exact active run; changing selection cannot cancel another run.
   */
  async cancel(id: string): Promise<void> {
    if (this.active?.report.id !== id) throw Error('SELFTEST_RUN_CHANGED')
    this.active.controller.abort(Error('CANCELLED')); await this.active.done
  }
  /** Dispatch exact authenticated operations; opening/history/export never start a check.
   * @param method - Local UI action, without a model-callable tool registration.
   * @param data - Bounded parsed JSON; every operation rejects unrelated fields.
   * @returns Current history/report or a whitelisted export; null reports remain UNKNOWN.
   */
  async request(method: string, data: Record<string, unknown>): Promise<unknown> {
    if (this.stopped) throw Error('SELFTEST_STOPPING')
    if (method === 'connection-capacity' && Object.keys(data).length === 0 && this.connections) return this.connections.capacity()
    if (method === 'connection-options' && Object.keys(data).length === 0 && this.connections) return this.connections.options()
    if (method === 'connection-prepare' && this.connections) return this.connections.prepare(data)
    if (method === 'start') return this.start(data)
    if (method === 'list' && Object.keys(data).length === 0) {
      const history = await this.store.list()
      return { activeId: this.active?.report.id ?? null, history: history.map(row => ({ ...row,
        status: row.id === this.active?.report.id ? 'RUNNING' : row.status })) }
    }
    if (!['read', 'cancel', 'export'].includes(method) || typeof data.id !== 'string'
      || Object.keys(data).some(key => key !== 'id')) throw Error('SELFTEST_INPUT_INVALID')
    this.store.identity(data.id)
    if (method === 'cancel') { await this.cancel(data.id); return this.read(data.id) }
    const report = await this.read(data.id)
    return method === 'export' && report ? this.store.export(report) : report
  }
  /** Stop new runs, cancel admission/execution and wait until every writer and child has drained. */
  async close(): Promise<void> {
    this.stopped = true
    const active = this.active
    active?.controller.abort(Error('CANCELLED'))
    await this.connections?.close(); await active?.done
  }
}
