/** Explicit one-request analysis tasks own a separate budget, confirmation and official input journal; no tools execute. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import { AssistantStreamAccumulator, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { HttpEgressLease, HttpEgressPolicy } from '@deepseek-ai/dsh-http-proxy'
import type { StorageService, QuotaLease, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import type { ConnectionStore, RevisionId } from '../connections/store.ts'
import { TaskRequestInputs, type TaskRequestIntent, type TaskRequestTerminal, type TaskRequestId } from './task-inputs.ts'
import type { ExperimentId, ExperimentCaseId } from './comparison.ts'
import type { NotebookInputCapture } from '@nidofy/dsh-desktop-extras/context'
import { parseTaskNotebookInput } from './task-notebook-input.ts'
import { managedRequestObservation, reportedResponseModel, withManagedRequestObservation,
  type ManagedRequestObservation } from '../connections/request-observations.ts'

type ConfirmationId = Branded<'nidofy.TaskRequestConfirmationId'>
type Plan = {
  ticket: ConfirmationId
  intent: Omit<TaskRequestIntent, 'id' | 'startedAt'>
  policy: HttpEgressLease
  policyOwner: HttpEgressPolicy
  expiresAt: number
  notebook?: NotebookInputCapture
}
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
function string(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && !!value && value.isWellFormed() && !value.includes('\0') && Buffer.byteLength(value) <= bytes
}
function code(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.message) ? error.message : 'EXPERIMENT_TASK_UNCONFIRMED'
}

/** Independent confirmed task requests never acquire T19 tickets, create Agents, run tools or write project files. */
export class TaskRequestOwner {
  private readonly plans = new Map<ConfirmationId, Plan>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private active: { id: string; controller: AbortController; done: Promise<void> } | undefined
  private stopped = false
  constructor(private readonly ctx: Context, private readonly home: string, private readonly connections: ConnectionStore,
    private readonly storage: Pick<StorageService, 'reserve' | 'write'>,
    private readonly authority?: {
      collection: 'side-analysis-v1'
      check(signal: AbortSignal): Promise<void>
    }) {}
  private alive(): void { this.lifetime.signal.throwIfAborted(); if (this.stopped) throw Error('EXPERIMENT_STOPPING') }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* The initiating caller receives failures. */ })
    return work
  }
  private async prepare(data: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); this.alive()
    if (Object.keys(data).length !== (Object.hasOwn(data, 'notebookSessionId') ? 7 : 6) || Object.keys(data).some(key =>
      !['experimentId', 'caseId', 'connection', 'model', 'text', 'maxOutputTokens', 'notebookSessionId'].includes(key))
      || !string(data.experimentId, 36) || !UUID.test(data.experimentId) || !string(data.caseId, 36) || !UUID.test(data.caseId)
      || !string(data.connection, 64) || !string(data.model, 256) || !string(data.text, 16 * 1024)
      || typeof data.maxOutputTokens !== 'number' || !Number.isSafeInteger(data.maxOutputTokens)
      || data.maxOutputTokens < 1 || data.maxOutputTokens > 8192) throw Error('EXPERIMENT_TASK_INPUT_INVALID')
    let notebook: NotebookInputCapture | undefined
    if (Object.hasOwn(data, 'notebookSessionId')) {
      if (!string(data.notebookSessionId, 128)) throw Error('EXPERIMENT_TASK_INPUT_INVALID')
      const owner = this.ctx.get('nidofyNotebookV2')
      if (!owner) throw Error('EXPERIMENT_NOTEBOOK_OWNER_UNAVAILABLE')
      notebook = parseTaskNotebookInput(await owner.input(data.notebookSessionId, signal))
    }
    const state = this.connections.state, revision = state.current[data.connection]
    const row = state.revisions.find(row => row.id === revision)
    if (!row || state.revoked.includes(row.id)) throw Error('CONNECTION_NOT_FOUND')
    const profile = resolveProfiles({ task: { ...row.profile, apiKeyEnv: row.credential } }).get('task')
    const model = profile?.piProvider?.getModels().find(row => row.id === data.model)
    if (!model) throw Error('EXPERIMENT_TASK_MODEL_UNAVAILABLE')
    if (!['openai-completions', 'anthropic-messages'].includes(model.api)) throw Error('EGRESS_TRANSPORT_REFUSED')
    const policyOwner = this.ctx.get('outboundHttp')
    if (!policyOwner) throw Error('EGRESS_OWNER_UNAVAILABLE')
    const policy = await policyOwner.prepare(model.baseUrl)
    await policy.check(); signal.throwIfAborted(); this.alive()
    if (this.connections.state !== state || this.ctx.get('outboundHttp') !== policyOwner) throw Error('EXPERIMENT_TASK_CONFIGURATION_CHANGED')
    for (const [id, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(id)
    if (this.plans.size >= 16) throw Error('EXPERIMENT_CONFIRMATION_LIMIT')
    const ticket = brandString<ConfirmationId>(randomUUID()), expiresAt = Date.now() + 120000
    const intent: Plan['intent'] = { schemaVersion: 1, kind: 'task-request', experimentId: brandString<ExperimentId>(data.experimentId),
      caseId: brandString<ExperimentCaseId>(data.caseId), connection: data.connection, model: data.model, text: data.text,
      maxOutputTokens: data.maxOutputTokens, connectionRevision: row.id, configurationRevision: state.revision,
      policyRevision: { ...policy.revision } }
    const preview = { ticket, expiresAt, ...intent, budget: { requests: 1, retries: 0 }, tools: false, projectWrites: false,
      exactModelVersion: null, factors: { notebook: notebook?.text ? 'CAPTURED_INPUT' : notebook ? 'EMPTY' : 'NOT_INJECTED', cache: 'UNKNOWN' },
      ...notebook ? { notebookInput: notebook } : {} }
    if (Buffer.byteLength(JSON.stringify(preview)) > 64 * 1024) throw Error('EXPERIMENT_TASK_RESULT_LIMIT')
    this.plans.set(ticket, { ticket, intent, policy, policyOwner, expiresAt, ...notebook ? { notebook } : {} })
    return preview
  }
  private async authorize(plan: Plan, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); this.alive()
    await this.authority?.check(signal)
    if (this.ctx.get('outboundHttp') !== plan.policyOwner || this.connections.state.revision !== plan.intent.configurationRevision
      || this.connections.state.current[plan.intent.connection] !== plan.intent.connectionRevision) {
      throw Error('EXPERIMENT_TASK_CONFIGURATION_CHANGED')
    }
    await plan.policy.check()
    if (plan.notebook) {
      const owner = this.ctx.get('nidofyNotebookV2')
      if (!owner || JSON.stringify(await owner.input(plan.notebook.scope.sessionId, signal)) !== JSON.stringify(plan.notebook)) {
        throw Error('EXPERIMENT_NOTEBOOK_INPUT_CHANGED')
      }
    }
    signal.throwIfAborted(); this.alive()
    if (this.ctx.get('outboundHttp') !== plan.policyOwner || this.connections.state.revision !== plan.intent.configurationRevision
      || this.connections.state.current[plan.intent.connection] !== plan.intent.connectionRevision) {
      throw Error('EXPERIMENT_TASK_CONFIGURATION_CHANGED')
    }
  }
  private async start(data: Record<string, unknown>) {
    this.alive()
    if (Object.keys(data).length !== 3 || Object.keys(data).some(key => !['id', 'ticket', 'accepted'].includes(key))
      || !string(data.id, 36) || !UUID.test(data.id) || !string(data.ticket, 36) || data.accepted !== true) {
      throw Error('EXPERIMENT_TASK_INPUT_INVALID')
    }
    const ticket = brandString<ConfirmationId>(data.ticket), plan = this.plans.get(ticket)
    this.plans.delete(ticket)
    if (!plan || plan.expiresAt < Date.now()) throw Error('EXPERIMENT_CONFIRMATION_EXPIRED')
    if (this.active) throw Error('EXPERIMENT_TASK_BUSY')
    const id = data.id, controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(180000)])
    const inputs = new TaskRequestInputs(this.home, id, this.storage, this.authority?.collection)
    let resolve!: () => void
    const active = { id, controller, done: new Promise<void>((finish) => { resolve = finish }) }
    this.active = active
    let lease: QuotaLease | undefined
    try {
      await this.authorize(plan, signal)
      lease = await this.storage.reserve('node:task-request', 8 * 256 * 1024, 4 * 256 * 1024, brandString<StorageOperationId>(id))
      const intent: TaskRequestIntent = { ...plan.intent, id: brandString<TaskRequestId>(id), startedAt: Date.now() }
      await lease.run(() => inputs.open(intent, signal, plan.notebook))
      const quota = lease
      void (async () => {
        const observation = managedRequestObservation()
        try { await withManagedRequestObservation(observation, () => this.run(plan, inputs, signal, quota, observation)) } finally {
          try { await inputs.close() } finally {
            await quota.release().catch(() => { /* A failed settlement conservatively retains its native charge. */ })
            this.active = undefined; resolve()
          }
        }
      })().catch(() => { /* A missing terminal publication reads INTERRUPTED and never authorizes a new dispatch. */ })
      return { id, status: 'RUNNING', canCancel: true, intent }
    } catch (error) {
      try { await inputs.close() } finally {
        await lease?.release().catch(() => { /* Unknown native charges are retained. */ })
        this.active = undefined; resolve()
      }
      throw error
    }
  }
  private async run(plan: Plan, inputs: TaskRequestInputs, signal: AbortSignal, quota: QuotaLease,
    observation: ManagedRequestObservation): Promise<void> {
    const terminal: TaskRequestTerminal = { status: 'UNKNOWN', diagnostic: null, endedAt: 0, dispatched: false, streamComplete: false }
    const accumulator = new AssistantStreamAccumulator()
    // Aborting preparation releases a managed adapter lease even when no iterator was created.
    const callLifetime = new AbortController(), requestSignal = AbortSignal.any([signal, callLifetime.signal])
    let connection: ReturnType<ConnectionStore['acquire']> | undefined
    try {
      connection = this.connections.acquire(brandString<RevisionId>(plan.intent.connectionRevision))
      await this.authorize(plan, requestSignal); connection.check()
      const llm = this.ctx.get('llm')
      if (!llm) throw Error('EXPERIMENT_TASK_MODEL_OWNER_UNAVAILABLE')
      const call = await llm.prepareCall({ provider: `nidofy-rev-${plan.intent.connectionRevision}--${plan.intent.connection}`,
        model: plan.intent.model, maxTokens: plan.intent.maxOutputTokens }, requestSignal)
      if (call.retryPolicy.mode !== 'normal' || call.retryPolicy.maxRetries !== 0) throw Error('EXPERIMENT_TASK_RETRIES_REFUSED')
      const logged = await quota.run(() => inputs.request(call, plan.intent.text, requestSignal))
      await quota.run(() => logged.dispatch(async () => {
        await this.authorize(plan, requestSignal); connection?.check()
        requestSignal.throwIfAborted()
        terminal.dispatched = true
        let finish: Extract<StreamChunk, { type: 'finish' }> | undefined, usage: TokenUsage | undefined, chunks = 0
        for await (const chunk of call.stream(logged.options)) {
          requestSignal.throwIfAborted()
          if (this.authority) await this.authorize(plan, requestSignal)
          if (++chunks > 2048 || finish !== undefined) throw Error('EXPERIMENT_TASK_STREAM_INVALID')
          accumulator.push({ time: Date.now(), chunk })
          if (Buffer.byteLength(JSON.stringify(accumulator.snapshot())) > 24 * 1024) throw Error('EXPERIMENT_TASK_OUTPUT_LIMIT')
          if (chunk.type === 'tool-call-delta' || chunk.type === 'block-start' && chunk.blockType === 'tool-call'
            || chunk.type === 'block-end' && chunk.block.type === 'tool-call') throw Error('EXPERIMENT_TASK_TOOLS_REFUSED')
          if (chunk.type === 'finish') finish = chunk
          if (chunk.type === 'usage') usage = chunk.usage
        }
        if (!finish) throw Error('EXPERIMENT_TASK_STREAM_INVALID')
        observation.response = reportedResponseModel(finish, plan.intent.model, call.config.provider)
        terminal.streamComplete = true
        terminal.status = finish.reason.kind === 'stop' ? 'COMPLETED' : finish.reason.kind === 'error' ? 'FAILED' : 'UNKNOWN'
        terminal.diagnostic = terminal.status === 'COMPLETED' ? null : 'EXPERIMENT_TASK_FINISH_UNCONFIRMED'
        if (usage && usage.outputTokens > plan.intent.maxOutputTokens) {
          terminal.status = 'UNKNOWN'; terminal.diagnostic = 'EXPERIMENT_TASK_OUTPUT_LIMIT'
        }
      }))
    } catch (error) {
      const timeout = signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
      terminal.status = timeout ? 'TIMEOUT' : signal.aborted ? 'CANCELLED' : 'UNKNOWN'
      terminal.diagnostic = timeout ? 'EXPERIMENT_TASK_TIMEOUT' : code(error)
    } finally {
      callLifetime.abort(); connection?.release()
      terminal.endedAt = Date.now()
      await quota.terminal(() => inputs.settle(terminal, accumulator.snapshot(), observation))
    }
  }
  private async read(id: string, signal: AbortSignal) {
    const reader = new TaskRequestInputs(this.home, id, this.storage, this.authority?.collection)
    try {
      const value = await reader.read(signal)
      if (value?.terminal && this.active?.id === id) await this.active.done
      signal.throwIfAborted()
      return value && this.active?.id === id && value.terminal === null ? { ...value, status: 'RUNNING' } : value
    } finally { await reader.close() }
  }
  /** Dispatch exact authenticated prepare/start/read/cancel operations; previews and reads never send or execute.
   * @param method - Independent task-request operation, separate from receipt comparisons and self-tests.
   * @param data - Complete JSON fields; measured counters, alternate tools and arbitrary execution paths refuse.
   * @param signal - Read lifetime. Started work has its own explicit cancellation owner.
   * @returns Caller-retained run facts; unknown starts are inspected, never resubmitted automatically.
   */
  request(method: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.stopped) return Promise.reject(Error('EXPERIMENT_STOPPING'))
    return this.track((async () => {
      if (method === 'task-prepare') return this.prepare(data, AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []]))
      if (method === 'task-start') return this.start(data)
      if (!['task-read', 'task-cancel'].includes(method) || Object.keys(data).length !== 1
        || !string(data.id, 36) || !UUID.test(data.id)) throw Error('EXPERIMENT_TASK_INPUT_INVALID')
      if (method === 'task-cancel') {
        const active = this.active
        if (!active || active.id !== data.id) throw Error('EXPERIMENT_TASK_CHANGED')
        active.controller.abort(Error('CANCELLED')); await active.done
      }
      const result = await this.read(data.id, AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []]))
      return result && { ...result, canCancel: this.active?.id === data.id && !this.active.controller.signal.aborted }
    })())
  }
  /** Revoke confirmations, cancel admission/streaming and await all providers and quota writers before Host disposal. */
  async close(): Promise<void> {
    this.stopped = true; this.plans.clear(); this.lifetime.abort(); this.active?.controller.abort(Error('CANCELLED'))
    await Promise.allSettled(this.pending); await this.active?.done
  }
}
