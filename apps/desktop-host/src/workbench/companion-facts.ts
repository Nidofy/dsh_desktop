import { terminalStatus } from '@nidofy/dsh-desktop-extras/task-recovery'
/** Read-only current evidence; retained logical-scope notices grant no physical-generation authority. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CompanionFacts, CompanionNoticeFact } from '@nidofy/dsh-desktop-extras/context'
import type {} from '@nidofy/dsh-desktop-extras/context'
import type { NotificationOwner } from './notifications.ts'
import type { VerificationOwner } from './verification.ts'
import type {} from '@deepseek-ai/dsh-workspace'
import { stat } from 'node:fs/promises'

const diagnostic = (error: unknown): string => error instanceof Error && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.message)
  ? error.message : 'COMPANION_SOURCE_UNAVAILABLE'

/** Projects original terminals and real receipt inspections without mutating any source or delivery state. */
export class CompanionFactsOwner {
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<CompanionFacts>>()
  constructor(private readonly ctx: Context, private readonly notifications: NotificationOwner,
    private readonly verification: VerificationOwner) {}
  /** Read current physical evidence and preserve historical notice identities with explicit status.
   * @param sessionId - Authenticated observer's explicit logical Session.
   * @param signal - Request lifetime; source replacement and cancellation refuse publication.
   * @returns Complete bounded facts; unreadable receipts/Notebook remain unavailable, never passed or empty evidence.
   */
  async read(sessionId: SessionId, signal: AbortSignal): Promise<CompanionFacts> {
    const operationSignal = AbortSignal.any([signal, this.lifetime.signal])
    operationSignal.throwIfAborted()
    const work = this.project(sessionId, operationSignal)
    this.pending.add(work)
    try { return await work } finally { this.pending.delete(work) }
  }
  private async project(sessionId: SessionId, signal: AbortSignal): Promise<CompanionFacts> {
    const persistence = this.ctx.sessionPersistence
    const observation = await persistence.observeDurable(sessionId, { signal })
    if (observation.meta.id !== sessionId || observation.durableThrough !== observation.events.length - 1
      || observation.events.some((event, index) => event.seq !== index)) throw Error('COMPANION_DURABLE_SOURCE_UNAVAILABLE')
    const assertOwner = (): void => {
      signal.throwIfAborted()
      if (this.ctx.get('sessionPersistence')?.identity !== persistence.identity) throw Error('COMPANION_SOURCE_CHANGED')
    }
    // Notebook read acquires its own generation protection; it must not run inside a nested hold.
    const notebook: CompanionFacts['notebook'] = { availability: 'unavailable', value: null, diagnostic: null }
    const owner = this.ctx.get('nidofyNotebookV2')
    if (owner) {
      try {
        const value = await owner.read(sessionId, signal)
        if (value.scope.sessionId !== sessionId || value.scope.generation !== observation.generation
          || value.active.some(note => note.seq > observation.durableThrough)) throw Error('NOTEBOOK_SCOPE_CONFLICT')
        notebook.availability = 'available'; notebook.value = value
      } catch (error) { signal.throwIfAborted(); notebook.diagnostic = diagnostic(error) }
    } else if (this.ctx.get('configEditor')?.configuration().some(row =>
      row.entry.options.name === '@nidofy/dsh-working-notebook' && row.entry.options.disabled === true)) notebook.availability = 'disabled'
    return persistence.withGeneration(sessionId, observation.generation, async () => {
      assertOwner()
      const cwd = observation.meta.cwd ?? null, notices: CompanionNoticeFact[] = []
      for (const row of await this.notifications.forScope(sessionId, cwd)) {
        const fact: CompanionNoticeFact = { id: row.id, sourceId: row.sourceId, sourceType: row.sourceType,
          kind: row.kind, createdAt: row.createdAt, source: 'unavailable', diagnostic: null, delivery: row.delivery, receipt: null }
        if (row.sourceType === 'session') {
          const source = row.sessionSource, event = source ? observation.events[source.seq] : undefined
          const kind = event?.type === 'turn/end' ? terminalStatus(event.data.reason.kind).toLowerCase().replace('_', '-') : null
          fact.source = source && row.scope.sessionId === sessionId && row.scope.workspace === cwd
            && source.generation === observation.generation && source.seq >= observation.inheritedEventCount
            && event?.type === 'turn/end' && event.data.turn === source.turn && kind === row.kind
            && event.time === row.createdAt ? 'current' : 'historical'
        } else if (row.sourceType === 'job') {
          // Process-local jobs cannot be revalidated as a current Session log terminal after restart.
          fact.source = 'historical'
        } else if (cwd === null || row.scope.workspace !== cwd) {
          fact.source = 'historical'
        } else {
          try {
            const view = await this.verification.inspect(cwd, row.sourceId), receipt = view.receipt
            if (view.phase === 'COMMITTED' && receipt?.id === row.sourceId) {
              fact.receipt = { id: receipt.id, tests: receipt.tests, freshness: receipt.freshness,
                acceptance: receipt.acceptance, acceptanceRevision: view.acceptanceRevision, logAvailable: view.logAvailable,
                actionId: receipt.command.actionId, commandDigest: receipt.command.digest, logDigest: receipt.log.digest }
              fact.source = receipt.freshness === 'STALE' ? 'historical' : 'current'
              fact.diagnostic = view.diagnostic
            } else fact.diagnostic = view.diagnostic ?? 'VERIFICATION_RESULT_UNKNOWN'
          } catch (error) { signal.throwIfAborted(); fact.diagnostic = diagnostic(error) }
        }
        notices.push(fact)
      }
      assertOwner()
      const registry = this.ctx.get('workspaceRegistry')
      const workspace = registry?.list().find(row => row.path === cwd && row.sessionIds.includes(sessionId))
      let project: CompanionFacts['project'] = null
      if (workspace) {
        try {
          if ((await stat(workspace.path)).isDirectory()
            && registry?.get(workspace.id)?.path === workspace.path
            && registry.get(workspace.id)?.sessionIds.includes(sessionId)) project = { workspaceId: workspace.id, path: workspace.path }
        } catch (error) { signal.throwIfAborted(); void error }
      }
      assertOwner()
      const result: CompanionFacts = { sessionId, cwd, generation: observation.generation,
        durableThrough: observation.durableThrough, project, notices, notebook }
      if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('COMPANION_PAYLOAD_LIMIT')
      return result
    }, { signal })
  }
  /** Cancel and drain reads before releasing persistence, Notebook or verification providers. */
  async close(): Promise<void> { this.lifetime.abort(); await Promise.allSettled(this.pending) }
}
