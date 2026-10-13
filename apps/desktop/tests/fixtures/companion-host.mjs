/** Test-only lifecycle controls, behind the real authenticated local Fetch carrier. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
export const name = 'companion-qualification-host'
export const inject = ['connection', 'loader', 'llm', 'agents', 'sessions']
export async function apply(ctx) {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
  const { SessionId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
  let requests = 0
  let hold, entered = false
  ctx.effect(() => () => { hold?.resolve(); hold = undefined })
  ctx.on('connection/request', async (request, _response, next) => {
    if (hold && new URL(request.url, 'http://localhost').pathname === '/api/nidofy/workbench/ui') { entered = true; await hold.promise }
    return next()
  })
  ctx.on('llm/stream', () => { requests++; throw Error('QUALIFICATION_MODEL_CALL_FORBIDDEN') })
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/companion-qualification', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
      const input = await request.json()
      let historyProject
      if (input.action === 'seed-old-pet') {
        const loop = ctx.get('agentLoop')
        if (!loop) throw Error('Missing official Agent loop')
        for (let index = 0; index < 35; index++) {
          const row = await loop.create(SessionId('pet-newer-' + index), {}, {})
          if (!await ctx.sessions.flush(row.session)) throw Error('Pet qualification Session not durable')
        }
      }
      if (input.action === 'hold') { entered = false; hold = Promise.withResolvers() }
      if (input.action === 'release') { hold?.resolve(); hold = undefined }
      if (input.action === 'seed-search') {
        const agent = ctx.agents.get(input.sessionId)
        if (!agent) throw Error('Missing actual qualification Session')
        agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '隔离中文连接超时原文 config.client.ts E_TIMEOUT' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
        if (!await ctx.sessions.flush(agent.session)) throw Error('Qualification source was not durable')
      }
      if (input.action === 'seed-project-search') {
        const registry = ctx.get('workspaceRegistry'), loop = ctx.get('agentLoop'), agent = ctx.agents.get(input.sessionId)
        const current = registry?.list().find(row => row.sessionIds.includes(input.sessionId))
        if (!agent || !current || !loop) throw Error('Missing actual qualification Workspace')
        const rows = []
        for (const name of ['linked', 'unlinked']) {
          const path = join(current.path, '..', 't17-' + name)
          await mkdir(path, { recursive: true })
          const workspace = await registry.create(path)
          await workspace.setTitle('T17 ' + name)
          const source = await loop.create(SessionId('qualified-history-' + name), {}, { cwd: workspace.path })
          await workspace.attachSession(source.session.id)
          source.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: name === 'linked'
            ? '显式关联工作树的连接超时原文 E_TIMEOUT' : '未关联工作树不得泄漏的连接超时原文' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
          if (!await ctx.sessions.flush(source.session)) throw Error('Qualification project source was not durable')
          rows.push({ id: workspace.id, path: workspace.path, title: workspace.title, sessionId: source.session.id })
        }
        historyProject = { current: current.id, linked: rows[0], unlinked: rows[1] }
      }
      if (input.action === 'notebook') {
        const entry = [...ctx.loader.entries()].find(row => row.options.name === '@nidofy/dsh-working-notebook')
        if (!entry) throw Error('Missing actual Notebook entry')
        await entry.update({ disabled: !input.enabled })
        await ctx.loader.await()
      }
      return Response.json({ notebook: Boolean(ctx.get('nidofyNotebookV2')), requests, entered, historyProject })
      } catch (error) { return Response.json({ error: error.message, stack: error.stack }, { status: 400 }) }
    },
  }))
}
