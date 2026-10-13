/** Start the production Main in the caller's isolated development app. */
import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.DSH_COMPANION_QUALIFICATION_ROOT
if (!root) throw Error('Missing isolated companion qualification root')
app.setAppPath(join(root, 'app'))
app.setPath('appData', join(root, 'data'))
Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources') })
await import(pathToFileURL(join(root, 'app/lib/main.js')).href)
