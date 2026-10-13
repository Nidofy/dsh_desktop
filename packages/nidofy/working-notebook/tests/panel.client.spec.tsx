// @vitest-environment jsdom
/** Panel submits the selected physical scope and offers explicit history restoration. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NotebookPanel } from '../src/client/NotebookPanel.tsx'
import { en, zh } from '../src/client/locales.ts'
import type {} from '../src/client/registration.tsx'
import type { Companion, CompanionScope } from '@nidofy/dsh-desktop-extras/client'
const companionScope: CompanionScope = { hostEpoch: null, windowId: null, viewId: null, panelId: null,
  workspaceId: null, sessionId: null, turn: null, revision: 1 }
const using: Companion['using'] = (_scope, operation, signal) => operation(signal ?? new AbortController().signal)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = ((key: keyof typeof en) => en[key]) as PropsLocale<'nidofy.notebook'>['t']

it.each([en, zh])('saves only explicit workspace selections and carries their revision through previews and citation', async (locale) => {
  const translated = ((key: keyof typeof en) => locale[key]) as PropsLocale<'nidofy.notebook'>['t']
  const calls: { method: string; input: Record<string, unknown> }[] = [], cite = vi.fn()
  let revision = 0
  const members = [{ id: 'main', path: '/project' }, { id: 'worktree', path: '/worktree' }]
  const view = () => ({ revision, current: members[0], project: revision ? { id: 'project-id', members } : null,
    candidates: members.map(row => ({ ...row, title: row.id })) })
  const authority = { revision: 1, projectId: 'project-id', members }
  const hit = { sessionId: 'source', generation: 'physical-source', seq: 1, digest: 'a'.repeat(64), role: 'user',
    type: 'user/message', snippet: '关联项目原文', surface: 'original', authority }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('Expected JSON request body')
    const method = url.split('/').at(-1)!, input = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ method, input })
    if (method === 'save-search-groups') { revision++; return Response.json(view()) }
    return Response.json(method === 'search-groups' ? view() : method === 'settings' ? { autoOrganize: false, revision: 0 }
      : method === 'status' ? { notebook: { revision: 0, active: [] } } : method === 'events' ? []
        : method === 'search' ? { items: [hit], substringIncomplete: false } : method === 'search-source' ? { ...hit, text: '真实项目原文' } : {})
  })
  render(<NotebookPanel sessionId="current" scope={companionScope} using={using} citeSource={cite} t={translated} />)
  fireEvent.click(screen.getByRole('button', { name: locale.manageHistoryProject }))
  const choice = await screen.findByLabelText('worktree · /worktree')
  expect(screen.getByRole('button', { name: locale.saveHistoryProject }).hasAttribute('disabled')).toBe(true)
  expect(calls.some(call => call.method === 'save-search-groups')).toBe(false)
  expect(screen.getByRole('group', { name: locale.manageHistoryProject }).textContent).toMatchSnapshot()
  fireEvent.click(choice)
  fireEvent.click(screen.getByRole('button', { name: locale.saveHistoryProject }))
  await waitFor(() => { expect(calls.find(call => call.method === 'save-search-groups')?.input).toEqual({ sessionId: 'current', expectedRevision: 0, workspaceIds: ['main', 'worktree'] }) })
  fireEvent.change(screen.getByLabelText(locale.searchScope), { target: { value: 'project' } })
  fireEvent.change(screen.getByLabelText(locale.historySearch), { target: { value: '连接' } })
  fireEvent.click(screen.getByRole('button', { name: locale.search }))
  fireEvent.click(await screen.findByRole('button', { name: /关联项目原文/ }))
  expect(await screen.findByText('真实项目原文')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: locale.citeSource }))
  await waitFor(() => { expect(cite).toHaveBeenCalledOnce() })
  expect(calls.filter(call => call.method === 'search-source').map(call => call.input.authority)).toEqual([authority, authority])
  fireEvent.click(screen.getByRole('button', { name: locale.removeHistoryProject }))
  await waitFor(() => { expect(screen.queryByText('真实项目原文')).toBeNull() })
})

it.each([en, zh])('discards old search, preview and citation responses after the user changes their selection', async (locale) => {
  const translated = ((key: keyof typeof en) => locale[key]) as PropsLocale<'nidofy.notebook'>['t']
  const hit = (seq: number) => ({ sessionId: 'ui-fixture', generation: 'ui-only-source', seq,
    digest: 'a'.repeat(64), role: 'user', type: 'user/message', snippet: `candidate ${seq}`, surface: 'original' })
  const pending: { signal: AbortSignal; reply: (value: Response) => void }[] = []
  const cite = vi.fn()
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = url.split('/').at(-1)
    if (method === 'search' || method === 'search-source') {
      if (!init.signal) throw Error('Expected operation cancellation')
      const deferred = Promise.withResolvers<Response>()
      // Deliberately complete cancelled transports to exercise the response acceptance check.
      pending.push({ signal: init.signal, reply: deferred.resolve })
      return deferred.promise
    }
    return Response.json(method === 'settings' ? { autoOrganize: false, revision: 0, schemaVersion: 1 }
      : method === 'status' ? { notebook: { revision: 0, active: [] } } : method === 'events' ? [] : {})
  })
  const mounted = render(<NotebookPanel sessionId="ui-fixture" scope={companionScope} using={using} citeSource={cite} t={translated} />)
  const query = screen.getByLabelText(locale.historySearch)
  const submit = () => { fireEvent.click(screen.getByRole('button', { name: locale.search })) }
  const reply = async (index: number, value: object) => { await act(async () => { pending[index]!.reply(Response.json(value)) }) }
  fireEvent.change(query, { target: { value: 'old' } }); submit()
  fireEvent.change(query, { target: { value: 'new' } }); submit()
  expect(pending[0]!.signal.aborted).toBe(true)
  await reply(1, { items: [hit(1), hit(2)], substringIncomplete: false })
  await reply(0, { items: [hit(0)], substringIncomplete: true })
  expect(screen.queryByRole('button', { name: /candidate 0/ })).toBeNull()
  expect(screen.queryByText(locale.substringIncomplete)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /candidate 1/ }))
  fireEvent.click(screen.getByRole('button', { name: /candidate 2/ }))
  expect(pending[2]!.signal.aborted).toBe(true)
  await reply(3, { ...hit(2), text: 'selected source 2' })
  await reply(2, { ...hit(1), text: 'obsolete source 1' })
  expect(screen.getByText('selected source 2')).toBeDefined()
  expect(screen.queryByText('obsolete source 1')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: locale.citeSource }))
  fireEvent.change(screen.getByLabelText(locale.searchScope), { target: { value: 'workspace' } })
  expect(pending[4]!.signal.aborted).toBe(true)
  await reply(4, { ...hit(2), text: 'selected source 2' })
  expect(cite).not.toHaveBeenCalled()
  expect(screen.queryByText('selected source 2')).toBeNull()
  submit()
  await reply(5, { items: [], substringIncomplete: false })
  expect(screen.getByText(locale.noMatches).textContent).toBe(locale.noMatches)
  expect(screen.getByLabelText(locale.searchResults).textContent).toMatchSnapshot()
  submit(); mounted.unmount()
  expect(pending[6]!.signal.aborted).toBe(true)
  await reply(6, { items: [hit(0)], substringIncomplete: false })
  expect(cite).not.toHaveBeenCalled()
})

it('previews a physical source without changing a draft, then revalidates it before explicit citation', async () => {
  const hit = { sessionId: 'source-session', generation: 'actual-generation', seq: 3, digest: 'a'.repeat(64), role: 'user', type: 'user/message', snippet: '中文连接超时', surface: 'original' }
  const calls: { method: string; input: object }[] = [], cite = vi.fn()
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('Expected JSON request body')
    const method = url.split('/').at(-1)!, input = JSON.parse(init.body) as object
    calls.push({ method, input })
    const value = method === 'status' ? { notebook: { revision: 0, active: [] } }
      : method === 'settings' ? { autoOrganize: false, revision: 0, schemaVersion: 1 }
        : method === 'events' ? [] : method === 'search' ? { items: [hit], substringIncomplete: true }
          : method === 'search-source' ? { ...hit, text: '完整中文连接超时原文' } : {}
    return Response.json(value)
  })
  render(<NotebookPanel sessionId="current-session" scope={companionScope} using={using} citeSource={cite} t={t} />)
  fireEvent.change(screen.getByLabelText('Search history'), { target: { value: '连接' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  const candidate = await screen.findByRole('button', { name: /中文连接超时/ })
  expect(cite).not.toHaveBeenCalled()
  fireEvent.click(candidate)
  expect(await screen.findByText('完整中文连接超时原文')).toBeDefined()
  expect(cite).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Insert reference in draft' }))
  await waitFor(() => { expect(cite).toHaveBeenCalledOnce() })
  expect(calls.filter(call => call.method === 'search-source')).toEqual([0, 1].map(() => ({ method: 'search-source', input: {
    sessionId: 'current-session', targetSessionId: hit.sessionId, generation: hit.generation, seq: hit.seq, digest: hit.digest, scope: 'session',
  } })))
})

it('refuses an oversized complete Notebook response before parsing it', async () => {
  vi.stubGlobal('fetch', async (url: string) => url.endsWith('/settings')
    ? Response.json({ schemaVersion: 1, revision: 0, autoOrganize: false }) : new Response('x'.repeat(1024 * 1024 + 1)))
  render(<NotebookPanel sessionId="bounded-session" scope={companionScope} using={using} t={t} />)
  expect((await screen.findByRole('alert')).textContent).toContain('COMPANION_PAYLOAD_LIMIT')
})

it.each([en, zh])('localizes synchronization and retains visible committed notes when a refresh fails', async (locale) => {
  const translated = ((key: keyof typeof en) => locale[key]) as PropsLocale<'nidofy.notebook'>['t']
  const gate = Promise.withResolvers<undefined>(), calls: string[] = []
  let first = true, fail = false
  vi.stubGlobal('fetch', async (url: string) => {
    const method = url.split('/').at(-1)!
    calls.push(method)
    if (method === 'synchronize') {
      if (first) { first = false; await gate.promise }
      if (fail) return new Response(JSON.stringify({ error: 'NOTEBOOK_SCOPE_CONFLICT' }), { status: 409 })
    }
    const body = method === 'settings' ? { schemaVersion: 1, revision: 0, autoOrganize: false }
      : method === 'status' ? { notebook: { revision: 3, active: [{ id: 'note', text: 'Last committed note', seq: 0, pinned: true }] },
        synchronization: { phase: 'ready', synchronizedThrough: 1 }, sourceThrough: 1 }
        : method === 'events' ? [] : {}
    return new Response(JSON.stringify(body))
  })
  render(<NotebookPanel sessionId="progress-session" scope={companionScope} using={using} t={translated} />)
  expect(await screen.findByText(locale.organizationPending)).toBeDefined()
  expect(calls).not.toContain('status')
  gate.resolve(undefined)
  expect(await screen.findByRole('button', { name: /Last committed note/ })).toBeDefined()
  expect(await screen.findByText(locale.organizationReady)).toBeDefined()
  fail = true; fireEvent.click(screen.getByText(locale.refresh))
  expect(await screen.findByText(locale.organizationFailed)).toBeDefined()
  expect(screen.getByRole('button', { name: /Last committed note/ })).toBeDefined()
  expect(screen.getByRole('alert').textContent).toContain('NOTEBOOK_SCOPE_CONFLICT')
})

it('renders active v2 notes and submits retirement/restoration with the selected scope and revision', async () => {
  const refreshFacts = vi.fn()
  const scope = { sessionId: 'panel-session', generation: 'test-file-panel' }
  const note = { id: 'note', kind: 'constraint', text: 'Visible active note', seq: 0, quote: 'Original',
    pinned: true, active: true, revision: 2 }
  const updates: Record<string, unknown>[] = []
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split('/').at(-1)
    if (typeof init.body !== 'string') throw Error('Expected JSON request body')
    const input = JSON.parse(init.body) as Record<string, unknown>
    if (method === 'update') updates.push(input)
    const value = method === 'settings' ? { schemaVersion: 1, revision: 0, autoOrganize: false }
      : method === 'status' ? { notebook: { schemaVersion: 2, scope, revision: 2, active: [note],
        cursors: { evidenceThrough: 0, commitThrough: 1 }, historyRevision: 1 }, sourceThrough: 4, index: 'ON_DEMAND' }
        : method === 'events' ? [{ seq: 0, type: 'user/message', text: 'Original evidence' }]
          : method === 'history' ? { scope, revision: 2, historyRevision: 1, records: [{ action: 'retire',
            generation: scope.generation, historyRevision: 1, atRevision: 2, note: { ...note, id: 'retired', text: 'Retired source note', active: false } }], nextToken: null }
            : {}
    return new Response(JSON.stringify(value), { status: 200 })
  })
  vi.stubGlobal('fetch', transport)
  render(<NotebookPanel sessionId={scope.sessionId} scope={companionScope} using={using} refreshFacts={refreshFacts} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Visible active note/ }))
  fireEvent.click(screen.getByText('Retire note'))
  await waitFor(() => { expect(updates).toHaveLength(1) })
  expect(updates[0]).toEqual({ sessionId: scope.sessionId, delta: { scope, baseRevision: 2,
    cursors: { evidenceThrough: 4 }, operations: [{ action: 'REMOVE', id: 'note' }] } })
  await waitFor(() => { expect(screen.getByText('Retired note history').hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByText('Retired note history'))
  expect(await screen.findByText('Retired source note')).toBeDefined()
  fireEvent.click(screen.getByText('Restore note'))
  await waitFor(() => { expect(updates).toHaveLength(2) })
  expect(updates[1]).toEqual({ sessionId: scope.sessionId, delta: { scope, baseRevision: 2,
    operations: [{ action: 'RESTORE', id: 'retired' }] } })
  await waitFor(() => { expect(refreshFacts).toHaveBeenCalledWith(companionScope) })
})

it('keeps a newer note draft when an earlier save completes', async () => {
  const gate = Promise.withResolvers<Response>()
  const note = { id: 'note', kind: 'constraint', text: 'Committed', seq: 0, quote: 'Original', pinned: true, active: true, revision: 2 }
  vi.stubGlobal('fetch', async (url: string) => {
    const method = url.split('/').at(-1)
    if (method === 'update') return gate.promise
    return Response.json(method === 'settings' ? { schemaVersion: 1, revision: 0, autoOrganize: false }
      : method === 'status' ? { notebook: { scope: { sessionId: 'draft', generation: 'test' }, revision: 2, active: [note] }, sourceThrough: 1 }
        : method === 'events' ? [{ seq: 0, type: 'user/message', text: 'Original' }] : {})
  })
  render(<NotebookPanel sessionId="draft" scope={companionScope} using={using} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Committed/ }))
  const input = screen.getByLabelText(en.noteText) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'Submitted edit' } })
  fireEvent.click(screen.getByRole('button', { name: en.saveNote }))
  fireEvent.click(screen.getByRole('button', { name: en.newNote }))
  fireEvent.change(input, { target: { value: 'A newer unsaved note' } })
  await act(async () => { gate.resolve(Response.json({})); await gate.promise })
  expect(input.value).toBe('A newer unsaved note')
  expect(screen.queryByRole('button', { name: en.retireNote })).toBeNull()
})
