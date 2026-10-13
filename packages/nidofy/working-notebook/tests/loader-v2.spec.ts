/** Actual working-notebook Config, settings, API, tools and prompt composition through Loader. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { NotebookV2 } from '@nidofy/dsh-desktop-extras/notebook'
import * as Notebook from '../src/index.ts'

const paths = vi.hoisted(() => ({ home: '' }))
vi.mock('@deepseek-ai/dsh-home-paths', () => ({ resolveDshHome: () => paths.home }))

/** External HTTP carrier stand-in; actual product request handlers run on the local test server. */
class Transport extends Service {
  constructor(ctx: Context) { super(ctx, 'connection') }
}
class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 100000, maxOutputTokens: 4096 } }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'Synthetic response.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('loads production v2 defaults, rejects stale scope/revision and logs the next-turn active injection', async () => {
  const home = await mkdtemp(join(tmpdir(), 'working-notebook-v2-')), ctx = new Context()
  paths.home = home
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, {
    dependencies: { name: 'dependencies', apply: mountAgentLoopTestDependencies }, transport: Transport,
    jsonl: JsonlSessionPersistence, query: SqliteQuery, notebook: Notebook, loop: AgentLoop,
  })
  const config = join(home, 'cordis.yml')
  await writeFile(config, ['- name: cordis:dependencies', '- name: cordis:transport', '- name: cordis:jsonl', '  config:',
    '    root: ' + JSON.stringify(join(home, 'sessions')), '- name: cordis:query', '  config:',
    '    path: ' + JSON.stringify(join(home, 'search.sqlite')), '    openAt: first-search',
    '- name: cordis:notebook', '- name: cordis:loop', '  config:', '    agents: []', ''].join('\n'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await()
  expect(ctx.get('nidofyNotebookV2')).toBeDefined()
  expect(ctx.get('nidofyNotebook')).toBeUndefined()
  const model = new Model(); ctx.llm.registerAdapter(['test'], model)
  const agent = await ctx.agentLoop.create(SessionId('working-notebook-v2'), { provider: 'test', model: 'test' })
  const turn = async (body: string) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: 'user' } })); await agent.whenIdle()
  }
  await turn('Original source: preserve this constraint.')
  expect(model.requests[0]?.tools).toMatchSnapshot('v2 working-note tools')
  const server = createServer((request, response) => {
    void ctx.waterfall('connection/request', request, response, () => { response.writeHead(404); response.end(); return Promise.resolve() })
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error) reject(error); else resolve() })
  }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/nidofy-notebook/`
  const post = async (method: string, input: object) => {
    const response = await fetch(base + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    return { status: response.status, value: await response.json() as Record<string, unknown> }
  }
  const status = await post('status', { sessionId: agent.session.id })
  expect(status.status).toBe(200)
  const state = status.value.notebook as NotebookV2
  expect(state.schemaVersion).toBe(2); expect(typeof state.scope.generation).toBe('string')
  const source = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  const delta = { scope: state.scope, baseRevision: state.revision, cursors: { evidenceThrough: source.seq }, operations: [{
    action: 'ADD', id: '', kind: 'constraint', text: 'Preserve this constraint.', seq: source.seq, quote: 'preserve this constraint', pinned: true,
  }] }
  expect((await post('update', { sessionId: agent.session.id, delta })).status).toBe(200)
  expect((await post('update', { sessionId: agent.session.id, delta })).status).toBe(409)
  expect((await post('update', { sessionId: agent.session.id, delta: { ...delta, scope: { ...state.scope, generation: 'obsolete-file' } } })).status).toBe(409)
  await turn('Continue.')
  const modelInput = model.requests.at(-1)!.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
  expect(modelInput).toContain('Working notes at this turn boundary.')
  expect(modelInput).toContain('Preserve this constraint.')
  expect(await ctx.sessions.flush(agent.session)).toBe(true)
  const durable = await ctx.sessionPersistence.observeDurable(agent.session.id)
  expect(JSON.stringify(durable.events)).toContain('Working notes at this turn boundary.')
  expect((await post('settings', {})).value.autoOrganize).toBe(false)
  expect((await post('save-settings', { schemaVersion: 1, revision: 0, autoOrganize: true })).value.revision).toBe(1)
  expect((await post('save-settings', { schemaVersion: 1, revision: 0, autoOrganize: false })).status).toBe(409)
  const entered = Promise.withResolvers<AbortSignal>(), cancelled = Promise.withResolvers<undefined>()
  const read = vi.spyOn(ctx.sessionQuery, 'filterSessions').mockImplementationOnce(async (_filters, signal) => {
    if (!signal) throw Error('Expected HTTP request lifetime')
    entered.resolve(signal)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        cancelled.resolve(undefined); reject(new Error('HTTP_SEARCH_ABORTED', { cause: signal.reason }))
      }, { once: true })
    })
    return []
  })
  const controller = new AbortController()
  const pending = fetch(base + 'search', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: agent.session.id, query: 'Original' }), signal: controller.signal })
  const refusal = expect(pending).rejects.toThrow()
  try {
    const operation = await entered.promise
    controller.abort()
    await refusal; await cancelled.promise
    expect(operation.aborted).toBe(true)
  } finally { read.mockRestore() }
})
