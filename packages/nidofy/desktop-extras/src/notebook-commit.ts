/** Notebook candidate settlement uses raw official persistence reads, never query-prepared synthetic endings. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionDurableObservation } from '@deepseek-ai/dsh-session-persistence'
import { NotebookV2Store, type NotebookV2 } from './notebook.ts'
import { selectNotebookEvidence, validateNotebookCandidate, type NotebookEvidencePlan } from './notebook-evidence.ts'
import { notebookCandidate } from './compaction.ts'
import { object } from './state.ts'

/** Captured settings lifetime; the settings owner MUST abort signal on every revision change. */
export interface NotebookCompactionPolicy { enabled: boolean; revision: number; signal: AbortSignal }

/** Read only a durability-acknowledged raw prefix of the official provider.
 * @param ctx - actual Sessions and session-persistence composition.
 * @param sessionId - exact owning Session id.
 * @param signal - operation and settings cancellation.
 * @returns contiguous stored events; false flush and missing providers fail closed.
 */
export async function readNotebookDurableEvents(ctx: Context, sessionId: string, signal: AbortSignal): Promise<readonly SessionEvent[]> {
  return (await readNotebookObservation(ctx, sessionId, signal)).events
}

/** Read events and physical identity in one durability-confirmed observation.
 * @param ctx - actual Sessions and persistence composition.
 * @param sessionId - owning Session id.
 * @param signal - operation cancellation.
 * @returns a contiguous raw prefix with its physical generation and durable cut.
 */
export async function readNotebookObservation(ctx: Context, sessionId: string, signal: AbortSignal): Promise<SessionDurableObservation> {
  signal.throwIfAborted()
  const id = SessionId(sessionId), persistence = ctx.get('sessionPersistence')
  if (!persistence) throw Error('NOTEBOOK_PERSISTENCE_REQUIRED')
  const live = ctx.sessions.get(id)
  if (live && !await ctx.sessions.flush(live)) throw Error('NOTEBOOK_PERSISTENCE_REQUIRED')
  signal.throwIfAborted()
  const result = await persistence.observeDurable(id, { signal })
  signal.throwIfAborted()
  if (result.durableThrough !== result.events.length - 1 || result.events.some((event, index) => event.seq !== index)) throw Error('NOTEBOOK_NONCONTIGUOUS_EVENTS')
  return result
}

/** Publish one enhanced candidate only after a unique official start/summary/replacement/successful-end sequence.
 * @param ctx - actual persistence owner; live flush errors are propagated without publishing.
 * @param store - v2 store owning the notebook namespace and CAS.
 * @param plan - captured actual committed snapshot and complete evidence selection.
 * @param compactionId - official operation id associated with the enhanced request.
 * @param policy - current settings with an abort signal covering changes during disk admission.
 * @param signal - cancellation covering flush, read, validation and notebook publication.
 * @returns committed state, or null for obsolete/invalid/missing terminal pairs; no rejected candidate advances cursors.
 */
export async function commitNotebookCompaction(ctx: Context, store: NotebookV2Store, plan: NotebookEvidencePlan,
  compactionId: SessionEvent<'compaction/start'>['data']['compactionId'], policy: () => NotebookCompactionPolicy, signal: AbortSignal): Promise<NotebookV2 | null> {
  const choice = { ...policy() }
  if (!choice.enabled || choice.revision !== plan.policyRevision || plan.outcome !== 'selected' || !plan.instruction) return null
  const combined = AbortSignal.any([signal, choice.signal])
  const persistence = ctx.get('sessionPersistence')
  if (!persistence) throw Error('NOTEBOOK_PERSISTENCE_REQUIRED')
  const observation = await readNotebookObservation(ctx, plan.previous.scope.sessionId, combined)
  if (observation.generation !== plan.previous.scope.generation) return null
  const events = observation.events
  const starts = events.filter(event => event.type === 'compaction/start' && event.data.compactionId === compactionId)
  const summaries = events.filter(event => event.type === 'compaction/summary' && event.data.compactionId === compactionId)
  const ends = events.filter(event => event.type === 'compaction/end' && event.data.compactionId === compactionId)
  const start = starts[0], summary = summaries[0], end = ends[0]
  if (starts.length !== 1 || summaries.length !== 1 || ends.length !== 1
    || start?.type !== 'compaction/start' || summary?.type !== 'compaction/summary' || end?.type !== 'compaction/end'
    || end.data.error !== undefined || start.seq >= summary.seq || end.seq !== summary.seq + 2
    || start.data.turn !== end.data.turn || start.data.sourceCommandId !== end.data.sourceCommandId
    || summary.data.sourceCommandId !== start.data.sourceCommandId) return null
  const replacement = events[summary.seq + 1]
  if (replacement?.type !== 'user/message' || replacement.data.source.kind !== 'compact-checkpoint'
    || replacement.data.source.compactionId !== compactionId
    || typeof replacement.surfaceOp !== 'object' || replacement.surfaceOp.startSeq !== summary.data.shadowedRange.start
    || replacement.surfaceOp.endSeq !== summary.data.shadowedRange.end) return null
  if (end.seq <= plan.previous.cursors.commitThrough) return null
  // Migration retains revision identity but restarts both watermarks: revision CAS, never legacySourceThrough, deduplicates old summaries.
  // The store checks revision CAS inside generation protection. Even a preliminary read
  // can trigger legacy conversion, so it must not publish outside that protection.
  let operations: readonly unknown[]
  try {
    const candidate = notebookCandidate(summary.data.summary.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'), store.budgets.maxDeltaBytes)
    if (candidate === undefined) return null
    // Re-select from durable originals; model output may not enlarge the examined prefix.
    const requestRecords = events.filter(event => event.type === 'nidofy/notebook-compaction' && event.data.compactionId === compactionId && event.data.kind === 'request')
    const record = requestRecords.at(-1)
    if (record?.type !== 'nidofy/notebook-compaction' || !record.data.input) return null
    const logged = object(JSON.parse(record.data.input)), loggedPlan = object(logged.plan)
    if (JSON.stringify(loggedPlan) !== JSON.stringify(plan)) return null
    const request = object(logged.request)
    if (!Array.isArray(request.messages)) return null
    const tail = object(request.messages.at(-1))
    if (tail.role !== 'user' || !Array.isArray(tail.content) || tail.content.length !== 1) return null
    const block = object(tail.content[0])
    if (block.type !== 'text' || typeof block.text !== 'string' || !block.text.endsWith(plan.instruction)) return null
    const sources = events.slice(0, start.seq)
    const reconstructed = selectNotebookEvidence(plan.previous, sources, plan.policyRevision, store.budgets, typeof logged.appendix === 'string' ? logged.appendix : '')
    if (JSON.stringify(reconstructed) !== JSON.stringify(plan)) return null
    operations = validateNotebookCandidate(candidate, plan, events, store.budgets)
  } catch (error) {
    ctx.logger.warn('Notebook invalid-fallback: ' + String(error))
    return null
  }
  combined.throwIfAborted()
  if (!policy().enabled || policy().revision !== choice.revision) return null
  try {
    const validatePublication = (): void => {
      combined.throwIfAborted()
      if (ctx.get('sessionPersistence')?.identity !== persistence.identity) throw Error('SESSION_GENERATION_CONFLICT')
      if (!policy().enabled || policy().revision !== choice.revision) throw Error('NOTEBOOK_POLICY_CONFLICT')
    }
    const committed = await persistence.withGeneration(SessionId(plan.previous.scope.sessionId), observation.generation, async () => {
      validatePublication()
      return store.publish(plan.previous.revision, plan.previous.scope,
        { operations, cursors: { evidenceThrough: plan.evidenceThrough, commitThrough: end.seq } }, events, 'model', combined, validatePublication)
    }, { signal: combined })
    try { ctx.logger.info('Notebook persisted; extraRequests=0') }
    catch (error) { /* A diagnostic sink failure cannot undo the selected Notebook revision. */ void error }
    return committed
  } catch (error) {
    if (error instanceof Error && (error.message === 'NOTEBOOK_REVISION_CONFLICT' || error.message === 'SESSION_GENERATION_CONFLICT')) return null
    throw error
  }
}
