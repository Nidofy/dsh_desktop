import { expect, it } from 'vitest'
import { prepareDesktopCachePayload, withDesktopCacheRouting } from '../src/cache.ts'
import type { PiAiPayloadScope } from '@deepseek-ai/dsh-llm-pi-ai'

const model = { id: 'same', name: 'Synthetic', api: 'openai-completions', provider: 'synthetic',
  baseUrl: 'https://synthetic.invalid/v1', reasoning: false, input: ['text' as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }
const scope: PiAiPayloadScope = { provider: 'revision-a', model: 'same', api: 'openai-completions',
  baseURL: 'https://synthetic.invalid/v1', sessionId: 'session-a' }
const state = { home: '/synthetic-home', key: Buffer.alloc(32, 7) }
async function payload(overrides: Partial<PiAiPayloadScope> = {}, provider = 'connection-a', credentialPartition = 'account-a') {
  const actual = { ...scope, ...overrides }
  const annotated = withDesktopCacheRouting(actual, { provider, credentialPartition })
  expect(annotated.provider).toBe(actual.provider)
  expect(JSON.stringify(annotated)).toBe(JSON.stringify(actual))
  return prepareDesktopCachePayload(annotated, { mode: 'session', models: ['same', 'other'] }, state)!({}, model)
}

it('preserves a connection cache partition across revisions while isolating credential replacements and routing scopes', async () => {
  const first = await payload()
  expect(Reflect.get(Object(first), 'prompt_cache_key')).toMatch(/^dsh_/)
  expect(await payload({ provider: 'revision-b' })).toEqual(first)
  for (const changed of [await payload({}, 'connection-b'), await payload({}, 'connection-a', 'account-b'),
    await payload({ baseURL: 'https://other.invalid/v1' }), await payload({ model: 'other' }),
    await payload({ sessionId: 'session-b' })]) expect(changed).not.toEqual(first)
})

it('keeps unsupported protocols, native policy and missing sessions free of invented cache hints', async () => {
  expect(await payload({ api: 'anthropic-messages' })).toEqual({})
  expect(await payload({ sessionId: undefined })).toEqual({})
  const body = { prompt_cache_key: 'native', messages: [] }
  expect(await prepareDesktopCachePayload(scope, { mode: 'native', models: [] }, state)!(body, model)).toBe(body)
  expect(await prepareDesktopCachePayload(scope, { mode: 'off', models: [] }, state)!(body, model)).toEqual({ messages: [] })
})
