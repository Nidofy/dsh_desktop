/** Independent task-request journals retain official input cuts and settled streams without adopting self-test logs. */
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { ExperimentId, ExperimentCaseId } from './comparison.ts'
import type { RevisionId } from '../connections/store.ts'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage, expandAssistantStream, type GenerateOptions, type PreparedLlmCall,
  type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { object } from '../connections/store.ts'
import { unlinked } from '../selftest/store.ts'
import { publishRecord, readRecord } from '../workbench/verification-storage.ts'
import { parseManagedRequestObservation, reportedResponseModel, type ManagedRequestObservation } from '../connections/request-observations.ts'
import type { NotebookInputCapture } from '@nidofy/dsh-desktop-extras/context'
import { parseTaskNotebookInput } from './task-notebook-input.ts'
import { readAnalysisBudget, readAnalysisArchive } from './analysis-retention.ts'

const LIMIT = 256 * 1024
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
/** Caller-retained independent task-request identity, distinct from a T11 action or a T19 self-test. */
export type TaskRequestId = Branded<'nidofy.TaskRequestId'>
/** Explicit one-request task grouping and budget; labels do not establish receipt equivalence or equal quality. */
export interface TaskRequestIntent {
  schemaVersion: 1
  kind: 'task-request'
  id: TaskRequestId
  experimentId: ExperimentId
  caseId: ExperimentCaseId
  text: string
  connection: string
  connectionRevision: RevisionId
  configurationRevision: number
  model: string
  maxOutputTokens: number
  policyRevision: { distribution: string; profile: number }
  startedAt: number
}
/** Terminal request facts; an incomplete journal remains INTERRUPTED on reads, with no repair or replay. */
export interface TaskRequestTerminal {
  status: 'COMPLETED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED' | 'TIMEOUT'
  diagnostic: string | null
  endedAt: number
  dispatched: boolean
  streamComplete: boolean
}
function fields(row: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(row).length !== names.length || Object.keys(row).some(key => !names.includes(key))) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.isWellFormed() && !value.includes('\0') && Buffer.byteLength(value) <= max
}
function identity(value: string): string { if (!UUID.test(value)) throw Error('EXPERIMENT_ID_INVALID'); return value }
function parseIntent(value: unknown): TaskRequestIntent {
  const r = object(value), policy = object(r.policyRevision)
  fields(r, ['schemaVersion', 'kind', 'id', 'experimentId', 'caseId', 'text', 'connection', 'connectionRevision',
    'configurationRevision', 'model', 'maxOutputTokens', 'policyRevision', 'startedAt'])
  fields(policy, ['distribution', 'profile'])
  if (r.schemaVersion !== 1 || r.kind !== 'task-request' || !text(r.id, 36) || !UUID.test(r.id)
    || !text(r.experimentId, 36) || !UUID.test(r.experimentId) || !text(r.caseId, 36) || !UUID.test(r.caseId)
    || !text(r.text, 16 * 1024) || !text(r.connection, 64) || !text(r.connectionRevision, 36) || !UUID.test(r.connectionRevision)
    || !integer(r.configurationRevision) || !text(r.model, 256) || !integer(r.maxOutputTokens)
    || r.maxOutputTokens < 1 || r.maxOutputTokens > 8192 || !integer(r.startedAt) || !text(policy.distribution, 128)
    || !integer(policy.profile)) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
  return { schemaVersion: 1, kind: 'task-request', id: brandString<TaskRequestId>(r.id),
    experimentId: brandString<ExperimentId>(r.experimentId), caseId: brandString<ExperimentCaseId>(r.caseId),
    text: r.text, connection: r.connection, connectionRevision: brandString<RevisionId>(r.connectionRevision),
    configurationRevision: r.configurationRevision, model: r.model, maxOutputTokens: r.maxOutputTokens,
    policyRevision: { distribution: policy.distribution, profile: policy.profile }, startedAt: r.startedAt }
}
function parseTerminal(value: unknown): TaskRequestTerminal {
  const r = object(value)
  fields(r, ['status', 'diagnostic', 'endedAt', 'dispatched', 'streamComplete'])
  if (!['COMPLETED', 'FAILED', 'UNKNOWN', 'CANCELLED', 'TIMEOUT'].includes(String(r.status)) || !integer(r.endedAt)
    || typeof r.dispatched !== 'boolean' || typeof r.streamComplete !== 'boolean'
    || r.diagnostic !== null && !text(r.diagnostic, 128)) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
  return { status: r.status as TaskRequestTerminal['status'], diagnostic: r.diagnostic, endedAt: r.endedAt,
    dispatched: r.dispatched, streamComplete: r.streamComplete }
}
async function size(path: string, count = { entries: 0 }): Promise<number> {
  if (++count.entries > 80) throw Error('EXPERIMENT_TASK_HISTORY_LIMIT')
  const info = await lstat(path)
  if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw Error('EXPERIMENT_TASK_PATH_REFUSED')
  if (info.isFile()) return info.size
  if (!info.isDirectory()) throw Error('EXPERIMENT_TASK_PATH_REFUSED')
  let bytes = 0
  for (const name of await readdir(path)) {
    bytes += await size(join(path, name), count)
    if (bytes > LIMIT) throw Error('EXPERIMENT_TASK_HISTORY_LIMIT')
  }
  return bytes
}

/** Private bounded journals use the original native quota, exclusive publication and official JSONL writer. */
export class TaskRequestInputs {
  private readonly ctx = new Context()
  private readonly base: string
  private readonly root: string
  private readonly sessionId: SessionId
  private session: Session | undefined
  private notebook: NotebookInputCapture | undefined
  constructor(private readonly home: string, private readonly id: string, private readonly storage: Pick<StorageService, 'write'>,
    private readonly collection: 'task-requests-v1' | 'side-analysis-v1' = 'task-requests-v1') {
    identity(id)
    this.base = join(home, 'nidofy-extras', 'experiments', collection)
    this.root = join(this.base, id)
    this.sessionId = SessionId('task-request-' + id)
  }
  private async json(name: string): Promise<unknown> {
    const path = join(this.root, name)
    await unlinked(path)
    let info
    try { info = await lstat(path) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
    if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    const bytes = await readRecord(path)
    if (!bytes) throw Error('EXPERIMENT_TASK_RECORD_CHANGED')
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (value === null) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    return value
  }
  private async publish(name: string, value: object): Promise<void> {
    const bytes = JSON.stringify(value)
    if (Buffer.byteLength(bytes) > 64 * 1024 || await size(this.root) + 2 * Buffer.byteLength(bytes) > LIMIT) {
      throw Error('EXPERIMENT_TASK_RECORD_LIMIT')
    }
    if (!await publishRecord(join(this.root, name), bytes)) throw Error('EXPERIMENT_TASK_RECORD_EXISTS')
  }
  /** Commit a fresh intent under a shared capacity lock; active retention and ten unfinished roots bound admission.
   * @param intent - Independently confirmed task and request budget, never a self-test ticket.
   * @param signal - Admission lifetime; cancelled admissions never send a model request.
   * @param notebook - Optional complete explicit source capture; kept in its own versioned sidecar.
   */
  async open(intent: TaskRequestIntent, signal: AbortSignal, notebook?: NotebookInputCapture): Promise<void> {
    if (parseIntent(intent).id !== this.id) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    if (notebook) this.notebook = parseTaskNotebookInput(notebook)
    signal.throwIfAborted(); await unlinked(this.base)
    await this.storage.write(this.base, 2 * LIMIT, async () => {
      await mkdir(this.base, { recursive: true, mode: 0o700 })
      await withFileLock(join(this.base, 'admission'), async () => {
        signal.throwIfAborted()
        const names = await readdir(this.base)
        const budget = this.collection === 'side-analysis-v1' ? await readAnalysisBudget(this.base)
          : { activeLimit: 20, archiveLimit: 0 }
        let roots = 0, archived = 0, unsettled = 0, bytes = 0
        for (const name of names) {
          if (name === 'retention-v1' && this.collection === 'side-analysis-v1') continue
          if (name === 'admission.lock') {
            const info = await lstat(join(this.base, name))
            if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw Error('EXPERIMENT_TASK_PATH_REFUSED')
            bytes += info.size; continue
          }
          identity(name); roots++
          if (roots > 100) throw Error('EXPERIMENT_TASK_HISTORY_LIMIT')
          const retained = join(this.base, name)
          bytes += await size(retained)
          const reader = new TaskRequestInputs(this.home, name, this.storage, this.collection)
          try { if (!await reader.read(signal)) throw Error('EXPERIMENT_TASK_RECORD_INVALID') }
          finally { await reader.close() }
          const original = await readRecord(join(retained, 'intent.json'))
          if (!original || parseIntent(JSON.parse(original.toString())).id !== name) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
          const terminal = await readRecord(join(retained, 'terminal.json'))
          if (!terminal) unsettled++
          else parseTerminal(JSON.parse(terminal.toString()))
          if (this.collection === 'side-analysis-v1' && await readAnalysisArchive(retained, name)) {
            if (!terminal) throw Error('ANALYSIS_RETENTION_INVALID')
            archived++
          }
        }
        if (roots - archived >= budget.activeLimit || archived > budget.archiveLimit || unsettled >= 10
          || bytes + 2 * LIMIT > (budget.activeLimit + budget.archiveLimit + 2) * LIMIT + 4096) throw Error('EXPERIMENT_TASK_HISTORY_LIMIT')
        signal.throwIfAborted()
        await mkdir(this.root, { mode: 0o700 })
        await this.publish('intent.json', intent)
        if (this.notebook) await this.publish('notebook-input.json', { schemaVersion: 1, kind: 'task-notebook-input',
          taskRequestId: this.id, input: this.notebook })
      })
    })
    await this.ctx.plugin(JsonlSessionPersistence, { root: join(this.root, 'sessions'), compression: 'none' })
  }
  /** Persist full task input and return a cold reconstructed request tied to the exact prepared call.
   * @param call - Official registration-bound, one-shot call with zero provider retries.
   * @param text - Complete private task text retained verbatim.
   * @param signal - Request lifetime.
   * @returns Dispatch under the observed physical generation; the callback cannot run before the cut is committed.
   */
  async request(call: PreparedLlmCall, text: string, signal: AbortSignal) {
    const session = Session.create(this.sessionId)
    const events = [session.append('turn/start', { turn: 1 }), session.append('step/start', { turn: 1, step: 1 }),
      session.append('request/header', { reason: 'initial', header: { config: { ...call.config },
        ...Object.keys(call.adapterDefaults).length ? { adapterDefaults: { ...call.adapterDefaults } } : {} } }),
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text },
        ...this.notebook?.text ? [{ type: 'text' as const, text: '\n\n' + this.notebook.text }] : []] }), { surfaceOp: 'append' })]
    if (await size(this.root) + 2 * Buffer.byteLength(JSON.stringify(events)) > LIMIT) throw Error('EXPERIMENT_TASK_RECORD_LIMIT')
    await this.storage.write(this.root, 2 * LIMIT, async () => {
      signal.throwIfAborted(); await unlinked(this.root)
      const writer = await this.ctx.sessionPersistence.create(session.header)
      try { await writer.append(events); await writer.flush() } finally { await writer.close() }
    })
    const durable = await this.ctx.sessionPersistence.observeDurable(session.id, { signal })
    if (durable.meta.id !== this.sessionId || durable.events.length !== 4 || durable.durableThrough !== 3
      || JSON.stringify(durable.events) !== JSON.stringify(events)) throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
    const cold = Session.create(durable.meta.id, durable.events, durable.meta), header = cold.requestHeader()
    if (!header || JSON.stringify(header.config) !== JSON.stringify(call.config)) throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
    const options: GenerateOptions = { ...header.config, messages: cold.deriveMessages(), toolHistory: cold.toolHistory(),
      sessionId: cold.id, signal }
    Object.freeze(options.messages); Object.freeze(options)
    this.session = session
    return { options, dispatch: <T>(send: () => Promise<T>): Promise<T> => this.ctx.sessionPersistence.withGeneration(
      cold.id, durable.generation, async () => {
        signal.throwIfAborted()
        await this.publish('dispatch.json', { schemaVersion: 1, id: this.id, sessionId: cold.id,
          generation: durable.generation, through: durable.durableThrough, preparedConfig: call.config, retryPolicy: call.retryPolicy })
        signal.throwIfAborted()
        return send()
      }, { signal }) }
  }
  /** Commit the raw settlement and terminal metadata from the independently reserved terminal allowance.
   * @param terminal - Actual dispatch/stream outcome; missing usage cannot become zero.
   * @param stream - Complete bounded captured stream, or an explicitly incomplete prefix on refusal/cancellation.
   * @param observation - Request-local applied payload/response facts; absent for original journals.
   */
  async settle(terminal: TaskRequestTerminal, stream: readonly AssistantStreamRecord[],
    observation?: ManagedRequestObservation): Promise<void> {
    if (this.session && terminal.dispatched) {
      const session = this.session
      const events: SessionEvent[] = [session.append('assistant/attempt', { turn: 1, step: 1, stream: [...stream] }),
        session.append('step/end', { turn: 1, step: 1 }), session.append('turn/end', {
          turn: 1, reason: terminal.status === 'COMPLETED' ? { kind: 'completed' } : terminal.status === 'CANCELLED'
            ? { kind: 'aborted', reason: { kind: 'user' } } : terminal.status === 'TIMEOUT'
              ? { kind: 'aborted', reason: { kind: 'hook', reason: 'EXPERIMENT_TASK_TIMEOUT' } }
              : { kind: 'error', error: { code: 'UNKNOWN', message: terminal.diagnostic ?? 'Unknown task request' } },
        })]
      if (await size(this.root) + 2 * Buffer.byteLength(JSON.stringify(events)) > LIMIT) throw Error('EXPERIMENT_TASK_RECORD_LIMIT')
      await this.storage.write(this.root, 2 * LIMIT, async () => {
        const writer = await this.ctx.sessionPersistence.open(session.id, 'write')
        try { await writer.append(events); await writer.flush() } finally { await writer.close() }
      })
    }
    if (observation) await this.publish('execution-observation.json', { schemaVersion: 1, kind: 'managed-request-observation',
      taskRequestId: this.id, observation: parseManagedRequestObservation(observation) })
    await this.publish('terminal.json', terminal)
  }
  /** Read retained facts and the original dispatch prefix without flushing, repair, provider preparation or sending.
   * @param signal - Private read lifetime.
   * @returns Raw input/stream and explicitly bounded accounting; absent final publication stays INTERRUPTED.
   */
  async read(signal: AbortSignal) {
    signal.throwIfAborted()
    const rawIntent = await this.json('intent.json')
    if (rawIntent === null) return null
    const intent = parseIntent(rawIntent)
    if (intent.id !== this.id) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    await size(this.root)
    if ((await readdir(this.root)).some(name => !['intent.json', 'terminal.json', 'dispatch.json',
      'notebook-input.json', 'execution-observation.json', 'sessions',
      ...this.collection === 'side-analysis-v1' ? ['archive.json'] : []].includes(name))) {
      throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    }
    const rawTerminal = await this.json('terminal.json'), terminal = rawTerminal === null ? null : parseTerminal(rawTerminal)
    const rawObservation = await this.json('execution-observation.json')
    const rawNotebook = await this.json('notebook-input.json')
    let notebookInput: NotebookInputCapture | null = null
    if (rawNotebook !== null) {
      const row = object(rawNotebook)
      fields(row, ['schemaVersion', 'kind', 'taskRequestId', 'input'])
      if (row.schemaVersion !== 1 || row.kind !== 'task-notebook-input' || row.taskRequestId !== this.id) {
        throw Error('EXPERIMENT_NOTEBOOK_INPUT_INVALID')
      }
      notebookInput = parseTaskNotebookInput(row.input)
    }
    let executionObservation: ManagedRequestObservation | null = null
    if (rawObservation !== null) {
      const row = object(rawObservation)
      fields(row, ['schemaVersion', 'kind', 'taskRequestId', 'observation'])
      if (row.schemaVersion !== 1 || row.kind !== 'managed-request-observation' || row.taskRequestId !== this.id) {
        throw Error('EXPERIMENT_OBSERVATION_INVALID')
      }
      const captured = parseManagedRequestObservation(row.observation)
      // A sidecar published before an unknown terminal commit does not attest a completed dispatch.
      if (terminal?.dispatched) executionObservation = captured
    }
    const rawCut = await this.json('dispatch.json')
    if (terminal?.dispatched && rawCut === null) throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
    let dispatchInput: Omit<GenerateOptions, 'signal'> | null = null
    let stream: readonly AssistantStreamRecord[] = []
    if (rawCut !== null) {
      const cut = object(rawCut)
      fields(cut, ['schemaVersion', 'id', 'sessionId', 'generation', 'through', 'preparedConfig', 'retryPolicy'])
      const retry = object(cut.retryPolicy)
      if (cut.schemaVersion !== 1 || cut.id !== this.id || cut.sessionId !== this.sessionId || cut.through !== 3
        || !text(cut.generation, 512) || retry.mode !== 'normal' || retry.maxRetries !== 0) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
      const cold = new Context()
      try {
        await cold.plugin(JsonlSessionPersistence, { root: join(this.root, 'sessions'), compression: 'none' })
        const durable = await cold.sessionPersistence.observeDurable(this.sessionId, { signal })
        await cold.sessionPersistence.withGeneration(this.sessionId, durable.generation, () => {
          if (durable.generation !== cut.generation || durable.inheritedEventCount !== 0 || durable.events.length < 4
            || durable.events.length > 7 || durable.durableThrough !== durable.events.length - 1) throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
          const session = Session.create(this.sessionId, durable.events.slice(0, 4), durable.meta), header = session.requestHeader()
          const message = durable.events[3]
          if (!header || JSON.stringify(header.config) !== JSON.stringify(cut.preparedConfig)
            || header.config.model !== intent.model || header.config.maxTokens !== intent.maxOutputTokens
            || header.config.provider !== `nidofy-rev-${intent.connectionRevision}--${intent.connection}`
            || message?.type !== 'user/message' || JSON.stringify(message.data.content) !== JSON.stringify([{ type: 'text', text: intent.text },
            ...notebookInput?.text ? [{ type: 'text', text: '\n\n' + notebookInput.text }] : []])) {
            throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
          }
          dispatchInput = { ...header.config, messages: session.deriveMessages(), toolHistory: session.toolHistory(),
            sessionId: session.id }
          const settlement = durable.events[4]
          if (settlement) {
            if (settlement.type !== 'assistant/attempt' || settlement.data.turn !== 1 || settlement.data.step !== 1) {
              throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
            }
            expandAssistantStream(settlement.data.stream); stream = settlement.data.stream
          }
          if (terminal?.dispatched) {
            const end = durable.events[5], turn = durable.events[6]
            if (durable.events.length !== 7 || end?.type !== 'step/end' || end.data.turn !== 1 || end.data.step !== 1
              || turn?.type !== 'turn/end' || turn.data.turn !== 1) throw Error('EXPERIMENT_TASK_INPUT_UNCONFIRMED')
          }
          return Promise.resolve()
        }, { signal })
      } finally { await cold.fiber.dispose() }
    }
    const chunks = expandAssistantStream(stream), usage = chunks.filter(row => row.chunk.type === 'usage').at(-1)?.chunk
    const reported = usage?.type === 'usage' ? usage.usage : null
    const finish = chunks.at(-1)?.chunk
    const cache = executionObservation?.cache
    if (cache) {
      const hint = cache.api !== 'openai-completions' || cache.policy.mode === 'native' ? 'NATIVE'
        : cache.policy.mode === 'session' && cache.policy.models.includes(intent.model) ? 'SESSION_KEY' : 'REMOVED'
      if (cache.hint !== hint) throw Error('EXPERIMENT_OBSERVATION_CONFLICT')
    }
    if (executionObservation && JSON.stringify(executionObservation.response) !== JSON.stringify(reportedResponseModel(
      terminal?.streamComplete && finish?.type === 'finish' ? finish : undefined, intent.model,
      `nidofy-rev-${intent.connectionRevision}--${intent.connection}`))) {
      throw Error('EXPERIMENT_OBSERVATION_CONFLICT')
    }
    if (terminal?.streamComplete && (finish?.type !== 'finish' || chunks.filter(row => row.chunk.type === 'finish').length !== 1)
      || terminal?.status === 'COMPLETED' && (!terminal.dispatched || !terminal.streamComplete || finish?.type !== 'finish'
        || finish.reason.kind !== 'stop' || reported && reported.outputTokens > intent.maxOutputTokens)) {
      throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    }
    const metric = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens') => {
      const value = reported?.[key]
      return terminal?.streamComplete && integer(value) ? value : null
    }
    const result = { intent, terminal, status: terminal?.status ?? 'INTERRUPTED', preparedInput: dispatchInput,
      dispatchInput: terminal?.dispatched ? dispatchInput : null, stream,
      counts: { dispatches: terminal ? Number(terminal.dispatched) : null, providerWireRequests: null,
        inputTokens: metric('inputTokens'), outputTokens: metric('outputTokens'), cacheReadTokens: metric('cacheReadTokens') },
      exactModelVersion: null, factors: { notebook: terminal?.dispatched && notebookInput?.text ? 'CAPTURED_INPUT'
        : terminal?.dispatched && notebookInput ? 'EMPTY' : notebookInput ? 'UNKNOWN' : 'NOT_INJECTED', cache: 'UNKNOWN' },
      notebookInput, executionObservation, receipt: null,
      quality: 'UNKNOWN', efficiencyEligible: false }
    if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw Error('EXPERIMENT_TASK_RESULT_LIMIT')
    signal.throwIfAborted(); return result
  }
  /** Capture exact local files beside the validated cold journal; no physical generation is rewritten.
   * @param signal - Read lifetime; cancellation or a changing journal refuses the capture.
   * @returns Original relative filenames and base64 bytes, bounded by the existing run ceiling.
   */
  async exportRecords(signal: AbortSignal) {
    const journal = await this.read(signal)
    if (!journal) throw Error('EXPERIMENT_TASK_RECORD_INVALID')
    const files: { path: string; encoding: 'base64'; data: string }[] = []
    let bytes = 0
    const visit = async (directory: string, prefix: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        signal.throwIfAborted()
        const path = join(directory, name), info = await lstat(path)
        if (info.isSymbolicLink() || !info.isDirectory() && (!info.isFile() || info.nlink !== 1)) {
          throw Error('EXPERIMENT_TASK_PATH_REFUSED')
        }
        if (info.isDirectory()) await visit(path, prefix + name + '/')
        else {
          const raw = await readRecord(path)
          if (!raw) throw Error('EXPERIMENT_TASK_RECORD_CHANGED')
          bytes += raw.length
          if (bytes > LIMIT || files.length >= 80) throw Error('EXPERIMENT_TASK_HISTORY_LIMIT')
          files.push({ path: prefix + name, encoding: 'base64', data: raw.toString('base64') })
        }
      }
    }
    await size(this.root); await visit(this.root, '')
    if (JSON.stringify(await this.read(signal)) !== JSON.stringify(journal)) throw Error('EXPERIMENT_TASK_RECORD_CHANGED')
    signal.throwIfAborted()
    return { journal, files }
  }
  /** Publish an archive marker within the original root's byte ceiling, without altering any request or result.
   * @param operationId - Fresh confirmed retention identity.
   * @param signal - Confirmation lifetime, checked before exclusive publication.
   * @returns Immutable marker; the caller holds the shared admission lock and has rechecked source and permissions.
   */
  async archive(operationId: string, signal: AbortSignal) {
    if (this.collection !== 'side-analysis-v1' || !UUID.test(operationId)) throw Error('ANALYSIS_ACTION_REFUSED')
    signal.throwIfAborted()
    const receipt = { schemaVersion: 1, kind: 'side-analysis-archive', id: this.id, operationId, archivedAt: Date.now() }
    await this.publish('archive.json', receipt)
    return receipt
  }
  /** Drain the private persistence service without removing any retained input or record. */
  async close(): Promise<void> { await this.ctx.fiber.dispose() }
}
