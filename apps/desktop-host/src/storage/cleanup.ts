/** Bounded read-only cleanup candidates; no token here authorizes deletion. */
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { QuotaStatus } from '@nidofy/dsh-desktop-extras/storage'

type CleanupPreviewId = Branded<'DesktopCleanupPreviewId'>
const caches = ['nidofy-session-query.sqlite', 'nidofy-session-query.sqlite-wal', 'nidofy-session-query.sqlite-shm']
// Bounds the public preview response; an omitted candidate is never authorized for execution.
const MAX_PREVIEW_FILES = 256

/** Preview only retained disposable cache/staging files; backups and unknown names are excluded.
 * The current executor has no cleanup operation. A future executor must independently pin/recheck
 * identities and drain writers; this hash is a change token, never a capability.
 * @param home - Product-owned Harness home.
 * @param quota - Current ledger observation, kept separate from filesystem inventory.
 * @returns Bounded candidates, explicit issues and unavailable execution; no file mutations.
 */
export async function cleanupPreview(home: string, quota: QuotaStatus) {
  const items: Array<{ path: string; bytes: number; identity: string; changed: string; category: 'cache' | 'staging' }> = []
  const issues: Array<{ path: string; code: string }> = []
  let omitted = 0
  const issue = (path: string, code: string): void => {
    if (issues.length < MAX_PREVIEW_FILES) issues.push({ path, code }); else omitted++
  }
  for (const folder of ['cache', 'desktop-artifact-exports']) {
    try {
      const parent = await lstat(join(home, folder))
      if (parent.isSymbolicLink() || !parent.isDirectory()) { issue(folder, 'LINKED_OR_UNSUPPORTED'); continue }
      for (const name of (await readdir(join(home, folder))).sort()) {
        const path = folder + '/' + name
        const allowed = folder === 'cache' ? caches.includes(name)
          : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/.test(name)
        if (!allowed) { issue(path, 'UNKNOWN_NAME'); continue }
        if (items.length >= MAX_PREVIEW_FILES) { omitted++; continue }
        const stat = await lstat(join(home, folder, name), { bigint: true })
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
          || stat.ino === 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          issue(path, 'LINKED_OR_UNSUPPORTED'); continue
        }
        items.push({ path, bytes: Number(stat.size), identity: `${String(stat.dev)}:${String(stat.ino)}`,
          changed: String(stat.mtimeNs), category: folder === 'cache' ? 'cache' : 'staging' })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue(folder, 'UNREADABLE')
    }
  }
  const token = brandString<CleanupPreviewId>(createHash('sha256').update(JSON.stringify({ rootId: quota.rootId, items, issues, omitted })).digest('hex'))
  return { token, items, issues, omitted, reservedBytes: quota.reservedBytes,
    restartRequired: true, execution: 'not-supported', destructive: false }
}
