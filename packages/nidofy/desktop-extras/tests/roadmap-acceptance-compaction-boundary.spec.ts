/** T25 independent acceptance: compaction commit-boundary behavior over a real Cordis/AgentLoop/Session composition.
 * The official JSONL session-persistence provider is mounted with an isolated root, so publication decisions are
 * read back from real durable state (review F1/F2). The model adapter is the only external stand-in. Requirement
 * gaps are recorded in migration/roadmap/handoffs/T25.md, not silently asserted as satisfied. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SqliteQuery from '@deepseek-ai/dsh-session-query-sqlite'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import NotebookCompaction, { installNotebookCompaction } from '../src/compaction.ts'
import { installContext } from '../src/context.ts'
import type { Notebook } from '../src/notebook.ts'

const SESSION = SessionId('t25-boundary')

class BoundaryModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  failCompaction = false
  override async resolveModel(provider: string, id: string) {
    return { provider, id, name: id, context: { contextWindow: 100000, maxOutputTokens: 4096 } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.failCompaction && options.purpose === 'compaction') throw Error('t25-synthetic-model-failure')
    const appendix = options.messages.flatMap(message => message.content).flatMap(block => block.type === 'text' && block.text.includes('Also include one <nidofy-notebook-delta>') ? [block.text] : [])[0]
    let answer = options.purpose === 'compaction' ? 'T25 boundary summary. Keep the official engine.' : 'Acknowledged.'
    if (appendix !== undefined) {
      const payload = JSON.parse(appendix.slice(appendix.lastIndexOf('\n') + 1)) as { previous: { revision: number }; sourceThrough: number; sources: { seq: number; excerpt: string }[] }
      const source = payload.sources.at(-1)
      if (source !== undefined) {
        answer += '<nidofy-notebook-delta>' + JSON.stringify({ baseRevision: payload.previous.revision, sourceThrough: payload.sourceThrough,
          operations: [{ action: 'ADD', id: 't25-boundary-' + String(payload.previous.revision), kind: 'next', text: 'T25 committed boundary note', seq: source.seq, quote: source.excerpt.slice(0, 20) }] }) + '</nidofy-notebook-delta>'
      }
    }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Mount the notebook stack plus the official durable persistence provider over one isolated home. */
async function mountNotebookStack(ctx: Context, home: string, maxBytes: number): Promise<ReturnType<typeof installContext>> {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(SqliteQuery, { path: join(home, 'search.sqlite'), openAt: 'first-search' })
  let api: ReturnType<typeof installContext> | undefined
  await ctx.plugin({ name: 't25-boundary-owner', inject: ['tools', 'sessionQuery', 'sessions', 'systemPrompt'], apply(child: Context) {
    api = installContext(child, join(home, 'notes'), { maxEntries: 64, maxBytes })
    installNotebookCompaction(child, () => ({ enabled: true, revision: 0 }))
  } })
  if (!api) throw Error('t25: context did not activate')
  return api
}

/** Live composition: real AgentLoop session adopted by an official durable write handle. */
async function liveComposition(home: string, maxBytes = 16384) {
  const ctx = new Context()
  const api = await mountNotebookStack(ctx, home, maxBytes)
  const model = new BoundaryModel()
  ctx.llm.registerAdapter(['test'], model)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(NotebookCompaction, { auto: false })
  const agent = await ctx.agentLoop.create(SESSION, { provider: 'test', model: 'test' })
  // With the persistence provider mounted, agentLoop.create already adopted the
  // durable write handle for this session; live events route into it.
  const turn = async (body: string) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await turn('T25 source sentence. Keep the official engine. ' + 'boundary evidence '.repeat(80))
  let disposed = false
  const dispose = async () => { if (!disposed) { disposed = true; await ctx.fiber.dispose() } }
  return { ctx, api, model, agent, turn, dispose }
}

/** Cold composition over the same roots: no live session, no compaction engine, durable log only. */
async function coldComposition(home: string) {
  const ctx = new Context()
  const api = await mountNotebookStack(ctx, home, 16384)
  let disposed = false
  return { ctx, api, dispose: async () => { if (!disposed) { disposed = true; await ctx.fiber.dispose() } } }
}

const status = async (api: ReturnType<typeof installContext>, id: ReturnType<typeof SessionId>) =>
  (await api('status', { sessionId: id }) as { notebook: Notebook }).notebook

async function untilRevision(api: ReturnType<typeof installContext>, id: ReturnType<typeof SessionId>, target: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const notebook = await status(api, id)
    if (notebook.revision === target) return notebook
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw Error('t25: notebook did not reach revision ' + String(target))
}

const revisionFiles = async (notesDirectory: string) => {
  let sessions: string[]
  try { sessions = await readdir(notesDirectory) }
  catch (error) {
    // An absent notes root means no revision was ever published.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of sessions) {
    files.push(...(await readdir(join(notesDirectory, entry))).filter(name => name.startsWith('revision-')))
  }
  return files
}

const isolatedHome = async (label: string) => {
  const home = await mkdtemp(join(tmpdir(), 't25-' + label + '-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  return home
}

it('publishes through a real durability checkpoint and never republishes on later synchronizations', async () => {
  const home = await isolatedHome('durable')
  const { ctx, api, agent, dispose } = await liveComposition(home)
  onTestFinished(dispose)
  expect(ctx.get('sessionPersistence')).toBeDefined()
  expect(await ctx.sessions.flush(agent.session)).toBe(true)
  expect(await ctx.compaction.compactNow(agent, new AbortController().signal)).not.toBeNull()
  const published = await untilRevision(api, agent.session.id, 1)
  expect(published.entries).toHaveLength(1)
  expect(published.entries[0]).toMatchObject({ id: 't25-boundary-0', text: 'T25 committed boundary note' })
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
  expect((await status(api, agent.session.id)).revision).toBe(1)
  expect((await status(api, agent.session.id)).revision).toBe(1)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
})

it('holds publication back while flush keeps failing, then publishes exactly once after healing', async () => {
  const home = await isolatedHome('flush-negative')
  const { ctx, api, agent, dispose } = await liveComposition(home)
  onTestFinished(dispose)
  let failing = true
  ctx.on('session/flush', () => {
    if (failing) throw Error('t25-persistent-flush-failure')
  })
  const rejection = await ctx.compaction.compactNow(agent, new AbortController().signal)
    .then(() => undefined, (error: unknown) => error)
  expect(rejection).toBeInstanceOf(ManualCompactionError)
  expect(rejection).toMatchObject({ code: 'persistence' })
  // Negative window: no durable notebook revision exists and synchronization itself refuses.
  expect((await ctx.nidofyNotebook.read(agent.session.id)).revision).toBe(0)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(0)
  await expect(api('status', { sessionId: agent.session.id })).rejects.toThrow('t25-persistent-flush-failure')
  failing = false
  const published = await untilRevision(api, agent.session.id, 1)
  expect(published.entries).toHaveLength(1)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
  expect((await status(api, agent.session.id)).revision).toBe(1)
  expect((await status(api, agent.session.id)).revision).toBe(1)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
})

it('lands an unpublished candidate durably at teardown and publishes it once after a cold restart', async () => {
  const home = await isolatedHome('cold-recovery')
  const live = await liveComposition(home)
  const { ctx, agent } = live
  ctx.on('session/flush', () => { throw Error('t25-persistent-flush-failure') })
  const rejection = await ctx.compaction.compactNow(agent, new AbortController().signal)
    .then(() => undefined, (error: unknown) => error)
  expect(rejection).toBeInstanceOf(ManualCompactionError)
  expect(rejection).toMatchObject({ code: 'persistence' })
  expect((await ctx.nidofyNotebook.read(agent.session.id)).revision).toBe(0)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(0)
  // Teardown drains the routed write handle without dispatching session/flush.
  await live.dispose()
  const cold = await coldComposition(home)
  onTestFinished(cold.dispose)
  const reader = await cold.ctx.sessionPersistence.open(agent.session.id, 'read')
  const stored = await reader.read()
  await reader.close()
  expect(stored.events.some(event => event.type === 'compaction/summary')).toBe(true)
  expect(stored.events.some(event => event.type === 'compaction/end' && !event.data.error)).toBe(true)
  const published = await untilRevision(cold.api, agent.session.id, 1)
  expect(published.entries).toHaveLength(1)
  expect(published.entries[0]).toMatchObject({ id: 't25-boundary-0', text: 'T25 committed boundary note' })
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
  await cold.dispose()
  // A second restart replays the same committed pair without a second publication.
  const second = await coldComposition(home)
  onTestFinished(second.dispose)
  expect((await status(second.api, agent.session.id)).revision).toBe(1)
  expect(await revisionFiles(join(home, 'notes'))).toHaveLength(1)
})

it('skips the notebook appendix silently when its payload exceeds the byte budget', async () => {
  const home = await isolatedHome('budget')
  const { ctx, model, agent, dispose } = await liveComposition(home, 640)
  onTestFinished(dispose)
  const warned: string[] = []
  const originalWarn = ctx.logger.warn.bind(ctx.logger)
  ctx.logger.warn = (...args: Parameters<typeof ctx.logger.warn>) => { warned.push(args.join(' ')); originalWarn(...args) }
  expect(await ctx.compaction.compactNow(agent, new AbortController().signal)).not.toBeNull()
  const lastCompaction = model.requests.filter(options => options.purpose === 'compaction').at(-1)
  expect(JSON.stringify(lastCompaction?.messages)).not.toContain('Also include one <nidofy-notebook-delta>')
  await new Promise(resolve => setTimeout(resolve, 30))
  expect((await ctx.nidofyNotebook.read(agent.session.id)).revision).toBe(0)
  expect(warned.some(message => message.includes('Notebook summary unavailable'))).toBe(false)
})

it('skips the appendix when only the assembled instruction exceeds the byte budget', async () => {
  const home = await isolatedHome('budget-instruction')
  // The payload alone stays below the 1000-byte budget, while the directive plus
  // payload exceeds it, so the fallback trips on the instruction check alone.
  const { ctx, model, agent, dispose } = await liveComposition(home, 1000)
  onTestFinished(dispose)
  expect(await ctx.compaction.compactNow(agent, new AbortController().signal)).not.toBeNull()
  const lastCompaction = model.requests.filter(options => options.purpose === 'compaction').at(-1)
  expect(JSON.stringify(lastCompaction?.messages)).not.toContain('Also include one <nidofy-notebook-delta>')
  await new Promise(resolve => setTimeout(resolve, 30))
  expect((await ctx.nidofyNotebook.read(agent.session.id)).revision).toBe(0)
})

it('commits an error end for a failed summary and publishes only the later successful candidate', async () => {
  const home = await isolatedHome('failed-summary')
  const { ctx, api, model, agent, turn, dispose } = await liveComposition(home)
  onTestFinished(dispose)
  model.failCompaction = true
  await expect(ctx.compaction.compactNow(agent, new AbortController().signal)).rejects.toThrow()
  expect((await ctx.nidofyNotebook.read(agent.session.id)).revision).toBe(0)
  const observation = await ctx.sessionQuery.observeSession(agent.session.id, { projectionMode: 'none' })
  try { expect(observation.events.some(event => event.type === 'compaction/end' && event.data.error)).toBe(true) }
  finally { observation[Symbol.dispose]() }
  model.failCompaction = false
  await turn('T25 source sentence two. Keep the official engine. ' + 'recovery evidence '.repeat(80))
  expect(await ctx.compaction.compactNow(agent, new AbortController().signal)).not.toBeNull()
  const published = await untilRevision(api, agent.session.id, 1)
  expect(published.entries).toHaveLength(1)
  expect((await status(api, agent.session.id)).revision).toBe(1)
})
