/** Start the production Main with caller-owned appData and resources; no installed protocol registration. */
import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'

const root = process.env.DSH_SELFTEST_CARRIER_ROOT
if (!root) throw Error('Missing isolated self-test carrier root')
app.setAppPath(join(root, 'app'))
app.setPath('appData', join(root, 'data'))
Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources') })
try { await import(pathToFileURL(join(root, 'app/lib/main.js')).href) }
catch (error) {
  await writeFile(join(root, 'main-startup-error.log'), String(error) + '\n')
  throw error
}
