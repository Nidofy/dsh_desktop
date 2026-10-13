/** Actual adapter + SDK wire replay against a private loopback Anthropic endpoint. */
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { createToolResultMessage, createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'

function response(signature: string, tool: boolean): Record<string, unknown>[] {
  return [
    { type: 'message_start', message: { id: 'synthetic-reply', type: 'message', role: 'assistant', model: 'synthetic-thinker', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Preserve this exact thought. 思考' } },
    ...signature === '' ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } }],
    { type: 'content_block_stop', index: 0 },
    ...tool ? [
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'lookup_1', name: 'lookup', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"synthetic"}' } },
      { type: 'content_block_stop', index: 1 },
    ] : [
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
      { type: 'content_block_stop', index: 1 },
    ],
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ]
}

describe('Anthropic unsigned thinking replay compatibility', () => {
  it.each([
    { allow: undefined, signature: '', blockType: 'text' },
    { allow: false, signature: '', blockType: 'text' },
    { allow: true, signature: '', blockType: 'thinking' },
    { allow: undefined, signature: 'synthetic-signature', blockType: 'thinking' },
  ])('replays two requests with allowEmptySignature=$allow signature="$signature"', async ({ allow, signature, blockType }) => {
    const requests: Array<Record<string, unknown>> = []
    const server = createServer((request, reply) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        const parsed: unknown = JSON.parse(body)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid fixture request')
        requests.push(parsed as Record<string, unknown>)
        reply.writeHead(200, { 'content-type': 'text/event-stream' })
        reply.end(response(signature, requests.length === 1).map(item => `event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`).join(''))
      })
    })
    const ctx = new Context()
    try {
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing loopback address')
      const profiles = resolveProfiles({ 'synthetic-route': {
        api: 'anthropic-messages', baseURL: `http://127.0.0.1:${address.port}`, cacheRetention: 'none',
        models: [{
          id: 'synthetic-thinker', contextWindow: 1_000_000, maxTokens: 128_000,
          reasoningEfforts: { high: 'high', max: 'max' },
          ...allow === undefined ? {} : { compat: { allowEmptySignature: allow } },
        }],
      } })
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['synthetic-route'], new PiAiAdapter({
        profiles: () => profiles, auth: memoryAuth(), resolveApiKey: () => Promise.resolve('synthetic-placeholder'),
      }))
      const user = createUserMessage({ content: [{ type: 'text', text: 'Inspect synthetic file.' }], source: { kind: 'user' } })
      const options = {
        provider: 'synthetic-route', model: 'synthetic-thinker', reasoningEffort: ReasoningEffortId('max'),
        tools: [{ name: 'lookup', description: 'Synthetic lookup.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
      }
      const first = await assemble(ctx, { ...options, messages: [user] })
      expect(first.finish).toEqual({ kind: 'tool-calls' })
      expect(first.message.content).toEqual([
        { type: 'reasoning', text: 'Preserve this exact thought. 思考' },
        { type: 'tool-call', id: ToolCallId('lookup_1'), name: 'lookup', arguments: '{"path":"synthetic"}' },
      ])
      const second = await assemble(ctx, { ...options, messages: [
        user, first.message,
        createToolResultMessage({ callId: ToolCallId('lookup_1'), content: [{ type: 'text', text: 'Synthetic result.' }], isError: false }),
      ] })
      expect(second.finish).toEqual({ kind: 'stop' })
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        expect(request).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 16384 } })
        expect(request).not.toHaveProperty('output_config')
      }
      const body = requests[1]!
      expect(body.messages).toEqual([
        { role: 'user', content: 'Inspect synthetic file.' },
        { role: 'assistant', content: [
          blockType === 'thinking'
            ? { type: 'thinking', thinking: 'Preserve this exact thought. 思考', signature }
            : { type: 'text', text: 'Preserve this exact thought. 思考' },
          { type: 'tool_use', id: 'lookup_1', name: 'lookup', input: { path: 'synthetic' } },
        ] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'lookup_1', content: 'Synthetic result.', is_error: false }] },
      ])
    } finally {
      await ctx.fiber.dispose()
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((done, reject) => server.close((error) => { if (error) reject(error); else done() }))
      }
    }
  })
})
