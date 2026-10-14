/** Explicit private analysis controls; scope changes unmount and cancel every operation. */
import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionScope } from './companion.ts'
import type { EnvironmentInjected } from './index.ts'
import { AnalysisHistory } from './AnalysisHistory.tsx'
import type { CompanionDraft } from './drafts.ts'

type Preview = { ticket: string; input: string; connection: string; model: string; inputBytes: number; maxOutputTokens: number }
type Result = {
  status: string
  text: string
  id: string
  diagnostic: string | null
  counts: { inputTokens: number | null; outputTokens: number | null }
  journal: object
}
type Option = { connection: string; model: string }
type Status = '' | 'analysisUnavailable' | 'analysisCancelled' | 'analysisAppended' | 'analysisAppendRefused'
function previewOf(value: unknown): Preview {
  if (!value || typeof value !== 'object' || !('ticket' in value) || typeof value.ticket !== 'string'
    || !('input' in value) || typeof value.input !== 'string' || !('connection' in value) || typeof value.connection !== 'string'
    || !('model' in value) || typeof value.model !== 'string' || !('inputBytes' in value) || typeof value.inputBytes !== 'number'
    || !('maxOutputTokens' in value) || typeof value.maxOutputTokens !== 'number') throw Error('ANALYSIS_RESULT_INVALID')
  return value as Preview
}
function optionOf(value: unknown): Option {
  if (!value || typeof value !== 'object' || !('connection' in value) || typeof value.connection !== 'string'
    || !('model' in value) || typeof value.model !== 'string') throw Error('ANALYSIS_OPTIONS_INVALID')
  return { connection: value.connection, model: value.model }
}
type Props = {
  onBusyChange?: (busy: boolean) => void
  draft?: CompanionDraft
  editDraft?: (change: Partial<CompanionDraft>) => void
  scope: CompanionScope
  analysis: EnvironmentInjected['analysis']
  appendAnalysis: EnvironmentInjected['appendAnalysis']
  t: PropsLocale<'nidofy.environment'>['t']
}
/** @param props - Current scope and official analysis/draft delegates. @returns Explicit preview, private result and draft choice. */
export function SideAnalysis({ scope, analysis, appendAnalysis, draft, editDraft, onBusyChange, t }: Props) {
  const id = useId()
  const [options, setOptions] = useState<Option[]>([]), [localChosen, localChoose] = useState('')
  const [localText, localSetText] = useState(''), [localTokens, localSetTokens] = useState(512)
  const chosen = draft?.connection ?? localChosen, text = draft?.analysis ?? localText, tokens = draft?.tokens ?? localTokens
  const choose = (connection: string) =>{  if (editDraft) editDraft({ connection }); else localChoose(connection) }
  const setText = (analysis: string) =>{  if (editDraft) editDraft({ analysis }); else localSetText(analysis) }
  const setTokens = (tokens: number) =>{  if (editDraft) editDraft({ tokens }); else localSetTokens(tokens) }
  const [preview, setPreview] = useState<Preview | null>(null), [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<Status>('')
  const operation = useRef<AbortController | null>(null), alive = useRef(true)
  useEffect(() => { onBusyChange?.(busy); return () => { onBusyChange?.(false) } }, [busy, onBusyChange])
  useEffect(() => {
    alive.current = true
    const abort = new AbortController()
    void analysis(scope, 'options', {}, abort.signal).then((value) => {
      if (abort.signal.aborted || !Array.isArray(value)) return
      setOptions(value.map(optionOf))
    }).catch(() => { if (!abort.signal.aborted) setStatus('analysisUnavailable') })
    return () => { alive.current = false; abort.abort(); operation.current?.abort() }
  }, [scope, analysis])
  const act = async (run: boolean) => {
    if (busy) return
    const abort = new AbortController(); operation.current = abort
    setBusy(true); setStatus(''); setResult(null)
    try {
      if (run && preview) {
        const raw = await analysis(scope, 'run', { ticket: preview.ticket, accepted: true }, abort.signal)
        if (!raw || typeof raw !== 'object' || !('text' in raw) || typeof raw.text !== 'string'
          || !('status' in raw) || typeof raw.status !== 'string' || !('counts' in raw) || !raw.counts) throw Error('ANALYSIS_RESULT_INVALID')
        if (alive.current && !abort.signal.aborted) { setResult(raw as Result); setPreview(null) }
      } else {
        const option = options.find(row => `${row.connection}/${row.model}` === chosen)
        if (!option) throw Error('ANALYSIS_CONNECTION_REQUIRED')
        const raw = await analysis(scope, 'prepare', { ...option, text, maxOutputTokens: tokens }, abort.signal)
        if (alive.current && !abort.signal.aborted) setPreview(previewOf(raw))
      }
    } catch { if (alive.current) { setPreview(null); setStatus(abort.signal.aborted ? 'analysisCancelled' : 'analysisUnavailable') } }
    finally { if (alive.current) setBusy(false); if (operation.current === abort) operation.current = null }
  }
  return <section className="nidofy-detail nidofy-analysis" aria-label={t('sideAnalysis')}>
    <strong>{t('sideAnalysis')}</strong><p>{t('analysisMeaning')}</p><p>{t('analysisScope', { session: scope.sessionId ?? '', workspace: scope.workspaceId ?? '' })}</p>
    <AnalysisHistory scope={scope} analysis={analysis} t={t} />
    <label htmlFor={`${id}-connection`}>{t('analysisConnection')}</label><select id={`${id}-connection`} value={chosen} disabled={busy} onChange={(e) => { choose(e.target.value); setPreview(null); setResult(null) }}>
      <option value="">{t('analysisChoose')}</option>{options.map(row => <option key={`${row.connection}/${row.model}`} value={`${row.connection}/${row.model}`}>{row.connection} / {row.model}</option>)}
    </select>
    <label htmlFor={`${id}-text`}>{t('analysisText')}</label><textarea id={`${id}-text`} value={text} maxLength={12288} disabled={busy} onChange={(e) => { setText(e.target.value); setPreview(null); setResult(null) }} />
    <label htmlFor={`${id}-tokens`}>{t('analysisTokens')}</label><input id={`${id}-tokens`} type="number" min={1} max={2048} value={tokens} disabled={busy} onChange={(e) => { setTokens(Number(e.target.value)); setPreview(null); setResult(null) }} />
    <button disabled={busy || !text.trim() || !chosen} onClick={() => { void act(false) }}>{t('analysisPreview')}</button>
    {preview && <div><p>{t('analysisBudget', { bytes: preview.inputBytes, tokens: preview.maxOutputTokens })}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.input}</pre>
      <button disabled={busy} onClick={() => { void act(true) }}>{t('analysisConfirm')}</button></div>}
    {busy && <button onClick={() => { operation.current?.abort() }}>{t('analysisCancel')}</button>}
    {result && <div><p role="status">{result.status}{result.diagnostic ? ` · ${result.diagnostic}` : ''}</p>
      <p>{t('analysisCost', { input: result.counts.inputTokens ?? '?', output: result.counts.outputTokens ?? '?' })}</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{result.text}</pre>
      <details><summary>{t('analysisJournal')}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result.journal, null, 2)}</pre></details>
      <button disabled={busy || result.status !== 'COMPLETED' || !result.text || status === 'analysisAppended'} onClick={() => {
        setBusy(true)
        void appendAnalysis(scope, result.id).then((ok) => { if (alive.current) setStatus(ok ? 'analysisAppended' : 'analysisAppendRefused') })
          .catch(() => { if (alive.current) setStatus('analysisAppendRefused') }).finally(() => { if (alive.current) setBusy(false) })
      }}>{t('analysisAppend')}</button></div>}
    {(busy || status) && <p role="status">{t(busy ? 'analysisRunning' : status || 'analysisUnavailable')}</p>}
  </section>
}
