/** Test-only counters observe the actual official persistence owner; shipped profiles never mount this module. */
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { randomBytes } from 'node:crypto'

export const name = 'experiments-session-resource-observer'
export const inject = ['connection', 'sessionPersistence']
/** Count real engineering durable reads and generation callbacks in the isolated supported profile.
 * @param ctx - Actual fixture profile; no alternate reader or model provider is installed.
 */
export function apply(ctx) {
  const owner = ctx.sessionPersistence, counts = new Map(), emptySessions = new Set()
  const count = (id, key) => {
    if (!String(id).startsWith('engineering-task-')) return
    const row = counts.get(String(id)) ?? { observeDurable: 0, withGeneration: 0 }
    row[key]++; counts.set(String(id), row)
  }
  ctx.effect(() => {
    const observe = owner.observeDurable, protect = owner.withGeneration
    owner.observeDurable = function(id, options) { count(id, 'observeDurable'); return observe.call(this, id, options) }
    owner.withGeneration = function(id, generation, work, options) {
      count(id, 'withGeneration'); return protect.call(this, id, generation, work, options)
    }
    return () => { owner.observeDurable = observe; owner.withGeneration = protect }
  })
  ctx.on('connection/request', async (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api/experiments-session-resource-observer') return next()
    const id = url.searchParams.get('id')
    if (!/^engineering-task-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id ?? '')) {
      response.writeHead(400); response.end('{}'); return
    }
    const action = url.searchParams.get('action')
    if (request.method === 'POST' && action === 'append' && emptySessions.has(id)) {
      emptySessions.delete(id)
      const session = Session.create(SessionId(id)), event = session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Late synthetic append after the original drained checkpoint' }] }), { surfaceOp: 'append' })
      const writer = await owner.open(session.id, 'write')
      try { await writer.append([event]); await writer.flush() } finally { await writer.close() }
      response.setHeader('content-type', 'application/json'); response.end('{}'); return
    }
    if (request.method === 'POST' && ['oversize', 'logical', 'empty'].includes(action)) {
      const session = Session.create(SessionId(id))
      const cwd = url.searchParams.get('cwd'), header = { ...session.header, ...cwd ? { cwd } : {} }
      const writer = await owner.create(header)
      try {
        if (action !== 'empty') {
          const event = session.append('user/message', createUserMessage({ source: { kind: 'user' },
            content: [{ type: 'text', text: action === 'logical' ? 'x'.repeat(2 * 1024 * 1024 + 1024)
              : randomBytes(2 * 1024 * 1024 + 16384).toString('base64') }] }), { surfaceOp: 'append' })
          await writer.append([event])
        }
        await writer.flush()
      } finally { await writer.close() }
      const physical = await owner.stat(session.id)
      if (action === 'empty') emptySessions.add(id)
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ sizeBytes: physical.sizeBytes,
        ...action === 'empty' ? { durable: await owner.observeDurable(session.id) } : {} })); return
    }
    if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(counts.get(id) ?? { observeDurable: 0, withGeneration: 0 }))
  })
}
