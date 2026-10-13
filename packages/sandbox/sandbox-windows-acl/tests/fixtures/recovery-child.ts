/** Native crash-recovery fixture; never used by a shipped profile. */
import { win32Sync } from '../../src/ffi.ts'
import { WorkspaceGrantLease } from '../../src/recovery.ts'
import { workspaceWriteSid } from '../../src/workspace-sid.ts'

const [root, storage, crash] = process.argv.slice(2)
if (root === undefined || storage === undefined) throw new Error('Missing recovery fixture paths')
const native = win32Sync()
const api = { ...native, shGetFolderPathW: (_window: null, _folder: number, _token: null, _flags: number, buffer: Buffer) => {
  buffer.write(storage, 'utf16le')
  return 0
}, ntSetSecurityObject: (...args: Parameters<typeof native.ntSetSecurityObject>) => {
  const result = native.ntSetSecurityObject(...args)
  if (crash === 'first-write' && result >= 0) process.exit(99)
  return result
} }
WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root))
process.stdout.write('ready\n')
setInterval(() => {}, 1_000)
