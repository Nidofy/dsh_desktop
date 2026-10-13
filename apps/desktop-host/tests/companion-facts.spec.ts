/** Read-only evidence over real Loader/JSONL/Notebook and real local Shell receipts. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CompanionFactsOwner } from '../src/workbench/companion-facts.ts'
import { NotificationOwner } from '../src/workbench/notifications.ts'
import { HintPreferencesOwner } from '../src/workbench/hint-preferences.ts'
import { verificationFixture } from './verification-fixture.ts'
import { createNotebookFixture } from '../../../packages/nidofy/desktop-extras/tests/notebook-loader-fixture.ts'

async function fixture() {
  const f = await verificationFixture(), n = await createNotebookFixture(undefined, true)
  const agent = await n.ctx.agentLoop.create(SessionId('t18-facts'), { provider: 'test', model: 'test' }, { cwd: f.workspace })
  const notices = new NotificationOwner(f.home, f.verification), owner = new CompanionFactsOwner(n.ctx, notices, f.verification)
  const off = f.verification.subscribe(event => notices.committed(event).then(() => {}))
  const preferences = new HintPreferencesOwner(n.ctx, f.home)
  onTestFinished(async () => { off(); await owner.close(); await notices.close(); await preferences.close() })
  return { ...f, n, agent, notices, owner, preferences, read: () => owner.read(agent.session.id, new AbortController().signal) }
}

it.skipIf(process.platform !== 'win32')('projects actual tests, stale/unknown freshness and independent acceptance without delivery writes or model requests', async () => {
  const f = await fixture(), run = await f.run()
  const before = { cursor: await f.notices.cursor(), prefs: await f.notices.preferences(), rows: await f.notices.list() }
  const requests = f.n.model.requests.length
  expect((await f.read()).notices[0]).toMatchObject({ source: 'current', receipt: {
    tests: 'PASSED', freshness: 'CURRENT', acceptance: 'PENDING', acceptanceRevision: 0, logAvailable: true } })
  const provider = vi.spyOn(f.ctx.shell, 'verificationInputs').mockResolvedValue(null)
  expect((await f.read()).notices[0]?.receipt?.freshness).toBe('UNKNOWN')
  provider.mockRestore()
  await f.verification.accept(f.workspace, run.id, 0, 'ACCEPTED')
  await writeFile(join(f.workspace, 'src/new-input.mjs'), 'export const changed = true')
  expect((await f.read()).notices[0]).toMatchObject({ source: 'historical', receipt: {
    tests: 'PASSED', freshness: 'STALE', acceptance: 'ACCEPTED', acceptanceRevision: 1 } })
  expect({ cursor: await f.notices.cursor(), prefs: await f.notices.preferences(), rows: await f.notices.list() }).toEqual(before)
  expect(f.n.model.requests).toHaveLength(requests)
  expect(f.counts().commands).toBe(1)
}, 60000)

it.skipIf(process.platform !== 'win32')('restores independent ignore/snooze/offered/project mute across owners and refuses stale edits or removed attachments', async () => {
  const f = await fixture(), workspace = await f.n.ctx.workspaceRegistry.create(f.workspace)
  await workspace.attachSession(f.agent.session.id)
  const project = { sessionId: f.agent.session.id, workspaceId: workspace.id, path: workspace.path }
  expect((await f.read()).project).toEqual({ workspaceId: workspace.id, path: workspace.path })
  const key = 'a'.repeat(64), signal = new AbortController().signal
  await f.preferences.edit({ action: 'ignore', expectedRevision: 0, id: key }, signal)
  await f.preferences.edit({ action: 'snooze', expectedRevision: 1, id: 'b'.repeat(64), until: Date.now() + 60000 }, signal)
  await f.preferences.edit({ action: 'offered', expectedRevision: 2, ids: [key] }, signal)
  await f.preferences.edit({ action: 'mute', expectedRevision: 3, ...project }, signal)
  const cold = new HintPreferencesOwner(f.n.ctx, f.home)
  onTestFinished(() => cold.close())
  expect(await cold.read()).toMatchObject({ revision: 4, ignored: [key], offered: [key],
    muted: [{ workspaceId: workspace.id, path: workspace.path }] })
  await expect(cold.edit({ action: 'reset', expectedRevision: 3 }, signal)).rejects.toThrow('HINT_PREFERENCES_CONFLICT')
  await workspace.detachSession(f.agent.session.id)
  expect((await f.read()).project).toBeNull()
  await expect(cold.edit({ action: 'mute', expectedRevision: 4, ...project }, signal)).rejects.toThrow('HINT_PROJECT_CHANGED')
  expect(await f.notices.cursor()).toEqual({ revision: 0, sequence: 0 })
  expect((await f.notices.list()).notices).toEqual([])
}, 60000)

it.skipIf(process.platform !== 'win32')('refuses damaged/future preferences without replacing bytes and resolves concurrent immutable CAS to one winner', async () => {
  const f = await fixture(), cold = new HintPreferencesOwner(f.n.ctx, f.home), signal = new AbortController().signal
  onTestFinished(() => cold.close())
  const results = await Promise.allSettled([f.preferences.edit({ expectedRevision: 0, action: 'ignore', id: 'a'.repeat(64) }, signal),
    cold.edit({ expectedRevision: 0, action: 'ignore', id: 'b'.repeat(64) }, signal)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const file = join(f.home, 'desktop-actions/companion-hints/preferences/0000000000000001.json')
  const original = JSON.parse((await readFile(file)).toString()) as { schemaVersion: number }
  for (const bytes of [Buffer.from('{damaged'), Buffer.from(JSON.stringify({ ...original, schemaVersion: 2 }))]) {
    await writeFile(file, bytes)
    await expect(cold.read()).rejects.toThrow()
    await expect(cold.edit({ expectedRevision: 1, action: 'reset' }, signal)).rejects.toThrow()
    expect(await readFile(file)).toEqual(bytes)
  }
}, 60000)

it.skipIf(process.platform !== 'win32')('checks raw generation/seq and retains old terminal identity as historical without treating completion as verification', async () => {
  const f = await fixture()
  f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'local evidence' }], source: { kind: 'user' } }))
  await f.agent.whenIdle()
  await f.n.ctx.sessions.flush(f.agent.session)
  const raw = await f.n.ctx.sessionPersistence.observeDurable(f.agent.session.id)
  const terminal = raw.events.findLast(event => event.type === 'turn/end')
  if (terminal?.type !== 'turn/end') throw Error('Expected actual terminal')
  await f.notices.sessionTerminal(f.agent.session.id, raw.generation, f.workspace, terminal)
  expect((await f.read()).notices[0]).toMatchObject({ source: 'current', receipt: null })
  const eventPath = join(f.home, 'desktop-actions/notifications/events/0000000000000001.json')
  const bytes = await readFile(eventPath)
  const record = JSON.parse(bytes.toString()) as { sessionSource: { turn: number } }
  await writeFile(eventPath, JSON.stringify({ ...record, sessionSource: { ...record.sessionSource, turn: 99 } }))
  expect((await f.read()).notices[0]).toMatchObject({ source: 'historical', receipt: null })
  expect((await f.notices.list()).notices[0]?.delivery.handled).toBe(false)
}, 60000)

it.skipIf(process.platform !== 'win32')('refuses a cancelled late projection and leaves selected Notebook bytes unchanged', async () => {
  const f = await fixture(), before = await f.n.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)
  const controller = new AbortController(), original = f.notices.forScope.bind(f.notices)
  vi.spyOn(f.notices, 'forScope').mockImplementation(async (...args) => {
    const rows = await original(...args); controller.abort(); return rows
  })
  await expect(f.owner.read(f.agent.session.id, controller.signal)).rejects.toThrow()
  expect(await f.n.ctx.nidofyNotebookV2.read(f.agent.session.id, new AbortController().signal)).toEqual(before)
}, 60000)

it.skipIf(process.platform !== 'win32')('withdraws the fact owner before draining an admitted read that ignores cancellation', async () => {
  const f = await fixture(), gate = Promise.withResolvers<Awaited<ReturnType<NotificationOwner['forScope']>>>()
  let entered = false, drained = false
  vi.spyOn(f.notices, 'forScope').mockImplementation(() => { entered = true; return gate.promise })
  const read = f.read(), refused = expect(read).rejects.toThrow()
  await expect.poll(() => entered).toBe(true)
  const close = f.owner.close().then(() => { drained = true })
  expect(drained).toBe(false)
  gate.resolve([]); await refused; await close
  expect(drained).toBe(true)
  await expect(f.read()).rejects.toThrow()
}, 60000)
