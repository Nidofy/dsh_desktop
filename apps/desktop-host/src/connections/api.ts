/** Desktop endpoints run after official connection authentication and origin checks. */
import { resolveConfig } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-client-connection'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { object } from './store.ts'
import { installConnections } from './runtime.ts'
import type { ConnectionStore } from './store.ts'
import { previewLegacy, productImport } from './import.ts'
import { connectionsHtml } from './ui.ts'
import { DeploymentSettings } from './deployment.ts'
import type { DesktopEgressPolicy } from './egress.ts'
import { measureManagedStorage } from '../storage/measurement.ts'
import { quotaRequest } from '../storage/api.ts'
import { storageHtml } from '../storage/ui.ts'
import { cleanupPreview } from '../storage/cleanup.ts'
import { installProtection } from './protection.ts'
import { installWorkbench, WorkbenchCommandError } from '../workbench/owner.ts'
import { workbenchHtml } from '../workbench/ui.ts'
import { selftestHtml } from '../selftest/ui.ts'
import { experimentsHtml } from '../experiments/ui.ts'

function plain(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function') {
    const get = value.get as () => unknown
    return plain(get.call(value))
  }
  if (Array.isArray(value)) return value.map(plain)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
  return value
}
function keeps(before: unknown, after: unknown): boolean {
  if (Array.isArray(before)) return Array.isArray(after)
    && before.length === after.length && before.every((item, i) => keeps(item, after[i]))
  if (before !== null && typeof before === 'object') return after !== null && typeof after === 'object'
    && Object.entries(before).every(([key, item]) => Object.hasOwn(after, key) && keeps(item, Reflect.get(after, key)))
  return Object.is(before, after)
}
/** A secret-free stability code for the owner-install diagnostic surfaced on degraded endpoints. */
function ownerDiagnosticOf(error: unknown): string {
  const message = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code
    : error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'CONNECTION_OWNER_FAILED'
}

/** Mount the local editor and migration operations on the existing Host.
 * The authenticated handler is registered before any subsystem installs, and a failed
 * connection-owner installation degrades to that repair surface instead of removing it;
 * failures of other subsystems stay visible to the caller.
 * @param ctx - Authenticated official Host connection dispatcher.
 * @param home - Distribution-isolated Harness home.
 * @param egress - Installed application HTTP policy, when present.
 * @param selftestNode - Application-owned standalone Node; non-Desktop compositions use their current Node.
 */
export async function installConnectionApi(ctx: Context, home: string, egress?: DesktopEgressPolicy,
  selftestNode?: string): Promise<void> {
  const deployment = new DeploymentSettings(ctx, home)
  let store: ConnectionStore | undefined
  let ownerDiagnostic: string | undefined
  let importedConnections: unknown = []
  // Installed after the handler registers; read through the holder so requests during a
  // failed installation observe the missing subsystem instead of an unassigned binding.
  const subsystems: { protection?: ReturnType<typeof installProtection>; workbench?: ReturnType<typeof installWorkbench> } = {}
  const validate = (namespace: string, config: unknown): void => {
    const row = ctx.configEditor.configuration().find(item => item.entry.options.id === namespace)
    const runtime = row?.entry.fiber?.runtime
    if (!runtime?.Config || namespace === 'schedule') throw new Error('IMPORT_SETTINGS_UNSUPPORTED')
    const result: unknown = resolveConfig(runtime, config)
    if (!keeps(config, plain(result))) throw new Error('IMPORT_SETTINGS_UNSUPPORTED')
  }
  ctx.on('connection/request', async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/nidofy/')) return next()
    response.setHeader('cache-control', 'no-store')
    if (url.pathname === '/api/nidofy/workbench/experiments/ui' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(experimentsHtml(url.searchParams.get('locale') === 'zh-CN')); return
    }
    if (url.pathname === '/api/nidofy/workbench/selftest/ui' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(selftestHtml(url.searchParams.get('locale') === 'zh-CN')); return
    }
    if (url.pathname === '/api/nidofy/storage/ui' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(storageHtml(url.searchParams.get('locale') === 'zh-CN')); return
    }
    if (url.pathname === '/api/nidofy/workbench/ui' && request.method === 'GET') {
      response.setHeader('content-type','text/html; charset=utf-8')
      response.end(workbenchHtml(url.searchParams.get('locale') === 'zh-CN')); return
    }
    if (url.pathname === '/api/nidofy/workbench/artifact/download' && request.method === 'GET') {
      if (subsystems.workbench === undefined) { response.writeHead(503); response.end('{}'); return }
      try { await subsystems.workbench.download(url.searchParams.get('id') ?? '',response) }
      catch (_error) { if (!response.headersSent) {response.writeHead(400);response.end('ARTIFACT_NOT_CONFIRMED')} else response.destroy() }
      return
    }
    if (url.pathname === '/api/nidofy/ui' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(connectionsHtml(url.searchParams.get('locale') === 'zh-CN')); return
    }
    response.setHeader('content-type', 'application/json')
    if (request.method !== 'POST') { response.writeHead(405); response.end('{}'); return }
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        size += bytes.length
        if (size > 2 * 1024 * 1024) throw new Error('REQUEST_TOO_LARGE')
        chunks.push(bytes)
      }
      const data = object(JSON.parse(Buffer.concat(chunks).toString()) as unknown)
      if (url.pathname === '/api/nidofy/companion') {
        if (data.action !== 'bootstrap') throw Error('COMPANION_ACTION_UNSUPPORTED')
        if (!store) throw Error('CONNECTION_OWNER_UNAVAILABLE')
        response.end(JSON.stringify({ hostEpoch: store.hostEpoch,
          notebook: ctx.get('nidofyNotebookV2') ? 'available'
            : ctx.configEditor.configuration().some(row => row.entry.options.name === '@nidofy/dsh-working-notebook'
              && row.entry.options.disabled === true) ? 'disabled' : 'unavailable' })); return
      }
      if (url.pathname === '/api/nidofy/quota') {
        response.end(JSON.stringify(await quotaRequest(ctx, data))); return
      }
      if (url.pathname === '/api/nidofy/cleanup-preview') {
        if (data.action !== 'preview' || Object.keys(data).some(key => key !== 'action')) throw Error('STORAGE_ACTION_UNSUPPORTED')
        const owner = ctx.get('nidofyStorage')
        if (!owner) throw Error('STORAGE_OWNER_UNAVAILABLE')
        response.end(JSON.stringify(await cleanupPreview(home, await owner.status()))); return
      }
      if (url.pathname === '/api/nidofy/deployment') {
        response.end(JSON.stringify(await deployment.request(data))); return
      }
      if (url.pathname === '/api/nidofy/egress') {
        if (!egress) throw Error('EGRESS_OWNER_UNAVAILABLE')
        response.end(JSON.stringify(await egress.request(data))); return
      }
      if (url.pathname === '/api/nidofy/storage') {
        if (data.action !== 'status') throw Error('STORAGE_ACTION_UNSUPPORTED')
        const owner = ctx.get('nidofyStorage')
        response.end(JSON.stringify(await measureManagedStorage([home], undefined, owner ? [await owner.importRoot()] : undefined))); return
      }
      if (url.pathname.startsWith('/api/nidofy/workbench/')) {
        if (subsystems.workbench === undefined) { response.writeHead(503); response.end(JSON.stringify({ error: 'WORKBENCH_UNAVAILABLE' })); return }
        const controller = new AbortController()
        const abort = (): void => { if (!response.writableEnded) controller.abort(Error('WORKBENCH_READ_CANCELLED')) }
        response.on('close', abort)
        try { response.end(JSON.stringify(await subsystems.workbench.request(
          url.pathname.slice('/api/nidofy/workbench/'.length), data, controller.signal))) }
        finally { response.off('close', abort) }
        return
      }
      if (store === undefined) {
        response.writeHead(503)
        response.end(JSON.stringify({ error: 'CONNECTION_OWNER_UNAVAILABLE', diagnosticCode: ownerDiagnostic })); return
      }
      let result: unknown
      switch (url.pathname) {
        case '/api/nidofy/status': result = { ...await store.inspect(typeof data.operationId === 'string' ? data.operationId : undefined), importedConnections }; break
        case '/api/nidofy/mutate': result = await store.mutate(data); break
        case '/api/nidofy/collect': await store.collect(); result = store.status(); break
        case '/api/nidofy/import': {
          const owner = ctx.get('nidofyStorage')
          if (owner) {
            const controller = new AbortController()
            const abort = (): void => { if (!response.writableEnded) controller.abort(Error('IMPORT_CANCELLED')) }
            response.on('close', abort)
            try { result = await productImport(owner, data, validate, controller.signal) }
            finally { response.off('close', abort) }
            break
          }
          if (data.action === 'preview') { result = await previewLegacy(data, join(home, '..', 'imports'), validate); break }
          throw Error('STORAGE_OWNER_UNAVAILABLE')
        }
        case '/api/nidofy/protection': {
          if (subsystems.protection === undefined) { response.writeHead(503); response.end(JSON.stringify({ error: 'PROTECTION_UNAVAILABLE' })); return }
          result = await subsystems.protection.configure(data); break
        }
        default: response.writeHead(404); response.end('{}'); return
      }
      response.end(JSON.stringify(result))
    } catch (error) {
      const ownCode: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
      const message = typeof ownCode === 'string' ? ownCode : error instanceof Error ? error.message : ''
      const code = /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'OPERATION_NOT_CONFIRMED'
      if (code === 'OPERATION_NOT_CONFIRMED' && url.pathname.includes('/experiments/engineering-')
        && error instanceof Error) {
        try { ctx.logger.warn(error.stack?.split('\n').slice(1).join('\n') ?? error.name) }
        catch (diagnosticError) { /* Private diagnostics do not replace the authenticated response. */ void diagnosticError }
      }
      const operationId: unknown = error instanceof Error ? Reflect.get(error, 'operationId') : undefined
      response.writeHead(code.includes('CONFLICT') ? 409 : 400)
      response.end(JSON.stringify({ error: code, ...(typeof operationId === 'string' ? { operationId } : {}),
        ...(error instanceof WorkbenchCommandError ? { detail: error.detail } : {}) }))
    }
  })
  try { store = await installConnections(ctx, join(home, 'nidofy-connections')) }
  catch (error) {
    // Owner-handled degradation keeps its routes; an installation failure keeps the
    // authenticated repair surface reporting the failure instead of removing it.
    ownerDiagnostic = ownerDiagnosticOf(error)
  }
  try { importedConnections = JSON.parse(await readFile(join(home, 'nidofy-import-connections.json'), 'utf8')) as unknown }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  subsystems.protection = installProtection(ctx, home, process.env.DSH_DESKTOP_PROTECTION_HELPER ?? '')
  subsystems.workbench = installWorkbench(ctx, subsystems.protection, home, store, selftestNode)
}
