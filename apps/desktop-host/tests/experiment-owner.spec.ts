/** Real isolated Shell/T11/native-quota reads and immutable archives; no Agent or provider request is created. */
import { randomUUID } from 'node:crypto'
import { link, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { TaskComparisonOwner } from '../src/experiments/owner.ts'
import { TaskComparisonStore, parseComparisonRecord } from '../src/experiments/records.ts'
import type { TaskComparison } from '../src/experiments/comparison.ts'
import type { VerificationView } from '../src/workbench/verification.ts'
import { verificationFixture } from './verification-fixture.ts'

async function fixture() {
  const f = await verificationFixture(), owner = new TaskComparisonOwner(f.verification, f.home, f.storage)
  onTestFinished(() => owner.close())
  const a = await f.run(), b = await f.run()
  const selection = { experimentId: randomUUID(), caseId: randomUUID(), factor: 'cache',
    a: { workspace: f.workspace, runId: a.id }, b: { workspace: f.workspace, runId: b.id } }
  const store = new TaskComparisonStore(f.home, f.storage)
  return { ...f, owner, store, selection, a, b }
}
it.skipIf(process.platform !== 'win32')('consumes two actual receipts and independent acceptance, then observes a cold immutable archive without replay', async () => {
  const f = await fixture(), id = randomUUID()
  const result = await f.owner.request('compare', { selection: f.selection })
  expect(result).toMatchObject({ verification: 'MATCHED', task: 'UNKNOWN', quality: 'UNKNOWN',
    counts: { requests: { a: null, b: null, missing: 2 }, tests: { a: 1, b: 1, missing: 0 } } })
  await expect(readdir(join(f.home, 'nidofy-extras', 'experiments'))).rejects.toMatchObject({ code: 'ENOENT' })
  await f.verification.accept(f.workspace, f.a.id, 0, 'ACCEPTED')
  await f.owner.request('record', { id, selection: f.selection })
  const path = join(f.store.directory, id + '.json'), bytes = await readFile(path)
  expect(parseComparisonRecord(bytes.toString('utf8')).checkpoints.a).toMatchObject({ acceptanceRevision: 1,
    receipt: { runId: f.a.id, tests: 'PASSED', acceptance: 'ACCEPTED' } })
  await expect(f.owner.request('record', { id, selection: f.selection })).rejects.toThrow('EXPERIMENT_RECORD_EXISTS')
  const cold = new TaskComparisonOwner(f.verification, f.home, f.storage)
  onTestFinished(() => cold.close())
  expect(await cold.request('read', { id })).toMatchObject({ changedSinceRecord: false, comparison: { quality: 'UNKNOWN' } })
  await f.verification.accept(f.workspace, f.b.id, 0, 'ACCEPTED')
  expect(await cold.request('read', { id })).toMatchObject({ changedSinceRecord: true,
    record: { checkpoints: { b: { acceptanceRevision: 0, receipt: { acceptance: 'PENDING' } } } },
    comparison: { quality: 'BOTH_ACCEPTED', task: 'UNKNOWN', efficiencyEligible: false } })
  expect(await readFile(path)).toEqual(bytes)
  await writeFile(join(f.workspace, 'inputs/case.json'), '{"tolerance":1}')
  expect(await cold.request('read', { id })).toMatchObject({ comparison: { task: 'NOT_COMPARABLE' } })
  expect(await readFile(path)).toEqual(bytes)
  expect(f.counts()).toEqual({ commands: 2, preparations: 2 })
}, 60000)

it.skipIf(process.platform !== 'win32')('refuses a complete oversized comparison before creating an archive and preserves original receipts', async () => {
  const f = await fixture(), first = await f.verification.inspect(f.workspace, f.a.id)
  const second = await f.verification.inspect(f.workspace, f.b.id)
  if (!first.receipt) throw Error('Expected actual receipt')
  const original = structuredClone(first)
  const large = structuredClone(first)
  if (!large.receipt) throw Error('Expected actual receipt')
  large.receipt.artifacts = Array.from({ length: 20 }, () => ({ runId: large.receipt!.runId, path: 'p'.repeat(4096),
    observation: 'missing', digest: null, bytes: null }))
  const owner = new TaskComparisonOwner({ inspect: (_workspace, id) => Promise.resolve(id === f.a.id ? large : second) }, f.home, f.storage)
  onTestFinished(() => owner.close())
  await expect(owner.request('record', { id: randomUUID(), selection: f.selection })).rejects.toThrow('EXPERIMENT_COMPARISON_LIMIT')
  expect(await f.store.list()).toEqual([])
  expect(first).toEqual(original); expect(f.counts().commands).toBe(2)
}, 60000)

it.skipIf(process.platform !== 'win32')('validates complete import size/version/source and rechecks every selected actual receipt without executing', async () => {
  const f = await fixture(), id = randomUUID()
  const saved = await f.owner.request('record', { id, selection: f.selection })
  const record = parseComparisonRecord(JSON.stringify(saved)), imported = { ...record, id: randomUUID() }
  await f.owner.request('import', { report: JSON.stringify(imported) })
  expect(await f.owner.request('read', { id: imported.id })).toMatchObject({ changedSinceRecord: false })
  await expect(f.owner.request('import', { report: JSON.stringify(imported) })).rejects.toThrow('EXPERIMENT_RECORD_EXISTS')
  const before = await readdir(f.store.directory)
  await expect(f.owner.request('import', { report: JSON.stringify({ ...record, schemaVersion: 2 }) })).rejects.toThrow('EXPERIMENT_VERSION_UNSUPPORTED')
  await expect(f.owner.request('import', { report: JSON.stringify({ ...record, source: 'diagnostic-archive' }) })).rejects.toThrow('EXPERIMENT_SOURCE_REFUSED')
  await expect(f.owner.request('import', { report: JSON.stringify({ ...record, tokens: 0 }) })).rejects.toThrow('EXPERIMENT_RECORD_INVALID')
  await expect(f.owner.request('import', { report: ' '.repeat(64 * 1024 + 1) })).rejects.toThrow('EXPERIMENT_RECORD_LIMIT')
  const forged = structuredClone(record)
  if (!forged.checkpoints.a.receipt) throw Error('Expected actual checkpoint')
  forged.checkpoints.a.receipt.inputFingerprint = 'f'.repeat(64)
  await expect(f.owner.request('import', { report: JSON.stringify({ ...forged, id: randomUUID() }) }))
    .rejects.toThrow('EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
  await f.verification.accept(f.workspace, f.a.id, 0, 'ACCEPTED')
  await expect(f.owner.request('import', { report: JSON.stringify({ ...record, id: randomUUID() }) }))
    .rejects.toThrow('EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
  expect(await readdir(f.store.directory)).toEqual(before)
  expect(f.counts().commands).toBe(2)
}, 60000)

it.skipIf(process.platform !== 'win32')('bounds concurrent archive admission and retains damaged/future bytes without pruning original records', async () => {
  const f = await fixture(), ids: string[] = []
  for (let index = 0; index < 19; index++) {
    const id = randomUUID(); ids.push(id); await f.owner.request('record', { id, selection: f.selection })
  }
  const cold = new TaskComparisonOwner(f.verification, f.home, f.storage)
  onTestFinished(() => cold.close())
  const admissions = await Promise.allSettled([f.owner.request('record', { id: randomUUID(), selection: f.selection }),
    cold.request('record', { id: randomUUID(), selection: f.selection })])
  expect(admissions.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect(admissions.filter(row => row.status === 'rejected')).toHaveLength(1)
  expect(await f.store.list()).toHaveLength(20)
  const path = join(f.store.directory, ids[0]! + '.json'), original = await readFile(path)
  await expect(f.owner.request('record', { id: randomUUID(), selection: f.selection })).rejects.toThrow('EXPERIMENT_HISTORY_LIMIT')
  expect(await readFile(path)).toEqual(original)
  const unsupported = JSON.stringify({ ...JSON.parse(original.toString('utf8')), schemaVersion: 99 })
  await writeFile(path, unsupported)
  await expect(f.owner.request('list', {})).rejects.toThrow('EXPERIMENT_VERSION_UNSUPPORTED')
  await expect(f.owner.request('record', { id: randomUUID(), selection: f.selection })).rejects.toThrow('EXPERIMENT_VERSION_UNSUPPORTED')
  expect(await readFile(path, 'utf8')).toBe(unsupported)
  expect(f.counts().commands).toBe(2)
}, 60000)

it.skipIf(process.platform !== 'win32')('drains a held real receipt read on unload and never publishes its late result', async () => {
  const f = await fixture()
  let release!: (view: VerificationView) => void
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const owner = new TaskComparisonOwner({ inspect: async () => {
    entered(); return new Promise((resolve) => { release = resolve })
  } }, f.home, f.storage)
  const pending = owner.request('record', { id: randomUUID(), selection: f.selection })
  void pending.catch(() => { /* Assert the same rejection after draining. */ })
  await ready
  let drained = false
  const close = owner.close().then(() => { drained = true })
  await Promise.resolve(); expect(drained).toBe(false)
  release(await f.verification.inspect(f.workspace, f.a.id))
  await expect(pending).rejects.toThrow(); await close
  expect(drained).toBe(true)
  await expect(owner.request('compare', { selection: f.selection })).rejects.toThrow('EXPERIMENT_STOPPING')
  expect(await f.store.list()).toEqual([])
  expect(f.counts().commands).toBe(2)
}, 60000)

it.skipIf(process.platform !== 'win32')('counts retained residue and refuses hardlinked archives without deleting or executing', async () => {
  const f = await fixture(), id = randomUUID()
  await f.owner.request('record', { id, selection: f.selection })
  const path = join(f.store.directory, id + '.json'), bytes = await readFile(path)
  const linked = join(f.home, 'nidofy-extras', 'record-link.json')
  await link(path, linked)
  await expect(f.owner.request('read', { id })).rejects.toThrow('EXPERIMENT_RECORD_INVALID')
  await expect(f.owner.request('record', { id: randomUUID(), selection: f.selection })).rejects.toThrow('EXPERIMENT_HISTORY_INVALID')
  expect(await readFile(path)).toEqual(bytes); await unlink(linked)
  const residue = join(f.store.directory, randomUUID() + '.json.' + randomUUID() + '.tmp')
  await writeFile(residue, Buffer.alloc(22 * 64 * 1024 + 4096 - bytes.length))
  await expect(f.owner.request('record', { id: randomUUID(), selection: f.selection })).rejects.toThrow('EXPERIMENT_HISTORY_LIMIT')
  expect(await readFile(path)).toEqual(bytes)
  expect((await readdir(f.store.directory)).sort()).toEqual([id + '.json', residue.split(/[\\/]/).at(-1)!].sort())
  expect(f.counts().commands).toBe(2)
}, 60000)

it.skipIf(process.platform !== 'win32')('keeps a legacy selection unknown and refuses imported claims or execution fields', async () => {
  const f = await fixture(), legacy = { ...f.selection, a: { ...f.selection.a, runId: randomUUID() } }
  const result = await f.owner.request('compare', { selection: legacy }) as TaskComparison
  expect(result).toMatchObject({ task: 'UNKNOWN', quality: 'UNKNOWN', a: { phase: 'LEGACY', receipt: null } })
  const saved = await f.owner.request('record', { id: randomUUID(), selection: legacy })
  const record = parseComparisonRecord(JSON.stringify(saved))
  await expect(f.owner.request('import', { report: JSON.stringify({ ...record, id: randomUUID() }) }))
    .rejects.toThrow('EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
  await expect(f.owner.request('compare', { selection: f.selection, accepted: true, requests: 5 })).rejects.toThrow('EXPERIMENT_INPUT_INVALID')
  await expect(f.owner.request('start', { selection: f.selection })).rejects.toThrow('EXPERIMENT_INPUT_INVALID')
  expect(f.counts().commands).toBe(2)
}, 60000)
