/** Engineering composition over official Shell, tools, Session observations and native protection. */
import type { Context } from '@deepseek-ai/cordis'
import type { ShellExecSpec } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JobEvent } from '@deepseek-ai/dsh-jobs'
import { createHash, randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { object } from '../connections/store.ts'
import type { ProtectionOwner } from '../connections/protection.ts'
import { ProjectActions, type ExecutionObservation } from './legacy/project-actions.mjs'
import { actionEvidence, commandFacts } from './evidence.ts'
import { VerificationOwner, type VerificationView } from './verification.ts'
import { runtimeFingerprint } from './verification-input.ts'
import { NotificationOwner } from './notifications.ts'
import { CompanionFactsOwner } from './companion-facts.ts'
import { HintPreferencesOwner } from './hint-preferences.ts'
import { SelfTestRunner } from '../selftest/runner.ts'
import { SelfTestStore } from '../selftest/store.ts'
import { ElectronLocalChecks } from '../selftest/local.ts'
import { SelfTestConnectionOwner } from '../selftest/provider.ts'
import { TaskComparisonOwner } from '../experiments/owner.ts'
import { TaskModelLineageOwner } from '../experiments/model-lineage.ts'
import { TaskRequestOwner } from '../experiments/task-requests.ts'
import { SideAnalysisOwner } from '../companion/analysis.ts'
import { CompanionStyleOwner } from '../companion/style.ts'
import { EngineeringTaskOwner } from '../experiments/engineering-tasks.ts'
import { EngineeringMatrixOwner } from '../experiments/engineering-matrix.ts'
import { EngineeringShellObserver } from '../experiments/engineering-shell.ts'
import type { ConnectionStore } from '../connections/store.ts'
import { installStorageAdmission } from './legacy/storage-admission.mjs'
import type {} from '@nidofy/dsh-desktop-extras/storage'
import type {} from '@nidofy/dsh-desktop-extras/context'
import { ChangeReview, discoverRepository } from './legacy/change-review.mjs'
import { environmentRepository, compareEnvironmentBranch, createEnvironmentOperations } from './legacy/environment-repository.mjs'
import { DesktopArtifacts } from './legacy/desktop-artifacts.mjs'
import { recoveryInitial, recoveryFold, recoveryView } from './legacy/task-recovery.mjs'
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const text = (value: unknown, max = 4096): string => { if (typeof value !== 'string' || !value || value.length > max || value.includes('\0'))
  throw Error('WORKBENCH_INVALID_INPUT'); return value }
const quote = (value: string): string => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'"
const verificationToolView = (view: VerificationView) => ({ ...view, receipt: view.receipt ? { ...view.receipt,
  command: { ...view.receipt.command }, log: { ...view.receipt.log }, summary: view.receipt.summary ? { ...view.receipt.summary } : null,
  artifacts: view.receipt.artifacts.map(artifact => ({ ...artifact })) } : null })
type DraftTicketId = Branded<'nidofy.workbench.DraftTicketId'>
type ComposerClientId = Branded<'nidofy.workbench.ComposerClientId'>
type Draft = {
  sessionId: SessionId
  clientId: ComposerClientId
  revision: number
  text?: string
  status: string
  expires: number
}
/** Bounded output from an unconfirmed Git command; no automatic replay is permitted. */
export class WorkbenchCommandError extends Error {
  constructor(readonly detail: { exitCode: number | null; stdout: string; stderr: string }) {
    super('GIT_RESULT_NOT_CONFIRMED')
  }
}
/** Local-user engineering operations; model entry points expose only reviewed action IDs. */
export class WorkbenchOwner {
  private readonly internalSessions = new WeakSet<Session>()
  private readonly jobEpoch = randomUUID()
  readonly actions: ProjectActions
  readonly review: ChangeReview
  readonly artifacts: DesktopArtifacts
  readonly verification: VerificationOwner
  readonly notifications: NotificationOwner
  private readonly companionFacts: CompanionFactsOwner
  private readonly hintPreferences: HintPreferencesOwner
  private readonly removeNotificationProducer: () => void
  private readonly git: ReturnType<typeof createEnvironmentOperations>
  private readonly drafts = new Map<DraftTicketId, Draft>()
  private readonly controllers = new Set<AbortController>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly baselines = new Set<string>()
  private readonly baselineFailures: { workspace: string; sessionId: string; turn: number; code: string }[] = []
  private readonly noticeFailures: { sessionId: string; seq: number; code: string }[] = []
  private stopping = false
  private readonly selftest: SelfTestRunner | undefined
  private readonly experiments: TaskComparisonOwner
  private readonly analysis: SideAnalysisOwner | undefined
  private readonly style: CompanionStyleOwner | undefined
  private readonly engineeringShell = new EngineeringShellObserver()
  constructor(private readonly ctx: Context, private readonly protection: ProtectionOwner, home: string,
    connections?: ConnectionStore, selftestNode = process.execPath) {
    const storage = ctx.get('nidofyStorage')
    if (storage && connections) this.analysis = new SideAnalysisOwner(ctx, home, connections, storage)
    if (storage && connections) this.style = new CompanionStyleOwner(ctx, connections, home, storage)
    // Standalone repair/test compositions can inspect without a writer; writes refuse without an owner.
    if (storage) ctx.effect(() => installStorageAdmission(storage))
    if (storage) {
      const reports = new SelfTestStore(home, storage)
      this.selftest = new SelfTestRunner(reports, storage, id => new ElectronLocalChecks(home, id, storage,
        action => this.execute(action.workspace, action.command, action.signal, action.timeoutMs, action.env,
          action.cwd, undefined, false, action.recordExecution), reports, selftestNode),
      connections ? new SelfTestConnectionOwner(ctx, home, connections, storage) : undefined)
    }
    this.review = new ChangeReview(home)
    this.artifacts = new DesktopArtifacts(home)
    this.verification = new VerificationOwner(home, this.artifacts, async (workspace, action, source) => {
      if (source === 'agent') return null
      const cwd = await realpath(resolve(workspace, action.cwd))
      const spec = this.resolveExecution(workspace, action.command, new AbortController().signal, action.timeoutMs, action.env, cwd)
      return runtimeFingerprint(action, { settings: this.executionSettings(spec), provider: await this.ctx.shell.verificationInputs(spec) })
    })
    this.actions = new ProjectActions(home, action => this.execute(
      action.workspace, action.command, action.signal, action.timeoutMs, action.env, action.cwd, action.context,
      false, action.recordExecution,
    ), this.verification.hooks)
    this.verification.bind(this.actions)
    const engineering = storage && connections
      ? new EngineeringTaskOwner(ctx, home, connections, storage, this.actions, this.verification, this.engineeringShell,
        (session) => { this.internalSessions.add(session) }) : undefined
    this.experiments = new TaskComparisonOwner(this.verification, home, storage, new TaskModelLineageOwner(ctx, this.verification),
      storage && connections ? new TaskRequestOwner(ctx, home, connections, storage) : undefined,
      engineering, engineering && storage ? new EngineeringMatrixOwner(home, engineering, storage) : undefined)
    this.notifications = new NotificationOwner(home, this.verification)
    this.companionFacts = new CompanionFactsOwner(ctx, this.notifications, this.verification)
    this.hintPreferences = new HintPreferencesOwner(ctx, home)
    this.removeNotificationProducer = this.verification.subscribe(event => this.notifications.committed(event).then(() => {}))
    ctx.effect(() => this.removeNotificationProducer)
    this.git = createEnvironmentOperations(async (repo, args, fullAccess) => {
      const controller = new AbortController()
      this.controllers.add(controller)
      try {
        const command = (process.platform === 'win32' ? '& ' : '') + 'git ' + args.map(quote).join(' ')
        const pending = this.execute(repo.root, command, controller.signal, 60000, {}, repo.root, undefined, fullAccess)
        this.operations.add(pending)
        let result
        try { result = await pending } finally { this.operations.delete(pending) }
        if (result.exitCode !== 0 || result.aborted || result.timedOut)
          throw new WorkbenchCommandError({ exitCode: result.exitCode ?? null,
            stdout: result.stdout.text.slice(-4000), stderr: result.stderr.text.slice(-4000) })
      }
      finally {
        this.controllers.delete(controller)
      }
    })
  }
  private async execute(
    workspace: string, command: string, signal: AbortSignal, timeoutMs: number,
    env: Record<string, string>, cwd: string, exec?: ToolRunContext, fullAccess = false,
    recordExecution?: (observation: ExecutionObservation) => Promise<void>,
  ) {
    if (this.stopping)
      throw Error('WORKBENCH_STOPPING')

    signal.throwIfAborted()
    const id = exec?.agent ? String(exec.agent.session.id) : 'workbench-' + randomUUID()
    if (!exec?.agent)
      await this.protection.begin(id, 1, workspace)
    try {
      await this.protection.check(id)
      signal.throwIfAborted()
      const spec = this.resolveExecution(workspace, command, signal, timeoutMs, env, cwd, exec, fullAccess)
      if (recordExecution) await recordExecution({ settings: this.executionSettings(spec),
        provider: await this.ctx.shell.verificationInputs(spec) })
      signal.throwIfAborted()
      const shellResources = this.engineeringShell.get(exec?.agent?.session.id)
      shellResources?.check()
      const handle = await this.ctx.shell.execute(spec)
      let result: Awaited<ReturnType<typeof handle.result>> | undefined
      try { result = await handle.result(); return result }
      finally { await shellResources?.settled(handle, result) }
    }
    finally {
      if (!exec?.agent)
        await this.protection.end(id)
    }
  }
  private resolveExecution(workspace: string, command: string, signal: AbortSignal, timeoutMs: number,
    env: Record<string, string>, cwd: string, exec?: ToolRunContext, fullAccess = false): ShellExecSpec {
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve(exec?.agent ? { session: exec.agent.session }
      : fullAccess ? { mode: 'danger-full-access' } : {})
    return this.ctx.shell.resolve({ command, workdir: cwd, signal, timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 512 * 1024, env,
      sandboxPolicy: exec?.agent ? sandboxPolicy : { ...sandboxPolicy, workspaceRoot: workspace },
      ...(exec ? { dshEnv: this.ctx.shellEnv.collect(exec) } : {}),
    })
  }
  private executionSettings(spec: ShellExecSpec): object {
    return { command: spec.command, workdir: spec.workdir, timeoutMs: spec.timeoutMs, onExpiry: spec.onExpiry,
      stdoutMaxBytes: spec.stdoutMaxBytes, env: spec.env, dshEnv: spec.dshEnv, sandboxPolicy: spec.sandboxPolicy }
  }
  /** Await owned command exits before releasing the Host composition. */
  async close(): Promise<void> {
    this.stopping = true
    await this.experiments.close()
    await this.analysis?.close()
    await this.style?.close()
    await this.selftest?.close()
    await this.companionFacts.close()
    this.removeNotificationProducer()
    for (const controller of this.controllers)
      controller.abort()
    await this.actions.close()
    await this.verification.close()
    await this.notifications.close()
    await this.hintPreferences.close()
    await Promise.allSettled([...this.operations])
    await this.protection.drain()
    this.drafts.clear()
  }
  /** Capture a bounded baseline before the first step of each official turn. */
  async baseline(sessionId: string, turn: number, workspace: string | undefined, signal: AbortSignal): Promise<void> {
    const key = `${sessionId}:${turn}`
    if (!workspace || this.baselines.has(key))
      return
    try {
      await discoverRepository(workspace)
    }
    catch (error) {
      if (Reflect.get(error instanceof Error ? error : {}, 'code') === 'NO_REPOSITORY')
        return
      throw error
    }
    try { await this.review.capture(workspace, { sessionId, turn, source: 'task', signal }) }
    catch (error) {
      signal.throwIfAborted()
      const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
      if (typeof code !== 'string' || !['LIMIT', 'VCS_MISSING', 'VCS_FAILED', 'ENCODING'].includes(code)) throw error
      // Comparison availability is independent of the mandatory protection admission.
      this.baselineFailures.push({ workspace, sessionId, turn, code })
      if (this.baselineFailures.length > 100) this.baselineFailures.shift()
    }
    this.baselines.add(key)
  }
  /** Forget the process-local first-step marker once the official turn ends. */
  ended(session: Session, event: SessionEvent<'turn/end'>): void {
    this.baselines.delete(`${session.id}:${event.data.turn}`)
    if (this.stopping || session.header.origin === 'subagent' || this.internalSessions.has(session)) return
    const pending = this.sessionNotice(session, event)
    this.operations.add(pending)
    void pending.finally(() => this.operations.delete(pending)).catch((error: unknown) => {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.message)
        ? error.message : 'NOTICE_DURABLE_SOURCE_UNAVAILABLE'
      this.noticeFailures.push({ sessionId: String(session.id), seq: event.seq, code })
      if (this.noticeFailures.length > 100) this.noticeFailures.shift()
    })
  }
  /** Observe only unawaited, user-session background terminals, never teardown or internal experiment jobs.
   * @param event - Actual job registry lifecycle event.
   */
  jobEnded(event: JobEvent): void {
    if (this.stopping || event.type !== 'settled' || event.awaited || event.cause === 'teardown' || !event.job.owner) return
    const session = this.ctx.agents.get(event.job.owner)?.session
    if (!session || session.header.origin === 'subagent' || this.internalSessions.has(session)) return
    const pending = this.notifications.jobTerminal(this.jobEpoch, event.job, session.header.cwd ?? null)
    this.operations.add(pending)
    void pending.finally(() => this.operations.delete(pending)).catch(() => { this.ctx.logger.warn('NOTICE_JOB_PUBLICATION_FAILED') })
  }
  private async sessionNotice(session: Session, event: SessionEvent<'turn/end'>): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    if (!persistence || !await this.ctx.sessions.flush(session)) throw Error('NOTICE_DURABLE_SOURCE_UNAVAILABLE')
    const signal = AbortSignal.timeout(15000), observation = await persistence.observeDurable(session.id, { signal })
    const raw = observation.events[event.seq]
    if (observation.meta.id !== session.id || observation.durableThrough !== observation.events.length - 1
      || observation.events.some((row, index) => row.seq !== index)
      || raw?.type !== 'turn/end' || raw.seq < observation.inheritedEventCount || JSON.stringify(raw) !== JSON.stringify(event))
      throw Error('NOTICE_DURABLE_SOURCE_UNAVAILABLE')
    await persistence.withGeneration(session.id, observation.generation, async () => {
      if (this.stopping || this.ctx.get('sessionPersistence')?.identity !== persistence.identity) throw Error('NOTICE_SOURCE_CHANGED')
      await this.notifications.sessionTerminal(session.id, observation.generation, observation.meta.cwd ?? null, raw)
    }, { signal })
  }
  /** Stream a pinned artifact through the existing authenticated desktop protocol. */
  download(id: string, response: ServerResponse): Promise<void> { return this.artifacts.download(id, response) }
  /** Dispatch bounded local-user requests after the official connection authentication check.
   * @param method - Existing owner operation selected by the authenticated route.
   * @param input - Parsed request data; each owning operation validates its fields.
   * @param signal - Read lifetime and Hint preference pre-publication cancellation; commands retain their own cancellation.
   * @returns Actual owner result; cancellation never establishes whether a persistent operation committed.
   */
  async request(method: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    const data = object(input)
    if (this.stopping)
      throw Error('WORKBENCH_STOPPING')
    if (method.startsWith('selftest/')) {
      if (!this.selftest) throw Error('STORAGE_OWNER_UNAVAILABLE')
      return this.selftest.request(method.slice('selftest/'.length), data)
    }
    if (method.startsWith('experiments/')) return this.experiments.request(method.slice('experiments/'.length), data, signal)
    if (method.startsWith('analysis/')) {
      if (!this.analysis || !signal) throw Error('ANALYSIS_OWNER_UNAVAILABLE')
      return this.analysis.request(method.slice('analysis/'.length), data, signal)
    }
    if (method.startsWith('style/')) {
      if (!this.style || !signal) throw Error('STYLE_OWNER_UNAVAILABLE')
      return this.style.request(method.slice('style/'.length), data, signal)
    }
    switch (method) {
      case 'companion/hint-preferences': return this.hintPreferences.read()
      case 'companion/hint-preferences/edit': return this.hintPreferences.edit(data,
        AbortSignal.any([AbortSignal.timeout(15000), ...signal ? [signal] : []]))
      case 'companion/facts': return this.companionFacts.read(SessionId(text(data.sessionId, 128)),
        AbortSignal.any([AbortSignal.timeout(15000), ...signal ? [signal] : []]))
      case 'companion/notices': {
        const id = SessionId(text(data.sessionId, 128))
        const meta = await this.ctx.sessionPersistence.stat(id, { signal: AbortSignal.timeout(15000) })
        if (!meta) throw Error('COMPANION_SESSION_UNAVAILABLE')
        return this.notifications.forScope(id, meta.header.cwd ?? null)
      }
      case 'companion/notebook': {
        const notebook = this.ctx.get('nidofyNotebookV2')
        if (!notebook) return { availability: this.ctx.get('configEditor')?.configuration().some(row =>
          row.entry.options.name === '@nidofy/dsh-working-notebook' && row.entry.options.disabled === true)
          ? 'disabled' : 'unavailable', notebook: null }
        const value = await notebook.read(text(data.sessionId, 128), AbortSignal.timeout(15000))
        return { availability: 'available', notebook: value }
      }
      case 'notifications': return { ...await this.notifications.list(data.after ?? 0), unavailable: this.noticeFailures.slice() }
      case 'notifications/preferences': return this.notifications.preferences()
      case 'notifications/configure': return this.notifications.configure(data.expectedRevision, data.enabled)
      case 'notifications/attach': {
        await Promise.allSettled([...this.operations])
        return this.notifications.attach()
      }
      case 'notifications/poll': return this.notifications.poll()
      case 'notifications/advance': return this.notifications.advance(data.expectedRevision, data.sequence)
      case 'notifications/claim': return this.notifications.claim(data.id, data.prefsRevision)
      case 'notifications/settle': return this.notifications.settle(data.id, data.claimId, data.outcome)
      case 'notifications/handle': return this.notifications.handle(data.id)
      default: break
    }
    if (method === 'context') {
      const observation = await this.ctx.sessionQuery.observeSession(SessionId(text(data.sessionId)), { projectionMode: 'none', signal: AbortSignal.timeout(15000) })
      try {
        const workspace = observation.header.cwd
        if (workspace === undefined) return {}
        let repository: unknown
        try { repository = await environmentRepository(workspace) }
        catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'NO_REPOSITORY') return { workspace, vcs: 'none' }
          throw error
        }
        return { ...object(repository), workspace }
      } finally { observation[Symbol.dispose]() }
    }
    if (method === 'sessions') {
      const records = await this.ctx.sessionQuery.listSessions(AbortSignal.timeout(15000))
      return records.filter(row => row.header.origin !== 'subagent').map(row => ({ id: row.header.id, workspace: row.header.cwd, createdAt: row.header.createdAt })).slice(-100)
    }
    if (method === 'recovery') {
      const id = SessionId(text(data.sessionId)), observation = await this.ctx.sessionQuery.observeSession(id, { projectionMode: 'none', signal: AbortSignal.timeout(15000) })
      try {
        const state = observation.events.reduce(recoveryFold, recoveryInitial(observation.header, observation.inheritedEventCount))
        return recoveryView(state, this.ctx.agents.get(id) !== undefined)
      }
      finally {
        observation[Symbol.dispose]()
      }
    }
    if (method.startsWith('draft/'))
      return this.draft(method, data)
    if (method === 'artifact/lease') {
      const lease = await this.artifacts.resolveLease(text(data.id))
      if (!['open', 'reveal', 'save'].includes(String(data.action)))
        throw Error('ARTIFACT_ACTION_INVALID')
      if (data.action === 'open' && !['.txt', '.md', '.log', '.json', '.csv', '.tsv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.docx', '.xlsx', '.pptx'].includes(extname(lease.path).toLowerCase()))
        throw Error('ARTIFACT_OPEN_TYPE_REFUSED')
      return { target: lease.target, fingerprint: lease.fingerprint }
    }
    const workspace = await realpath(text(data.workspace))
    switch (method) {
      case 'environment': return environmentRepository(workspace)
      case 'compare': return compareEnvironmentBranch(workspace, text(data.branch))
      case 'git/preview': return this.git.preview(workspace, object(data.operation))
      case 'git/apply': return this.git.apply(workspace, text(data.token))
      case 'review/list': return { ...object(await this.review.list(workspace)), unavailable: this.baselineFailures.filter(row => row.workspace === workspace) }
      case 'review/capture': return this.review.capture(workspace)
      case 'review/changes': return this.review.inspect(workspace, typeof data.baselineId === 'string' && data.baselineId ? data.baselineId : undefined)
      case 'review/patch': {
        const value = await this.review.patch(workspace, text(data.path), {
          mode: text(data.mode), ...(data.baselineId ? { baselineId: text(data.baselineId) } : {}),
        })
        return { ...value, hash: value.text === null ? null : hash(value.text) }
      }
      case 'actions/inspect': {
        const view = await this.actions.inspect(workspace)
        return { ...view, runs: view.runs.map(run => ({ ...run, execution: commandFacts(run) })) }
      }
      case 'actions/save': return this.actions.save(workspace, data.config)
      case 'actions/trust': return this.actions.trust(workspace, text(data.fingerprint))
      case 'actions/revoke': return this.actions.revoke(workspace)
      case 'actions/start': return this.actions.start(workspace, text(data.id))
      case 'actions/cancel': return this.actions.cancel(workspace, text(data.id))
      case 'actions/log': return { text: await this.actions.log(workspace, text(data.id)) }
      case 'actions/evidence': return actionEvidence(this.actions, workspace, text(data.id), data.parser ?? null)
      case 'verification/list': return this.verification.list(workspace, data.after ?? null)
      case 'verification/inspect': return this.verification.inspect(workspace, text(data.id))
      case 'verification/log': return { text: await this.verification.log(workspace, text(data.id)) }
      case 'verification/accept': return this.verification.accept(workspace, text(data.id), data.expectedRevision, data.decision)
      case 'artifacts/register': return this.artifacts.register(workspace, text(data.path))
      case 'artifacts/list': {
        const registered = await this.artifacts.list(workspace)
        const view = await this.actions.inspect(workspace)
        const declared = await Promise.all(view.runs.slice(0, 20).flatMap(run => (run.artifacts ?? []).map(async (path) => {
          try {
            return { ...await this.artifacts.describe(workspace, path, { source: 'build-declared', runId: run.id, runStatus: run.status }), freshlyProduced: false }
          }
          catch (_error) {
            return { path, source: 'build-declared', runId: run.id, runStatus: run.status, available: false, freshlyProduced: false }
          }
        })))
        const logs = await Promise.all(view.runs.slice(0, 20).filter(run => run.logAvailable).map(async (run) => {
          try {
            const log = await this.actions.logReference(workspace, run.id)
            return await this.artifacts.describe(log.root, log.path, { source: 'build-log', runId: run.id, runStatus: run.status })
          } catch (_error) { return { source: 'build-log', runId: run.id, available: false } }
        }))
        const observed = await Promise.all(view.runs.slice(0, 20).map(async run => this.verification.observedArtifacts(workspace, run.id)))
        return [...registered, ...declared, ...observed.flat().map(artifact => ({ ...artifact, source: 'run-observed', available: false })),
          ...logs, ...await this.sessionArtifacts(workspace, data.sessionId)]
      }
      default: throw Error('WORKBENCH_METHOD_UNAVAILABLE')
    }
  }
  private async sessionArtifacts(workspace: string, sessionId: unknown): Promise<Record<string, unknown>[]> {
    if (sessionId === undefined || sessionId === '') return []
    const observation = await this.ctx.sessionQuery.observeSession(SessionId(text(sessionId)), { projectionMode: 'none' })
    try {
      if (!observation.header.cwd || await realpath(observation.header.cwd) !== workspace) throw Error('ARTIFACT_WORKSPACE_CONFLICT')
      const rows: Record<string, unknown>[] = []
      for (const event of [...observation.events].reverse()) {
        if (event.seq < observation.inheritedEventCount || event.type !== 'deliverables/presented') continue
        const data = object(event.data)
        if (!Array.isArray(data.files)) continue
        for (const file of data.files) {
          if (rows.length >= 100) return rows
          const value = object(file)
          if (typeof value.path !== 'string') continue
          const path = (isAbsolute(value.path) ? relative(workspace, value.path) : value.path).replaceAll('\\', '/')
          const metadata = { source: 'session-declared', seq: event.seq, turn: data.turn, freshlyProduced: false }
          try { rows.push(await this.artifacts.describe(workspace, path, metadata)) }
          catch (_error) { rows.push({ ...metadata, path, available: false }) }
        }
      }
      return rows
    } finally { observation[Symbol.dispose]() }
  }
  private async draft(method: string, data: Record<string, unknown>): Promise<unknown> {
    for (const [key, row] of this.drafts)
      if (row.expires < Date.now())
        this.drafts.delete(key)
    if (method === 'draft/stage') {
      if (this.drafts.size >= 64)
        throw Error('DRAFT_QUEUE_FULL')
      const sessionId = SessionId(text(data.sessionId)), revision = data.revision
      const clientId = brandString<ComposerClientId>(text(data.clientId))
      if (!Number.isSafeInteger(revision) || typeof revision !== 'number' || revision < 0)
        throw Error('DRAFT_REVISION_INVALID')
      const observation = await this.ctx.sessionQuery.observeSession(SessionId(sessionId), { projectionMode: 'none', signal: AbortSignal.timeout(15000) })
      try {
        if (!observation.header.cwd || observation.header.origin === 'subagent')
          throw Error('DRAFT_TARGET_INVALID')
        const source = await discoverRepository(text(data.workspace)), target = await discoverRepository(observation.header.cwd)
        if (source.root !== target.root)
          throw Error('DRAFT_WORKSPACE_CONFLICT')
        const patch = await this.review.patch(source.root, text(data.path), {
          mode: text(data.mode), ...(data.baselineId ? { baselineId: text(data.baselineId) } : {}),
        })
        if (patch.text === null || hash(patch.text) !== data.hash)
          throw Error('DRAFT_PATCH_CONFLICT')
        const start = data.start, end = data.end
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > patch.text.length)
          throw Error('DRAFT_SELECTION_INVALID')
        const selected = patch.text.slice(start, end)
        if (Buffer.byteLength(selected) > 64 * 1024 || !selected.isWellFormed())
          throw Error('DRAFT_SELECTION_INVALID')
        const ticket = brandString<DraftTicketId>(randomUUID())
        this.drafts.set(ticket, { sessionId, clientId, revision, text: '\n\n' + JSON.stringify({ file: data.path, comparison: data.mode, selection: 'excerpt' }) + '\n' + selected, status: 'PENDING', expires: Date.now() + 120000 })
        return { ticket, status: 'PENDING' }
      }
      finally {
        observation[Symbol.dispose]()
      }
    }
    const ticket = brandString<DraftTicketId>(text(data.ticket)), row = this.drafts.get(ticket)
    if (!row)
      return { status: 'EXPIRED' }
    if (method === 'draft/status')
      return { status: row.status }
    if (row.clientId !== data.clientId || row.sessionId !== data.sessionId)
      throw Error('DRAFT_TARGET_CONFLICT')
    if (method === 'draft/claim') {
      if (row.status !== 'PENDING')
        return { status: row.status }
      row.status = 'UNKNOWN'
      const content = row.text
      delete row.text
      return { status: 'CLAIMED', sessionId: row.sessionId, revision: row.revision, text: content }
    }
    if (method === 'draft/settle' && row.status === 'UNKNOWN' && ['APPENDED', 'REFUSED'].includes(String(data.status)))
      row.status = String(data.status)
    return { status: row.status }
  }
}
/** Mount engineering tools and lifecycle observers on the existing Host.
 * @param ctx - Official Desktop Host.
 * @param protection - Shared native protection coordinator.
 * @param home - Distribution-isolated storage.
 * @param connections - Actual managed route owner; unavailable repair compositions refuse provider mode.
 * @param selftestNode - Application-owned standalone Node; ordinary Node compositions use their current executable.
 * @returns Local-user workbench owner.
 */
export function installWorkbench(ctx: Context, protection: ProtectionOwner, home: string, connections?: ConnectionStore,
  selftestNode?: string): WorkbenchOwner {
  const owner = new WorkbenchOwner(ctx, protection, home, connections, selftestNode)
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => { await owner.baseline(String(agent.session.id), turn, agent.session.header.cwd, signal); return next() })
  ctx.on('session/event', (session, event) => { if (event.type === 'turn/end') owner.ended(session, event) })
  ctx.inject(['jobs'], (scope) => { scope.effect(() => scope.jobs.events.subscribe({ owners: 'all' }, (event) => { owner.jobEnded(event) })) })
  ctx.effect(() => () => owner.close())
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'list_project_actions', description: 'List the reviewed project build/test actions. Trust is granted only by the local user in the desktop workbench.', parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) { const cwd = exec.agent?.session.header.cwd; if (!cwd)
      throw Error('WORKSPACE_REQUIRED'); const view = await owner.actions.inspect(cwd); return { trusted: view.trusted, actions: view.config.actions.map(({ id, label, timeoutMs }) => ({ id, label, timeoutMs })) } } })))
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'run_project_action', description: 'Run a locally trusted action ID under current session permissions. Never automatically repeat interrupted actions with unknown side effects.', parameters: { id: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { const cwd = exec.agent?.session.header.cwd; if (!cwd)
      throw Error('WORKSPACE_REQUIRED'); const run = await owner.actions.start(cwd, args.id, { signal: exec.signal, context: exec, source: 'agent' }); const result = await owner.actions.wait(cwd, run.id)
    const verification = await owner.verification.inspect(cwd, result.id)
    return { id: result.id, execution: { ...commandFacts(result) }, verification: verificationToolView(verification),
      tail: typeof result.tail === 'string' ? result.tail : '' } } })))
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'read_project_verification', description: 'Read a durable project action receipt. Command success, parsed tests, source freshness and local-user acceptance are independent. Never replay an unknown run.',
    parameters: { id: { type: 'string', required: true } }, output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { const cwd = exec.agent?.session.header.cwd; if (!cwd) throw Error('WORKSPACE_REQUIRED')
      return verificationToolView(await owner.verification.inspect(cwd, args.id)) } })))
  return owner
}
