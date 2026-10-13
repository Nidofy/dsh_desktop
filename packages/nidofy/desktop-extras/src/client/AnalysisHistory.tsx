/** On-demand private history has a separate explicit retention preview and never appends or sends. */
import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionScope } from './companion.ts'
import type { EnvironmentInjected } from './index.ts'

type Row = { id: string; status: string; startedAt: number; connection: string; model: string; archived: boolean }
type History = {
  budget: { activeLimit: number; archiveLimit: number }
  active: number
  archived: number
  total: number
  rows: Row[]
  next: number | null
}
type Preview = { ticket: string; action: 'archive' | 'budget' | 'export'; journal?: object; after: object }
type Detail = Row & { text: string; journal: object }
type Notice = '' | 'analysisArchived' | 'analysisBudgetApplied' | 'analysisExported' | 'analysisHistoryUnavailable' | 'analysisCancelled'
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('ANALYSIS_HISTORY_INVALID')
  return value as Record<string, unknown>
}
function rowOf(value: unknown): Row {
  const row = object(value)
  if (typeof row.id !== 'string' || typeof row.status !== 'string' || typeof row.startedAt !== 'number'
    || typeof row.connection !== 'string' || typeof row.model !== 'string' || typeof row.archived !== 'boolean') throw Error('ANALYSIS_HISTORY_INVALID')
  return { id: row.id, status: row.status, startedAt: row.startedAt, connection: row.connection, model: row.model, archived: row.archived }
}
function historyOf(value: unknown): History {
  const row = object(value), budget = object(row.budget)
  if (typeof budget.activeLimit !== 'number' || typeof budget.archiveLimit !== 'number'
    || typeof row.active !== 'number' || typeof row.archived !== 'number' || typeof row.total !== 'number'
    || !Array.isArray(row.rows) || row.next !== null && typeof row.next !== 'number') throw Error('ANALYSIS_HISTORY_INVALID')
  return { budget: { activeLimit: budget.activeLimit, archiveLimit: budget.archiveLimit }, active: row.active,
    archived: row.archived, total: row.total, rows: row.rows.map(rowOf), next: row.next }
}
type Props = { scope: CompanionScope; analysis: EnvironmentInjected['analysis']; t: PropsLocale<'nidofy.environment'>['t'] }
/** @param props - Current scope and local history delegate. @returns Paged history, exact records and explicit archive/budget controls. */
export function AnalysisHistory({ scope, analysis, t }: Props) {
  const id = useId(), operation = useRef<AbortController | null>(null), alive = useRef(true)
  const [history, setHistory] = useState<History | null>(null), [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all'), [exportPath, setExportPath] = useState('')
  const [activeLimit, setActiveLimit] = useState(20), [archiveLimit, setArchiveLimit] = useState(80)
  const [detail, setDetail] = useState<Detail | null>(null), [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice>(''), [diagnostic, setDiagnostic] = useState('')
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort() } }, [scope, analysis])
  const act = async (method: 'history' | 'history-read' | 'export-preview' | 'export-confirm' | 'archive-preview' | 'budget-preview' | 'retention-confirm', input: object) => {
    if (operation.current) return
    const abort = new AbortController(); operation.current = abort; setBusy(true); setNotice(''); setDiagnostic('')
    const current = () => alive.current && !abort.signal.aborted
    if (method !== 'retention-confirm' && method !== 'export-confirm') setPreview(null)
    try {
      const raw = object(await analysis(scope, method, input, abort.signal))
      if (!current()) return
      if (method === 'history') {
        const next = historyOf(raw); setHistory(next); setOffset('offset' in input ? Number(input.offset) : 0)
        setActiveLimit(next.budget.activeLimit); setArchiveLimit(next.budget.archiveLimit); setDetail(null)
      } else if (method === 'history-read') {
        if (typeof raw.text !== 'string') throw Error('ANALYSIS_HISTORY_INVALID')
        setDetail({ ...rowOf(raw), text: raw.text, journal: object(raw.journal) })
      } else if (method === 'export-confirm') {
        if (raw.status !== 'EXPORTED' || typeof raw.path !== 'string') throw Error('ANALYSIS_HISTORY_INVALID')
        setPreview(null); setExportPath(raw.path); setNotice('analysisExported')
      } else if (method === 'retention-confirm') {
        if (raw.status !== 'ARCHIVED' && raw.status !== 'BUDGET_APPLIED') throw Error('ANALYSIS_HISTORY_INVALID')
        setPreview(null); setDetail(null); setNotice(raw.status === 'ARCHIVED' ? 'analysisArchived' : 'analysisBudgetApplied')
        const next = historyOf(await analysis(scope, 'history', { offset: 0, filter }, abort.signal))
        if (!current()) return
        setHistory(next); setOffset(0); setActiveLimit(next.budget.activeLimit); setArchiveLimit(next.budget.archiveLimit)
      } else {
        if (typeof raw.ticket !== 'string' || raw.action !== 'archive' && raw.action !== 'budget' && raw.action !== 'export') throw Error('ANALYSIS_HISTORY_INVALID')
        setPreview({ ticket: raw.ticket, action: raw.action, after: object(raw.after),
          ...raw.action !== 'budget' ? { journal: object(raw.journal) } : {} })
      }
    } catch (error) {
      if (alive.current) { setPreview(null); setNotice(abort.signal.aborted ? 'analysisCancelled' : 'analysisHistoryUnavailable')
        setDiagnostic(error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : '') }
    } finally { if (alive.current) setBusy(false); if (operation.current === abort) operation.current = null }
  }
  return <details className="nidofy-analysis-history"><summary>{t('analysisHistory')}</summary>
    <p>{t('analysisHistoryMeaning')}</p>
    <label htmlFor={`${id}-filter`}>{t('analysisHistoryFilter')}</label>
    <select id={`${id}-filter`} value={filter} disabled={busy} onChange={(event) => {
      const next = event.target.value
      if (next !== 'all' && next !== 'active' && next !== 'archived') return
      setFilter(next); setDetail(null); setPreview(null); setHistory(null); setOffset(0)
      void act('history', { offset: 0, filter: next })
    }}>
      <option value="all">{t('analysisHistoryAll')}</option><option value="active">{t('analysisHistoryActive')}</option>
      <option value="archived">{t('analysisHistoryArchived')}</option>
    </select>
    <button disabled={busy} onClick={() => { void act('history', { offset: 0, filter }) }}>{t('analysisHistoryRefresh')}</button>
    {history && <div>
      <p>{t('analysisRetentionUsage', { active: history.active, activeLimit: history.budget.activeLimit,
        archived: history.archived, archiveLimit: history.budget.archiveLimit, total: history.total })}</p>
      {history.rows.length === 0 && <p>{t('analysisHistoryEmpty')}</p>}
      <ul>{history.rows.map(row => <li key={row.id}>
        <p>{row.connection} / {row.model} · {row.status} · {t(row.archived ? 'analysisHistoryArchived' : 'analysisHistoryActive')}<br /><time dateTime={new Date(row.startedAt).toISOString()}>{new Date(row.startedAt).toLocaleString(t('dateLocale'))}</time><br />{row.id}</p>
        <button disabled={busy} onClick={() => { void act('history-read', { id: row.id }) }}>{t('analysisHistoryInspect')}</button>
        <button disabled={busy} onClick={() => { void act('export-preview', { id: row.id }) }}>{t('analysisExportPreview')}</button>
        <button disabled={busy || row.archived || row.status === 'INTERRUPTED'} onClick={() => { void act('archive-preview', { id: row.id }) }}>{t('analysisArchivePreview')}</button>
      </li>)}</ul>
      <p>{t('analysisPage', { page: Math.floor(offset / 10) + 1 })}</p>
      <button disabled={busy || offset === 0} onClick={() => { void act('history', { offset: Math.max(0, offset - 10), filter }) }}>{t('analysisHistoryPrevious')}</button>
      <button disabled={busy || history.next === null} onClick={() => { void act('history', { offset: history.next, filter }) }}>{t('analysisHistoryNext')}</button>
      <label htmlFor={`${id}-active`}>{t('analysisActiveLimit')}</label><input id={`${id}-active`} type="number" min={1} max={20} value={activeLimit} disabled={busy}
        onChange={(event) => { setActiveLimit(Number(event.target.value)); setPreview(null) }} />
      <label htmlFor={`${id}-archive`}>{t('analysisArchiveLimit')}</label><input id={`${id}-archive`} type="number" min={0} max={80} value={archiveLimit} disabled={busy}
        onChange={(event) => { setArchiveLimit(Number(event.target.value)); setPreview(null) }} />
      <button disabled={busy} onClick={() => { void act('budget-preview', { activeLimit, archiveLimit }) }}>{t('analysisBudgetPreview')}</button>
    </div>}
    {detail && <div><p>{detail.id} · {detail.status}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{detail.text}</pre>
      <details><summary>{t('analysisJournal')}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail.journal, null, 2)}</pre></details></div>}
    {preview && <div><p>{t(preview.action === 'export' ? 'analysisExportMeaning' : preview.action === 'archive' ? 'analysisArchiveMeaning' : 'analysisBudgetMeaning')}</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview.after, null, 2)}</pre>
      {preview.journal && <details><summary>{t('analysisJournal')}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview.journal, null, 2)}</pre></details>}
      <button disabled={busy} onClick={() => { void act(preview.action === 'export' ? 'export-confirm' : 'retention-confirm', { ticket: preview.ticket, accepted: true }) }}>{t(preview.action === 'export' ? 'analysisExportConfirm' : 'analysisRetentionConfirm')}</button>
      <button disabled={busy} onClick={() => { setPreview(null) }}>{t(preview.action === 'export' ? 'analysisExportDismiss' : 'analysisRetentionDismiss')}</button>
    </div>}
    {busy && <button onClick={() => { operation.current?.abort() }}>{t('analysisCancel')}</button>}
    {(busy || notice) && <p role="status">{t(busy ? 'analysisHistoryBusy' : notice || 'analysisHistoryUnavailable')}{diagnostic ? ` · ${diagnostic}` : ''}</p>}
    {exportPath && <p style={{ overflowWrap: 'anywhere' }}>{t('analysisExportPath', { path: exportPath })}</p>}
  </details>
}
