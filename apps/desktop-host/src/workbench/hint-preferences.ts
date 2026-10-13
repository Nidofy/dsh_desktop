/** Independent user Hint preferences under existing action storage/quota with immutable revision CAS. */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { HintPreferences, HintId } from '@nidofy/dsh-desktop-extras/context'
import { object } from '../connections/store.ts'
import { publishRecord, readRecord } from './verification-storage.ts'

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const pathText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0')
const filename = (revision: number): string => String(revision).padStart(16, '0') + '.json'

/** Ignore, snooze, exact-project mute and offered-card deduplication never handle or claim a notice. */
export class HintPreferencesOwner {
  private readonly root: string
  private stopping = false
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly ctx: Context, home: string) { this.root = join(home, 'desktop-actions/companion-hints/preferences') }
  /** Read the last complete revision; damaged or future records refuse without resetting user choices.
   * @returns Current immutable preferences; an absent namespace has empty revision zero.
   */
  async read(): Promise<HintPreferences> {
    let names: string[]
    try { names = await readdir(this.root) }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      names = []
    }
    if (names.length > 8192) throw Error('HINT_PREFERENCES_HISTORY_LIMIT')
    const last = names.filter(name => /^\d{16}\.json$/.test(name)).sort().at(-1)
    if (!last) return { revision: 0, ignored: [], snoozed: [], muted: [], offered: [] }
    const bytes = await readRecord(join(this.root, last))
    if (!bytes) throw Error('HINT_PREFERENCES_UNKNOWN')
    const value: unknown = JSON.parse(bytes.toString('utf8')), row = object(value)
    if (row.schemaVersion !== 1) throw Error('HINT_PREFERENCES_SCHEMA_UNSUPPORTED')
    if (!integer(row.revision) || row.revision < 1 || filename(row.revision) !== last
      || !Array.isArray(row.ignored) || !row.ignored.every(id) || new Set(row.ignored).size !== row.ignored.length
      || !Array.isArray(row.offered) || !row.offered.every(id) || new Set(row.offered).size !== row.offered.length
      || !Array.isArray(row.snoozed) || !Array.isArray(row.muted)) throw Error('HINT_PREFERENCES_REFUSED')
    const snoozed = row.snoozed.map((value: unknown) => {
      const record = object(value)
      if (!id(record.id) || !integer(record.until)) throw Error('HINT_PREFERENCES_REFUSED')
      return { id: brandString<HintId>(record.id), until: record.until }
    })
    const muted = row.muted.map((value: unknown) => {
      const record = object(value)
      if (!pathText(record.workspaceId) || !pathText(record.path)) throw Error('HINT_PREFERENCES_REFUSED')
      return { workspaceId: brandString<WorkspaceId>(record.workspaceId), path: record.path }
    })
    if (new Set(snoozed.map(row => row.id)).size !== snoozed.length
      || new Set(muted.map(row => JSON.stringify(row))).size !== muted.length) throw Error('HINT_PREFERENCES_REFUSED')
    return { revision: row.revision, ignored: row.ignored.map(value => brandString<HintId>(value)),
      offered: row.offered.map(value => brandString<HintId>(value)), snoozed, muted }
  }
  /** Persist one local user's viewing choice, or offer acknowledgement, with exclusive CAS.
   * @param input - Last observed preference revision and the explicit operation; project mute requires actual attachment.
   * @param signal - Request lifetime; cancellation before publication refuses, an unknown commit must be reread.
   * @returns Committed preference snapshot; conflicts never overwrite another window's choices.
   */
  async edit(input: Record<string, unknown>, signal: AbortSignal): Promise<HintPreferences> {
    if (this.stopping) throw Error('HINT_OWNER_STOPPING')
    const work = this.commit(input, signal)
    this.pending.add(work)
    try { return await work } finally { this.pending.delete(work) }
  }
  private async commit(input: Record<string, unknown>, signal: AbortSignal): Promise<HintPreferences> {
    const { expectedRevision, action } = input
    if (!integer(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER) throw Error('HINT_PREFERENCES_INVALID')
    signal.throwIfAborted()
    const current = await this.read()
    if (current.revision !== expectedRevision) throw Error('HINT_PREFERENCES_CONFLICT')
    const row = { schemaVersion: 1, revision: expectedRevision + 1, ignored: [...current.ignored],
      snoozed: [...current.snoozed], muted: [...current.muted], offered: [...current.offered] }
    if (action === 'ignore' || action === 'snooze') {
      if (!id(input.id)) throw Error('HINT_PREFERENCES_INVALID')
      const selectedId = brandString<HintId>(input.id)
      if (action === 'ignore') row.ignored = [...new Set([...row.ignored, selectedId])]
      else {
        if (!integer(input.until) || input.until <= Date.now()) throw Error('HINT_PREFERENCES_INVALID')
        row.snoozed = [...row.snoozed.filter(value => value.id !== selectedId), { id: selectedId, until: input.until }]
      }
    } else if (action === 'offered') {
      if (!Array.isArray(input.ids) || input.ids.length > 16 || !input.ids.every(id)) throw Error('HINT_PREFERENCES_INVALID')
      row.offered = [...new Set([...row.offered, ...input.ids.map(value => brandString<HintId>(value))])]
    } else if (action === 'mute' || action === 'unmute') {
      if (!pathText(input.sessionId) || !pathText(input.workspaceId) || !pathText(input.path)) throw Error('HINT_PROJECT_REQUIRED')
      const sessionId = SessionId(input.sessionId), registry = this.ctx.get('workspaceRegistry')
      const workspaceId = brandString<WorkspaceId>(input.workspaceId)
      const meta = await this.ctx.sessionPersistence.stat(sessionId, { signal })
      const workspace = registry?.get(workspaceId)
      if (!workspace || workspace.path !== input.path || meta?.header.cwd !== workspace.path
        || !workspace.sessionIds.includes(sessionId) || !(await stat(workspace.path)).isDirectory()
        || registry?.get(workspaceId)?.path !== input.path || !registry.get(workspaceId)?.sessionIds.includes(sessionId))
        throw Error('HINT_PROJECT_CHANGED')
      row.muted = row.muted.filter(value => value.workspaceId !== workspaceId || value.path !== input.path)
      if (action === 'mute') row.muted.push({ workspaceId, path: workspace.path })
    } else if (action === 'reset') {
      row.ignored = []; row.snoozed = []; row.muted = []; row.offered = []
    } else throw Error('HINT_ACTION_UNAVAILABLE')
    signal.throwIfAborted()
    if (this.stopping) throw Error('HINT_OWNER_STOPPING')
    let names: string[]
    try { names = await readdir(this.root) }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      names = []
    }
    if (names.length + 2 > 8192) throw Error('HINT_PREFERENCES_HISTORY_LIMIT')
    signal.throwIfAborted()
    if (!await publishRecord(join(this.root, filename(row.revision)), JSON.stringify(row))) throw Error('HINT_PREFERENCES_CONFLICT')
    return { revision: row.revision, ignored: row.ignored, snoozed: row.snoozed, muted: row.muted, offered: row.offered }
  }
  /** Reject new edits and await every admitted publication before owner disposal. */
  async close(): Promise<void> { this.stopping = true; await Promise.allSettled(this.pending) }
}
