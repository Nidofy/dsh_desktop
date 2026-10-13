/** Candidate metadata cannot grant deletion or traverse linked storage. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ManagedRootId, QuotaStatus } from '@nidofy/dsh-desktop-extras/storage'
import { cleanupPreview } from '../src/storage/cleanup.ts'
const quota: QuotaStatus = { rootId: brandString<ManagedRootId>('physical-root'), measuredBytes: null, observedBytes: 0,
  reservedBytes: 50, ordinaryBytes: 40, terminalBytes: 10, pendingOperations: 1, drained: null, scan: 'not-run',
  safetyBytes: 1000, limitBytes: 1000000, ledgerBytes: 200, ledgerLimitBytes: 134217728 }

it('lists only recognized staging/cache files without modifying or default-selecting anything', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cleanup-preview-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, 'cache')); await mkdir(join(home, 'desktop-artifact-exports'))
  await writeFile(join(home, 'cache/nidofy-session-query.sqlite'), 'old index')
  await writeFile(join(home, 'cache/unknown-data'), 'preserve')
  const before = await cleanupPreview(home, quota)
  expect(before).toMatchObject({ destructive: false, execution: 'not-supported', reservedBytes: 50, restartRequired: true })
  expect(before.items.map(row => row.path)).toEqual(['cache/nidofy-session-query.sqlite'])
  expect(before.issues).toEqual([{ path: 'cache/unknown-data', code: 'UNKNOWN_NAME' }])
  expect(await readFile(join(home, 'cache/unknown-data'), 'utf8')).toBe('preserve')
  await writeFile(join(home, 'cache/nidofy-session-query.sqlite'), 'changed index')
  expect((await cleanupPreview(home, quota)).token).not.toBe(before.token)
})

it('refuses a linked candidate directory without traversing its target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-link-')), home = join(root, 'home'), external = join(root, 'external')
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(home); await mkdir(external); await writeFile(join(external, 'nidofy-session-query.sqlite'), 'outside')
  await symlink(external, join(home, 'cache'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await cleanupPreview(home, quota)
  expect(result.items).toEqual([]); expect(result.issues).toEqual([{ path: 'cache', code: 'LINKED_OR_UNSUPPORTED' }])
  expect(await readFile(join(external, 'nidofy-session-query.sqlite'), 'utf8')).toBe('outside')
})
