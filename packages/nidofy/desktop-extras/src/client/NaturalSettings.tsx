/** Finite local language controls retain explicit previews and show only actual owner receipts. */
import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionScope } from './companion.ts'
import type { EnvironmentInjected } from './index.ts'
import type { SettingsAction, SettingsPreview, SettingsReceipt, SettingsSnapshot } from './natural-settings.ts'
import { parseSettingsIntent, settingsActions, settingsTargetsPet } from './natural-settings.ts'
/** @param props - Current scope, selected instance and original owner delegates.
 * @returns Explicit preview/receipt UI; cancellation withdraws waiting but cannot undo an owner's committed action.
 */
export function NaturalSettings({ scope, pet, previewSettings, executeSettings, readSettings,
  textDraft, editText, onBusyChange, expanded, t }: {
  scope: CompanionScope
  pet: string
  previewSettings: EnvironmentInjected['previewSettings']
  executeSettings: EnvironmentInjected['executeSettings']
  readSettings: EnvironmentInjected['readSettings']
  textDraft?: string
  editText?: (text: string) => void
  onBusyChange?: (busy: boolean) => void
  expanded?: boolean
  t: PropsLocale<'nidofy.environment'>['t']
}) {
  const choicesId = useId()
  const [localText, setLocalText] = useState(''), [plan, setPlan] = useState<SettingsPreview | null>(null)
  const text = textDraft ?? localText, setText = editText ?? setLocalText
  const [receipt, setReceipt] = useState<SettingsReceipt | null>(null)
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [cancelled, setCancelled] = useState(false)
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [expired, setExpired] = useState(false)
  useEffect(() => { onBusyChange?.(busy); return () => { onBusyChange?.(false) } }, [busy, onBusyChange])
  const lifetime = useRef(new AbortController()), operation = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    operation.current = null; setSnapshot(null); setReadFailed(false); setBusy(false)
    setPlan(null); setReceipt(null); setFailed(false); setCancelled(false)
    return () => { controller.abort(); operation.current?.abort() }
  }, [scope, pet])
  useEffect(() => {
    setExpired(plan !== null && plan.expiresAt <= Date.now())
    if (!plan) return
    const timeout = window.setTimeout(() => { setExpired(true) }, Math.max(0, plan.expiresAt - Date.now()))
    return () => { window.clearTimeout(timeout) }
  }, [plan])
  let selected: SettingsAction | '' = ''
  try { selected = parseSettingsIntent(text) } catch { /* Unsupported text remains available for an explicit local refusal. */ }
  const choose = (value: string) => {
    setText(value); setSnapshot(null); setReadFailed(false); setPlan(null); setReceipt(null); setFailed(false); setCancelled(false)
  }
  const act = async (mode: 'preview' | 'execute' | 'read') => {
    if (operation.current) return
    if (mode === 'execute' && (!plan || plan.expiresAt <= Date.now())) { setExpired(true); return }
    const abort = new AbortController(); operation.current = abort
    const signal = AbortSignal.any([lifetime.current.signal, abort.signal])
    const current = () => operation.current === abort && !signal.aborted
    setBusy(true); setSnapshot(null); setReadFailed(false); setFailed(false); setCancelled(false); setReceipt(null)
    if (mode === 'read') setPlan(null)
    try {
      if (mode === 'read') {
        const result = await readSettings(scope, pet, signal)
        if (current()) setSnapshot(result)
      }
      else if (mode === 'execute' && plan) {
        const result = await executeSettings(scope, plan.id, signal)
        if (current()) { setReceipt(result); setPlan(null) }
      }
      else { const result = await previewSettings(scope, text, pet, signal); if (current()) setPlan(result) }
    } catch { if (current()) { if (mode === 'read') setReadFailed(true); else setFailed(true); setPlan(null) } }
    finally { if (current()) setBusy(false); if (operation.current === abort) operation.current = null }
  }
  const shownScope = plan?.scope ?? scope
  const shownAction = plan?.action ?? selected
  const followingTarget = plan?.action === 'unfollow' && plan.ownerPreview && 'followingSessionId' in plan.ownerPreview
    && typeof plan.ownerPreview.followingSessionId === 'string' ? plan.ownerPreview.followingSessionId : t('settingsNoFollowing')
  return <details className="nidofy-control-fold" open={expanded || undefined}><summary>{t('naturalSettings')}</summary><div className="nidofy-detail nidofy-settings"><p>{t('settingsExamples')}</p>
    <label htmlFor={choicesId}>{t('settingsChoices')}</label><select id={choicesId} value={selected} disabled={busy} onChange={(event) => {
      const action = settingsActions.find(value => value === event.target.value)
      choose(action ? t(`settingsAction${action}`) : '')
    }}><option value="">{t('settingsChoose')}</option>{settingsActions.map(action => <option key={action} value={action}>{t(`settingsAction${action}`)}</option>)}</select>
    <label>{t('settingsInstruction')}<input value={text} maxLength={512} disabled={busy} onChange={(event) => { choose(event.target.value) }} /></label>
    <dl className="nidofy-settings-target"><dt>{t('settingsConversation')}</dt><dd>{shownScope.sessionId ?? t('settingsNoTarget')}</dd>
      <dt>{t('settingsWorkspace')}</dt><dd>{shownScope.workspaceId ?? t('settingsNoTarget')}</dd>
      <dt>{t('settingsSelectedPet')}</dt><dd>{shownAction && settingsTargetsPet(shownAction) ? plan?.target ?? pet : t('settingsPetUnused')}</dd>
      {plan?.action === 'unfollow' && <><dt>{t('settingsFollowingTarget')}</dt><dd>{followingTarget}</dd></>}</dl>
    <button disabled={busy || !text.trim()} onClick={() => { void act('preview') }}>{t('settingsPreview')}</button>
    <button disabled={busy} onClick={() => { void act('read') }}>{t('settingsRead')}</button>
    {snapshot && <section className="nidofy-settings-observed" aria-label={t('settingsObservedLabel')}>
      <p>{t('settingsObserved')}</p><p>{t('settingsReadAt')}<time dateTime={new Date(snapshot.readAt).toISOString()}>{new Date(snapshot.readAt).toLocaleString(t('dateLocale'))}</time></p>
      <dl className="nidofy-settings-target"><dt>{t('settingsToneState')}</dt><dd>{t(snapshot.toneEnabled ? 'petInstanceEnabled' : 'petInstanceDisabled')}</dd>
        <dt>{t('settingsFollowingState')}</dt><dd>{snapshot.followingSessionId ?? t('settingsNoFollowing')}</dd>
        <dt>{t('settingsPetsState')}</dt><dd>{t(snapshot.petsEnabled ? 'petInstanceEnabled' : 'petInstanceDisabled')}</dd>
        <dt>{t('settingsSelectedPet')}</dt><dd>{snapshot.selectedPet || t('settingsNoTarget')}</dd>
        {snapshot.pet ? <><dt>{t('petInstanceState')}</dt><dd>{t(snapshot.pet.enabled ? 'petInstanceEnabled' : 'petInstanceDisabled')}</dd>
          <dt>{t('petBoundSession')}</dt><dd>{snapshot.pet.pinned ?? t('petUnbound')}</dd>
          <dt>{t('petBubbleState')}</dt><dd>{t(snapshot.pet.quiet ? 'petBubblesMuted' : 'petBubblesEnabled')}</dd></>
          : <><dt>{t('petInstanceState')}</dt><dd>{t('settingsPetMissing')}</dd></>}</dl>
      <p>{t('settingsToneMeaning')}</p>
    </section>}
    {readFailed && <p role="status">{t('settingsReadFailed')}</p>}
    {plan && <div><p>{t(`settingsAction${plan.action}`)}</p>
      <p>{t('settingsPreviewMeaning')}</p>
      {(plan.action === 'toneOn' || plan.action === 'toneOff') && <p>{t('settingsToneMeaning')}</p>}
      <p>{t('settingsDeadline')} <time dateTime={new Date(plan.expiresAt).toISOString()}>{new Date(plan.expiresAt).toLocaleString(t('dateLocale'))}</time></p>
      {expired && <p role="status">{t('settingsExpired')}</p>}
      <button disabled={busy || expired} onClick={() => { void act('execute') }}>{t('settingsExecute')}</button>
      <button disabled={busy} onClick={() => { setPlan(null) }}>{t('cancel')}</button></div>}
    {busy && <button onClick={() => {
      operation.current?.abort(); operation.current = null; setBusy(false); setSnapshot(null); setReadFailed(false)
      setPlan(null); setReceipt(null); setCancelled(true)
    }}>{t('settingsCancelWaiting')}</button>}
    {receipt && <div role="status"><p>{t('settingsApplied')}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(receipt.result, null, 2)}</pre></div>}
    {failed && <p role="status">{t('settingsRefused')}</p>}
    {cancelled && <p role="status">{t('settingsCancelled')}</p>}
  </div></details>
}
