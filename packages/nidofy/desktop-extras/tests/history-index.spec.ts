/** Actual SQLite trigrams over disposable checkpoints and official durable generation observations. */
import { expect, it, onTestFinished } from 'vitest'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, unlink, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { createNotebookFixture } from './notebook-loader-fixture.ts'
import type { HistoryPage } from '../src/history-search.ts'
import { HistorySubstringIndex } from '../src/history-index.ts'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

it('recalls older Chinese substrings while preserving word, filename and error-code search; checkpoints append only new events', async () => {
  const f = await createNotebookFixture({ maxCachedSessions: 4, recentEventLimit: 8, recentScanEvents: 8 }), id = f.agent.session.id
  await f.turn('很早的连接超时原文 config.client.ts E_TIMEOUT')
  for (let index = 0; index < 4; index++) await f.turn('later unrelated evidence ' + String(index))
  const count = f.model.requests.length
  const first = await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage
  expect(first.items.some(hit => hit.snippet.includes('连接超时'))).toBe(true)
  expect(first.substringIncomplete).toBe(false)
  expect(first.indexedEvents).toBeGreaterThan(8)
  expect((await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage).indexedEvents).toBe(0)
  for (const query of ['config.client.ts', 'E_TIMEOUT']) {
    expect((await f.api('search', { sessionId: id, query }) as HistoryPage).items.some(hit => hit.snippet.includes(query))).toBe(true)
  }
  for (const query of ['连', '连接']) expect((await f.api('search', { sessionId: id, query }) as HistoryPage).substringIncomplete).toBe(true)
  expect(f.model.requests).toHaveLength(count)
  await f.turn('追加连接超时证据')
  const next = await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage
  expect(next.indexedEvents).toBeGreaterThan(0)
  expect(next.indexedEvents).toBeLessThan(first.indexedEvents!)
})

it('rebuilds after deletion or corruption, preserves damaged bytes and refuses unknown checkpoint versions', async () => {
  const f = await createNotebookFixture(), id = f.agent.session.id
  await f.turn('连接超时需要回到真实原文')
  const before = await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage
  const directory = join(f.home, 'notes', 'history-substrings-v1')
  const path = join(directory, createHash('sha256').update(id).digest('hex') + '.json')
  const bytes = await readFile(path, 'utf8')
  await unlink(path)
  expect((await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage).items).toEqual(before.items)
  await writeFile(path, 'damaged derived checkpoint')
  const rebuilt = await f.api('search', { sessionId: id, query: '连接超时' }) as HistoryPage
  expect(rebuilt.items).toEqual(before.items); expect(rebuilt.indexRecovered).toBe(true)
  const backup = (await readdir(directory)).find(file => file.includes('.corrupt-'))!
  expect(await readFile(join(directory, backup), 'utf8')).toBe('damaged derived checkpoint')
  await writeFile(path, JSON.stringify({ checksum: '', value: { schemaVersion: 2 } }))
  await expect(f.api('search', { sessionId: id, query: '连接超时' })).rejects.toThrow('HISTORY_INDEX_VERSION_UNSUPPORTED')
  expect((JSON.parse(await readFile(path, 'utf8')) as { value: { schemaVersion: number } }).value.schemaVersion).toBe(2)
  await writeFile(path, bytes)
})

it('leaves the committed checkpoint unchanged when cancelled, then recovers cold from official originals', async () => {
  const f = await createNotebookFixture(), id = f.agent.session.id
  await f.turn('连接超时初始证据')
  await f.api('search', { sessionId: id, query: '连接超时' })
  const path = join(f.home, 'notes', 'history-substrings-v1', createHash('sha256').update(id).digest('hex') + '.json')
  const before = await readFile(path)
  await f.turn('新增连接超时证据')
  await f.ctx.sessions.flush(f.agent.session)
  const observation = await f.ctx.sessionPersistence.observeDurable(id)
  const index = new HistorySubstringIndex(f.ctx, join(f.home, 'notes'), 1048576, 1, 40)
  onTestFinished(() => index.close())
  const abort = new AbortController()
  const task = index.search(observation, '连接超时', abort.signal)
  setTimeout(() => { abort.abort() }, 0)
  await expect(task).rejects.toThrow()
  expect(await readFile(path)).toEqual(before)
  const cold = await index.search(observation, '连接超时', new AbortController().signal)
  expect(cold.indexedEvents).toBeGreaterThan(0); expect(cold.seqs.length).toBe(2)
  const repeated = await index.search(observation, '连接超时', new AbortController().signal)
  expect(repeated.indexedEvents).toBe(0); expect(repeated.seqs).toEqual(cold.seqs)
  await index.close()
})

it('rebuilds for an actual copied physical generation and bounds checkpoint capacity without writing the Session source', async () => {
  const f = await createNotebookFixture(), id = f.agent.session.id
  await f.turn('连接超时物理证据')
  await f.api('search', { sessionId: id, query: '连接超时' })
  const before = await f.ctx.sessionPersistence.observeDurable(id)
  await f.dispose()
  const copy = join(f.home, 'copied-sessions')
  await cp(join(f.home, 'sessions'), copy, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root: copy })
  onTestFinished(() => ctx.fiber.dispose())
  const observation = await ctx.sessionPersistence.observeDurable(id)
  expect(observation.generation).not.toBe(before.generation)
  const index = new HistorySubstringIndex(ctx, join(f.home, 'notes'), 1048576, 8, 40)
  onTestFinished(() => index.close())
  const rebuilt = await index.search(observation, '连接超时', new AbortController().signal)
  expect(rebuilt.indexedEvents).toBe(observation.events.length)
  const bounded = new HistorySubstringIndex(ctx, join(f.home, 'small'), 128, 8, 40)
  onTestFinished(() => bounded.close())
  expect(await bounded.search(observation, '连接超时', new AbortController().signal)).toMatchObject({ seqs: [], incomplete: true })
  expect(await ctx.sessionPersistence.observeDurable(id)).toEqual(observation)
})
