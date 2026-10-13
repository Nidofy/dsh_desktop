/** Responsive Desktop companion using one independent scope owner. */
import { useEffect, useId, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsLocale, PropsRenderSlots, PropsStore, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { CompanionScope, CompanionView, CompanionAction } from './companion.ts'
import type { EnvironmentInjected } from './index.ts'
import { EnvironmentExplorer } from './EnvironmentExplorer.tsx'
import { SideAnalysis } from './SideAnalysis.tsx'
import { NaturalSettings } from './NaturalSettings.tsx'
import { CompanionPortrait } from './CompanionPortrait.tsx'
import { Icon } from './EnvironmentIcon.tsx'
import type { en } from './locales.ts'
import { appearanceCss } from './appearance.ts'
import type { Hint } from './hints.ts'
import { draftKey, emptyDraft } from './drafts.ts'
import type { createCompanionDraftStore } from './drafts.ts'

/** Replaceable single character renderer; animation visibility carries no Session ownership. */
export interface CompanionOwnerProps {
  /** Pause graphics and animation while hidden; dispose on unmount. */
  active: boolean
  /** Bounded facts from official owners, including admitted semantic commands. */
  view: CompanionView
  /** Delegate a local-user semantic command through the full current scope.
   * @param action - An admitted command from view.actions.
   * @returns Existing owner's navigation completion.
   */
  act(action: CompanionAction): Promise<void>
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'nidofy.environment': keyof typeof en }
  interface SlotMap {
    /** Explicitly opened Notebook; scope invalidation unmounts its old operation surface. */
    'nidofy.notebook': {
      kind: 'single'
      scope: 'root'
      owner: {
        sessionId: string
        scope: CompanionScope
        open: boolean
        onOpenChange: (open: boolean) => void
      }
    }
    /** Register one root renderer without a key. Absence retains the static portrait.
     * Receives active/view/act; never independently registers model data or acquires a Session.
     */
    'nidofy.companion': { kind: 'single'; scope: 'root'; owner: CompanionOwnerProps }
  }
}
export interface EnvironmentInfo {
  workspace?: string
  root?: string
  head?: string | null
  branch?: string | null
  upstream?: string | null
  branches?: string[]
  remotes?: string[]
  canWrite?: boolean
  vcs?: string
  diff?: { added: number; deleted: number } | null
}
/** Wide rail and narrow modal consume the same facts without mutating the Conversation composer. */
export function Environment({ useCompanion, useAttention, readEnvironment, workbench, open, follow,
  releaseAttention, openAttention, refreshFacts, preferHints, offeredHints, current, coordinatePet, readPets,
  analysis, appendAnalysis, previewSettings, executeSettings, readSettings, usePanelInfo, useStore, actions, renderSlot, t }:
  PropsRuntime<'shell.accessory'> & PropsRenderSlots<'nidofy.companion' | 'nidofy.notebook'>
  & PropsLocale<'nidofy.environment'> & InjectFace<EnvironmentInjected> & PropsStore<ReturnType<typeof createCompanionDraftStore>>,
) {
  const panel = usePanelInfo(s => s.activePanelId)
  const view = useCompanion(value => value), attention = useAttention(value => value)
  const scope = view.scope, sessionId = scope.sessionId ?? undefined
  const key = draftKey(scope), draft = useStore(state => state.drafts[key] ?? emptyDraft)
  const petInputId = useId()
  const probe = useRef<HTMLSpanElement>(null)
  const offered = useRef(new Set<string>())
  const [wide, setWide] = useState(false), [visible, setVisible] = useState(!document.hidden)
  const [drawer, setDrawer] = useState(false), [expanded, setExpanded] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false), [hints, setHints] = useState(false)
  const [revision, refresh] = useState(0), [info, setInfo] = useState<EnvironmentInfo>({}), [error, setError] = useState('')
  const [petTarget, setPetTarget] = useState('1')
  const [petSettings, setPetSettings] = useState<Awaited<ReturnType<EnvironmentInjected['readPets']>> | null>(null)
  const [petBusy, setPetBusy] = useState(false), [petReceipt, setPetReceipt] = useState<object | null>(null)
  const [petReadFailed, setPetReadFailed] = useState(false)
  const [petsOpen, setPetsOpen] = useState(false), [petRevision, refreshPets] = useState(0)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const active = visible && panel === null && (wide || drawer)
  useEffect(() => {
    const element = probe.current
    if (!element) return
    // Measures this accessory's geometry, never business identity or another view.
    const measure = () => { setWide(element.getBoundingClientRect().width > 0) }
    const visibility = () => { setVisible(!document.hidden) }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    document.addEventListener('visibilitychange', visibility)
    measure()
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [panel])
  useEffect(() => { if (wide) setDrawer(false) }, [wide])
  useEffect(() => {
    setInfo({}); setError(''); setNotesOpen(false); setHints(false); setAnalysisOpen(false)
    setPetSettings(null); setPetReceipt(null); setPetBusy(false); setPetReadFailed(false)
  }, [scope])
  useEffect(() => {
    if (!active || !petsOpen || !view.connected || !sessionId) return
    const abort = new AbortController()
    setPetSettings(null); setPetReadFailed(false)
    void readPets(scope, abort.signal).then((settings) => {
      if (abort.signal.aborted || !current(scope)) return
      setPetSettings(settings)
      setPetTarget(previous => settings.instances.some(row => row.id === previous) ? previous : settings.instances[0]?.id ?? '')
    }).catch(() => { if (!abort.signal.aborted && current(scope)) { setPetReadFailed(true); setError('operationFailed') } })
    return () =>{  abort.abort() }
  }, [active, petsOpen, view.connected, sessionId, scope, readPets, current, petRevision])
  useEffect(() => {
    const card = view.returnCard
    if (!active || !card || !current(scope)) return
    const key = card.hints.map(row => row.hintId).join(':')
    if (offered.current.has(key)) return
    offered.current.add(key)
    void offeredHints(scope).catch(() => { if (current(scope)) setError('hintPreferenceFailed') })
  }, [active, view.returnCard, scope, current, offeredHints])
  useEffect(() => {
    if (!active || !expanded || !sessionId || !view.connected) return
    const abort = new AbortController()
    void readEnvironment(scope, abort.signal).then((value) => {
      if (!abort.signal.aborted && current(scope)) { setInfo(value as EnvironmentInfo); setError('') }
    }).catch((error: unknown) => {
      if (!abort.signal.aborted && current(scope)) { setError('unavailable'); console.warn('Environment request failed', error) }
    })
    return () => { abort.abort() }
  }, [active, expanded, sessionId, scope, revision, view.connected, readEnvironment, current])
  const act = (action: CompanionAction) => open(scope, action)
  const launch = (action: CompanionAction) => { void act(action).catch(() => { if (current(scope)) setError('operationFailed') }) }
  const showHints = () => {
    setHints(!hints)
    if (!hints && sessionId && view.connected) void refreshFacts(scope).then(() => { if (current(scope)) setError('') })
      .catch(() => { if (current(scope)) setError('factsUnavailable') })
  }
  const prefer = (action: 'ignore' | 'snooze' | 'mute' | 'unmute' | 'reset', hint?: Hint) => {
    void preferHints(scope, action, hint?.hintId, action === 'snooze' ? Date.now() + 15 * 60 * 1000 : undefined)
      .then(() => { if (current(scope)) setError('') })
      .catch(() => { if (current(scope)) setError('hintPreferenceFailed') })
  }
  const hintRows = (rows: readonly Hint[]) => rows.map(hint => <article key={hint.hintId}>
    <p>{t(`hint${hint.kind}`)}</p>{hint.source.text && <p>{hint.source.text}</p>}
    <p>{t('hintBasis', { source: hint.source.ids.join(', ') })}</p>
    <div className="nidofy-inline-actions">{hint.actions.map(action => <button key={action} onClick={() => {
      if (!current(scope) || !view.hints.some(row => row.hintId === hint.hintId)) return
      if (action === 'notebook') setNotesOpen(true)
      else launch(action)
    }}>{t(action === 'conversation' ? 'returnConversation' : action)}</button>)}
    <button onClick={() => { prefer('ignore', hint) }}>{t('ignoreHint')}</button>
    <button onClick={() => { prefer('snooze', hint) }}>{t('snoozeHint')}</button></div>
  </article>)
  const selectedPet = petSettings?.instances.find(row => row.id === petTarget)
  const body = <div className="nidofy-body">
    <section className="nidofy-environment" aria-label={t('environment')}>
      <header><button className="nidofy-collapse" aria-expanded={expanded} aria-controls="nidofy-environment-body"
        onClick={() => { setExpanded(!expanded) }}><Icon kind="environment" /><span>{t('environment')}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button></header>
      {expanded && <div id="nidofy-environment-body"><p className="nidofy-workspace" title={info.workspace}>
        {info.workspace?.split(/[\\/]/).filter(Boolean).at(-1) ?? t(sessionId && view.connected && !error ? 'loading' : 'empty')}</p>
      <EnvironmentExplorer key={scope.revision} info={info} scope={scope} workbench={workbench} t={t} launch={launch}
        refresh={() => { refresh(value => value + 1) }} /></div>}
    </section>
    <section className="nidofy-companion" aria-label={t('companion')}>
      <div className="nidofy-companion-caption"><strong>{t('companion')}</strong><p role="status">{t(view.state)}</p>
        <p>{t(view.model === 'known' ? 'modelKnown' : 'modelUnknown')}</p>
        <p>{t(view.notebook === 'available' ? 'notesAvailable' : view.notebook === 'disabled' ? 'notesDisabled' : 'notesUnavailable')}</p>
      </div>
      <nav aria-label={t('features')}>{(['approval', 'builds', 'pets', 'artifacts', 'protection', 'environment', 'connections'] as const).map(key => <button key={key}
        disabled={!view.actions.includes(key)} onClick={() => { launch(key) }}>{key !== 'approval' && <Icon kind={key} />}<span>{t(key)}</span></button>)}</nav>
      <div className="nidofy-companion-controls">
        {sessionId && view.connected && view.notebook === 'available' && renderSlot('nidofy.notebook', {
          sessionId, scope, open: notesOpen, onOpenChange: setNotesOpen,
        })}
        <div className="nidofy-inline-actions nidofy-follow-actions"><button disabled={!sessionId || !view.connected} onClick={() => { if (current(scope)) follow(scope) }}>{t('follow')}</button>
          <button aria-expanded={hints} disabled={!sessionId || !view.connected} onClick={showHints}>{t('hints')}</button></div>
        <details className="nidofy-control-fold" onToggle={(event) => { setPetsOpen(event.currentTarget.open) }}><summary>{t('petCoordination')}</summary>
          <div className="nidofy-detail nidofy-pet-settings"><label htmlFor={petInputId}>{t('petTarget')}</label><select id={petInputId}
            value={petTarget} disabled={petBusy || !petSettings}
            onChange={(event) => { setPetTarget(event.target.value); setPetReceipt(null) }}>
            {petSettings?.instances.map(row => <option key={row.id} value={row.id}>{row.id}{row.pinned ? ` · ${row.pinned}` : ''}</option>)}
          </select><button disabled={petBusy || !sessionId || !view.connected} onClick={() => {
            setPetSettings(null); setPetReadFailed(false); setPetReceipt(null); refreshPets(value => value + 1)
          }}>{t('petRefresh')}</button>
          {!petSettings && <p role="status">{t(petReadFailed || !view.connected || !sessionId ? 'petReadUnavailable' : 'loading')}</p>}
          {petSettings && !petSettings.enabled && <p>{t('petsDisabled')}</p>}
          {selectedPet && <><p>{t('petObserved')}</p><dl className="nidofy-pet-state" aria-label={t('petObservedLabel')}>
            <dt>{t('petInstanceState')}</dt><dd>{t(selectedPet.enabled ? 'petInstanceEnabled' : 'petInstanceDisabled')}</dd>
            <dt>{t('petBoundSession')}</dt><dd>{selectedPet.pinned ?? t('petUnbound')}</dd>
            <dt>{t('petBubbleState')}</dt><dd>{t(selectedPet.quiet ? 'petBubblesMuted' : 'petBubblesEnabled')}</dd>
          </dl></>}
          <div className="nidofy-inline-actions">
            {(['bind', 'unbind', 'mute', 'unmute', 'interact'] as const).map(action => <button key={action}
              disabled={petBusy || !sessionId || !view.connected || !petSettings?.enabled
              || !petSettings.instances.some(row => row.id === petTarget && row.enabled)} onClick={() => {
                setPetBusy(true); setPetReceipt(null)
                void coordinatePet(scope, action, petTarget).then((receipt) => {
                  if (current(scope)) { setPetReceipt({ target: petTarget, result: receipt }); refreshPets(value => value + 1) }
                }).catch(() => { if (current(scope)) setError('operationFailed') }).finally(() => { if (current(scope)) setPetBusy(false) })
              }}>{t(`pet${action}`)}</button>)}</div><p>{t('petSessionMeaning')}</p>
          {petReceipt && <div role="status"><p>{t('petConfirmed')}</p><details><summary>{t('technicalDetails')}</summary><pre>{JSON.stringify(petReceipt, null, 2)}</pre></details></div>}</div></details>
        <button className="nidofy-control-row" aria-expanded={analysisOpen} disabled={!sessionId || !view.connected || view.state !== 'idle'} onClick={() => { setAnalysisOpen(!analysisOpen) }}>{t('sideAnalysis')}</button>
        {active && analysisOpen && view.state === 'idle' && <SideAnalysis key={scope.revision} scope={scope} analysis={analysis} appendAnalysis={appendAnalysis}
          draft={draft} editDraft={(change) => { actions.edit(key, change) }} t={t} />}
        {active && sessionId && view.connected && view.state === 'idle' && <NaturalSettings key={`settings-${scope.revision}`} scope={scope} pet={petTarget} previewSettings={previewSettings} executeSettings={executeSettings} readSettings={readSettings}
          textDraft={draft.settings} editText={(settings) => { actions.edit(key, { settings }) }} t={t} />}
        {view.returnCard && <section className="nidofy-hints" aria-label={t('returnCard')}><strong>{t('returnCard')}</strong>
          {hintRows(view.returnCard.hints)}</section>}
        {hints && <section className="nidofy-hints" aria-label={t('hints')}><p>{t('noticeCount', { count: view.noticeIds.length })}</p>
          {hintRows(view.hints)}
          {view.hintPreferences && <div className="nidofy-inline-actions">
            {view.facts?.project && <button onClick={() => { prefer(view.hintPreferences?.muted.some(row =>
              row.workspaceId === view.facts?.project?.workspaceId && row.path === view.facts.project.path) ? 'unmute' : 'mute') }}>
              {t(view.hintPreferences.muted.some(row => row.workspaceId === view.facts?.project?.workspaceId
              && row.path === view.facts.project.path) ? 'unmuteProjectHints' : 'muteProjectHints')}</button>}
            <button onClick={() => { prefer('reset') }}>{t('resetHintPreferences')}</button></div>}
          <p>{t(view.receiptId === null ? 'noReceipt' : 'receiptAvailable')}</p><p>{t('completionMeaning')}</p>
          {view.facts?.notices.filter(fact => fact.delivery.visibleToCompanion).map(fact => <div key={fact.id}>
            <p>{t('factSource', { source: t(fact.source === 'current' ? 'sourceCurrent' : fact.source === 'historical' ? 'sourceHistorical' : 'sourceUnavailable'), id: fact.sourceId })}</p>
            {fact.receipt && <p>{t('receiptFacts', { tests: t(`tests${fact.receipt.tests}`),
              freshness: t(`freshness${fact.receipt.freshness}`), acceptance: t(`acceptance${fact.receipt.acceptance}`) })}</p>}
            <p>{t(fact.delivery.handled ? 'noticeHandled' : 'noticeUnhandled')}</p>
          </div>)}
          {view.facts?.notebook.value && <div><p>{t('committedNotes', { revision: view.facts.notebook.value.revision })}</p>
            {view.facts.notebook.value.active.map(note => <p key={note.id}>{note.text}</p>)}</div>}
        </section>}
        {attention && <section className="nidofy-attention" aria-label={t('following')}><strong>{t('following')}</strong>
          <p>{attention.scope.sessionId}</p><p role="status">{t(attention.state)}</p>
          <button disabled={!attention.connected} onClick={() => {
            try { openAttention(attention.scope) } catch { if (current(scope)) setError('operationFailed') }
          }}>{t('returnConversation')}</button>
          <button onClick={releaseAttention}>{t('unfollow')}</button></section>}
      </div>
      <div className="nidofy-character">{renderSlot('nidofy.companion', { active, view, act }, {
        fallback: <CompanionPortrait active={active} t={t} />,
      })}</div>
    </section>
    {error && <p className="nidofy-error" role="status">{t(error === 'operationFailed' ? 'operationFailed'
      : error === 'factsUnavailable' ? 'factsUnavailable' : error === 'hintPreferenceFailed' ? 'hintPreferenceFailed' : 'unavailable')}</p>}
  </div>
  return <><style>{appearanceCss}</style><span className="nidofy-width-probe" ref={probe} aria-hidden="true" />
    {wide ? <aside className="nidofy-dock" aria-label={t('features')} data-active={active}>{body}</aside>
      : <><button className="nidofy-drawer-trigger" aria-label={t('openCompanion')} aria-haspopup="dialog" aria-expanded={drawer}
        onClick={() => { setDrawer(true) }}><img src="/api/nidofy-extras/assets/companion/bluewhale/avatar.png" alt="" /><span>{t('companion')}</span></button>
      <Modal open={drawer} onClose={() => { setDrawer(false) }} title={t('companion')} closeLabel={t('closeCompanion')}
        className="nidofy-drawer">{body}</Modal></>}
  </>
}
