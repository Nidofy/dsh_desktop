/** Optional conversation tone is committed locally and captured once per turn in the official system prompt. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, lstat } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import type { CompanionScope } from '@nidofy/dsh-desktop-extras/context'
import { readRecord } from '../workbench/verification-storage.ts'
import type { ConnectionStore } from '../connections/store.ts'
import { object } from '../connections/store.ts'
import { unlinked } from '../selftest/store.ts'
import { captureCompanionAuthority, parseCompanionScope } from './scope.ts'

const tone = 'Use a warm, concise companion tone only in conversational explanations. Preserve precise technical meaning. Do not apply character jokes or mannerisms to code, commands, formal reports, quoted material or deliverables. Tone grants no additional permissions or tools.'
type Receipt = { id: string; ticket: string; sessionId: string; enabled: boolean; revision: number; effective: 'next-turn' }
type State = { schemaVersion: 1; revision: number; enabledSessions: string[]; operations: Receipt[] }
type Preview = { scope: CompanionScope; enabled: boolean; revision: number; expiresAt: number; check(): void }
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
function decode(raw: unknown): State {
  const value = object(raw)
  if (Object.keys(value).sort().join() !== 'enabledSessions,operations,revision,schemaVersion' || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.enabledSessions)
    || value.enabledSessions.length > 128 || value.enabledSessions.some(id => typeof id !== 'string' || !id || id.length > 128)
    || new Set(value.enabledSessions).size !== value.enabledSessions.length || !Array.isArray(value.operations) || value.operations.length > 128) throw Error('STYLE_SETTINGS_INVALID')
  const operations = value.operations.map((raw) => {
    const row = object(raw)
    if (Object.keys(row).sort().join() !== 'effective,enabled,id,revision,sessionId,ticket' || typeof row.id !== 'string' || !uuid.test(row.id)
      || typeof row.ticket !== 'string' || !uuid.test(row.ticket) || typeof row.sessionId !== 'string' || !row.sessionId || row.sessionId.length > 128
      || typeof row.enabled !== 'boolean' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || Number(row.revision) > Number(value.revision)
      || row.effective !== 'next-turn') throw Error('STYLE_SETTINGS_INVALID')
    return row as Receipt
  })
  return { schemaVersion: 1, revision: Number(value.revision), enabledSessions: value.enabledSessions as string[], operations }
}
/** Exact boolean choices never accept arbitrary prompts, configuration paths or executor URLs. */
export class CompanionStyleOwner {
  private state: State = { schemaVersion: 1, revision: 0, enabledSessions: [], operations: [] }
  private readonly previews = new Map<string, Preview>()
  private readonly turns = new Map<SessionId, { turn: number; enabled: boolean }>()
  private readonly ready: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private unregister: (() => void)[] = []
  private closed = false
  private readonly path: string
  constructor(private readonly ctx: Context, private readonly connections: ConnectionStore, home: string,
    private readonly storage: Pick<StorageService, 'write'>) {
    this.path = join(home, 'nidofy-extras', 'companion-style-v1.json')
    const path = this.path
    this.ready = (async () => {
      await unlinked(path)
      try {
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024) throw Error('STYLE_SETTINGS_INVALID')
        const bytes = await readRecord(path)
        if (!bytes || bytes.length > 64 * 1024) throw Error('STYLE_SETTINGS_INVALID')
        this.state = decode(JSON.parse(bytes.toString()))
      }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      if (!this.closed) this.reconcile()
    })()
    void this.ready.catch(() => { /* Explicit reads report corrupt preferences; bytes are preserved. */ })
  }
  private reconcile(): void {
    const enabled = this.state.enabledSessions.length > 0 || [...this.turns.values()].some(row => row.enabled)
    if (!enabled || this.closed) { this.unregister.splice(0).forEach((off) =>{  off() }); return }
    if (this.unregister.length) return
    this.unregister.push(this.ctx.systemPrompt.section({ name: 'nidofy:companion-tone', order: 800, interpolate: false,
      text: ({ agent }) => {
        if (!agent) return ''
        const boundary = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')
        if (!boundary) throw Error('STYLE_TURN_OWNER_UNAVAILABLE')
        if (boundary.openTurnStartSeq === null) return ''
        const id = agent.session.id, previous = this.turns.get(id)
        if (!previous || previous.turn !== boundary.lastTurn) {
          this.turns.set(id, { turn: boundary.lastTurn, enabled: this.state.enabledSessions.includes(id) })
        }
        return this.turns.get(id)?.enabled ? tone : ''
      } }), this.ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') { this.turns.delete(session.id); this.reconcile() }
    }))
  }
  /** @param method - read, preview or execute. @param data - Exact boolean intent and full foreground scope.
   * @param signal - Current connected UI lifetime. @returns Durable receipt with next-turn semantics; duplicate IDs never write twice.
   */
  async request(method: string, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    await this.ready; signal.throwIfAborted(); if (this.closed) throw Error('STYLE_OWNER_CLOSED')
    const scope = parseCompanionScope(data.scope), check = captureCompanionAuthority(this.ctx, this.connections, scope)
    check()
    if (method === 'read' && Object.keys(data).length === 1) return { revision: this.state.revision, enabled: this.state.enabledSessions.includes(scope.sessionId), effective: 'next-turn' }
    if (method === 'preview' && Object.keys(data).sort().join() === 'enabled,scope' && typeof data.enabled === 'boolean') {
      for (const [id, plan] of this.previews) if (plan.expiresAt <= Date.now()) this.previews.delete(id)
      if (this.previews.size >= 16) throw Error('STYLE_PREVIEW_LIMIT')
      const ticket = randomUUID(), expiresAt = Date.now() + 60000
      this.previews.set(ticket, { scope, enabled: data.enabled, revision: this.state.revision, expiresAt, check })
      return { ticket, enabled: data.enabled, revision: this.state.revision, expiresAt, effective: 'next-turn' }
    }
    if (method !== 'execute' || Object.keys(data).sort().join() !== 'accepted,id,scope,ticket' || data.accepted !== true
      || typeof data.id !== 'string' || !uuid.test(data.id) || typeof data.ticket !== 'string') throw Error('STYLE_ACTION_REFUSED')
    const id = data.id, ticket = data.ticket
    const work = this.queue.catch(() => {}).then(async () => {
      signal.throwIfAborted(); check(); if (this.closed) throw Error('STYLE_OWNER_CLOSED')
      const prior = this.state.operations.find(row => row.id === id)
      if (prior) {
        if (prior.ticket !== ticket || prior.sessionId !== scope.sessionId) throw Error('STYLE_OPERATION_CONFLICT')
        return { status: 'ALREADY_APPLIED', ...prior }
      }
      const preview = this.previews.get(ticket); this.previews.delete(ticket)
      if (!preview || preview.expiresAt <= Date.now() || preview.revision !== this.state.revision
        || JSON.stringify(scope) !== JSON.stringify(preview.scope)) throw Error('STYLE_PREVIEW_EXPIRED')
      preview.check()
      const sessionId = scope.sessionId, enabledSessions = this.state.enabledSessions.filter(id => id !== sessionId)
      if (preview.enabled) enabledSessions.push(sessionId)
      if (enabledSessions.length > 128 || this.state.operations.length >= 128) throw Error('STYLE_HISTORY_LIMIT')
      const receipt: Receipt = { id, ticket, sessionId, enabled: preview.enabled, revision: this.state.revision + 1, effective: 'next-turn' }
      const next = decode({ schemaVersion: 1, revision: receipt.revision, enabledSessions,
        operations: [...this.state.operations, receipt] })
      const bytes = JSON.stringify(next)
      await this.storage.write(this.path, 2 * Buffer.byteLength(bytes), async () => {
        signal.throwIfAborted(); preview.check(); await unlinked(this.path)
        await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
        await writeFileAtomic(this.path, bytes, { mode: 0o600 })
      })
      this.state = next; this.reconcile()
      return { status: 'APPLIED', ...receipt }
    })
    this.queue = work; return work
  }
  /** Withdraw the prompt section and listeners after all admitted preference writes settle. */
  async close(): Promise<void> {
    this.closed = true; await Promise.allSettled([this.ready, this.queue]); this.previews.clear(); this.turns.clear(); this.reconcile()
  }
}
