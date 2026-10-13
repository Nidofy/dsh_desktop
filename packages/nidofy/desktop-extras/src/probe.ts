/** Explicit, bounded synthetic model probes use the official prepared-call and credential lease. */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { usageMetadata } from './legacy/diagnostic-capture.mjs'
import { object, text } from './state.ts'
import { freezeRoute } from './connection-contract.ts'

interface ProbeRow {
  group: string
  repeat: number
  status: string
  usage: Record<string, unknown>
  firstOutputMs: number | null
  durationMs: number
}
export interface ProbeReport {
  schemaVersion: 2
  id: string
  status: string
  budget: { inputTokens: number
    inputBytes: number
    unit: string
    requests: number
    maxOutputTokens: number
    retries: 0 }
  rows: ProbeRow[]
  conclusion: string
  error?: string
}

/** One active user-confirmed run. Disposal aborts and drains; recorded unknown work never resumes. */
export class Probe {
  current: ProbeReport | undefined
  private controller: AbortController | undefined
  private done: Promise<void> = Promise.resolve()
  constructor(private readonly ctx: Context, private readonly home: string) {}
  async start(input: unknown): Promise<ProbeReport> {
    if (this.controller) throw Error('PROBE_BUSY')
    const p = object(input), provider = text(p.provider), model = text(p.model)
    const tokens = Number(p.inputTokens), requests = Number(p.requests)
    if (p.accepted !== true || ![512, 2048, 8192].includes(tokens) || ![4, 6].includes(requests)) throw Error('PROBE_BUDGET_REQUIRED')
    const controller = new AbortController()
    const report: ProbeReport = { schemaVersion: 2, id: randomUUID(), status: 'RUNNING', budget: { inputTokens: tokens, inputBytes: tokens * 4, unit: 'estimated-tokens:characters/4', requests, maxOutputTokens: 64, retries: 0 }, rows: [], conclusion: 'INCONCLUSIVE' }
    this.current = report; this.controller = controller
    this.done = this.run(report, provider, model, controller).finally(() => { this.controller = undefined })
    return await Promise.resolve(structuredClone(report))
  }
  cancel(): void { this.controller?.abort() }
  async close(): Promise<void> { this.cancel(); await this.done }
  async settled(): Promise<void> { await this.done }
  private async persist(report: ProbeReport): Promise<void> {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    const path = join(this.home, 'last-probe.json'), bytes = JSON.stringify(report), storage = this.ctx.get('nidofyStorage')
    const write = () => writeFileAtomic(path, bytes, { mode: 0o600 })
    await (storage ? storage.write(path, Buffer.byteLength(bytes) * 2, write) : write())
  }
  private async run(report: ProbeReport, provider: string, model: string, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), calls: PreparedLlmCall[] = []
    try {
      await this.persist(report)
      // Prepare every single-use call before sending any request; managed routes freeze immutable credentials here.
      const frozen = freezeRoute(this.ctx, provider)
      for (let i = 0; i < report.budget.requests; i++) {
        const call = await this.ctx.llm.prepareCall({ provider: frozen, model, maxTokens: 64 }, signal)
        if (call.retryPolicy.mode !== 'normal' || call.retryPolicy.maxRetries !== 0) throw Error('RETRIES_ENABLED')
        // UTF-8 byte length is a conservative upper bound for this synthetic ASCII input; framing needs headroom.
        if (!call.context || call.context.contextWindow < report.budget.inputBytes + 1024) throw Error('CONTEXT_BUDGET_UNCONFIRMED')
        calls.push(call)
      }
      for (let i = 0; i < calls.length; i++) {
        signal.throwIfAborted()
        const group = i < calls.length / 2 ? 'A' : 'B', start = performance.now()
        const row: ProbeRow = { group, repeat: i % (calls.length / 2) + 1, status: 'UNKNOWN', usage: usageMetadata(null), firstOutputMs: null, durationMs: 0 }
        report.rows.push(row)
        const call = calls[i]
        if (!call) throw Error('PREPARED_CALL_MISSING')
        const content = (`Synthetic cache test ${report.id} ${group}. Reply OK.\n` + '0123456789abcdef '.repeat(report.budget.inputBytes)).slice(0, report.budget.inputBytes)
        for await (const chunk of call.stream({ ...call.config, signal, sessionId: SessionId(`nidofy-probe-${report.id}-${group}`), messages: [{ id: MessageId(`probe-${report.id}-${group}`), role: 'user', content: [{ type: 'text', text: content }], source: { kind: 'user' } }] })) {
          if (['text-delta', 'reasoning-delta', 'tool-call-delta'].includes(chunk.type)) row.firstOutputMs ??= performance.now() - start
          if (chunk.type === 'usage') row.usage = usageMetadata(chunk.usage)
          if (chunk.type === 'finish') row.status = ['stop', 'max-tokens'].includes(chunk.reason.kind) ? 'COMPLETED' : 'FAILED'
        }
        row.durationMs = performance.now() - start
        await this.persist(report)
        if (row.status !== 'COMPLETED') throw Error('PROVIDER_NOT_COMPLETED')
      }
      report.status = 'COMPLETED'
      report.conclusion = report.rows.some(r => typeof r.usage.cacheReadTokens === 'number' && r.usage.cacheReadTokens > 0) ? 'ADAPTER_REPORTED_CACHE_READ' : 'INCONCLUSIVE'
    } catch (error) {
      report.status = signal.aborted ? 'CANCELLED' : report.rows.length ? 'FAILED' : 'REFUSED'
      const message = error instanceof Error ? error.message : ''
      report.error = /^[A-Z_]+$/.test(message) ? message : 'PROBE_NOT_CONFIRMED'
    } finally {
      controller.abort()
      await this.persist(report).catch(() => { report.error = 'REPORT_PERSISTENCE_UNCONFIRMED' })
    }
  }
}
