/** Real filesystem inventory; no reservations, cleanup or user homes. */
import { expect, it, onTestFinished } from 'vitest'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measureManagedStorage } from '../src/storage/measurement.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'managed-storage-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

it('counts shared homes and linked regular files once, excludes official sessions and leaves bytes unchanged', async () => {
  const home = await fixture()
  await mkdir(join(home, 'nidofy-extras/notebooks'), { recursive: true })
  await mkdir(join(home, 'desktop-actions'), { recursive: true })
  await mkdir(join(home, 'sessions')); await mkdir(join(home, 'dsh-runtimes'))
  await writeFile(join(home, 'nidofy-extras/notebooks/current.json'), '12345')
  await link(join(home, 'nidofy-extras/notebooks/current.json'), join(home, 'desktop-actions/shared.json'))
  await writeFile(join(home, 'sessions/native.jsonl'), 'excluded-native-session')
  await writeFile(join(home, 'dsh-runtimes/node.exe'), 'excluded-runtime')
  await writeFile(join(home, '.credentials.yaml'), 'secret-not-read')
  const result = await measureManagedStorage([home, home, join(home, '.')])
  expect(result).toMatchObject({ measuredBytes: 5, observedBytes: 5, files: 1, scan: 'complete', admission: 'not-connected', issues: [] })
  expect(result.homes).toHaveLength(1)
  expect(await readFile(join(home, 'sessions/native.jsonl'), 'utf8')).toBe('excluded-native-session')
  expect(JSON.stringify(result)).not.toContain('secret-not-read')
})

it('marks unknown home and cache entries incomplete while retaining known measured bytes', async () => {
  const home = await fixture()
  await mkdir(join(home, 'cache'))
  await writeFile(join(home, 'cache/nidofy-session-query.sqlite'), 'index')
  await writeFile(join(home, 'cache/foreign-cache'), 'unknown')
  await writeFile(join(home, 'foreign-data'), 'unknown')
  const result = await measureManagedStorage([home])
  expect(result).toMatchObject({ measuredBytes: null, observedBytes: 5, scan: 'incomplete' })
  expect(result.issues.map(row => row.code)).toEqual(['UNKNOWN_ENTRY', 'UNKNOWN_ENTRY'])
})

it('reports missing homes as unreadable rather than a zero total', async () => {
  const home = await fixture(), result = await measureManagedStorage([join(home, 'missing')])
  expect(result).toMatchObject({ measuredBytes: null, observedBytes: 0, scan: 'incomplete', issues: [{ code: 'UNREADABLE', path: '' }] })
})

it('does not traverse linked managed directories or a linked cache ancestor', async () => {
  const root = await fixture(), home = join(root, 'home'), outside = join(root, 'external')
  await mkdir(home); await mkdir(outside)
  await writeFile(join(outside, 'nidofy-session-query.sqlite'), 'outside-index')
  await symlink(outside, join(home, 'cache'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(outside, join(home, 'desktop-actions'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(home, 'desktop-artifacts.json'), 'known')
  const result = await measureManagedStorage([home])
  expect(result).toMatchObject({ measuredBytes: null, observedBytes: 5, files: 1, scan: 'incomplete' })
  expect(result.issues.map(row => row.code)).toEqual(['LINKED_ENTRY', 'LINKED_ENTRY'])
  expect(await readFile(join(outside, 'nidofy-session-query.sqlite'), 'utf8')).toBe('outside-index')
})

it('honors cancellation before observation and rejects relative roots', async () => {
  const home = await fixture(), controller = new AbortController()
  controller.abort(Error('synthetic-stop'))
  await expect(measureManagedStorage([home], controller.signal)).rejects.toThrow('synthetic-stop')
  await expect(measureManagedStorage(['relative'])).rejects.toThrow('STORAGE_HOME_ABSOLUTE_REQUIRED')
})

it('counts imports once for sibling homes, including physical aliases of managed data', async () => {
  const root = await fixture(), first = join(root, 'first'), second = join(root, 'second')
  await mkdir(first); await mkdir(second); await mkdir(join(root, 'imports'))
  await writeFile(join(first, 'desktop-artifacts.json'), '12345')
  await link(join(first, 'desktop-artifacts.json'), join(root, 'imports', 'alias'))
  await writeFile(join(root, 'imports', 'original'), '123')
  expect(await measureManagedStorage([first, second])).toMatchObject({ measuredBytes: 8, observedBytes: 8, files: 2, scan: 'complete' })
})
