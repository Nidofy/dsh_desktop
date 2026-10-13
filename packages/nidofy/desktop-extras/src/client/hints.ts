/** Evidence-only Hint rules; no text inference, model calls, task execution or capability installation. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CompanionScope, CompanionView, CompanionAction } from './companion.ts'
import type { CompanionFacts, HintPreferences, HintId } from '../shared/companion-facts.ts'

export type { HintId } from '../shared/companion-facts.ts'
/** Original evidence or actual registered capability; Notebook prose never creates a test outcome. */
export interface Hint {
  hintId: HintId
  kind: 'waiting' | 'missing-verification' | 'stale-verification' | 'unfinished' | 'repeated-failure' | 'capability'
  source: { kind: 'interaction' | 'notebook' | 'notice' | 'capability'; ids: readonly string[]; revision: string; text: string | null }
  scopeRevision: number
  createdAt: number
  expiry: 'scope-or-condition-change'
  actions: readonly (CompanionAction | 'notebook')[]
}
/** One bounded return offer; persisted offered identities suppress subsequent automatic cards. */
export interface CompanionReturnCard { scope: CompanionScope; createdAt: number; hints: readonly Hint[] }

/** Derive only allowed rules from current owners, then apply independent durable user choices.
 * @param view - Complete current official Client scope and admitted navigation commands.
 * @param facts - Current Host physical-source/receipt/committed Notebook observation.
 * @param preferences - Current persisted choices; absence must not be defaulted by the consumer.
 * @param pendingKey - Actual official pending-interaction identity, when present.
 * @param now - Observation time; snooze expiry is rechecked on the next read or navigation.
 * @returns At most 16 source-bound hints; neither historical text nor missing APIs authorize execution.
 */
export async function deriveHints(view: CompanionView, facts: CompanionFacts, preferences: HintPreferences,
  pendingKey: string | undefined, now: number): Promise<Hint[]> {
  if (!view.connected || view.scope.sessionId !== facts.sessionId) return []
  if (facts.project && preferences.muted.some(row => row.workspaceId === facts.project?.workspaceId
    && row.path === facts.project.path)) return []
  const candidates: Omit<Hint, 'hintId'>[] = []
  const add = (kind: Hint['kind'], source: Hint['source'], actions: Hint['actions'], createdAt = now): void => {
    candidates.push({ kind, source, scopeRevision: view.scope.revision, createdAt, expiry: 'scope-or-condition-change', actions })
  }
  if (view.state === 'waiting' && pendingKey) add('waiting', { kind: 'interaction', ids: [pendingKey], revision: pendingKey, text: null },
    view.actions.includes('approval') ? ['approval'] : view.actions.includes('conversation') ? ['conversation'] : [])
  const notes = [...facts.notebook.value?.active ?? []].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.id.localeCompare(b.id))
  const notices = facts.notices.filter(row => row.delivery.visibleToCompanion)
  const verified = notices.some(row => row.receipt?.tests === 'PASSED' && row.receipt.freshness === 'CURRENT')
  for (const note of notes) {
    const source: Hint['source'] = { kind: 'notebook', ids: [note.id], revision: String(note.revision), text: note.text }
    if (note.kind === 'verification' && !verified && view.actions.includes('builds')) add('missing-verification', source, ['builds'])
    if ((note.kind === 'next' || note.kind === 'issue') && view.notebook === 'available') add('unfinished', source, ['notebook'])
  }
  const awaiting = notices.find(row => row.kind === 'awaiting-acceptance' && row.receipt?.acceptance === 'PENDING')
  if (awaiting && view.actions.includes('builds')) add('waiting', { kind: 'notice', ids: [awaiting.id],
    revision: String(awaiting.receipt?.acceptanceRevision), text: null }, ['builds'], awaiting.createdAt)
  const latestActions = new Map<string, typeof facts.notices[number]>()
  for (const row of notices) if (row.receipt && !latestActions.has(row.receipt.actionId)) latestActions.set(row.receipt.actionId, row)
  const stale = [...latestActions.values()].find(row => row.receipt?.freshness === 'STALE')
  if (stale && view.actions.includes('builds')) add('stale-verification', { kind: 'notice', ids: [stale.id],
    revision: String(stale.receipt?.acceptanceRevision), text: null }, ['builds'], stale.createdAt)
  const groups = new Map<string, typeof facts.notices>()
  for (const row of notices) {
    const receipt = row.receipt
    if (!receipt) continue
    const rows = groups.get(receipt.commandDigest) ?? []
    rows.push(row); groups.set(receipt.commandDigest, rows)
  }
  for (const [digest, rows] of groups) {
    if (rows[0]?.receipt?.tests !== 'FAILED') continue
    const failures = rows.filter(row => row.receipt?.tests === 'FAILED' && row.receipt.logAvailable && row.receipt.logDigest !== null)
    if (new Set(failures.map(row => row.receipt?.id)).size >= 2 && view.actions.includes('builds')) add('repeated-failure', { kind: 'notice', ids: failures.map(row => row.id),
      revision: digest, text: null }, ['builds'], failures[0]?.createdAt)
  }
  if (view.model === 'unknown' && view.actions.includes('connections')) add('capability', { kind: 'capability',
    ids: ['connections'], revision: 'connections', text: null }, ['connections'])
  const hints = await Promise.all(candidates.slice(0, 16).map(async (candidate): Promise<Hint> => {
    const bytes = new TextEncoder().encode(JSON.stringify([facts.sessionId, facts.generation, candidate.kind,
      candidate.source.kind, candidate.source.ids, candidate.source.revision]))
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const hintId = brandString<HintId>(Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join(''))
    return { ...candidate, hintId }
  }))
  return hints.filter(row => !preferences.ignored.includes(row.hintId)
    && !preferences.snoozed.some(value => value.id === row.hintId && value.until > now))
}
