/** Request-local observations follow the existing managed payload and authorized response; they grant no send authority. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { desktopCacheObservation, type DesktopCacheObservation } from '@nidofy/dsh-desktop-extras/cache'
import type { PiAiAdapterOptions, PiAiPayloadScope } from '@deepseek-ai/dsh-llm-pi-ai'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

type Transform = NonNullable<ReturnType<NonNullable<PiAiAdapterOptions['preparePayload']>>>
/** Actual application observations, separate from immutable model versions, provider cache behavior and network billing. */
export interface ManagedRequestObservation {
  payloads: number
  cache: DesktopCacheObservation | null
  response: { status: 'UNOBSERVED' | 'REPORTED' | 'INVALID'; model: string | null }
}
const current = new AsyncLocalStorage<ManagedRequestObservation>()

/** Create an empty request observation; absence cannot become a native-cache or exact-version claim.
 * @returns Mutable owner-local capture used by one independently confirmed request.
 */
export function managedRequestObservation(): ManagedRequestObservation {
  return { payloads: 0, cache: null, response: { status: 'UNOBSERVED', model: null } }
}
/** Validate complete private sidecar observations; unsupported fields or versions never fall back to current settings.
 * @param input - Durable observation JSON, without its independent versioned envelope.
 * @returns A detached bounded observation, without keys, prompts or provider-version assertions.
 */
export function parseManagedRequestObservation(input: unknown): ManagedRequestObservation {
  const object = (value: unknown, fields: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) {
      throw Error('EXPERIMENT_OBSERVATION_INVALID')
    }
    return value as Record<string, unknown>
  }
  const text = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed()
    && !/[\x00-\x1f]/u.test(value) && Buffer.byteLength(value) <= 256
  const row = object(input, ['payloads', 'cache', 'response']), response = object(row.response, ['status', 'model'])
  if (!Number.isSafeInteger(row.payloads) || Number(row.payloads) < 0 || Number(row.payloads) > 1
    || !['UNOBSERVED', 'REPORTED', 'INVALID'].includes(String(response.status))
    || response.status === 'REPORTED' && (!text(response.model) || !response.model)
    || response.status !== 'REPORTED' && response.model !== null) throw Error('EXPERIMENT_OBSERVATION_INVALID')
  let cache: DesktopCacheObservation | null = null
  if (row.cache !== null) {
    const value = row.cache
    const hasRevision = typeof value === 'object' && Object.hasOwn(value, 'preferenceRevision')
    const c = object(value, ['policy', ...hasRevision ? ['preferenceRevision'] : [], 'api', 'applied', 'hint'])
    const policy = object(c.policy, ['mode', 'models']), revision = hasRevision ? c.preferenceRevision : null
    if (!['native', 'off', 'session'].includes(String(policy.mode)) || !Array.isArray(policy.models)
      || policy.models.length > 64 || !policy.models.every(text) || !text(c.api) || !c.api
      || c.applied !== true || !['NATIVE', 'REMOVED', 'SESSION_KEY'].includes(String(c.hint)) || row.payloads !== 1) {
      throw Error('EXPERIMENT_OBSERVATION_INVALID')
    }
    if (revision !== null && (!Number.isSafeInteger(revision) || Number(revision) < 0)) {
      throw Error('EXPERIMENT_OBSERVATION_INVALID')
    }
    cache = { policy: { mode: policy.mode as DesktopCacheObservation['policy']['mode'], models: policy.models },
      preferenceRevision: revision === null ? null : Number(revision),
      api: c.api, applied: true, hint: c.hint as DesktopCacheObservation['hint'] }
  }
  return { payloads: Number(row.payloads), cache, response: { status: response.status as ManagedRequestObservation['response']['status'],
    model: response.model as string | null } }
}
/** Scope observations to one actual dispatch; concurrent requests cannot share captured factors.
 * @param capture - One request's observation owner.
 * @param work - Official prepared-call consumer, including complete iterator drainage.
 * @returns The original operation result; no transport or callback is invoked here.
 */
export function withManagedRequestObservation<T>(capture: ManagedRequestObservation, work: () => Promise<T>): Promise<T> {
  return current.run(capture, work)
}
/** Preserve the actual payload callback and observe only its applied Desktop routing hint.
 * @param scope - Actual prepared route without credentials.
 * @param transform - Installed payload owner callback, if any.
 * @param check - Original live connection check before payload work.
 * @returns Original payload semantics; the capture contains no cache key or prompt.
 */
export function observedPayload(scope: PiAiPayloadScope, transform: Transform | undefined, check: () => void): Transform {
  const capture = current.getStore()
  return async (payload, model) => {
    check()
    const result = transform ? await transform(payload, model) : payload
    if (capture) {
      capture.payloads++
      capture.cache = capture.payloads === 1 && transform ? desktopCacheObservation(transform) : null
      if (capture.cache?.api !== scope.api) capture.cache = null
    }
    return result
  }
}
/** Read only the provider-reported identity in the official successful finish envelope.
 * @param finish - Captured official terminal chunk; aliases and unsupported metadata stay unobserved.
 * @param requestedModel - Actual bound request model, checked against replay identity.
 * @param requestedProvider - Actual bound provider; unrelated route metadata stays invalid.
 * @returns Provider-reported identifier, never an assertion of an immutable model version.
 */
export function reportedResponseModel(finish: Extract<StreamChunk, { type: 'finish' }> | undefined,
  requestedModel: string, requestedProvider: string): ManagedRequestObservation['response'] {
  const missing: ManagedRequestObservation['response'] = { status: 'UNOBSERVED', model: null }
  if (!finish?.replayState) return missing
  const response = finish.replayState.response
  if (!response || typeof response !== 'object' || Array.isArray(response)) return { status: 'INVALID', model: null }
  if (!('kind' in response) || response.kind !== 'pi-ai' || !('version' in response) || response.version !== 2
    || !('model' in response) || response.model !== requestedModel
    || !('provider' in response) || response.provider !== requestedProvider) return { status: 'INVALID', model: null }
  if (!('responseModel' in response)) return missing
  const model = response.responseModel
  if (typeof model !== 'string' || !model || !model.isWellFormed() || /[\x00-\x1f]/u.test(model)
    || Buffer.byteLength(model) > 256) return { status: 'INVALID', model: null }
  return { status: 'REPORTED', model }
}
