/** Main-owned receipt-notice consumption. Display claims and consumption positions remain in the authenticated Host. */
export interface SystemNotice {
  id: string
  sourceId: string
  sourceType: 'receipt' | 'session' | 'job'
  sequence: number
  kind: 'completed' | 'failed' | 'cancelled' | 'awaiting-acceptance' | 'blocked' | 'limit-reached' | 'interrupted' | 'unknown'
  scope: { workspace: string | null; sessionId: string | null }
}
/** Actual OS display observation; an unacknowledged attempt is never retried. */
export type SystemNoticeOutcome = 'sent' | 'failed' | 'unknown' | 'suppressed'
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('NOTICE_RESPONSE_INVALID')
  return { ...value }
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('NOTICE_RESPONSE_INVALID')
  return value
}
function notice(value: unknown): SystemNotice {
  const row = object(value), scope = object(row.scope)
  if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || typeof row.sourceId !== 'string'
    || row.sourceType !== 'receipt' && row.sourceType !== 'session' && row.sourceType !== 'job'
    || row.sourceType === 'receipt' && !/^[a-f0-9-]{36}$/.test(row.sourceId)
    || row.sourceType !== 'receipt' && (!/^[a-f0-9]{64}$/.test(row.sourceId) || typeof scope.sessionId !== 'string')
    || !['completed', 'failed', 'cancelled', 'awaiting-acceptance', 'blocked', 'limit-reached', 'interrupted', 'unknown'].includes(String(row.kind))
    || scope.workspace !== null && typeof scope.workspace !== 'string'
    || scope.sessionId !== null && typeof scope.sessionId !== 'string') throw Error('NOTICE_RESPONSE_INVALID')
  return { id: row.id, sourceId: row.sourceId, sourceType: row.sourceType, sequence: integer(row.sequence), kind: row.kind as SystemNotice['kind'],
    scope: { workspace: scope.workspace, sessionId: scope.sessionId } }
}
/** Main consumes notices while the workbench is closed; a backend change invalidates in-flight display decisions. */
export class WorkbenchNoticeConsumer {
  private identity: string | undefined
  private epoch = 0
  private attached = false
  private stopping = false
  private pending: Promise<void> | undefined
  constructor(private readonly request: (method: string, input?: Record<string, unknown>) => Promise<unknown>,
    private readonly display: (notice: SystemNotice) => Promise<SystemNoticeOutcome>) {}
  private current(epoch: number): boolean { return !this.stopping && epoch === this.epoch }
  /** Poll one bounded page using the shared durable claim and cursor.
   * @param identity - Private current backend identity; it is never sent to UI or persisted in notice records.
   * @returns Completion after any display/settlement; first attach establishes a baseline and displays no history.
   */
  tick(identity: string): Promise<void> {
    if (this.stopping) return Promise.resolve()
    if (this.identity !== identity) { this.identity = identity; this.epoch++; this.attached = false }
    if (this.pending) return this.pending
    const epoch = this.epoch
    const work = (async () => {
      if (!this.attached) {
        await this.request('notifications/attach')
        if (this.current(epoch)) this.attached = true
        return
      }
      const page = object(await this.request('notifications/poll')), cursor = object(page.cursor), preferences = object(page.preferences)
      const revision = integer(cursor.revision), prefsRevision = integer(preferences.revision)
      if (typeof preferences.enabled !== 'boolean' || !Array.isArray(page.notices) || page.notices.length > 100) throw Error('NOTICE_RESPONSE_INVALID')
      const notices = page.notices.map(notice)
      if (!this.current(epoch) || !notices.length) return
      for (const row of notices) {
        if (!this.current(epoch)) return
        if (!preferences.enabled) continue
        const response = await this.request('notifications/claim', { id: row.id, prefsRevision })
        if (response === null) continue
        const claimed = object(response)
        if (typeof claimed.claimId !== 'string' || !/^[a-f0-9-]{36}$/.test(claimed.claimId)
          || notice(claimed.notice).id !== row.id) throw Error('NOTICE_RESPONSE_INVALID')
        let outcome: SystemNoticeOutcome = 'unknown'
        try {
          const current = object(await this.request('notifications/preferences'))
          if (this.current(epoch)) outcome = current.enabled === true && current.revision === prefsRevision
            ? await this.display(row) : 'suppressed'
        } finally { await this.request('notifications/settle', { id: row.id, claimId: claimed.claimId, outcome }) }
      }
      const last = notices.at(-1)
      if (this.current(epoch) && last) await this.request('notifications/advance', {
        expectedRevision: revision, sequence: last.sequence,
      })
    })().catch((error: unknown) => {
      if (this.current(epoch)) { this.attached = false; this.epoch++ }
      throw error
    })
    this.pending = work
    void work.finally(() => { if (this.pending === work) this.pending = undefined })
      .catch(() => { /* Main records no delivery on a failed query. */ })
    return work
  }
  /** Invalidate late responses and await admitted claim settlements before disposal. */
  async close(): Promise<void> { this.stopping = true; this.epoch++; await this.pending?.catch(() => {}) }
}
