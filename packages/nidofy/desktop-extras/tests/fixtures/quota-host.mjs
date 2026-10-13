/** Real competing Host process: only built native protocol and Node standard library. */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const [executable, home, bytes, barrier] = process.argv.slice(2), ownerEpoch = randomUUID(), operationId = randomUUID()
const call = request => new Promise((resolve, reject) => {
  const child = execFile(executable, [home], { windowsHide: true }, (error, stdout) => {
    if (error) return reject(error)
    const value = JSON.parse(stdout)
    if (!value.ok) return reject(Error(value.error))
    resolve(value.value)
  })
  child.stdin.end(JSON.stringify({ action: 'quota', request: { ownerEpoch, ...request } }))
})
try {
  await call({ action: 'open', pid: process.pid, limitBytes: 1048576, safetyBytes: 1048576 })
  if (barrier === 'barrier') {
    const go = new Promise(resolve => process.once('message', resolve))
    process.send({ status: 'ready' }); await go
  }
  await call({ action: 'reserve', operationId, token: randomUUID(), scope: 'test:writer', maxWriteBytes: Number(bytes), terminalBytes: 65536 })
  process.send({ status: 'reserved', operationId })
} catch (error) { process.send({ status: 'refused', code: error.message }) }
process.on('message', () => process.exit(0))
