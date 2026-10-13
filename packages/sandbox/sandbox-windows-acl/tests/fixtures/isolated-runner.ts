/** Only native tests may inject a scratch recovery registry before loading the real runner. */
import { win32Sync } from '../../src/ffi.ts'
const directory = process.env.DSH_TEST_ACL_STORAGE
if (directory === undefined) throw new Error('Missing isolated recovery storage')
win32Sync().shGetFolderPathW = (_window, _folder, _token, _flags, buffer) => {
  buffer.write(directory, 'utf16le')
  return 0
}
await import('../../src/runner.ts')
