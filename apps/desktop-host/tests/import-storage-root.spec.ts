/** Actual Windows admission, refusal and adoption fixtures under isolated physical roots. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StorageService, type StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { importLegacy, productImport } from '../src/connections/import.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { distributionPaths } from '../../desktop/src/distribution.ts'
import { distributionDataRoot } from '../../desktop/src/distribution-protocol.ts'

const executable = fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url))
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-import-root-')), home = join(root, 'product', 'harness')
  const source = join(root, 'legacy'), imports = join(root, 'product', 'imports'), ctx = new Context()
  await mkdir(home, { recursive: true })
  const sourcePath = join(source, 'sessions', '_no-cwd', 'root-session', 'session.v4.jsonl')
  await mkdir(join(source, 'sessions', '_no-cwd', 'root-session'), { recursive: true })
  const sourceBytes = JSON.stringify({ type: 'session', version: 4, id: 'root-session', createdAt: 1,
    isSeeded: false, delegationDepth: 0 }) + '\n'
  await writeFile(sourcePath, sourceBytes)
  const storage = new StorageService(ctx, home, { executable, limitBytes: 1024 * 1024, safetyBytes: 1024 * 1024 })
  onTestFinished(async () => { await storage.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, source, imports, ctx, storage, sourcePath, sourceBytes,
    request: { source, sourceVersion: '0.2.5-rc.1', operationId: randomUUID() } }
}

it.skipIf(process.platform !== 'win32')('verifies committed reports and prepares the adopted home without switching the original Host', async () => {
  const f = await fixture(), preview = await productImport(f.storage, { ...f.request, action: 'preview' }, () => {})
  await productImport(f.storage, { ...f.request, action: 'execute', confirm: true, expectedFingerprint: preview.fingerprint,
    maxWriteBytes: 65536 }, () => {})
  const ready = await productImport(f.storage, { ...f.request, action: 'review' }, () => {})
  expect(ready.launch).toBeNull()
  expect(ready.report).toMatchObject({ verification: 'official-session-readers-and-copy-digests', sourceVersion: '0.2.5-rc.1' })
  await productImport(f.storage, { ...f.request, action: 'adopt', confirm: true }, () => {})
  const reviewed = await productImport(f.storage, { ...f.request, action: 'review' }, () => {})
  const launch = reviewed.launch as { harnessHome: string; desktopDataRoot: string; argument: string; switchesRunningHost: boolean }
  expect(launch.switchesRunningHost).toBe(false)
  expect(distributionPaths(f.root, distributionDataRoot([launch.argument])).home).toBe(launch.harnessHome)
  expect(reviewed.runningHome).toBe(f.storage.home)
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
  const ledger = join(f.root, 'product', '.nidofy-storage-v1', 'ledger.jsonl'), before = await readFile(ledger)
  await productImport(f.storage, { ...f.request, action: 'review' }, () => {})
  expect(await readFile(ledger)).toEqual(before)
  await writeFile(join(String(reviewed.dataRoot), 'import.json'), JSON.stringify({ status: 'READY', operationId: f.request.operationId,
    fingerprint: reviewed.fingerprint, report: { forged: true } }))
  await expect(productImport(f.storage, { ...f.request, action: 'review' }, () => {})).rejects.toThrow('IMPORT_REVIEW_CONFLICT')
  expect((await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).phase).toBe('adopted')
})

it.skipIf(process.platform !== 'win32')('reads old receipts without a report and refuses sealed unsupported or oversized reports', async () => {
  const f = await fixture(), imports = await f.storage.importRoot()
  for (const [report, error] of [
    [undefined, undefined],
    [{ schemaVersion: 2, categories: [] }, 'IMPORT_REVIEW_UNSUPPORTED'],
    [{ schemaVersion: 1, categories: Array.from({ length: 17 }, () => ({})) }, 'IMPORT_REVIEW_UNSUPPORTED'],
    [{ schemaVersion: 1, categories: [], note: 'x'.repeat(128 * 1024) }, 'IMPORT_REVIEW_TOO_LARGE'],
  ] as const) {
    const operationId = randomUUID(), fingerprint = '0'.repeat(64)
    const lease = await f.storage.beginImport(brandString<StorageOperationId>(operationId), fingerprint, 256 * 1024)
    const stage = join(imports, operationId + '.pending'), path = join(stage, 'import.json')
    const bytes = JSON.stringify({ status: 'READY', operationId, fingerprint, sourceVersion: '0.2.0', report })
    await lease.write(path, Buffer.byteLength(bytes), async () => {
      await mkdir(join(stage, 'harness')); await writeFile(path, bytes)
    })
    await lease.publish(); await lease.release()
    const review = productImport(f.storage, { action: 'review', operationId }, () => {})
    if (error) await expect(review).rejects.toThrow(error)
    else expect(await review).toMatchObject({ phase: 'ready', report: null, launch: null })
    expect((await f.storage.importOperation('inspect', brandString<StorageOperationId>(operationId))).phase).toBe('ready')
    expect(await readFile(join(f.imports, operationId, 'import.json'), 'utf8')).toBe(bytes)
  }
})

it.skipIf(process.platform !== 'win32')('refuses bounded import destinations before granting a Node write', async () => {
  const f = await fixture()
  await f.storage.status()
  const ledger = join(f.root, 'product', '.nidofy-storage-v1', 'ledger.jsonl'), before = await readFile(ledger)
  await expect(importLegacy(f.request, f.imports, () => {}, undefined, {
    write: (path, bytes, work) => f.storage.write(path, bytes, work),
  })).rejects.toThrow('STORAGE_PATH_REFUSED')
  expect(await readFile(ledger)).toEqual(before)
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
  await expect(stat(join(f.imports, f.request.operationId + '.pending', 'import.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.skipIf(process.platform !== 'win32')('publishes, inspects and explicitly adopts under one physical root without losing imported charges', async () => {
  const f = await fixture()
  const preview = await productImport(f.storage, { ...f.request, action: 'preview' }, () => {})
  const execute = { ...f.request, action: 'execute', confirm: true, expectedFingerprint: preview.fingerprint, maxWriteBytes: 64 * 1024 }
  const receipt = await productImport(f.storage, execute, () => {})
  expect(receipt).toMatchObject({ phase: 'ready', operationId: f.request.operationId, quotaOperationId: f.request.operationId })
  expect((await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).phase).toBe('ready')
  await expect(productImport(f.storage, execute, () => {})).rejects.toThrow('STORAGE_RESERVE_FAILED')
  const importedHome = String(receipt.home), ctx = new Context(), imported = new StorageService(ctx, importedHome, f.storage.config)
  onTestFinished(async () => { await imported.close(); await ctx.fiber.dispose() })
  await expect(imported.status()).rejects.toThrow('STORAGE_IMPORTED_HOME_REBIND_REQUIRED')
  const before = await f.storage.recover()
  await expect(productImport(f.storage, { ...f.request, action: 'adopt' }, () => {})).rejects.toThrow('IMPORT_CONFIRM_REQUIRED')
  const adopted = await productImport(f.storage, { ...f.request, action: 'adopt', confirm: true }, () => {})
  expect(adopted.phase).toBe('adopted'); expect(adopted.retainedExcludedBytes).toBeGreaterThan(0)
  expect((await imported.status()).rootId).toBe(before.rootId)
  expect((await f.storage.recover()).measuredBytes).toBe(before.measuredBytes)
  await mkdir(join(importedHome, 'attachments'))
  await writeFile(join(importedHome, 'attachments', 'new-official.bin'), Buffer.alloc(100))
  expect((await f.storage.recover()).measuredBytes).toBe(before.measuredBytes)
  const target = join(importedHome, 'nidofy-extras', 'settings.json')
  await imported.write(target, 2, async () => { await mkdir(join(importedHome, 'nidofy-extras')); await writeFile(target, '{}') })
  expect((await f.storage.recover()).measuredBytes).toBe(Number(before.measuredBytes) + 2)
  expect(await imported.importRoot()).toBe(await f.storage.importRoot())
  await expect(stat(join(String(receipt.dataRoot), '.nidofy-storage-v1'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
})

it.skipIf(process.platform !== 'win32')('retains an interrupted operation when the cumulative ceiling refuses metadata, with no lock takeover bytes', async () => {
  const f = await fixture(), preview = await productImport(f.storage, { ...f.request, action: 'preview' }, () => {})
  await expect(productImport(f.storage, { ...f.request, action: 'execute', confirm: true,
    expectedFingerprint: preview.fingerprint, maxWriteBytes: 1 }, () => {})).rejects.toThrow('IMPORT_WRITE_LIMIT')
  expect(await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).toMatchObject({ phase: 'interrupted', spentBytes: 0 })
  await expect(stat(join(f.imports, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(join(f.imports, f.request.operationId))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
})

it.skipIf(process.platform !== 'win32')('refuses stale preview before admitting any operation and drains pre-publication cancellation', async () => {
  const f = await fixture()
  await expect(productImport(f.storage, { ...f.request, action: 'execute', confirm: true,
    expectedFingerprint: 'changed', maxWriteBytes: 65536 }, () => {})).rejects.toThrow('IMPORT_PREVIEW_CONFLICT')
  expect((await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).phase).toBe('unknown')
  const controller = new AbortController()
  const imports = await f.storage.importRoot()
  await expect(importLegacy(f.request, imports, () => {}, async (point) => {
    if (point === 'ready') controller.abort(Error('TEST_IMPORT_CANCEL'))
  }, { signal: controller.signal, admit: fingerprint => f.storage.beginImport(
    // The helper validates this wire-generated UUID; no fixture generation stands in for physical identity.
    brandString<StorageOperationId>(f.request.operationId), fingerprint, 65536),
  })).rejects.toThrow('TEST_IMPORT_CANCEL')
  expect((await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).phase).toBe('interrupted')
  expect((await productImport(f.storage, { ...f.request, action: 'recover', confirm: true }, () => {})).phase).toBe('interrupted')
})

it.skipIf(process.platform !== 'win32')('queries an unreturned grant and recovers only after the actual child owner exits, without replay', async () => {
  const f = await fixture()
  await f.storage.status()
  const child = fork(fileURLToPath(new URL('./fixtures/import-owner.mjs', import.meta.url)),
    [f.storage.home, executable, f.request.operationId], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } })
  const exited = once(child, 'exit')
  onTestFinished(async () => { if (child.exitCode === null) child.kill(); await exited })
  await once(child, 'message')
  expect(await productImport(f.storage, { ...f.request, action: 'inspect' }, () => {})).toMatchObject({ phase: 'copying', quota: { status: 'reserved' } })
  await expect(productImport(f.storage, { ...f.request, action: 'recover', confirm: true }, () => {})).rejects.toThrow('STORAGE_WRITER_ACTIVE')
  child.send('exit'); await exited
  expect(await productImport(f.storage, { ...f.request, action: 'recover', confirm: true }, () => {}))
    .toMatchObject({ phase: 'interrupted', quota: { status: 'settled' } })
  await expect(f.storage.beginImport(brandString<StorageOperationId>(f.request.operationId), '0'.repeat(64), 65536)).rejects.toThrow('STORAGE_RESERVE_FAILED')
  await expect(stat(join(f.imports, f.request.operationId))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.skipIf(process.platform !== 'win32')('migrates a legacy generation under the same grant and quarantines trust before adoption', async () => {
  const f = await fixture(), oldPath = f.sourcePath.replace('session.v4.jsonl', 'session.jsonl')
  await rename(f.sourcePath, oldPath)
  const bytes = JSON.stringify({ type: 'session', version: 0, id: 'root-session', createdAt: 1, delegationDepth: 0 }) + '\n'
  await writeFile(oldPath, bytes)
  await mkdir(join(f.source, 'storages'))
  const workspace = { unit: { name: 'workspace', version: 2 }, global: { workspaceIds: [] }, tables: { workspaces: {} } }
  await writeFile(join(f.source, 'storages', 'workspace.json'), JSON.stringify(workspace))
  await writeFile(join(f.source, 'desktop-snapshot-scopes.json'), '{"version":1,"revision":0,"items":[]}')
  const root = await f.storage.importRoot()
  const receipt = await importLegacy(f.request, root, () => {}, async (point) => {
    if (point === 'validated') await f.storage.configure(1)
  }, { admit: fingerprint => f.storage.beginImport(brandString<StorageOperationId>(f.request.operationId), fingerprint, 65536) })
  const destination = String(receipt.dataRoot)
  expect(receipt).toMatchObject({ phase: 'ready' })
  expect(await readFile(join(destination, 'harness/sessions/_no-cwd/root-session/session.jsonl'), 'utf8')).toBe(bytes)
  expect(await readFile(join(destination, 'harness/sessions/_no-cwd/root-session/session.v4.jsonl'), 'utf8')).toContain('"version":4')
  await expect(stat(join(destination, 'harness/desktop-snapshot-scopes.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(destination, 'review/harness/storages/workspace.json'), 'utf8')).toBe(JSON.stringify(workspace))
  expect(await readFile(oldPath, 'utf8')).toBe(bytes)
  await productImport(f.storage, { ...f.request, action: 'adopt', confirm: true }, () => {})
  const importedHome = join(destination, 'harness')
  await rename(importedHome, join(destination, 'preserved-harness')); await mkdir(importedHome)
  const ctx = new Context(), imported = new StorageService(ctx, importedHome, f.storage.config)
  onTestFinished(async () => { await imported.close(); await ctx.fiber.dispose() })
  await expect(imported.status()).rejects.toThrow('STORAGE_IMPORTED_HOME_REBIND_REQUIRED')
})

it.skipIf(process.platform !== 'win32')('enforces the complete cumulative byte ceiling at its exact and one-byte-short values', async () => {
  const f = await fixture()
  const execute = async (operationId: string, maxWriteBytes: number) => {
    const request = { ...f.request, operationId }
    const preview = await productImport(f.storage, { ...request, action: 'preview' }, () => {})
    return productImport(f.storage, { ...request, action: 'execute', maxWriteBytes, confirm: true,
      expectedFingerprint: preview.fingerprint }, () => {})
  }
  const first = await execute(f.request.operationId, 65536)
  const exact = Number(first.spentBytes)
  expect(exact).toBeGreaterThan(Buffer.byteLength(f.sourceBytes))
  expect((await execute(randomUUID(), exact)).phase).toBe('ready')
  const short = randomUUID()
  await expect(execute(short, exact - 1)).rejects.toThrow('IMPORT_WRITE_LIMIT')
  expect((await productImport(f.storage, { action: 'inspect', operationId: short }, () => {})).phase).toBe('interrupted')
})

it.skipIf(process.platform !== 'win32')('refuses a native-authorized import write outside its physical staging tree before work starts', async () => {
  const f = await fixture(), lease = await f.storage.beginImport(brandString<StorageOperationId>(f.request.operationId), '0'.repeat(64), 1024)
  let wrote = false
  await expect(lease.write(f.sourcePath, 1, async () => { wrote = true })).rejects.toThrow('STORAGE_PATH_REFUSED')
  expect(wrote).toBe(false)
  await lease.abort(); await lease.release()
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
})

it.skipIf(process.platform !== 'win32')('keeps actual published success inspectable after a lost reply and ignores post-publication cancellation', async () => {
  const f = await fixture(), root = await f.storage.importRoot()
  for (const lost of [true, false]) {
    const request = { ...f.request, operationId: randomUUID() }, controller = new AbortController()
    const run = importLegacy(request, root, () => {}, undefined, { signal: controller.signal, admit: async (fingerprint) => {
      const lease = await f.storage.beginImport(brandString<StorageOperationId>(request.operationId), fingerprint, 65536)
      return { ...lease, publish: async () => {
        const result = await lease.publish()
        if (lost) throw Error('TEST_REPLY_LOST')
        controller.abort(Error('TEST_LATE_CANCEL')); return result
      } }
    } })
    if (lost) await expect(run).rejects.toThrow('TEST_REPLY_LOST')
    else expect(await run).toMatchObject({ phase: 'ready' })
    expect((await productImport(f.storage, { action: 'inspect', operationId: request.operationId }, () => {})).phase).toBe('ready')
  }
})

it.skipIf(process.platform !== 'win32')('counts a retained isolated import but refuses its home without creating a nested ledger', async () => {
  const f = await fixture(), receipt = await importLegacy(f.request, f.imports, () => {})
  const recovered = await f.storage.recover()
  expect(recovered.measuredBytes).toBeGreaterThan(Buffer.byteLength(f.sourceBytes))
  const importedHome = join(String(receipt.dataRoot), 'harness'), importedContext = new Context()
  const imported = new StorageService(importedContext, importedHome, f.storage.config)
  onTestFinished(async () => { await imported.close(); await importedContext.fiber.dispose() })
  await expect(imported.status()).rejects.toThrow('STORAGE_IMPORTED_HOME_REBIND_REQUIRED')
  await expect(stat(join(String(receipt.dataRoot), '.nidofy-storage-v1'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.sourceBytes)
  expect((await f.storage.status()).rootId).toBe(recovered.rootId)
})
