/** Export authority is checked at exclusive publication, after the temporary copy has synced. */
import { it, expect } from 'vitest'
import { join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { publishRecord } from '../src/workbench/verification-storage.ts'
import { verificationFixture } from './verification-fixture.ts'

it.skipIf(process.platform !== 'win32')('withdraws a synced temporary export when final permission or cancellation checks refuse', async () => {
  const f = await verificationFixture(undefined, true), directory = join(f.home, 'nidofy-extras/analysis-exports-v1')
  const path = join(directory, 'selected.json')
  await expect(publishRecord(path, '{"original":true}', () => { throw Error('ANALYSIS_PERMISSION_CHANGED') })).rejects.toThrow('ANALYSIS_PERMISSION_CHANGED')
  expect(await readdir(directory)).toEqual([])
  await expect(readFile(path)).rejects.toThrow()
  const abort = new AbortController(); abort.abort()
  await expect(publishRecord(path, '{"original":true}', () => { abort.signal.throwIfAborted() })).rejects.toThrow()
  expect(await readdir(directory)).toEqual([])
  expect(await publishRecord(path, '{"original":true}')).toBe(true)
  expect(await publishRecord(path, '{"original":false}')).toBe(false)
  expect(await readFile(path, 'utf8')).toBe('{"original":true}')
}, 60000)
