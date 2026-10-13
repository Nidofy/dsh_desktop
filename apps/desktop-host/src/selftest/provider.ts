/** Confirmed connection checks bind real connection and HTTP revisions and send only logged, fixed synthetic inputs. */
import type { Context } from '@deepseek-ai/cordis'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { HttpEgressLease, HttpEgressPolicy } from '@deepseek-ai/dsh-http-proxy'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConnectionStore, RevisionId } from '../connections/store.ts'
import type { LocalChecks } from './runner.ts'
import type { CheckId, CheckResult, SelfTestConfirmationId } from './types.ts'
import { SelfTestInputs } from './inputs.ts'

interface Plan {
  ticket: SelfTestConfirmationId
  connection: string
  revision: RevisionId
  configurationRevision: number
  model: string
  requests: number
  policy: HttpEgressLease
  policyOwner: HttpEgressPolicy
  expiresAt: number
}
const echo: ToolSchema = { name: 'selftest_echo', description: 'Return the fixed synthetic value without executing anything.',
  parameters: { type: 'object', properties: { value: { type: 'string', const: 'synthetic' } }, required: ['value'], additionalProperties: false } }
const pass = (metrics: CheckResult['metrics'] = {}): CheckResult => ({ status: 'PASS', code: 'OK', metrics })
const unknown = (code: CheckResult['code'], requests = 0): CheckResult => ({ status: 'UNKNOWN', code, metrics: { requests } })

/** Authenticated confirmation owner; previews contain no secrets and never construct or dispatch a model call. */
export class SelfTestConnectionOwner {
  private readonly plans = new Map<SelfTestConfirmationId, Plan>()
  private readonly reads = new Set<Promise<unknown>>()
  private readonly readLifetime = new AbortController()
  private stopped = false
  constructor(private readonly ctx: Context, private readonly home: string, private readonly store: ConnectionStore,
    private readonly storage: Pick<StorageService, 'write'>) {}
  private alive(): void { if (this.stopped) throw Error('SELFTEST_STOPPING') }
  /** Read retained private-input capacity without constructing a connection, reading credentials or allocating a root.
   * @returns Conservative counts/refusal; corruption stays an explicit read error and never grants repair authority.
   */
  capacity() {
    this.alive()
    const reader = new SelfTestInputs(this.home, randomUUID(), this.storage)
    const task = (async () => {
      try {
        const capacity = await reader.capacity(this.readLifetime.signal)
        this.readLifetime.signal.throwIfAborted(); return capacity
      } finally { await reader.close() }
    })()
    this.reads.add(task)
    void task.finally(() => this.reads.delete(task)).catch(() => { /* The initiating reader receives failures. */ })
    return task
  }
  /** List locally resolved managed models without discovery HTTP or credential reads.
   * @returns Available connection/model choices; the subsequent confirmation pins current revisions.
   */
  options(): { connection: string; model: string }[] {
    if (this.stopped) throw Error('SELFTEST_STOPPING')
    return Object.entries(this.store.state.current).flatMap(([connection, revision]) => {
      const row = this.store.state.revisions.find(row => row.id === revision)
      if (!row || this.store.state.revoked.includes(revision)) return []
      const profile = resolveProfiles({ selftest: { ...row.profile, apiKeyEnv: row.credential } }).get('selftest')
      return (profile?.piProvider?.getModels() ?? []).map(model => ({ connection, model: model.id }))
    })
  }
  /** Prepare an expiring, single-use confirmation for at most five requests with exactly 64 output tokens each.
   * @param input - Selected managed connection/model and request count; arbitrary bodies and commands are refused.
   * @returns Exact model, real connection publication/revision and separate T23 revisions for confirmation.
   */
  async prepare(input: Record<string, unknown>) {
    if (this.stopped) throw Error('SELFTEST_STOPPING')
    const { connection, model, requests } = input
    if (typeof connection !== 'string' || typeof model !== 'string' || !Number.isSafeInteger(requests)
      || Number(requests) < 1 || Number(requests) > 5 || Object.keys(input).some(key => !['connection', 'model', 'requests'].includes(key))) {
      throw Error('SELFTEST_INPUT_INVALID')
    }
    const revision = this.store.state.current[connection], configurationRevision = this.store.state.revision
    const row = this.store.state.revisions.find(row => row.id === revision)
    if (!row || this.store.state.revoked.includes(row.id)) throw Error('CONNECTION_NOT_FOUND')
    const profile = resolveProfiles({ selftest: { ...row.profile, apiKeyEnv: row.credential } }).get('selftest')
    const selected = profile?.piProvider?.getModels().find(row => row.id === model)
    if (!selected) throw Error('SELFTEST_MODEL_UNAVAILABLE')
    if (!['openai-completions', 'anthropic-messages'].includes(selected.api)) throw Error('EGRESS_TRANSPORT_REFUSED')
    const provider = this.ctx.get('outboundHttp')
    if (!provider) throw Error('EGRESS_OWNER_UNAVAILABLE')
    const policy = await provider.prepare(selected.baseUrl)
    await policy.check()
    this.alive()
    if (provider !== this.ctx.get('outboundHttp') || revision !== this.store.state.current[connection]
      || configurationRevision !== this.store.state.revision) throw Error('SELFTEST_CONFIGURATION_CHANGED')
    for (const [id, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(id)
    if (this.plans.size >= 16) throw Error('SELFTEST_CONFIRMATION_LIMIT')
    const plan: Plan = { ticket: brandString<SelfTestConfirmationId>(randomUUID()), connection, revision: row.id,
      configurationRevision, model, requests: Number(requests),
      policy, policyOwner: provider, expiresAt: Date.now() + 120000 }
    this.plans.set(plan.ticket, plan)
    return { ticket: plan.ticket, connection, model, connectionRevision: revision, configurationRevision,
      policyRevision: { ...policy.revision }, requests: plan.requests, maxOutputTokens: 64, retries: 0, expiresAt: plan.expiresAt }
  }
  /** Consume an explicit confirmation once; uncertain starts cannot reuse its ticket.
   * @param ticket - Exact ticket retained from prepare.
   * @returns Fixed budget and deferred provider constructor, used only after the runner commits intent.
   */
  take(ticket: string): { requests: number; create(id: string): LocalChecks } {
    const identity = brandString<SelfTestConfirmationId>(ticket)
    const plan = this.plans.get(identity); this.plans.delete(identity)
    if (!plan || plan.expiresAt < Date.now() || this.stopped) throw Error('SELFTEST_CONFIRMATION_EXPIRED')
    return { requests: plan.requests, create: id => new ConnectionChecks(this.ctx, this.home, id, this.store, this.storage, plan,
      () => { if (plan.policyOwner !== this.ctx.get('outboundHttp')) throw Error('SELFTEST_CONFIGURATION_CHANGED') }) }
  }
  /** Reject confirmations, cancel/drain capacity reads and forget unused tickets; the runner drains active providers. */
  async close(): Promise<void> {
    this.stopped = true; this.plans.clear(); this.readLifetime.abort(); await Promise.allSettled(this.reads)
  }
}

class ConnectionChecks implements LocalChecks {
  private readonly lifetime = new AbortController()
  private readonly inputs: SelfTestInputs
  private lease: ReturnType<ConnectionStore['acquire']> | undefined
  private requests = 0
  private first: { streamed: boolean; tool: boolean; usage?: TokenUsage | undefined } | undefined
  constructor(private readonly ctx: Context, home: string, private readonly id: string, private readonly store: ConnectionStore,
    storage: Pick<StorageService, 'write'>, private readonly plan: Plan, private readonly checkOwner: () => void) {
    this.inputs = new SelfTestInputs(home, id, storage)
  }
  async open(signal: AbortSignal): Promise<void> {
    this.lease = this.store.acquire(this.plan.revision)
    await this.authorize(signal); await this.inputs.open(signal)
  }
  private async authorize(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted(); this.checkOwner(); this.lease?.check()
    if (this.store.state.revision !== this.plan.configurationRevision
      || this.store.state.current[this.plan.connection] !== this.plan.revision) {
      throw Error('SELFTEST_CONFIGURATION_CHANGED')
    }
    await this.plan.policy.check()
    signal.throwIfAborted(); this.checkOwner(); this.lease?.check()
    if (this.store.state.revision !== this.plan.configurationRevision
      || this.store.state.current[this.plan.connection] !== this.plan.revision) {
      throw Error('SELFTEST_CONFIGURATION_CHANGED')
    }
  }
  private async send(text: string, tools: ToolSchema[] | undefined, signal: AbortSignal) {
    if (this.requests >= this.plan.requests) {
      return { result: unknown('REQUEST_BUDGET_EXHAUSTED'), streamed: false, tool: false, usage: undefined }
    }
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    await this.authorize(lifetime)
    const call = await this.ctx.llm.prepareCall({ provider: `nidofy-rev-${this.plan.revision}--${this.plan.connection}`,
      model: this.plan.model, maxTokens: 64 }, lifetime)
    if (call.retryPolicy.mode !== 'normal' || call.retryPolicy.maxRetries !== 0) throw Error('SELFTEST_RETRIES_REFUSED')
    if (!call.context || call.context.contextWindow < 4096) throw Error('SELFTEST_CONTEXT_UNCONFIRMED')
    const logged = await this.inputs.request(this.requests, call, text, tools, lifetime)
    return logged.dispatch(async () => {
      await this.authorize(lifetime)
      if (this.requests >= this.plan.requests) throw Error('SELFTEST_REQUEST_BUDGET_EXHAUSTED')
      // Consume before iterator construction: failures or an unknown finish never authorize another attempt.
      this.requests++
      let finish: string | undefined, streamed = false, tool = false, usage: TokenUsage | undefined, bytes = 0, chunks = 0, toolCount = 0
      for await (const chunk of call.stream(logged.options)) {
        lifetime.throwIfAborted()
        if (++chunks > 2048 || finish !== undefined) return { result: unknown('STREAM_UNCONFIRMED', 1), streamed, tool, usage }
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
          streamed = true; bytes += Buffer.byteLength(chunk.type === 'tool-call-delta' ? chunk.argumentsDelta : chunk.text)
        }
        if (bytes > 8192) return { result: unknown('OUTPUT_BUDGET_EXHAUSTED', 1), streamed, tool, usage }
        if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
          toolCount++
          try { const value: unknown = JSON.parse(chunk.block.arguments); tool = toolCount === 1 && chunk.block.name === echo.name
            && JSON.stringify(value) === '{"value":"synthetic"}' }
          catch (_error) { tool = false }
        }
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') finish = chunk.reason.kind
      }
      const result = finish === 'max-tokens' || usage && usage.outputTokens > 64 ? unknown('OUTPUT_BUDGET_EXHAUSTED', 1)
        : finish === 'error' ? { status: 'FAIL' as const, code: 'PROVIDER_FAILED' as const, metrics: { requests: 1 } }
          : finish === 'stop' || finish === 'tool-calls' ? pass({ requests: 1 }) : unknown('STREAM_UNCONFIRMED', 1)
      return { result, streamed, tool, usage }
    })
  }
  async check(id: CheckId, signal: AbortSignal): Promise<CheckResult> {
    await this.authorize(signal)
    switch (id) {
      case 'connection': {
        const first = await this.send('Call selftest_echo once with value synthetic. Do not run commands or request other tools.', [echo], signal)
        this.first = first; return first.result
      }
      case 'streaming': return this.first?.streamed ? pass() : unknown('STREAM_UNCONFIRMED')
      case 'tool-call': return this.first?.tool ? pass() : unknown('TOOL_UNCONFIRMED')
      case 'cache-counter': {
        const usage = this.first?.usage
        if (!usage || usage.cacheReadTokens === undefined
          || [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens].some(value => !Number.isSafeInteger(value) || value < 0)) {
          return unknown('USAGE_UNREPORTED')
        }
        return pass({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens })
      }
      case 'cache-repeat': {
        const start = this.requests
        if (this.plan.requests - start < 4) return unknown('REQUEST_BUDGET_EXHAUSTED')
        let reads = 0
        for (const group of ['A', 'A', 'B', 'B']) {
          const text = (`Synthetic selftest ${this.id} group ${group}. Reply OK.\n` + '0123456789abcdef '.repeat(128)).slice(0, 2048)
          const sent = await this.send(text, undefined, signal)
          if (sent.result.status !== 'PASS') return { ...sent.result, metrics: { requests: this.requests - start } }
          if (sent.usage?.cacheReadTokens === undefined || !Number.isSafeInteger(sent.usage.cacheReadTokens)
            || sent.usage.cacheReadTokens < 0) return unknown('USAGE_UNREPORTED', this.requests - start)
          if (sent.usage.cacheReadTokens > 0) reads++
        }
        return reads > 0 ? pass({ requests: 4 }) : unknown('CACHE_UNCONFIRMED', 4)
      }
      default: return unknown('NOT_SELECTED')
    }
  }
  async close(): Promise<void> { this.lifetime.abort(); try { await this.inputs.close() } finally { this.lease?.release() } }
}
