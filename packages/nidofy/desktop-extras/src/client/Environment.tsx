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
import { defaultPresentation } from './presentation.ts'
import type { CharacterPresentation, CompanionMode, DetailSurface } from './presentation.ts'

/** Replaceable single character renderer; animation visibility carries no Session ownership. */
export interface CompanionOwnerProps {
  /** Pause graphics and animation while hidden; dispose on unmount. */
  active: boolean
  /** Bounded facts from official owners, including admitted semantic commands. */
  view: CompanionView
  /** Optional display preferences; older character registrations may ignore them. */
  presentation?: CharacterPresentation
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
  const [drawer, setDrawer] = useState(false), [mode, setMode] = useState<CompanionMode>('assistant')
  const [detailState, setDetailState] = useState<{ scope: CompanionScope; detail: DetailSurface } | null>(null)
  const detail = detailState?.scope === scope ? detailState.detail : null
  const setDetail = (detail: DetailSurface | null) => { setDetailState(detail ? { scope, detail } : null) }
  const [notesOpen, setNotesOpen] = useState(false)
  const [presentation, setPresentation] = useState(defaultPresentation), [framing, setFraming] = useState<'none' | 'static' | 'animated'>('none')
  const [characterFailed, setCharacterFailed] = useState(false)
  const [operationBusy, setOperationBusy] = useState(false), [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)
  const [replaceFollow, setReplaceFollow] = useState(false)
  const panelRoot = useRef<HTMLDivElement>(null), menu = useRef<HTMLDetailsElement>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const panelId = useId()
  const [revision, refresh] = useState(0), [error, setError] = useState('')
  const [environment, setEnvironment] = useState<{ scope: CompanionScope; info: EnvironmentInfo; observedAt: number } | null>(null)
  const info = environment?.scope === scope ? environment.info : {}
  const observedAt = environment?.scope === scope ? environment.observedAt : null
  const [petTarget, setPetTarget] = useState('')
  const [petSettings, setPetSettings] = useState<Awaited<ReturnType<EnvironmentInjected['readPets']>> | null>(null)
  const [petBusy, setPetBusy] = useState(false), [petReceipt, setPetReceipt] = useState<object | null>(null)
  const [petReadFailed, setPetReadFailed] = useState(false)
  const [petRevision, refreshPets] = useState(0)
  const petsOpen = detail === 'pet-attention', hints = detail === 'progress', expanded = detail === 'environment'
  const needsPets = petsOpen || detail === 'quick-settings'
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
    setEnvironment(null); setError(''); setNotesOpen(false); setDetail(null)
    setPendingNavigation(null); setReplaceFollow(false); setOperationBusy(false)
    setPetSettings(null); setPetReceipt(null); setPetBusy(false); setPetReadFailed(false)
  }, [scope])
  useEffect(() => {
    if (!active || !needsPets || !view.connected || !sessionId) return
    const abort = new AbortController()
    setPetSettings(null); setPetReadFailed(false)
    void readPets(scope, abort.signal).then((settings) => {
      if (abort.signal.aborted || !current(scope)) return
      setPetSettings(settings)
      setPetTarget(previous => settings.instances.some(row => row.id === previous) ? previous : settings.instances[0]?.id ?? '')
    }).catch(() => { if (!abort.signal.aborted && current(scope)) { setPetReadFailed(true); setError('operationFailed') } })
    return () =>{  abort.abort() }
  }, [active, needsPets, view.connected, sessionId, scope, readPets, current, petRevision])
  useEffect(() => {
    const card = view.returnCard
    if (!active || !hints || !card || !current(scope)) return
    const key = `${scope.hostEpoch}:${scope.sessionId}:${card.hints.map(row => row.hintId).join(':')}`
    if (offered.current.has(key)) return
    offered.current.add(key)
    void offeredHints(scope).catch(() => { if (current(scope)) setError('hintPreferenceFailed') })
  }, [active, hints, view.returnCard, scope, current, offeredHints])
  useEffect(() => {
    if (!active || !expanded || !sessionId || !view.connected) return
    const abort = new AbortController()
    void readEnvironment(scope, abort.signal).then((value) => {
      if (!abort.signal.aborted && current(scope)) {
        setEnvironment({ scope, info: value as EnvironmentInfo, observedAt: Date.now() }); setError('')
      }
    }).catch((error: unknown) => {
      if (!abort.signal.aborted && current(scope)) { setError('unavailable'); console.warn('Environment request failed', error) }
    })
    return () => { abort.abort() }
  }, [active, expanded, sessionId, scope, revision, view.connected, readEnvironment, current])
  const act = (action: CompanionAction) => open(scope, action)
  const launch = (action: CompanionAction) => { void act(action).catch(() => { if (current(scope)) setError('operationFailed') }) }
  const navigate = (next: () => void) => {
    if (operationBusy || petBusy) setPendingNavigation(() => next)
    else next()
  }
  const showDetail = (next: DetailSurface) =>{  navigate(() => {
    detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (menu.current) menu.current.open = false
    setDetail(next)
  }) }
  const closeDetail = () =>{  navigate(() => { setDetail(null); detailTrigger.current?.focus() }) }
  useEffect(() => {
    if (!active || !hints || !sessionId || !view.connected) return
    void refreshFacts(scope).then(() => { if (current(scope)) setError('') })
      .catch(() => { if (current(scope)) setError('factsUnavailable') })
  }, [active, hints, sessionId, view.connected, scope, refreshFacts, current])
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
  const available = !!sessionId && view.connected
  const idle = available && view.state === 'idle'
  const titleKey = detail === 'environment' ? 'environment' : detail === 'progress' ? 'hints' : detail === 'pet-attention' ? 'petCoordination'
    : detail === 'side-analysis' ? 'sideAnalysis' : detail === 'quick-settings' ? 'naturalSettings' : detail === 'appearance' ? 'characterDisplay'
      : detail === 'attention' ? 'following' : 'statusDetails'
  const projectPath = info.workspace ?? view.facts?.cwd ?? ''
  const displayPresentation: CharacterPresentation = detail || notesOpen ? { ...presentation, frame: 'portrait' } : presentation
  const modes = ['assistant', 'project', 'tools'] as const
  const body = <div className="nidofy-body" ref={panelRoot} onKeyDown={(event) => {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return
    if (menu.current?.open) { event.preventDefault(); event.stopPropagation(); menu.current.open = false; menu.current.querySelector('summary')?.focus() }
    else if (detail) { event.preventDefault(); event.stopPropagation(); closeDetail() }
  }}>
    <section className="nidofy-companion" aria-label={t('companion')}>
      <header className="nidofy-panel-top"><div className="nidofy-mode-tabs" role="tablist" aria-label={t('panelModes')} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
        event.preventDefault(); buttons[next]?.focus()
      }}>{modes.map(item => <button key={item} id={`${panelId}-${item}`} role="tab" aria-selected={mode === item} aria-controls={`${panelId}-panel`}
          tabIndex={mode === item ? 0 : -1} onClick={() => {
            navigate(() => { setMode(item); setDetail(null) })
          }}>{t(item)}</button>)}</div>
      <details className="nidofy-panel-more" ref={menu}><summary aria-label={t('panelMore')}>⋯</summary><div>
        <button onClick={() => { showDetail('appearance') }}>{t('characterDisplay')}</button>
        <button disabled={!view.actions.includes('pets')} onClick={() => {
          if (menu.current) menu.current.open = false
          launch('pets')
        }}>{t('pets')}</button>
        <button onClick={() => { showDetail('status') }}>{t('statusDetails')}</button>
        <button onClick={() => { navigate(() => { setMode('assistant'); setDetail(null); setPresentation(previous => ({ ...defaultPresentation, animation: previous.animation })); if (menu.current) menu.current.open = false }) }}>{t('resetPanel')}</button>
      </div></details></header>
      <button className="nidofy-project-context" disabled={!available} onClick={() => { showDetail('environment') }} aria-label={t('viewEnvironment')}>
        <Icon kind="environment" /><span><strong>{projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? t(sessionId ? 'currentProject' : 'noSession')}</strong>
          <small>{observedAt ? `${info.vcs === 'none' ? t('noRepository') : info.branch ?? t('detachedHead')} · ${t('lastObserved')}` : t('environmentUnread')}</small></span><span aria-hidden="true">›</span></button>
      <div className="nidofy-status-strip"><p role="status"><span className="nidofy-status-dot" data-state={view.connected ? view.state : 'disconnected'} />
        <span>{t(!sessionId ? 'noSession' : !view.connected ? 'disconnected' : view.actions.includes('approval') ? 'needsApproval' : view.state)}</span>
        <button aria-label={t('statusDetails')} onClick={() => { showDetail('status') }}>ⓘ</button></p>
      {available && view.actions.includes('approval') && <button className="nidofy-pending-action" onClick={() => { launch('approval') }}>{t('approval')} <span aria-hidden="true">↗</span></button>}
      {available && view.state === 'waiting' && !view.actions.includes('approval') && <button className="nidofy-pending-action" disabled={!view.actions.includes('conversation')} onClick={() => { launch('conversation') }}>{t('returnConversation')}</button>}
      </div>
      <div className="nidofy-mode-panel" role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-${mode}`}>
        <div className="nidofy-stage-region" data-compact={detail !== null || notesOpen}>
          <section className="nidofy-stage" aria-label={t('characterStage')}>
            <header><small>{t(detail || notesOpen ? 'compactPreview' : 'characterStage')}</small>
              <button aria-label={t('characterDisplay')} onClick={() => { showDetail('appearance') }}>⚙</button></header>
            <div className="nidofy-character">{renderSlot('nidofy.companion', { active, view, act, presentation: displayPresentation }, {
              fallback: <CompanionPortrait active={active} t={t} presentation={displayPresentation}
                onCapability={setFraming} onFailure={setCharacterFailed} />,
            })}</div>
            <div className="nidofy-frame-tools">{(['full', 'half', 'portrait'] as const).map(frame => <button key={frame}
              aria-pressed={presentation.frame === frame}
              disabled={framing === 'none' || frame === 'full' && framing !== 'animated'} title={t(framing === 'none' ? 'framingUnsupported' : 'staticFrames')}
              onClick={() => { setPresentation(previous => ({ ...previous, frame })) }}>{t(frame)}</button>)}
            <button aria-label={t('resetFrame')} disabled={framing === 'none'} onClick={() => {
              setPresentation(previous => ({ ...defaultPresentation, animation: previous.animation }))
            }}>⟲</button></div>
          </section>
          {detail && <section className="nidofy-secondary" aria-label={t(titleKey)}><header><button onClick={closeDetail}>‹ {t('back')}</button><strong>{t(titleKey)}</strong></header>
            <div className="nidofy-secondary-body" key={`${scope.revision}-${detail}`}>
              {expanded && <><p className="nidofy-workspace">{projectPath || t(error ? 'unavailable' : 'loading')}</p>
                {observedAt && <p className="nidofy-observed">{t('lastObserved')} · <time dateTime={new Date(observedAt).toISOString()}>{new Date(observedAt).toLocaleTimeString(t('dateLocale'))}</time></p>}
                <EnvironmentExplorer info={info} scope={scope} workbench={workbench} t={t} launch={launch}
                  onBusyChange={setOperationBusy} refresh={() => { refresh(value => value + 1) }} /></>}
              {petsOpen && <section aria-label={t('petCoordination')}>
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
                {petReceipt && <div role="status"><p>{t('petConfirmed')}</p><details><summary>{t('technicalDetails')}</summary><pre>{JSON.stringify(petReceipt, null, 2)}</pre></details></div>}</div></section>}
              {active && detail === 'side-analysis' && idle && <SideAnalysis scope={scope} analysis={analysis} appendAnalysis={appendAnalysis}
                draft={draft} editDraft={(change) => { actions.edit(key, change) }} onBusyChange={setOperationBusy} t={t} />}
              {active && detail === 'quick-settings' && idle && <NaturalSettings scope={scope} pet={petTarget}
                previewSettings={previewSettings} executeSettings={executeSettings} readSettings={readSettings}
                textDraft={draft.settings} editText={(settings) => { actions.edit(key, { settings }) }}
                onBusyChange={setOperationBusy} expanded t={t} />}
              {hints && view.returnCard && <section className="nidofy-return-card" aria-label={t('returnCard')}><strong>{t('returnCard')}</strong>
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
              {detail === 'attention' && attention && <section className="nidofy-attention" aria-label={t('following')}><strong>{t('following')}</strong>
                <p>{attention.scope.sessionId}</p><p role="status">{t(attention.state)}</p>
                <button disabled={!attention.connected} onClick={() => {
                  try { openAttention(attention.scope) } catch { if (current(scope)) setError('operationFailed') }
                }}>{t('returnConversation')}</button>
                <button onClick={releaseAttention}>{t('unfollow')}</button></section>}
              {detail === 'status' && <div className="nidofy-detail"><p>{t(view.model === 'known' ? 'modelKnown' : 'modelUnknown')}</p>
                <p>{t(view.notebook === 'available' ? 'notesAvailable' : view.notebook === 'disabled' ? 'notesDisabled' : 'notesUnavailable')}</p>
                <dl><dt>{t('settingsConversation')}</dt><dd>{sessionId ?? t('noSession')}</dd><dt>{t('hostConnection')}</dt><dd>{t(view.connected ? 'hostConnected' : 'disconnected')}</dd></dl>
                {!view.connected && <p>{t('pendingUnknown')}</p>}</div>}
              {detail === 'appearance' && <div className="nidofy-detail nidofy-appearance"><p>{t(framing === 'none' ? 'framingUnsupported' : framing === 'animated' ? 'animatedFrames' : 'staticFrames')}</p>
                {characterFailed && <p role="status">{t('live2dUnavailable')}</p>}
                <button disabled={framing === 'none'} aria-pressed={presentation.animation} onClick={() => { setPresentation(previous => ({ ...previous, animation: !previous.animation })) }}>{t(presentation.animation ? 'live2dDisable' : 'live2dEnable')}</button>
                <label>{t('characterZoom')}<input type="range" min={1} max={1.5} step={0.05} value={presentation.zoom} disabled={framing === 'none'} onChange={(event) => { setPresentation(previous => ({ ...previous, zoom: Number(event.target.value) })) }} /></label>
                {(['panX', 'panY'] as const).map(axis => <label key={axis}>{t(axis)}<input type="range" min={-0.15} max={0.15} step={0.01} value={presentation[axis]} disabled={framing === 'none'} onChange={(event) => { setPresentation(previous => ({ ...previous, [axis]: Number(event.target.value) })) }} /></label>)}
                <button onClick={() => { setPresentation(previous => ({ ...defaultPresentation, animation: previous.animation })) }}>{t('resetFrame')}</button>
              </div>}
            </div></section>}
        </div>
        {!detail && <div className="nidofy-mode-actions">
          {mode === 'assistant' && <><div className="nidofy-primary-actions"><button disabled={!available || view.notebook !== 'available'} onClick={() => { setNotesOpen(true) }}>{t('workingNotes')}</button>
            <button disabled={!available} onClick={() => { showDetail('progress') }}>{t('hints')}</button></div>
          <div className="nidofy-secondary-actions"><button disabled={!available} onClick={() => {
            if (!current(scope)) return
            if (attention && attention.scope.sessionId !== sessionId) setReplaceFollow(true)
            else follow(scope)
          }}>{t(attention?.scope.sessionId === sessionId && sessionId ? 'following' : 'follow')}</button><button disabled={!available} onClick={() => { showDetail('pet-attention') }}>{t('petCoordination')} ›</button></div>
          {attention && <button className="nidofy-follow-summary" onClick={() => { showDetail('attention') }}>{t('following')} · {attention.scope.sessionId} · {t(attention.state)}</button>}
          </>}
          {mode === 'project' && <div className="nidofy-primary-actions">{(['environment', 'builds', 'artifacts', 'protection'] as const).map(action => <button key={action} disabled={!view.actions.includes(action)} onClick={() => { if (action === 'environment') showDetail('environment'); else launch(action) }}><Icon kind={action} />{t(action)}</button>)}</div>}
          {mode === 'tools' && <div className="nidofy-tool-rows"><button disabled={!view.actions.includes('connections')} onClick={() => { launch('connections') }}>{t('connections')} <span aria-hidden="true">›</span></button>
            <button disabled={!idle} onClick={() => { showDetail('side-analysis') }}>{t('sideAnalysis')} <small>{t('separateUsage')}</small><span aria-hidden="true">›</span></button>
            <button disabled={!idle} onClick={() => { showDetail('quick-settings') }}>{t('naturalSettings')} <small>{t('localMatching')}</small><span aria-hidden="true">›</span></button></div>}
          {view.returnCard && <button className="nidofy-return-summary" onClick={() => { showDetail('progress') }}>{t('returnCard')} · {t('viewProgress')} ›</button>}
        </div>}
      </div>
      {available && view.notebook === 'available' && <Modal open={notesOpen} onClose={() => { setNotesOpen(false) }} title={t('notebook')} closeLabel={t('closeDetails')} className="nidofy-notebook-modal"><div className="nidofy-notebook-host">{renderSlot('nidofy.notebook', { sessionId: sessionId, scope, open: notesOpen, onOpenChange: setNotesOpen })}</div></Modal>}
    </section>
    <Modal open={pendingNavigation !== null} onClose={() => { setPendingNavigation(null) }} title={t('operationInProgress')} closeLabel={t('keepViewing')}>
      <p>{t(detail === 'side-analysis' ? 'analysisCloseMeaning' : 'operationCloseMeaning')}</p><div className="nidofy-inline-actions">
        <button data-modal-autofocus onClick={() => { setPendingNavigation(null) }}>{t('keepViewing')}</button><button onClick={() => { const next = pendingNavigation; setPendingNavigation(null); next?.() }}>{t('cancelWaitingClose')}</button></div></Modal>
    <Modal open={replaceFollow} onClose={() => { setReplaceFollow(false) }} title={t('replaceFollowing')} closeLabel={t('keepFollowing')}>
      <p>{t('replaceFollowingMeaning', { session: attention?.scope.sessionId ?? '' })}</p><div className="nidofy-inline-actions"><button data-modal-autofocus onClick={() => { setReplaceFollow(false) }}>{t('keepFollowing')}</button>
        <button onClick={() => { if (current(scope)) follow(scope); setReplaceFollow(false) }}>{t('follow')}</button></div></Modal>
    {error && <p className="nidofy-error" role="status">{t(error === 'operationFailed' ? 'operationFailed'
      : error === 'factsUnavailable' ? 'factsUnavailable' : error === 'hintPreferenceFailed' ? 'hintPreferenceFailed' : 'unavailable')}</p>}
  </div>
  return <><style>{appearanceCss}</style><span className="nidofy-width-probe" ref={probe} aria-hidden="true" />
    {wide ? <aside className="nidofy-dock" aria-label={t('features')} data-active={active}>{body}</aside>
      : <><button className="nidofy-drawer-trigger" aria-label={t('openCompanion')} aria-haspopup="dialog" aria-expanded={drawer}
        onClick={() => { setDrawer(true) }}><img src="/api/nidofy-extras/assets/companion/bluewhale/avatar.png" alt="" /><span>{t('companion')}</span></button>
      <Modal open={drawer} onClose={() => { navigate(() => { setDetail(null); setDrawer(false) }) }} title={t('companion')} closeLabel={t('closeCompanion')}
        className="nidofy-drawer" contentClassName="nidofy-drawer-content">{body}</Modal></>}
  </>
}
