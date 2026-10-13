/** Validation of bounded read-only Host evidence before publication to renderers. */
import type { CompanionFacts, HintPreferences } from '../shared/companion-facts.ts'

/** Decode the authenticated wire response without trusting absent facts or model claims.
 * @param value - Complete decoded HTTP result.
 * @param sessionId - Explicit current Session requested by the consumer.
 * @returns Validated read-only facts, or a refusal before any renderer publication.
 */
export function readCompanionFacts(value: unknown, sessionId: string): CompanionFacts {
  const fail = (): never => { throw Error('COMPANION_RESPONSE_INVALID') }
  const object = (row: unknown): Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row)
    ? { ...row } : fail()
  const integer = (row: unknown): row is number => typeof row === 'number' && Number.isSafeInteger(row) && row >= 0
  const text = (row: unknown): row is string => typeof row === 'string' && !row.includes('\0') && row.isWellFormed()
  const row = object(value), notebook = object(row.notebook)
  if (row.project !== null) {
    const project = object(row.project)
    if (!text(project.workspaceId) || !text(project.path) || project.path !== row.cwd) fail()
  }
  if (row.sessionId !== sessionId || row.cwd !== null && !text(row.cwd) || !text(row.generation)
    || !(row.durableThrough === -1 || integer(row.durableThrough)) || !Array.isArray(row.notices) || row.notices.length > 16
    || !['available', 'disabled', 'unavailable'].includes(String(notebook.availability))
    || notebook.diagnostic !== null && !text(notebook.diagnostic)) fail()
  const notices = Array.isArray(row.notices) ? row.notices : fail()
  const identities = new Set<string>()
  for (const item of notices) {
    const notice = object(item), delivery = object(notice.delivery)
    if (!text(notice.id) || !/^[a-f0-9]{64}$/.test(notice.id) || !text(notice.sourceId)
      || !['receipt', 'session', 'job'].includes(String(notice.sourceType))
      || !['completed', 'failed', 'cancelled', 'awaiting-acceptance', 'blocked', 'limit-reached', 'interrupted', 'unknown'].includes(String(notice.kind))
      || !integer(notice.createdAt) || !['current', 'historical', 'unavailable'].includes(String(notice.source))
      || notice.diagnostic !== null && !text(notice.diagnostic)
      || !['unclaimed', 'claimed', 'sent', 'failed', 'unknown', 'suppressed'].includes(String(delivery.system))
      || typeof delivery.visibleToCompanion !== 'boolean' || typeof delivery.handled !== 'boolean') fail()
    const identity = typeof notice.id === 'string' ? notice.id : fail()
    if (identities.has(identity)) fail()
    identities.add(identity)
    if (notice.receipt !== null) {
      const receipt = object(notice.receipt)
      if (notice.sourceType !== 'receipt' || receipt.id !== notice.sourceId
        || !['NOT_RUN', 'PASSED', 'FAILED', 'UNKNOWN'].includes(String(receipt.tests))
        || !['CURRENT', 'STALE', 'UNKNOWN'].includes(String(receipt.freshness))
        || !['PENDING', 'ACCEPTED', 'REJECTED'].includes(String(receipt.acceptance))
        || !integer(receipt.acceptanceRevision) || typeof receipt.logAvailable !== 'boolean'
        || !text(receipt.actionId) || !text(receipt.commandDigest) || !/^[a-f0-9]{64}$/.test(receipt.commandDigest)
        || receipt.logDigest !== null && (!text(receipt.logDigest) || !/^[a-f0-9]{64}$/.test(receipt.logDigest))) fail()
    }
  }
  if (notebook.value !== null) {
    const state = object(notebook.value), scope = object(state.scope), cursors = object(state.cursors)
    if (notebook.availability !== 'available' || state.schemaVersion !== 2 || scope.sessionId !== sessionId
      || scope.generation !== row.generation || !integer(state.revision) || !integer(state.historyRevision)
      || !(cursors.evidenceThrough === -1 || integer(cursors.evidenceThrough))
      || !(cursors.commitThrough === -1 || integer(cursors.commitThrough)) || !Array.isArray(state.active)) fail()
    const active = Array.isArray(state.active) ? state.active : fail()
    for (const entry of active) {
      const note = object(entry)
      if (!text(note.id) || !text(note.text) || !text(note.quote) || !integer(note.seq) || !integer(note.revision)
        || typeof note.pinned !== 'boolean' || note.active !== true
        || !['objective', 'constraint', 'decision', 'file', 'verification', 'failure', 'issue', 'next'].includes(String(note.kind))) fail()
    }
  } else if (notebook.availability === 'available') fail()
  return value as CompanionFacts
}

/** Validate independent preferences before applying any rule, so an unreadable choice never resets to enabled.
 * @param value - Complete authenticated preference response.
 * @returns Validated current revision; malformed choices refuse Hint publication.
 */
export function readHintPreferences(value: unknown): HintPreferences {
  const fail = (): never => { throw Error('COMPANION_RESPONSE_INVALID') }
  const object = (row: unknown): Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row)
    ? { ...row } : fail()
  const integer = (row: unknown): row is number => typeof row === 'number' && Number.isSafeInteger(row) && row >= 0
  const ids = (row: unknown): row is string[] => Array.isArray(row) && row.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
  const row = object(value)
  if (!integer(row.revision) || !ids(row.ignored) || !ids(row.offered) || !Array.isArray(row.snoozed) || !Array.isArray(row.muted)) fail()
  for (const entry of Array.isArray(row.snoozed) ? row.snoozed : fail()) {
    const item = object(entry)
    if (!ids([item.id]) || !integer(item.until)) fail()
  }
  for (const entry of Array.isArray(row.muted) ? row.muted : fail()) {
    const item = object(entry)
    if (typeof item.workspaceId !== 'string' || typeof item.path !== 'string') fail()
  }
  return value as HintPreferences
}
