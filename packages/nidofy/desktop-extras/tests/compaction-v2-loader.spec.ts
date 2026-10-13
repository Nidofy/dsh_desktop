/** V2 product regression through a real Loader, AgentLoop and durable JSONL provider. */
import { expect, it, onTestFinished } from 'vitest'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { NotebookV2Store } from '../src/notebook.ts'
import { createNotebookFixture as fixture } from './notebook-loader-fixture.ts'

const budgets = { maxActiveEntries: 64, maxActiveBytes: 16384, maxDeltaBytes: 4096, maxEvidenceBytes: 16384, maxHistoryBytes: 1048576 }

it('retains the actual writer and official marker pairs across three Loader compactions and a cold reopen', async () => {
  const f = await fixture()
  expect(await f.ctx.sessions.flush(f.agent.session)).toBe(true)
  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle) await f.turn('新增原文证据。 ' + ('round ' + String(cycle) + ' ').repeat(180))
    expect(await f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).not.toBeNull()
    expect((await f.status()).revision).toBe(cycle + 1)
  }
  const storedNotes = await f.status()
  await f.dispose()
  const cold = new Context(); await mountAgentLoopTestDependencies(cold)
  await cold.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions') })
  onTestFinished(() => cold.fiber.dispose())
  const reader = await cold.sessionPersistence.open(f.agent.session.id, 'read')
  const raw = await reader.read(); await reader.close()
  expect(raw.events.filter(event => event.type === 'compaction/summary')).toHaveLength(3)
  expect(raw.events.filter(event => event.type === 'compaction/end' && event.data.error === undefined)).toHaveLength(3)
  const { NotebookV2Store } = await import('../src/notebook.ts')
  const notes = new NotebookV2Store(join(f.home, 'notes'), budgets)
  const observed = await cold.sessionPersistence.observeDurable(f.agent.session.id)
  expect(observed.generation).toBe(storedNotes.scope.generation)
  expect(await notes.readCommitted({ sessionId: f.agent.session.id, generation: observed.generation })).toEqual(storedNotes)
  await notes.close()
})
it('does not make a hidden retry or publish when the actual model request fails', async () => {
  const f = await fixture(); f.model.fail = true
  await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toThrow()
  expect(f.model.requests.filter(request => request.purpose === 'compaction')).toHaveLength(1)
  expect((await f.status()).revision).toBe(0)
})
it('keeps publication at zero throughout a repeated flush refusal window', async () => {
  const f = await fixture(); let failing = false
  f.model.beforeCompaction = async () => { failing = true }
  f.ctx.on('session/flush', () => { if (failing) throw Error('t04-flush-refused') })
  await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toThrow()
  expect((await new NotebookV2Store(join(f.home, 'notes'), budgets).readCommitted({ sessionId: f.agent.session.id, generation: (await f.ctx.sessionPersistence.observeDurable(f.agent.session.id)).generation })).revision).toBe(0)
  for (let attempt = 0; attempt < 2; attempt++) await expect(f.synchronize()).rejects.toThrow('t04-flush-refused')
  expect((await f.status()).revision).toBe(0)
  expect((await new NotebookV2Store(join(f.home, 'notes'), budgets).readCommitted({ sessionId: f.agent.session.id, generation: (await f.ctx.sessionPersistence.observeDurable(f.agent.session.id)).generation })).revision).toBe(0)
  failing = false
  await f.synchronize()
  expect((await f.status()).revision).toBe(1)
  expect((await f.status()).revision).toBe(1)
})
it('cancels while an actual enhanced request is pending and leaves notes unpublished', async () => {
  const f = await fixture(), controller = new AbortController(), entered = Promise.withResolvers<undefined>()
  f.model.beforeCompaction = options => new Promise<void>((_resolve, reject) => {
    entered.resolve(undefined)
    options.signal!.addEventListener('abort', () =>{  reject(Error('t04-cancelled')) }, { once: true })
  })
  const request = f.ctx.compaction.compactNow(f.agent, controller.signal), rejected = expect(request).rejects.toThrow()
  await entered.promise; controller.abort(); await rejected
  expect((await f.status()).revision).toBe(0)
})
it('discards a late model candidate after a settings revision changes', async () => {
  const f = await fixture(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  f.model.beforeCompaction = async () => { entered.resolve(undefined); await release.promise }
  const request = f.ctx.compaction.compactNow(f.agent, new AbortController().signal)
  await entered.promise; f.policy.enabled = false; f.policy.revision++; release.resolve(undefined)
  expect(await request).not.toBeNull()
  expect((await f.status()).revision).toBe(0)
})
it('uses one explicit bounded invalid-output fallback through the same official engine', async () => {
  const f = await fixture(); f.model.malformed = true
  expect(await f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).not.toBeNull()
  expect(f.model.requests.filter(request => request.purpose === 'compaction')).toHaveLength(2)
  expect((await f.status()).revision).toBe(0)
})
