import { IconEllipsisOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
/** Inline environment inspection and explicit preview/apply actions using the existing workbench owner. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Icon } from './EnvironmentIcon.tsx'
import type { EnvironmentInfo } from './Environment.tsx'
import type { CompanionAction, CompanionScope } from './companion.ts'
import type { EnvironmentInjected } from './index.ts'

type View = 'changes' | 'local' | 'branch' | 'connections'
type Action = 'commit' | 'push' | 'create' | 'switch'
interface Change { path: string; status: string }
interface Preview { token: string; description: string; workspace: string; branch: string | null; permission: 'deployment-default' | 'danger-full-access'; expires: number }
/** Card details never launch another window until the user selects the explicit full-workbench link. */
export function EnvironmentExplorer({ info, scope, workbench, t, launch, refresh }: PropsLocale<'nidofy.environment'> & {
  info: EnvironmentInfo
  scope: CompanionScope
  workbench: EnvironmentInjected['workbench']
  launch: (target: CompanionAction) => void
  refresh: () => void
}) {
  const root = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null)
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => { controller.abort() }
  }, [])
  const request = async <T,>(method: Parameters<EnvironmentInjected['workbench']>[1], input: object, signal?: AbortSignal): Promise<T> =>
    await workbench(scope, method, input, AbortSignal.any([lifetime.current.signal, ...signal ? [signal] : []])) as T
  const [view, setView] = useState<View | null>(null), [menu, setMenu] = useState(false)
  const [action, setAction] = useState<Action | null>(null), [branch, setBranch] = useState(''), [message, setMessage] = useState('')
  const [remote, setRemote] = useState(''), [preview, setPreview] = useState<Preview | null>(null)
  const [rows, setRows] = useState<Change[]>([]), [file, setFile] = useState(''), [patch, setPatch] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(false) }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [menu])
  useEffect(() => { setPreview(null) }, [info.head, info.branch])
  useEffect(() => {
    setRows([]); setFile(''); setPatch(null); setReading(false)
    if (view !== 'changes' || !info.workspace || info.vcs === 'none') return
    const abort = new AbortController()
    setReading(true); setError('')
    void request<{ rows: Change[] }>('review/changes', { workspace: info.workspace }, abort.signal)
      .then((value) => { if (!abort.signal.aborted) setRows(value.rows) })
      .catch((error: unknown) => { if (!abort.signal.aborted) setError(String(error)) })
      .finally(() => { if (!abort.signal.aborted) setReading(false) })
    return () => { abort.abort() }
  }, [view, info.workspace, info.vcs, revision])
  useEffect(() => {
    setPatch(null)
    if (!file || !info.workspace) return
    const abort = new AbortController()
    setReading(true); setError('')
    void request<{ text: string | null }>('review/patch', { workspace: info.workspace, path: file, mode: 'repository' }, abort.signal)
      .then((value) => { if (!abort.signal.aborted) setPatch(value.text) })
      .catch((error: unknown) => { if (!abort.signal.aborted) setError(String(error)) })
      .finally(() => { if (!abort.signal.aborted) setReading(false) })
    return () => { abort.abort() }
  }, [file, info.workspace])
  const select = (next: View) => { setView(view === next ? null : next); setAction(null); setMenu(false); setPreview(null); setError(''); setDone(false) }
  const operate = (next: Action) => {
    setAction(next); setView(next === 'switch' || next === 'create' ? 'branch' : 'changes'); setMenu(false)
    setBranch(next === 'switch' ? info.branches?.find(value => value !== info.branch) ?? '' : '')
    setRemote(info.remotes?.[0] ?? ''); setMessage(''); setPreview(null); setError(''); setDone(false)
  }
  const prepare = async () => {
    if (!info.workspace || !action) return
    setBusy(true); setError(''); setDone(false); setPreview(null)
    try { setPreview(await request<Preview>('git/preview', { workspace: info.workspace, operation: { action, branch, message, remote } })) }
    catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    if (!preview || !info.workspace) return
    setBusy(true); setError('')
    try {
      await request('git/apply', { workspace: info.workspace, token: preview.token })
      setDone(true); setPreview(null); setAction(null); setRevision(value => value + 1); refresh()
    } catch (error) { setError(String(error)); setPreview(null) }
    finally { setBusy(false) }
  }
  const canGit = info.vcs === 'git' && info.canWrite === true
  return <div className="nidofy-explorer" ref={root} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !busy) { setMenu(false); setView(null); setAction(null); setPreview(null); more.current?.focus() }
  }}>
    <div className="nidofy-change-row"><button className="nidofy-row" aria-expanded={view === 'changes'} disabled={busy} onClick={() => { select('changes') }}><Icon kind="changes" /><span>{t('changes')}</span>{info.diff && <small><b className="nidofy-added">+{info.diff.added}</b> <b className="nidofy-deleted">−{info.diff.deleted}</b></small>}</button><button ref={more} className="nidofy-more" aria-label={t('repositoryActions')} aria-expanded={menu} disabled={busy} onClick={() => { setMenu(!menu) }}><IconEllipsisOutlineRegular size={16} /></button></div>
    {menu && <nav className="nidofy-action-menu" aria-label={t('repositoryActions')}>{(['commit', 'push', 'create', 'switch'] as const).map(item => <button key={item} disabled={!canGit} onClick={() => { operate(item) }}>{t(item)}</button>)}</nav>}
    <button className="nidofy-row" aria-expanded={view === 'local'} disabled={busy} onClick={() => { select('local') }}><Icon kind="local" /><span>{t('local')}</span><small>{info.vcs && info.vcs !== 'none' ? info.vcs : ''}</small></button>
    <button className="nidofy-row" aria-expanded={view === 'branch'} disabled={busy} onClick={() => { select('branch') }}><Icon kind="branch" /><span>{info.vcs === 'none' ? t('noRepository') : info.branch ?? t('branch')}</span><span aria-hidden="true">{view === 'branch' ? <IconChevronDownOutlineRegular size={16} /> : <IconChevronRightOutlineRegular size={16} />}</span></button>
    {info.workspace && <p className="nidofy-path">{info.workspace}</p>}
    {view && <section className="nidofy-detail" aria-label={t(view)}>
      <header><strong>{t(view)}</strong><button aria-label={t('closeDetails')} disabled={busy} onClick={() => { setView(null); setAction(null); setPreview(null) }}><IconCloseOutlineRegular size={16} /></button></header>
      {!info.workspace ? <p>{t('empty')}</p> : <>
        {view === 'local' && <dl><dt>{t('workspacePath')}</dt><dd>{info.workspace}</dd><dt>{t('repositoryRoot')}</dt><dd>{info.root ?? t('noRepository')}</dd><dt>{t('branch')}</dt><dd>{info.branch ?? '—'}</dd><dt>{t('revision')}</dt><dd>{info.head ?? '—'}</dd><dt>{t('upstream')}</dt><dd>{info.upstream ?? '—'}</dd><dt>{t('remote')}</dt><dd>{info.remotes?.join(', ') || '—'}</dd></dl>}
        {view === 'changes' && !action && <><p>{t('repositoryChanges')}</p>{!reading && !error && rows.length === 0 && <p>{t(info.vcs === 'none' ? 'noRepository' : 'clean')}</p>}<div className="nidofy-change-list">{rows.slice(0, 100).map(row => <button key={row.path} aria-pressed={file === row.path} onClick={() => { setFile(row.path) }}><code>{row.status}</code><span>{row.path}</span></button>)}</div>{rows.length > 100 && <p>{t('moreInWorkbench')}</p>}{file && <><strong>{file}</strong>{patch !== null ? <pre tabIndex={0}>{patch.slice(0, 20000)}</pre> : !reading && <p>{t('patchUnavailable')}</p>}{patch && patch.length > 20000 && <p>{t('moreInWorkbench')}</p>}</>}</>}
        {view === 'branch' && !action && <><p>{t('currentBranch')}: {info.branch ?? '—'}</p><p>{t('localBranches')}: {info.branches?.length ?? 0}</p><div className="nidofy-inline-actions"><button disabled={!canGit || !info.branches?.some(value => value !== info.branch)} onClick={() => { operate('switch') }}>{t('switch')}</button><button disabled={!canGit} onClick={() => { operate('create') }}>{t('create')}</button></div></>}
        {view === 'connections' && <p>{t('connectionsHint')}</p>}
        {action && <form onSubmit={(event) => { event.preventDefault(); void prepare() }}>
          <strong>{t(action)}</strong>
          {action === 'commit' && <label>{t('commitMessage')}<textarea required maxLength={4000} value={message} disabled={busy || !!preview} onChange={(event) => { setMessage(event.target.value) }} /><small>{t('stagedOnly')}</small></label>}
          {action === 'create' && <label>{t('newBranch')}<input required value={branch} disabled={busy || !!preview} onChange={(event) => { setBranch(event.target.value) }} /></label>}
          {action === 'switch' && <label>{t('branch')}<select required value={branch} disabled={busy || !!preview} onChange={(event) => { setBranch(event.target.value) }}>{(info.branches ?? []).filter(value => value !== info.branch).map(value => <option key={value}>{value}</option>)}</select></label>}
          {action === 'push' && <label>{t('remote')}<select required value={remote} disabled={busy || !!preview} onChange={(event) => { setRemote(event.target.value) }}>{!info.remotes?.length && <option value="">{t('noRemotes')}</option>}{info.remotes?.map(value => <option key={value}>{value}</option>)}</select></label>}
          {!preview && <button type="submit" disabled={busy || !canGit}>{t('previewAction')}</button>}
          {preview && <div className="nidofy-operation-preview"><p>{preview.description}</p><p>{preview.workspace}</p><small>{t(preview.permission === 'danger-full-access' ? 'unrestrictedPermission' : 'defaultPermission')}</small><button type="button" disabled={busy} onClick={() => { void apply() }}>{t('confirmAction')}</button><button type="button" disabled={busy} onClick={() => { setPreview(null) }}>{t('cancel')}</button></div>}
        </form>}
        {reading && <p role="status">{t('loading')}</p>}
        <button className="nidofy-full-workbench" disabled={busy} onClick={() => { launch(view === 'connections' ? 'connections' : 'environment') }}>{t(view === 'connections' ? 'openConnections' : 'openWorkbench')} <IconRightUpOutlineRegular size={16} /></button>
      </>}
    </section>}
    {error && <div className="nidofy-error" role="alert"><p>{t('repositoryFailed')}</p><details><summary>{t('technicalDetails')}</summary><pre>{error}</pre></details></div>}{done && <p role="status">{t('actionCompleted')}</p>}
    <div className="nidofy-environment-footer"><button aria-expanded={view === 'connections'} disabled={busy} onClick={() => { select('connections') }}><Icon kind="connections" />{t('connections')}</button><button aria-label={t('refresh')} disabled={busy} onClick={() => { setRevision(value => value + 1); setPreview(null); refresh() }}><Icon kind="refresh" /></button></div>
  </div>
}
