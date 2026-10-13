/** Desktop HTTP policy intersects packaged limits, profile settings and exact Workspace membership. */
import { lstat, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { Config as PiConfig, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { Config as MessagesConfig, plainOptions, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type {} from '@deepseek-ai/dsh-config-editor'
import type { Context } from '@deepseek-ai/cordis'
import type { HttpEgressLease, HttpEgressPolicy } from '@deepseek-ai/dsh-http-proxy'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { brandString } from '@deepseek-ai/dsh-brand'
import { object } from './store.ts'

function refused(code: string): LlmError { return new LlmError(code, code) }

type Origins = readonly string[] | null
/** Packaged maximum; user profile settings can only narrow it. */
export interface EgressDistribution { readonly revision: string; readonly origins: Origins }
interface WorkspaceRule { id: WorkspaceId; path: string; origins: Origins }
interface Policy { schemaVersion: 1; revision: number; profile: Origins; workspaces: WorkspaceRule[] }
const LIMIT = 64 * 1024
const empty = (): Policy => ({ schemaVersion: 1, revision: 0, profile: null, workspaces: [] })

function origin(value: string, request = false): string {
  const url = URL.parse(value)
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !request && url.search || url.hash) {
    throw refused('EGRESS_TARGET_INVALID')
  }
  return url.origin
}
function origins(value: unknown): Origins {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > 128) throw refused('EGRESS_POLICY_INVALID')
  const result = value.map((item: unknown) => {
    if (typeof item !== 'string' || item.length > 2048 || origin(item) !== item) throw refused('EGRESS_ORIGIN_INVALID')
    return item
  })
  if (new Set(result).size !== result.length) throw refused('EGRESS_POLICY_INVALID')
  return result
}
function decode(value: unknown): Policy {
  const p = object(value)
  if (p.schemaVersion !== 1) throw refused('EGRESS_VERSION_UNSUPPORTED')
  if (Object.keys(p).some(key => !['schemaVersion', 'revision', 'profile', 'workspaces'].includes(key))
    || !Number.isSafeInteger(p.revision) || Number(p.revision) < 0 || !Array.isArray(p.workspaces) || p.workspaces.length > 128) {
    throw refused('EGRESS_POLICY_INVALID')
  }
  const workspaces = p.workspaces.map((value: unknown) => {
    const row = object(value)
    if (Object.keys(row).some(key => !['id', 'path', 'origins'].includes(key))
      || typeof row.id !== 'string' || !row.id || row.id.length > 256
      || typeof row.path !== 'string' || !row.path || row.path.length > 4096) throw refused('EGRESS_WORKSPACE_INVALID')
    return { id: brandString<WorkspaceId>(row.id), path: row.path, origins: origins(row.origins) }
  })
  if (new Set(workspaces.map(row => row.id)).size !== workspaces.length) throw refused('EGRESS_WORKSPACE_INVALID')
  return { schemaVersion: 1, revision: Number(p.revision), profile: origins(p.profile), workspaces }
}
function allows(rule: Origins, target: string): boolean { return rule === null || rule.includes(target) }

/** Validate the trusted packaged policy independently of editable profile JSON.
 * @param value - Packaged JSON; absent intranet policy is deny-all.
 * @param intranet - Actual Main-owned distribution kind.
 * @returns Immutable maximum authorization.
 */
export function distributionEgress(value: unknown, intranet: boolean): EgressDistribution {
  if (value === undefined) return Object.freeze({ revision: intranet ? 'intranet-default-deny-v1' : 'personal-v1', origins: intranet ? [] : null })
  const p = object(value)
  if (p.schemaVersion !== 1 || typeof p.revision !== 'string' || !/^[a-zA-Z0-9.-]{1,128}$/u.test(p.revision)
    || Object.keys(p).some(key => !['schemaVersion', 'revision', 'origins'].includes(key))) throw refused('EGRESS_DISTRIBUTION_INVALID')
  const allowed = origins(p.origins)
  if (intranet && allowed === null) throw refused('EGRESS_DISTRIBUTION_INVALID')
  return Object.freeze({ revision: p.revision, origins: allowed === null ? null : Object.freeze([...allowed]) })
}

/** Early profile capability; reads are fail-closed and writes use the existing connection storage quota. */
export class DesktopEgressPolicy implements HttpEgressPolicy {
  private readonly path: string
  private ctx: Context | undefined
  private stopped = false
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  // A Request owns its following signal. Keep it alive through body readers/tees, rather than only until headers arrive.
  private readonly requestBodies = new WeakMap<ReadableStream<Uint8Array>, Request>()
  constructor(home: string, private readonly distribution: EgressDistribution) { this.path = join(home, 'nidofy-connections', 'egress.json') }

  /** Bind existing Host services after profile boot; no user data is initialized.
   * @param ctx - Actual running profile whose registry and quota remain authoritative.
   */
  bind(ctx: Context): void {
    this.ctx = ctx
    ctx.effect(() => () => this.close())
    const editor = ctx.get('configEditor')
    if (editor) ctx.effect(() => editor.registerValidator(async (entry, candidate) => {
      const name = entry.options.name, targets: string[] = []
      if (name === '@deepseek-ai/dsh-llm-pi-ai') {
        const rawExisting: unknown = entry.options.config
        const proposed = PiConfig(candidate).providers.get(), existing = PiConfig(object(rawExisting ?? {})).providers.get()
        const changed = Object.fromEntries(Object.entries(proposed)
          .filter(([id, row]) => JSON.stringify(row) !== JSON.stringify(existing[id])))
        const profiles = resolveProfiles(structuredClone(changed) as Record<string, PiAiProviderProfile>)
        for (const profile of profiles.values()) {
          const models = profile.piProvider?.getModels() ?? []
          if (!models.length) throw refused('EGRESS_TARGET_UNRESOLVED')
          for (const model of models) {
            if (!['openai-completions', 'anthropic-messages'].includes(model.api)
              || !profile.apiKeyEnv || profile.transport !== undefined && profile.transport !== 'sse') {
              throw refused('EGRESS_TRANSPORT_REFUSED')
            }
            targets.push(model.baseUrl)
          }
        }
      } else if (name === '@deepseek-ai/dsh-llm-deepseek-api-key' || name === '@deepseek-ai/dsh-llm-deepseek-account') {
        const protocol = { ...candidate }; Reflect.deleteProperty(protocol, 'apiKeyEnv')
        targets.push(resolveAdapterOptions(plainOptions(MessagesConfig(protocol)), ctx.get('launchEnvironment')).baseURL)
      } else if (name === '@deepseek-ai/dsh-mcp-client' && candidate.transport === 'streamable-http') {
        if (typeof candidate.url !== 'string') throw refused('EGRESS_TARGET_UNRESOLVED')
        targets.push(candidate.url)
      }
      const leases = await Promise.all(targets.map(target => this.prepare(target)))
      return async () => { for (const lease of leases) await lease.checkConfiguration() }
    }))
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    void work.finally(() => { this.pending.delete(work) }).catch((_failure: unknown) => { /* Caller observes the same rejection. */ })
    return work
  }
  private async read(): Promise<Policy> {
    if (this.stopped) throw refused('EGRESS_OWNER_STOPPED')
    try {
      const parent = await lstat(dirname(this.path))
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw refused('EGRESS_POLICY_INVALID')
      const info = await lstat(this.path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT) throw refused('EGRESS_POLICY_INVALID')
      const bytes = await readFile(this.path)
      if (bytes.length > LIMIT) throw refused('EGRESS_POLICY_INVALID')
      const value: unknown = JSON.parse(bytes.toString())
      return decode(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      throw error
    }
  }
  private authorize(p: Policy, target: string, sessionId?: SessionId): void {
    if (!allows(this.distribution.origins, target) || !allows(p.profile, target)) throw refused('EGRESS_TARGET_REFUSED')
    const registry = this.ctx?.get('workspaceRegistry')
    const workspace = sessionId === undefined ? undefined : registry?.list().find(row => row.sessionIds.includes(sessionId))
    // Unscoped operations and unknown synthetic request labels cannot bypass a narrower Workspace rule.
    const rules = workspace ? p.workspaces.filter(row => row.id === workspace.id) : p.workspaces
    if (rules.some(row => workspace && row.path !== workspace.path || !allows(row.origins, target))) throw refused('EGRESS_WORKSPACE_REFUSED')
  }
  /** Capture this endpoint, all policy bytes and real Workspace attachments before request preparation.
   * @param url - Resolved endpoint; credentials, query and fragment are refused.
   * @returns A lease whose sends reject changed revisions, origins, attachments and redirects.
   */
  prepare(url: string): Promise<HttpEgressLease> { return this.track(this.capture(url)) }
  private async capture(url: string): Promise<HttpEgressLease> {
    const target = origin(url), p = await this.read(), serialized = JSON.stringify(p)
    // Preparation without a Session captures profile limits; Workspace limits are enforced on actual dispatch.
    if (!allows(this.distribution.origins, target) || !allows(p.profile, target)) throw refused('EGRESS_TARGET_REFUSED')
    const registry = this.ctx?.get('workspaceRegistry')
    const attachments = new Map((registry?.list() ?? []).flatMap(row => row.sessionIds.map(id => [id, `${row.id}\0${row.path}`] as const)))
    const assertScope = (sessionId?: SessionId): void => {
      if (!p.workspaces.length || sessionId === undefined) return
      if (this.ctx?.get('workspaceRegistry') !== registry) throw refused('EGRESS_WORKSPACE_CHANGED')
      const actual = registry?.list().find(row => row.sessionIds.includes(sessionId))
      if ((actual ? `${actual.id}\0${actual.path}` : undefined) !== attachments.get(sessionId)) {
        throw refused('EGRESS_WORKSPACE_CHANGED')
      }
      this.authorize(p, target, sessionId)
    }
    const check = async (sessionId?: SessionId): Promise<void> => {
      const current = await this.read()
      if (JSON.stringify(current) !== serialized) throw refused('EGRESS_REVISION_CHANGED')
      if (p.workspaces.length && sessionId !== undefined && this.ctx?.get('workspaceRegistry') !== registry) {
        throw refused('EGRESS_WORKSPACE_CHANGED')
      }
      this.authorize(p, target, sessionId)
      const workspace = sessionId === undefined || !p.workspaces.length ? undefined
        : registry?.list().find(row => row.sessionIds.includes(sessionId))
      if (p.workspaces.length && sessionId !== undefined
        && (workspace ? `${workspace.id}\0${workspace.path}` : undefined) !== attachments.get(sessionId)) {
        throw refused('EGRESS_WORKSPACE_CHANGED')
      }
      if (workspace && !(await stat(workspace.path)).isDirectory()) throw refused('EGRESS_WORKSPACE_UNAVAILABLE')
      if (JSON.stringify(await this.read()) !== serialized) throw refused('EGRESS_REVISION_CHANGED')
      const latest = sessionId === undefined ? undefined : registry?.list().find(row => row.sessionIds.includes(sessionId))
      if (workspace && (!latest || latest.id !== workspace.id || latest.path !== workspace.path)) throw refused('EGRESS_WORKSPACE_CHANGED')
      assertScope(sessionId)
      this.lifetime.signal.throwIfAborted()
    }
    return Object.freeze({ restricted: this.distribution.origins !== null || p.profile !== null || p.workspaces.length > 0,
      revision: Object.freeze({ distribution: this.distribution.revision, profile: p.revision }),
      checkConfiguration: () => this.track((async () => {
        if (JSON.stringify(await this.read()) !== serialized) throw refused('EGRESS_REVISION_CHANGED')
        this.lifetime.signal.throwIfAborted()
      })()),
      check: (id?: SessionId) => this.track(check(id)),
      fetchFor: (id?: SessionId): typeof globalThis.fetch => (input, init) => this.track((async () => {
        const request = new Request(input, init)
        if (origin(request.url, true) !== target) throw refused('EGRESS_ORIGIN_CHANGED')
        await check(id)
        assertScope(id)
        request.signal.throwIfAborted()
        const response = await globalThis.fetch(request, { redirect: 'error', signal: AbortSignal.any([request.signal, this.lifetime.signal]) })
        if (response.body) this.requestBodies.set(response.body, request)
        return response
      })()),
    })
  }
  /** Read or CAS-save profile/Workspace restrictions; a lost write response requires a status read.
   * @param input - Authenticated JSON; distribution maxima are never editable here.
   * @returns Current policy and packaged maximum without credentials.
   */
  request(input: unknown): Promise<{ policy: Policy; distribution: EgressDistribution }> {
    return this.track((async () => {
      const data = object(input)
      if (data.action === 'status') return { policy: await this.read(), distribution: this.distribution }
      if (data.action !== 'save') throw refused('EGRESS_ACTION_UNSUPPORTED')
      const candidate = decode(data.policy)
      return withFileLock(this.path, async () => {
        const current = await this.read()
        if (data.expectedRevision !== current.revision || candidate.revision !== current.revision) throw refused('EGRESS_POLICY_CONFLICT')
        const registry = this.ctx?.get('workspaceRegistry')
        for (const row of candidate.workspaces) {
          const actual = registry?.list().find(workspace => workspace.id === row.id && workspace.path === row.path)
          if (!actual || !(await stat(actual.path)).isDirectory()) throw refused('EGRESS_WORKSPACE_UNAVAILABLE')
        }
        const next = { ...candidate, revision: current.revision + 1 }, bytes = JSON.stringify(next)
        if (Buffer.byteLength(bytes) > LIMIT || !Number.isSafeInteger(next.revision)) throw refused('EGRESS_POLICY_LIMIT')
        const storage = this.ctx?.get('nidofyStorage')
        if (!storage) throw Error('STORAGE_OWNER_UNAVAILABLE')
        await storage.write(this.path, Buffer.byteLength(bytes) * 2,
          () => writeFileAtomic(this.path, bytes, { mode: 0o600, dirMode: 0o700 }))
        return { policy: next, distribution: this.distribution }
      })
    })())
  }
  /** Abort transports, reject admission and drain all owned reads and writes. */
  async close(): Promise<void> {
    this.stopped = true; this.lifetime.abort()
    while (this.pending.size) await Promise.allSettled(this.pending)
  }
}
