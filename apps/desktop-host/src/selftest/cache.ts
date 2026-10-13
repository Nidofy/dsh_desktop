/** Local classifications of the actual Desktop cache transform; no transformed payload is sent. */
import { prepareDesktopCachePayload } from '@nidofy/dsh-desktop-extras/cache'
import type { DesktopCachePolicy } from '@nidofy/dsh-desktop-extras/cache'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiPayloadScope } from '@deepseek-ai/dsh-llm-pi-ai'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

function requireFact(value: boolean): void { if (!value) throw Error('SELFTEST_ASSERTION_FAILED') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('SELFTEST_ASSERTION_FAILED')
  return value as Record<string, unknown>
}

/** Classify cache-key reuse and separation against the product's captured payload transform.
 * @param home - This run's private synthetic home.
 * @param id - This run's synthetic Session discriminator, never a user Session.
 * @param signal - Whole-run cancellation, checked before each transform.
 */
export async function checkCache(home: string, id: string, signal: AbortSignal): Promise<void> {
  const key = randomBytes(32), scope: PiAiPayloadScope = { provider: 'synthetic', model: 'synthetic', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:1/v1', sessionId: 'selftest-cache-' + id }
  const model = resolveProfiles({ synthetic: { api: 'openai-completions', baseURL: scope.baseURL, models: [{ id: scope.model }] } })
    .get('synthetic')?.piProvider?.getModels()[0]
  if (!model) throw Error('SELFTEST_ASSERTION_FAILED')
  const policy: DesktopCachePolicy = { mode: 'session', models: [scope.model] }
  const payload = { prompt_cache_key: 'synthetic-native-hint', messages: [{ role: 'user', content: 'original synthetic input' }],
    tools: [{ name: 'synthetic_schema' }], max_tokens: 64, cache_control: { type: 'ephemeral' } }
  const original = JSON.stringify(payload)
  const transform = prepareDesktopCachePayload(scope, policy, { home, key })
  if (!transform) throw Error('SELFTEST_ASSERTION_FAILED')
  const apply = async (input: object, changed = scope, choice = policy, root = home, secret = key) => {
    signal.throwIfAborted()
    const callback = prepareDesktopCachePayload(changed, choice, { home: root, key: secret })
    return callback ? object(await callback(input, model)) : object(input)
  }
  const first = await apply(payload), cached = first.prompt_cache_key
  requireFact(typeof cached === 'string' && cached.startsWith('dsh_') && cached !== payload.prompt_cache_key
    && JSON.stringify(payload) === original && first !== payload)
  const { prompt_cache_key: _cacheKey, ...unchanged } = first
  const { prompt_cache_key: _nativeKey, ...expected } = payload
  requireFact(JSON.stringify(unchanged) === JSON.stringify(expected))
  for (const changed of [payload, { ...payload, messages: [...payload.messages, { role: 'user', content: 'appended synthetic input' }] },
    { ...payload, messages: [{ role: 'user', content: 'replacement synthetic view' }] },
    { ...payload, messages: [...payload.messages, { role: 'user', content: 'corrected Notebook snapshot' }] },
    { ...payload, tools: [{ name: 'changed_synthetic_schema' }], max_tokens: 32 }]) {
    requireFact((await apply(changed)).prompt_cache_key === cached)
  }
  for (const changed of [{ ...scope, provider: 'other' }, { ...scope, model: 'other' },
    { ...scope, baseURL: 'http://127.0.0.1:2/v1' }, { ...scope, sessionId: 'selftest-cache-other-' + id }]) {
    requireFact((await apply(payload, changed, { mode: 'session', models: [changed.model] })).prompt_cache_key !== cached)
  }
  requireFact((await apply(payload, scope, policy, join(home, 'other'))).prompt_cache_key !== cached
    && (await apply(payload, scope, policy, home, randomBytes(32))).prompt_cache_key !== cached)
  for (const [changed, choice] of [[scope, { mode: 'off', models: [] }], [scope, { mode: 'session', models: [] }],
    [{ ...scope, sessionId: undefined }, policy]] as const) {
    requireFact(!('prompt_cache_key' in await apply(payload, changed, { mode: choice.mode, models: [...choice.models] })))
  }
  requireFact(await apply(payload, scope, { mode: 'native', models: [] }) === payload
    && await apply(payload, { ...scope, api: 'anthropic-messages' }) === payload)
  // Existing captures retain their policy; a later preference applies only to the next capture.
  policy.mode = 'off'; policy.models.length = 0
  requireFact(object(await transform(payload, model)).prompt_cache_key === cached && !('prompt_cache_key' in await apply(payload)))
  requireFact(JSON.stringify(payload) === original)
}
