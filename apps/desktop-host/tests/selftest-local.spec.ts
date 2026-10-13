/** Real native quota, official Shell and isolated owner measurements; no credentials or provider network. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { mkdir, mkdtemp, readFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { SelfTestStore } from '../src/selftest/store.ts'
import { SelfTestRunner } from '../src/selftest/runner.ts'
import { ElectronLocalChecks } from '../src/selftest/local.ts'
import { installStorageAdmission } from '../src/workbench/legacy/storage-admission.mjs'

it.runIf(process.platform === 'win32')('runs actual local measurements, cold-reads history and preserves field UNKNOWN with zero model calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selftest-native-')), home = join(root, 'home'), ctx = new Context()
  await mkdir(home)
  await ctx.plugin(LocalSubprocessRuntime); await ctx.plugin(PwshLocalExecutor, { graceMs: 100 })
  const storage = new StorageService(ctx, home, { limitBytes: 128 * 1024 * 1024, safetyBytes: 1024 * 1024,
    executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)) })
  const remove = installStorageAdmission(storage), store = new SelfTestStore(home, storage)
  const runner = new SelfTestRunner(store, storage, (id) => {
    const provider = new ElectronLocalChecks(home, id, storage, async (action) => {
      const spec = ctx.shell.resolve({ command: action.command, workdir: action.cwd, signal: action.signal,
        timeoutMs: action.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 65536, env: action.env })
      await action.recordExecution?.({ settings: spec, provider: await ctx.shell.verificationInputs(spec) })
      return (await ctx.shell.execute(spec)).result()
    }, store, process.execPath)
    return { open: signal => provider.open(signal), close: () => provider.close(), check: async (check, signal) => {
      try { return await provider.check(check, signal) }
      catch (error) { console.error('Isolated self-test measurement failed:', check, error); throw error }
    } }
  })
  onTestFinished(async () => {
    await runner.close(); await ctx.fiber.dispose(); remove(); await storage.close()
    await rm(root, { recursive: true, force: true })
  })
  const unavailable = new ElectronLocalChecks(home, randomUUID(), storage, () => {
    throw Error('Unavailable runtime must not execute')
  }, store, join(root, 'missing-node.exe'))
  await expect(unavailable.open(new AbortController().signal)).rejects.toMatchObject({ code: 'ENOENT' })
  await unavailable.close()
  await expect(lstat(join(home, 'nidofy-extras/selftests/workspaces'))).rejects.toMatchObject({ code: 'ENOENT' })
  const id = randomUUID(); await runner.start({ mode: 'local', operationId: id })
  await expect.poll(async () => (await runner.read(id))?.status, { timeout: 60000, interval: 100 }).not.toBe('RUNNING')
  const report = await runner.read(id)
  expect(report, JSON.stringify(report)).toMatchObject({ status: 'COMPLETED', warning: null, budget: { modelRequests: 0 } })
  for (const check of ['storage', 'shell', 'skills', 'action-trust', 'action-run', 'action-change', 'cancel', 'artifact', 'prefix', 'recovery', 'notification', 'probe-failure']) {
    expect(report?.rows.find(row => row.id === check), check).toMatchObject({ status: 'PASS', code: 'OK' })
  }
  expect(report?.rows.slice(-2).map(row => row.status)).toEqual(['UNKNOWN', 'UNKNOWN'])
  const before = await readFile(join(store.directory, id + '.json'))
  expect((await new SelfTestStore(home, storage).read(id))?.status).toBe('COMPLETED')
  expect(await readFile(join(store.directory, id + '.json'))).toEqual(before)
  expect(JSON.stringify(store.export(report!))).not.toContain(home)
}, 90000)
