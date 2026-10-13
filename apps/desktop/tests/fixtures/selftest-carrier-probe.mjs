/** Test-only counts and settled Shell diagnostics from the real isolated carrier owners. */
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
/** Test-only Loader identity. */
export const name = 'selftest-carrier-qualification'
/** Actual owners observed by the isolated profile. */
export const inject = ['connection', 'agents', 'llm', 'shell', 'nidofyStorage']
/** Observe without replacing execution policy or creating an Agent.
 * @param ctx - The full profile's actual Host context.
 */
export async function apply(ctx) {
  const root = process.env.DSH_SELFTEST_CARRIER_ROOT
  if (!root) throw Error('Missing isolated carrier observation directory')
  const log = (kind, detail) => appendFile(join(root, 'host-observations.jsonl'), JSON.stringify({ kind, detail }) + '\n')
  await log('observer-installed', { electron: process.versions.electron, node: process.versions.node })
  let modelRequests = 0, createdAgents = 0
  ctx.on('llm/stream', (_options, next) => { modelRequests++; return next() })
  ctx.on('agent/created', () => { createdAgents++ })
  ctx.effect(() => {
    const original = ctx.shell.execute, storage = ctx.nidofyStorage, native = storage.native
    storage.native = async function(...args) {
      try { return await native.apply(this, args) }
      catch (error) { await log('native-error', String(error) + ' ' + String(error.cause)); throw error }
    }
    ctx.shell.execute = async function(spec) {
      await log('shell-request', { command: spec.command, cwd: spec.workdir,
        runAsNode: spec.env?.ELECTRON_RUN_AS_NODE, mode: spec.sandboxPolicy?.mode })
      try {
        const handle = await original.call(this, spec), result = handle.result
        handle.result = async function(...args) {
          try {
            const settled = await result.apply(this, args)
            await log('shell-result', settled)
            return settled
          } catch (error) { await log('shell-error', String(error)); throw error }
        }
        return handle
      } catch (error) { await log('shell-start-error', String(error)); throw error }
    }
    return () => { ctx.shell.execute = original; storage.native = native }
  })
  ctx.on('connection/request', async (request, response, next) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/selftest-qualification') return next()
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ modelRequests, createdAgents }))
  })
}
