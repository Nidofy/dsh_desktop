/** Durable, process-leased workspace grants. Recovery never guesses pre-existing permissions. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { append } from './journal.ts'
import { withPathLock } from './acl.ts'
import { allocOverlapped, isInvalidHandle, throwLastError } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import { createdObjectSecurityState, grantedSecurityState, isRecoveryStorageIntegrity, isSecurityState, readSecurityState, sameSecurityState, withSecurityObject, writeSecurityState } from './security-state.ts'
import type { SecurityState } from './security-state.ts'
import { workspaceWriteSid } from './workspace-sid.ts'
import * as abi from './win32-abi.ts'

interface ObjectRecord {
  kind: 'object' | 'created' | 'moved'
  path: string
  identity: string
  directory: boolean
  before: SecurityState
  after: SecurityState
}

interface Journal {
  root: string
  sid: string
  objects: ObjectRecord[]
  prepared: boolean
  ready: boolean
}

interface LeaseLock { handle: NativePtr; overlapped: NativePtr; path: string }

function inside(root: string, path: string): boolean {
  const child = relative(root.toLowerCase(), path.toLowerCase())
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function identity(path: string): { id: string; directory: boolean } {
  const stat = lstatSync(path, { bigint: true })
  if (stat.isSymbolicLink()) throw new Error(`Windows ACL recovery refuses a reparse path: ${path}`)
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported Windows ACL object: ${path}`)
  return { id: `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`, directory: stat.isDirectory() }
}

function assertPath(root: string, path: string, expected?: string): void {
  if (!inside(root, path)) throw new Error(`Recovery path escapes its workspace: ${path}`)
  let current = path
  while (true) {
    const value = identity(current)
    if (current === path && expected !== undefined && value.id !== expected) {
      throw new Error(`Windows ACL recovery refuses a replaced file: ${path}`)
    }
    if (current.toLowerCase() === root.toLowerCase()) break
    current = dirname(current)
  }
  if (realpathSync(root).toLowerCase() !== root.toLowerCase()) throw new Error(`Windows ACL workspace identity changed: ${root}`)
}

function walk(root: string): string[] {
  const result = [root]
  for (const path of result) {
    assertPath(root, path)
    if (!identity(path).directory) continue
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      // Junctions and symbolic links never transfer the workspace grant to their targets.
      if (!entry.isSymbolicLink()) result.push(join(path, entry.name))
    }
  }
  return result
}

function decodeRecord(line: string): unknown {
  const record: unknown = JSON.parse(line)
  if (typeof record !== 'object' || record === null || !('payload' in record) || typeof record.payload !== 'string'
    || !('sha256' in record) || record.sha256 !== createHash('sha256').update(record.payload).digest('hex')) {
    throw new Error('Windows ACL recovery record checksum failed; preserve the journal for diagnosis')
  }
  return JSON.parse(record.payload)
}

function readJournal(path: string): Journal {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Unsafe recovery journal: ${path}`)
  const text = readFileSync(path, 'utf8')
  // Ignore only the incomplete trailing record. Original snapshots precede all
  // mutations and are synced as a complete batch; malformed complete records fail closed.
  const lines = text.slice(0, text.lastIndexOf('\n')).split('\n')
  const header = decodeRecord(lines.shift() ?? '')
  if (typeof header !== 'object' || header === null || !('version' in header) || header.version !== 1
    || !('root' in header) || typeof header.root !== 'string' || !isAbsolute(header.root)
    || !('sid' in header) || typeof header.sid !== 'string' || !/^S-1-4-\d+-\d+(?:-1)?$/u.test(header.sid)) {
    throw new Error(`Invalid Windows ACL recovery header: ${path}`)
  }
  const journal: Journal = { root: header.root, sid: header.sid, objects: [], prepared: false, ready: false }
  const objects = new Map<string, ObjectRecord>()
  const identities = new Map<string, ObjectRecord>()
  if (workspaceWriteSid(header.root) !== header.sid) throw new Error(`Recovery SID does not match its workspace: ${path}`)
  if (createHash('sha256').update(header.root.toLowerCase()).digest('hex') !== basename(dirname(path))) {
    throw new Error(`Recovery workspace does not match its storage directory: ${path}`)
  }
  for (const line of lines) {
    const value = decodeRecord(line)
    if (typeof value !== 'object' || value === null || !('kind' in value)) throw new Error(`Invalid recovery entry: ${path}`)
    if (value.kind === 'ready') { journal.ready = true; continue }
    if (value.kind === 'prepared') { journal.prepared = true; continue }
    if ((value.kind !== 'object' && value.kind !== 'created' && value.kind !== 'moved') || !('path' in value) || typeof value.path !== 'string'
      || !isAbsolute(value.path) || !inside(journal.root, value.path)
      || !('identity' in value) || typeof value.identity !== 'string'
      || !('directory' in value) || typeof value.directory !== 'boolean'
      || !('before' in value) || !isSecurityState(value.before) || !('after' in value) || !isSecurityState(value.after)) {
      throw new Error(`Invalid Windows ACL recovery entry: ${path}`)
    }
    const previous = objects.get(value.path.toLowerCase())
    if (previous !== undefined && (value.kind === 'object' || value.identity === previous.identity)) {
      throw new Error(`Duplicate recovery object: ${path}`)
    }
    if (value.kind === 'object') {
      if (!sameSecurityState(grantedSecurityState(value.before, journal.sid, value.directory), value.after)) {
        throw new Error(`Recovery grant does not match its original permissions: ${path}`)
      }
    } else if (value.kind === 'moved') {
      const original = identities.get(value.identity)
      if (original === undefined || !sameSecurityState(original.before, value.before) || !sameSecurityState(original.after, value.after)) {
        throw new Error(`Moved recovery object has no original identity: ${path}`)
      }
    } else {
      const parent = objects.get(dirname(value.path).toLowerCase())
      if (parent === undefined || !sameSecurityState(
        createdObjectSecurityState(value.after, journal.sid, parent.before, value.directory), value.before)) {
        throw new Error(`Invalid new-object recovery policy: ${path}`)
      }
    }
    const record: ObjectRecord = { kind: value.kind, path: value.path, identity: value.identity,
      directory: value.directory, before: value.before, after: value.after }
    journal.objects.push(record)
    objects.set(value.path.toLowerCase(), record)
    identities.set(value.identity, record)
  }
  return journal
}

function lockLease(api: Win32Bindings, path: string): LeaseLock | null {
  const handle = api.createFileW(path, abi.GENERIC_READ | abi.GENERIC_WRITE,
    abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE, null, abi.OPEN_ALWAYS, 0, null)
  if (isInvalidHandle(handle)) throwLastError(api, 'CreateFileW', path)
  const overlapped = allocOverlapped()
  if (api.lockFileEx(handle, abi.LOCKFILE_EXCLUSIVE_LOCK | abi.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped) === 0) {
    const code = api.getLastError()
    api.closeHandle(handle)
    if (code === abi.ERROR_LOCK_VIOLATION) return null
    throw new Error(`Cannot determine Windows ACL lease ownership (${code}): ${path}`)
  }
  return { handle, overlapped, path }
}

function closeLease(api: Win32Bindings, lease: LeaseLock): void {
  const unlocked = api.unlockFileEx(lease.handle, 0, 1, 0, lease.overlapped)
  const closed = api.closeHandle(lease.handle)
  if (unlocked === 0 || closed === 0) throwLastError(api, 'CloseHandle', lease.path)
}

function liveLeases(api: Win32Bindings, directory: string): boolean {
  let live = false
  for (const name of readdirSync(directory)) {
    if (!/^[a-f\d-]{36}\.lease$/u.test(name)) continue
    const path = join(directory, name)
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Reparse recovery lease refused: ${path}`)
    const lease = lockLease(api, path)
    if (lease === null) { live = true; continue }
    closeLease(api, lease)
    unlinkSync(path)
  }
  return live
}

function restore(api: Win32Bindings, directory: string, journal: Journal): void {
  const journalPath = join(directory, 'active.jsonl')
  const known = new Map(journal.objects.map(record => [record.path.toLowerCase(), record]))
  const identities = new Map(journal.objects.map(record => [record.identity, record]))
  const failures: unknown[] = []
  const first = journal.objects[0]
  if (journal.prepared && !existsSync(journal.root)) throw new Error(`Workspace is missing or moved; recovery record retained: ${journal.root}`)
  if (existsSync(journal.root) && first !== undefined) {
    withSecurityObject(api, journal.root, (object) => {
      if (object.identity !== first.identity) throw new Error(`Windows ACL recovery refuses a replaced workspace: ${journal.root}`)
    })
  }
  // Parents first, using non-propagating writes. New objects inherit their recovered parent policy.
  if (journal.prepared && existsSync(journal.root)) {
    for (const path of walk(journal.root)) {
      try {
        withSecurityObject(api, path, (object) => {
          let record = known.get(path.toLowerCase())
          const current = readSecurityState(api, path, object)
          if (record === undefined || object.identity !== record.identity) {
            const original = identities.get(object.identity)
            if (original !== undefined) {
              record = { ...original, kind: 'moved', path }
            } else {
              const parentRecord = known.get(dirname(path).toLowerCase())
              if (parentRecord === undefined || !sameSecurityState(readSecurityState(api, dirname(path)), parentRecord.before)) {
                throw new Error(`Parent permissions must recover before its new child: ${path}`)
              }
              const before = createdObjectSecurityState(current, journal.sid, parentRecord.before, object.directory)
              record = { kind: 'created', path, identity: object.identity, directory: object.directory, before, after: current }
            }
            append(journalPath, [record])
            journal.objects.push(record)
            known.set(path.toLowerCase(), record)
          }
          if (sameSecurityState(current, record.before)) return
          if (!sameSecurityState(current, record.after)) throw new Error(`Windows ACL recovery conflicts with changed permissions: ${path}`)
          writeSecurityState(api, path, record.before, object)
          if (!sameSecurityState(readSecurityState(api, path, object), record.before)) throw new Error(`Windows ACL restoration verification failed: ${path}`)
        })
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, `Windows ACL recovery incomplete; original permissions retained in ${journalPath}`)
  // Full snapshots are needed only until verified recovery succeeds. Retain a bounded receipt.
  writeFileSync(join(directory, 'last-restoration.json'), JSON.stringify({ root: journal.root, objects: journal.objects.length, restoredAt: new Date().toISOString() }))
  unlinkSync(journalPath)
  const ready = join(directory, 'ready.json')
  if (existsSync(ready)) unlinkSync(ready)
}

function recoveryRoot(api: Win32Bindings): string {
  const buffer = Buffer.alloc(520)
  const result = api.shGetFolderPathW(null, 0x1c, null, 0, buffer)
  if (result < 0) throw new Error(`Cannot locate the current user's persistent Windows ACL recovery storage (${result})`)
  const local = buffer.toString('utf16le').split('\0')[0] ?? ''
  if (!isAbsolute(local)) throw new Error('Windows returned an invalid Local AppData directory')
  const path = join(local, 'DeepSeek', 'Harness', 'acl-recovery-v1')
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) {
    throw new Error(`Windows ACL recovery storage must not be redirected: ${path}`)
  }
  if (!isRecoveryStorageIntegrity(readSecurityState(api, path))) {
    throw new Error(`Windows ACL recovery storage must have Medium or higher integrity: ${path}`)
  }
  return path
}

function withRegistryLock<T>(api: Win32Bindings, storage: string, action: () => T): T {
  // The runner changes TEMP for its child. Registry lock identity must remain
  // stable across that change and across every install owned by this Windows user.
  const lockApi = { ...api, getTempPathW: (_length: number, buffer: Buffer) => {
    buffer.write(storage, 'utf16le')
    return storage.length
  } }
  return withPathLock(lockApi, storage, action)
}

function recoverIdle(api: Win32Bindings, storage: string): unknown[] {
  const failures: unknown[] = []
  for (const name of readdirSync(storage)) {
    if (!/^[a-f\d]{64}$/u.test(name)) continue
    const directory = join(storage, name)
    try {
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error(`Unsafe recovery directory: ${directory}`)
      const path = join(directory, 'active.jsonl')
      if (existsSync(path) && !liveLeases(api, directory)) restore(api, directory, readJournal(path))
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

/** Recover abandoned workspace grants at provider startup; live owners are never revoked.
 * @param api - Win32 calls.
 * @returns failures retained for diagnosis; unrelated workspaces remain usable.
 */
export function recoverAbandonedGrants(api: Win32Bindings): readonly unknown[] {
  const storage = recoveryRoot(api)
  return withRegistryLock(api, storage, () => recoverIdle(api, storage))
}

/** A process-held reference to one recoverable workspace grant. */
export class WorkspaceGrantLease {
  private released = false

  /** Opaque live-owner reference passed to a runner; joining after its release is refused. */
  get authorization(): string { return this.lease.path.slice(this.lease.path.lastIndexOf(sep) + 1, -6) }

  private constructor(
    private readonly api: Win32Bindings,
    private readonly storage: string,
    private readonly directory: string,
    private readonly lease: LeaseLock,
  ) {}

  /** Acquire or share a workspace grant after restoring abandoned records.
   * @param api - Win32 calls.
   * @param path - existing canonical workspace directory.
   * @param sid - deterministic workspace write capability.
   * @param joinOwner - join this still-live owner only; never create or revive an authorization.
   * @returns a reference that must outlive every confined child using it.
   */
  static acquire(api: Win32Bindings, path: string, sid: string, joinOwner?: string): WorkspaceGrantLease {
    const root = realpathSync(path)
    if (sid !== workspaceWriteSid(root)) throw new Error(`Workspace capability does not match its canonical path: ${root}`)
    const storage = recoveryRoot(api)
    if (inside(root, storage) || inside(storage, root)) throw new Error('Workspace must not contain Windows ACL recovery storage')
    return withRegistryLock(api, storage, () => {
      const digest = createHash('sha256').update(root.toLowerCase()).digest('hex')
      const directory = join(storage, digest)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const journalPath = join(directory, 'active.jsonl')
      if (joinOwner !== undefined) {
        if (!/^[a-f\d-]{36}$/u.test(joinOwner)) throw new Error('Invalid Windows ACL owner authorization')
        const ownerPath = join(directory, `${joinOwner}.lease`)
        if (!existsSync(journalPath) || !existsSync(ownerPath)) throw new Error('Windows ACL owner authorization was released')
        const owner = lockLease(api, ownerPath)
        if (owner !== null) {
          closeLease(api, owner)
          throw new Error('Windows ACL owner authorization is no longer live')
        }
      }
      if (existsSync(journalPath) && !liveLeases(api, directory)) restore(api, directory, readJournal(journalPath))
      for (const name of readdirSync(storage)) {
        if (name === digest || !/^[a-f\d]{64}$/u.test(name)) continue
        const other = join(storage, name, 'active.jsonl')
        if (!existsSync(other)) continue
        const descriptor = openSync(other, 'r')
        let otherRoot: unknown
        try {
          const bytes = Buffer.alloc(65_536)
          const count = readSync(descriptor, bytes)
          const end = bytes.subarray(0, count).indexOf(10)
          if (end < 0) throw new Error(`Invalid recovery header: ${other}`)
          const header = decodeRecord(bytes.subarray(0, end).toString('utf8'))
          otherRoot = typeof header === 'object' && header !== null && 'root' in header ? header.root : undefined
        } finally { closeSync(descriptor) }
        if (typeof otherRoot !== 'string') throw new Error(`Invalid recovery workspace: ${other}`)
        if (inside(otherRoot, root) || inside(root, otherRoot)) throw new Error(`Overlapping Windows ACL workspace lease: ${otherRoot}`)
      }
      const lease = lockLease(api, join(directory, `${randomUUID()}.lease`))
      if (lease === null) throw new Error('Could not acquire a fresh Windows ACL lease')
      try {
        if (existsSync(journalPath)) {
          const summaryPath = join(directory, 'ready.json')
          if (!existsSync(summaryPath) || lstatSync(summaryPath).isSymbolicLink()) throw new Error(`Workspace grant is not ready: ${root}`)
          const summary = decodeRecord(readFileSync(summaryPath, 'utf8'))
          if (typeof summary !== 'object' || summary === null || !('root' in summary) || summary.root !== root
            || !('sid' in summary) || summary.sid !== sid || !('identity' in summary) || typeof summary.identity !== 'string'
            || !('after' in summary) || !isSecurityState(summary.after)) throw new Error(`Invalid live Windows ACL grant summary: ${root}`)
          const expected = summary.after
          withSecurityObject(api, root, (object) => {
            if (object.identity !== summary.identity) throw new Error(`Workspace identity changed during its Windows ACL lease: ${root}`)
            if (!sameSecurityState(readSecurityState(api, root, object), expected)) throw new Error(`Workspace permissions changed during its Windows ACL lease: ${root}`)
          })
        } else {
          append(journalPath, [{ version: 1, root, sid }])
          const records: ObjectRecord[] = []
          for (const target of walk(root)) {
            withSecurityObject(api, target, (object) => {
              const before = readSecurityState(api, target, object)
              let after: SecurityState
              try { after = grantedSecurityState(before, sid, object.directory) } catch (error) {
                throw new Error(`Cannot prepare Windows workspace permissions at ${target}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
              }
              records.push({ kind: 'object', path: target, identity: object.identity, directory: object.directory, before, after })
            })
          }
          append(journalPath, [...records, { kind: 'prepared' }])
          for (const record of records) {
            withSecurityObject(api, record.path, (object) => {
              if (object.identity !== record.identity) throw new Error(`File replaced while preparing Windows ACL grant: ${record.path}`)
              const current = readSecurityState(api, record.path, object)
              if (sameSecurityState(current, record.after)) return // another hard-link alias was already granted
              if (!sameSecurityState(current, record.before)) throw new Error(`Permissions changed while preparing Windows ACL grant: ${record.path}`)
              writeSecurityState(api, record.path, record.after, object)
              if (!sameSecurityState(readSecurityState(api, record.path, object), record.after)) throw new Error(`Windows ACL grant verification failed: ${record.path}`)
            })
          }
          append(journalPath, [{ kind: 'ready' }])
          const first = records[0]
          if (first === undefined) throw new Error(`Workspace snapshot has no root: ${root}`)
          const summary = join(directory, 'ready.json')
          if (existsSync(summary)) unlinkSync(summary)
          append(summary, [{ root, sid, identity: first.identity, after: first.after }])
        }
        return new WorkspaceGrantLease(api, storage, directory, lease)
      } catch (error) {
        closeLease(api, lease)
        unlinkSync(lease.path)
        try {
          if (existsSync(journalPath) && !liveLeases(api, directory)) restore(api, directory, readJournal(journalPath))
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `Windows ACL grant failed and recovery remains pending: ${root}`)
        }
        throw error
      }
    })
  }

  /** Release this process reference, restoring original permissions after the last owner exits. */
  dispose(): void {
    if (this.released) return
    withRegistryLock(this.api, this.storage, () => {
      this.released = true
      closeLease(this.api, this.lease)
      unlinkSync(this.lease.path)
      if (!liveLeases(this.api, this.directory)) {
        const path = join(this.directory, 'active.jsonl')
        if (existsSync(path)) restore(this.api, this.directory, readJournal(path))
      }
    })
  }
}
