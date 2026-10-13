/** Read-only intake shares actual legacy parsing, without enabling unbounded migration. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { previewLegacy } from '../src/connections/import.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'legacy-preview-')), source = join(root, 'source'), imports = join(root, 'imports')
  await mkdir(source)
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const input = { action: 'preview', source, sourceVersion: '0.2.0', operationId: randomUUID() }
  return { root, source, imports, input }
}
it('reports planned categories and a changing source fingerprint without creating imports or touching secrets', async () => {
  const f = await fixture()
  await mkdir(join(f.source, 'attachments'))
  await writeFile(join(f.source, 'attachments/retained.bin'), Buffer.alloc(200000, 7))
  await writeFile(join(f.source, '.credentials.yaml'), 'synthetic-private-value')
  const before = await readdir(f.root)
  const result = await previewLegacy(f.input, f.imports, () => {})
  expect(result).toMatchObject({ status: 'PREVIEW', sourceBytes: 200000, files: 1, execution: 'IMPORT_QUOTA_MIGRATION_UNSUPPORTED',
    adoption: 'not-supported', sourceModified: false, credentialsCopied: false, schedulesActivated: false })
  expect(await readdir(f.root)).toEqual(before)
  expect(JSON.stringify(result)).not.toContain('synthetic-private-value')
  await writeFile(join(f.source, 'attachments/retained.bin'), Buffer.alloc(200000, 8))
  expect((await previewLegacy(f.input, f.imports, () => {})).fingerprint).not.toBe(result.fingerprint)
  expect(await readFile(join(f.source, '.credentials.yaml'), 'utf8')).toBe('synthetic-private-value')
  expect(result.report).toMatchObject({ sourcePreserved: true, sourceVersion: '0.2.0',
    supportedVersions: ['0.2.0', '0.2.5-rc.1'], verification: 'inventory-and-settings-only' })
  expect(result.report.categories.find(row => row.category === 'schedules')).toMatchObject({ disposition: 'separate-confirmation' })
})
it('rejects unsupported versions and inline secrets without preparing a target directory', async () => {
  const f = await fixture()
  await expect(previewLegacy({ ...f.input, sourceVersion: 'future' }, f.imports, () => {})).rejects.toThrow('IMPORT_REQUEST_INVALID')
  await expect(previewLegacy({ ...f.input, sourceVersion: ['0.2.0'] }, f.imports, () => {})).rejects.toThrow('IMPORT_REQUEST_INVALID')
  await writeFile(join(f.source, 'connection.json'), '{"apiKey":"must-not-copy"}')
  await expect(previewLegacy(f.input, f.imports, () => {})).rejects.toThrow('IMPORT_INLINE_SECRET_REFUSED')
  expect(await readdir(f.root)).toEqual(['source'])
})

it('refuses duplicate settings and reports generated Session configuration without activating workspace registrations', async () => {
  const f = await fixture(), profile = join(f.source, 'profiles/desktop')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'ui-settings', config: {} }, { id: 'ui-settings', config: {} }]))
  await expect(previewLegacy(f.input, f.imports, () => {})).rejects.toThrow('IMPORT_SETTINGS_AMBIGUOUS')
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'ui-settings', config: {} }]))
  await mkdir(join(f.source, 'storages'))
  await writeFile(join(f.source, 'storages/workspace.json'), JSON.stringify({ unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['old'] }, tables: { workspaces: { old: { path: 'C:/old-project' } } } }))
  const result = await previewLegacy(f.input, f.imports, () => {})
  expect(result.report.settingNamespaces).toEqual(['ui-settings', 'session-persistence-jsonl'])
  expect(result.report.categories.find(row => row.category === 'workspace')).toMatchObject({ count: 1,
    disposition: 'review', destination: 'review/harness/storages/workspace.json' })
  expect(await readdir(f.root)).toEqual(['source'])
})

it('counts canonical Session roles once across retained generations and compressed filenames', async () => {
  const f = await fixture()
  for (const name of ['one', 'two']) await mkdir(join(f.source, 'sessions', name), { recursive: true })
  for (const name of ['session.jsonl', 'session.v3.jsonl']) await writeFile(join(f.source, 'sessions/one', name), 'inventory-only fixture')
  await writeFile(join(f.source, 'sessions/two/session.v4.jsonl.zstd'), 'inventory-only fixture')
  const result = await previewLegacy(f.input, f.imports, () => {})
  // Filename inventory is not historical codec validation or permission to execute migration.
  expect(result.sessions).toBe(2); expect(result.files).toBe(3)
  expect(result.execution).toBe('IMPORT_QUOTA_MIGRATION_UNSUPPORTED')
  expect(await readdir(f.root)).toEqual(['source'])
})
