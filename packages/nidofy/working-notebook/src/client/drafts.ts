/** Notebook editing state is local viewing state, shared across the rail and Settings. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { Note } from '@nidofy/dsh-desktop-extras/notebook-types'
export interface NotebookDraft {
  query: string
  searchScope: string
  selected?: Note | undefined
  text: string
  kind: Note['kind']
  source: string
  quote: string
  pinned: boolean
}
export const emptyDraft: NotebookDraft = { query: '', searchScope: 'session', text: '', kind: 'constraint', source: '', quote: '', pinned: true }
type State = { drafts: Record<string, NotebookDraft> }
type Actions = { edit(state: State, session: string, change: Partial<NotebookDraft>): void }
/** No notes or drafts are persisted automatically; only explicit Save writes to the owner. */
export function createNotebookDraftStore(): EngineStoreHandle<State, Actions> {
  return defineStore({ init: (): State => ({ drafts: {} }), actions: {
    edit: (state, session: string, change: Partial<NotebookDraft>) => {
      state.drafts[session] = { ...emptyDraft, ...state.drafts[session], ...change }
    },
  } })
}
