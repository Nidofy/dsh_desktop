/** Real retained synthetic files exercise checkpoint refusals; these measurements never certify runtime peaks. */
import { lstat, mkdir, mkdtemp, link, symlink, writeFile, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionPersistenceGeneration, SessionPersistenceRevision, type SessionDurableObservation } from '@deepseek-ai/dsh-session-persistence'
import { EngineeringResourceOwner, parseEngineeringResourceBudget, measureEngineeringWorkspace,
  parseEngineeringResourceAllocation, parseEngineeringResourceResult, engineeringSessionBytes,
  observeEngineeringSession,
  validateEngineeringResourceSession,
  engineeringDirectoryNames,
  type EngineeringResourceBudget, type EngineeringResourceAllocation } from '../src/experiments/engineering-resources.ts'
const budget: EngineeringResourceBudget = { workspaceBytes: 64, workspaceEntries: 8, retainedWorkspaceBytes: 128,
  sessionBytes: 4096, sessionDiskBytes: 4096, sessionEvents: 4 }
const signal = () => new AbortController().signal
async function fixture(selected = budget) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-engineering-resource-')), info = await lstat(root, { bigint: true })
  const allocation: EngineeringResourceAllocation = { schemaVersion: 1, kind: 'engineering-resource-allocation', id: randomUUID(),
    workspace: join(root, 'project'), identity: `${info.dev}:${info.ino}`, budget: selected }
  const index = resolve('.build/dispatch/evidence/relay-27/input-roots')
  await mkdir(index, { recursive: true })
  await writeFile(join(index, allocation.id + '.json'), JSON.stringify({ root, allocation, synthetic: true, retained: true,
    paidRequests: 0, actualAgents: 0, actualActions: 0 }) + '\n', { flag: 'wx' })
  return { root, allocation, owner: new EngineeringResourceOwner(allocation) }
}
function durable(): SessionDurableObservation {
  return { meta: { version: SESSION_FORMAT_VERSION, id: SessionId('synthetic-resource-session'), createdAt: 1, isSeeded: false },
    inheritedEventCount: SessionLogOffset(0), events: [], durableThrough: -1, generation: SessionPersistenceGeneration('synthetic-generation') }
}
it('requires every independent limit and rejects unsafe, foreign or incompatible resource budgets', () => {
  expect(parseEngineeringResourceBudget(budget)).toEqual(budget)
  const { sessionDiskBytes: _disk, ...missing } = budget
  for (const row of [missing, { ...budget, extra: 1 }, { ...budget, workspaceBytes: 0 },
    { ...budget, retainedWorkspaceBytes: 63 }, { ...budget, workspaceEntries: 4097 }, { ...budget, sessionBytes: NaN }]) {
    expect(() => parseEngineeringResourceBudget(row)).toThrow()
  }
})
it('observes zero only for an actual empty allocation, then includes all copied input and later binary/multibyte output', async () => {
  const f = await fixture()
  expect(await measureEngineeringWorkspace(f.allocation, signal())).toEqual({ bytes: 0, entries: 0, identity: null })
  await mkdir(f.allocation.workspace)
  await writeFile(join(f.allocation.workspace, 'input.txt'), '完整输入')
  const before = await f.owner.workspace('copy', signal())
  expect(before.bytes).toBe(Buffer.byteLength('完整输入'))
  await writeFile(join(f.allocation.workspace, 'later.bin'), Buffer.from([0, 255, 1]))
  const after = await f.owner.workspace('after-tool', signal())
  expect(after.bytes).toBe(before.bytes + 3); expect(after.entries).toBe(3)
  expect(parseEngineeringResourceResult(f.owner.result(), f.allocation)).toEqual(f.owner.result())
  expect(f.owner.result()).toMatchObject({ diskPeakBytes: null, memoryPeakBytes: null })
})
it('accepts exact byte/entry limits and refuses one more output byte without cropping or removing retained files', async () => {
  const f = await fixture({ ...budget, workspaceBytes: 3, workspaceEntries: 2 })
  await mkdir(f.allocation.workspace); const path = join(f.allocation.workspace, 'output.bin')
  await writeFile(path, Buffer.from([0, 1, 2])); await f.owner.workspace('copy', signal())
  await writeFile(path, Buffer.from([0, 1, 2, 3]))
  await expect(f.owner.workspace('after-tool', signal())).rejects.toThrow('EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
  expect(await readFile(path)).toEqual(Buffer.from([0, 1, 2, 3]))
  expect(f.owner.result().checkpoints.at(-1)).toMatchObject({ workspace: null, diagnostic: 'EXPERIMENT_RESOURCE_WORKSPACE_LIMIT' })
})
it('bounds complete directory iteration and preserves every entry when enumeration is refused', async () => {
  const f = await fixture({ ...budget, workspaceEntries: 2 })
  await mkdir(f.allocation.workspace)
  await writeFile(join(f.allocation.workspace, 'one'), ''); await writeFile(join(f.allocation.workspace, 'two'), '')
  await expect(measureEngineeringWorkspace(f.allocation, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
  expect((await readdir(f.allocation.workspace)).sort()).toEqual(['one', 'two'])
})
it('rejects hardlinks and linked project roots while leaving their original target untouched', async () => {
  const f = await fixture(), target = await fixture()
  await mkdir(f.allocation.workspace); const file = join(f.allocation.workspace, 'one')
  await writeFile(file, 'original'); await link(file, join(f.allocation.workspace, 'two'))
  await expect(measureEngineeringWorkspace(f.allocation, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_PATH_REFUSED')
  await symlink(f.allocation.workspace, target.allocation.workspace, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(measureEngineeringWorkspace(target.allocation, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_PATH_REFUSED')
  expect(await readFile(file, 'utf8')).toBe('original')
})
it('refuses missing/foreign physical owners, extra allocation children and cancellation without returning partial zero', async () => {
  const f = await fixture()
  expect(() => parseEngineeringResourceAllocation({ ...f.allocation, schemaVersion: 2 }, f.allocation.id, f.allocation.workspace)).toThrow()
  await expect(measureEngineeringWorkspace({ ...f.allocation, identity: '0:0' }, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_PATH_CHANGED')
  await mkdir(join(f.root, 'foreign'))
  await expect(measureEngineeringWorkspace(f.allocation, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_PATH_REFUSED')
  const cancelled = new AbortController(); cancelled.abort(Error('CANCELLED'))
  const empty = await fixture()
  await expect(measureEngineeringWorkspace(empty.allocation, cancelled.signal)).rejects.toThrow('CANCELLED')
})
it('counts complete logical Session bytes separately from official physical lengths and refuses missing disk observations', async () => {
  const f = await fixture(), observation = durable(), bytes = engineeringSessionBytes(observation, -1)
  const storage = { header: observation.meta, revision: SessionPersistenceRevision('synthetic-revision'), sizeBytes: 7 }
  f.owner.session(observation, storage, 'request')
  expect(f.owner.result().checkpoints[0]?.session).toMatchObject({ bytes, diskBytes: 7, events: 0, through: -1 })
  expect(parseEngineeringResourceResult(f.owner.result(), f.allocation)).toEqual(f.owner.result())
  expect(() => { f.owner.session(observation, { ...storage, sizeBytes: 4097 }, 'request') }).toThrow('EXPERIMENT_RESOURCE_SESSION_LIMIT')
  expect(() => { f.owner.session(observation, { header: storage.header, revision: storage.revision }, 'request') })
    .toThrow('EXPERIMENT_RESOURCE_SESSION_STORAGE_UNKNOWN')
  const exact = await fixture({ ...budget, sessionBytes: bytes })
  exact.owner.session(observation, storage, 'drained')
  const small = await fixture({ ...budget, sessionBytes: bytes - 1 })
  expect(() => { small.owner.session(observation, storage, 'request') }).toThrow('EXPERIMENT_RESOURCE_SESSION_LIMIT')
})
it('rejects forged peak claims and altered complete counters without synthesizing observations for an old record', async () => {
  const f = await fixture(); await mkdir(f.allocation.workspace); await f.owner.workspace('copy', signal())
  const result = f.owner.result()
  expect(() => parseEngineeringResourceResult({ ...result, diskPeakBytes: 0 }, f.allocation)).toThrow('EXPERIMENT_RESOURCE_RECORD_INVALID')
  const changed = structuredClone(result); changed.checkpoints[0]!.workspace!.entries = 100
  expect(() => parseEngineeringResourceResult(changed, f.allocation)).toThrow('EXPERIMENT_RESOURCE_RECORD_INVALID')
  expect(() => parseEngineeringResourceResult({ ...result, schemaVersion: 2 }, f.allocation)).toThrow('EXPERIMENT_RESOURCE_RECORD_INVALID')
})
it('refuses missing, excessive or foreign physical metadata before invoking the complete durable decoder', async () => {
  const observation = durable(), revision = SessionPersistenceRevision('synthetic-preflight')
  const decode = vi.fn(async () => observation)
  for (const storage of [undefined, { header: observation.meta, revision },
    { header: observation.meta, revision, sizeBytes: 4097 }, { header: observation.meta, revision, sizeBytes: NaN },
    { header: { ...observation.meta, id: SessionId('foreign') }, revision, sizeBytes: 0 },
    { header: observation.meta, revision, sizeBytes: 7, eventCount: 5 }]) {
    await expect(observeEngineeringSession({ stat: async () => storage, observeDurable: decode }, observation.meta.id,
      budget, signal())).rejects.toThrow('EXPERIMENT_RESOURCE_SESSION_')
  }
  expect(decode).not.toHaveBeenCalled()
  const f = await fixture()
  await expect(f.owner.observe({ stat: async () => ({ header: observation.meta, revision, sizeBytes: 4097 }),
    observeDurable: decode }, observation.meta.id, 'request', signal())).rejects.toThrow('EXPERIMENT_RESOURCE_SESSION_LIMIT')
  expect(f.owner.result().checkpoints).toEqual([{ phase: 'request', workspace: null, session: null,
    diagnostic: 'EXPERIMENT_RESOURCE_SESSION_LIMIT' }])
  expect(parseEngineeringResourceResult(f.owner.result(), f.allocation)).toEqual(f.owner.result())
})
it('accepts actual physical zero and exact logical limits while refusing logical growth before Session construction', async () => {
  const observation = durable(), revision = SessionPersistenceRevision('synthetic-preflight')
  const owner = { stat: async () => ({ header: observation.meta, revision, sizeBytes: 0 }), observeDurable: vi.fn(async () => observation) }
  const exact = { ...budget, sessionBytes: engineeringSessionBytes(observation, -1) }
  expect(await observeEngineeringSession(owner, observation.meta.id, exact, signal())).toBe(observation)
  await expect(observeEngineeringSession(owner, observation.meta.id, { ...exact, sessionBytes: exact.sessionBytes - 1 }, signal()))
    .rejects.toThrow('EXPERIMENT_RESOURCE_SESSION_LIMIT')
  const controller = new AbortController(); controller.abort(Error('CANCELLED'))
  owner.observeDurable.mockClear()
  await expect(observeEngineeringSession(owner, observation.meta.id, exact, controller.signal)).rejects.toThrow('CANCELLED')
  expect(owner.observeDurable).not.toHaveBeenCalled()
})
it('rejects changed metadata after an official durable read without publishing a stable snapshot', async () => {
  const observation = durable(), before = { header: observation.meta, revision: SessionPersistenceRevision('before'), sizeBytes: 7 }
  for (const after of [undefined, { ...before, revision: SessionPersistenceRevision('after') }, { ...before, sizeBytes: 8 }]) {
    const stat = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    await expect(observeEngineeringSession({ stat, observeDurable: async () => observation }, observation.meta.id, budget, signal()))
      .rejects.toThrow('EXPERIMENT_RESOURCE_SESSION_STORAGE_CHANGED')
  }
})
it('revalidates original Session observations even when no request cut exists, including actual drained physical growth', async () => {
  const f = await fixture(), observation = durable()
  const physical = { header: observation.meta, revision: SessionPersistenceRevision('drained'), sizeBytes: 7 }
  f.owner.session(observation, physical, 'drained')
  expect(() => { validateEngineeringResourceSession(observation, physical, f.owner.result()) }).not.toThrow()
  for (const storage of [undefined, { ...physical, sizeBytes: 8 }]) {
    expect(() => { validateEngineeringResourceSession(observation, storage, f.owner.result()) }).toThrow('EXPERIMENT_RESOURCE_RECORD_INVALID')
  }
  expect(() => { validateEngineeringResourceSession({ ...observation, generation: SessionPersistenceGeneration('changed') },
    physical, f.owner.result()) }).toThrow('EXPERIMENT_RESOURCE_RECORD_INVALID')
  expect(f.owner.result()).toMatchObject({ diskPeakBytes: null, memoryPeakBytes: null })
})
it('bounds complete journal directory listings, sorts exact limits and retains unknown residue on refusal', async () => {
  const f = await fixture(); await mkdir(f.allocation.workspace)
  for (const name of ['z.json', 'a.json', 'm.tmp']) await writeFile(join(f.allocation.workspace, name), name)
  const refusal = 'EXPERIMENT_RESOURCE_DIRECTORY_LIMIT'
  expect(await engineeringDirectoryNames(f.allocation.workspace, 3, signal(), refusal)).toEqual(['a.json', 'm.tmp', 'z.json'])
  await expect(engineeringDirectoryNames(f.allocation.workspace, 2, signal(), refusal)).rejects.toThrow(refusal)
  expect((await readdir(f.allocation.workspace)).sort()).toEqual(['a.json', 'm.tmp', 'z.json'])
  const cancelled = new AbortController(); cancelled.abort(Error('CANCELLED'))
  await expect(engineeringDirectoryNames(f.allocation.workspace, 3, cancelled.signal, refusal)).rejects.toThrow('CANCELLED')
  expect(await engineeringDirectoryNames(f.allocation.workspace, 3, undefined, refusal)).toEqual(['a.json', 'm.tmp', 'z.json'])
})
