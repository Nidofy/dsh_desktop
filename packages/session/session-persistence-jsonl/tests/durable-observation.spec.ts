/** Durable prefixes and physical identities use production files and production write exclusion. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '../src/index.ts'
import { generationLogPath } from '../src/format.ts'
import { SessionWriteLease } from '../src/lease.ts'

async function fixture(compression: 'none' | 'zstd') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-durable-observation-')), contexts: Context[] = []
  onTestFinished(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const mount = async (directory = root) => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: directory, compression })
    return ctx.sessionPersistence
  }
  const provider = await mount(), session = Session.create(SessionId('durable-prefix'))
  const writer = await provider.create(session.header)
  const append = async (body: string) => {
    const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await writer.append([event])
  }
  return { root, mount, provider, session, writer, append }
}

it.each(['none', 'zstd'] as const)('keeps %s identity through append, write reopen and a cold provider', async (compression) => {
  const f = await fixture(compression)
  await f.writer.flush()
  const empty = await f.provider.observeDurable(f.session.id)
  expect(empty.durableThrough).toBe(-1)
  await f.append('one')
  const first = await f.provider.observeDurable(f.session.id)
  expect(first.generation).toBe(empty.generation)
  expect(first.durableThrough).toBe(0)
  expect(first.events.map(event => event.seq)).toEqual([0])
  await f.append('two')
  expect(first.events).toHaveLength(1)
  await f.writer.close()
  const cold = await f.mount()
  const reopened = await cold.observeDurable(f.session.id)
  expect(reopened.generation).toBe(first.generation)
  expect(reopened.durableThrough).toBe(1)
  const writer = await cold.open(f.session.id, 'write'); await writer.close()
  expect((await cold.observeDurable(f.session.id)).generation).toBe(first.generation)
})

it('excludes foreign writers and local appends throughout an asynchronous publication', async () => {
  const f = await fixture('none'); await f.writer.flush()
  const observed = await f.provider.observeDurable(f.session.id), foreign = await f.mount()
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const publication = f.provider.withGeneration(f.session.id, observed.generation, async () => {
    entered.resolve(undefined); await release.promise; return 'committed'
  })
  await entered.promise
  await expect(foreign.open(f.session.id, 'write')).rejects.toThrow('already')
  await expect(foreign.observeDurable(f.session.id)).rejects.toThrow('already')
  let appended = false
  const append = f.append('after admission').then(() => { appended = true })
  await Promise.resolve(); expect(appended).toBe(false)
  release.resolve(undefined); expect(await publication).toBe('committed'); await append
  expect((await f.provider.observeDurable(f.session.id)).durableThrough).toBe(0)
})

it('assigns a copied restore a new generation without changing the source', async () => {
  const f = await fixture('none'); await f.append('retained'); await f.writer.close()
  const before = await f.provider.observeDurable(f.session.id)
  const path = generationLogPath(f.root, undefined, f.session.id, f.session.header.version, 'none')
  const bytes = await readFile(path)
  const targetRoot = join(f.root, 'restore'), target = generationLogPath(targetRoot, undefined, f.session.id, f.session.header.version, 'none')
  await mkdir(dirname(target), { recursive: true }); await copyFile(path, target)
  const restored = await f.mount(targetRoot), after = await restored.observeDurable(f.session.id)
  expect(after.generation).not.toBe(before.generation)
  expect(after.events).toEqual(before.events)
  let published = false
  await expect(restored.withGeneration(f.session.id, before.generation, async () => { published = true })).rejects.toThrow('SESSION_GENERATION_CONFLICT')
  expect(published).toBe(false); expect(await readFile(path)).toEqual(bytes)
})

it('preserves a completed publication result when releasing its cold lease reports a failure', async () => {
  const f = await fixture('none'); await f.writer.flush(); await f.writer.close()
  const observed = await f.provider.observeDurable(f.session.id)
  const release = vi.spyOn(SessionWriteLease.prototype, 'release')
  const original = release.getMockImplementation()!
  release.mockImplementation(async function (this: SessionWriteLease) {
    await original.call(this)
    throw new Error('SYNTHETIC_POST_RELEASE_FAILURE')
  })
  try {
    expect(await f.provider.withGeneration(f.session.id, observed.generation, async () => 'committed')).toBe('committed')
  } finally { release.mockRestore() }
})

it('retains the historical identity for read conversion and changes it only at write migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-durable-history-')), ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const id = SessionId('historical'), path = generationLogPath(root, undefined, id, 3, 'none')
  const bytes = JSON.stringify({ type: 'session', version: 3, id, createdAt: 1, delegationDepth: 0, isSeeded: false }) + '\n'
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const before = await ctx.sessionPersistence.observeDurable(id)
  await expect(ctx.sessionPersistence.withGeneration(id, before.generation, async () => 'unpublished')).rejects.toThrow('SESSION_GENERATION_MIGRATION_REQUIRED')
  const reader = await ctx.sessionPersistence.open(id, 'read'); await reader.close()
  expect((await ctx.sessionPersistence.observeDurable(id)).generation).toBe(before.generation)
  const writer = await ctx.sessionPersistence.open(id, 'write'); await writer.close()
  expect((await ctx.sessionPersistence.observeDurable(id)).generation).not.toBe(before.generation)
  await expect(ctx.sessionPersistence.withGeneration(id, before.generation, async () => 'stale')).rejects.toThrow('SESSION_GENERATION_CONFLICT')
  expect(await readFile(path, 'utf8')).toBe(bytes)
})
