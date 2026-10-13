/** Managed Desktop routes reuse pi-ai and the official Agent request/retry lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, GenerateOptions, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles, authContextFrom, credentialStoreFrom } from '@deepseek-ai/dsh-llm-pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@nidofy/dsh-desktop-extras'
import { withDesktopCacheRouting } from '@nidofy/dsh-desktop-extras/cache'
import { ConnectionStore } from './store.ts'
import type { ConnectionState, RevisionId } from './store.ts'
import { observedPayload } from './request-observations.ts'

const routeOf = (connection: string): string => `nidofy-${connection}`
const revisionRoute = (id: string, connection: string): string => `nidofy-rev-${id}--${connection}`
const connectionOf = (route: string): string | undefined => {
  const archived = /^nidofy-rev-[a-f0-9-]{36}--([a-z][a-z0-9-]{0,63})$/.exec(route)
  return archived?.[1] ?? (/^nidofy-([a-z][a-z0-9-]{0,63})$/.exec(route)?.[1])
}

class ManagedAdapter extends LlmAdapter {
  private readonly profiles = new Map<string, ReturnType<typeof resolveProfiles>>()
  prune(ids: ReadonlySet<string>): void { for (const id of this.profiles.keys()) if (!ids.has(id)) this.profiles.delete(id) }
  private profilesFor(id: string) {
    const row = this.store.state.revisions.find(item => item.id === id)
    if (!row) throw new Error('CONNECTION_RETIRED')
    let profiles = this.profiles.get(id)
    if (!profiles) {
      profiles = resolveProfiles({ [revisionRoute(id, row.connection)]: { ...row.profile, apiKeyEnv: row.credential } })
      this.profiles.set(id, profiles)
    }
    return profiles
  }
  constructor(private readonly ctx: Context, private readonly store: ConnectionStore) { super() }
  private id(provider: string): RevisionId {
    const direct = /^nidofy-rev-([a-f0-9-]{36})--/.exec(provider)?.[1]
    const id = direct ?? this.store.state.current[connectionOf(provider) ?? '']
    if (!id) throw new Error('CONNECTION_NOT_FOUND')
    return brandString<RevisionId>(id)
  }
  private delegate(id: string, key: () => string, check: () => void): PiAiAdapter {
    const row = this.store.state.revisions.find(item => item.id === id)
    if (!row) throw new Error('CONNECTION_RETIRED')
    const profiles = this.profilesFor(id)
    return new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => { check(); return Promise.resolve(key()) },
      prepareHttp: url => this.ctx.get('outboundHttp')?.prepare(url) ?? Promise.resolve(undefined),
      auth: { credentials: credentialStoreFrom(this.ctx), authContext: authContextFrom(this.ctx) },
      resolveAttachments: () => this.ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
        path => this.ctx.get('fs')?.processPathFromHostPath(path), ref),
      preparePayload: (scope) => {
        const transform = this.ctx.bail('llm-pi-ai/prepare-payload', withDesktopCacheRouting(scope, {
          provider: routeOf(row.connection), credentialPartition: row.credentialPartition ?? row.id,
        }))
        return observedPayload(scope, transform, check)
      },
    })
  }
  override providerInfo(provider: string) {
    const row = this.store.state.revisions.find(item => item.id === this.id(provider))
    return { id: provider, name: row?.profile.displayName ?? connectionOf(provider) ?? provider }
  }
  override providerRetryPolicy(provider: string) {
    const id = this.id(provider), row = this.store.state.revisions.find(item => item.id === id)
    if (!row) return undefined
    return this.profilesFor(id).get(revisionRoute(id, row.connection))?.retryPolicy
  }
  override async listModels(provider: string) {
    if (provider.startsWith('nidofy-rev-')) return []
    const id = this.id(provider), row = this.store.state.revisions.find(item => item.id === id)
    if (!row) return []
    const models = await this.delegate(id, () => '', () => {}).listModels(revisionRoute(id, row.connection))
    return models.map(model => ({ ...model, provider }))
  }
  override async resolveModel(provider: string, model: string) {
    const id = this.id(provider), row = this.store.state.revisions.find(item => item.id === id)
    if (!row) throw new Error('CONNECTION_RETIRED')
    return { ...await this.delegate(id, () => '', () => {}).resolveModel(revisionRoute(id, row.connection), model), provider }
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    signal?.throwIfAborted()
    const lease = this.store.acquire(this.id(provider))
    const internal = revisionRoute(lease.revision.id, lease.revision.connection)
    const expires = AbortSignal.timeout(lease.revision.profile.timeoutMs ?? 300_000)
    const lifetime = signal ? AbortSignal.any([signal, expires]) : expires
    const release = (): void =>{  lease.release() }
    lifetime.addEventListener('abort', release, { once: true })
    try {
      const adapter = this.delegate(lease.revision.id, () => lease.key, () =>{  lease.check() })
      const call = await adapter.prepareCall(internal, model, lifetime)
      return { model: { ...call.model, provider }, stream: options => (async function* () {
        try {
          lifetime.throwIfAborted(); lease.check()
          yield* call.stream({ ...options, provider: internal,
            signal: options.signal ? AbortSignal.any([options.signal, lifetime]) : lifetime })
        } finally { lifetime.removeEventListener('abort', release); release() }
      })() }
    } catch (error) { lifetime.removeEventListener('abort', release); release(); throw error }
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options)
  }
}

/** Install one owner on the already-running official Host, before the shell reports ready.
 * @param ctx - Existing Host with LLM and credential services.
 * @param directory - Isolated connection journal directory.
 * @returns Reconciled connection owner, disposed with the Host context.
 */
export async function installConnections(ctx: Context, directory: string): Promise<ConnectionStore> {
  let registration: AdapterRegistrationHandle | undefined
  let heldRoutes = new Set<string>()
  const knownRoutes = new Set<string>()
  const publish = (state: ConnectionState): void => {
    adapter.prune(new Set(state.revisions.map(row => row.id)))
    const routes = [...Object.keys(state.current).map(routeOf), ...state.revisions.map(row => revisionRoute(row.id, row.connection))]
    if (routes.length === 0) { registration?.(); registration = undefined; heldRoutes.clear(); return }
    if (registration) registration.replace(routes)
    else registration = ctx.llm.registerAdapter(routes, adapter)
    heldRoutes = new Set(routes)
    for (const route of routes) knownRoutes.add(route)
  }
  const store = new ConnectionStore(directory, {
    get: async ref => (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    set: (ref, key) => ctx.credentials.set(credentialRef(ref), key),
    unset: ref => ctx.credentials.unset(credentialRef(ref)),
  }, publish, undefined, undefined, ctx.get('nidofyStorage'), async (profile, connection) => {
    const checkRoute = (): void => {
      const route = routeOf(connection)
      if (!heldRoutes.has(route) && ctx.llm.listProviders().some(row => row.id === route)) throw Error('CONNECTION_ROUTE_CONFLICT')
    }
    checkRoute()
    const policy = ctx.get('outboundHttp')
    if (!policy) return () => { checkRoute(); return Promise.resolve() }
    const resolved = resolveProfiles({ 'nidofy-validation': { ...profile, apiKeyEnv: 'NIDOFY_VALIDATION' } }).get('nidofy-validation')
    const models = resolved?.piProvider?.getModels() ?? []
    if (models.length === 0) throw Error('EGRESS_TARGET_UNRESOLVED')
    const leases = await Promise.all(models.map(model => policy.prepare(model.baseUrl)))
    return async () => { checkRoute(); for (const lease of leases) await lease.checkConfiguration(); checkRoute() }
  })
  const adapter = new ManagedAdapter(ctx, store)
  await store.open()
  ctx.on('nidofy/connection-route', (provider) => {
    if (!knownRoutes.has(provider)) return undefined
    const connection = connectionOf(provider)
    if (!connection) return undefined
    if (provider.startsWith('nidofy-rev-')) return provider
    const revision = store.state.current[connection]
    if (!revision) throw Error('CONNECTION_NOT_FOUND')
    return revisionRoute(revision, connection)
  })
  const leases = new Map<string, {
    session: string
    turn: number
    release(): void
    config: { provider: string; model: string }
    check(): void
  }>()
  ctx.on('agent/request', async (payload, next) => {
    const proposed = await next(), connection = connectionOf(proposed.provider)
    if (!connection || !knownRoutes.has(proposed.provider)) return proposed
    const address = `${payload.agent.session.id}:${payload.turn}:${payload.step}`
    const prior = leases.get(address)
    if (prior) { prior.check(); return prior.config }
    const id = store.state.current[connection]
    if (!id) throw new Error('CONNECTION_REVOKED_OR_MISSING')
    const lease = store.acquire(id)
    const release = (): void => { lease.release(); leases.delete(address); payload.signal.removeEventListener('abort', release) }
    const config = { ...proposed, provider: revisionRoute(id, connection), providerIdentity: routeOf(connection) }
    leases.set(address, { session: String(payload.agent.session.id), turn: payload.turn, release, config, check: () =>{  lease.check() } })
    payload.signal.addEventListener('abort', release, { once: true })
    if (payload.signal.aborted) { release(); payload.signal.throwIfAborted() }
    return config
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'step/end') leases.get(`${session.id}:${event.data.turn}:${event.data.step}`)?.release()
    if (event.type === 'turn/end') for (const lease of leases.values()) {
      if (lease.session === String(session.id) && lease.turn === event.data.turn) lease.release()
    }
  })
  const timer = setInterval(() => { void store.collect().catch(() =>{  ctx.logger.warn('Connection retirement needs reconciliation') }) }, 60_000)
  timer.unref()
  ctx.effect(() => async () => {
    clearInterval(timer)
    for (const lease of leases.values()) lease.release()
    registration?.()
    await store.close()
  })
  return store
}
