/** Checksummed recovery records are flushed before corresponding security changes. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, readSync, truncateSync, writeFileSync, writeSync } from 'node:fs'

/** Append a checksummed batch and flush its complete records once.
 * @param path - Owned journal path.
 * @param values - One batch without per-record function arguments.
 * @returns After complete records and one batch flush; interrupted suffixes remain preserved.
 */
export function append(path: string, values: readonly unknown[]): void {
  if (existsSync(path)) {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Unsafe recovery journal: ${path}`)
    const input = openSync(path, 'r')
    let incomplete = false
    try {
      const length = fstatSync(input).size
      const last = Buffer.alloc(1)
      if (length > 0) readSync(input, last, 0, 1, length - 1)
      incomplete = length > 0 && last[0] !== 10
    } finally { closeSync(input) }
    if (incomplete) {
      const prior = readFileSync(path)
      const complete = prior.lastIndexOf(10) + 1
      if (complete === 0) throw new Error(`Incomplete recovery journal header: ${path}`)
      writeFileSync(`${path}.interrupted-${randomUUID()}`, prior.subarray(complete), { flag: 'wx', mode: 0o600 })
      truncateSync(path, complete)
    }
  }
  const descriptor = openSync(path, 'a', 0o600)
  try {
    const bytes = Buffer.from(values.map((value) => {
      const payload = JSON.stringify(value)
      return `${JSON.stringify({ payload, sha256: createHash('sha256').update(payload).digest('hex') })}\n`
    }).join(''))
    let offset = 0
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
