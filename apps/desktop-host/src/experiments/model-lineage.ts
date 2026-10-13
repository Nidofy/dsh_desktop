/** Exact logged tool results associate a retained run with its selecting step, never with whole-task billing. */
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent, type SessionMessageProjection, type SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionDurableObservation } from '@deepseek-ai/dsh-session-persistence'
import { expandAssistantStream, type GenerateOptions, type TokenUsage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { realpath } from 'node:fs/promises'
import type { ReceiptSelection } from './comparison.ts'
import type { VerificationOwner, VerificationView } from '../workbench/verification.ts'
import { reportedResponseModel, type ManagedRequestObservation } from '../connections/request-observations.ts'

type Settlement = Extract<SessionEvent, { type: 'assistant/message' | 'assistant/attempt' }>
type Metric = { value: number | null; missingAttempts: number }
/** Private logged evidence for the step that requested one run; its counts do not cover a complete user task. */
export interface ModelStepLineage {
  status: 'LINKED' | 'UNKNOWN'
  diagnostic: string | null
  selection: ReceiptSelection
  sessionId: SessionId | null
  generation: SessionDurableObservation['generation'] | null
  durableThrough: number | null
  link: { turn: number; step: number; callId: ToolCallId; callSeq: SessionSeq; resultSeq: SessionSeq } | null
  attempts: {
    settlementSeq: SessionSeq
    kind: Settlement['type']
    loggedPrefixThrough: number
    loggedInput: Omit<GenerateOptions, 'signal'>
    dispatchInput: null
    usage: TokenUsage | null
    responseModel: ManagedRequestObservation['response']
  }[]
  counts: { requests: null; settledAttempts: number | null; inputTokens: Metric; outputTokens: Metric; cacheReadTokens: Metric }
  exactModelVersion: null
  factors: { notebook: 'UNKNOWN'; cache: 'UNKNOWN' }
  taskTotals: null
  efficiencyEligible: false
}
function unknown(selection: ReceiptSelection, diagnostic: string): ModelStepLineage {
  const missing = (): Metric => ({ value: null, missingAttempts: 0 })
  return { status: 'UNKNOWN', diagnostic, selection, sessionId: null, generation: null, durableThrough: null, link: null,
    attempts: [], counts: { requests: null, settledAttempts: null, inputTokens: missing(), outputTokens: missing(),
      cacheReadTokens: missing() },
    exactModelVersion: null, factors: { notebook: 'UNKNOWN', cache: 'UNKNOWN' }, taskTotals: null, efficiencyEligible: false }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function sum(attempts: ModelStepLineage['attempts'], key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens'): Metric {
  let total = 0, missingAttempts = 0
  for (const attempt of attempts) {
    const value = attempt.usage?.[key]
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) missingAttempts++
    else { total += value; if (!Number.isSafeInteger(total)) missingAttempts++ }
  }
  return { value: missingAttempts || attempts.length === 0 ? null : total, missingAttempts }
}
/** Read an exact run-producing tool result and reconstruct complete logged prefixes with official Session projections.
 * @param selection - Canonical workspace and real retained run.
 * @param view - Current T11 inspection; no caller-provided counters are accepted.
 * @param durable - Official raw durable observation, without query repair.
 * @param projections - Actual registered pure message interpreters, required for plugin-owned history.
 * @returns Step-wide settled usage, logged prefixes and official response identifiers. Dispatch cuts, versions and factors stay unknown.
 */
export function modelStepLineage(selection: ReceiptSelection, view: VerificationView, durable: SessionDurableObservation,
  projections: readonly SessionMessageProjection[]): ModelStepLineage {
  const receipt = view.receipt
  if (view.phase !== 'COMMITTED' || !receipt || receipt.runId !== selection.runId) return unknown(selection, 'EXPERIMENT_RECEIPT_UNCONFIRMED')
  if (durable.events.length > 4096 || Buffer.byteLength(JSON.stringify(durable)) > 2 * 1024 * 1024) throw Error('EXPERIMENT_MODEL_SCAN_LIMIT')
  if (durable.durableThrough !== durable.events.length - 1) throw Error('EXPERIMENT_MODEL_PREFIX_INVALID')
  const links: NonNullable<ModelStepLineage['link']>[] = []
  for (const event of durable.events) {
    if (event.seq < durable.inheritedEventCount || event.type !== 'tool/result' || event.data.message.isError) continue
    const content = event.data.message.content
    if (content.length !== 1 || content[0]?.type !== 'text') continue
    let result: Record<string, unknown> | null
    try { result = record(JSON.parse(content[0].text)) } catch (_error) { continue }
    if (!result || result.id !== selection.runId) continue
    const verification = record(result.verification), original = record(verification?.receipt)
    if (verification?.phase !== 'COMMITTED' || original?.id !== receipt.id || original.runId !== receipt.runId
      || original.completedAt !== receipt.completedAt || JSON.stringify(original.command) !== JSON.stringify(receipt.command)) continue
    const calls = durable.events.filter(call => call.seq >= durable.inheritedEventCount && call.seq < event.seq
      && call.type === 'tool/call' && call.data.callId === event.data.message.toolCallId)
    if (calls.length !== 1) continue
    const call = calls[0]
    if (!call || call.type !== 'tool/call' || call.data.name !== 'run_project_action'
      || call.data.turn !== event.data.turn || call.data.step !== event.data.step) continue
    let args: Record<string, unknown> | null
    try { args = record(JSON.parse(call.data.arguments)) } catch (_error) { continue }
    if (args?.id !== receipt.command.actionId) continue
    links.push({ turn: call.data.turn, step: call.data.step, callId: call.data.callId, callSeq: call.seq, resultSeq: event.seq })
  }
  if (links.length !== 1) return unknown(selection, links.length ? 'EXPERIMENT_MODEL_LINK_AMBIGUOUS' : 'EXPERIMENT_MODEL_LINK_MISSING')
  const link = links[0]
  if (!link) throw Error('EXPERIMENT_MODEL_LINK_MISSING')
  const starts = durable.events.filter(event => event.seq >= durable.inheritedEventCount && event.seq < link.callSeq
    && event.type === 'step/start' && event.data.turn === link.turn && event.data.step === link.step)
  if (starts.length !== 1) return unknown(selection, 'EXPERIMENT_MODEL_STEP_UNCONFIRMED')
  const start = starts[0]
  if (!start) throw Error('EXPERIMENT_MODEL_STEP_UNCONFIRMED')
  const settlements = durable.events.filter((event): event is Settlement => event.seq > start.seq && event.seq < link.callSeq
    && (event.type === 'assistant/message' || event.type === 'assistant/attempt')
    && event.data.turn === link.turn && event.data.step === link.step)
  if (settlements.length === 0) return unknown(selection, 'EXPERIMENT_MODEL_SETTLEMENT_MISSING')
  const attempts = settlements.map((event): ModelStepLineage['attempts'][number] => {
    const prefix = durable.events.slice(0, event.seq)
    const session = Session.create(durable.meta.id, prefix, durable.meta, durable.inheritedEventCount, projections)
    const header = session.requestHeader()
    if (!header) throw Error('EXPERIMENT_MODEL_HEADER_MISSING')
    const chunks = expandAssistantStream(event.data.stream)
    const usages = chunks.filter(row => row.chunk.type === 'usage')
    const last = usages.at(-1)
    const usage = last?.chunk.type === 'usage' ? last.chunk.usage : null
    const finish = chunks.at(-1)?.chunk
    if (event.type === 'assistant/message' && JSON.stringify(event.data.usage ?? null) !== JSON.stringify(usage)) {
      throw Error('EXPERIMENT_MODEL_USAGE_CONFLICT')
    }
    return { settlementSeq: event.seq, kind: event.type, loggedPrefixThrough: event.seq - 1,
      loggedInput: { ...header.config, messages: session.deriveMessages(), toolHistory: session.toolHistory(),
        ...header.tools ? { tools: header.tools } : {}, sessionId: session.id }, dispatchInput: null, usage,
      responseModel: reportedResponseModel(finish?.type === 'finish' ? finish : undefined, header.config.model, header.config.provider) }
  })
  const result: ModelStepLineage = { ...unknown(selection, ''), status: 'LINKED', diagnostic: 'EXPERIMENT_DISPATCH_CUT_UNOBSERVED',
    sessionId: durable.meta.id, generation: durable.generation, durableThrough: durable.durableThrough, link, attempts,
    counts: { requests: null, settledAttempts: attempts.length, inputTokens: sum(attempts, 'inputTokens'),
      outputTokens: sum(attempts, 'outputTokens'), cacheReadTokens: sum(attempts, 'cacheReadTokens') } }
  if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw Error('EXPERIMENT_MODEL_RESULT_LIMIT')
  return result
}

/** Read-only authenticated consumer; original T11 scope restricts the Session, exact tool output establishes the step. */
export class TaskModelLineageOwner {
  constructor(private readonly ctx: Context, private readonly verification: Pick<VerificationOwner, 'inspect' | 'executionSource'>) {}
  /** Observe one selected committed run without flushing, allocating a Session, preparing a call or sending work.
   * @param selection - Existing local receipt selection.
   * @param signal - T20 lifetime; unloading drains this official read before T11 closes.
   * @returns Bounded private step evidence, or UNKNOWN when the source does not establish an exact association.
   */
  async read(selection: ReceiptSelection, signal: AbortSignal): Promise<ModelStepLineage> {
    signal.throwIfAborted()
    const source = await this.verification.executionSource(selection.workspace, selection.runId)
    if (!source || source.source !== 'agent' || !source.sessionId) return unknown(selection, 'EXPERIMENT_MODEL_SOURCE_UNAVAILABLE')
    const persistence = this.ctx.get('sessionPersistence'), sessions = this.ctx.get('sessions')
    if (!persistence || !sessions) return unknown(selection, 'EXPERIMENT_MODEL_OWNER_UNAVAILABLE')
    const projections = sessions.messageProjections
    const view = await this.verification.inspect(selection.workspace, selection.runId)
    const durable = await persistence.observeDurable(SessionId(source.sessionId), { signal })
    signal.throwIfAborted()
    if (durable.meta.id !== source.sessionId) throw Error('EXPERIMENT_MODEL_SESSION_MISMATCH')
    const workspaceKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
    if (!durable.meta.cwd || workspaceKey(await realpath(durable.meta.cwd)) !== workspaceKey(await realpath(selection.workspace))) {
      throw Error('EXPERIMENT_MODEL_WORKSPACE_MISMATCH')
    }
    return persistence.withGeneration(durable.meta.id, durable.generation, () => {
      signal.throwIfAborted()
      if (persistence.identity !== this.ctx.get('sessionPersistence')?.identity
        || projections !== this.ctx.get('sessions')?.messageProjections) throw Error('EXPERIMENT_MODEL_OWNER_CHANGED')
      return Promise.resolve(modelStepLineage(selection, view, durable, projections))
    }, { signal })
  }
}
