/** Consumer protocol tests capture production JSONL identities and required request events. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { NotebookStore, NotebookV2Store, type NotebookV2, type NotebookBudgets, type NotebookStorageAdmission } from '../src/notebook.ts'
import { commitNotebookCompaction, readNotebookDurableEvents } from '../src/notebook-commit.ts'
import { selectNotebookEvidence } from '../src/notebook-evidence.ts'
import { installNotebookV2Compaction, notebookCandidate } from '../src/compaction.ts'

const id = SessionId('t04-commit')
const budgets: NotebookBudgets = { maxActiveEntries: 16, maxActiveBytes: 16384,
  maxEvidenceBytes: 8192, maxDeltaBytes: 4096, maxHistoryBytes: 131072 }
async function fixture(storageBudgets = budgets, admission?: NotebookStorageAdmission) {
  const home = await mkdtemp(join(tmpdir(), 't04-commit-')), ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
  const store = new NotebookV2Store(join(home, 'notes'), storageBudgets, admission)
  const policyController = new AbortController(), policy = { enabled: true, revision: 2, signal: policyController.signal }
  const session = Session.create(id), writer = await ctx.sessionPersistence.create(session.header)
  await writer.flush()
  const scope = { sessionId: id, generation: (await ctx.sessionPersistence.observeDurable(id)).generation }
  const empty = (): NotebookV2 => ({ schemaVersion: 2, scope, revision: 0, active: [],
    cursors: { evidenceThrough: -1, commitThrough: -1 }, historyRevision: 0 })
  let written = 0, closed = false
  onTestFinished(async () => {
    if (!closed) await writer.close()
    await store.close(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true })
  })
  const flush = async () => {
    const events = session.snapshotEvents()
    await writer.append(events.slice(written)); written = events.length; await writer.flush()
  }
  const build = (previous: NotebookV2, operations?: unknown[], suffix = '', variation = '') => {
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '真实原文中文证据 ' + suffix }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const sources = session.snapshotEvents(), source = sources.at(-1)!
    const plan = selectNotebookEvidence(previous, sources, policy.revision, storageBudgets)
    const compactionId = CompactionId('t04-operation-' + String(previous.revision) + suffix)
    session.append('compaction/start', { compactionId, turn: null })
    session.append('nidofy/notebook-compaction', { schemaVersion: 1, compactionId, kind: 'request', extraRequests: 0,
      input: JSON.stringify({ request: { messages: [{ role: 'user', content: [{ type: 'text', text: plan.instruction }] }] }, plan, appendix: '' }) })
    const delta = { schemaVersion: 2, scope, baseRevision: previous.revision, policyRevision: policy.revision,
      evidenceThrough: plan.evidenceThrough, operations: operations ?? [{ action: 'ADD', id: 'note-' + String(previous.revision),
        kind: 'next', text: '本轮待验证', seq: source.seq, quote: '真实原文中文证据' }] }
    const content = [{ type: 'text' as const, text: 'Continue. <nidofy-notebook-delta>' + (variation === 'invalid-candidate' ? '{}' : JSON.stringify(delta)) + '</nidofy-notebook-delta>' }]
    if (variation !== 'no-summary') {
      session.append('compaction/summary', { compactionId, summary: content, shadowedRange: { start: source.seq, end: source.seq },
        shadowedSeqs: [source.seq], shadowedTokenCount: 100, provider: 'fixture', model: 'fixture' })
      session.append('user/message', createUserMessage({ content, source: compactCheckpointSource(compactionId) }),
        { surfaceOp: { op: 'replace', startSeq: source.seq, endSeq: source.seq }, sourceEventSeqs: [source.seq] })
    }
    if (variation !== 'no-end') session.append('compaction/end', { compactionId, turn: null,
      ...variation === 'error-end' ? { error: 'fixture failure' } : {} })
    if (variation === 'duplicate-end') session.append('compaction/end', { compactionId, turn: null })
    return { plan, compactionId }
  }
  const commit = (captured: ReturnType<typeof build>, signal = new AbortController().signal) =>
    commitNotebookCompaction(ctx, store, captured.plan, captured.compactionId, () => policy, signal)
  return { home, ctx, store, session, writer, policy, policyController, build, flush, commit, scope, empty,
    closeWriter: async () => { await writer.close(); closed = true } }
}

it('atomically publishes three ordered rounds and deduplicates the same pair after reopening the v2 store', async () => {
  const f = await fixture(); let state = f.empty(), last: ReturnType<typeof f.build> | undefined
  for (let cycle = 0; cycle < 3; cycle++) {
    last = f.build(state, undefined, String(cycle)); await f.flush()
    const result = await f.commit(last)
    expect(result?.revision).toBe(cycle + 1)
    expect(result?.cursors.evidenceThrough).toBe(last.plan.evidenceThrough)
    expect(result?.cursors.commitThrough).toBe(f.session.snapshotEvents().at(-1)?.seq)
    state = result!
  }
  expect(state.active).toHaveLength(3)
  const cold = new NotebookV2Store(join(f.home, 'notes'), budgets)
  expect(await cold.readActive(f.scope)).toMatchObject({ revision: 3, entries: state.active })
  expect(await commitNotebookCompaction(f.ctx, cold, last!.plan, last!.compactionId,
    () => f.policy, new AbortController().signal)).toBeNull()
  expect((await cold.readActive(f.scope)).revision).toBe(3)
  await cold.close()
})
it.each(['no-summary', 'no-end', 'error-end', 'duplicate-end', 'invalid-candidate'])('does not publish an abnormal %s sequence', async (variation) => {
  const f = await fixture(), captured = f.build(f.empty(), undefined, '', variation); await f.flush()
  if (variation === 'no-summary' || variation === 'duplicate-end') await expect(f.commit(captured)).rejects.toThrow('stored log is corrupt')
  else expect(await f.commit(captured)).toBeNull()
  expect((await f.store.readActive(f.scope)).revision).toBe(0)
})
it('aborts a settings change during actual v2 disk admission without publishing either cursor', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const f = await fixture(budgets, { admit: async () => { entered.resolve(undefined); await release.promise } })
  const captured = f.build(f.empty()); await f.flush()
  const publishing = f.commit(captured), rejected = expect(publishing).rejects.toThrow()
  await entered.promise
  f.policy.enabled = false; f.policy.revision++; f.policyController.abort(); release.resolve(undefined)
  await rejected
  expect((await f.store.readActive(f.scope)).revision).toBe(0)
})
it('lets only one of two candidates against the same base win CAS, without advancing the loser', async () => {
  const f = await fixture(), a = f.build(f.empty(), undefined, 'a'), b = f.build(f.empty(), undefined, 'b'); await f.flush()
  const results = await Promise.all([f.commit(a), f.commit(b)])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect((await f.store.readActive(f.scope)).revision).toBe(1)
  const winner = results[0] ? a : b
  expect(results.find(Boolean)?.cursors.commitThrough).toBe(f.session.snapshotEvents().find(event => event.type === 'compaction/end' && event.data.compactionId === winner.compactionId)?.seq)
})
it('keeps cancellation, a policy revision change and disk refusal from publishing either cursor', async () => {
  const f = await fixture({ ...budgets, maxHistoryBytes: 1 }), captured = f.build(f.empty()); await f.flush()
  const cancelled = new AbortController(); cancelled.abort()
  await expect(f.commit(captured, cancelled.signal)).rejects.toThrow()
  f.policy.revision++
  expect(await f.commit(captured)).toBeNull()
  f.policy.revision--
  await expect(f.commit(captured)).rejects.toThrow('NOTEBOOK_HISTORY_BUDGET_EXCEEDED')
  expect((await f.store.readActive(f.scope)).revision).toBe(0)
})
it('recovers an unpublished durable pair through a fresh official provider with no live Session', async () => {
  const f = await fixture(), captured = f.build(f.empty()); await f.flush(); await f.closeWriter(); await f.ctx.fiber.dispose()
  const coldContext = new Context(); await mountAgentLoopTestDependencies(coldContext)
  await coldContext.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions') })
  onTestFinished(() => coldContext.fiber.dispose())
  const cold = new NotebookV2Store(join(f.home, 'notes'), budgets)
  const restored = await commitNotebookCompaction(coldContext, cold, captured.plan, captured.compactionId,
    () => f.policy, new AbortController().signal)
  expect(restored?.revision).toBe(1)
  expect((await cold.readActive(f.scope)).entries).toHaveLength(1)
  expect(await commitNotebookCompaction(coldContext, cold, captured.plan, captured.compactionId,
    () => f.policy, new AbortController().signal)).toBeNull()
  await cold.close()
})
it('deduplicates legacy published candidates by migrated revision identity, not the reset evidence watermark', async () => {
  const f = await fixture(), captured = f.build(f.empty()); await f.flush()
  const legacy = new NotebookStore(join(f.home, 'notes'), { maxEntries: 16, maxBytes: 16384 })
  const originals = f.session.snapshotEvents()
  await legacy.update(id, { baseRevision: 0, sourceThrough: 0, operations: [{ action: 'ADD', id: 'legacy', kind: 'next',
    text: 'legacy committed note', seq: 0, quote: '真实原文中文证据' }] }, originals, 'user')
  await legacy.close()
  expect((await f.store.readActive(f.scope)).revision).toBe(1)
  expect(await f.commit(captured)).toBeNull()
  expect((await f.store.readActive(f.scope)).entries.map(note => note.id)).toEqual(['legacy'])
})
it('loads the registered required schema and refuses a build missing that schema or a persistence provider', async () => {
  const f = await fixture()
  expect(KNOWN_SESSION_EVENT_TYPES.has('nidofy/notebook-compaction')).toBe(true)
  const has = vi.spyOn(KNOWN_SESSION_EVENT_TYPES, 'has').mockReturnValue(false)
  try {
    expect(() => installNotebookV2Compaction(f.ctx, f.store, async () => f.empty(), () => f.policy)).toThrow('NOTEBOOK_LOG_SCHEMA_REQUIRED')
  } finally { has.mockRestore() }
  expect(installNotebookV2Compaction(f.ctx, f.store, (_, signal) => f.store.readCommitted(f.scope, signal), () => f.policy)).toBeTypeOf('function')
  const bare = new Context(); await mountAgentLoopTestDependencies(bare); onTestFinished(() => bare.fiber.dispose())
  await expect(readNotebookDurableEvents(bare, id, new AbortController().signal)).rejects.toThrow('NOTEBOOK_PERSISTENCE_REQUIRED')
})
it('counts raw whitespace in the output tag and refuses malformed or repeated tags', () => {
  expect(() => notebookCandidate('<nidofy-notebook-delta>' + ' '.repeat(1000) + '{} </nidofy-notebook-delta>', 100)).toThrow('NOTEBOOK_DELTA_BUDGET_EXCEEDED')
  for (const text of ['<nidofy-notebook-delta>{}', '<nidofy-notebook-delta>{}</nidofy-notebook-delta></nidofy-notebook-delta>', '<nidofy-notebook-delta>{}</nidofy-notebook-delta><nidofy-notebook-delta>{}</nidofy-notebook-delta>']) {
    expect(() => notebookCandidate(text)).toThrow('NOTEBOOK_INVALID_CANDIDATE')
  }
  expect(notebookCandidate('no delta')).toBeUndefined()
})

it('keeps a cold generation exclusively selected throughout storage admission', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const f = await fixture(budgets, { admit: async () => { entered.resolve(undefined); await release.promise } })
  const captured = f.build(f.empty()); await f.flush(); await f.closeWriter()
  const other = new Context(); await mountAgentLoopTestDependencies(other)
  await other.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions') })
  onTestFinished(() => other.fiber.dispose())
  const publication = f.commit(captured)
  await entered.promise
  await expect(other.sessionPersistence.open(id, 'write')).rejects.toThrow('already')
  release.resolve(undefined)
  expect((await publication)?.revision).toBe(1)
  const writer = await other.sessionPersistence.open(id, 'write'); await writer.close()
  expect((await other.sessionPersistence.observeDurable(id)).generation).toBe(f.scope.generation)
})

it('refuses a candidate after restoring identical events into a different physical generation', async () => {
  const f = await fixture(), captured = f.build(f.empty()); await f.flush(); await f.closeWriter()
  const restoredRoot = join(f.home, 'restored')
  await cp(join(f.home, 'sessions'), restoredRoot, { recursive: true })
  const restored = new Context(); await mountAgentLoopTestDependencies(restored)
  await restored.plugin(JsonlSessionPersistence, { root: restoredRoot })
  onTestFinished(() => restored.fiber.dispose())
  const observation = await restored.sessionPersistence.observeDurable(id)
  expect(observation.events).toEqual(f.session.snapshotEvents())
  expect(observation.generation).not.toBe(f.scope.generation)
  expect(await commitNotebookCompaction(restored, f.store, captured.plan, captured.compactionId,
    () => f.policy, new AbortController().signal)).toBeNull()
  expect((await f.store.readCommitted(f.scope)).cursors).toEqual({ evidenceThrough: -1, commitThrough: -1 })
})

it('protects and cancels legacy conversion triggered by candidate settlement during admission', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const f = await fixture(budgets, { admit: async () => { entered.resolve(undefined); await release.promise } })
  const captured = f.build(f.empty()); await f.flush(); await f.closeWriter()
  const legacy = new NotebookStore(join(f.home, 'notes'), { maxEntries: 16, maxBytes: 16384 })
  await legacy.update(id, { baseRevision: 0, sourceThrough: 0, operations: [{ action: 'ADD', id: 'legacy', kind: 'next',
    text: 'preserved source', seq: 0, quote: '真实原文中文证据' }] }, f.session.snapshotEvents(), 'user')
  await legacy.close()
  const directory = join(f.home, 'notes', createHash('sha256').update(id).digest('hex'))
  const original = await readFile(join(directory, 'current.json'))
  const other = new Context(); await mountAgentLoopTestDependencies(other)
  await other.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions') })
  onTestFinished(() => other.fiber.dispose())
  const publication = f.commit(captured), rejected = expect(publication).rejects.toThrow()
  await entered.promise
  await expect(other.sessionPersistence.open(id, 'write')).rejects.toThrow('already')
  f.policyController.abort(); release.resolve(undefined); await rejected
  await expect(readFile(join(directory, 'v2', 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(directory, 'current.json'))).toEqual(original)
})

it('rechecks policy after admission even if its owner failed to abort the old signal', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const f = await fixture(budgets, { admit: async () => { entered.resolve(undefined); await release.promise } })
  const captured = f.build(f.empty()); await f.flush()
  const publication = f.commit(captured), rejected = expect(publication).rejects.toThrow('NOTEBOOK_POLICY_CONFLICT')
  await entered.promise; f.policy.revision++; release.resolve(undefined); await rejected
  expect((await f.store.readCommitted(f.scope)).cursors).toEqual({ evidenceThrough: -1, commitThrough: -1 })
})

it('returns the committed Notebook even when its post-commit diagnostic sink throws', async () => {
  const f = await fixture(), captured = f.build(f.empty()); await f.flush()
  const log = vi.spyOn(f.ctx.logger, 'info').mockImplementation(() => { throw Error('SYNTHETIC_LOG_FAILURE') })
  try { expect((await f.commit(captured))?.revision).toBe(1) } finally { log.mockRestore() }
  expect((await f.store.readCommitted(f.scope)).revision).toBe(1)
})
