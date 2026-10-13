/** Copies retain complete isolated inputs and refuse changes/links without touching the source or pruning failures. */
import { expect, it } from 'vitest'
import { link, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyProject, previewProjectCopy } from '../src/experiments/project-copy.ts'
const budget = { maxEntries: 128, maxBytes: 16384, maxFileBytes: 8192 }
const signal = () => new AbortController().signal
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-engineering-copy-')), source = join(root, 'source')
  await mkdir(source); await mkdir(join(source, 'src')); await mkdir(join(source, '.git'))
  await writeFile(join(source, 'src/input.txt'), '完整输入\n'); await writeFile(join(source, 'untracked.bin'), Buffer.from([0, 255, 1]))
  const index = resolve('.build/dispatch/evidence/relay-27/input-roots')
  await mkdir(index, { recursive: true })
  await writeFile(join(index, randomUUID() + '.json'), JSON.stringify({ root, source, synthetic: true, retained: true,
    paidRequests: 0, createdAgents: 0, engineeringActions: 0 }) + '\n', { flag: 'wx' })
  return { root, source, destination: join(root, 'copy') }
}
it('copies the complete declared closure including untracked/binary inputs, with fresh independent file identities', async () => {
  const f = await fixture(), before = await previewProjectCopy(f.source, ['src', 'untracked.bin'], budget, signal())
  expect(before.bytes).toBe(Buffer.byteLength('完整输入\n') + 3)
  await copyProject(before, f.destination, budget, signal())
  expect(await readFile(join(f.destination, 'src/input.txt'), 'utf8')).toBe('完整输入\n')
  expect(await readFile(join(f.destination, 'untracked.bin'))).toEqual(Buffer.from([0, 255, 1]))
  expect(await readdir(f.destination)).toEqual(['src', 'untracked.bin'])
  await writeFile(join(f.destination, 'src/input.txt'), 'changed copy')
  expect(await readFile(join(f.source, 'src/input.txt'), 'utf8')).toBe('完整输入\n')
  expect(await previewProjectCopy(f.source, before.paths, budget, signal())).toEqual(before)
})
it('refuses changes before allocation, existing destinations and ancestor/source overlap', async () => {
  const f = await fixture(), before = await previewProjectCopy(f.source, ['src'], budget, signal())
  await writeFile(join(f.source, 'src/input.txt'), 'changed source')
  await expect(copyProject(before, f.destination, budget, signal())).rejects.toThrow('EXPERIMENT_COPY_CHANGED')
  expect(await readdir(f.root)).toEqual(['source'])
  const next = await previewProjectCopy(f.source, ['src'], budget, signal())
  await expect(copyProject(next, join(f.source, 'copy'), budget, signal())).rejects.toThrow('EXPERIMENT_COPY_PATH_REFUSED')
  await expect(copyProject(next, f.root, budget, signal())).rejects.toThrow('EXPERIMENT_COPY_PATH_REFUSED')
  await mkdir(f.destination)
  await expect(copyProject(next, f.destination, budget, signal())).rejects.toThrow()
  expect(await readdir(f.destination)).toEqual([])
})
it('refuses incomplete budgets, oversized multibyte files, traversal, VCS metadata and Windows aliases', async () => {
  const f = await fixture()
  for (const paths of [['.git'], ['src', 'src/input.txt'], ['../source'], ['src/../src'], ['src/'], ['src\\input.txt'], ['CON'], ['src.']]) {
    await expect(previewProjectCopy(f.source, paths, budget, signal())).rejects.toThrow('EXPERIMENT_COPY_PATH_REFUSED')
  }
  await expect(previewProjectCopy(f.source, ['src'], { ...budget, maxBytes: 2, maxFileBytes: 2 }, signal())).rejects.toThrow('EXPERIMENT_COPY_LIMIT')
  await expect(previewProjectCopy(f.source, ['src'], { ...budget, maxEntries: 1 }, signal())).rejects.toThrow('EXPERIMENT_COPY_LIMIT')
  await expect(previewProjectCopy(f.source, ['src'], { ...budget, maxBytes: 0 }, signal())).rejects.toThrow('EXPERIMENT_COPY_BUDGET_INVALID')
})
it('refuses hardlinked source files and linked directories or destinations', async () => {
  const f = await fixture()
  await link(join(f.source, 'src/input.txt'), join(f.source, 'alias.txt'))
  await expect(previewProjectCopy(f.source, ['src'], budget, signal())).rejects.toThrow('EXPERIMENT_COPY_LIMIT')
  await symlink(f.source, join(f.root, 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(previewProjectCopy(join(f.root, 'linked-source'), ['untracked.bin'], budget, signal())).rejects.toThrow('EXPERIMENT_COPY_PATH_REFUSED')
  const before = await previewProjectCopy(f.source, ['untracked.bin'], budget, signal())
  await expect(copyProject(before, join(f.root, 'linked-source/copy'), budget, signal())).rejects.toThrow('EXPERIMENT_COPY_PATH_REFUSED')
})
it('cancelled previews/copies allocate no new workspace and preserve the complete original input', async () => {
  const f = await fixture(), controller = new AbortController()
  const preview = await previewProjectCopy(f.source, ['src'], budget, signal())
  controller.abort(Error('CANCELLED'))
  await expect(previewProjectCopy(f.source, ['src'], budget, controller.signal)).rejects.toThrow('CANCELLED')
  await expect(copyProject(preview, f.destination, budget, controller.signal)).rejects.toThrow('CANCELLED')
  expect(await readdir(f.root)).toEqual(['source'])
})
it('refuses a wide directory before copying and preserves deterministic complete ordering at the exact entry budget', async () => {
  const f = await fixture()
  await writeFile(join(f.source, 'src/z.txt'), 'z'); await writeFile(join(f.source, 'src/a.txt'), 'a')
  const exact = await previewProjectCopy(f.source, ['src'], { ...budget, maxEntries: 4 }, signal())
  expect(exact.entries.map(row => row.path)).toEqual(['src', 'src/a.txt', 'src/input.txt', 'src/z.txt'])
  await writeFile(join(f.source, 'src/m.txt'), 'm')
  await expect(previewProjectCopy(f.source, ['src'], { ...budget, maxEntries: 4 }, signal())).rejects.toThrow('EXPERIMENT_COPY_LIMIT')
  expect((await readdir(join(f.source, 'src'))).sort()).toEqual(['a.txt', 'input.txt', 'm.txt', 'z.txt'])
  expect(await readdir(f.root)).toEqual(['source'])
})
