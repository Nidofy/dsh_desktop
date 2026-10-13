/** V2 product consumer through a real Loader, AgentLoop and durable JSONL provider. */
import { onTestFinished } from 'vitest'
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
import NotebookCompaction from '../src/compaction.ts'
import { installContextV2 } from '../src/context.ts'
import type { NotebookV2 } from '../src/notebook.ts'
import type { NotebookReadOptions } from '../src/shared/notebook-types.ts'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

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
        previous: NotebookV2
        policyRevision: number
        evidenceThrough: number
        sources: { seq: number; excerpt: string }[]
      }
      const source = payload.sources.at(-1)!
      output += '<nidofy-notebook-delta>' + (this.malformed ? '{}' : JSON.stringify({ schemaVersion: 2, scope: payload.previous.scope, baseRevision: payload.previous.revision, policyRevision: payload.policyRevision,
        evidenceThrough: payload.evidenceThrough, operations: [{ action: 'ADD', id: 'cycle-' + String(payload.previous.revision),
          kind: 'next', text: 'Continue bounded verification', seq: source.seq, quote: source.excerpt.slice(0, 20) }] })) + '</nidofy-notebook-delta>'
    }
    yield { type: 'text-delta', index: 0, text: output }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const budgets = { maxActiveEntries: 64, maxActiveBytes: 16384, maxDeltaBytes: 4096, maxEvidenceBytes: 16384, maxHistoryBytes: 1048576 }
/** Boot the real v2 Loader composition with an external model stand-in.
 * @param reads - optional deployment read/cache limits for lifecycle regressions.
 * @param workspaces - include actual Workspace registry over an isolated local storage provider.
 * @returns private runtime, turn runner, note dispatcher and idempotent disposal.
 */
export async function createNotebookFixture(
  reads: NotebookReadOptions = { maxCachedSessions: 32, recentEventLimit: 40, recentScanEvents: 256 }, workspaces = false) {
  const home = await mkdtemp(join(tmpdir(), 't04-loader-')), ctx = new Context()
  const policy = { enabled: true, revision: 0, signal: new AbortController().signal }
  let api: ReturnType<typeof installContextV2> | undefined
  const owner = { name: 't04-notebook-owner', inject: ['tools', 'sessions', 'sessionQuery', 'sessionPersistence', 'systemPrompt'], apply(child: Context) {
    api = installContextV2(child, join(home, 'notes'), budgets, () => ({ ...policy }), reads)
  } }
  const modules = {
    't04-dependencies': { name: 't04-dependencies', apply: mountAgentLoopTestDependencies },
    storage: Storage,
    'history-storage': { name: 'history-storage', inject: ['storage'], apply(child: Context) {
      child.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
      const facility = new DomainFacility(child, { backend: 'memory' })
      child.provide('storageDomain', facility)
      child.effect(() => () => facility.closeAll())
    } },
    jsonl: JsonlSessionPersistence, meter: TokenMeter, query: SqliteQuery, notebook: owner,
    loop: AgentLoop, compact: NotebookCompaction, workspace: WorkspaceRegistry,
  }
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, ['- name: cordis:t04-dependencies', '- name: cordis:jsonl', '  config:', '    root: ' + JSON.stringify(join(home, 'sessions')),
    '- name: cordis:meter', '- name: cordis:query', '  config:', '    path: ' + JSON.stringify(join(home, 'search.sqlite')), '    openAt: first-search',
    ...workspaces ? ['- name: cordis:storage', '- name: cordis:history-storage', '- name: cordis:workspace'] : [],
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
  const status = async () => (await api!('status', { sessionId: agent.session.id }) as { notebook: NotebookV2 }).notebook
  const synchronize = () => api!('synchronize', { sessionId: agent.session.id })
  return { home, ctx, model, agent, turn, policy, dispose, status, synchronize, api }
}
