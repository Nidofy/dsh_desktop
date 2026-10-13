/** Read-only evidence shared by the authenticated Host and scoped Companion consumers. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NotebookV2 } from './notebook-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** T12-owned identity; reading facts never claims, advances or handles it. */
export type CompanionFactNoticeId = Branded<'nidofy.NoticeId'>
/** Stable rule/source identity, separate from notice claims and transient scope revisions. */
export type HintId = Branded<'nidofy.HintId'>
/** Current inspect facts stay separate from immutable execution and independent user acceptance. */
export interface CompanionReceiptFact {
  id: Branded<'nidofy.VerificationReceiptId'>
  tests: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'UNKNOWN'
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'
  acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  acceptanceRevision: number
  logAvailable: boolean
  actionId: string
  commandDigest: string
  logDigest: string | null
}
/** A retained notice may be historical or unreadable; neither establishes current evidence. */
export interface CompanionNoticeFact {
  id: CompanionFactNoticeId
  sourceId: Branded<'nidofy.VerificationReceiptId'> | Branded<'nidofy.SessionNoticeSourceId'>
  sourceType: 'receipt' | 'session' | 'job'
  kind: 'completed' | 'failed' | 'cancelled' | 'awaiting-acceptance' | 'blocked' | 'limit-reached' | 'interrupted' | 'unknown'
  createdAt: number
  source: 'current' | 'historical' | 'unavailable'
  diagnostic: string | null
  delivery: {
    system: 'unclaimed' | 'claimed' | 'sent' | 'failed' | 'unknown' | 'suppressed'
    visibleToCompanion: boolean
    handled: boolean
  }
  receipt: CompanionReceiptFact | null
}
/** Bounded observation of one raw physical generation and selected, already committed Notebook. */
export interface CompanionFacts {
  sessionId: SessionId
  cwd: string | null
  generation: SessionPersistenceGeneration
  durableThrough: number
  /** Exact actual Workspace attachment; null grants no project mute authority. */
  project: { workspaceId: WorkspaceId; path: string } | null
  notices: CompanionNoticeFact[]
  notebook: { availability: 'available' | 'disabled' | 'unavailable'; value: NotebookV2 | null; diagnostic: string | null }
}

/** User viewing preferences; immutable revisions never mutate T12 delivery or T11 acceptance. */
export interface HintPreferences {
  revision: number
  ignored: readonly HintId[]
  snoozed: readonly { id: HintId; until: number }[]
  muted: readonly { workspaceId: WorkspaceId; path: string }[]
  offered: readonly HintId[]
}
