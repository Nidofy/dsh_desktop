/** Native scoped snapshots gate the official pre-step and tool dispatch hooks. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { relative, isAbsolute } from 'node:path'
import { object } from './store.ts'
import type {} from '@nidofy/dsh-desktop-extras/storage'

type Binding = { sessionId: string; turn: number; engineId: string; requestId: string }
type Capture = { id: string; binding: Binding; workspace: string }
const uuid = (): string => randomUUID().replaceAll('-', '')
const inside = (root: string, path: string): boolean => { const rel = relative(root, path); return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') }
const fingerprint = (value: object): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Send bounded JSON through inherited pipes; the helper has no network listener.
 * @param executable - Packaged, application-owned Win32 helper.
 * @param home - Isolated distribution storage.
 * @param command - Native command, never model-provided authority.
 * @returns Validated helper result or a closed failure.
 */
export function nativeProtection(executable: string, home: string, command: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, [home], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error('PROTECTION_UNAVAILABLE')); return }
      try {
        const response = object(JSON.parse(stdout) as unknown)
        if (response.ok !== true) throw new Error('PROTECTION_UNAVAILABLE')
        resolve(object(response.value))
      } catch (_error) { reject(new Error('PROTECTION_UNAVAILABLE')) }
    })
    child.stdin?.on('error', () =>{  reject(new Error('PROTECTION_UNAVAILABLE')) })
    child.stdin?.end(JSON.stringify(command))
  })
}

/** Coordinate captures across independent roots and reference-count a parent/child task group. */
export class ProtectionOwner {
  private tail: Promise<void> = Promise.resolve()
  private readonly epoch = uuid()
  private readonly active = new Map<string, Capture | null>()
  private failed = false
  constructor(private readonly call: (command: object) => Promise<Record<string, unknown>>) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work)
    this.tail = pending.then(() => {}, () => {})
    return pending
  }
  /** Native scope configuration is local-user-only and excluded while a protected turn runs. */
  configure(input: unknown): Promise<Record<string, unknown>> {
    const request = object(input)
    if (!['scopes', 'arm', 'disarm', 'list', 'details', 'preview', 'restore', 'capture', 'seal', 'export',
      'verifyArchive', 'importArchive'].includes(String(request.action))) throw new Error('PROTECTION_ACTION_UNAVAILABLE')
    return this.serial(async () => {
      const managementWrite = ['capture', 'seal', 'export', 'importArchive'].includes(String(request.action))
      if ((managementWrite || ['arm', 'disarm', 'restore'].includes(String(request.action)))
        && this.active.size > 0) throw new Error('PROTECTION_BUSY')
      if (managementWrite && this.failed) throw new Error('PROTECTION_RESTART_REQUIRED')
      if (request.action === 'importArchive' && (typeof request.expectedRevision !== 'string'
        || !/^[a-f0-9]{64}$/.test(request.expectedRevision))) throw Error('PROTECTION_ARCHIVE_PREVIEW_REQUIRED')
      if (request.action === 'preview') {
        const value = await this.call({ action: 'ui', request })
        return { ...value, revision: fingerprint(value) }
      }
      if (request.action === 'restore') {
        if (this.failed) throw new Error('PROTECTION_RESTART_REQUIRED')
        const value = await this.call({ action: 'ui', request: { action: 'preview', id: request.id } })
        if (request.expectedRevision !== fingerprint(value)) throw new Error('PROTECTION_PREVIEW_CONFLICT')
        try { return await this.call({ action: 'ui', request: { action: 'restore', id: request.id, paths: request.paths } }) }
        catch (error) { this.failed = true; throw error }
      }
      if (managementWrite) {
        try { return await this.call({ action: 'ui', request }) }
        catch (error) {
          // A changed preview failed before import writes; other unknown results need restart before another mutation.
          if (!(error instanceof Error) || error.message !== 'PROTECTION_ARCHIVE_PREVIEW_CONFLICT') this.failed = true
          throw error
        }
      }
      return this.call({ action: 'ui', request })
    })
  }
  /** Admit a turn only after a confirmed native capture; overlapping protected turns fail closed. */
  begin(sessionId: string, turn: number, workspace: string | undefined, parentId?: string): Promise<void> {
    return this.serial(async () => {
      if (this.failed) throw new Error('PROTECTION_RESTART_REQUIRED')
      if (this.active.has(sessionId)) return
      const scopes = await this.call({ action: 'ui', request: { action: 'scopes' } })
      if (!Array.isArray(scopes.items)) throw new Error('PROTECTION_UNAVAILABLE')
      if (scopes.items.some(item => typeof object(item).workspace !== 'string')) throw new Error('PROTECTION_UNAVAILABLE')
      if (scopes.items.length === 0) { this.active.set(sessionId, null); return }
      if (!workspace) throw new Error('PROTECTION_WORKSPACE_REQUIRED')
      const resolved = await this.call({ action:'resolve',workspace })
      if (resolved.status === 'DISABLED') { this.active.set(sessionId, null); return }
      const scopeRoot = resolved.workspace
      if (resolved.status !== 'ARMED' || typeof scopeRoot !== 'string') throw new Error('PROTECTION_UNAVAILABLE')
      const overlap = [...this.active.values()].find(value => value !== null
        && (inside(value.workspace, scopeRoot) || inside(scopeRoot, value.workspace)))
      if (overlap) {
        if (parentId === undefined || this.active.get(parentId) !== overlap || overlap.workspace !== scopeRoot) throw new Error('PROTECTION_BUSY')
        await this.call({ action: 'check', id: overlap.id, binding: overlap.binding })
        this.active.set(sessionId, overlap); return
      }
      const binding = { sessionId, turn, engineId: this.epoch, requestId: uuid() }
      try {
        const result = await this.call({ action: 'begin', workspace, binding, expiresAt: Date.now() + 14_000 })
        if (result.status === 'DISABLED') { this.active.set(sessionId, null); return }
        if (result.status !== 'CONFIRMED' || typeof result.id !== 'string') throw new Error('PROTECTION_UNAVAILABLE')
        this.active.set(sessionId, { id: result.id, binding, workspace: scopeRoot })
      } catch (error) { this.failed = true; throw error }
    })
  }
  /** All tool dispatch paths require admission; native identity is rechecked before execution. */
  check(sessionId?: string): Promise<void> {
    return this.serial(async () => {
      if (this.failed) throw new Error('PROTECTION_RESTART_REQUIRED')
      if (sessionId === undefined || !this.active.has(sessionId)) {
        const scopes = await this.call({ action: 'ui', request: { action: 'scopes' } })
        if (!Array.isArray(scopes.items) || scopes.items.length > 0) throw new Error('PROTECTION_ADMISSION_REQUIRED')
        return
      }
      const capture = this.active.get(sessionId)
      if (capture) {
        try { await this.call({ action: 'check', id: capture.id, binding: capture.binding }) }
        catch (error) { this.failed = true; throw error }
      }
    })
  }
  /** Seal once on the official turn-end fact; unknown completion blocks subsequent admission. */
  end(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const capture = this.active.get(sessionId)
      this.active.delete(sessionId)
      try { if (capture && ![...this.active.values()].includes(capture)) await this.call({ action: 'end', id: capture.id, binding: capture.binding, expiresAt: Date.now() + 14_000 }) }
      catch (error) { this.failed = true; throw error }
      finally { this.active.delete(sessionId) }
    })
  }
  /** Await owned native operations during Host shutdown. */
  drain(): Promise<void> { return this.tail }
}

/** Mount protection on official lifecycle hooks; child sessions use the same admission rules.
 * @param ctx - Running Desktop Host.
 * @param home - Isolated distribution storage.
 * @param executable - Packaged helper path.
 * @returns Local-user configuration owner.
 */
export function installProtection(ctx: Context, home: string, executable: string): ProtectionOwner {
  const storage = ctx.get('nidofyStorage')
  const owner = new ProtectionOwner(command => storage ? storage.native(object(command)) : nativeProtection(executable, home, command))
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
    signal.throwIfAborted()
    const parent = ctx.agents.list().find(candidate => ctx.agents.isOwnedBy(agent.session.id, candidate))
    await owner.begin(String(agent.session.id), turn, agent.session.header.cwd, parent && String(parent.session.id))
    signal.throwIfAborted()
    return next()
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    await owner.check(exec.agent === undefined ? undefined : String(exec.agent.session.id))
    return next()
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') void owner.end(String(session.id)).catch(() =>{  ctx.logger.warn('Protection sealing needs inspection') })
  })
  ctx.effect(() => () => owner.drain())
  return owner
}
