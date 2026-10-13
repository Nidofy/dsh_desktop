/** Local-user search through the actual Loader, official SQLite and durable JSONL sources. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { HistoryPage, HistorySource } from '../src/history-search.ts'
import { LocalHistorySearch } from '../src/history-search.ts'
import { createNotebookFixture } from './notebook-loader-fixture.ts'

it('recalls Chinese single/two/long substrings and exact identifiers with actual generation locators and no extra model calls', async () => {
  const f = await createNotebookFixture(), id = f.agent.session.id
  await f.turn('中文连接超时错误 config.client.ts E_TIMEOUT 的原始证据')
  const count = f.model.requests.length
  for (const query of ['连', '连接', '连接超时', 'config.client.ts', 'E_TIMEOUT']) {
    const result = await f.api('search', { sessionId: id, query }) as HistoryPage
    expect(result.items.some(hit => hit.snippet.includes(query))).toBe(true)
    const hit = result.items.find(hit => hit.snippet.includes(query))!
    const observation = await f.ctx.sessionPersistence.observeDurable(id)
    expect(hit.generation).toBe(observation.generation)
    const source = await f.api('search-source', { sessionId: id, targetSessionId: hit.sessionId,
      seq: hit.seq, generation: hit.generation, digest: hit.digest }) as HistorySource
    expect(source).toMatchObject({ text: '中文连接超时错误 config.client.ts E_TIMEOUT 的原始证据', role: 'user', type: 'user/message' })
    await expect(f.api('search-source', { sessionId: id, targetSessionId: hit.sessionId,
      seq: hit.seq, generation: hit.generation, digest: '0'.repeat(64) })).rejects.toThrow('HISTORY_SOURCE_CHANGED')
  }
  expect(f.model.requests).toHaveLength(count)
})

it('refuses unrelated directories, stale generations and cancellation, and reports bounded substring coverage', async () => {
  const f = await createNotebookFixture(), cwd = join(f.home, 'project')
  const first = await f.ctx.agentLoop.create(SessionId('history-current'), { provider: 'test', model: 'test' }, { cwd })
  const same = await f.ctx.agentLoop.create(SessionId('history-same'), { provider: 'test', model: 'test' }, { cwd })
  const foreign = await f.ctx.agentLoop.create(SessionId('history-foreign'), { provider: 'test', model: 'test' }, { cwd: join(f.home, 'unrelated') })
  for (const agent of [first, same, foreign]) {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '中文连接原文 ' + String(agent.session.id) }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const result = await f.api('search', { sessionId: first.session.id, query: '连接', scope: 'workspace' }) as HistoryPage
  expect(result.items.map(hit => hit.sessionId).sort()).toEqual([first.session.id, same.session.id].sort())
  const foreignResult = await f.api('search', { sessionId: foreign.session.id, query: '连接' }) as HistoryPage
  const foreignHit = foreignResult.items[0]!
  await expect(f.api('search-source', { sessionId: first.session.id, targetSessionId: foreignHit.sessionId,
    seq: foreignHit.seq, generation: foreignHit.generation, digest: foreignHit.digest, scope: 'workspace' })).rejects.toThrow('HISTORY_SCOPE_REFUSED')
  const hit = result.items[0]!
  await expect(f.api('search-source', { sessionId: first.session.id, targetSessionId: hit.sessionId,
    seq: hit.seq, generation: hit.generation + '-old', digest: hit.digest, scope: 'workspace' })).rejects.toThrow('HISTORY_SOURCE_CHANGED')
  const bounded = new LocalHistorySearch(f.ctx, { maxCachedSessions: 1, recentEventLimit: 1, recentScanEvents: 1 }, 1024)
  expect((await bounded.search(first.session.id, '中文连接原文', true, new AbortController().signal)).substringIncomplete).toBe(true)
  expect((await bounded.search(first.session.id, '连接', true, new AbortController().signal)).scannedSessions).toBe(1)
  await expect(bounded.search(first.session.id, '连接', false, AbortSignal.abort())).rejects.toThrow()
})

it('rebuilds a disposable cold index against the preserved physical source and refuses index failures', async () => {
  const f = await createNotebookFixture(), id = f.agent.session.id
  await f.turn('中文连接历史 config.client.ts E_TIMEOUT')
  const before = await f.api('search', { sessionId: id, query: '连接' }) as HistoryPage
  await f.dispose()
  const cold = new Context()
  await mountAgentLoopTestDependencies(cold)
  await cold.plugin(JsonlSessionPersistence, { root: join(f.home, 'sessions') })
  await cold.plugin(SqliteQuery, { path: ':memory:', openAt: 'first-search' })
  onTestFinished(() => cold.fiber.dispose())
  const search = new LocalHistorySearch(cold, { maxCachedSessions: 32, recentEventLimit: 40, recentScanEvents: 256 }, 16384)
  const after = await search.search(id, '连接', false, new AbortController().signal)
  expect(after.items).toEqual(before.items)
  expect(await search.source(id, after.items[0]!, false, new AbortController().signal)).toMatchObject({ text: '中文连接历史 config.client.ts E_TIMEOUT' })
  const failure = vi.spyOn(cold.sessionQuery, 'searchEvents').mockRejectedValue(new Error('SESSION_QUERY_INDEX_FAILED'))
  try { await expect(search.search(id, '连接', false, new AbortController().signal)).rejects.toThrow('SESSION_QUERY_INDEX_FAILED') }
  finally { failure.mockRestore() }
})
