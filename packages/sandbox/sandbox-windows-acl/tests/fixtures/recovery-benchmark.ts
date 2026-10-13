/** Offline native lifecycle timing, using only a fresh isolated tree and recovery registry. */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { win32Sync } from '../../src/ffi.ts'
import { WorkspaceGrantLease } from '../../src/recovery.ts'
import { workspaceWriteSid } from '../../src/workspace-sid.ts'
import { readSecurityState, sameSecurityState } from '../../src/security-state.ts'

const base = mkdtempSync(join(tmpdir(), 'dsh-acl-benchmark-'))
const root = join(base, 'workspace')
const storage = join(base, 'storage')
mkdirSync(root)
mkdirSync(storage)
const api = { ...win32Sync(), shGetFolderPathW: (_window: null, _folder: number, _token: null, _flags: number, buffer: Buffer) => {
  buffer.write(storage, 'utf16le')
  return 0
} }
let owner: WorkspaceGrantLease | undefined
let joined: WorkspaceGrantLease | undefined
try {
  for (let index = 0; index < 1_000; index++) writeFileSync(join(root, `file-${index}.txt`), 'isolated benchmark')
  const paths = [root, ...readdirSync(root).map(name => join(root, name))]
  const original = paths.map(path => readSecurityState(api, path))
  const start = performance.now()
  owner = WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root))
  const grantMs = performance.now() - start
  const registry = join(storage, 'DeepSeek', 'Harness', 'acl-recovery-v1')
  const journal = readdirSync(registry, { recursive: true }).find(name => String(name).endsWith('active.jsonl'))
  if (journal === undefined) throw new Error('Missing active journal')
  const journalBytes = statSync(join(registry, String(journal))).size
  const joinStart = performance.now()
  joined = WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root), owner.authorization)
  const joinMs = performance.now() - joinStart
  owner.dispose()
  const releaseStart = performance.now()
  joined.dispose()
  const releaseMs = performance.now() - releaseStart
  if (!paths.every((path, index) => sameSecurityState(readSecurityState(api, path), original[index]!))) throw new Error('Restoration mismatch')
  process.stdout.write(`${JSON.stringify({ platform: process.platform, arch: process.arch, files: 1_000, objects: paths.length,
    grantMs, joinMs, releaseMs, journalBytes, restoredEveryObject: true })}\n`)
} finally {
  owner?.dispose()
  joined?.dispose()
  rmSync(base, { recursive: true, force: true })
}
