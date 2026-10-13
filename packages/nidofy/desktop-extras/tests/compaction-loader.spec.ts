/** Real Loader/AgentLoop/JSONL composition reuses T25's durable boundary recipe.
 * The product still consumes v1 pending R's v2 Config/context/schema/generation wiring. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SqliteQuery from '@deepseek-ai/dsh-session-query-sqlite'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import NotebookCompaction, { installNotebookCompaction } from '../src/compaction.ts'
import { installContext } from '../src/context.ts'
import type { Notebook } from '../src/notebook.ts'

class Model extends LlmAdapter {
  requests: GenerateOptions[] = []
  fail = false
  malformed = false
  beforeCompaction: ((options: GenerateOptions) => Promise<void>) | undefined
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 100000, maxOutputTokens: 4096 } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const compacting = options.purpose === 'compaction'
    if (compacting && this.fail) throw Error('t04-model-failed')
    const appendix = options.messages.flatMap(message => message.content).find(block => block.type === 'text' && block.text.includes('Also include one <nidofy-notebook-delta>'))
    let output = compacting ? 'Continue verification with official engine.' : 'Acknowledged.'
    if (appendix?.type === 'text') {
      await this.beforeCompaction?.(options)
      const payload = JSON.parse(appendix.text.slice(appendix.text.lastIndexOf('\n') + 1)) as {
        previous: { revision: number }
        sourceThrough: number
        sources: { seq: number; excerpt: string }[]
      }
      const source = payload.sources.at(-1)!
      output += '<nidofy-notebook-delta>' + (this.malformed ? '{}' : JSON.stringify({ baseRevision: payload.previous.revision,
        sourceThrough: payload.sourceThrough, operations: [{ action: 'ADD', id: 'cycle-' + String(payload.previous.revision),
          kind: 'next', text: 'Continue bounded verification', seq: source.seq, quote: source.excerpt.slice(0, 20) }] })) + '</nidofy-notebook-delta>'
    }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 't04-loader-')), ctx = new Context()
  const policy = { enabled: true, revision: 0 }
  let api: ReturnType<typeof installContext> | undefined
  const owner = { name: 't04-notebook-owner', inject: ['tools', 'sessions', 'sessionQuery', 'systemPrompt'], apply(child: Context) {
    api = installContext(child, join(home, 'notes'), { maxEntries: 64, maxBytes: 16384 })
    installNotebookCompaction(child, () => ({ ...policy }))
  } }
  const modules = {
    't04-dependencies': { name: 't04-dependencies', apply: mountAgentLoopTestDependencies },
    jsonl: JsonlSessionPersistence, meter: TokenMeter, query: SqliteQuery, notebook: owner,
    loop: AgentLoop, compact: NotebookCompaction,
  }
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, ['- name: cordis:t04-dependencies', '- name: cordis:jsonl', '  config:', '    root: ' + JSON.stringify(join(home, 'sessions')),
    '- name: cordis:meter', '- name: cordis:query', '  config:', '    path: ' + JSON.stringify(join(home, 'search.sqlite')), '    openAt: first-search',
    '- name: cordis:notebook', '- name: cordis:loop', '  config:', '    agents: []', '- name: cordis:compact', '  config:', '    auto: false', ''].join('\n'))
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, modules)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
  if (!api) throw Error('t04 notebook did not activate through Loader')
  const model = new Model(); ctx.llm.registerAdapter(['test'], model)
  const agent = await ctx.agentLoop.create(SessionId('t04-loader'), { provider: 'test', model: 'test' })
  let disposed = false
  const dispose = async () => { if (!disposed) { disposed = true; await ctx.fiber.dispose() } }
  onTestFinished(async () => { await dispose(); await rm(home, { recursive: true, force: true }) })
  const turn = async (body: string) => { agent.followup(createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: 'user' } })); await agent.whenIdle() }
  await turn('初始原文证据，验证计划尚未执行。 ' + 'evidence '.repeat(180))
  const status = async () => (await api!('status', { sessionId: agent.session.id }) as { notebook: Notebook }).notebook
  return { home, ctx, model, agent, turn, policy, dispose, status }
}

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
  const { NotebookStore } = await import('../src/notebook.ts')
  const notes = new NotebookStore(join(f.home, 'notes'), { maxEntries: 64, maxBytes: 16384 })
  expect(await notes.read(f.agent.session.id)).toEqual(storedNotes)
  await notes.close()
})
it('does not make a hidden retry or publish when the actual model request fails', async () => {
  const f = await fixture(); f.model.fail = true
  await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toThrow()
  expect(f.model.requests.filter(request => request.purpose === 'compaction')).toHaveLength(1)
  expect((await f.status()).revision).toBe(0)
})
it('keeps publication at zero throughout a repeated flush refusal window', async () => {
  const f = await fixture(); let failing = true
  f.ctx.on('session/flush', () => { if (failing) throw Error('t04-flush-refused') })
  await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toThrow()
  expect((await f.ctx.nidofyNotebook.read(f.agent.session.id)).revision).toBe(0)
  for (let attempt = 0; attempt < 2; attempt++) await expect(f.status()).rejects.toThrow('t04-flush-refused')
  expect((await f.ctx.nidofyNotebook.read(f.agent.session.id)).revision).toBe(0)
  failing = false
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
