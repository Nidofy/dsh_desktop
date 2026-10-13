import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, unlink, stat } from 'node:fs/promises'
import { zstdCompressSync } from 'node:zlib'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { importLegacy, type LegacyImportWriter } from '../src/connections/import.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(version: number) {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-import-')); roots.push(root)
  const source = join(root, 'legacy'), id = 'fixture-session'
  const dir = join(source, 'dsh', 'sessions', '_no-cwd', id)
  await mkdir(dir, { recursive: true })
  const file = join(dir, version === 0 ? 'session.jsonl' : `session.v${version}.jsonl`)
  const bytes = JSON.stringify({ type: 'session', version, id, createdAt: 1,
    ...version >= 2 ? { isSeeded: false } : {}, delegationDepth: 0 }) + '\n'
  await writeFile(file, bytes)
  await writeFile(join(source, 'connection.json'), JSON.stringify({ providerName: 'Legacy', baseUrl: 'http://localhost:12345/v1', model: 'same', api: 'openai-completions' }))
  await writeFile(join(source, 'dsh', '.credentials.yaml'), 'DO_NOT_COPY')
  return { root, source, file, bytes, imports: join(root, 'imports'), request: { source, sourceVersion: version < 4 ? '0.2.0' : '0.2.5-rc.1', operationId: randomUUID() } }
}
it.each([0, 3, 4])('imports writer generation %s through the official migration chain and is idempotent', async (version) => {
  const f = await fixture(version)
  const first = await importLegacy(f.request, f.imports, () => {})
  expect(first).toMatchObject({ status: 'READY', sessions: 1, sourceModified: false, credentialsCopied: false, schedulesActivated: false })
  expect(await importLegacy(f.request, f.imports, () => {})).toEqual(first)
  expect(await readFile(f.file, 'utf8')).toBe(f.bytes)
  const dataRoot = String(first.dataRoot)
  expect(await readdir(join(dataRoot, 'harness'))).not.toContain('.credentials.yaml')
})
it('refuses a future writer without publishing a ready destination or changing source', async () => {
  const f = await fixture(999)
  await expect(importLegacy(f.request, f.imports, () => {})).rejects.toThrow()
  expect(await readFile(f.file, 'utf8')).toBe(f.bytes)
  expect(await readdir(f.imports)).not.toContain(f.request.operationId)
})
it.each(['copied', 'validated', 'ready'])('resumes an interrupted copy at %s', async (point) => {
  const f = await fixture(4)
  await expect(importLegacy(f.request, f.imports, () => {}, async (at) => {
    if (at === point) throw new Error('PROCESS_LOST')
  })).rejects.toThrow('PROCESS_LOST')
  expect(await importLegacy(f.request, f.imports, () => {})).toMatchObject({ status: 'READY' })
  expect(await readFile(f.file, 'utf8')).toBe(f.bytes)
})
it('refuses inline credentials and future catalog schema before copying', async () => {
  const f = await fixture(4)
  await writeFile(join(f.source, 'connections.json'), JSON.stringify({ schemaVersion: 99, profiles: [] }))
  await expect(importLegacy(f.request, f.imports, () => {})).rejects.toThrow('VERSION_UNSUPPORTED')
  await writeFile(join(f.source, 'connections.json'), JSON.stringify({ schemaVersion: 1, profiles: [], apiKey: 'not-for-import' }))
  await expect(importLegacy(f.request, f.imports, () => {})).rejects.toThrow('SECRET_REFUSED')
})

it('preserves compressed Session data and points the published plugin to its copy', async () => {
  const f = await fixture(4)
  const compressed = zstdCompressSync(Buffer.from(f.bytes))
  await writeFile(f.file + '.zstd', compressed); await unlink(f.file)
  const imported = await importLegacy(f.request, f.imports, () => {})
  expect(imported.sessions).toBe(1)
  expect(await readFile(f.file + '.zstd')).toEqual(compressed)
  const patch: unknown = JSON.parse(await readFile(join(String(imported.dataRoot), 'harness', 'cordis.patch.yml'), 'utf8'))
  expect(patch).toContainEqual({ id: 'session-persistence-jsonl', config: {
    root: join(String(imported.dataRoot), 'harness', 'sessions'), compression: 'zstd',
  } })
})

it('imports the legacy dsh-desktop settings with rebound credentials and preserves enabled protection', async () => {
  const f = await fixture(4)
  const profile = join(f.source, 'dsh', 'profiles', 'dsh-desktop')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'llm-pi-ai', config: { providers: { legacy: { apiKeyEnv: 'OLD_AMBIENT_KEY' } } } }]))
  const scopes = JSON.stringify({ version: 1, revision: 0, items: [] })
  await writeFile(join(f.source, 'dsh', 'desktop-snapshot-scopes.json'), scopes)
  const imported = await importLegacy(f.request, f.imports, () => {})
  const copied = await readFile(join(String(imported.dataRoot), 'harness', 'cordis.patch.yml'), 'utf8')
  expect(copied).not.toContain('OLD_AMBIENT_KEY')
  expect(copied).toContain('NIDOFY_IMPORT_')
  expect(await readFile(join(String(imported.dataRoot), 'harness', 'desktop-snapshot-scopes.json'), 'utf8')).toBe(scopes)
})

it.each(['none', 'zstd'] as const)('routes copies, converted %s generations and JSON metadata through the awaited writer', async (compression) => {
  const f = await fixture(0), writes: Array<{ path: string; bytes: number }> = []
  if (compression === 'zstd') {
    await writeFile(f.file + '.zstd', zstdCompressSync(Buffer.from(f.bytes))); await unlink(f.file)
  }
  const write: LegacyImportWriter = async (path, bytes, work) => {
    const result = await work()
    expect((await stat(path)).size).toBeLessThanOrEqual(bytes)
    writes.push({ path, bytes })
    return result
  }
  const imported = await importLegacy(f.request, f.imports, () => {}, undefined, { write })
  const generations = writes.filter(item => /session\.v\d+\.jsonl/.test(item.path))
  expect(generations).toHaveLength(1)
  expect(writes.filter(item => item.path.endsWith('import.json'))).toHaveLength(2)
  expect(writes.some(item => item.path.endsWith('cordis.patch.yml'))).toBe(true)
  expect(writes.some(item => item.path.endsWith('nidofy-import-connections.json'))).toBe(true)
  expect(imported.status).toBe('READY')
})

it('propagates denied migration admission without publishing a ready home or altering the source', async () => {
  const f = await fixture(0)
  const write: LegacyImportWriter = (path, _bytes, work) => {
    if (/session\.v\d+\.jsonl/.test(path)) throw Error('ISOLATED_ADMISSION_DENIED')
    return work()
  }
  await expect(importLegacy(f.request, f.imports, () => {}, undefined, { write })).rejects.toThrow('ISOLATED_ADMISSION_DENIED')
  expect(await readFile(f.file, 'utf8')).toBe(f.bytes)
  expect(await readdir(f.imports)).not.toContain(f.request.operationId)
  const retained = await readdir(join(f.imports, f.request.operationId + '.pending', 'harness', 'sessions', '_no-cwd', 'fixture-session'))
  expect(retained).toContain('session.jsonl')
  expect(retained).not.toContain(`session.v${SESSION_FORMAT_VERSION}.jsonl`)
  expect(retained.filter(name => name.startsWith('session.migration.'))).toEqual([])
})

it('refuses source growth before opening the copy file', async () => {
  const f = await fixture(0)
  const write: LegacyImportWriter = async (path, _bytes, work) => {
    if (path.endsWith('session.jsonl')) await writeFile(f.file, f.bytes + 'grew')
    return work()
  }
  await expect(importLegacy(f.request, f.imports, () => {}, undefined, { write })).rejects.toThrow('IMPORT_SOURCE_CHANGED')
  const copied = join(f.imports, f.request.operationId + '.pending', 'harness', 'sessions', '_no-cwd', 'fixture-session', 'session.jsonl')
  await expect(stat(copied)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('honors cancellation arriving during admission before the first metadata write', async () => {
  const f = await fixture(0), controller = new AbortController(), reason = Error('cancelled import')
  const write: LegacyImportWriter = (_path, _bytes, work) => { controller.abort(reason); return work() }
  await expect(importLegacy(f.request, f.imports, () => {}, undefined, { write, signal: controller.signal })).rejects.toBe(reason)
  await expect(stat(join(f.imports, f.request.operationId + '.pending', 'import.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.file, 'utf8')).toBe(f.bytes)
})
