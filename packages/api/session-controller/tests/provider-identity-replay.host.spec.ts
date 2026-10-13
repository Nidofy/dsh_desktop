/** A stable provider identity survives production JSONL serialization and cold projection replay. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { installModelSelectionProjection } from '../src/model-selection-projection.ts'

it.each([true, false])('replays provider identity presence=%s without consulting live routes', async (identity) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-identity-')), contexts: Context[] = []
  onTestFinished(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const first = new Context(); contexts.push(first)
  await first.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const session = Session.create(SessionId('identity-roundtrip'))
  const selected = { provider: 'managed/connection', model: 'model', reasoningEffort: ReasoningEffortId('high') }
  session.append('model/selection', selected)
  session.append('turn/start', { turn: 1 })
  session.append('request/header', { header: { config: { ...selected, provider: 'managed/revision-A',
    ...(identity ? { providerIdentity: selected.provider } : {}) } }, reason: 'initial' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const writer = await first.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents()); await writer.close(); await first.fiber.dispose()
  const cold = new Context(); contexts.push(cold)
  await cold.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await cold.plugin(SessionProjectionRegistry)
  installModelSelectionProjection(cold)
  const stored = await cold.sessionPersistence.observeDurable(session.id)
  const replay = Session.fromRestore(session.id, stored.events, stored.meta, stored.inheritedEventCount, 'shared-frozen')
  const header = replay.snapshotEvents().find(event => event.type === 'request/header')!
  expect(header.data.header.config.provider).toBe('managed/revision-A')
  expect(header.data.header.config.providerIdentity).toBe(identity ? selected.provider : undefined)
  expect(cold.sessionProjections.snapshot(replay).values.modelSelection).toEqual({
    lastUsed: { ...selected, provider: identity ? selected.provider : 'managed/revision-A' }, next: selected,
  })
  expect(cold.get('llm')).toBeUndefined()
})
