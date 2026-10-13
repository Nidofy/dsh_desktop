/** Actual Agent streams are held behind official durable reconstruction and a same-generation committed input cut. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionDurableObservation } from '@deepseek-ai/dsh-session-persistence'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import { AssistantStreamAccumulator, isAgentLoopRequest, type GenerateOptions, type StreamChunk,
  type TokenUsage } from '@deepseek-ai/dsh-llm'
import { reportedResponseModel, managedRequestObservation, withManagedRequestObservation } from '../connections/request-observations.ts'
import type { EngineeringBudgetOwner } from './engineering-budget.ts'
import type { DesktopCacheInput } from '@nidofy/dsh-desktop-extras/cache'
import type { EngineeringResourceOwner } from './engineering-resources.ts'

/** Request-local actual input and stream metadata; a prepared cut alone does not attest completed invocation. */
export interface EngineeringInputCut {
  schemaVersion: 1
  kind: 'engineering-input-cut'
  sessionId: SessionId
  generation: SessionDurableObservation['generation']
  through: number
  turn: number
  step: number
  input: Omit<GenerateOptions, 'signal'>
}

/** Capture complete input from the actual official Agent request before adapter/wire projection.
 * @param ctx - Actual supported profile with official Session writer and registered message projections.
 * @param agent - Independently owned engineering Agent; unrelated/nested requests refuse.
 * @param options - Exact immutable request passed by its registration-bound prepared call.
 * @param next - Existing stream delegate, invoked only after full input publication and authorization.
 * @param budget - Independent engineering budget controller.
 * @param authorize - Live connection, policy, workspace and tool-permission revalidation.
 * @param publish - Exclusive quota-managed sidecar publication; failure never enters the provider stream.
 * @param resources - Independent Session limits, with physical metadata refusal before the official durable read.
 * @param cache - Optional confirmed actual Desktop preference; only the applied callback can attest its execution.
 * @returns Bounded original stream chunks; the whole stream drains under its physical generation before delivery.
 */
export async function captureEngineeringRequest(ctx: Context, agent: Agent, options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>, budget: EngineeringBudgetOwner, authorize: () => Promise<void>,
  publish: (kind: 'input' | 'observation', value: object) => Promise<void>, resources: EngineeringResourceOwner,
  cache?: DesktopCacheInput): Promise<StreamChunk[]> {
  if (!isAgentLoopRequest(options) || options.sessionId !== agent.session.id || options.maxTokens !== budget.budget.outputTokensPerRequest
    || !options.signal || !Object.isFrozen(options)) throw Error('EXPERIMENT_ENGINEERING_REQUEST_REFUSED')
  const signal = options.signal, persistence = ctx.get('sessionPersistence'), sessions = ctx.get('sessions')
  if (!persistence || !sessions) throw Error('EXPERIMENT_ENGINEERING_INPUT_OWNER_UNAVAILABLE')
  const projections = sessions.messageProjections
  await authorize(); signal.throwIfAborted(); budget.checkDispatch()
  if (!await sessions.flush(agent.session)) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
  const durable = await resources.observe(persistence, agent.session.id, 'request', signal)
  if (durable.meta.id !== agent.session.id || durable.inheritedEventCount !== 0 || durable.durableThrough !== agent.session.seq - 1
    || durable.events.length > 4096 || Buffer.byteLength(JSON.stringify(durable)) > 2 * 1024 * 1024) {
    throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
  }
  const cold = Session.create(durable.meta.id, durable.events, durable.meta, durable.inheritedEventCount, projections)
  const header = cold.requestHeader(), start = durable.events.findLast(event => event.type === 'step/start')
  if (!header || start?.type !== 'step/start' || start.data.turn !== 1) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
  const input = { ...header.config, messages: cold.deriveMessages(), toolHistory: cold.toolHistory(),
    ...header.tools ? { tools: header.tools } : {}, sessionId: cold.id }
  const { signal: _signal, ...actual } = options
  if (JSON.stringify(actual) !== JSON.stringify(input) || Buffer.byteLength(JSON.stringify(input)) > 128 * 1024) {
    throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
  }
  const cut: EngineeringInputCut = { schemaVersion: 1, kind: 'engineering-input-cut', sessionId: cold.id,
    generation: durable.generation, through: durable.durableThrough, turn: start.data.turn, step: start.data.step, input }
  return persistence.withGeneration(cold.id, durable.generation, async () => {
    resources.session(durable, await persistence.stat(cold.id, { signal }), 'request')
    if (ctx.get('sessionPersistence')?.identity !== persistence.identity) throw Error('EXPERIMENT_ENGINEERING_PERSISTENCE_CHANGED')
    if (ctx.get('sessions')?.messageProjections !== projections) throw Error('EXPERIMENT_ENGINEERING_PROJECTIONS_CHANGED')
    if (agent.session.seq !== durable.durableThrough + 1) throw Error('EXPERIMENT_ENGINEERING_PREFIX_CHANGED')
    await publish('input', cut)
    await authorize(); signal.throwIfAborted(); budget.dispatch()
    const capture = managedRequestObservation(), accumulator = new AssistantStreamAccumulator(), chunks: StreamChunk[] = []
    let finish: Extract<StreamChunk, { type: 'finish' }> | undefined, usage: TokenUsage | null = null, completed = false
    try {
      await withManagedRequestObservation(capture, async () => {
        for await (const chunk of next()) {
          signal.throwIfAborted()
          if (finish || chunks.length >= 2048) throw Error('EXPERIMENT_ENGINEERING_STREAM_INVALID')
          accumulator.push({ time: Date.now(), chunk })
          if (Buffer.byteLength(JSON.stringify(accumulator.snapshot())) > 24 * 1024) throw Error('EXPERIMENT_ENGINEERING_STREAM_LIMIT')
          chunks.push(chunk)
          if (chunk.type === 'usage') usage = chunk.usage
          if (chunk.type === 'finish') finish = chunk
        }
      })
      completed = finish?.reason.kind === 'stop' || finish?.reason.kind === 'tool-calls'
      if (!finish) throw Error('EXPERIMENT_ENGINEERING_STREAM_INVALID')
      capture.response = reportedResponseModel(finish, options.model, options.provider)
      if (cache && (!capture.cache || !capture.cache.applied || capture.cache.preferenceRevision !== cache.preferenceRevision
        || JSON.stringify(capture.cache.policy) !== JSON.stringify(cache.policy))) budget.stop('EXPERIMENT_CACHE_INPUT_UNCONFIRMED')
    } finally {
      budget.settle(usage, completed)
      await publish('observation', { schemaVersion: 1, kind: 'engineering-request-observation', sessionId: cold.id,
        through: cut.through, invoked: true, complete: completed, usage, observation: capture })
    }
    return chunks
  }, { signal })
}
