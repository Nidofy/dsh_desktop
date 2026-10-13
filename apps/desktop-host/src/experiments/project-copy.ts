/** Explicit input closures are copied into fresh engineering workspaces without inheriting project trust. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { object } from '../connections/store.ts'

type Stamp = { identity: string; bytes: number; modified: string; changed: string }
/** Full selected input closure; fingerprints describe copied file bytes, never a model-input substitute. */
export interface ProjectCopyPreview {
  source: string
  root: Stamp
  paths: string[]
  entries: { path: string; kind: 'file' | 'directory'; stamp: Stamp; digest: string | null }[]
  bytes: number
}
/** Independent engineering-copy budget. Reaching a bound refuses the entire operation without pruning evidence. */
export interface ProjectCopyBudget { maxEntries: number; maxBytes: number; maxFileBytes: number }
/** Validate retained copy observations without reading current sources or treating a saved fingerprint as write authority.
 * @param input - Complete independent engineering intent's copy observation.
 * @returns Original bounded observation; future/unknown fields and Windows path aliases refuse.
 */
export function parseProjectCopyPreview(input: unknown): ProjectCopyPreview {
  const row = object(input)
  const fields = (value: Record<string, unknown>, names: readonly string[]): void => {
    if (Object.keys(value).length !== names.length || Object.keys(value).some(key => !names.includes(key))) throw Error('EXPERIMENT_COPY_RECORD_INVALID')
  }
  const readStamp = (input: unknown): Stamp => {
    const value = object(input); fields(value, ['identity', 'bytes', 'modified', 'changed'])
    if (typeof value.identity !== 'string' || !/^\d+:\d+$/u.test(value.identity) || typeof value.bytes !== 'number'
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || typeof value.modified !== 'string' || !/^\d+$/u.test(value.modified)
      || typeof value.changed !== 'string' || !/^\d+$/u.test(value.changed)) throw Error('EXPERIMENT_COPY_RECORD_INVALID')
    return { identity: value.identity, bytes: value.bytes, modified: value.modified, changed: value.changed }
  }
  fields(row, ['source', 'root', 'paths', 'entries', 'bytes'])
  if (typeof row.source !== 'string' || !isAbsolute(row.source) || row.source.length > 4096 || row.source.includes('\0')
    || !Array.isArray(row.paths) || !row.paths.every((value: unknown): value is string => typeof value === 'string')
    || !Array.isArray(row.entries) || row.entries.length > 4096 || typeof row.bytes !== 'number'
    || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 64 * 1024 * 1024) throw Error('EXPERIMENT_COPY_RECORD_INVALID')
  const selected = paths(row.paths), entries = row.entries.map((input: unknown): ProjectCopyPreview['entries'][number] => {
    const value = object(input); fields(value, ['path', 'kind', 'stamp', 'digest'])
    if (typeof value.path !== 'string' || value.kind !== 'directory' && value.kind !== 'file'
      || value.kind === 'directory' && value.digest !== null || value.kind === 'file'
      && (typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.digest))) throw Error('EXPERIMENT_COPY_RECORD_INVALID')
    paths([value.path])
    if (!selected.some(path => value.path === path || String(value.path).startsWith(path + '/'))) throw Error('EXPERIMENT_COPY_RECORD_INVALID')
    return { path: value.path, kind: value.kind, stamp: readStamp(value.stamp), digest: value.digest as string | null }
  })
  const keys = entries.map(entry => process.platform === 'win32' ? entry.path.toLowerCase() : entry.path)
  if (new Set(keys).size !== keys.length || selected.some(path => !entries.some(entry => entry.path === path))
    || entries.reduce((sum, entry) => sum + (entry.kind === 'file' ? entry.stamp.bytes : 0), 0) !== row.bytes) {
    throw Error('EXPERIMENT_COPY_RECORD_INVALID')
  }
  return { source: row.source, root: readStamp(row.root), paths: selected, entries, bytes: row.bytes }
}
function stamp(info: Awaited<ReturnType<typeof metadata>>): Stamp {
  return { identity: `${info.dev}:${info.ino}`, bytes: Number(info.size), modified: String(info.mtimeNs), changed: String(info.ctimeNs) }
}
const metadata = (path: string) => lstat(path, { bigint: true })
const same = (a: Stamp, b: Stamp): boolean => JSON.stringify(a) === JSON.stringify(b)
function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}
function validate(budget: ProjectCopyBudget): void {
  if (![budget.maxEntries, budget.maxBytes, budget.maxFileBytes].every(value => Number.isSafeInteger(value) && value > 0)
    || budget.maxEntries > 4096 || budget.maxBytes > 64 * 1024 * 1024 || budget.maxFileBytes > budget.maxBytes) {
    throw Error('EXPERIMENT_COPY_BUDGET_INVALID')
  }
}
function paths(input: readonly string[]): string[] {
  if (input.length < 1 || input.length > 64 || input.some(path => !path || !path.isWellFormed() || path.length > 1024
    || /[\\:*?"<>|\x00-\x1f]/u.test(path) || isAbsolute(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(?:\.git|\.hg|\.svn)$/iu.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)))) {
    throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  }
  const rows = [...input].sort()
  const key = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
  if (rows.some((path, index) => rows.slice(0, index).some(prior => key(path) === key(prior)
    || key(path).startsWith(key(prior) + '/')))) throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  return rows
}
async function noLinks(path: string): Promise<void> {
  const info = await metadata(path)
  if (info.isSymbolicLink()) throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  const parent = resolve(path, '..')
  if (parent !== path) await noLinks(parent)
}
async function fileBytes(path: string, expected: Stamp, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  if (expected.bytes > limit) throw Error('EXPERIMENT_COPY_LIMIT')
  await noLinks(path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || !same(stamp(before), expected)) throw Error('EXPERIMENT_COPY_CHANGED')
    const buffer = Buffer.alloc(expected.bytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true }), selected = await metadata(path)
    if (offset !== expected.bytes || !same(stamp(after), expected) || !same(stamp(selected), expected)
      || selected.isSymbolicLink() || selected.nlink !== 1n) throw Error('EXPERIMENT_COPY_CHANGED')
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Inspect every selected ordinary entry, including dirty/untracked files, without writing or granting command trust.
 * @param source - Explicit existing workspace; linked ancestors refuse.
 * @param selected - Complete relative input roots; VCS metadata and overlapping selections refuse.
 * @param budget - Independent copy bounds, enforced against the full closure.
 * @param signal - Preview lifetime; cancelled previews allocate no destination.
 * @returns Exact file-byte observations and physical identities for confirmation and revalidation.
 */
export async function previewProjectCopy(source: string, selected: readonly string[], budget: ProjectCopyBudget,
  signal: AbortSignal): Promise<ProjectCopyPreview> {
  validate(budget); signal.throwIfAborted()
  if (!isAbsolute(source)) throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  await noLinks(source)
  const root = await realpath(source), before = await metadata(root)
  if (!before.isDirectory()) throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  const result: ProjectCopyPreview = { source: root, root: stamp(before), paths: paths(selected), entries: [], bytes: 0 }
  const visit = async (path: string, depth: number): Promise<void> => {
    signal.throwIfAborted()
    const target = resolve(root, path)
    if (!contained(root, target) || result.entries.length >= budget.maxEntries || depth > 128) throw Error('EXPERIMENT_COPY_LIMIT')
    await noLinks(target)
    const info = await metadata(target), observed = stamp(info)
    if (info.isFile()) {
      if (info.nlink !== 1n || result.bytes + observed.bytes > budget.maxBytes) throw Error('EXPERIMENT_COPY_LIMIT')
      const bytes = await fileBytes(target, observed, budget.maxFileBytes, signal)
      result.entries.push({ path, kind: 'file', stamp: observed, digest: digest(bytes) }); result.bytes += bytes.length
    } else if (info.isDirectory()) {
      result.entries.push({ path, kind: 'directory', stamp: observed, digest: null })
      const names: string[] = [], directory = await opendir(target, { bufferSize: 32 })
      for await (const entry of directory) {
        signal.throwIfAborted()
        if (result.entries.length + names.length >= budget.maxEntries) throw Error('EXPERIMENT_COPY_LIMIT')
        paths([entry.name]); names.push(entry.name)
      }
      for (const name of names.sort()) await visit(path + '/' + name, depth + 1)
      if (!same(stamp(await metadata(target)), observed)) throw Error('EXPERIMENT_COPY_CHANGED')
    } else { throw Error('EXPERIMENT_COPY_PATH_REFUSED') }
  }
  for (const path of result.paths) await visit(path, 0)
  if (!same(stamp(await metadata(root)), result.root)) throw Error('EXPERIMENT_COPY_CHANGED')
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('EXPERIMENT_COPY_LIMIT')
  return result
}

/** Exclusively copy a confirmed closure into a fresh owner-selected directory; partial copies remain retained on failure.
 * @param preview - Exact owner-produced confirmation, re-read in full before and after copying.
 * @param destination - Fresh absolute workspace outside the source; existing targets and linked ancestors refuse.
 * @param budget - Independently confirmed bounds, never inherited from a self-test ticket.
 * @param signal - Copy lifetime; cancellation stops further writes without deleting evidence.
 * @returns Canonical isolated workspace. No project action is trusted or executed by this operation.
 */
export async function copyProject(preview: ProjectCopyPreview, destination: string, budget: ProjectCopyBudget,
  signal: AbortSignal): Promise<string> {
  if (!isAbsolute(destination) || contained(preview.source, destination) || contained(destination, preview.source)) {
    throw Error('EXPERIMENT_COPY_PATH_REFUSED')
  }
  if (JSON.stringify(await previewProjectCopy(preview.source, preview.paths, budget, signal)) !== JSON.stringify(preview)) {
    throw Error('EXPERIMENT_COPY_CHANGED')
  }
  await noLinks(resolve(destination, '..')); signal.throwIfAborted()
  await mkdir(destination, { mode: 0o700 })
  const root = await realpath(destination), rootIdentity = stamp(await metadata(root)).identity
  for (const entry of preview.entries) {
    signal.throwIfAborted()
    if ((await metadata(root)).isSymbolicLink() || stamp(await metadata(root)).identity !== rootIdentity) throw Error('EXPERIMENT_COPY_CHANGED')
    const target = resolve(root, entry.path)
    if (!contained(root, target)) throw Error('EXPERIMENT_COPY_PATH_REFUSED')
    const parent = resolve(target, '..')
    await mkdir(parent, { recursive: true, mode: 0o700 }); await noLinks(parent)
    if (entry.kind === 'directory') { await mkdir(target, { mode: 0o700 }); continue }
    const bytes = await fileBytes(join(preview.source, entry.path), entry.stamp, budget.maxFileBytes, signal)
    if (digest(bytes) !== entry.digest) throw Error('EXPERIMENT_COPY_CHANGED')
    signal.throwIfAborted()
    const file = await open(target, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  }
  if (JSON.stringify(await previewProjectCopy(preview.source, preview.paths, budget, signal)) !== JSON.stringify(preview)) {
    throw Error('EXPERIMENT_COPY_CHANGED')
  }
  signal.throwIfAborted()
  return root
}
