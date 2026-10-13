/** Test-only persistent-store redirection; never read an actual user's recovery journals. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { win32Sync } from '../../src/ffi.ts'

export function isolatedRecovery(): () => string {
  let directory = ''
  let restore: (() => void) | undefined
  beforeAll(() => {
    if (process.platform !== 'win32') return
    directory = mkdtempSync(join(tmpdir(), 'dsh-acl-store-test-'))
    const api = win32Sync()
    const original = api.shGetFolderPathW.bind(api)
    api.shGetFolderPathW = (_window, _folder, _token, _flags, buffer) => {
      buffer.write(directory, 'utf16le')
      return 0
    }
    restore = () => { api.shGetFolderPathW = original }
  })
  afterAll(() => {
    restore?.()
    if (directory !== '') rmSync(directory, { recursive: true, force: true })
  })
  return () => directory
}
