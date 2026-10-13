/** Allowed rule truth tables and user corrections without model inference or delivery consumption. */
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { brandString, brandNumber } from '@deepseek-ai/dsh-brand'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { CompanionView, CompanionHostEpoch, CompanionWindowId, CompanionViewId } from '../src/client/companion.ts'
import type { CompanionFacts, CompanionNoticeFact, CompanionFactNoticeId, CompanionReceiptFact, HintPreferences } from '../src/shared/companion-facts.ts'
import { deriveHints } from '../src/client/hints.ts'
import { readCompanionFacts, readHintPreferences } from '../src/client/facts.ts'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  vi.stubGlobal('crypto', webcrypto)
  const view: { -readonly [K in keyof CompanionView]: CompanionView[K] } = { scope: { hostEpoch: brandString<CompanionHostEpoch>('11111111-1111-1111-1111-111111111111'),
    windowId: brandNumber<CompanionWindowId>(7), viewId: brandString<CompanionViewId>('chat'), panelId: null,
    workspaceId: null, sessionId: brandString<SessionId>('local'), turn: null, revision: 7 }, connected: true, state: 'idle',
  notebook: 'available', model: 'known', receiptId: null, noticeIds: [], facts: null, hintPreferences: null, hints: [], returnCard: null,
  actions: ['conversation', 'approval', 'builds', 'connections'] }
  const facts: CompanionFacts = { sessionId: brandString<SessionId>('local'), cwd: '/actual', generation: brandString<SessionPersistenceGeneration>('actual-generation'), durableThrough: 10, project: null, notices: [],
    notebook: { availability: 'available', diagnostic: null, value: { schemaVersion: 2, scope: { sessionId: 'local',
      generation: brandString<SessionPersistenceGeneration>('actual-generation') }, revision: 3, historyRevision: 0,
    cursors: { evidenceThrough: 10, commitThrough: 10 }, active: [{ id: 'user-corrected', kind: 'verification', text: 'PASSED is only a model claim',
      seq: 2, quote: 'original', pinned: true, active: true, revision: 2 }] } } }
  const preferences: HintPreferences = { revision: 0, ignored: [], snoozed: [], muted: [], offered: [] }
  return { view, facts, preferences, read: () => deriveHints(view, facts, preferences, undefined, 1000) }
}
function notice(key: string): CompanionNoticeFact {
  const receiptId = brandString<CompanionReceiptFact['id']>(key.repeat(8) + '-' + key.repeat(4) + '-' + key.repeat(4) + '-' + key.repeat(4) + '-' + key.repeat(12))
  return { id: brandString<CompanionFactNoticeId>(key.repeat(64)), sourceId: receiptId, sourceType: 'receipt',
    kind: 'failed', createdAt: 500, source: 'current', diagnostic: null,
    delivery: { system: 'unknown', visibleToCompanion: true, handled: false }, receipt: {
      id: receiptId, tests: 'FAILED', freshness: 'UNKNOWN', acceptance: 'PENDING',
      acceptanceRevision: 0, logAvailable: true, actionId: 'test', commandDigest: 'c'.repeat(64), logDigest: 'd'.repeat(64) } }
}

it('never converts Notebook claims or unknown receipt freshness into current passed verification', async () => {
  const f = fixture()
  expect((await f.read()).map(row => row.kind)).toEqual(['missing-verification'])
  const receipt = notice('a'); receipt.receipt!.tests = 'PASSED'
  f.facts.notices.push(receipt)
  expect((await f.read()).map(row => row.kind)).toEqual(['missing-verification'])
  receipt.receipt!.freshness = 'STALE'
  expect((await f.read()).map(row => row.kind)).toContain('stale-verification')
  receipt.receipt!.freshness = 'CURRENT'
  expect(await f.read()).toEqual([])
  expect(receipt.delivery).toEqual({ system: 'unknown', visibleToCompanion: true, handled: false })
})

it('keeps source IDs stable across scope revisions, ignores only that source revision and rechecks snooze/project choices', async () => {
  const f = fixture(), initial = (await f.read())[0]!
  f.view.scope = { ...f.view.scope, revision: 8 }
  expect((await f.read())[0]?.hintId).toBe(initial.hintId)
  f.preferences.ignored = [initial.hintId]
  expect(await f.read()).toEqual([])
  const notebook = f.facts.notebook.value!
  notebook.active = notebook.active.map(note => ({ ...note, revision: 3, text: 'Actual user correction' }))
  const corrected = (await f.read())[0]!
  expect(corrected.hintId).not.toBe(initial.hintId)
  expect(corrected.source.text).toBe('Actual user correction')
  f.preferences.snoozed = [{ id: corrected.hintId, until: 1001 }]
  expect(await f.read()).toEqual([])
  f.preferences.snoozed = [{ id: corrected.hintId, until: 1000 }]
  expect((await f.read())[0]?.hintId).toBe(corrected.hintId)
  f.facts.project = { workspaceId: brandString<WorkspaceId>('actual'), path: '/actual' }
  f.preferences.muted = [{ workspaceId: brandString<WorkspaceId>('other'), path: '/actual' }]
  expect(await f.read()).toHaveLength(1)
  f.preferences.muted = [{ workspaceId: brandString<WorkspaceId>('actual'), path: '/actual' }]
  expect(await f.read()).toEqual([])
})

it('requires two retained real failed logs for the same command and withdraws on a later pass or missing capability', async () => {
  const f = fixture(); f.facts.notebook.value = null; f.facts.notebook.availability = 'unavailable'
  f.facts.notices = [notice('a'), notice('b')]
  expect((await f.read()).map(row => row.kind)).toEqual(['repeated-failure'])
  f.facts.notices[1]!.receipt!.logAvailable = false
  expect(await f.read()).toEqual([])
  f.facts.notices[1]!.receipt!.logAvailable = true
  f.facts.notices[0]!.receipt!.tests = 'PASSED'
  expect(await f.read()).toEqual([])
  f.view.model = 'unknown'; f.view.actions = []
  expect(await f.read()).toEqual([])
  f.view.state = 'waiting'
  expect(await deriveHints(f.view, f.facts, f.preferences, 'actual-pending-key', 1000)).toMatchObject([{ kind: 'waiting' }])
})

it('refuses malformed facts or missing preferences rather than constructing empty defaults', () => {
  const f = fixture()
  expect(readCompanionFacts(f.facts, 'local')).toEqual(f.facts)
  expect(() => readCompanionFacts({ ...f.facts, sessionId: 'foreign' }, 'local')).toThrow()
  expect(() => readCompanionFacts({ ...f.facts, notebook: { availability: 'available', value: null, diagnostic: null } }, 'local')).toThrow()
  expect(() => readHintPreferences({ revision: 0 })).toThrow()
})

it('keeps pending acceptance independent of handled/system state and withdraws old-action expiry after current verification', async () => {
  const f = fixture(), current = notice('a'), old = notice('b')
  current.kind = 'awaiting-acceptance'; current.delivery.handled = true
  current.receipt!.tests = 'PASSED'; current.receipt!.freshness = 'CURRENT'
  old.receipt!.freshness = 'STALE'
  f.facts.notices = [current, old]
  expect((await f.read()).map(row => row.kind)).toEqual(['waiting'])
  current.receipt!.acceptance = 'ACCEPTED'; current.receipt!.acceptanceRevision = 1
  expect(await f.read()).toEqual([])
  current.delivery.visibleToCompanion = false; old.delivery.visibleToCompanion = false
  expect((await f.read()).map(row => row.kind)).toEqual(['missing-verification'])
  expect(current.delivery.system).toBe('unknown')
  expect(current.delivery.handled).toBe(true)
})
