/** Independently enabled working notes over official Session, prompt and compaction services. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { installContextV2 } from '@nidofy/dsh-desktop-extras/context'
import type {} from '@nidofy/dsh-desktop-extras/storage'
import { NotebookSettingsStore } from './settings.ts'

export const name = 'nidofy-working-notebook'
export const inject = ['connection', 'tools', 'sessionQuery', 'sessionPersistence', 'sessions', 'systemPrompt', 'llm']
/** Notebook bounds and the initial enhancement choice before a saved preference exists. */
export interface Config {
  /** Maximum active notes; retired notes remain in history. */
  maxActiveEntries: number
  /** Maximum complete active injection bytes, including instructions. */
  maxActiveBytes: number
  /** Maximum candidate delta bytes. */
  maxDeltaBytes: number
  /** Maximum complete evidence appendix bytes. */
  maxEvidenceBytes: number
  /** Maximum on-disk history namespace bytes, including publication temporaries. */
  maxHistoryBytes: number
  /** Initial profile-wide enhancement choice before the first saved UI preference. */
  autoOrganize: boolean
  /** Maximum retained per-session synchronization metadata entries; in-flight entries remain pinned. */
  maxCachedSessions: number
  /** Maximum original source rows returned for the recent-source picker. */
  recentEventLimit: number
  /** Maximum raw events examined for one recent-source request. */
  recentScanEvents: number
}
export const Config: z<Config> = z.object({
  maxActiveEntries: z.number().step(1).min(1).max(256).default(64),
  maxActiveBytes: z.number().step(1).min(1024).max(65536).default(16384),
  maxDeltaBytes: z.number().step(1).min(1024).max(65536).default(16384),
  maxEvidenceBytes: z.number().step(1).min(1024).max(262144).default(65536),
  maxHistoryBytes: z.number().step(1).min(65536).max(1073741824).default(16777216),
  autoOrganize: z.boolean().default(false),
  maxCachedSessions: z.number().step(1).min(1).max(1024).default(32),
  recentEventLimit: z.number().step(1).min(1).max(256).default(40),
  recentScanEvents: z.number().step(1).min(1).max(4096).default(256),
})
/** Mount tools, note snapshots, optional summaries and authenticated local UI requests. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Preserve the original location; v2 copy-converts legacy notes without replacing their files.
  const home = join(resolveDshHome(), 'nidofy-extras', 'notebooks')
  const storage = ctx.get('nidofyStorage')
  const settings = new NotebookSettingsStore(home, config.autoOrganize, storage)
  await settings.open()
  ctx.effect(() => () => settings.close())
  const budgets = { maxActiveEntries: config.maxActiveEntries, maxActiveBytes: config.maxActiveBytes,
    maxDeltaBytes: config.maxDeltaBytes, maxEvidenceBytes: config.maxEvidenceBytes, maxHistoryBytes: config.maxHistoryBytes }
  const context = installContextV2(ctx, home, budgets,
    () => ({ enabled: settings.value.autoOrganize, revision: settings.value.revision, signal: settings.signal }),
    { maxCachedSessions: config.maxCachedSessions, recentEventLimit: config.recentEventLimit, recentScanEvents: config.recentScanEvents },
    storage && { admit: async (write) => {
      const lease = await storage.reserve('notebook:publish', write.maxWriteBytes, 0)
      return { run: work => lease.run(work), settle: async () => { await lease.release() } }
    } })
  ctx.on('connection/request', async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const prefix = ['/api/nidofy-notebook/', '/api/nidofy-extras/context/'].find(value => url.pathname.startsWith(value))
    if (!prefix) return next()
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    if (request.method !== 'POST') { response.writeHead(405); response.end('{}'); return }
    const abort = new AbortController()
    const disconnected = () => { if (!response.writableEnded) abort.abort() }
    request.once('aborted', disconnected); response.once('close', disconnected)
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of request) {
        const value: unknown = chunk
        if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw Error('NOTEBOOK_INVALID_REQUEST')
        const bytes = Buffer.from(value); size += bytes.length
        if (size > 128 * 1024) throw Error('NOTEBOOK_REQUEST_TOO_LARGE')
        chunks.push(bytes)
      }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString())
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('NOTEBOOK_INVALID_REQUEST')
      const input = raw as Record<string, unknown>, method = url.pathname.slice(prefix.length)
      const result = method === 'settings' ? { ...settings.value }
        : method === 'save-settings' ? await settings.save(input)
          : await context(method, input, abort.signal)
      response.end(JSON.stringify(result))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      response.writeHead(message.endsWith('CONFLICT') ? 409 : 400)
      response.end(JSON.stringify({ error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'NOTEBOOK_OPERATION_FAILED' }))
    } finally { request.off('aborted', disconnected); response.off('close', disconnected) }
  })
}
