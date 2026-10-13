/** Explicit local-user history associations; Workspace registrations remain the membership authority. */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, lstat, open, link, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { object, readJson, text } from './state.ts'
import type { HistoryProjectId, HistoryProject as Project, HistoryGroupView, HistoryAuthority } from './shared/notebook-types.ts'

interface State { schemaVersion: 1; revision: number; projects: Project[] }

function parse(raw: unknown): State {
  const value = object(raw)
  if (value.schemaVersion !== 1 || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.projects)) throw Error('HISTORY_GROUP_UNREADABLE')
  const workspaces = new Set<string>(), projects = new Set<string>()
  return { schemaVersion: 1, revision: value.revision, projects: value.projects.map((raw) => {
    const project = object(raw), id = brandString<HistoryProjectId>(text(project.id, 128))
    if (!id || projects.has(id) || !Array.isArray(project.members) || project.members.length < 2) throw Error('HISTORY_GROUP_UNREADABLE')
    projects.add(id)
    const members = project.members.map((raw) => {
      const member = object(raw), id = brandString<WorkspaceId>(text(member.id, 128)), path = text(member.path, 4096)
      if (!id || !path || workspaces.has(id)) throw Error('HISTORY_GROUP_UNREADABLE')
      workspaces.add(id)
      return { id, path }
    })
    if (new Set(members.map(member => member.path)).size !== members.length) throw Error('HISTORY_GROUP_UNREADABLE')
    return { id, members }
  }) }
}

/** Immutable revisions provide cross-Host CAS; temporary files are never selected or permission sources. */
export class HistoryGroups {
  private readonly directory: string
  /** @param ctx - Authenticated local-user composition with the real Workspace registry.
   * @param home - Existing managed Notebook home.
   * @param maxBytes - Maximum complete association namespace, including crash residue and a publication temporary.
   * @param maxViewBytes - Complete association metadata response budget.
   */
  constructor(private readonly ctx: Context, home: string, private readonly maxBytes: number, private readonly maxViewBytes: number) {
    this.directory = join(home, 'history-projects-v1')
  }
  private registry(): Context['workspaceRegistry'] {
    const registry = this.ctx.get('workspaceRegistry')
    if (!registry) throw Error('HISTORY_WORKSPACE_OWNER_REQUIRED')
    return registry
  }
  private async read(signal: AbortSignal): Promise<State> {
    signal.throwIfAborted()
    let files: string[]
    try { files = await readdir(this.directory) }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; files = [] }
    const revisions = files.filter(file => /^revision-[1-9][0-9]*\.json$/.test(file))
      .map(file => ({ file, revision: Number(file.slice(9, -5)) })).sort((a, b) => a.revision - b.revision)
    if (revisions.some((row, index) => !Number.isSafeInteger(row.revision) || row.revision !== index + 1)) throw Error('HISTORY_GROUP_UNREADABLE')
    const selected = revisions.at(-1)
    if (!selected) return { schemaVersion: 1, revision: 0, projects: [] }
    let state: State
    try { state = parse(await this.revision(selected.file, files, signal)) }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof Error && error.message === 'INVALID_OBJECT') throw Error('HISTORY_GROUP_UNREADABLE')
      throw error
    }
    if (state.revision !== selected.revision) throw Error('HISTORY_GROUP_UNREADABLE')
    signal.throwIfAborted()
    return state
  }
  private async revision(file: string, files: readonly string[], signal: AbortSignal): Promise<unknown> {
    const path = join(this.directory, file), info = await lstat(path)
    if (info.nlink === 1) return readJson(path, this.maxBytes)
    // A crash after exclusive publication can leave the complete temporary as a second link.
    // Only aliases in this owner's namespace count; arbitrary external hardlinks still refuse.
    if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes) throw Error('HISTORY_GROUP_UNREADABLE')
    let aliases = 1
    for (const name of files.filter(name => /^pending-[a-f0-9-]{36}$/.test(name))) {
      signal.throwIfAborted()
      let candidate
      try { candidate = await lstat(join(this.directory, name)) }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; continue }
      if (candidate.isFile() && !candidate.isSymbolicLink() && candidate.dev === info.dev && candidate.ino === info.ino) aliases++
    }
    const current = await lstat(path)
    if (current.ino !== info.ino || current.dev !== info.dev || current.nlink > aliases) throw Error('HISTORY_GROUP_UNREADABLE')
    const bytes = await readFile(path)
    if (bytes.length > this.maxBytes) throw Error('HISTORY_GROUP_LIMIT')
    const raw: unknown = JSON.parse(bytes.toString())
    return raw
  }
  private async current(caller: SessionId, signal: AbortSignal): Promise<Workspace> {
    const registry = this.ctx.get('workspaceRegistry')
    if (!registry) throw Error('HISTORY_WORKSPACE_OWNER_REQUIRED')
    const metadata = await this.ctx.sessionPersistence.stat(caller, { signal })
    const workspace = registry.list().find(row => row.sessionIds.includes(caller) && row.path === metadata?.header.cwd)
    if (!workspace || await workspace.status() !== 'ok') throw Error('HISTORY_SCOPE_REFUSED')
    signal.throwIfAborted()
    const selected = this.registry().get(workspace.id)
    if (!selected || selected.path !== workspace.path || !selected.sessionIds.includes(caller)) throw Error('HISTORY_SCOPE_REFUSED')
    return workspace
  }
  private async members(project: Project, signal: AbortSignal): Promise<void> {
    const registry = this.ctx.get('workspaceRegistry')
    if (!registry) throw Error('HISTORY_WORKSPACE_OWNER_REQUIRED')
    for (const member of project.members) {
      const workspace = registry.get(member.id)
      if (!workspace || workspace.path !== member.path || await workspace.status() !== 'ok') throw Error('HISTORY_SCOPE_REFUSED')
      signal.throwIfAborted()
      if (this.registry().get(member.id)?.path !== member.path) throw Error('HISTORY_SCOPE_REFUSED')
    }
  }
  /** Read the current project and registered directories for an explicit user selection.
   * @param caller - Current Session, actually attached to its Workspace.
   * @param signal - Request cancellation.
   * @returns Bounded metadata; a corrupt association never becomes an empty authorization set.
   */
  async view(caller: SessionId, signal: AbortSignal): Promise<HistoryGroupView> {
    const current = await this.current(caller, signal), state = await this.read(signal)
    return this.projection(current, state)
  }
  private projection(current: Workspace, state: State): HistoryGroupView {
    const result = { revision: state.revision, current: { id: current.id, path: current.path },
      project: state.projects.find(row => row.members.some(member => member.id === current.id && member.path === current.path)) ?? null,
      candidates: this.registry().list().map(row => ({ id: row.id, path: row.path, title: row.title })) }
    if (Buffer.byteLength(JSON.stringify(result)) > this.maxViewBytes) throw Error('HISTORY_GROUP_LIMIT')
    return result
  }
  /** Replace this project's membership; joining a different existing project refuses without merging it.
   * @param caller - Authenticated user-selected Session.
   * @param expectedRevision - Association revision read by the user.
   * @param ids - Explicit complete member list, including the current Workspace; an empty list dissolves its project.
   * @param signal - Cancellation before publication; a published revision is never rolled back.
   * @returns Current committed association metadata.
   */
  async save(caller: SessionId, expectedRevision: number, ids: readonly WorkspaceId[], signal: AbortSignal): Promise<HistoryGroupView> {
    const current = await this.current(caller, signal), before = await this.read(signal)
    if (expectedRevision !== before.revision) throw Error('HISTORY_GROUP_CONFLICT')
    if (before.revision >= Number.MAX_SAFE_INTEGER) throw Error('HISTORY_GROUP_LIMIT')
    if (ids.length !== new Set(ids).size || ids.length > 0 && (ids.length < 2 || !ids.includes(current.id))) throw Error('HISTORY_GROUP_SELECTION_REQUIRED')
    const previous = before.projects.find(row => row.members.some(member => member.id === current.id))
    const others = before.projects.filter(row => row !== previous)
    if (others.some(row => row.members.some(member => ids.includes(member.id)))) throw Error('HISTORY_GROUP_CONFLICT')
    const members = ids.map((id) => {
      const workspace = this.registry().get(id)
      if (!workspace) throw Error('HISTORY_SCOPE_REFUSED')
      return { id, path: workspace.path }
    })
    const project = { id: previous?.id ?? brandString<HistoryProjectId>(randomUUID()), members }
    if (ids.length) await this.members(project, signal)
    const next: State = { schemaVersion: 1, revision: before.revision + 1, projects: [...others, ...ids.length ? [project] : []] }
    this.projection(current, next)
    const bytes = JSON.stringify(next), size = Buffer.byteLength(bytes)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    let used = 0
    for (const file of await readdir(this.directory)) {
      const info = await lstat(join(this.directory, file))
      if (!info.isFile() || info.isSymbolicLink()) throw Error('HISTORY_GROUP_UNREADABLE')
      used += info.size
    }
    if (used + size * 2 > this.maxBytes) throw Error('HISTORY_GROUP_LIMIT')
    const temporary = join(this.directory, 'pending-' + randomUUID()), final = join(this.directory, 'revision-' + String(next.revision) + '.json')
    const publish = async (): Promise<void> => {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      try {
        const selected = await this.current(caller, signal)
        if (selected.id !== current.id || selected.path !== current.path) throw Error('HISTORY_SCOPE_REFUSED')
        if (ids.length) await this.members(project, signal)
        signal.throwIfAborted()
        try { await link(temporary, final) }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw Error('HISTORY_GROUP_CONFLICT'); throw error }
      } finally { await unlink(temporary) }
    }
    const storage = this.ctx.get('nidofyStorage')
    await (storage ? storage.write(final, size * 2, publish) : publish())
    return this.view(caller, new AbortController().signal)
  }
  /** Capture explicit authority for a project search; exact-cwd searches do not use it.
   * @param caller - Current Workspace-attached Session.
   * @param signal - Request cancellation.
   * @returns Validated project membership and its immutable revision.
   */
  async capture(caller: SessionId, signal: AbortSignal): Promise<HistoryAuthority> {
    const current = await this.current(caller, signal), state = await this.read(signal)
    const project = state.projects.find(row => row.members.some(member => member.id === current.id && member.path === current.path))
    if (!project) throw Error('HISTORY_PROJECT_REQUIRED')
    await this.members(project, signal)
    return { revision: state.revision, projectId: project.id, members: project.members }
  }
  /** Recheck durable association, actual registration, attachment and exact header cwd.
   * @param caller - Current Session.
   * @param target - Candidate Session, or omitted for an authority-only check.
   * @param authority - Previously captured project and revision.
   * @param signal - Request cancellation.
   * @returns Resolution only while all authorization observations still match.
   */
  async validate(caller: SessionId, target: SessionId | undefined, authority: HistoryAuthority, signal: AbortSignal): Promise<void> {
    const current = await this.capture(caller, signal)
    if (JSON.stringify(current) !== JSON.stringify(authority)) throw Error('HISTORY_GROUP_CONFLICT')
    if (target !== undefined) {
      const metadata = await this.ctx.sessionPersistence.stat(target, { signal })
      if (!current.members.some(member => member.path === metadata?.header.cwd
        && this.registry().get(member.id)?.sessionIds.includes(target))) throw Error('HISTORY_SCOPE_REFUSED')
    }
    if ((await this.read(signal)).revision !== authority.revision) throw Error('HISTORY_GROUP_CONFLICT')
    if (!current.members.some(member => this.registry().get(member.id)?.sessionIds.includes(caller))) throw Error('HISTORY_SCOPE_REFUSED')
    signal.throwIfAborted()
  }
}
