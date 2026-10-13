/** User associations through real Loader, Workspace membership and durable Session sources. */
import { expect, it, vi } from 'vitest'
import { mkdir, readdir, writeFile, readFile, link } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createNotebookFixture } from './notebook-loader-fixture.ts'
import type { HistoryGroupView } from '../src/shared/notebook-types.ts'
import type { HistoryPage } from '../src/history-search.ts'
import { HistoryGroups } from '../src/history-groups.ts'

async function fixture() {
  const f = await createNotebookFixture(undefined, true)
  const agents = [], workspaces = []
  for (const name of ['main', 'worktree', 'unlinked']) {
    const path = join(f.home, name)
    await mkdir(path)
    const workspace = await f.ctx.get('workspaceRegistry')!.create(path)
    const agent = await f.ctx.agentLoop.create(SessionId('group-' + name), { provider: 'test', model: 'test' }, { cwd: workspace.path })
    await workspace.attachSession(agent.session.id)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '关联连接证据 E_TIMEOUT ' + name }], source: { kind: 'user' } }))
    await agent.whenIdle()
    agents.push(agent); workspaces.push(workspace)
  }
  return { ...f, agents, workspaces, caller: agents[0]!.session.id }
}

it('requires explicit associations, restores them cold and invalidates old previews after removal or detached membership', async () => {
  const f = await fixture(), [first, second] = f.workspaces
  const count = f.model.requests.length
  expect((await f.api('search', { sessionId: f.caller, query: '连接', scope: 'workspace' }) as HistoryPage).items.map(hit => hit.sessionId)).toEqual([f.caller])
  await expect(f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' })).rejects.toThrow('HISTORY_PROJECT_REQUIRED')
  const view = await f.api('search-groups', { sessionId: f.caller }) as HistoryGroupView
  const saved = await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: view.revision, workspaceIds: [first!.id, second!.id] }) as HistoryGroupView
  const page = await f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' }) as HistoryPage
  expect(page.items.map(hit => hit.sessionId).sort()).toEqual(f.agents.slice(0, 2).map(agent => agent.session.id).sort())
  const hit = page.items.find(hit => hit.sessionId === f.agents[1]!.session.id)!
  const sourceInput = { sessionId: f.caller, targetSessionId: hit.sessionId, generation: hit.generation, seq: hit.seq, digest: hit.digest, authority: hit.authority, scope: 'project' }
  expect(await f.api('search-source', sourceInput)).toMatchObject({ text: '关联连接证据 E_TIMEOUT worktree' })
  const cold = new HistoryGroups(f.ctx, join(f.home, 'notes'), 1048576, 16384)
  expect((await cold.view(f.caller, new AbortController().signal)).project).toEqual(saved.project)
  await second!.detachSession(hit.sessionId)
  await expect(f.api('search-source', sourceInput)).rejects.toThrow('HISTORY_SCOPE_REFUSED')
  await second!.attachSession(hit.sessionId)
  await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: saved.revision, workspaceIds: [] })
  await expect(f.api('search-source', sourceInput)).rejects.toThrow('HISTORY_PROJECT_REQUIRED')
  expect(f.model.requests).toHaveLength(count)
})

it('serializes competing writers by immutable revision CAS and preserves corrupt authority bytes', async () => {
  const f = await fixture(), ids = f.workspaces.slice(0, 2).map(row => row.id)
  const owners = [new HistoryGroups(f.ctx, join(f.home, 'notes'), 1048576, 16384),
    new HistoryGroups(f.ctx, join(f.home, 'notes'), 1048576, 16384)]
  const outcomes = await Promise.allSettled(owners.map(owner => owner.save(f.caller, 0, ids, new AbortController().signal)))
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  const failure = outcomes.find(outcome => outcome.status === 'rejected')
  expect(failure?.status === 'rejected' && String(failure.reason)).toContain('HISTORY_GROUP_CONFLICT')
  const path = join(f.home, 'notes', 'history-projects-v1', 'revision-1.json')
  await writeFile(path, 'corrupt association')
  await expect(f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' })).rejects.toThrow()
  await expect(f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 1, workspaceIds: [] })).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('corrupt association')
  expect(await readdir(join(f.home, 'notes', 'history-projects-v1'))).toEqual(['revision-1.json'])
})

it('cancels before publication and refuses a group edit that arrives during source loading', async () => {
  const f = await fixture(), ids = f.workspaces.slice(0, 2).map(row => row.id)
  await expect(f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 0, workspaceIds: ids }, AbortSignal.abort())).rejects.toThrow()
  expect((await f.api('search-groups', { sessionId: f.caller }) as HistoryGroupView).revision).toBe(0)
  await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 0, workspaceIds: ids })
  const observe = f.ctx.sessionPersistence.observeDurable.bind(f.ctx.sessionPersistence)
  const gate = vi.spyOn(f.ctx.sessionPersistence, 'observeDurable').mockImplementationOnce(async (id, options) => {
    const result = await observe(id, options)
    await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 1, workspaceIds: [] })
    return result
  })
  try { await expect(f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' })).rejects.toThrow() }
  finally { gate.mockRestore() }
})

it('recovers a complete revision with its crash-left publication link and refuses external aliases', async () => {
  const f = await fixture(), ids = f.workspaces.slice(0, 2).map(row => row.id)
  const view = await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 0, workspaceIds: ids }) as HistoryGroupView
  const directory = join(f.home, 'notes', 'history-projects-v1'), final = join(directory, 'revision-1.json')
  const pending = join(directory, 'pending-00000000-0000-0000-0000-000000000000')
  await link(final, pending)
  expect((await f.api('search-groups', { sessionId: f.caller }) as HistoryGroupView).project).toEqual(view.project)
  expect(await readFile(pending)).toEqual(await readFile(final))
  await link(final, join(f.home, 'outside-alias.json'))
  await expect(f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' })).rejects.toThrow('HISTORY_GROUP_UNREADABLE')
})

it('refuses an oversized complete metadata response before publishing any association', async () => {
  const f = await fixture(), ids = f.workspaces.slice(0, 2).map(row => row.id)
  const bounded = new HistoryGroups(f.ctx, join(f.home, 'notes'), 1048576, 1)
  await expect(bounded.save(f.caller, 0, ids, new AbortController().signal)).rejects.toThrow('HISTORY_GROUP_LIMIT')
  expect((await f.api('search-groups', { sessionId: f.caller }) as HistoryGroupView).revision).toBe(0)
})

it('refuses a citation when the project is removed during the final caller metadata read', async () => {
  const f = await fixture(), ids = f.workspaces.slice(0, 2).map(row => row.id)
  await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 0, workspaceIds: ids })
  const page = await f.api('search', { sessionId: f.caller, query: '连接', scope: 'project' }) as HistoryPage
  const hit = page.items.find(row => row.sessionId === f.agents[1]!.session.id)!
  const persistence = f.ctx.sessionPersistence, originalObserve = persistence.observeDurable.bind(persistence)
  const originalStat = persistence.stat.bind(persistence)
  let loaded = false, callerReads = 0, removed = false
  const observe = vi.spyOn(persistence, 'observeDurable').mockImplementation(async (id, options) => {
    const result = await originalObserve(id, options); loaded = true; return result
  })
  const stat = vi.spyOn(persistence, 'stat').mockImplementation(async (id, options) => {
    const result = await originalStat(id, options)
    if (loaded && id === f.caller && ++callerReads === 2 && !removed) {
      removed = true
      await f.api('save-search-groups', { sessionId: f.caller, expectedRevision: 1, workspaceIds: [] })
    }
    return result
  })
  try {
    await expect(f.api('search-source', { sessionId: f.caller, targetSessionId: hit.sessionId, generation: hit.generation,
      seq: hit.seq, digest: hit.digest, authority: hit.authority, scope: 'project' })).rejects.toThrow('HISTORY_PROJECT_REQUIRED')
    expect(removed).toBe(true)
  } finally { observe.mockRestore(); stat.mockRestore() }
})
