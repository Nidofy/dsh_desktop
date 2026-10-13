import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** User-created history project identity; repository names confer no authority. */
export type HistoryProjectId = Branded<'nidofy.HistoryProjectId'>
/** Exact Workspace identity and path approved for local history reads. */
export interface HistoryMember { id: WorkspaceId; path: string }
/** Explicit project membership; one Workspace belongs to at most one project. */
export interface HistoryProject { id: HistoryProjectId; members: HistoryMember[] }
/** Association metadata presented for an explicit local-user edit. */
export interface HistoryGroupView {
  revision: number
  current: HistoryMember
  project: HistoryProject | null
  candidates: { id: WorkspaceId; path: string; title: string }[]
}
/** Every project preview and citation must retain this captured association revision. */
export interface HistoryAuthority {
  revision: number
  projectId: HistoryProjectId
  members: HistoryMember[]
}

/** Evidence is always in the notebook's own Session. */
export interface Note {
  id: string
  kind: 'objective' | 'constraint' | 'decision' | 'file' | 'verification' | 'failure' | 'issue' | 'next'
  text: string
  seq: number
  quote: string
  pinned: boolean
  active: boolean
  revision: number
}
/** One atomic revision; sourceThrough advances only after a validated delta commits. */
export interface Notebook {
  schemaVersion: 1
  sessionId: string
  revision: number
  sourceThrough: number
  entries: Note[]
}
/** Deployment-owned bounds include the entire serialized model-visible snapshot. */
export interface NotebookLimits { maxEntries: number; maxBytes: number }

/** Session log generation a v2 state was validated against; never a connection id or process id. */
export interface NotebookScope { sessionId: string; generation: SessionPersistenceGeneration }

/**
 * Continuous-prefix watermarks over one Session generation; `-1` means nothing checked.
 * `evidenceThrough` is the longest examined prefix of original events; `commitThrough` is the
 * longest prefix with a persisted notebook decision. Both only advance within one generation.
 */
export interface NotebookCursors { evidenceThrough: number; commitThrough: number }

/**
 * One atomically published v2 revision: the active set plus dual cursors. Retired notes live
 * only in the history journal; `historyRevision` counts journal-writing publications.
 */
export interface NotebookV2 {
  schemaVersion: 2
  scope: NotebookScope
  revision: number
  cursors: NotebookCursors
  active: readonly Note[]
  historyRevision: number
}

/** Deterministic bounded view of the active set for the next model request; bytes are stable per committed revision. */
export interface ActiveNotebookProjection { scope: NotebookScope; revision: number; entries: readonly Note[] }

/**
 * Deployment-owned v2 bounds, all non-negative safe integers; bytes are actual UTF-8 bytes.
 * `maxActiveBytes` covers the serialized projection including any consumer wrapper text;
 * `maxEvidenceBytes` covers quote bytes one candidate may cite; `maxHistoryBytes` caps the
 * session's whole v2 on-disk namespace including replacement temporaries.
 */
export interface NotebookBudgets {
  maxActiveEntries: number
  maxActiveBytes: number
  maxDeltaBytes: number
  maxEvidenceBytes: number
  maxHistoryBytes: number
}

/** Product read bounds; source windows contain at most recentScanEvents raw events. */
export interface NotebookReadOptions { maxCachedSessions: number; recentEventLimit: number; recentScanEvents: number }

/** Process-local organization progress; it never claims an uncommitted notebook revision. */
export interface NotebookSynchronization {
  phase: 'idle' | 'organizing' | 'ready' | 'failed'
  synchronizedThrough: number
  diagnostic?: string
}

/** Journal record of one legacy entry copied by migration; `note` is `null` for a watermark-only record. */
export interface NotebookMigrateRecord {
  action: 'migrate'
  historyRevision: number
  atRevision: number
  generation: null
  legacySourceThrough: number
  note: Note | null
}

/** Journal record preserving a retired note with its final content and source. */
export interface NotebookRetireRecord {
  action: 'retire'
  historyRevision: number
  atRevision: number
  generation: SessionPersistenceGeneration
  note: Note
}

/** Journal record marking that a retired id returned to the active set. */
export interface NotebookRestoreRecord {
  action: 'restore'
  historyRevision: number
  atRevision: number
  generation: SessionPersistenceGeneration
  id: string
}

/** Committed history journal record; retired and restored ids stay traceable forever. */
export type NotebookHistoryRecord = NotebookMigrateRecord | NotebookRetireRecord | NotebookRestoreRecord

/** One bounded page of committed history records, ordered oldest first. */
export interface NotebookHistoryPage {
  scope: NotebookScope
  revision: number
  historyRevision: number
  records: readonly NotebookHistoryRecord[]
  nextToken: number | null
}

/** One proposed v2 change: operations plus optional cursor advancement, both validated by the store. */
export interface NotebookV2Candidate {
  operations: readonly unknown[]
  cursors?: { evidenceThrough?: number; commitThrough?: number }
}

/** Facts about one bounded write into a session's v2 namespace, measured before any disk mutation. */
export interface NotebookStorageWrite {
  scope: NotebookScope
  /** On-disk bytes of the v2 namespace (current, immutable revisions, history journal) before the write. */
  currentBytes: number
  /** Peak additional bytes this publication writes, including atomic-replacement temporaries. */
  maxWriteBytes: number
  /** Local disk budget for the session's v2 namespace. */
  limitBytes: number
}

/**
 * Single storage-admission adapter point reserved for the quota owner. The default
 * implementation enforces the local history budget; the product additionally returns
 * a lease from its cross-Host quota owner.
 */
export interface NotebookStorageAdmission {
  /** Approve one bounded write, or reject it before any disk mutation. */
  admit(write: NotebookStorageWrite): void | NotebookStorageLease | Promise<void | NotebookStorageLease>
}

/** Quota release follows writer drainage and remeasurement, including failed-write residue. */
export interface NotebookStorageLease {
  /** Register the actual writer promise so owner shutdown waits for its filesystem work. */
  run<T>(work: () => Promise<T>): Promise<T>
  /** Settle after the writer stops; failure retains the reservation, never reverses a commit. */
  settle(): Promise<void>
}
