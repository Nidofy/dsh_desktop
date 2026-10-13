/** Scoped cold history and explicitly confirmed retention share the original analysis admission lock and quota. */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import type { CompanionScope } from '@nidofy/dsh-desktop-extras/context'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { TaskRequestInputs } from '../experiments/task-inputs.ts'
import { analysisLimits, readAnalysisArchive, readAnalysisBudget } from '../experiments/analysis-retention.ts'
import { publishRecord } from '../workbench/verification-storage.ts'
import { unlinked } from '../selftest/store.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
type Journal = NonNullable<Awaited<ReturnType<TaskRequestInputs['read']>>>
type Row = {
  id: string
  journal: Journal
  archive: Awaited<ReturnType<typeof readAnalysisArchive>>
  source: { sessionId: string; workspaceId: string }
}
type Plan = { scope: CompanionScope; expiresAt: number; snapshot: string; check(): void }
  & ({ action: 'archive'; row: Row } | { action: 'budget'; activeLimit: number; archiveLimit: number })
type ExportPlan = { scope: CompanionScope; expiresAt: number; row: Row; content: string; path: string; check(): void }
function fields(row: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(row).sort().join() !== [...names].sort().join()) throw Error('ANALYSIS_INPUT_INVALID')
}
function source(journal: Journal): Row['source'] {
  const input = journal.intent.text, marker = '\nSelected text (untrusted; no tools are available):\n'
  const at = input.indexOf(marker)
  if (!input.startsWith('Source: ') || at < 8) throw Error('ANALYSIS_SOURCE_INVALID')
  const raw: unknown = JSON.parse(input.slice(8, at))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('ANALYSIS_SOURCE_INVALID')
  const row = raw as Record<string, unknown>
  if (Object.keys(row).sort().join() !== 'kind,sessionId,workspaceId' || row.kind !== 'selected-text'
    || typeof row.sessionId !== 'string' || !row.sessionId || typeof row.workspaceId !== 'string' || !row.workspaceId) throw Error('ANALYSIS_SOURCE_INVALID')
  return { sessionId: row.sessionId, workspaceId: row.workspaceId }
}
function display(row: Row) {
  return { id: row.id, status: row.journal.status, startedAt: row.journal.intent.startedAt,
    connection: row.journal.intent.connection, model: row.journal.intent.model, archived: row.archive !== null, source: row.source }
}

/** Retention reads never prepare providers; immutable metadata preserves original request generations and results. */
export class SideAnalysisHistory {
  private readonly base: string
  private readonly plans = new Map<string, Plan>()
  private readonly exports = new Map<string, ExportPlan>()
  constructor(private readonly home: string, private readonly storage: Pick<StorageService, 'write'>,
    private readonly authorize: (scope: CompanionScope) => () => void, private readonly active: (id: string) => boolean) {
    this.base = join(home, 'nidofy-extras', 'experiments', 'side-analysis-v1')
  }
  private async inspect(signal: AbortSignal) {
    signal.throwIfAborted(); await unlinked(this.base)
    const budget = await readAnalysisBudget(this.base)
    let names: string[]
    try { names = await readdir(this.base) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') names = []; else throw error }
    const ids = names.filter(name => name !== 'admission.lock' && name !== 'retention-v1')
    if (ids.length > 100 || ids.some(id => !UUID.test(id))) throw Error('ANALYSIS_HISTORY_LIMIT')
    const rows: Row[] = []
    for (const id of ids.sort()) {
      signal.throwIfAborted()
      const reader = new TaskRequestInputs(this.home, id, this.storage, 'side-analysis-v1')
      try {
        const journal = await reader.read(signal)
        if (!journal) throw Error('ANALYSIS_HISTORY_INVALID')
        const archive = await readAnalysisArchive(join(this.base, id), id)
        if (archive && !journal.terminal) throw Error('ANALYSIS_RETENTION_INVALID')
        rows.push({ id, journal, archive, source: source(journal) })
      } finally { await reader.close() }
    }
    const archived = rows.filter(row => row.archive).length, active = rows.length - archived
    if (active > budget.activeLimit || archived > budget.archiveLimit) throw Error('ANALYSIS_BUDGET_EXHAUSTED')
    return { budget, rows, active, archived,
      snapshot: JSON.stringify({ budget, rows: rows.map(row => ({ id: row.id, archive: row.archive, terminal: row.journal.terminal })) }) }
  }
  private selected(rows: Row[], scope: CompanionScope, id: unknown): Row {
    const row = typeof id === 'string' ? rows.find(row => row.id === id) : undefined
    if (!row || row.source.sessionId !== scope.sessionId || row.source.workspaceId !== scope.workspaceId) throw Error('ANALYSIS_HISTORY_SCOPE_REFUSED')
    return row
  }
  private async exportContent(row: Row, signal: AbortSignal): Promise<string> {
    const reader = new TaskRequestInputs(this.home, row.id, this.storage, 'side-analysis-v1')
    try {
      const original = await reader.exportRecords(signal)
      if (JSON.stringify(original.journal) !== JSON.stringify(row.journal)) throw Error('ANALYSIS_EXPORT_CHANGED')
      const content = JSON.stringify({ schemaVersion: 1, kind: 'side-analysis-export', id: row.id,
        source: row.source, archived: row.archive !== null, ...original }) + '\n'
      if (Buffer.byteLength(content) > 512 * 1024) throw Error('ANALYSIS_EXPORT_LIMIT')
      return content
    } finally { await reader.close() }
  }
  /** @param method - Scoped history/read/preview/confirm operation. @param data - Exact authenticated input.
   * @param scope - Current parsed idle foreground. @param signal - Owner and client lifetime.
   * @returns Local records or explicit retention receipt.
   */
  async request(method: string, data: Record<string, unknown>, scope: CompanionScope, signal: AbortSignal): Promise<unknown> {
    const check = this.authorize(scope); check(); signal.throwIfAborted()
    if (method === 'export-confirm') {
      fields(data, ['scope', 'ticket', 'accepted'])
      const ticket = typeof data.ticket === 'string' ? data.ticket : '', plan = this.exports.get(ticket)
      this.exports.delete(ticket)
      if (!plan || data.accepted !== true || JSON.stringify(scope) !== JSON.stringify(plan.scope)) throw Error('ANALYSIS_EXPORT_EXPIRED')
      const verify = (): void => {
        plan.check(); check(); signal.throwIfAborted()
        if (plan.expiresAt <= Date.now()) throw Error('ANALYSIS_EXPORT_EXPIRED')
      }
      verify()
      return this.storage.write(plan.path, 4 * Buffer.byteLength(plan.content), async () => {
        const state = await this.inspect(signal), row = this.selected(state.rows, scope, plan.row.id)
        if (await this.exportContent(row, signal) !== plan.content) throw Error('ANALYSIS_EXPORT_CHANGED')
        verify()
        const directory = join(this.home, 'nidofy-extras', 'analysis-exports-v1')
        await unlinked(directory); await mkdir(directory, { recursive: true, mode: 0o700 })
        return withFileLock(join(directory, 'publication'), async () => {
          const names = await readdir(directory)
          if (names.filter(name => name !== 'publication.lock').length >= 100) throw Error('ANALYSIS_EXPORT_HISTORY_LIMIT')
          if (!await publishRecord(plan.path, plan.content, verify)) throw Error('ANALYSIS_EXPORT_EXISTS')
          return { status: 'EXPORTED', id: row.id, path: plan.path, bytes: Buffer.byteLength(plan.content) }
        })
      })
    }
    if (method === 'retention-confirm') {
      fields(data, ['scope', 'ticket', 'accepted'])
      const ticket = typeof data.ticket === 'string' ? data.ticket : '', plan = this.plans.get(ticket)
      this.plans.delete(ticket)
      if (!plan || data.accepted !== true || plan.expiresAt <= Date.now() || JSON.stringify(scope) !== JSON.stringify(plan.scope)) throw Error('ANALYSIS_RETENTION_EXPIRED')
      plan.check(); signal.throwIfAborted()
      return this.storage.write(this.base, 16384, async () => {
        await mkdir(this.base, { recursive: true, mode: 0o700 })
        return withFileLock(join(this.base, 'admission'), async () => {
          const state = await this.inspect(signal); plan.check(); check(); signal.throwIfAborted()
          if (plan.expiresAt <= Date.now() || state.snapshot !== plan.snapshot) throw Error('ANALYSIS_RETENTION_CHANGED')
          if (plan.action === 'archive') {
            const row = this.selected(state.rows, scope, plan.row.id)
            if (row.archive || !row.journal.terminal || this.active(row.id)
              || JSON.stringify(row.journal) !== JSON.stringify(plan.row.journal)) throw Error('ANALYSIS_RETENTION_CHANGED')
            if (state.archived >= state.budget.archiveLimit) throw Error('ANALYSIS_BUDGET_EXHAUSTED')
            const writer = new TaskRequestInputs(this.home, row.id, this.storage, 'side-analysis-v1')
            try { return { status: 'ARCHIVED', ...await writer.archive(ticket, signal) } } finally { await writer.close() }
          }
          if (state.active > plan.activeLimit || state.archived > plan.archiveLimit) throw Error('ANALYSIS_BUDGET_EXHAUSTED')
          if (state.budget.revision >= 256) throw Error('ANALYSIS_BUDGET_HISTORY_LIMIT')
          const receipt = { schemaVersion: 1, kind: 'side-analysis-budget', revision: state.budget.revision + 1,
            activeLimit: plan.activeLimit, archiveLimit: plan.archiveLimit, operationId: ticket, committedAt: Date.now() }
          const path = join(this.base, 'retention-v1', `budget-${String(receipt.revision).padStart(6, '0')}.json`)
          if (!await publishRecord(path, JSON.stringify(receipt))) throw Error('ANALYSIS_RETENTION_CHANGED')
          return { status: 'BUDGET_APPLIED', ...receipt }
        })
      })
    }
    fields(data, method === 'history' ? ['scope', 'offset', ...'filter' in data ? ['filter'] : []]
      : method === 'history-read' || method === 'archive-preview' || method === 'export-preview'
        ? ['scope', 'id'] : ['scope', 'activeLimit', 'archiveLimit'])
    const state = await this.inspect(signal); check(); signal.throwIfAborted()
    if (method === 'history') {
      if (typeof data.offset !== 'number' || !Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset > 100) throw Error('ANALYSIS_INPUT_INVALID')
      const filter = 'filter' in data ? data.filter : 'all'
      if (filter !== 'all' && filter !== 'active' && filter !== 'archived') throw Error('ANALYSIS_INPUT_INVALID')
      const rows = state.rows.filter(row => row.source.sessionId === scope.sessionId && row.source.workspaceId === scope.workspaceId)
        .filter(row => filter === 'all' || (row.archive !== null) === (filter === 'archived'))
        .sort((a, b) => b.journal.intent.startedAt - a.journal.intent.startedAt || a.id.localeCompare(b.id))
      return { budget: state.budget, active: state.active, archived: state.archived, filter, total: rows.length,
        rows: rows.slice(data.offset, data.offset + 10).map(display), next: data.offset + 10 < rows.length ? data.offset + 10 : null }
    }
    if (method === 'history-read') {
      const row = this.selected(state.rows, scope, data.id)
      return { ...display(row), journal: row.journal,
        text: expandAssistantStream(row.journal.stream).flatMap(row => row.chunk.type === 'text-delta' ? [row.chunk.text] : []).join('') }
    }
    if (method === 'export-preview') {
      const row = this.selected(state.rows, scope, data.id)
      for (const [ticket, plan] of this.exports) if (plan.expiresAt <= Date.now()) this.exports.delete(ticket)
      if (this.exports.size >= 8) throw Error('ANALYSIS_PREVIEW_LIMIT')
      const content = await this.exportContent(row, signal); check(); signal.throwIfAborted()
      const ticket = randomUUID(), expiresAt = Date.now() + 120000
      const path = join(this.home, 'nidofy-extras', 'analysis-exports-v1', `analysis-${row.id}-${ticket}.json`)
      this.exports.set(ticket, { scope, expiresAt, row, content, path, check })
      return { ticket, expiresAt, action: 'export', row: display(row), journal: row.journal,
        after: { path, bytes: Buffer.byteLength(content), format: 'side-analysis-export-v1', exactLocalFiles: true } }
    }
    for (const [ticket, plan] of this.plans) if (plan.expiresAt <= Date.now()) this.plans.delete(ticket)
    if (this.plans.size >= 8) throw Error('ANALYSIS_PREVIEW_LIMIT')
    const ticket = randomUUID(), expiresAt = Date.now() + 120000
    const common = { scope, expiresAt, snapshot: state.snapshot, check }
    if (method === 'archive-preview') {
      const row = this.selected(state.rows, scope, data.id)
      if (row.archive) throw Error('ANALYSIS_ALREADY_ARCHIVED')
      if (!row.journal.terminal || this.active(row.id)) throw Error('ANALYSIS_HISTORY_UNSETTLED')
      if (state.archived >= state.budget.archiveLimit) throw Error('ANALYSIS_BUDGET_EXHAUSTED')
      this.plans.set(ticket, { ...common, action: 'archive', row })
      return { ticket, expiresAt, action: 'archive', row: display(row), journal: row.journal,
        budget: state.budget, after: { active: state.active - 1, archived: state.archived + 1 } }
    }
    if (method !== 'budget-preview') throw Error('ANALYSIS_ACTION_REFUSED')
    const limits = analysisLimits(data.activeLimit, data.archiveLimit)
    if (limits.activeLimit < state.active || limits.archiveLimit < state.archived) throw Error('ANALYSIS_BUDGET_EXHAUSTED')
    if (limits.activeLimit === state.budget.activeLimit && limits.archiveLimit === state.budget.archiveLimit) throw Error('ANALYSIS_BUDGET_UNCHANGED')
    this.plans.set(ticket, { ...common, action: 'budget', ...limits })
    return { ticket, expiresAt, action: 'budget', before: state.budget, after: limits, active: state.active, archived: state.archived }
  }
  /** Withdraw process-local previews without altering retained records. */
  close(): void { this.plans.clear(); this.exports.clear() }
}
