/** Actual action writer and durable quota owner with isolated homes and a local child. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectActions } from '../src/workbench/legacy/project-actions.mjs'
import { installStorageAdmission } from '../src/workbench/legacy/storage-admission.mjs'

it.skipIf(process.platform !== 'win32')('finishes action records from the independent grant after lowering the quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-writers-')), home = join(root, 'home'), project = join(root, 'project')
  await mkdir(home); await mkdir(project)
  const ctx = new Context(), storage = new StorageService(ctx, home, {
    executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)),
    limitBytes: 8 * 1024 * 1024, safetyBytes: 1024 * 1024,
  })
  const uninstall = installStorageAdmission(storage)
  const actions = new ProjectActions(home, async () => {
    await storage.configure(1)
    const result = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("local child closed")'], { windowsHide: true })
    return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
      stdout: { text: result.stdout, truncated: false }, stderr: { text: result.stderr, truncated: false } }
  })
  onTestFinished(async () => {
    await actions.close(); uninstall(); await storage.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  const saved = await actions.save(project, { schemaVersion: 1, actions: [{ id: 'local', label: 'Local', command: 'local child' }] })
  await actions.trust(project, saved.fingerprint)
  const started = await actions.start(project, 'local'), result = await actions.wait(project, started.id)
  expect(result.status).toBe('PASS')
  expect(result.persistenceFailed).toBeUndefined()
  expect(await actions.log(project, started.id)).toContain('local child closed')
  expect((await storage.recover()).drained).toBe(true)
  await expect(actions.start(project, 'local')).rejects.toThrow('STORAGE_RESERVE_FAILED')
})
