/** Real quota, native handles and archive bytes behind the product management dispatcher. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { ProtectionOwner } from '../src/connections/protection.ts'
import { object } from '../src/connections/store.ts'

it.skipIf(process.platform !== 'win32')('captures, seals, exports, verifies, imports and restores only the selected isolated file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-management-')), exportedRoot = await mkdtemp(join(tmpdir(), 'snapshot-export-'))
  const workspace = join(root, 'project')
  await mkdir(workspace); await writeFile(join(workspace, 'a.txt'), 'before'); await writeFile(join(workspace, 'untouched.txt'), 'retained')
  const contexts: Context[] = [], stores: StorageService[] = []
  onTestFinished(async () => {
    for (const owner of stores) await owner.close()
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true }); await rm(exportedRoot, { recursive: true, force: true })
  })
  const open = async (name: string) => {
    const home = join(root, name); await mkdir(home)
    const ctx = new Context(); contexts.push(ctx)
    const storage = new StorageService(ctx, home, { executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)),
      limitBytes: 512 * 1024 * 1024, safetyBytes: 1024 * 1024 }); stores.push(storage)
    return { owner: new ProtectionOwner(command => storage.native(object(command))), storage }
  }
  const first = await open('home-a')
  const captured = await first.owner.configure({ action: 'capture', workspace, paths: ['a.txt'] })
  expect(captured.sealed).toBe(false)
  await writeFile(join(workspace, 'a.txt'), 'after')
  await first.owner.configure({ action: 'seal', id: captured.id })
  const exported = await first.owner.configure({ action: 'export', id: captured.id, destination: exportedRoot })
  expect(exported.verified).toBe(true)
  const archive = String(exported.directory), verified = await first.owner.configure({ action: 'verifyArchive', directory: archive })
  const second = await open('home-b')
  const copied = join(exportedRoot, 'copied-archive'); await cp(archive, copied, { recursive: true })
  const copiedPreview = await second.owner.configure({ action: 'verifyArchive', directory: copied })
  expect(copiedPreview.revision).not.toBe(verified.revision)
  await expect(second.owner.configure({ action: 'importArchive', directory: copied, expectedRevision: verified.revision }))
    .rejects.toThrow('PROTECTION_ARCHIVE_PREVIEW_CONFLICT')
  await expect(second.owner.configure({ action: 'importArchive', directory: archive })).rejects.toThrow('PREVIEW_REQUIRED')
  await expect(second.owner.configure({ action: 'importArchive', directory: archive, expectedRevision: '0'.repeat(64) }))
    .rejects.toThrow('PROTECTION_ARCHIVE_PREVIEW_CONFLICT')
  expect((await second.storage.status()).reservedBytes).toBe(0)
  const imported = await second.owner.configure({ action: 'importArchive', directory: archive, expectedRevision: verified.revision })
  expect(imported.imported).toBe(true)
  expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('after')
  const preview = await second.owner.configure({ action: 'preview', id: captured.id })
  expect(preview.rows).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'a.txt', status: 'READY' })]))
  const result = await second.owner.configure({ action: 'restore', id: captured.id, paths: ['a.txt'], expectedRevision: preview.revision })
  expect(result).toBeDefined()
  expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('before')
  expect(await readFile(join(workspace, 'untouched.txt'), 'utf8')).toBe('retained')
})

it('refuses manual mutations while a protected turn is active and never passes a raw authorized wrapper', async () => {
  const owner = new ProtectionOwner(async (command) => {
    const data = object(command)
    if (data.action === 'ui') return { items: [{ workspace: 'C:/project' }] }
    if (data.action === 'resolve') return { status: 'ARMED', workspace: 'C:/project' }
    return { status: 'CONFIRMED', id: 'capture' }
  })
  await owner.begin('active', 1, 'C:/project')
  for (const action of ['capture', 'seal', 'export', 'importArchive']) {
    await expect(owner.configure({ action })).rejects.toThrow('PROTECTION_BUSY')
  }
  expect(() => owner.configure({ action: 'authorized', command: {} })).toThrow('ACTION_UNAVAILABLE')
})
