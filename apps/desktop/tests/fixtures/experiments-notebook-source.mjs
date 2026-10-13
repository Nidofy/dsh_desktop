/** Test-only source preparation writes isolated official Session/Notebook input without creating an Agent or contacting a provider. */
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { NotebookV2Store } from '@nidofy/dsh-desktop-extras/notebook'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'experiments-notebook-source'
export const inject = ['connection', 'sessionPersistence', 'nidofyNotebookV2', 'nidofyStorage']
/** Register only the fixture-local setup operation; shipped profiles never mount this module.
 * @param ctx - Complete isolated Desktop profile with its real Notebook and native quota owners.
 */
export function apply(ctx) {
  ctx.on('connection/request', async (request, response, next) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/api/experiments-notebook-source') return next()
    if (request.method !== 'POST') { response.writeHead(405); response.end('{}'); return }
    const session = Session.create(SessionId('synthetic-notebook-' + randomUUID()))
    const event = session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Synthetic Notebook source for isolated built analysis' }] }), { surfaceOp: 'append' })
    const lease = await ctx.nidofyStorage.reserve('test:notebook-source', 2 * 1024 * 1024, 0)
    try {
      await lease.run(async () => {
        const writer = await ctx.sessionPersistence.create(session.header)
        try { await writer.append([event]); await writer.flush() } finally { await writer.close() }
        const durable = await ctx.sessionPersistence.observeDurable(session.id)
        const store = new NotebookV2Store(join(resolveDshHome(), 'nidofy-extras/notebooks'), {
          maxActiveEntries: 64, maxActiveBytes: 16384, maxDeltaBytes: 16384, maxEvidenceBytes: 65536, maxHistoryBytes: 16777216,
        })
        try {
          const scope = { sessionId: session.id, generation: durable.generation }
          await ctx.sessionPersistence.withGeneration(session.id, durable.generation, () => store.publish(0, scope,
            { scope, baseRevision: 0, cursors: { evidenceThrough: 0 }, operations: [{ action: 'ADD', id: 'built-source',
              kind: 'constraint', text: 'Keep this analysis free of tools and commands', seq: 0, quote: 'Synthetic Notebook source' }] },
            durable.events, 'user', new AbortController().signal))
        } finally { await store.close() }
      })
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ sessionId: session.id }))
    } finally { await lease.release() }
  })
}
