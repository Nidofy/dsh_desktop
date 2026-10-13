/** Unsaved text belongs to the selected conversation, independently of panel visibility. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { CompanionScope } from './companion.ts'

export interface CompanionDraft { settings: string; analysis: string; connection: string; tokens: number }
type State = { drafts: Record<string, CompanionDraft> }
type Actions = { edit(state: State, key: string, change: Partial<CompanionDraft>): void }
export const emptyDraft: CompanionDraft = { settings: '', analysis: '', connection: '', tokens: 512 }
/** Layout revisions invalidate operations, never the user's unsubmitted input. */
export function draftKey(scope: CompanionScope): string {
  return JSON.stringify([scope.hostEpoch, scope.workspaceId, scope.sessionId])
}
/** In-memory only: no unsent text is written to storage or a Session log. */
export function createCompanionDraftStore(): EngineStoreHandle<State, Actions> {
  return defineStore({ init: (): State => ({ drafts: {} }), actions: {
    edit: (state, key: string, change: Partial<CompanionDraft>) => {
      state.drafts[key] = { ...emptyDraft, ...state.drafts[key], ...change }
    },
  } })
}
