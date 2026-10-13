/** Independent notebook settings and an optional contribution to the desktop environment rail. */
import type { Context } from '@deepseek-ai/cordis'
import { useMemo } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime, PropsStore, InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@nidofy/dsh-desktop-extras/client'
import type { Companion, CompanionView } from '@nidofy/dsh-desktop-extras/client'
import { NotebookPanel } from './NotebookPanel.tsx'
import type { NotebookHistorySource } from './NotebookPanel.tsx'
import type { CompanionScope } from '@nidofy/dsh-desktop-extras/client'
import { Enhancement } from './Enhancement.tsx'
import { en, zh } from './locales.ts'
import { notebookCss } from './style.ts'
import { createNotebookDraftStore, emptyDraft } from './drafts.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'nidofy.notebook': keyof typeof en }
}
interface NotebookInjected {
  readonly hooks: { readonly companion: HostObservable<CompanionView>; readonly generation: ConnectionHandle['generation'] }
  using: Companion['using']
  refreshFacts(scope: CompanionScope): void
  citeSource(scope: CompanionScope, source: NotebookHistorySource): void
}
type DraftProps = PropsStore<ReturnType<typeof createNotebookDraftStore>>
function Rail({ sessionId, scope, open, onOpenChange, using, citeSource, refreshFacts, useGeneration, useStore, actions, t }: PropsRuntime<'nidofy.notebook'> & InjectFace<NotebookInjected> & PropsLocale<'nidofy.notebook'> & DraftProps) {
  const generation = useGeneration(value => value)
  const key = JSON.stringify([generation?.id, sessionId])
  const draft = useStore(state => state.drafts[key] ?? emptyDraft)
  return <div className="nidofy-notebook-surface"><button className="nidofy-row" aria-expanded={open} onClick={() => { onOpenChange(!open) }}><span>{t('notebook')}</span></button>{open && <NotebookPanel key={scope.revision} sessionId={sessionId} scope={scope} using={using} citeSource={citeSource} refreshFacts={refreshFacts} draft={draft} editDraft={(change) => { actions.edit(key, change) }} t={t} />}</div>
}
interface SettingsInjected {
  hooks: { generation: ConnectionHandle['generation'] }
  using: Companion['using']
  citeSource: NotebookInjected['citeSource']
  refreshFacts: NotebookInjected['refreshFacts']
}
function Settings({ useMainSelection, useGeneration, using, citeSource, refreshFacts, useStore, actions, t }: PropsRuntime<'settings.section'> & PropsLocale<'nidofy.notebook'> & InjectFace<SettingsInjected> & DraftProps) {
  const selection = useMainSelection(value => value), generation = useGeneration(value => value)
  const sessionId = selection.sessionId
  // Standalone notes use their own selected-session lifetime; no Companion facts
  // or action capabilities are fabricated when the optional plugin is absent.
  const scope = useMemo<CompanionScope>(() => ({ sessionId, revision: selection.revision, hostEpoch: null,
    windowId: null, viewId: null, panelId: null, workspaceId: null, turn: null }), [sessionId, selection.revision, generation])
  const key = JSON.stringify([generation?.id, sessionId])
  const draft = useStore(state => state.drafts[key] ?? emptyDraft)
  return <section className="nidofy-notebook-surface">{sessionId && generation ? <NotebookPanel key={`${sessionId}:${selection.revision}:${generation.id}`} sessionId={sessionId} scope={scope} using={using} citeSource={citeSource} refreshFacts={refreshFacts} draft={draft} editDraft={(change) => { actions.edit(key, change) }} t={t} /> : <><h2>{t('notebook')}</h2><Enhancement t={t} /><p>{t('chooseConversation')}</p></>}</section>
}
export const name = 'nidofy-working-notebook-client'
export const inject = ['slots', 'locale', 'uiWorkspace', 'uiSession', 'conversation', 'connection']
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const store = createNotebookDraftStore()
  ctx.effect(() => ctx.locale.register('nidofy.notebook', { en, zh }))
  const t = ctx.locale.bind('nidofy.notebook')
  const injected = (companion: Companion): (() => NotebookInjected) => () => ({
    hooks: { companion: companion.view, generation: connection.generation },
    using: (scope, operation, signal) => companion.using(scope, operation, signal),
    refreshFacts: (scope) => {
      if (!companion.current(scope)) return
      void companion.refresh(scope).catch((error: unknown) => {
        if (companion.current(scope)) console.warn('Companion notes evidence unavailable', error)
      })
    },
    citeSource: (scope, source) => {
      const binding = ctx.uiSession.mainBinding.getSnapshot()
      if (!companion.current(scope) || !binding || binding.sessionId !== scope.sessionId) throw Error('COMPANION_SCOPE_CHANGED')
      const input = ctx.conversation.input.for(binding.ctx), revision = input.state.getSnapshot().draftRev
      const text = t('referenceHeader') + ' ' + source.sessionId + ' @' + source.generation + ' #' + String(source.seq)
        + '\n' + source.text.split('\n').map(line => '> ' + line).join('\n')
      if (!input.appendText(text, revision)) throw Error('NOTEBOOK_DRAFT_APPEND_REFUSED')
    } })
  ctx.inject(['companion'], (ctx) => {
    ctx.slots.inject('nidofy.notebook', () => ctx.slots.register({ name: 'nidofy.notebook', locale: 'nidofy.notebook', store, inject: injected(ctx.companion) }, Rail))
  })
  const independent = (): SettingsInjected => ({ hooks: { generation: connection.generation },
    refreshFacts: (scope) => {
      const companion = ctx.get('companion')
      const current = companion?.view.getSnapshot().scope
      if (companion && current && current.sessionId === scope.sessionId) injected(companion)().refreshFacts(current)
    },
    using: async (scope, operation, signal) => {
      const binding = ctx.uiSession.mainBinding.getSnapshot(), generation = connection.generation.getSnapshot()
      const current = () => binding && generation && binding.sessionId === scope.sessionId
        && ctx.uiSession.mainBinding.getSnapshot() === binding && connection.generation.getSnapshot() === generation
        && ctx.uiSession.mainSelection.getSnapshot().revision === scope.revision
      if (!current()) throw Error('NOTEBOOK_SCOPE_CHANGED')
      const lifetime = new AbortController(), check = () => { if (!current()) lifetime.abort() }
      const offBinding = ctx.uiSession.mainBinding.subscribe(check), offGeneration = connection.generation.subscribe(check)
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
      try { combined.throwIfAborted(); const value = await operation(combined); combined.throwIfAborted()
        if (!current()) throw Error('NOTEBOOK_SCOPE_CHANGED')
        return value
      } finally { offBinding(); offGeneration() }
    },
    citeSource: (scope, source) => {
      const binding = ctx.uiSession.mainBinding.getSnapshot()
      if (!connection.generation.getSnapshot() || !binding || binding.sessionId !== scope.sessionId
        || ctx.uiSession.mainSelection.getSnapshot().revision !== scope.revision) throw Error('NOTEBOOK_SCOPE_CHANGED')
      const input = ctx.conversation.input.for(binding.ctx), revision = input.state.getSnapshot().draftRev
      const text = t('referenceHeader') + ' ' + source.sessionId + ' @' + source.generation + ' #' + String(source.seq)
        + '\n' + source.text.split('\n').map(line => '> ' + line).join('\n')
      if (!input.appendText(text, revision)) throw Error('NOTEBOOK_DRAFT_APPEND_REFUSED')
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'nidofy-notebook', order: 45, label: () => t('notebook'), locale: 'nidofy.notebook', store, inject: independent }, Settings))
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = notebookCss; document.head.append(style)
    return () => { style.remove() }
  })
}
