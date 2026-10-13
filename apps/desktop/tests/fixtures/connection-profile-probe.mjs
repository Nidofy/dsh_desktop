/** Test overlay: observe the complete built Desktop profile through authenticated HTTP. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

export const name = 'connection-profile-probe'
export const inject = ['connection', 'agents', 'agentPresets', 'skills', 'tools', 'llm', 'sessionPersistence', 'sessionQuery', 'nidofyStorage', 'shell', 'configEditor']

export async function apply(ctx) {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
  const { proxyRouteFor } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-http-proxy')).href)
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/connection-qualification', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
      const input = await request.json()
      if (input.action === 'egress-patch') {
        try { return Response.json({ exists: true, bytes: await readFile(ctx.configEditor.documentPath, 'utf8') }) }
        catch (error) { if (error.code === 'ENOENT') return Response.json({ exists: false }); throw error }
      }
      if (input.action === 'egress-edit') {
        const entry = ctx.configEditor.entries().find(row => row.options.name === '@deepseek-ai/dsh-llm-pi-ai')
        if (!entry) throw Error('POLICY_CONFIG_ENTRY_MISSING')
        try {
          await ctx.configEditor.edit(entry, () => ({ providers: { synthetic: {
            api: 'openai-completions', baseURL: 'https://refused.invalid', apiKeyEnv: 'SYNTHETIC_KEY', models: [{ id: 'local-model' }],
          } } }))
          return Response.json({ error: null })
        } catch (error) { return Response.json({ error: error.code ?? error.message }) }
      }
      if (input.action === 'shell-readiness') {
        try {
          const spec = ctx.shell.resolve({ command: 'exit 0', workdir: process.cwd(), signal: AbortSignal.timeout(10000),
            timeoutMs: 5000, onExpiry: 'kill', stdoutMaxBytes: 4096 })
          const result = await (await ctx.shell.execute(spec)).result()
          return Response.json({ exitCode: result.exitCode, sandbox: result.sandbox })
        } catch (error) { return Response.json({ error: error.code, detail: error.message }) }
      }
      if (input.action === 'routes') return Response.json({ routes: input.urls.map(url => proxyRouteFor(new URL(url)).proxied ? 'proxy' : 'direct') })
      if (input.action === 'search') return Response.json(await ctx.sessionQuery.searchSessions({ query: input.query }))
      if (input.action === 'stored') {
        const reader = await ctx.sessionPersistence.open(input.sessionId, 'read')
        try { return Response.json({ header: reader.header, ...(await reader.read()) }) } finally { await reader.close() }
      }
      if (input.action === 'facts') return Response.json({
        skills: (await ctx.skills.list()).filter(row => row.provider === 'dsh-office').map(row => row.name).sort(),
        tools: ctx.tools.schemas().map(row => row.name),
        providers: (await ctx.llm.listProviders()).map(row => row.id),
        queryPath: ctx.sessionQuery.config.path,
      })
      const owned = await ctx.agents.create({ sessionId: input.sessionId, meta: { cwd: process.cwd() },
        agentOptions: { provider: input.provider, model: 'local-model' },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'minimal') } })
      try {
        owned.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Report the local connection result.' }], source: { kind: 'user' } }))
        await owned.agent.whenIdle()
        await ctx.sessionPersistence.flush()
        const reader = await ctx.sessionPersistence.open(owned.agent.session.id, 'read')
        try {
          return Response.json({ events: (await reader.read()).events })
        } finally { await reader.close() }
      } finally { await owned.dispose() }
      } catch (error) { console.error(error); throw error }
    },
  }))
}
