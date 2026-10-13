/** Production helper/ledger tests with isolated distribution roots and actual process lifetimes. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { fork, spawn } from 'node:child_process'
import { appendFile, copyFile, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { StorageService, callStorageHelper, type StorageOperationId } from '../src/storage.ts'
const executable = fileURLToPath(new URL('../../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url))
async function fixture(limitBytes = 1024 * 1024) {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-quota-')), home = join(root, 'harness'), ctx = new Context()
  await mkdir(home)
  const storage = new StorageService(ctx, home, { executable, limitBytes, safetyBytes: 1024 * 1024 })
  onTestFinished(async () => { await storage.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, home, storage }
}
it.skipIf(process.platform !== 'win32')('observes cached totals without recovering finished grants and keeps independent terminal space visible', async () => {
  const f = await fixture(), lease = await f.storage.reserve('node:management', 12000, 4000)
  await writeFile(join(f.home, 'unknown.file'), 'retained unknown data')
  await expect(lease.release()).rejects.toThrow('STORAGE_SCAN_INCOMPLETE')
  const ledger = join(f.root, '.nidofy-storage-v1', 'ledger.jsonl'), before = await readFile(ledger)
  const status = await f.storage.status()
  expect(status).toMatchObject({ measuredBytes: null, drained: null, scan: 'not-run', reservedBytes: 16000,
    ordinaryBytes: 12000, terminalBytes: 4000, pendingOperations: 1 })
  expect(await readFile(ledger)).toEqual(before)
  expect(JSON.stringify(status)).not.toContain('token')
  await unlink(join(f.home, 'unknown.file'))
  expect((await f.storage.status()).reservedBytes).toBe(16000)
  const recovered = await f.storage.recover()
  expect(recovered).toMatchObject({ drained: true, scan: 'complete', measuredBytes: 0, reservedBytes: 0 })
})
it.skipIf(process.platform !== 'win32')('confirms reservations, preserves terminals after lowering capacity and rescans failed residue', async () => {
  const f = await fixture(), lease = await f.storage.reserve('node:test', 600000, 65536)
  expect(Object.keys(lease)).not.toContain('token')
  expect(Object.keys(lease)).not.toContain('ordinaryLeft')
  expect((await f.storage.inspect(lease.operationId)).status).toBe('reserved')
  await f.storage.configure(1)
  await expect(f.storage.reserve('node:denied', 1, 1)).rejects.toThrow('STORAGE_RESERVE_FAILED')
  await mkdir(join(f.home, 'desktop-actions'))
  await lease.terminal(() => f.storage.write(join(f.home, 'desktop-actions', 'terminal.json'), 16,
    () => writeFile(join(f.home, 'desktop-actions', 'terminal.json'), 'done')))
  await lease.release()
  expect((await f.storage.inspect(lease.operationId)).status).toBe('settled')
  expect((await f.storage.recover()).measuredBytes).toBe(4)
})
it.skipIf(process.platform !== 'win32')('keeps unknown settlement charged until a complete scan succeeds', async () => {
  const f = await fixture(), lease = await f.storage.reserve('node:test', 600000, 65536)
  await writeFile(join(f.home, 'unknown.file'), 'unowned')
  await expect(lease.release()).rejects.toThrow('STORAGE_SCAN_INCOMPLETE')
  expect((await f.storage.inspect(lease.operationId)).status).toBe('reserved')
  await expect(f.storage.reserve('node:next', 600000, 1)).rejects.toThrow('STORAGE_RESERVE_FAILED')
  const ctx = new Context(), other = new StorageService(ctx, f.home, f.storage.config)
  onTestFinished(async () => { await other.close(); await ctx.fiber.dispose() })
  expect((await other.inspect(lease.operationId)).status).toBe('reserved')
  await expect(other.recover()).rejects.toThrow('STORAGE_SCAN_INCOMPLETE')
})
it.skipIf(process.platform !== 'win32')('serializes two real Hosts and recovers only after the reserved owner process exits', async () => {
  const f = await fixture()
  await f.storage.recover()
  const child = fork(fileURLToPath(new URL('./fixtures/quota-host.mjs', import.meta.url)), [executable, f.home, '700000'],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] })
  const closed = new Promise<void>(resolve => child.once('close', () => { resolve() }))
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await closed })
  const message = await new Promise<{ status: string; operationId: StorageOperationId }>((resolve, reject) => {
    child.once('message', (value) => { resolve(value as { status: string; operationId: StorageOperationId }) }); child.once('error', reject)
  })
  expect(message.status).toBe('reserved')
  // The parent has no reserve ACK/token; operation identity suffices for read-only inspection.
  expect((await f.storage.inspect(message.operationId)).status).toBe('reserved')
  await expect(f.storage.reserve('node:other-host', 700000, 1)).rejects.toThrow('STORAGE_RESERVE_FAILED')
  expect((await f.storage.recover()).drained).toBe(false)
  child.kill(); await closed
  expect((await f.storage.recover()).drained).toBe(true)
  expect((await f.storage.inspect(message.operationId)).status).toBe('settled')
  const lease = await f.storage.reserve('node:after-exit', 700000, 1); await lease.release()
})
it.skipIf(process.platform !== 'win32')('counts sibling imports and refuses native mutations without a Host capability', async () => {
  const f = await fixture()
  await mkdir(join(f.root, 'imports')); await writeFile(join(f.root, 'imports', 'retained'), 'copied')
  expect((await f.storage.recover()).measuredBytes).toBe(6)
  await expect(callStorageHelper(executable, f.home, { action: 'ui', request: { action: 'disarm', id: 'x', revision: 0 } }))
    .rejects.toThrow('STORAGE_LEASE_REQUIRED')
  const ledger = await readFile(join(f.root, '.nidofy-storage-v1', 'ledger.jsonl'), 'utf8')
  expect(ledger).toContain('rootId'); expect(ledger).toContain('creation')
})

it.skipIf(process.platform !== 'win32')('arbitrates simultaneous reservations from two real ready Hosts without overgranting', async () => {
  const f = await fixture(); await f.storage.recover()
  const writers = await Promise.all([0, 1].map(async () => {
    const child = fork(fileURLToPath(new URL('./fixtures/quota-host.mjs', import.meta.url)), [executable, f.home, '700000', 'barrier'],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] })
    const closed = new Promise<void>(resolve => child.once('close', () => { resolve() }))
    onTestFinished(async () => { if (child.exitCode === null) child.kill(); await closed })
    const ready = await new Promise<{ status: string }>((resolve, reject) => {
      child.once('message', (value) => { resolve(value as { status: string }) }); child.once('error', reject)
    })
    expect(ready.status).toBe('ready')
    const outcome = new Promise<{ status: string }>(resolve => child.once('message', (value) => { resolve(value as { status: string }) }))
    return { child, outcome }
  }))
  for (const writer of writers) writer.child.send('go')
  expect((await Promise.all(writers.map(writer => writer.outcome))).map(value => value.status).sort()).toEqual(['refused', 'reserved'])
})

it.skipIf(process.platform !== 'win32')('uses the begin grant for native end after the managed limit is reduced', async () => {
  const f = await fixture(128 * 1024 * 1024), workspace = join(f.root, 'project')
  await mkdir(workspace); await writeFile(join(workspace, 'source.txt'), 'before')
  await f.storage.native({ action: 'ui', request: { action: 'arm', workspace, paths: ['source.txt'], revision: 0 } })
  const binding = { sessionId: 'quota-session', turn: 1, engineId: randomUUID().replaceAll('-', ''), requestId: randomUUID().replaceAll('-', '') }
  const begin = await f.storage.native({ action: 'begin', workspace, binding, expiresAt: Date.now() + 14000 })
  expect(begin.status).toBe('CONFIRMED')
  await writeFile(join(workspace, 'source.txt'), 'after')
  await f.storage.configure(1)
  expect((await f.storage.native({ action: 'end', id: begin.id, binding, expiresAt: Date.now() + 14000 })).status).toBe('SEALED')
})

it.skipIf(process.platform !== 'win32')('queries a deliberately discarded reserve ACK and preserves the operation across a partial next record', async () => {
  const f = await fixture(); await f.storage.recover()
  const operationId = brandString<StorageOperationId>(randomUUID()), token = randomUUID() + randomUUID()
  const child = spawn(executable, [f.home], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  const closed = new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject) })
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await closed })
  child.stdin.end(JSON.stringify({ action: 'quota', request: { action: 'reserve', ownerEpoch: f.storage.epoch,
    operationId, token, scope: 'node:lost-ack', maxWriteBytes: 700000, terminalBytes: 1000 } }))
  expect(await closed).toBe(0)
  expect((await f.storage.inspect(operationId)).status).toBe('reserved')
  await appendFile(join(f.root, '.nidofy-storage-v1', 'ledger.jsonl'), 'incomplete-next-transaction')
  expect((await f.storage.inspect(operationId)).status).toBe('reserved')
  await expect(f.storage.reserve('node:must-not-overgrant', 700000, 0)).rejects.toThrow('STORAGE_RESERVE_FAILED')
})

it.skipIf(process.platform !== 'win32')('refuses corrupt complete records and unsafe Node destinations without deleting evidence', async () => {
  const f = await fixture(); await f.storage.recover()
  await expect(f.storage.write(join(f.home, 'sessions', 'outside'), 1, async () => {})).rejects.toThrow('STORAGE_PATH_REFUSED')
  const path = join(f.root, '.nidofy-storage-v1', 'ledger.jsonl')
  await appendFile(path, 'complete-but-invalid\n')
  const before = await readFile(path)
  await expect(f.storage.recover()).rejects.toThrow('STORAGE_LEDGER_CORRUPT')
  expect(await readFile(path)).toEqual(before)
})

it.skipIf(process.platform !== 'win32')('retains a reservation when an actual helper dies before accepting its command', async () => {
  const f = await fixture(), lease = await f.storage.reserve('node:helper-unknown', 800000, 1000)
  const child = spawn(executable, [f.home], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  const closed = new Promise<void>((resolve, reject) => { child.once('close', () => { resolve() }); child.once('error', reject) })
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await closed })
  // EOF is withheld, so the production helper cannot parse/accept a complete command.
  child.stdin.on('error', () => {}); child.stdin.write('{"action":"authorized",')
  child.kill(); await closed
  expect((await f.storage.inspect(lease.operationId)).status).toBe('reserved')
  expect((await f.storage.recover()).drained).toBe(false)
  await lease.release()
  expect((await f.storage.inspect(lease.operationId)).status).toBe('settled')
})

it.skipIf(process.platform !== 'win32')('keeps consumed native failures charged and refuses an impossible disk safety margin', async () => {
  const f = await fixture(128 * 1024 * 1024)
  const error: unknown = await f.storage.native({ action: 'ui', request: { action: 'arm', workspace: join(f.root, 'missing'),
    paths: ['source.txt'], revision: 0 } }).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error) || !('operationId' in error) || typeof error.operationId !== 'string') throw Error('MISSING_OPERATION_ID')
  expect(await f.storage.inspect(brandString<StorageOperationId>(error.operationId))).toMatchObject({ status: 'reserved', phase: 'running' })
  expect((await f.storage.recover()).drained).toBe(false)
  const epoch = randomUUID()
  const other = await fixture()
  await callStorageHelper(executable, other.home, { action: 'quota', request: { action: 'open', ownerEpoch: epoch,
    pid: process.pid, limitBytes: 1048576, safetyBytes: Number.MAX_SAFE_INTEGER } })
  await expect(other.storage.reserve('node:disk-pressure', 1, 1)).rejects.toThrow('STORAGE_RESERVE_FAILED')
})

it.skipIf(process.platform !== 'win32')('drains registered writers on shutdown, stops new work and retains terminal capacity', async () => {
  const f = await fixture(), lease = await f.storage.reserve('node:shutdown', 1000, 1000)
  let unblock!: () => void
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  const writer = lease.run(async () => blocked)
  let closed = false
  const shutdown = f.storage.close().then(() => { closed = true })
  try {
    await expect(lease.run(async () => {})).rejects.toThrow('STORAGE_STOPPING')
    expect(closed).toBe(false)
    const path = join(f.home, 'desktop-artifacts.json')
    await lease.terminal(() => f.storage.write(path, 8, () => writeFile(path, 'done')))
  } finally { unblock(); await writer; await shutdown; await lease.release() }
  expect((await f.storage.inspect(lease.operationId)).status).toBe('settled')
})

it.skipIf(process.platform !== 'win32')('refuses a copied ledger under a different physical root without rebinding or deleting it', async () => {
  const original = await fixture(), restored = await fixture()
  await original.storage.recover()
  const source = join(original.root, '.nidofy-storage-v1', 'ledger.jsonl'), target = join(restored.root, '.nidofy-storage-v1', 'ledger.jsonl')
  await mkdir(join(restored.root, '.nidofy-storage-v1')); await copyFile(source, target)
  const bytes = await readFile(target)
  await expect(restored.storage.recover()).rejects.toThrow('STORAGE_ROOT_CONFLICT')
  expect(await readFile(target)).toEqual(bytes)
})
