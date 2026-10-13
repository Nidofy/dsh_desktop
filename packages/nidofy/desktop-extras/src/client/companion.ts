/** Explicit Desktop scope and cancellable reads over official Client owners. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandNumber, brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { CompanionFacts, HintPreferences } from '../shared/companion-facts.ts'
import { readCompanionFacts, readHintPreferences } from './facts.ts'
import { deriveHints, type Hint, type HintId, type CompanionReturnCard } from './hints.ts'

import type { CompanionScope, CompanionHostEpoch, CompanionWindowId, CompanionViewId } from '../shared/companion-scope.ts'
export type { CompanionScope, CompanionHostEpoch, CompanionWindowId, CompanionViewId } from '../shared/companion-scope.ts'
/** T11 receipt identity validated from the actual notification source. */
export type CompanionReceiptId = Branded<'nidofy.VerificationReceiptId'>
/** T12 notice identity; consumers neither mint it nor infer it from copy. */
export type CompanionNoticeId = Branded<'nidofy.NoticeId'>
/** Bounded facts for renderers; Session completion carries no test or acceptance conclusion. */
export interface CompanionView {
  readonly scope: CompanionScope
  readonly connected: boolean
  readonly state: 'idle' | 'working' | 'waiting' | 'disconnected'
  readonly notebook: 'available' | 'disabled' | 'unavailable'
  readonly model: 'known' | 'unknown'
  readonly receiptId: CompanionReceiptId | null
  readonly noticeIds: readonly CompanionNoticeId[]
  /** Current read-only evidence; withdrawn on every scope invalidation. */
  readonly facts: CompanionFacts | null
  readonly hintPreferences: HintPreferences | null
  readonly hints: readonly Hint[]
  readonly returnCard: CompanionReturnCard | null
  /** Registered navigation commands currently admitted by the observed official owners. */
  readonly actions: readonly CompanionAction[]
}
/** Local-user navigation only; execution, approval and acceptance stay with their existing owners. */
export type CompanionAction = 'builds' | 'artifacts' | 'protection' | 'pets' | 'connections' | 'environment' | 'approval' | 'conversation'
/** Desktop bridge installed by preload, without Electron or Host credentials in business components. */
export interface CompanionDesktop {
  windowIdentity(): Promise<number>
  openPanel(panel: string, workspace: string | undefined, scope: CompanionScope): Promise<void>
}
/** Public consumer face for the Environment, Notebook and character renderer. */
export interface Companion {
  readonly view: ObservableSnapshot<CompanionView>
  /** One explicitly retained attention target, independent of subsequent foreground navigation. */
  readonly attention: ObservableSnapshot<CompanionView | null>
  /** Retain the observed Session without changing the foreground or persisting a restart intention.
   * @param scope - Current foreground observation selected by the user.
   */
  follow(scope: CompanionScope): void
  /** Release the explicit attention reference and every attached subscription. */
  releaseAttention(): void
  /** Navigate only after checking the complete currently observed attention scope.
   * @param scope - Latest attention observation; an old Host or permission revision refuses.
   */
  openAttention(scope: CompanionScope): void
  /** Validate every field against the current scope.
   * @param scope - Previously observed full scope.
   * @returns Whether it still belongs to this connected owner.
   */
  current(scope: CompanionScope): boolean
  /** Cancel on scope invalidation and refuse late results, including operations ignoring cancellation.
   * @param scope - Exact scope observed by the user.
   * @param operation - Existing owner's operation, supplied with cancellation.
   * @param signal - Optional consumer lifetime.
   * @returns The result only while this scope is still current.
   */
  using<T>(scope: CompanionScope, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>
  /** Read bounded committed Notebook/notice facts on demand without synchronization or rebinding.
   * @param scope - Current explicit scope.
   * @returns Updated bounded view; old generation failures remain unavailable.
   */
  refresh(scope: CompanionScope): Promise<CompanionView>
  /** Persist one explicit viewing choice with the observed independent preference revision.
   * @param scope - Current complete scope; navigation invalidates the response without replaying a commit.
   * @param action - Ignore/snooze one current Hint, mute/unmute the actual project, or explicitly reset choices.
   * @param id - Current Hint identity for ignore or snooze.
   * @param until - Explicit future epoch time for snooze.
   * @returns Committed preferences; a lost result requires reread, never automatic retry.
   */
  preferHints(scope: CompanionScope, action: 'ignore' | 'snooze' | 'mute' | 'unmute' | 'reset', id?: HintId, until?: number): Promise<void>
  /** Acknowledge the currently displayed return offer without handling any notice.
   * @param scope - Complete scope of the visible card.
   * @returns Committed offer identities; unavailable/unknown results are not automatically replayed.
   */
  offeredHints(scope: CompanionScope): Promise<void>
  /** Delegate one explicit navigation to preload after checking the entire scope.
   * @param scope - Current explicit scope.
   * @param action - Registered navigation action.
   * @returns Completion while scope remains current.
   */
  open(scope: CompanionScope, action: CompanionAction): Promise<void>
}
declare module '@deepseek-ai/cordis' {
  interface Context { companion: Companion }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { companionAttention: unknown }
}

const emptyScope: CompanionScope = { hostEpoch: null, windowId: null, viewId: null, panelId: null,
  workspaceId: null, sessionId: null, turn: null, revision: 0 }
const emptyView: CompanionView = { scope: emptyScope, connected: false, state: 'disconnected',
  notebook: 'unavailable', model: 'unknown', receiptId: null, noticeIds: [], facts: null,
  hintPreferences: null, hints: [], returnCard: null, actions: [] }

/** Read the complete HTTP payload under a byte ceiling before decoding JSON.
 * @param path - Existing authenticated local owner endpoint.
 * @param input - Explicit owner request.
 * @param signal - Scope and consumer lifetime.
 * @returns Decoded value; oversized, refused or cancelled responses reject.
 */
export async function companionRequest(path: string, input: object, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input), signal })
  if (!response.body) throw Error('COMPANION_READ_UNAVAILABLE')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1024 * 1024) throw Error('COMPANION_PAYLOAD_LIMIT')
      chunks.push(chunk.value)
    }
  } finally {
    try { await reader.cancel() } finally { reader.releaseLock() }
  }
  signal.throwIfAborted()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'error' in value ? value.error : undefined
    throw Error(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(code) ? code : 'COMPANION_READ_UNAVAILABLE')
  }
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('COMPANION_RESPONSE_INVALID')
  return { ...value }
}

/** React-free owner; subscriptions remain active independently of pets, Notebook and rail visibility. */
export class CompanionOwner extends Service implements Companion {
  readonly view = createSnapshotStore<CompanionView>(emptyView)
  readonly attention = createSnapshotStore<CompanionView | null>(null)
  private attentionReference: SessionReference | undefined
  private readonly attentionDisposers: (() => void)[] = []
  private readonly lifetime = new AbortController()
  private epoch = new AbortController()
  private bootstrap = new AbortController()
  private capability = new AbortController()
  private factsRead = new AbortController()
  private returnPending = false
  private readonly offeredInLifetime = new Set<HintId>()
  private readonly jobs = new Set<Promise<unknown>>()
  private readonly pendingKeys = new WeakMap<CompanionView, string | undefined>()
  private readonly disposers: (() => void)[] = []
  private disposeBinding: (() => void)[] = []
  private binding: SessionBinding | undefined
  private hostEpoch: CompanionHostEpoch | null = null
  private windowId: CompanionWindowId | null = null
  private notebook: CompanionView['notebook'] = 'unavailable'
  private generation: unknown
  private readonly connection: ConnectionHandle
  constructor(ctx: Context, private readonly desktop: CompanionDesktop,
    private readonly request = companionRequest) {
    super(ctx, 'companion')
    this.connection = ctx.get('connection') as ConnectionHandle
    this.disposers.push(ctx.uiSession.mainBinding.subscribe(() => { this.bind() }),
      ctx.workspaces.list.subscribe(() => { this.publish() }),
      ctx.layout.panelInfo.subscribe(() => { this.publish() }),
      this.connection.generation.subscribe(() => { this.connected() }),
      ctx.slots.subscribe('nidofy.notebook', () => { this.capabilityChanged() }),
      ctx.uiSession.sessionStatus.subscribe(() => { this.publish() }))
    ctx.effect(() => () => this.close(), 'companion: subscriptions and reads')
    this.bind()
    this.connected()
  }
  private track<T>(job: Promise<T>): Promise<T> {
    this.jobs.add(job)
    void job.finally(() => { this.jobs.delete(job) }).catch(() => { /* The initiating caller receives the failure. */ })
    return job
  }
  private bind(): void {
    const next = this.ctx.uiSession.mainBinding.getSnapshot()
    if (next === this.binding) return
    this.returnPending = this.binding !== undefined && next !== undefined
    for (const dispose of this.disposeBinding) dispose()
    this.disposeBinding = []
    this.binding = next
    if (next) {
      const conversation = this.ctx.uiConversation.binding(next)
      const permissions = next.session.projections.faceOf('permissions')
      this.disposeBinding.push(next.session.subscribe(() => { this.publish() }),
        next.eventSource.subscribe(() => { this.publish(true) }),
        conversation.openTurn.subscribe(() => { this.publish() }),
        conversation.selectedView.subscribe(() => { this.publish() }),
        next.session.projections.faceOf('modelSelection').subscribe(() => { this.publish() }),
        permissions.subscribe(() => {
          this.publish(true)
        }))
    }
    this.publish(true)
  }
  private connected(): void {
    const generation = this.connection.generation.getSnapshot()
    if (generation === this.generation) return
    this.generation = generation
    this.capability.abort()
    this.bootstrap.abort()
    this.bootstrap = new AbortController()
    this.hostEpoch = null
    this.notebook = 'unavailable'
    this.publish(true)
    if (!generation) return
    const signal = AbortSignal.any([this.bootstrap.signal, this.lifetime.signal])
    const job = Promise.all([this.desktop.windowIdentity(), this.request('/api/nidofy/companion', { action: 'bootstrap' }, signal)])
      .then(([windowId, raw]) => {
        signal.throwIfAborted()
        if (this.generation !== generation) return
        const row = object(raw)
        if (!Number.isSafeInteger(windowId) || windowId < 1 || typeof row.hostEpoch !== 'string'
          || !/^[a-f0-9-]{36}$/.test(row.hostEpoch)
          || row.notebook !== 'available' && row.notebook !== 'unavailable' && row.notebook !== 'disabled') {
          throw Error('COMPANION_RESPONSE_INVALID')
        }
        this.windowId = brandNumber<CompanionWindowId>(windowId)
        this.hostEpoch = brandString<CompanionHostEpoch>(row.hostEpoch)
        this.notebook = row.notebook
        this.publish(true)
      }).catch((error: unknown) => {
        if (!signal.aborted) { this.publish(true); console.warn('Companion bootstrap unavailable', error) }
      })
    void this.track(job)
  }
  private capabilityChanged(): void {
    if (!this.hostEpoch || !this.generation || this.lifetime.signal.aborted) return
    this.capability.abort()
    this.capability = new AbortController()
    const generation = this.generation
    const signal = AbortSignal.any([this.capability.signal, this.lifetime.signal])
    // A real contribution lifecycle edge withdraws the prior observation before one bounded reread.
    this.notebook = 'unavailable'
    this.publish(true)
    void this.track(this.request('/api/nidofy/companion', { action: 'bootstrap' }, signal).then((raw) => {
      signal.throwIfAborted()
      if (this.generation !== generation) return
      const row = object(raw)
      if (typeof row.hostEpoch !== 'string' || !/^[a-f0-9-]{36}$/.test(row.hostEpoch)
        || row.notebook !== 'available' && row.notebook !== 'unavailable' && row.notebook !== 'disabled') {
        throw Error('COMPANION_RESPONSE_INVALID')
      }
      this.hostEpoch = brandString<CompanionHostEpoch>(row.hostEpoch)
      this.notebook = row.notebook
      this.publish(true)
    }).catch((error: unknown) => {
      if (!signal.aborted) console.warn('Companion capability unavailable', error)
    }))
  }
  private publish(force = false): void {
    if (this.lifetime.signal.aborted) return
    const previous = this.view.getSnapshot(), binding = this.binding
      && this.ctx.sessions.binding(this.binding.sessionId) === this.binding ? this.binding : undefined
    const value = this.project(binding, this.ctx.layout.panelInfo.getSnapshot().activePanelId, previous, force)
    if (value.scope !== previous.scope) { this.epoch.abort(); this.epoch = new AbortController() }
    if (JSON.stringify(value) !== JSON.stringify(previous)) this.view.set(value)
    this.publishAttention()
    if (this.returnPending && value.connected && binding?.session.getSnapshot().openState === 'open') {
      this.returnPending = false
      void this.refresh(value.scope).then((view) => {
        if (!this.current(value.scope) || !view.hintPreferences) return
        const hints = view.hints.filter(row => !view.hintPreferences?.offered.includes(row.hintId)
          && !this.offeredInLifetime.has(row.hintId))
        if (hints.length) this.updateView({ returnCard: { scope: value.scope, createdAt: Date.now(), hints } })
      }).catch((error: unknown) => {
        if (this.current(value.scope)) console.warn('Companion return facts unavailable', error)
      })
    }
  }
  private updateView(fields: Partial<CompanionView>): void {
    const prior = this.view.getSnapshot(), value = { ...prior, ...fields }
    this.pendingKeys.set(value, this.pendingKeys.get(prior))
    this.view.set(value)
  }
  private project(binding: SessionBinding | undefined, panelId: string | null, previous: CompanionView, force: boolean): CompanionView {
    const conversation = binding ? this.ctx.uiConversation.binding(binding) : undefined
    const workspaces = this.ctx.workspaces.list.getSnapshot()
    const workspaceId = binding && workspaces.phase === 'ready'
      ? workspaces.items.find(row => row.sessionIds.includes(binding.sessionId))?.workspaceId ?? null : null
    const target = panelId ?? conversation?.selectedView.getSnapshot() ?? null
    const scope = { hostEpoch: this.hostEpoch, windowId: this.windowId,
      viewId: target === null ? null : brandString<CompanionViewId>(target), panelId,
      workspaceId, sessionId: binding?.sessionId ?? null, turn: conversation?.openTurn.getSnapshot() ?? null,
      revision: previous.scope.revision }
    const pending = binding && this.ctx.uiSession.sessionStatus.getSnapshot().get(binding.sessionId)?.pendingInteraction
    const changed = force || pending?.key !== this.pendingKeys.get(previous) || Object.keys(scope).some(key =>
      scope[key as keyof CompanionScope] !== previous.scope[key as keyof CompanionScope])
    if (changed) scope.revision++
    const connected = this.generation !== undefined && this.hostEpoch !== null && this.windowId !== null
    const model = binding?.session.projections.faceOf('modelSelection').getSnapshot() as ModelSelectionProjection | undefined
    const value: CompanionView = { scope: changed ? scope : previous.scope, connected,
      state: !connected ? 'disconnected' : pending ? 'waiting'
        : scope.turn !== null && binding?.session.getSnapshot().running === true ? 'working' : 'idle',
      notebook: connected ? this.notebook === 'available' && this.ctx.slots.entries('nidofy.notebook').length === 0
        ? 'unavailable' : this.notebook : 'unavailable', model: model?.next ? 'known' : 'unknown',
      receiptId: changed ? null : previous.receiptId, noticeIds: changed ? [] : previous.noticeIds,
      facts: changed ? null : previous.facts,
      hintPreferences: changed ? null : previous.hintPreferences, hints: changed ? [] : previous.hints,
      returnCard: changed ? null : previous.returnCard,
      actions: connected ? ['conversation', 'builds', 'artifacts', 'protection', 'pets', 'connections', 'environment',
        ...pending?.kind === 'approval' ? ['approval' as const] : []] : [] }
    this.pendingKeys.set(value, pending?.key)
    return value
  }
  private publishAttention(force = false): void {
    const reference = this.attentionReference
    if (!reference || this.lifetime.signal.aborted) return
    const previous = this.attention.getSnapshot() ?? emptyView
    const value = this.project(reference.binding, null, previous, force)
    if (JSON.stringify(value) !== JSON.stringify(previous)) this.attention.set(value)
  }
  follow(scope: CompanionScope): void {
    if (!this.current(scope) || !scope.sessionId) throw Error('COMPANION_SCOPE_CHANGED')
    const reference = this.ctx.sessions.retain(scope.sessionId, { source: 'companionAttention' })
    this.releaseAttention()
    this.attentionReference = reference
    const binding = reference.binding, conversation = this.ctx.uiConversation.binding(binding)
    const publish = (): void => { this.publishAttention() }
    this.attentionDisposers.push(binding.session.subscribe(publish), conversation.openTurn.subscribe(publish),
      conversation.selectedView.subscribe(publish), binding.session.projections.faceOf('modelSelection').subscribe(publish),
      binding.session.projections.faceOf('permissions').subscribe(() => { this.publishAttention(true) }))
    this.publishAttention(true)
    void this.track(reference.ready.then(() => {
      if (this.attentionReference === reference) this.publishAttention()
    }).catch((error: unknown) => {
      if (this.attentionReference !== reference || this.lifetime.signal.aborted) return
      const value = this.attention.getSnapshot()
      if (value) this.attention.set({ ...value, state: 'disconnected', connected: false })
      console.warn('Companion attention unavailable', error)
    }))
  }
  releaseAttention(): void {
    for (const dispose of this.attentionDisposers.splice(0)) dispose()
    const reference = this.attentionReference
    this.attentionReference = undefined
    this.attention.set(null)
    reference?.release()
  }
  openAttention(scope: CompanionScope): void {
    const current = this.attention.getSnapshot()
    if (!current?.connected || !scope.sessionId || this.lifetime.signal.aborted
      || JSON.stringify(scope) !== JSON.stringify(current.scope)) throw Error('COMPANION_SCOPE_CHANGED')
    this.ctx.uiWorkspace.openSession(scope.sessionId)
  }
  current(scope: CompanionScope): boolean {
    return !this.lifetime.signal.aborted && this.view.getSnapshot().connected
      && JSON.stringify(scope) === JSON.stringify(this.view.getSnapshot().scope)
  }
  using<T>(scope: CompanionScope, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.current(scope)) return Promise.reject(Error('COMPANION_SCOPE_CHANGED'))
    const lifetime = AbortSignal.any([this.epoch.signal, this.lifetime.signal, ...signal ? [signal] : []])
    return this.track((async () => {
      lifetime.throwIfAborted()
      const result = await operation(lifetime)
      lifetime.throwIfAborted()
      if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
      return result
    })())
  }
  async refresh(scope: CompanionScope): Promise<CompanionView> {
    if (!scope.sessionId) throw Error('COMPANION_SESSION_REQUIRED')
    const sessionId = scope.sessionId
    if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
    this.factsRead.abort(); this.factsRead = new AbortController()
    this.updateView({ facts: null, hints: [], returnCard: null, receiptId: null, noticeIds: [] })
    return this.using(scope, async (signal) => {
      const [raw, preferenceRaw] = await Promise.all([
        this.request('/api/nidofy/workbench/companion/facts', { sessionId }, signal),
        this.request('/api/nidofy/workbench/companion/hint-preferences', {}, signal),
      ])
      signal.throwIfAborted()
      if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
      const facts = readCompanionFacts(raw, sessionId)
      const hintPreferences = readHintPreferences(preferenceRaw)
      const availability = facts.notebook.availability === 'available' && this.ctx.slots.entries('nidofy.notebook').length === 0
        ? 'unavailable' : facts.notebook.availability
      const hints = await deriveHints({ ...this.view.getSnapshot(), notebook: availability }, facts, hintPreferences,
        this.pendingKeys.get(this.view.getSnapshot()), Date.now())
      signal.throwIfAborted()
      if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
      const ids = facts.notices.map(row => row.id)
      const receipt = facts.notices.find(row => row.receipt !== null)?.receipt
      this.notebook = facts.notebook.availability
      const view: CompanionView = { ...this.view.getSnapshot(), notebook: availability,
        facts, hintPreferences, hints, noticeIds: ids, receiptId: receipt ? brandString<CompanionReceiptId>(receipt.id) : null }
      this.pendingKeys.set(view, this.pendingKeys.get(this.view.getSnapshot()))
      this.view.set(view)
      return view
    }, this.factsRead.signal)
  }
  async preferHints(scope: CompanionScope, action: 'ignore' | 'snooze' | 'mute' | 'unmute' | 'reset', id?: HintId, until?: number): Promise<void> {
    const view = this.view.getSnapshot()
    if (!this.current(scope) || !view.hintPreferences) throw Error('COMPANION_SCOPE_CHANGED')
    if ((action === 'ignore' || action === 'snooze') && !view.hints.some(row => row.hintId === id)) throw Error('HINT_SOURCE_CHANGED')
    const project = view.facts?.project
    if ((action === 'mute' || action === 'unmute') && (!project || project.workspaceId !== scope.workspaceId)) throw Error('HINT_PROJECT_REQUIRED')
    await this.using(scope, async (signal) => {
      const raw = await this.request('/api/nidofy/workbench/companion/hint-preferences/edit', {
        expectedRevision: view.hintPreferences?.revision, action, id, until, sessionId: scope.sessionId,
        workspaceId: project?.workspaceId, path: project?.path,
      }, signal)
      const preferences = readHintPreferences(raw)
      signal.throwIfAborted()
      if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
      this.updateView({ hintPreferences: preferences, hints: [], returnCard: null })
    })
    await this.refresh(scope)
  }
  async offeredHints(scope: CompanionScope): Promise<void> {
    const view = this.view.getSnapshot(), card = view.returnCard
    if (!this.current(scope) || !card || !view.hintPreferences) throw Error('COMPANION_SCOPE_CHANGED')
    if (card.hints.every(row => view.hintPreferences?.offered.includes(row.hintId))) return
    for (const hint of card.hints) this.offeredInLifetime.add(hint.hintId)
    await this.using(scope, async (signal) => {
      const raw = await this.request('/api/nidofy/workbench/companion/hint-preferences/edit', {
        action: 'offered', expectedRevision: view.hintPreferences?.revision, ids: card.hints.map(row => row.hintId),
      }, signal)
      const preferences = readHintPreferences(raw)
      signal.throwIfAborted()
      if (!this.current(scope)) throw Error('COMPANION_SCOPE_CHANGED')
      this.updateView({ hintPreferences: preferences })
    })
  }
  open(scope: CompanionScope, action: CompanionAction): Promise<void> {
    if (action === 'approval' || action === 'conversation') {
      if (!this.current(scope) || !scope.sessionId || !this.view.getSnapshot().actions.includes(action)) {
        return Promise.reject(Error('COMPANION_ACTION_UNAVAILABLE'))
      }
      this.ctx.uiWorkspace.openSession(scope.sessionId)
      this.ctx.layout.selectPanel(null)
      return Promise.resolve()
    }
    return this.using(scope, async () => {
      if (!this.view.getSnapshot().actions.includes(action)) throw Error('COMPANION_ACTION_UNAVAILABLE')
      const id = scope.sessionId, workspace = id === null ? undefined : this.ctx.sessions.list.getSnapshot().byId[id]?.cwd
      await this.desktop.openPanel(action, workspace, scope)
    })
  }
  /** Withdraw subscriptions before aborting and draining reads; no persistent binding is restored. */
  async close(): Promise<void> {
    if (this.lifetime.signal.aborted) return
    for (const dispose of [...this.disposers, ...this.disposeBinding]) dispose()
    this.disposers.length = 0; this.disposeBinding = []
    this.releaseAttention()
    this.lifetime.abort(); this.epoch.abort(); this.bootstrap.abort(); this.capability.abort(); this.factsRead.abort()
    this.view.set({ ...this.view.getSnapshot(), connected: false, state: 'disconnected', receiptId: null, noticeIds: [],
      facts: null, hints: [], returnCard: null, hintPreferences: null, actions: [] })
    await Promise.allSettled(this.jobs)
    this.offeredInLifetime.clear()
  }
}
