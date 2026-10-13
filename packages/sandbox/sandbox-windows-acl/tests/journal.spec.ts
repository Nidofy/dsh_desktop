/** Large batches remain durable without expanding records into function arguments. */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { append } from '../src/journal.ts'

it('flushes a large snapshot batch and its prepared marker with complete checksummed records', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-acl-journal-'))
  try {
    const path = join(root, 'active.jsonl')
    const records = Array.from({ length: 131072 }, (_, index) => ({ kind: 'object', index }))
    append(path, [...records, { kind: 'prepared' }])
    const lines = readFileSync(path, 'utf8').split('\n')
    expect(lines.pop()).toBe('')
    expect(lines).toHaveLength(131073)
    for (const index of [0, 131071, 131072]) {
      const row = JSON.parse(lines[index]!) as { payload: string; sha256: string }
      expect(row.sha256).toBe(createHash('sha256').update(row.payload).digest('hex'))
      expect(JSON.parse(row.payload)).toEqual(index === 131072 ? { kind: 'prepared' } : records[index])
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
