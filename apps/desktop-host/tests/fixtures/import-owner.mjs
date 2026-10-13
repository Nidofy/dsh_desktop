// Actual child owner for lost-ACK/restart qualification; only isolated paths arrive on argv.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const [home, executable, operationId] = process.argv.slice(2)
const ownerEpoch = randomUUID(), token = randomUUID() + randomUUID()
function call(request) {
  return JSON.parse(execFileSync(executable, [home], { windowsHide: true,
    input: JSON.stringify({ action: 'quota', request: { ownerEpoch, ...request } }),
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }, encoding: 'utf8' }))
}
const open = call({ action: 'open', pid: process.pid, limitBytes: 1048576, safetyBytes: 1048576 })
if (!open.ok) throw Error(open.error)
const grant = call({ action: 'import-start', operationId, scope: 'node:import', token,
  maxWriteBytes: 65536, fingerprint: '0'.repeat(64) })
if (!grant.ok) throw Error(grant.error)
// The parent receives no grant or capability; it must query the persisted operation.
process.send({ started: true })
process.on('message', value => { if (value === 'exit') process.exit(0) })
