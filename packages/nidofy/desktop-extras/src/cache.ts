/** Desktop cache routing hints use the same captured policy in the product and isolated local checks. */
import type { PiAiAdapterOptions, PiAiPayloadScope } from '@deepseek-ai/dsh-llm-pi-ai'
import type { Preferences } from './state.ts'
import { desktopCacheKeyOptions } from './legacy/desktop-cache-key.mjs'
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { nidofyCacheInput: DesktopCacheInputService }
}

/** Validated Desktop preference; cache mode never grants model or network permission. */
export type DesktopCachePolicy = Preferences['cachePolicy']
/** Actual preference and feature-mount observation, without a key or any assertion about provider cache behavior. */
export interface DesktopCacheInput {
  preferenceRevision: number
  enabled: boolean
  mounted: boolean
  policy: DesktopCachePolicy
}
/** Read-only product preference owner; a captured preference is distinct from a subsequently applied payload hint. */
export class DesktopCacheInputService extends Service {
  /** Stable owner identity across caller-traced service proxies; reload revokes prior captures. */
  readonly identity: symbol = Symbol('nidofyCacheInput')
  constructor(ctx: Context, private readonly read: () => DesktopCacheInput) { super(ctx, 'nidofyCacheInput') }
  /** Capture the current actual preference/mount state without preparing a payload, sending or reading credentials.
   * @returns Detached complete policy and preference revision. Enabled/mounted disagreement is an unfinished feature transition.
   */
  input(): DesktopCacheInput { return structuredClone(this.read()) }
}
/** Private per-plugin key and data home; the key never enters reports or payloads. */
export interface DesktopCacheScope { home: string; key: Buffer; preferenceRevision?: number }

/** Captured routing hint, without the private key; this does not report provider cache enablement or a cache hit. */
export interface DesktopCacheObservation {
  policy: DesktopCachePolicy
  preferenceRevision: number | null
  api: string
  applied: boolean
  hint: 'NATIVE' | 'REMOVED' | 'SESSION_KEY'
}
type PayloadTransform = NonNullable<ReturnType<NonNullable<PiAiAdapterOptions['preparePayload']>>>
// The index and cache entrypoints are separately bundled; the callback carries its own observation identity.
const OBSERVATION = Symbol.for('nidofy.desktop-cache-observation.v1')
const ROUTING = Symbol.for('nidofy.desktop-cache-routing.v1')
interface CacheRouting { provider: string; credentialPartition: string }

/** Attach Desktop-only cache partition facts without changing the actual routing scope other payload hooks observe.
 * @param scope - Actual immutable request route.
 * @param routing - Stable connection identity and opaque credential generation; contains no secret.
 * @returns A detached scope carrying private cache metadata.
 */
export function withDesktopCacheRouting(scope: PiAiPayloadScope, routing: CacheRouting): PiAiPayloadScope {
  return Object.defineProperty({ ...scope }, ROUTING, { value: Object.freeze({ ...routing }) })
}

/** Read the actual Desktop transform's capture after payload application, never from current preferences.
 * @param transform - Exact callback returned by the installed payload owner.
 * @returns Detached capture, or null for a callback owned by another plugin.
 */
export function desktopCacheObservation(transform: PayloadTransform): DesktopCacheObservation | null {
  const owner = transform as PayloadTransform & { [OBSERVATION]?: () => DesktopCacheObservation }
  return owner[OBSERVATION]?.() ?? null
}

/** Capture the existing cache hint transform for one prepared provider payload.
 * @param scope - Actual prepared routing facts, including endpoint and optional Session identity.
 * @param policy - Validated preference copied before capture; later edits affect only future captures.
 * @param state - Actual plugin home and process-local 32-byte key.
 * @returns A request-local callback preserving native payload identity or copying only the prompt_cache_key change.
 */
export function prepareDesktopCachePayload(scope: PiAiPayloadScope, policy: DesktopCachePolicy,
  state: DesktopCacheScope): ReturnType<NonNullable<PiAiAdapterOptions['preparePayload']>> {
  const captured = structuredClone(policy)
  const routing = (scope as PiAiPayloadScope & { [ROUTING]?: CacheRouting })[ROUTING]
  const provider = routing ? JSON.stringify([routing.provider, routing.credentialPartition]) : scope.provider
  const transform = desktopCacheKeyOptions({ ...scope, provider, desktopCacheKey: captured }, { id: scope.model },
    scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }, { ...state, managedProvider: provider }).onPayload
  const observation: DesktopCacheObservation = { policy: captured, preferenceRevision: state.preferenceRevision ?? null,
    api: scope.api, applied: false, hint: 'NATIVE' }
  const callback: PayloadTransform = async (payload, model) => {
    const result = transform ? await transform(payload, model) : payload
    observation.applied = true
    observation.hint = !transform ? 'NATIVE'
      : typeof result === 'object' && result !== null && 'prompt_cache_key' in result ? 'SESSION_KEY' : 'REMOVED'
    return result
  }
  return Object.assign(callback, { [OBSERVATION]: () => structuredClone(observation) })
}
