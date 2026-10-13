/** Policy publication consumes the real isolated native quota; denial leaves the last committed policy. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { DesktopEgressPolicy, distributionEgress } from '../src/connections/egress.ts'

it.runIf(process.platform === 'win32')('cold-reads an admitted policy and refuses the next revision before native quota permits bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-egress-quota-')), home = join(root, 'home'), ctx = new Context()
  await mkdir(home)
  await mkdir(join(home, 'nidofy-connections'))
  const storage = new StorageService(ctx, home, {
    executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)),
    limitBytes: 8 * 1024 * 1024, safetyBytes: 1024 * 1024,
  })
  const owner = new DesktopEgressPolicy(home, distributionEgress(undefined, false))
  owner.bind(ctx)
  onTestFinished(async () => {
    await owner.close(); await storage.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  const policy = { schemaVersion: 1, revision: 0, profile: [], workspaces: [] }
  await owner.request({ action: 'save', expectedRevision: 0, policy })
  const cold = new DesktopEgressPolicy(home, distributionEgress(undefined, false))
  expect((await cold.request({ action: 'status' })).policy.revision).toBe(1)
  await cold.close()
  await storage.configure(1)
  await expect(owner.request({ action: 'save', expectedRevision: 1, policy: { ...policy, revision: 1, profile: null } }))
    .rejects.toThrow('STORAGE_RESERVE_FAILED')
  expect((await owner.request({ action: 'status' })).policy).toEqual({ ...policy, revision: 1 })
})
