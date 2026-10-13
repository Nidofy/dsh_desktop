/** Durable T19 ordering, cold recovery, refusal and cancellation, using real files and a controlled check provider. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { StorageService, QuotaLeaseId, ManagedRootId, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { SelfTestStore } from '../src/selftest/store.ts'
import { SelfTestRunner } from '../src/selftest/runner.ts'
import type { LocalChecks } from '../src/selftest/runner.ts'
import type { CheckId, SelfTestReport } from '../src/selftest/types.ts'

async function fixture(create: (store: SelfTestStore, id: string) => LocalChecks) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selftest-store-')), home = join(root, 'home')
  await mkdir(home)
  const writes: string[] = []
  const storage: Pick<StorageService, 'reserve' | 'write'> = {
    write: async (path, _bytes, work) => { writes.push(path); return work() },
    reserve: async (_scope, maxWriteBytes, terminalBytes, operationId) => ({
      id: brandString<QuotaLeaseId>(randomUUID()), rootId: brandString<ManagedRootId>('synthetic-root'),
      operationId: operationId ?? brandString<StorageOperationId>(randomUUID()), reservedBytes: maxWriteBytes, terminalBytes,
      run: work => work(), terminal: work => work(), release: async () => ({ status: 'unknown' }),
    }),
  }
  const store = new SelfTestStore(home, storage), runner = new SelfTestRunner(store, storage, id => create(store, id))
  onTestFinished(async () => { await runner.close(); await rm(root, { recursive: true, force: true }) })
  return { root, home, store, runner, storage, writes }
}
const unsupported = (): LocalChecks => ({ open: async () => {}, check: async () => ({ status: 'UNKNOWN', code: 'NOT_IMPLEMENTED', metrics: {} }), close: async () => {} })
async function complete(runner: SelfTestRunner, id: string): Promise<SelfTestReport> {
  await expect.poll(async () => (await runner.read(id))?.status, { timeout: 10000 }).not.toBe('RUNNING')
  const report = await runner.read(id)
  if (!report) throw Error('Expected retained report')
  return report
}

it('commits the run and each check intent before construction/execution, while COMPLETED retains UNKNOWN field evidence', async () => {
  const executed: CheckId[] = []
  const f = await fixture((store, id) => {
    return { open: async () => {
      const persisted: unknown = JSON.parse(await readFile(join(store.directory, id + '.json'), 'utf8'))
      expect(persisted).toMatchObject({ status: 'RUNNING' })
    },
    check: async (check) => {
      const persisted = await store.read(id)
      expect(persisted?.rows.find(row => row.id === check)).toMatchObject({ id: check,
        phase: 'RUNNING', status: 'UNKNOWN', code: 'PROCESS_INTERRUPTED', durationMs: null, metrics: {} })
      executed.push(check); return { status: 'UNKNOWN', code: 'NOT_IMPLEMENTED', metrics: { requests: 0 } }
    }, close: async () => {} }
  })
  const id = randomUUID(), initial = await f.runner.start({ mode: 'local', operationId: id })
  expect(initial.status).toBe('RUNNING')
  const report = await complete(f.runner, id)
  expect(report.status).toBe('COMPLETED'); expect(executed).toHaveLength(18)
  expect(report.rows.slice(-2).map(row => [row.status, row.code])).toEqual([['UNKNOWN', 'FIELD_UNVERIFIED'], ['UNKNOWN', 'FIELD_UNVERIFIED']])
  expect(report.rows.filter(row => row.status === 'PASS')).toEqual([])
  await expect(f.runner.start({ mode: 'provider', operationId: randomUUID() })).rejects.toThrow('SELFTEST_MODE_UNAVAILABLE')
  expect(JSON.stringify(await f.runner.request('export', { id }))).not.toContain(id)
})

it('cold-reads an unsettled row as unknown without touching its bytes or replaying any check', async () => {
  const started = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>(), calls: CheckId[] = []
  const f = await fixture(() => ({ ...unsupported(), check: async (id, signal) => {
    calls.push(id); started.resolve(undefined); await release.promise; signal.throwIfAborted()
    return { status: 'PASS', code: 'OK', metrics: {} }
  } }))
  const id = randomUUID(); await f.runner.start({ mode: 'local', operationId: id }); await started.promise
  const before = await readFile(join(f.store.directory, id + '.json'))
  const cold = new SelfTestStore(f.home, f.storage), recovered = await cold.read(id)
  expect(recovered?.status).toBe('INTERRUPTED')
  expect(recovered?.rows[0]).toMatchObject({ status: 'UNKNOWN', code: 'PROCESS_INTERRUPTED' })
  expect(recovered?.rows[1]).toMatchObject({ status: 'SKIPPED', code: 'PROCESS_INTERRUPTED' })
  expect(await readFile(join(f.store.directory, id + '.json'))).toEqual(before)
  expect(calls).toEqual(['node'])
  const cancelled = f.runner.cancel(id); release.resolve(undefined); await cancelled
  expect((await f.runner.read(id))?.status).toBe('CANCELLED')
})

it('waits for the cancelled check and provider teardown before settling, with no later checks', async () => {
  const entered = Promise.withResolvers<undefined>(), drained = Promise.withResolvers<undefined>()
  const close = Promise.withResolvers<undefined>(), calls: CheckId[] = []
  const f = await fixture(() => ({ open: async () => {}, check: async (id, signal) => {
    calls.push(id); entered.resolve(undefined)
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    await drained.promise; signal.throwIfAborted(); return { status: 'PASS', code: 'OK', metrics: {} }
  }, close: async () => close.promise }))
  const id = randomUUID(); await f.runner.start({ mode: 'local', operationId: id }); await entered.promise
  let done = false; const cancellation = f.runner.cancel(id).then(() => { done = true })
  await Promise.resolve(); expect(done).toBe(false)
  drained.resolve(undefined); await Promise.resolve(); expect(done).toBe(false)
  close.resolve(undefined); await cancellation
  expect(calls).toEqual(['node']); expect((await f.runner.read(id))?.status).toBe('CANCELLED')
})

it('stops before constructing a provider when initial persistence or native admission is refused', async () => {
  const create = vi.fn(unsupported), f = await fixture(() => create())
  const write = vi.spyOn(f.storage, 'write').mockRejectedValueOnce(Error('SYNTHETIC_WRITE_UNKNOWN'))
  await expect(f.runner.start({ mode: 'local', operationId: randomUUID() })).rejects.toThrow('SYNTHETIC_WRITE_UNKNOWN')
  expect(create).not.toHaveBeenCalled(); write.mockRestore()
  vi.spyOn(f.storage, 'reserve').mockRejectedValueOnce(Error('STORAGE_RESERVE_FAILED'))
  await expect(f.runner.start({ mode: 'local', operationId: randomUUID() })).rejects.toThrow('STORAGE_RESERVE_FAILED')
  expect(create).not.toHaveBeenCalled()
})

it('publishes no uncommitted result and does not repeat an uncertain checkpoint or its side effects', async () => {
  const calls: CheckId[] = [], f = await fixture(() => ({ ...unsupported(), check: async (id) => {
    calls.push(id); return { status: 'PASS', code: 'OK', metrics: {} }
  } }))
  const actual = f.storage.write.bind(f.storage); let writes = 0
  vi.spyOn(f.storage, 'write').mockImplementation(async (path, bytes, work) => {
    writes++; if (writes === 3) throw Error('SYNTHETIC_COMMIT_UNKNOWN'); return actual(path, bytes, work)
  })
  const id = randomUUID(); await f.runner.start({ mode: 'local', operationId: id })
  const report = await complete(f.runner, id)
  expect(report.status).toBe('INTERRUPTED'); expect(report.rows[0]?.status).toBe('UNKNOWN')
  expect(calls).toEqual(['node']); expect(writes).toBe(3)
  await expect(f.runner.start({ mode: 'local', operationId: id })).rejects.toThrow('SELFTEST_RUN_EXISTS')
  expect(calls).toEqual(['node'])
})

it('retains future and damaged bytes and refuses exports with private fields or forged PASS facts', async () => {
  const f = await fixture(unsupported), id = randomUUID(); await f.runner.start({ mode: 'local', operationId: id })
  const report = await complete(f.runner, id), path = join(f.store.directory, id + '.json')
  expect(() => f.store.export({ ...report, rows: report.rows.map((row, i) => i === 0
    ? { ...row, status: 'PASS', code: 'NOT_IMPLEMENTED' } : row) })).toThrow('SELFTEST_RECORD_INVALID')
  const polluted = Object.assign(structuredClone(report), { credential: 'synthetic-private-key' })
  expect(() => f.store.export(polluted)).toThrow('SELFTEST_RECORD_INVALID')
  const future = JSON.stringify({ ...report, schemaVersion: 99 }); await writeFile(path, future)
  await expect(f.store.read(id)).rejects.toThrow('SELFTEST_VERSION_UNSUPPORTED')
  await expect(f.runner.start({ mode: 'local', operationId: randomUUID() })).rejects.toThrow('SELFTEST_VERSION_UNSUPPORTED')
  expect(await readFile(path, 'utf8')).toBe(future)
  await writeFile(path, '{broken'); await expect(f.store.list()).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('{broken')
})

it('bounds retention to twenty known terminal reports and never exports report identities or source text', async () => {
  const f = await fixture(unsupported), ids: string[] = []
  const templateId = randomUUID(); await f.runner.start({ mode: 'local', operationId: templateId })
  const template = await complete(f.runner, templateId)
  // Retention belongs to the store; replaying every local check for each history row adds unrelated filesystem work.
  for (let index = 0; index < 21; index++) {
    const id = randomUUID(); ids.push(id)
    const intent: SelfTestReport = { ...structuredClone(template), id: f.store.identity(id), status: 'RUNNING', endedAt: null,
      startedAt: Date.now() + index }
    await f.store.save(intent, true)
    const terminal: SelfTestReport = { ...intent, status: 'COMPLETED', endedAt: intent.startedAt }
    await f.store.save(terminal)
    expect(Buffer.byteLength(JSON.stringify(f.store.export(terminal)))).toBeLessThan(65536)
  }
  expect(await f.store.list()).toHaveLength(20); expect(await f.store.read(ids[0]!)).toBeNull()
  const result = JSON.stringify(await f.runner.request('export', { id: ids[20] }))
  expect(result).not.toContain(f.home); expect(result).not.toContain(ids[20]!)
}, 20000)

it('counts temporary residue against the complete report-directory byte ceiling without deleting it', async () => {
  const f = await fixture(unsupported), id = randomUUID(); await f.runner.start({ mode: 'local', operationId: id })
  await complete(f.runner, id)
  const residue = join(f.store.directory, 'crash-residue.tmp'), bytes = Buffer.alloc(22 * 65536 + 4096)
  await writeFile(residue, bytes)
  await expect(f.store.list()).rejects.toThrow('SELFTEST_HISTORY_LIMIT')
  await expect(f.runner.start({ mode: 'local', operationId: randomUUID() })).rejects.toThrow('SELFTEST_HISTORY_LIMIT')
  expect(await readFile(residue)).toEqual(bytes)
})
