/** Read-only byte inventory of explicitly owned Desktop data; never a quota admission receipt. */
import { lstat, readdir, realpath, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

/** Relative paths whose current Desktop writers own managed bytes. */
export const managedStoragePaths = [
  'nidofy-connections', 'nidofy-import-connections.json', 'nidofy-extras',
  'desktop-actions', 'desktop-changes', 'desktop-artifacts.json',
  'desktop-artifact-exports', 'desktop-snapshot-scopes.json', 'desktop-task-snapshots',
  'cache/nidofy-session-query.sqlite', 'cache/nidofy-session-query.sqlite-wal', 'cache/nidofy-session-query.sqlite-shm',
] as const

/** Official runtime/session/config paths outside this managed-data inventory; credentials are never opened. */
const excluded = new Set(['sessions', 'storages', 'attachments', 'spill', 'dsh-runtimes', 'profiles', 'settings.yaml',
  'settings.yml', '.credentials.yaml', '.credentials.yaml.lock', '.env', '.env.lock', 'cordis.patch.yml',
  'node_modules', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])

/** A read failure or an unowned entry keeps the complete measured total unavailable. */
export interface StorageMeasurementIssue {
  /** Canonical home, or the requested home when canonicalization failed. */
  home: string
  /** Relative entry; an empty string identifies the home itself. */
  path: string
  /** Stable classification without file content or operating-system error text. */
  code: 'UNREADABLE' | 'LINKED_ENTRY' | 'UNKNOWN_ENTRY' | 'UNSTABLE_ENTRY' | 'UNSUPPORTED_ENTRY'
}

/** Observed logical file lengths; concurrent writers can change them after the observation. */
export interface StorageMeasurement {
  /** Distinct canonical homes; shared connection homes appear once. */
  homes: readonly string[]
  /** Complete total, or null when any issue prevents complete accounting. */
  measuredBytes: number | null
  /** Sum of known file lengths; never a substitute for an incomplete total. */
  observedBytes: number
  /** Count of distinct regular files; hardlinks are counted once when their identity is available. */
  files: number
  /** All configured paths were observable, with no unknown entries. */
  scan: 'complete' | 'incomplete'
  /** Read failures, links, unknown items or files that changed while measured. */
  issues: readonly StorageMeasurementIssue[]
  /** Current available volume bytes per home; null for unavailable/unsafe numeric results. */
  availableBytes: Readonly<Record<string, number | null>>
  /** This observation has no reservation, settlement or cross-process admission authority. */
  admission: 'not-connected'
}

/** Measure each shared home once, without following managed links or reading file content.
 * Native sessions, runtimes and project files are excluded. Unknown home/cache entries make the
 * total incomplete; this inventory does not create directories, locks, leases or cleanup plans.
 * @param homes - Absolute distribution Harness homes to observe.
 * @param signal - Cancellation checked before each filesystem observation.
 * @param importRoots - Native-resolved import roots for explicitly adopted homes; no adoption authority is inferred here.
 * @returns Known lengths and a nullable complete total; no atomic snapshot or quota guarantee.
 */
export async function measureManagedStorage(homes: readonly string[], signal?: AbortSignal,
  importRoots?: readonly string[]): Promise<StorageMeasurement> {
  const roots = new Set<string>(), distributions = new Set<string>(), identities = new Set<string>(), issues: StorageMeasurementIssue[] = []
  const availableBytes: Record<string, number | null> = {}
  let observedBytes = 0, files = 0
  const issue = (home: string, path: string, code: StorageMeasurementIssue['code']): void => { issues.push({ home, path, code }) }
  async function visit(home: string, path: string, missingAllowed = false): Promise<void> {
    signal?.throwIfAborted()
    const full = join(home, path)
    try {
      const before = await lstat(full, { bigint: true })
      if (before.isSymbolicLink()) { issue(home, path, 'LINKED_ENTRY'); return }
      if (before.isDirectory()) {
        const entries = await readdir(full), after = await lstat(full, { bigint: true })
        if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
          || before.mtimeNs !== after.mtimeNs) {
          issue(home, path, 'UNSTABLE_ENTRY'); return
        }
        for (const entry of entries) await visit(home, join(path, entry))
        const completed = await lstat(full, { bigint: true })
        if (!completed.isDirectory() || completed.isSymbolicLink() || before.dev !== completed.dev || before.ino !== completed.ino
          || before.mtimeNs !== completed.mtimeNs) issue(home, path, 'UNSTABLE_ENTRY')
        return
      }
      if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER)) { issue(home, path, 'UNSUPPORTED_ENTRY'); return }
      const after = await lstat(full, { bigint: true })
      if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs) {
        issue(home, path, 'UNSTABLE_ENTRY'); return
      }
      if (before.ino === 0n) issue(home, path, 'UNSUPPORTED_ENTRY')
      const id = before.ino === 0n ? full : `${String(before.dev)}:${String(before.ino)}`
      if (identities.has(id)) return
      identities.add(id); observedBytes += Number(before.size); files++
      if (!Number.isSafeInteger(observedBytes)) issue(home, path, 'UNSUPPORTED_ENTRY')
    } catch (error) {
      signal?.throwIfAborted()
      if (missingAllowed && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      issue(home, path, 'UNREADABLE')
    }
  }
  for (const requested of homes) {
    signal?.throwIfAborted()
    if (!isAbsolute(requested)) throw Error('STORAGE_HOME_ABSOLUTE_REQUIRED')
    let home: string
    try { home = await realpath(requested) } catch (_error) { issue(requested, '', 'UNREADABLE'); continue }
    const key = process.platform === 'win32' ? home.toLowerCase() : home
    if (roots.has(key)) continue
    roots.add(key)
    const distribution = dirname(home), distributionKey = process.platform === 'win32' ? distribution.toLowerCase() : distribution
    if (importRoots === undefined && !distributions.has(distributionKey)) {
      distributions.add(distributionKey)
      // Import copies remain owned by the original distribution even though they are outside its Harness home.
      await visit(distribution, 'imports', true)
    }
    let unusableCache = false
    try {
      const stat = await statfs(home, { bigint: true }), bytes = stat.bavail * stat.bsize
      availableBytes[home] = bytes >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null
    } catch (_error) { availableBytes[home] = null }
    try {
      const known = new Set(managedStoragePaths.map(path => path.split('/')[0]))
      for (const entry of await readdir(home)) if (!known.has(entry) && !excluded.has(entry)) issue(home, entry, 'UNKNOWN_ENTRY')
      // The cache has no broad exemption: every retained foreign cache item stays unknown.
      try {
        const cache = await lstat(join(home, 'cache'))
        if (cache.isSymbolicLink() || !cache.isDirectory()) {
          issue(home, 'cache', cache.isSymbolicLink() ? 'LINKED_ENTRY' : 'UNSUPPORTED_ENTRY')
          unusableCache = true
        } else {
          for (const entry of await readdir(join(home, 'cache'))) if (!(managedStoragePaths as readonly string[]).includes(`cache/${entry}`)) {
            issue(home, join('cache', entry), 'UNKNOWN_ENTRY')
          }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue(home, 'cache', 'UNREADABLE') }
    } catch (_error) { issue(home, '', 'UNREADABLE') }
    for (const path of managedStoragePaths) if (!unusableCache || !path.startsWith('cache/')) await visit(home, path, true)
  }
  for (const root of importRoots ?? []) {
    if (!isAbsolute(root)) throw Error('STORAGE_HOME_ABSOLUTE_REQUIRED')
    await visit(root, '', true)
  }
  signal?.throwIfAborted()
  return { homes: [...roots], measuredBytes: issues.length === 0 ? observedBytes : null, observedBytes, files,
    scan: issues.length === 0 ? 'complete' : 'incomplete', issues, availableBytes, admission: 'not-connected' }
}
