/** Minimal pet state is a disposable read projection of committed official Session events. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent'
import { PetFeed } from './legacy/pet-state.mjs'
import { recoveryInitial, recoveryFold, recoveryView } from './legacy/task-recovery.mjs'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Project committed events and load an explicitly pinned historical Session on demand.
 * @param ctx - Optional pet plugin lifetime and official read owners.
 * @returns Minimal feed and cancellable on-demand loader; cold loads emit no reaction or notification.
 */
export function installPetFeed(ctx: Context) {
  const feed = new PetFeed(), states = new Map<string, ReturnType<typeof recoveryInitial>>()
  ctx.on('session/event', (session, event) => {
    try {
      const prior = states.get(session.id) ?? recoveryInitial(session.header)
      const state = recoveryFold(prior, event)
      states.delete(session.id); states.set(session.id, state)
      const oldest = states.keys().next().value
      if (states.size > 32 && oldest !== undefined) states.delete(oldest)
      feed.accept(session.id, recoveryView(state, ctx.agents.get(session.id) !== undefined), event.seq, { live: true, subagent: session.header.origin === 'subagent', event })
    } catch { /* The observer cannot change committed execution. */ }
  })
  const abort = new AbortController()
  const cold = (async () => {
    const records = (await ctx.sessionQuery.listSessions(abort.signal)).filter(r => r.header.origin !== 'subagent').sort((a, b) => b.header.createdAt - a.header.createdAt).slice(0, 32)
    for (const row of records) {
      if (states.has(row.header.id)) continue
      const observation = await ctx.sessionQuery.observeSession(row.header.id, { signal: abort.signal, projectionMode: 'none' })
      try {
        if (states.has(row.header.id)) continue
        const state = observation.events.reduce(recoveryFold, recoveryInitial(observation.header, observation.inheritedEventCount))
        states.set(row.header.id, state)
        feed.accept(row.header.id, recoveryView(state, ctx.agents.get(row.header.id) !== undefined), observation.events.at(-1)?.seq ?? 0)
      } finally { observation[Symbol.dispose]() }
    }
  })().catch(() => {})
  const pending = new Map<string, Promise<void>>()
  const ensure = (id: string, signal: AbortSignal = abort.signal): Promise<void> => {
    if (feed.snapshot().items.some(row => row.sessionId === id)) return Promise.resolve()
    const existing = pending.get(id)
    if (existing) return existing
    const work = (async () => {
      abort.signal.throwIfAborted()
      const observation = await ctx.sessionQuery.observeSession(SessionId(id), { signal: AbortSignal.any([abort.signal, signal]), projectionMode: 'none' })
      try {
        if (observation.header.origin === 'subagent') throw Error('PET_TARGET_CHANGED')
        if (feed.snapshot().items.some(row => row.sessionId === id)) return
        const state = observation.events.reduce(recoveryFold, recoveryInitial(observation.header, observation.inheritedEventCount))
        feed.accept(id, recoveryView(state, ctx.agents.get(SessionId(id)) !== undefined), observation.events.at(-1)?.seq ?? 0)
      } finally { observation[Symbol.dispose]() }
    })()
    pending.set(id, work)
    void work.finally(() => { pending.delete(id) }).catch(() => {})
    return work
  }
  ctx.effect(() => async () => { abort.abort(); await cold; await Promise.allSettled(pending.values()); states.clear() })
  return { snapshot: () => feed.snapshot(), ensure }
}
