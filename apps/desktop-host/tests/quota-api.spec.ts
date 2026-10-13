/** Management consumes the real product owner; no local quota authority is substituted. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { quotaRequest } from '../src/storage/api.ts'

it('refuses an absent product owner without creating an admission fallback', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await expect(quotaRequest(ctx, { action: 'status' })).rejects.toThrow('STORAGE_OWNER_UNAVAILABLE')
})

it.skipIf(process.platform !== 'win32')('reads, configures, inspects unknown and explicitly recovers through the native owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-api-')), home = join(root, 'harness'), ctx = new Context()
  await mkdir(home)
  const executable = fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url))
  const owner = new StorageService(ctx, home, { executable, limitBytes: 1048576, safetyBytes: 1048576 })
  onTestFinished(async () => { await owner.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  expect(await quotaRequest(ctx, { action: 'status' })).toMatchObject({ scan: 'not-run', measuredBytes: null })
  expect(await quotaRequest(ctx, { action: 'configure', limitBytes: 1 })).toEqual({ limitBytes: 1 })
  expect(await quotaRequest(ctx, { action: 'inspect', operationId: 'unknown-operation-000001' })).toEqual({ status: 'unknown' })
  expect(await quotaRequest(ctx, { action: 'recover' })).toMatchObject({ scan: 'complete', measuredBytes: 0, drained: true })
  for (const request of [{ action: 'reserve', scope: 'native:task' }, { action: 'configure', limitBytes: -1 },
    { action: 'recover', token: 'forged' }, { action: 'inspect', operationId: '../escape' }]) {
    await expect(quotaRequest(ctx, request)).rejects.toThrow('STORAGE_')
  }
})
