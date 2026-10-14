// @vitest-environment jsdom
/** Explicit scope over the production Client Loader, references, Workspace and Conversation owners. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { createElement, useEffect } from 'react'
import { webcrypto } from 'node:crypto'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { ClientRoster, TestClient, remoteDefaultResponses } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { loadPluginModules } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/modules.ts'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import { companionRequest } from '../src/client/companion.ts'
import type { CompanionOwnerProps } from '../src/client/Environment.tsx'
import type { CompanionFacts, HintPreferences, HintId } from '../src/shared/companion-facts.ts'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'

const root = process.cwd()
const isRead = (url: string): boolean => ['/api/nidofy/companion', '/api/nidofy/workbench/companion/facts',
  '/api/nidofy/workbench/companion/hint-preferences'].includes(url)
function roster(withCompanion = true): ClientRoster {
  const packages = new Map<string, { name: string; inject: string[]; immediately: boolean }>()
  for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const dir of readdirSync(join(root, 'packages', group.name), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const path = join(root, 'packages', group.name, dir.name, 'package.json')
      let manifest: { name: string; dsh?: { client?: { inject?: string[]; immediately?: boolean } } }
      try { manifest = JSON.parse(readFileSync(path, 'utf8')) as typeof manifest }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error }
      if (manifest.dsh?.client) packages.set(manifest.name, { name: manifest.name,
        inject: manifest.dsh.client.inject ?? [], immediately: manifest.dsh.client.immediately === true })
    }
  }
  const rows = load(readFileSync(join(root, 'packages/nidofy/desktop-extras/tests/fixtures/companion/cordis.yml'), 'utf8')) as { name: string }[]
  return ClientRoster.of([...packages.values()]).closure([...rows.map(row => row.name).filter(name => withCompanion || name !== '@nidofy/dsh-desktop-extras'),
    ...(!withCompanion ? ['@deepseek-ai/dsh-client-ui-settings-general'] : [])])
}
const plan = { roster: roster() }
// Load the production roster before per-case behavior timing, without mounting clients.
beforeAll(async () => {
  await loadPluginModules({ roster: plan.roster.without(['@deepseek-ai/dsh-api-remotes']) })
  await loadPluginModules({ roster: roster(false).without(['@deepseek-ai/dsh-api-remotes']) })
})
const starts: Array<{ pending: Promise<TestClient>; closed: boolean }> = []
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
afterEach(async () => {
  const owned = starts.splice(0)
  for (const entry of owned) entry.closed = true
  // As in createClientTest, own pending starts before awaiting them; a timed-out
  // case must not mount a late client after its globals have been restored.
  await act(async () => {
    await Promise.all(owned.map(async ({ pending }) => {
      const client = await pending.catch(() => undefined)
      await client?.dispose()
    }))
  })
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

async function fixture(windowId = 7, mount = false, withCompanion = true) {
  if (mount) vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'parent' }))
  const mock = RemoteMock.create().load(remoteDefaultResponses)
  const ids = ['parent', 'child'].map(SessionId)
  mock.remote.session.list.mockResolvedValue(ok({ items: ids.map(sessionId => ({ sessionId,
    updatedAt: 1, running: true, blank: false, agentAvailable: true, cwd: '/isolated/' + sessionId })) }))
  mock.stream('workspace/follow', (_request, stream) => {
    stream.push({ type: 'baseline', value: { items: ids.map(sessionId => ({ workspaceId: 'workspace-' + sessionId,
      path: '/isolated/' + sessionId, title: String(sessionId), sessionIds: [sessionId],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })), archivedSessionIds: [], pinnedSessionIds: [] } })
  })
  mock.stream('session/follow', (request, stream) => {
    const args = request[0]
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Expected isolated Session arguments')
    const address: unknown = Reflect.get(args, 'address')
    if (!address || typeof address !== 'object' || Array.isArray(address)) throw Error('Expected isolated Session address')
    const requested: unknown = Reflect.get(address, 'sessionId')
    if (typeof requested !== 'string') throw Error('Expected isolated Session request')
    const id = SessionId(requested)
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false,
      cwd: '/isolated/' + id }, cursor: 0, records: [{ type: 'event', event: { type: 'turn/start',
      seq: 0, time: 1, data: { turn: 1, model: { provider: 'local', model: 'synthetic' } } } }], hasMore: false,
    projections: { asOfSeq: 0, values: {} }, assistantStream: { revision: 0 } } satisfies SessionFollowFrame)
  })
  const calls: string[] = [], opened: string[] = []
  const bootstrap = { hostEpoch: '11111111-1111-1111-1111-111111111111', notebook: 'unavailable' }
  vi.stubGlobal('location', { protocol: 'dsh-app:', hostname: 'app', href: 'dsh-app://app/' })
  Object.assign(window, { dshDesktop: { windowIdentity: async () => windowId },
    nidofyWorkbench: { openPanel: async (panel: string) => { opened.push(panel) }, scopeChanged: () => {} } })
  vi.stubGlobal('BroadcastChannel', class { close() {} })
  vi.stubGlobal('fetch', async (url: string, input?: RequestInit) => {
    calls.push(url)
    const body: unknown = typeof input?.body === 'string' ? JSON.parse(input.body) : null
    const sessionId = body && typeof body === 'object' && 'sessionId' in body && typeof body.sessionId === 'string'
      ? body.sessionId : 'parent'
    return Response.json(url === '/api/nidofy/companion' ? bootstrap
      : url.endsWith('/hint-preferences') ? { revision: 0, ignored: [], snoozed: [], muted: [], offered: [] }
        : url.endsWith('/facts') ? { sessionId, cwd: '/isolated/' + sessionId, project: null,
          generation: 'isolated-physical-generation', durableThrough: 0, notices: [],
          notebook: { availability: 'unavailable', value: null, diagnostic: null } }
          : url.endsWith('/notices') ? [] : { availability: 'unavailable', notebook: null })
  })
  const start = () => TestClient.start(withCompanion ? plan : { roster: roster(false) }, mock, {
    mount, awaitConnected: true, connectTimeoutMs: 10000 })
  const entry = { pending: Promise.resolve(mount ? act(start) : start()), closed: false }
  starts.push(entry)
  void entry.pending.catch(() => undefined)
  const client = await entry.pending
  if (entry.closed) throw new Error('Companion fixture closed during startup')
  if (mount) await act(async () => { await client.flush() })
  else await client.flush()
  return { client, mock, ids, calls, opened, bootstrap }
}

it('loads working notes through the production roster without the optional Companion', async () => {
  const f = await fixture(7, true, false)
  expect(f.client.ctx.get('companion')).toBeUndefined()
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    return Response.json(url.endsWith('/settings') ? { schemaVersion: 1, revision: 0, autoOrganize: false }
      : url.endsWith('/status') ? { notebook: { revision: 0, active: [] }, sourceThrough: 0, index: 'ready' }
        : url.endsWith('/events') ? [] : {})
  })
  fireEvent.click(await screen.findByRole('button', { name: /^Settings$/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Working notes and history' }))
  expect(await screen.findByLabelText('Working note')).toBeTruthy()
  await expect.poll(() => calls.includes('/api/nidofy-notebook/status')).toBe(true)
  expect(calls.every(url => url.startsWith('/api/nidofy-notebook/'))).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('uses the exact navigation binding while another main-labelled reference remains retained, cancelling late reads and reconnecting', async () => {
  const f = await fixture(), ctx = f.client.ctx
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  const parent = f.ids[0]!, child = f.ids[1]!
  using other = ctx.sessions.retain(parent, { source: 'mainView' })
  await other.ready
  ctx.uiWorkspace.openSession(child)
  await expect.poll(() => ctx.companion.view.getSnapshot().scope.sessionId).toBe(child)
  const selected = ctx.sessions.binding(child)!
  await expect.poll(() => selected.session.getSnapshot().openState).toBe('open')
  const view = ctx.companion.view.getSnapshot()
  expect(view).toMatchObject({ state: 'working', notebook: 'unavailable', model: 'unknown', scope: {
    windowId: 7, sessionId: child, workspaceId: 'workspace-child', turn: 1,
    hostEpoch: '11111111-1111-1111-1111-111111111111' } })
  expect(view.scope.viewId).toBe('chat')
  const gate = Promise.withResolvers<string>(), late = ctx.companion.using(view.scope, () => gate.promise)
  const rejected = expect(late).rejects.toThrow()
  ctx.uiWorkspace.openSession(parent); gate.resolve('obsolete child')
  await rejected
  expect(ctx.companion.current(view.scope)).toBe(false)
  await expect(ctx.companion.open(view.scope, 'builds')).rejects.toThrow('COMPANION_SCOPE_CHANGED')
  expect(f.opened).toEqual([])
  const connection = ctx.get('connection') as ConnectionHandle
  connection.reconnect()
  expect(ctx.companion.view.getSnapshot().state).toBe('disconnected')
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  expect(ctx.companion.view.getSnapshot().scope.revision).toBeGreaterThan(view.scope.revision)
  expect(f.calls.every(isRead)).toBe(true)
  const revision = ctx.companion.view.getSnapshot().scope.revision
  f.mock.streams.push('$events', { type: 'emit', event: 'api-session/status', args: [parent, false] })
  await f.client.flush()
  expect(ctx.companion.view.getSnapshot().scope.revision).toBe(revision)
  await ctx.companion.refresh(ctx.companion.view.getSnapshot().scope)
  expect(Buffer.byteLength(JSON.stringify(ctx.companion.view.getSnapshot()))).toBeLessThan(4096)
  expect(f.mock.log.unmatched()).toEqual([])
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('invalidates permission changes through the real control projection and drains reads before unloading', async () => {
  const f = await fixture(), owner = f.client.ctx.companion, parent = f.ids[0]!
  await expect.poll(() => owner.view.getSnapshot().connected && owner.view.getSnapshot().scope.sessionId === parent).toBe(true)
  const before = owner.view.getSnapshot().scope, gate = Promise.withResolvers<string>()
  let cancelled = false
  const operation = owner.using(before, async (signal) => {
    signal.addEventListener('abort', () => { cancelled = true }, { once: true })
    return gate.promise
  })
  const refused = expect(operation).rejects.toThrow()
  f.mock.streams.push('session/control', { type: 'projection', sessionId: parent,
    key: 'permissions', value: { currentValue: 'read-only' }, seq: 1 })
  await f.mock.streams.drained('session/control')
  await expect.poll(() => cancelled).toBe(true)
  expect(owner.current(before)).toBe(false)
  gate.resolve('late permission result'); await refused
  const scope = owner.view.getSnapshot().scope, last = Promise.withResolvers<string>()
  const pending = owner.using(scope, () => last.promise), rejected = expect(pending).rejects.toThrow()
  let disposed = false
  const disposal = f.client.dispose().then(() => { disposed = true })
  await expect.poll(() => owner.view.getSnapshot().state).toBe('disconnected')
  expect(disposed).toBe(false)
  last.resolve('late teardown result'); await rejected; await disposal
  expect(disposed).toBe(true)
})

it('keeps independent window bindings and scope revisions over two real Client runtimes', async () => {
  const first = await fixture(17), second = await fixture(18)
  const a = first.client.ctx, b = second.client.ctx
  a.uiWorkspace.openSession(first.ids[1]!); b.uiWorkspace.openSession(second.ids[0]!)
  await expect.poll(() => a.companion.view.getSnapshot().connected && b.companion.view.getSnapshot().connected).toBe(true)
  const before = b.companion.view.getSnapshot().scope
  expect(a.companion.view.getSnapshot().scope).toMatchObject({ windowId: 17, sessionId: 'child' })
  expect(before).toMatchObject({ windowId: 18, sessionId: 'parent' })
  a.uiWorkspace.openSession(first.ids[0]!)
  expect(b.companion.view.getSnapshot().scope).toEqual(before)
  expect(b.companion.current(a.companion.view.getSnapshot().scope)).toBe(false)
  expect(first.mock.remote.session.prompt).not.toHaveBeenCalled()
  expect(second.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('rejects oversized complete HTTP payloads before JSON decoding', async () => {
  vi.stubGlobal('fetch', async () => new Response('"' + 'x'.repeat(1024 * 1024) + '"'))
  await expect(companionRequest('/isolated', {}, new AbortController().signal)).rejects.toThrow('COMPANION_PAYLOAD_LIMIT')
})

function hintFacts(sessionId: string): CompanionFacts {
  return { sessionId: SessionId(sessionId), cwd: '/isolated/' + sessionId,
    generation: brandString<SessionPersistenceGeneration>('isolated-physical-generation'), durableThrough: 0, project: null, notices: [],
    notebook: { availability: 'available', diagnostic: null, value: { schemaVersion: 2, scope: { sessionId,
      generation: brandString<SessionPersistenceGeneration>('isolated-physical-generation') }, revision: 1, historyRevision: 0,
    cursors: { evidenceThrough: 0, commitThrough: 0 }, active: [{ id: 'user-note', kind: 'next', text: 'User correction remains active',
      seq: 0, quote: 'Original evidence', pinned: true, active: true, revision: 1 }] } } }
}

it('withdraws a same-scope obsolete facts read and refuses its late result after a newer complete response', async () => {
  const f = await fixture(), owner = f.client.ctx.companion
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  const scope = owner.view.getSnapshot().scope, gate = Promise.withResolvers<Response>()
  let reads = 0
  vi.stubGlobal('fetch', async (url: string) => url.endsWith('/facts') ? ++reads === 1 ? gate.promise : Response.json(hintFacts(String(scope.sessionId)))
    : Response.json({ revision: 0, ignored: [], snoozed: [], muted: [], offered: [] }))
  const first = owner.refresh(scope), refused = expect(first).rejects.toThrow()
  await expect.poll(() => reads).toBe(1)
  const fresh = await owner.refresh(scope)
  expect(fresh.facts?.notebook.value?.active[0]?.text).toBe('User correction remains active')
  gate.resolve(Response.json({ ...hintFacts(String(scope.sessionId)), notebook: { availability: 'disabled', value: null, diagnostic: null } }))
  await refused
  expect(owner.view.getSnapshot().facts).toEqual(fresh.facts)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('shows source-labelled bilingual rules, persists independent ignore choices and suppresses offered cards on fast return', async () => {
  const f = await fixture(7, true), ctx = f.client.ctx, owner = ctx.companion
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  let preferences: HintPreferences = { revision: 0, ignored: [], snoozed: [], muted: [], offered: [] }
  const writes: string[] = []
  vi.stubGlobal('fetch', async (url: string, input?: RequestInit) => {
    const value: unknown = typeof input?.body === 'string' ? JSON.parse(input.body) : null
    if (!value || typeof value !== 'object') throw Error('Expected actual Client JSON request')
    if (url.endsWith('/facts')) {
      if (!('sessionId' in value) || typeof value.sessionId !== 'string') throw Error('Expected explicit Session')
      return Response.json(hintFacts(value.sessionId))
    }
    if (url.endsWith('/edit')) {
      if (!('action' in value) || !('expectedRevision' in value) || value.expectedRevision !== preferences.revision) throw Error('CAS conflict')
      writes.push(String(value.action))
      const next = { ...preferences, revision: preferences.revision + 1 }
      if (value.action === 'ignore' && 'id' in value && typeof value.id === 'string') next.ignored = [...preferences.ignored, brandString<HintId>(value.id)]
      else if (value.action === 'offered' && 'ids' in value && Array.isArray(value.ids)
        && value.ids.every((id: unknown): id is string => typeof id === 'string')) next.offered = [...preferences.offered, ...value.ids.map(id => brandString<HintId>(id))]
      else throw Error('Unexpected preference action')
      preferences = next
    }
    return Response.json(preferences)
  })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open companion' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recent progress' })) })
  await expect.poll(() => owner.view.getSnapshot().hints.length).toBeGreaterThan(0)
  expect(document.querySelector('.nidofy-hints')?.innerHTML).toMatchSnapshot('hints-en')
  await act(async () => { ctx.locale.setLocale('zh') })
  expect(document.querySelector('.nidofy-hints')?.innerHTML).toMatchSnapshot('hints-zh')
  await act(async () => { ctx.locale.setLocale('en') })
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Ignore this hint' })[0]!) })
  await expect.poll(() => preferences.ignored.length).toBe(1)
  await act(async () => { ctx.uiWorkspace.openSession(f.ids[1]!) })
  await expect.poll(() => owner.view.getSnapshot().returnCard?.hints.length ?? 0).toBeGreaterThan(0)
  expect(preferences.offered).toHaveLength(0)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recent progress' })) })
  await expect.poll(() => preferences.offered.length).toBeGreaterThan(0)
  await act(async () => { ctx.uiWorkspace.openSession(f.ids[0]!) })
  await expect.poll(() => owner.view.getSnapshot().facts?.sessionId).toBe(f.ids[0])
  await act(async () => { ctx.uiWorkspace.openSession(f.ids[1]!) })
  await expect.poll(() => owner.view.getSnapshot().facts?.sessionId).toBe(f.ids[1])
  expect(owner.view.getSnapshot().returnCard).toBeNull()
  expect(writes).toContain('offered')
  expect(writes.every(action => action === 'ignore' || action === 'offered')).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('keeps the owner alive when the real Notebook client unloads, withdrawing and rereading capability without polling', async () => {
  const f = await fixture(), ctx = f.client.ctx, owner = ctx.companion
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  expect(ctx.slots.entries('nidofy.notebook')).toHaveLength(1)
  const before = owner.view.getSnapshot().scope, count = f.calls.length
  f.bootstrap.notebook = 'disabled'
  await f.client.unload('@nidofy/dsh-working-notebook')
  await expect.poll(() => owner.view.getSnapshot().notebook).toBe('disabled')
  expect(ctx.companion.view.getSnapshot() === owner.view.getSnapshot()).toBe(true)
  expect(owner.current(before)).toBe(false)
  expect(owner.view.getSnapshot().connected).toBe(true)
  expect(f.calls.length).toBe(count + 1)
  expect(f.calls.every(isRead)).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('admits approval navigation only for the current official pending-interaction revision and never answers it', async () => {
  const f = await fixture(), ctx = f.client.ctx, owner = ctx.companion, parent = f.ids[0]!
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  const publish = ctx.uiSession.registerPendingInteraction(() => 1)
  const remove = publish({ kind: 'approval', sessionId: parent, key: 'pending-one' }, async () => {})
  const scope = owner.view.getSnapshot().scope
  expect(owner.view.getSnapshot().actions).toContain('approval')
  expect(owner.view.getSnapshot().state).toBe('waiting')
  await owner.open(scope, 'approval')
  expect(ctx.uiSession.sessionStatus.getSnapshot().get(parent)?.pendingInteraction?.key).toBe('pending-one')
  const removeNext = publish({ kind: 'approval', sessionId: parent, key: 'pending-two' }, async () => {})
  expect(owner.current(scope)).toBe(false)
  await expect(owner.open(scope, 'approval')).rejects.toThrow()
  remove(); removeNext()
  expect(owner.view.getSnapshot().actions).not.toContain('approval')
  expect(f.opened).toEqual([])
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('retains exactly one explicit attention reference independently of foreground and rejects stale return commands', async () => {
  const f = await fixture(), ctx = f.client.ctx, owner = ctx.companion, parent = f.ids[0]!, child = f.ids[1]!
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  ctx.uiWorkspace.openSession(child)
  await expect.poll(() => owner.view.getSnapshot().scope.turn).toBe(1)
  owner.follow(owner.view.getSnapshot().scope)
  expect(ctx.sessions.retainInfo(child).getSnapshot().retainedBy.companionAttention).toBe(1)
  ctx.uiWorkspace.openSession(parent)
  expect(owner.attention.getSnapshot()?.scope.sessionId).toBe(child)
  expect(ctx.sessions.retainInfo(child).getSnapshot().retainedBy.mainView).toBeUndefined()
  const before = owner.attention.getSnapshot()!.scope
  f.mock.streams.push('session/control', { type: 'projection', sessionId: child,
    key: 'permissions', value: { currentValue: 'read-only' }, seq: 1 })
  await f.mock.streams.drained('session/control')
  await expect.poll(() => owner.attention.getSnapshot()?.scope.revision).toBeGreaterThan(before.revision)
  expect(() =>{  owner.openAttention(before) }).toThrow('COMPANION_SCOPE_CHANGED')
  owner.openAttention(owner.attention.getSnapshot()!.scope)
  expect(owner.view.getSnapshot().scope.sessionId).toBe(child)
  owner.follow(owner.view.getSnapshot().scope)
  expect(ctx.sessions.retainInfo(child).getSnapshot().retainedBy.companionAttention).toBe(1)
  owner.releaseAttention()
  expect(owner.attention.getSnapshot()).toBeNull()
  expect(ctx.sessions.retainInfo(child).getSnapshot().retainedBy.companionAttention).toBeUndefined()
  expect(f.calls.every(isRead)).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('mounts one static companion in the production Frame at narrow width and restores focus without changing Session selection', async () => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  const f = await fixture(7, true), ctx = f.client.ctx
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  const before = ctx.uiSession.mainSelection.getSnapshot()
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL() { return 'blob:isolated-companion-test' }
    static override revokeObjectURL() {}
  })
  const input = ctx.conversation.input.for(ctx.sessions.binding(f.ids[0]!)!.ctx)
  await act(async () => {
    input.setDraft('未发送草稿')
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(picker).not.toBeNull()
    fireEvent.change(picker!, { target: { files: [new File(['isolated'], 'synthetic.png', { type: 'image/png' })] } })
  })
  const draft = input.state.getSnapshot()
  expect(draft.draft).toBe('未发送草稿')
  expect(draft.attachmentIds).toHaveLength(1)
  const trigger = await screen.findByRole('button', { name: /Open companion|打开伙伴/ })
  trigger.focus()
  await act(async () => { fireEvent.click(trigger) })
  expect(document.querySelector('.nidofy-drawer-trigger')?.getAttribute('aria-expanded')).toBe('true')
  const dialog = await screen.findByRole('dialog')
  const canvas = dialog.querySelector('canvas')
  expect(dialog.querySelectorAll('.nidofy-primary-actions button')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Full', exact: true }).hasAttribute('disabled')).toBe(true)
  for (let cycle = 0; cycle < 10; cycle++) {
    for (const mode of ['Project', 'Tools', 'Assistant']) {
      await act(async () => { fireEvent.click(screen.getByRole('tab', { name: mode, exact: true })) })
      expect(dialog.querySelector('canvas')).toBe(canvas)
      expect(input.state.getSnapshot()).toEqual(draft)
    }
  }
  expect(f.calls.every(isRead)).toBe(true)
  expect(dialog.querySelectorAll('.nidofy-character img')).toHaveLength(1)
  expect(dialog.querySelector('.nidofy-character img')?.getAttribute('src')).toBe('/api/nidofy-extras/assets/companion/bluewhale/upperbody.png')
  await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true }) })
  expect(screen.getByRole('dialog')).toBe(dialog)
  await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }) })
  await expect.poll(() => screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(ctx.uiSession.mainSelection.getSnapshot()).toEqual(before)
  expect(input.state.getSnapshot()).toEqual(draft)
  expect(f.calls.every(isRead)).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('shares one character slot across wide and narrow layouts, visibility and both locales without acquiring extra Session references', async () => {
  let wide = true
  const observers: { fire(): void }[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) { observers.push(this) }
    observe() {}
    unobserve() {}
    disconnect() {}
    fire() { this.callback([], this) }
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return new DOMRect(0, 0, this.classList.contains('nidofy-width-probe') && wide ? 1 : 0, 0)
  })
  const f = await fixture(7, true), ctx = f.client.ctx, visibility: boolean[] = []
  let mounted = 0, unmounted = 0
  function Character({ active, view }: CompanionOwnerProps) {
    useEffect(() => { mounted++; return () => { unmounted++ } }, [])
    visibility.push(active)
    return createElement('span', { 'data-companion-test': '' }, view.state)
  }
  let dispose: () => void = () => {}
  await act(async () => { dispose = ctx.slots.register({ name: 'nidofy.companion' }, Character) })
  expect(document.querySelectorAll('[data-companion-test]')).toHaveLength(1)
  expect(document.querySelector('.nidofy-drawer-trigger')).toBeNull()
  const stage = document.querySelector('.nidofy-character')
  for (const mode of ['Project', 'Tools', 'Assistant']) {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: mode, exact: true })) })
    expect(document.querySelector('.nidofy-character')).toBe(stage)
    expect(mounted - unmounted).toBe(1)
    if (mode === 'Project') expect(document.querySelectorAll('.nidofy-primary-actions button')).toHaveLength(4)
    if (mode === 'Tools') expect(document.querySelectorAll('.nidofy-tool-rows button')).toHaveLength(3)
  }
  expect(document.querySelector('.nidofy-body')?.innerHTML).toMatchSnapshot('en-wide')
  const scope = ctx.companion.view.getSnapshot().scope
  await act(async () => { wide = false; for (const observer of observers) observer.fire() })
  expect(document.querySelectorAll('[data-companion-test]')).toHaveLength(0)
  const trigger = screen.getByRole('button', { name: 'Open companion' })
  await act(async () => { fireEvent.click(trigger) })
  expect(document.querySelectorAll('[data-companion-test]')).toHaveLength(1)
  expect(document.querySelector('.nidofy-body')?.innerHTML).toMatchSnapshot('en-narrow')
  await act(async () => { ctx.locale.setLocale('zh') })
  expect(screen.getByRole('button', { name: '关闭伙伴' })).toBeDefined()
  expect(document.querySelector('.nidofy-body')?.innerHTML).toMatchSnapshot('zh-narrow')
  await act(async () => { ctx.locale.setLocale('en') })
  expect(screen.getByRole('button', { name: 'Close companion' })).toBeDefined()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => { fireEvent(document, new Event('visibilitychange')) })
  expect(visibility.at(-1)).toBe(false)
  hidden.mockReturnValue(false)
  await act(async () => { fireEvent(document, new Event('visibilitychange')) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close companion' })) })
  expect(mounted).toBe(unmounted)
  expect(visibility).toContain(true)
  expect(ctx.companion.view.getSnapshot().scope).toEqual(scope)
  expect(f.calls.every(isRead)).toBe(true)
  await act(async () => { dispose() })
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('guards in-flight analysis closure, keeps drafts across modes and rejects its late response', async () => {
  const f = await fixture(7, true), ctx = f.client.ctx
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  await act(async () => {
    f.mock.streams.push('$events', { type: 'emit', event: 'api-session/status', args: [f.ids[0]!, false] })
    await f.client.flush()
  })
  await expect.poll(() => ctx.companion.view.getSnapshot().state).toBe('idle')
  const original = globalThis.fetch, gate = Promise.withResolvers<Response>(), requested: string[] = []
  let aborted = false
  vi.stubGlobal('fetch', async (url: string, input?: RequestInit) => {
    if (!url.includes('/analysis/')) return original(url, input)
    requested.push(url)
    if (url.endsWith('/options')) return Response.json([{ connection: 'local', model: 'synthetic' }])
    if (url.endsWith('/prepare')) return Response.json({ ticket: 'explicit-ticket', input: 'isolated analysis', connection: 'local', model: 'synthetic', inputBytes: 17, maxOutputTokens: 512 })
    if (url.endsWith('/run')) {
      input?.signal?.addEventListener('abort', () => { aborted = true }, { once: true })
      return gate.promise
    }
    throw Error('Unexpected analysis operation')
  })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open companion' })) })
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Tools', exact: true })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Side analysis/ })) })
  await screen.findByRole('option', { name: 'local / synthetic' })
  expect(requested).toEqual(['/api/nidofy/workbench/analysis/options'])
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Connection and model'), { target: { value: 'local/synthetic' } })
    fireEvent.change(screen.getByLabelText('Selected text or question'), { target: { value: 'isolated analysis' } })
  })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview request' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send this one request' })) })
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Assistant', exact: true })) })
  const guard = await screen.findByRole('dialog', { name: 'Operation in progress' })
  expect(guard.textContent).toContain('usage may have occurred')
  expect(aborted).toBe(false)
  await act(async () => { fireEvent.keyDown(guard, { key: 'Escape' }) })
  expect(screen.queryByRole('dialog', { name: 'Operation in progress' })).toBeNull()
  expect(aborted).toBe(false)
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Assistant', exact: true })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting and close' })) })
  expect(aborted).toBe(true)
  gate.resolve(Response.json({ status: 'COMPLETED', text: 'late result must stay withdrawn', counts: { inputTokens: 1, outputTokens: 1 } }))
  await act(async () => { await Promise.resolve() })
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Tools', exact: true })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Side analysis/ })) })
  expect((screen.getByLabelText('Selected text or question')).value).toBe('isolated analysis')
  expect(screen.queryByText('late result must stay withdrawn')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Send this one request' })).toBeNull()
  expect(requested.filter(path => path.endsWith('/run'))).toHaveLength(1)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('keeps admitted approval and generic questions visible across all modes without answering them', async () => {
  const f = await fixture(7, true), ctx = f.client.ctx, owner = ctx.companion
  await expect.poll(() => owner.view.getSnapshot().connected).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open companion' })) })
  const answer = vi.fn(), publish = ctx.uiSession.registerPendingInteraction(() => 1)
  let remove = () => {}
  await act(async () => { remove = publish({ kind: 'approval', sessionId: f.ids[0]!, key: 'pending-ui-approval' }, answer) })
  for (const mode of ['Project', 'Tools', 'Assistant']) {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: mode, exact: true })) })
    expect(screen.getByRole('button', { name: 'Open pending approval' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('Your confirmation is needed')).toBeTruthy()
  }
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open pending approval' })) })
  expect(answer).not.toHaveBeenCalled()
  await act(async () => { remove(); remove = publish({ kind: 'question', sessionId: f.ids[0]!, key: 'pending-ui-question' }, answer) })
  expect(screen.queryByRole('button', { name: 'Open pending approval' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Return to conversation', exact: true })).toBeTruthy()
  await act(async () => { remove() })
  expect(answer).not.toHaveBeenCalled()
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('keeps local appearance available without a Session and reports unknown pending state while disconnected', async () => {
  const f = await fixture(7, true), ctx = f.client.ctx
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open companion' })); ctx.uiSession.selectMain(undefined) })
  await expect.poll(() => ctx.companion.view.getSnapshot().scope.sessionId).toBeNull()
  expect(document.querySelector('.nidofy-status-strip')?.textContent).toContain('No conversation selected')
  await act(async () => { fireEvent.click(document.querySelector('.nidofy-stage button')!) })
  expect(screen.getByRole('button', { name: 'Enable local Live2D' }).hasAttribute('disabled')).toBe(false)
  await act(async () => { ctx.uiWorkspace.openSession(f.ids[0]!) })
  await expect.poll(() => ctx.companion.view.getSnapshot().scope.sessionId).toBe(f.ids[0])
  const original = globalThis.fetch, gate = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', (url: string, input?: RequestInit) => url === '/api/nidofy/companion' ? gate.promise : original(url, input))
  const connection = ctx.get('connection') as ConnectionHandle
  await act(async () => { connection.reconnect() })
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(false)
  await act(async () => { fireEvent.click(document.querySelector('.nidofy-status-strip button')!) })
  expect(screen.getByText('Pending interaction status unavailable')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Open pending approval' })).toBeNull()
  gate.resolve(Response.json(f.bootstrap))
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
})

it('asks before replacing the one followed conversation and preserves it when cancelled', async () => {
  const f = await fixture(7, true), ctx = f.client.ctx
  await expect.poll(() => ctx.companion.view.getSnapshot().connected).toBe(true)
  await act(async () => {
    ctx.companion.follow(ctx.companion.view.getSnapshot().scope)
    ctx.uiWorkspace.openSession(f.ids[1]!)
  })
  await expect.poll(() => ctx.companion.view.getSnapshot().scope.sessionId).toBe(f.ids[1])
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open companion' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Follow this conversation', exact: true })) })
  const dialog = screen.getByRole('dialog', { name: 'Replace followed conversation?' })
  expect(dialog.textContent).toContain('parent')
  await act(async () => { fireEvent.click(within(dialog).getByText('Keep current target', { selector: 'button' })) })
  expect(ctx.companion.attention.getSnapshot()?.scope.sessionId).toBe(f.ids[0])
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Follow this conversation', exact: true })) })
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Replace followed conversation?' })).getByRole('button', { name: 'Follow this conversation', exact: true }))
  })
  expect(ctx.companion.attention.getSnapshot()?.scope.sessionId).toBe(f.ids[1])
  expect(ctx.sessions.retainInfo(f.ids[0]!).getSnapshot().retainedBy.companionAttention).toBeUndefined()
  expect(f.mock.remote.session.prompt).not.toHaveBeenCalled()
  await act(async () => { ctx.companion.releaseAttention() })
})
