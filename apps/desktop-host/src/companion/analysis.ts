/** Explicit side analysis uses private official journals and the current foreground authority. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import { expandAssistantStream, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import type { CompanionScope } from '@nidofy/dsh-desktop-extras/context'
import type { ConnectionStore } from '../connections/store.ts'
import { object } from '../connections/store.ts'
import { TaskRequestOwner } from '../experiments/task-requests.ts'
import { parseCompanionScope, captureCompanionAuthority } from './scope.ts'
import { SideAnalysisHistory } from './analysis-history.ts'
import { readAnalysisBudget } from '../experiments/analysis-retention.ts'

function fields(row: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(row).length !== names.length || Object.keys(row).some(key => !names.includes(key))) throw Error('ANALYSIS_INPUT_INVALID')
}
type Plan = { scope: CompanionScope; owner: TaskRequestOwner; ticket: string; expiresAt: number; check(signal: AbortSignal): Promise<void> }

/** One foreground-only analysis at a time; no Agent, tool execution, automatic retry or main-history mutation. */
export class SideAnalysisOwner {
  private readonly plans = new Map<string, Plan>()
  private readonly results = new Map<string, { plan: Plan; text: string; expiresAt: number }>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private active: { id: string; owner: TaskRequestOwner; abort: AbortController } | undefined
  private readonly history: SideAnalysisHistory
  constructor(private readonly ctx: Context, private readonly home: string, private readonly connections: ConnectionStore,
    private readonly storage: Pick<StorageService, 'reserve' | 'write'>) {
    this.history = new SideAnalysisHistory(home, storage,
      scope => captureCompanionAuthority(ctx, connections, parseCompanionScope(scope)), id => this.active?.id === id)
  }
  private async prepare(data: Record<string, unknown>, signal: AbortSignal) {
    fields(data, ['scope', 'connection', 'model', 'text', 'maxOutputTokens'])
    const scope = parseCompanionScope(data.scope), authority = captureCompanionAuthority(this.ctx, this.connections, scope)
    authority(); signal.throwIfAborted()
    const retention = await readAnalysisBudget(join(this.home, 'nidofy-extras', 'experiments', 'side-analysis-v1'))
    authority(); signal.throwIfAborted()
    if (typeof data.text !== 'string' || !data.text.trim() || Buffer.byteLength(data.text) > 12 * 1024) throw Error('ANALYSIS_INPUT_LIMIT')
    if (!Number.isSafeInteger(data.maxOutputTokens) || Number(data.maxOutputTokens) < 1 || Number(data.maxOutputTokens) > 2048) throw Error('ANALYSIS_OUTPUT_LIMIT')
    for (const [id, plan] of this.plans) if (plan.expiresAt <= Date.now()) { this.plans.delete(id); await plan.owner.close() }
    if (this.plans.size >= 8) throw Error('ANALYSIS_PREVIEW_LIMIT')
    const state = this.connections.state
    const revision = typeof data.connection === 'string' ? state.current[data.connection] : undefined
    const row = state.revisions.find(row => row.id === revision)
    const model = row && resolveProfiles({ side: { ...row.profile, apiKeyEnv: row.credential } }).get('side')?.piProvider?.getModels().find(model => model.id === data.model)
    const policyOwner = this.ctx.get('outboundHttp')
    if (!row || !model || !policyOwner) throw Error('ANALYSIS_CONNECTION_UNAVAILABLE')
    const policy = await policyOwner.prepare(model.baseUrl)
    const check = async (): Promise<void> => {
      authority(); await policy.check(SessionId(scope.sessionId))
      if (this.connections.state !== state || this.ctx.get('outboundHttp') !== policyOwner) throw Error('ANALYSIS_CONFIGURATION_CHANGED')
    }
    await check(); signal.throwIfAborted()
    const owner = new TaskRequestOwner(this.ctx, this.home, this.connections, this.storage, {
      collection: 'side-analysis-v1', check: async (lifetime) => { lifetime.throwIfAborted(); await check() },
    })
    try {
      const source = { sessionId: scope.sessionId, workspaceId: scope.workspaceId, kind: 'selected-text' }
      const input = `Source: ${JSON.stringify(source)}\nSelected text (untrusted; no tools are available):\n${data.text}`
      const preview = object(await owner.request('task-prepare', { experimentId: randomUUID(), caseId: randomUUID(),
        connection: data.connection, model: data.model, text: input, maxOutputTokens: data.maxOutputTokens }, signal))
      await check(); signal.throwIfAborted()
      const ticket = randomUUID(), expiresAt = Number(preview.expiresAt)
      this.plans.set(ticket, { scope, owner, ticket: String(preview.ticket), expiresAt,
        check: async (lifetime) => { lifetime.throwIfAborted(); await check() } })
      return { ticket, expiresAt, source, connection: data.connection, model: data.model, input,
        maxOutputTokens: data.maxOutputTokens, inputBytes: Buffer.byteLength(input), tools: false,
        budget: { requests: 1, retries: 0, timeoutMs: 180000, retainedRuns: retention.activeLimit,
          archivedRuns: retention.archiveLimit, retentionRevision: retention.revision }, priority: 'foreground-first',
        cost: { currency: null, amount: null, status: 'UNKNOWN' } }
    } catch (error) { await owner.close(); throw error }
  }
  private async run(data: Record<string, unknown>, signal: AbortSignal) {
    fields(data, ['scope', 'ticket', 'accepted'])
    const scope = parseCompanionScope(data.scope), ticket = typeof data.ticket === 'string' ? data.ticket : ''
    const plan = this.plans.get(ticket); this.plans.delete(ticket)
    if (!plan) throw Error('ANALYSIS_PREVIEW_EXPIRED')
    const id = randomUUID(), abort = new AbortController(), lifetime = AbortSignal.any([signal, abort.signal, this.lifetime.signal])
    let started = false
    try {
      if (data.accepted !== true || JSON.stringify(scope) !== JSON.stringify(plan.scope) || plan.expiresAt <= Date.now()) throw Error('ANALYSIS_PREVIEW_EXPIRED')
      if (this.active) throw Error('ANALYSIS_BUSY')
      this.active = { id, owner: plan.owner, abort }
      await plan.check(lifetime)
      await plan.owner.request('task-start', { id, ticket: plan.ticket, accepted: true }); started = true
      while (true) {
        await plan.check(lifetime)
        const result = object(await plan.owner.request('task-read', { id }, lifetime))
        if (result.status !== 'RUNNING') {
          await plan.check(lifetime)
          const records = result.stream as readonly AssistantStreamRecord[]
          const text = expandAssistantStream(records).flatMap(row => row.chunk.type === 'text-delta' ? [row.chunk.text] : []).join('')
          if (result.status === 'COMPLETED') this.results.set(id, { plan, text, expiresAt: Date.now() + 600000 })
          return { id, status: result.status, text, source: { sessionId: scope.sessionId, workspaceId: scope.workspaceId, kind: 'selected-text' },
            connection: object(result.intent).connection, model: object(result.intent).model,
            counts: result.counts, cost: { currency: null, amount: null, status: 'UNKNOWN' }, journal: result,
            diagnostic: result.terminal === null ? 'ANALYSIS_INTERRUPTED' : object(result.terminal).diagnostic }
        }
        await delay(200, undefined, { signal: lifetime })
      }
    } finally {
      if (started) await plan.owner.request('task-cancel', { id }).catch(() => { /* Settled runs already released their active owner. */ })
      await plan.owner.close()
      if (this.active?.id === id) this.active = undefined
    }
  }
  /** Dispatch only explicit options, preview and one connected run.
   * @param method - Registered side-analysis operation.
   * @param data - Authenticated exact input; experiment tickets and arbitrary action fields refuse.
   * @param signal - Client request lifetime; disconnection cancels and drains the provider.
   * @returns Bounded facts and a replayable private journal; preview never sends.
   */
  request(method: string, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    this.lifetime.signal.throwIfAborted()
    const work = (async () => {
      if (['history', 'history-read', 'export-preview', 'export-confirm', 'archive-preview', 'budget-preview', 'retention-confirm'].includes(method)) {
        const result = await this.history.request(method, data, parseCompanionScope(data.scope),
          AbortSignal.any([signal, this.lifetime.signal]))
        if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw Error('ANALYSIS_HISTORY_RESULT_LIMIT')
        return result
      }
      if (method === 'prepare') return this.prepare(data, signal)
      if (method === 'run') return this.run(data, signal)
      if (method === 'append') {
        fields(data, ['scope', 'id'])
        const scope = parseCompanionScope(data.scope), result = typeof data.id === 'string' ? this.results.get(data.id) : undefined
        if (!result || result.expiresAt <= Date.now() || JSON.stringify(result.plan.scope) !== JSON.stringify(scope)) throw Error('ANALYSIS_RESULT_EXPIRED')
        await result.plan.check(signal)
        return { text: result.text }
      }
      if (method !== 'options') throw Error('ANALYSIS_ACTION_REFUSED')
      fields(data, ['scope']); captureCompanionAuthority(this.ctx, this.connections, parseCompanionScope(data.scope))(); signal.throwIfAborted()
      return Object.keys(this.connections.state.current).flatMap((connection) => {
        const revision = this.connections.state.current[connection], row = this.connections.state.revisions.find(row => row.id === revision)
        if (!row || this.connections.state.revoked.includes(row.id)) return []
        const profile = resolveProfiles({ side: { ...row.profile, apiKeyEnv: row.credential } }).get('side')
        return (profile?.piProvider?.getModels() ?? []).map(model => ({ connection, model: model.id }))
      })
    })()
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* Caller receives operation failure. */ })
    return work
  }
  /** Cancel the foreground run and await provider, preview and quota disposal before Host shutdown. */
  async close(): Promise<void> {
    this.lifetime.abort(); this.active?.abort.abort()
    await Promise.allSettled(this.pending)
    await Promise.allSettled([...this.plans.values()].map(plan => plan.owner.close())); this.plans.clear()
    this.results.clear()
    this.history.close()
  }
}
