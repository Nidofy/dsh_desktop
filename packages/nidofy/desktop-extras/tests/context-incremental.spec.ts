/** Incremental product reads retain generation protection and do not run recovery implicitly. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { cp, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { NotebookStore } from '../src/notebook.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createNotebookFixture } from './notebook-loader-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

it('refuses cached scope when generation protection observes an actual copied physical log', async () => {
  const f = await createNotebookFixture()
  await f.ctx.compaction.compactNow(f.agent, new AbortController().signal); await f.synchronize()
  const before = await f.status(), restored = new Context(), root = join(f.home, 'copied-sessions')
  await cp(join(f.home, 'sessions'), root, { recursive: true,
    filter: async path => (await lstat(path)).isDirectory() || /\.jsonl(?:\.zstd)?$/.test(path) })
  await restored.plugin(JsonlSessionPersistence, { root })
  onTestFinished(() => restored.fiber.dispose())
  const physical = await restored.sessionPersistence.observeDurable(f.agent.session.id)
  expect(physical.generation).not.toBe(before.scope.generation)
  // A delegated restored backend supplies real physical checks while the product still holds its warm metadata.
  const guard = vi.spyOn(f.ctx.sessionPersistence, 'withGeneration').mockImplementation((...args) =>
    restored.sessionPersistence.withGeneration(...args))
  try {
    await expect(f.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)).rejects.toThrow('SESSION_GENERATION_CONFLICT')
    expect(guard).toHaveBeenCalledOnce()
  } finally { guard.mockRestore() }
  expect(await f.status()).toEqual(before)
})

it('evicts idle metadata and reacquires the real generation without notebook writes', async () => {
  const f = await createNotebookFixture({ maxCachedSessions: 1, recentEventLimit: 2, recentScanEvents: 4 })
  const before = await f.status()
  const other = await f.ctx.agentLoop.create(SessionId('other-read-scope'), { provider: 'test', model: 'test' })
  expect(f.ctx.nidofyNotebookV2.synchronization(f.agent.session.id).phase).toBe('idle')
  const observe = vi.spyOn(f.ctx.sessionPersistence, 'observeDurable')
  onTestFinished(() => { observe.mockRestore() })
  const read = await f.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)
  expect(read).toEqual(before); expect(observe).toHaveBeenCalledOnce()
  expect(f.ctx.nidofyNotebookV2.synchronization(other.session.id).phase).toBe('idle')
})

it('reads committed notes across new turns without full durable observations or recovery writes', async () => {
  const f = await createNotebookFixture(), observe = vi.spyOn(f.ctx.sessionPersistence, 'observeDurable')
  onTestFinished(() => { observe.mockRestore() })
  for (let index = 0; index < 4; index++) {
    await f.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)
    await f.turn('New turn ' + String(index))
    expect((await f.status()).revision).toBe(0)
  }
  expect(observe).not.toHaveBeenCalled()
  expect(f.ctx.nidofyNotebookV2.synchronization(f.agent.session.id).phase).toBe('ready')
})

it('routes source and search directly and reads a bounded recent raw window', async () => {
  const f = await createNotebookFixture(); await f.synchronize()
  const observe = vi.spyOn(f.ctx.sessionPersistence, 'observeDurable')
  const readEvent = vi.spyOn(f.ctx.sessionQuery, 'readEvent'), search = vi.spyOn(f.ctx.sessionQuery, 'searchEvents')
  const source = f.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  const windows: { offset: number; length: number | undefined }[] = []
  const open = f.ctx.sessionPersistence.open.bind(f.ctx.sessionPersistence)
  const opened = vi.spyOn(f.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), read = handle.read.bind(handle)
    vi.spyOn(handle, 'read').mockImplementation((offset = 0, length, options) => {
      windows.push({ offset, length }); return read(offset, length, options)
    })
    return handle
  })
  onTestFinished(() => { observe.mockRestore(); readEvent.mockRestore(); search.mockRestore(); opened.mockRestore() })
  const events = await f.api('events', { sessionId: f.agent.session.id }) as { seq: number }[]
  expect(events.some(event => event.seq === source.seq)).toBe(true)
  expect(events.length).toBeLessThanOrEqual(40)
  expect(windows.length).toBeGreaterThan(0)
  expect(windows.every(window => window.length !== undefined && window.length <= 256)).toBe(true)
  expect(await f.api('source', { sessionId: f.agent.session.id, seq: source.seq })).toMatchObject({ seq: source.seq })
  await f.api('search', { sessionId: f.agent.session.id, query: 'evidence', scope: 'session' })
  expect(readEvent).toHaveBeenCalledOnce(); expect(search).toHaveBeenCalledOnce()
  expect(observe).not.toHaveBeenCalled()
})

it('keeps legacy files unchanged on a read and converts only through explicit synchronization', async () => {
  const f = await createNotebookFixture(); await f.synchronize()
  const events = f.agent.session.snapshotEvents(), source = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  const legacy = new NotebookStore(join(f.home, 'notes'), { maxEntries: 64, maxBytes: 16384 })
  await legacy.update(f.agent.session.id, { baseRevision: 0, sourceThrough: source.seq, operations: [{ action: 'ADD',
    id: 'legacy', kind: 'constraint', text: 'Keep the legacy note', seq: source.seq, quote: '初始原文证据' }] }, events, 'user')
  await legacy.close()
  const directory = join(f.home, 'notes', createHash('sha256').update(f.agent.session.id).digest('hex'))
  const original = await readFile(join(directory, 'current.json'), 'utf8')
  await expect(f.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)).rejects.toThrow('NOTEBOOK_RECOVERY_REQUIRED')
  await expect(stat(join(directory, 'v2', 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await f.synchronize()
  expect((await f.status()).active.map(note => note.id)).toEqual(['legacy'])
  expect(await readFile(join(directory, 'current.json'), 'utf8')).toBe(original)
})

it('keeps an agent bootable when a numeric-generation notebook requires explicit reconciliation', async () => {
  const f = await createNotebookFixture(), id = SessionId('legacy-generation-session')
  const directory = join(f.home, 'notes', createHash('sha256').update(id).digest('hex'), 'v2')
  await mkdir(directory, { recursive: true })
  const bytes = JSON.stringify({ schemaVersion: 2, scope: { sessionId: id, generation: 17 }, revision: 0,
    active: [], cursors: { evidenceThrough: -1, commitThrough: -1 }, historyRevision: 0, historyBytes: 0 }) + '\n'
  await writeFile(join(directory, 'current.json'), bytes)
  const agent = await f.ctx.agentLoop.create(id, { provider: 'test', model: 'test' })
  expect(agent.session.id).toBe(id)
  expect(f.ctx.nidofyNotebookV2.synchronization(id)).toMatchObject({ phase: 'failed', diagnostic: 'NOTEBOOK_GENERATION_REBIND_REQUIRED' })
  await expect(f.ctx.nidofyNotebookV2.read(id, new AbortController().signal)).rejects.toThrow('NOTEBOOK_GENERATION_REBIND_REQUIRED')
  expect(await readFile(join(directory, 'current.json'), 'utf8')).toBe(bytes)
})

it('reports pending work and drains it during unload without publishing after cancellation', async () => {
  const f = await createNotebookFixture(), entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const observe = f.ctx.sessionPersistence.observeDurable.bind(f.ctx.sessionPersistence)
  const spy = vi.spyOn(f.ctx.sessionPersistence, 'observeDurable').mockImplementation(async (...args) => {
    const result = await observe(...args); entered.resolve(undefined); await release.promise; return result
  })
  onTestFinished(() => { spy.mockRestore() })
  const service = f.ctx.nidofyNotebookV2
  const task = f.synchronize(), rejection = expect(task).rejects.toThrow()
  await entered.promise
  expect(await f.api('progress', { sessionId: f.agent.session.id })).toMatchObject({ phase: 'organizing' })
  let stopped = false
  const stop = f.dispose().then(() => { stopped = true })
  await Promise.resolve(); expect(stopped).toBe(false)
  release.resolve(undefined); await rejection; await stop
  expect(f.ctx.get('nidofyNotebookV2')).toBeUndefined()
  await expect(service.read(f.agent.session.id, new AbortController().signal)).rejects.toThrow()
})
