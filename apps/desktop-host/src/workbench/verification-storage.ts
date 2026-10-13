/** Exclusive publication of bounded verification records inside the existing quota-managed action directory. */
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { storageAdmission } from './legacy/storage-admission.mjs'

/** Publish a complete sync-confirmed file without replacing any committed record.
 * @param path - Owner-selected destination, never supplied directly by a consumer.
 * @param bytes - Complete bounded record or retained log.
 * @param beforePublish - Optional current authority/lifetime check immediately before exclusive publication.
 * @returns False for an existing destination; callers inspect it and never replay execution.
 */
export async function publishRecord(path: string, bytes: string | Buffer, beforePublish?: () => void): Promise<boolean> {
  if (Buffer.byteLength(bytes) > 1024 * 1024) throw Error('VERIFICATION_RECORD_TOO_LARGE')
  return storageAdmission.write(path, Math.max(1, Buffer.byteLength(bytes) * 2), async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = path + '.' + randomUUID() + '.tmp', file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    try {
      try { beforePublish?.(); await link(temporary, path) }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false
        throw error
      }
      return true
    } finally { await unlink(temporary) }
  })
}

/** Read one stable, bounded ordinary record; unsupported content is validated by its owner.
 * @param path - Owner-selected immutable record or log path.
 * @returns Exact retained bytes, or null for an absent commit.
 */
export async function readRecord(path: string): Promise<Buffer | null> {
  let info
  try { info = await lstat(path, { bigint: true }) }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  let ancestor = dirname(resolve(path))
  for (;;) {
    if ((await lstat(ancestor)).isSymbolicLink()) throw Error('VERIFICATION_RECORD_REFUSED')
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024n * 1024n) throw Error('VERIFICATION_RECORD_REFUSED')
  const file = await open(path, 'r')
  try {
    const before = await file.stat({ bigint: true }), bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const part = await file.read(bytes, offset, bytes.length - offset, null)
      if (!part.bytesRead) break
      offset += part.bytesRead
    }
    const after = await file.stat({ bigint: true }), selected = await lstat(path, { bigint: true })
    if (before.dev !== info.dev || before.ino !== info.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(offset) !== before.size
      || selected.dev !== after.dev || selected.ino !== after.ino) throw Error('VERIFICATION_RECORD_CHANGED')
    return bytes.subarray(0, offset)
  } finally { await file.close() }
}
