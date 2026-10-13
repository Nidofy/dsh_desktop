/** Independently confirmed engineering runs own fresh copied workspaces and one official Agent turn with reviewed actions only. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, opendir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionId, Session, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createUserMessage, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { HttpEgressLease, HttpEgressPolicy } from '@deepseek-ai/dsh-http-proxy'
import type { StorageService, QuotaLease, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { ConnectionStore } from '../connections/store.ts'
import { object } from '../connections/store.ts'
import { unlinked } from '../selftest/store.ts'
import { validateActionConfig, type ProjectActions, type View } from '../workbench/legacy/project-actions.mjs'
import type { VerificationOwner, VerificationRunId, VerificationView } from '../workbench/verification.ts'
import type { ReceiptSelection, ExperimentId, ExperimentCaseId } from './comparison.ts'
import { parseManagedRequestObservation, reportedResponseModel } from '../connections/request-observations.ts'
import { publishRecord, readRecord } from '../workbench/verification-storage.ts'
import { copyProject, previewProjectCopy, parseProjectCopyPreview, type ProjectCopyPreview } from './project-copy.ts'
import { EngineeringBudgetOwner, parseEngineeringBudget, type EngineeringBudget } from './engineering-budget.ts'
import { captureEngineeringRequest } from './engineering-inputs.ts'
import { modelStepLineage, type ModelStepLineage } from './model-lineage.ts'
import type { NotebookInputCapture } from '@nidofy/dsh-desktop-extras/context'
import { parseTaskNotebookInput } from './task-notebook-input.ts'
import type { DesktopCacheInput } from '@nidofy/dsh-desktop-extras/cache'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { compareEngineeringRuns, type EngineeringComparisonRun } from './engineering-comparison.ts'
import { EngineeringResourceOwner, measureEngineeringWorkspace, parseEngineeringResourceBudget,
  parseEngineeringResourceAllocation, parseEngineeringResourceResult, observeEngineeringSession, validateEngineeringResourceSession,
  engineeringDirectoryNames,
  type EngineeringResourceBudget, type EngineeringResourceAllocation } from './engineering-resources.ts'
import { EngineeringShellObserver, EngineeringShellRun, parseEngineeringShellBudget, parseEngineeringShellResult,
  engineeringShellCharge, type EngineeringShellBudget } from './engineering-shell.ts'

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const COPY_BUDGET = Object.freeze({ maxEntries: 512, maxBytes: 16 * 1024 * 1024, maxFileBytes: 1024 * 1024 })
const ROOT_LIMIT = 2 * 1024 * 1024
// Cold reads retain the original scan envelope even when a run refused its smaller confirmed checkpoint budget.
const SESSION_SCAN_LIMIT = Object.freeze({ sessionBytes: ROOT_LIMIT, sessionDiskBytes: ROOT_LIMIT, sessionEvents: 4096 })
type EngineeringTaskId = Branded<'nidofy.EngineeringTaskId'>
function fields(row: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(row).length !== allowed.length || Object.keys(row).some(key => !allowed.includes(key))) throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value && value.isWellFormed() && !value.includes('\0') && Buffer.byteLength(value) <= max
}
function id(value: unknown): string { if (!text(value, 36) || !UUID.test(value)) throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID'); return value }
function code(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.message) ? error.message : 'EXPERIMENT_ENGINEERING_UNCONFIRMED'
}
type Input = {
  experimentId: ExperimentId
  caseId: ExperimentCaseId
  text: string
  connection: string
  model: string
  actionIds: string[]
  budget: EngineeringBudget
  copy: ProjectCopyPreview
}
type Plan = {
  input: Input
  resourceBudget: EngineeringResourceBudget
  shellBudget: EngineeringShellBudget
  actions: View
  configurationRevision: number
  connectionRevision: string
  policy: HttpEgressLease
  policyOwner: HttpEgressPolicy
  expiresAt: number
  notebook?: NotebookInputCapture
  cache?: { input: DesktopCacheInput; owner: symbol }
}
type Intent = {
  schemaVersion: 1
  kind: 'engineering-task'
  id: EngineeringTaskId
  sessionId: SessionId
  workspace: string
  startedAt: number
  input: Input
  configurationRevision: number
  connectionRevision: string
  policyRevision: HttpEgressLease['revision']
  actionConfig: View['config']
}
function parseInput(value: unknown): Input {
  const row = object(value); fields(row, ['experimentId', 'caseId', 'text', 'connection', 'model', 'actionIds', 'budget', 'copy'])
  if (!text(row.text, 16 * 1024) || !text(row.connection, 64) || !text(row.model, 256) || !Array.isArray(row.actionIds)
    || row.actionIds.length < 1 || row.actionIds.length > 4 || !row.actionIds.every((value: unknown): value is string => text(value, 64)
      && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(value)) || new Set(row.actionIds).size !== row.actionIds.length) {
    throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
  }
  return { experimentId: brandString<ExperimentId>(id(row.experimentId)), caseId: brandString<ExperimentCaseId>(id(row.caseId)),
    text: row.text, connection: row.connection,
    model: row.model, actionIds: row.actionIds, budget: parseEngineeringBudget(row.budget), copy: parseProjectCopyPreview(row.copy) }
}
/** Validate a retained complete confirmation without resolving present settings or granting execution.
 * @param value - Original preview with its one-use ticket and expiration removed.
 * @returns Parsed original input; unsupported or altered preview fields are refused.
 */
export function parseEngineeringPreview(value: unknown): Input {
  const row = object(value), notebook = Object.hasOwn(row, 'notebookInput'), cache = Object.hasOwn(row, 'cacheInput')
  fields(row, ['input', 'reviewedActions', 'retries', 'copyBudget', 'tools', 'arbitraryCommands', 'projectWrites',
    'exactModelVersion', 'factors', ...notebook ? ['notebookInput'] : [], ...cache ? ['cacheInput'] : [],
    ...Object.hasOwn(row, 'resourceBudget') ? ['resourceBudget'] : [], ...Object.hasOwn(row, 'shellBudget') ? ['shellBudget'] : []])
  const input = parseInput(row.input), actions = validateActionConfig({ schemaVersion: 1, actions: row.reviewedActions })
  const factors = object(row.factors); fields(factors, ['notebook', 'cache'])
  const captured = notebook ? parseTaskNotebookInput(row.notebookInput) : null
  if (Object.hasOwn(row, 'resourceBudget')) parseEngineeringResourceBudget(row.resourceBudget)
  if (Object.hasOwn(row, 'shellBudget')) parseEngineeringShellBudget(row.shellBudget)
  if (row.retries !== 0 || JSON.stringify(row.copyBudget) !== JSON.stringify(COPY_BUDGET)
    || JSON.stringify(row.tools) !== JSON.stringify(['list_project_actions', 'run_project_action'])
    || row.arbitraryCommands !== false || row.projectWrites !== 'ISOLATED_COPY_ONLY' || row.exactModelVersion !== null
    || factors.notebook !== (captured?.text ? 'CAPTURED_INPUT' : captured ? 'EMPTY' : 'NOT_SELECTED') || factors.cache !== 'UNKNOWN'
    || JSON.stringify(actions.actions) !== JSON.stringify(row.reviewedActions)
    || JSON.stringify(actions.actions.map(action => action.id).sort()) !== JSON.stringify([...input.actionIds].sort())
    || actions.actions.some(action => action.timeoutMs > input.budget.durationMs
      || action.command.toLowerCase().includes(input.copy.source.toLowerCase()))
    || input.copy.entries.length > COPY_BUDGET.maxEntries || input.copy.bytes > COPY_BUDGET.maxBytes
    || input.copy.entries.some(entry => entry.kind === 'file' && entry.stamp.bytes > COPY_BUDGET.maxFileBytes)) {
    throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
  }
  if (cache) {
    const captured = object(row.cacheInput), policy = object(captured.policy)
    fields(captured, ['preferenceRevision', 'enabled', 'mounted', 'policy']); fields(policy, ['mode', 'models'])
    if (typeof captured.preferenceRevision !== 'number' || !Number.isSafeInteger(captured.preferenceRevision)
      || captured.preferenceRevision < 0 || captured.enabled !== true || captured.mounted !== true
      || !['native', 'off', 'session'].includes(String(policy.mode)) || !Array.isArray(policy.models) || policy.models.length > 64
      || !policy.models.every((value: unknown) => text(value, 256))) throw Error('EXPERIMENT_CACHE_INPUT_INVALID')
  }
  return input
}
async function size(path: string, entries = { count: 0 }): Promise<number> {
  if (++entries.count > 80) throw Error('EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
  const info = await lstat(path)
  if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw Error('EXPERIMENT_ENGINEERING_PATH_REFUSED')
  if (info.isFile()) return info.size
  if (!info.isDirectory()) throw Error('EXPERIMENT_ENGINEERING_PATH_REFUSED')
  let bytes = 0
  const directory = await opendir(path, { bufferSize: 32 })
  for await (const entry of directory) {
    bytes += await size(join(path, entry.name), entries)
    if (bytes > ROOT_LIMIT) throw Error('EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
  }
  return bytes
}

/** Authenticated engineering tasks grant no arbitrary shell, PTC, web, subagent, settings or acceptance capability. */
export class EngineeringTaskOwner {
  private readonly base: string
  private readonly plans = new Map<string, Plan>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private active: { id: string; controller: AbortController; signal: AbortSignal; done: Promise<void> } | undefined
  private stopped = false
  private records: Promise<unknown> = Promise.resolve()
  private readers: Promise<unknown> = Promise.resolve()
  constructor(private readonly ctx: Context, home: string, private readonly connections: ConnectionStore,
    private readonly storage: Pick<StorageService, 'reserve' | 'write'>, private readonly actions: ProjectActions,
    private readonly verification: VerificationOwner, private readonly shellObserver = new EngineeringShellObserver(),
    private readonly internalSession: (session: Session) => void = () => {}) { this.base = join(home, 'nidofy-extras/experiments/engineering-v1') }
  private alive(): void { this.lifetime.signal.throwIfAborted(); if (this.stopped) throw Error('EXPERIMENT_STOPPING') }
  private async prepare(data: Record<string, unknown>, signal: AbortSignal) {
    const selectedNotebook = Object.hasOwn(data, 'notebookSessionId'), selectedCache = Object.hasOwn(data, 'cacheMode')
    fields(data, ['experimentId', 'caseId', 'text', 'connection', 'model', 'actionIds', 'budget', 'resourceBudget', 'shellBudget', 'source', 'paths',
      ...selectedNotebook ? ['notebookSessionId'] : [], ...selectedCache ? ['cacheMode'] : []])
    if (!text(data.source, 4096) || !Array.isArray(data.paths) || !data.paths.every((value: unknown): value is string => typeof value === 'string')) {
      throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
    }
    const resourceBudget = parseEngineeringResourceBudget(data.resourceBudget)
    const shellBudget = parseEngineeringShellBudget(data.shellBudget)
    const copy = await previewProjectCopy(data.source, data.paths, COPY_BUDGET, signal)
    if (copy.bytes > resourceBudget.workspaceBytes || copy.entries.length + 1 > resourceBudget.workspaceEntries) {
      throw Error('EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
    }
    let notebook: NotebookInputCapture | undefined
    if (selectedNotebook) {
      if (!text(data.notebookSessionId, 128)) throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
      const owner = this.ctx.get('nidofyNotebookV2')
      if (!owner) throw Error('EXPERIMENT_NOTEBOOK_OWNER_UNAVAILABLE')
      notebook = parseTaskNotebookInput(await owner.input(data.notebookSessionId, signal))
    }
    let cache: Plan['cache']
    if (selectedCache) {
      if (!['native', 'off', 'session'].includes(String(data.cacheMode))) throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
      const owner = this.ctx.get('nidofyCacheInput')
      if (!owner) throw Error('EXPERIMENT_CACHE_OWNER_UNAVAILABLE')
      const input = owner.input()
      if (!input.enabled || !input.mounted || input.policy.mode !== data.cacheMode) throw Error('EXPERIMENT_CACHE_INPUT_CHANGED')
      cache = { input, owner: owner.identity }
    }
    const { source: _source, paths: _paths, notebookSessionId: _notebook, cacheMode: _cache,
      resourceBudget: _resources, shellBudget: _shell, ...requested } = data
    const input = parseInput({ ...requested, copy })
    return this.plan(input, resourceBudget, shellBudget, signal, notebook, cache)
  }
  private async plan(input: Input, resourceBudget: EngineeringResourceBudget, shellBudget: EngineeringShellBudget, signal: AbortSignal,
    notebook?: NotebookInputCapture, cache?: Plan['cache']) {
    const sandbox = this.ctx.get('sandboxPolicy')
    if (!sandbox || sandbox.defaultMode === 'danger-full-access') throw Error('EXPERIMENT_ENGINEERING_SANDBOX_REFUSED')
    const actions = await this.actions.inspect(input.copy.source)
    if (!actions.trusted || input.actionIds.some(id => !actions.config.actions.some(action => action.id === id))) throw Error('EXPERIMENT_ENGINEERING_ACTIONS_UNTRUSTED')
    const selected = actions.config.actions.filter(action => input.actionIds.includes(action.id))
    if (selected.some(action => action.command.toLowerCase().includes(input.copy.source.toLowerCase())
      || action.timeoutMs > input.budget.durationMs)) throw Error('EXPERIMENT_ENGINEERING_ACTION_REFUSED')
    const state = this.connections.state, revision = state.current[input.connection], row = state.revisions.find(row => row.id === revision)
    if (!row || state.revoked.includes(row.id)) throw Error('CONNECTION_NOT_FOUND')
    const model = resolveProfiles({ task: { ...row.profile, apiKeyEnv: row.credential } }).get('task')?.piProvider?.getModels().find(model => model.id === input.model)
    const policyOwner = this.ctx.get('outboundHttp')
    if (!model || !policyOwner || !['openai-completions', 'anthropic-messages'].includes(model.api)) throw Error('EXPERIMENT_ENGINEERING_MODEL_REFUSED')
    const route = `nidofy-rev-${row.id}--${input.connection}`, retry = this.ctx.llm.providerRetryPolicy(route)
    if (retry.mode !== 'normal' || retry.maxRetries !== 0) throw Error('EXPERIMENT_ENGINEERING_RETRIES_REFUSED')
    const policy = await policyOwner.prepare(model.baseUrl); await policy.check(); signal.throwIfAborted(); this.alive()
    if (this.connections.state !== state) throw Error('EXPERIMENT_ENGINEERING_CONFIGURATION_CHANGED')
    for (const [ticket, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(ticket)
    if (this.plans.size >= 16) throw Error('EXPERIMENT_CONFIRMATION_LIMIT')
    const ticket = randomUUID(), expiresAt = Date.now() + 120000
    const plan: Plan = { input, resourceBudget, shellBudget, actions, configurationRevision: state.revision,
      connectionRevision: row.id, policy, policyOwner,
      expiresAt, ...notebook ? { notebook } : {}, ...cache ? { cache } : {} }
    const preview = { ticket, expiresAt, input, resourceBudget, shellBudget, reviewedActions: selected, retries: 0, copyBudget: COPY_BUDGET,
      tools: ['list_project_actions', 'run_project_action'], arbitraryCommands: false, projectWrites: 'ISOLATED_COPY_ONLY',
      exactModelVersion: null, factors: { notebook: notebook?.text ? 'CAPTURED_INPUT' : notebook ? 'EMPTY' : 'NOT_SELECTED', cache: 'UNKNOWN' },
      ...notebook ? { notebookInput: notebook } : {}, ...cache ? { cacheInput: cache.input } : {} }
    if (Buffer.byteLength(JSON.stringify(preview)) > 128 * 1024) throw Error('EXPERIMENT_ENGINEERING_RESULT_LIMIT')
    this.plans.set(ticket, plan); return preview
  }
  private async authorize(plan: Plan, signal: AbortSignal, session?: Session): Promise<void> {
    signal.throwIfAborted(); this.alive()
    const sandbox = this.ctx.get('sandboxPolicy'), permission = sandbox?.resolve(session ? { session } : {})
    if (!permission || permission.mode === 'danger-full-access'
      || session && permission.workspaceRoot !== session.header.cwd) throw Error('EXPERIMENT_ENGINEERING_SANDBOX_REFUSED')
    if (this.ctx.get('outboundHttp') !== plan.policyOwner || this.connections.state.revision !== plan.configurationRevision
      || this.connections.state.current[plan.input.connection] !== plan.connectionRevision) throw Error('EXPERIMENT_ENGINEERING_CONFIGURATION_CHANGED')
    await plan.policy.check(session?.id)
    if (plan.cache) {
      const owner = this.ctx.get('nidofyCacheInput')
      if (!owner || owner.identity !== plan.cache.owner || JSON.stringify(owner.input()) !== JSON.stringify(plan.cache.input)) {
        throw Error('EXPERIMENT_CACHE_INPUT_CHANGED')
      }
    }
    if (plan.notebook) {
      const owner = this.ctx.get('nidofyNotebookV2')
      if (!owner || JSON.stringify(await owner.input(plan.notebook.scope.sessionId, signal)) !== JSON.stringify(plan.notebook)) {
        throw Error('EXPERIMENT_NOTEBOOK_INPUT_CHANGED')
      }
    }
    const actual = await this.actions.inspect(plan.input.copy.source)
    if (!actual.trusted || actual.fingerprint !== plan.actions.fingerprint) throw Error('EXPERIMENT_ENGINEERING_ACTIONS_CHANGED')
    signal.throwIfAborted(); this.alive()
    if (this.ctx.get('outboundHttp') !== plan.policyOwner || this.connections.state.revision !== plan.configurationRevision) throw Error('EXPERIMENT_ENGINEERING_CONFIGURATION_CHANGED')
    const currentPermission = this.ctx.get('sandboxPolicy')?.resolve(session ? { session } : {})
    if (!currentPermission || currentPermission.mode === 'danger-full-access'
      || session && currentPermission.workspaceRoot !== session.header.cwd) throw Error('EXPERIMENT_ENGINEERING_SANDBOX_REFUSED')
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.records.catch(() => {}).then(work); this.records = next; return next
  }
  private publish(root: string, name: string, value: object): Promise<void> {
    return this.serialize(() => this.publishOne(root, name, value))
  }
  private async publishOne(root: string, name: string, value: object): Promise<void> {
    const bytes = JSON.stringify(value)
    if (Buffer.byteLength(bytes) > 1024 * 1024 || await size(root) + 2 * Buffer.byteLength(bytes) > ROOT_LIMIT) throw Error('EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
    if (!await publishRecord(join(root, name), bytes)) throw Error('EXPERIMENT_ENGINEERING_RECORD_EXISTS')
  }
  private async start(data: Record<string, unknown>) {
    fields(data, ['id', 'ticket', 'accepted']); const runId = brandString<EngineeringTaskId>(id(data.id)), ticket = id(data.ticket)
    if (data.accepted !== true) throw Error('EXPERIMENT_ENGINEERING_CONFIRMATION_REQUIRED')
    const plan = this.plans.get(ticket); this.plans.delete(ticket)
    if (!plan || plan.expiresAt < Date.now()) throw Error('EXPERIMENT_CONFIRMATION_EXPIRED')
    if (this.active) throw Error('EXPERIMENT_ENGINEERING_BUSY')
    const controller = new AbortController()
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(Object.assign(Error('EXPERIMENT_ENGINEERING_TIMEOUT'), { name: 'TimeoutError' })) },
      plan.input.budget.durationMs)
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal, deadline.signal])
    let finish!: () => void
    const active = { id: runId, controller, signal, done: new Promise<void>((resolve) => { finish = resolve }) }; this.active = active
    let quota: QuotaLease | undefined
    const root = join(this.base, runId)
    try {
      await this.authorize(plan, signal)
      quota = await this.storage.reserve('node:engineering-task', ROOT_LIMIT, 1024 * 1024, brandString<StorageOperationId>(runId))
      const lease = quota
      const intent = await lease.run(() => this.storage.write(this.base, 4096, async () => {
        await unlinked(this.base); await mkdir(this.base, { recursive: true, mode: 0o700 })
        return withFileLock(join(this.base, 'admission'), async () => {
          const names = await engineeringDirectoryNames(this.base, 21, signal, 'EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
          let retained = 0, unfinished = 0, bytes = 0, shellCharge = 0
          const shells: { budget: EngineeringShellBudget | null; result: ReturnType<EngineeringShellRun['result']> | null }[] = []
          const allocations: { allocation: EngineeringResourceAllocation | null; workspaceIdentity: string | undefined }[] = []
          for (const name of names) {
            if (name === 'admission.lock') { const info = await lstat(join(this.base, name)); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw Error('EXPERIMENT_ENGINEERING_PATH_REFUSED'); bytes += info.size; continue }
            id(name); retained++; bytes += await size(join(this.base, name))
            const retainedRun = await this.read(name, signal)
            if (!retainedRun) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
            shells.push({ budget: retainedRun.shellBudget, result: retainedRun.shellResult })
            allocations.push({ allocation: retainedRun.resourceAllocation,
              workspaceIdentity: retainedRun.resourceResult?.checkpoints.find(row => row.workspace?.identity)
                ?.workspace?.identity ?? undefined })
            if (!await readRecord(join(this.base, name, 'terminal.json'))) unfinished++
          }
          if (retained >= 20 || unfinished >= 10 || bytes + 2 * ROOT_LIMIT > 22 * ROOT_LIMIT + 4096) throw Error('EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
          for (const shell of shells) {
            if (!shell.budget) throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
            shellCharge += await engineeringShellCharge(shell.budget, shell.result)
          }
          if (shellCharge + plan.shellBudget.outputBytes > plan.shellBudget.retainedSpillBytes) throw Error('EXPERIMENT_RESOURCE_SHELL_RETAINED_LIMIT')
          let retainedWorkspaceBytes = 0
          for (const { allocation, workspaceIdentity } of allocations) {
            if (!allocation) throw Error('EXPERIMENT_RESOURCE_OWNER_UNAVAILABLE')
            await measureEngineeringWorkspace(allocation, signal, workspaceIdentity)
            // Full per-copy charges persist with the allocation, including partial and in-flight copies in another Host.
            retainedWorkspaceBytes += allocation.budget.workspaceBytes
            if (retainedWorkspaceBytes + plan.resourceBudget.workspaceBytes > plan.resourceBudget.retainedWorkspaceBytes) {
              throw Error('EXPERIMENT_RESOURCE_RETAINED_LIMIT')
            }
          }
          signal.throwIfAborted(); await mkdir(root, { mode: 0o700 })
          const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-engineering-task-')), workspace = join(workspaceRoot, 'project')
          const intent: Intent = { schemaVersion: 1, kind: 'engineering-task', id: runId, sessionId: SessionId('engineering-task-' + runId),
            workspace, startedAt: Date.now(), input: plan.input, configurationRevision: plan.configurationRevision,
            connectionRevision: plan.connectionRevision, policyRevision: { ...plan.policy.revision },
            actionConfig: { schemaVersion: 1,
              actions: plan.actions.config.actions.filter(action => plan.input.actionIds.includes(action.id)) } }
          await this.publish(root, 'intent.json', intent)
          const info = await lstat(workspaceRoot, { bigint: true })
          const allocation: EngineeringResourceAllocation = { schemaVersion: 1, kind: 'engineering-resource-allocation',
            id: runId, workspace, identity: `${info.dev}:${info.ino}`, budget: plan.resourceBudget }
          await this.publish(root, 'resource-allocation.json', allocation)
          await this.publish(root, 'shell-allocation.json', { schemaVersion: 1, kind: 'engineering-shell-allocation', id: runId, budget: plan.shellBudget })
          if (plan.notebook) await this.publish(root, 'notebook-input.json', { schemaVersion: 1, kind: 'engineering-notebook-input',
            id: intent.id, input: plan.notebook })
          if (plan.cache) await this.publish(root, 'cache-input.json', { schemaVersion: 1, kind: 'engineering-cache-input',
            id: intent.id, input: plan.cache.input })
          return intent
        })
      }))
      void (async () => {
        try { await this.run(plan, intent, root, signal, lease) } finally {
          await lease.release().catch(() => { /* A failed native settlement retains its charge. */ })
          clearTimeout(timer); this.active = undefined; finish()
        }
      })().catch(() => { /* An unconfirmed terminal remains INTERRUPTED; no replay is authorized. */ })
      return { id: runId, status: 'RUNNING', canCancel: true, intent }
    } catch (error) {
      await quota?.release().catch(() => { /* Unknown native charges remain retained. */ })
      clearTimeout(timer); this.active = undefined; finish(); throw error
    }
  }
  private async run(plan: Plan, intent: Intent, root: string, signal: AbortSignal, quota: QuotaLease): Promise<void> {
    const budget = new EngineeringBudgetOwner(plan.input.budget)
    const allocationBytes = await readRecord(join(root, 'resource-allocation.json'))
    if (!allocationBytes) throw Error('EXPERIMENT_RESOURCE_OWNER_UNAVAILABLE')
    const resources = new EngineeringResourceOwner(parseEngineeringResourceAllocation(JSON.parse(allocationBytes.toString('utf8')),
      intent.id, intent.workspace))
    const shell = new EngineeringShellRun(intent.id, plan.shellBudget), unbindShell = this.shellObserver.bind(intent.sessionId, shell)
    let handle: Awaited<ReturnType<Context['agents']['create']>> | undefined, diagnostic: string | null = null, status = 'UNKNOWN', cuts = 0
    try {
      await copyProject(plan.input.copy, intent.workspace, COPY_BUDGET, signal)
      await resources.workspace('copy', signal)
      const saved = await this.actions.save(intent.workspace, intent.actionConfig)
      await this.actions.trust(intent.workspace, saved.fingerprint)
      await quota.run(() => this.publish(root, 'copy.json', { schemaVersion: 1, kind: 'engineering-copy', workspace: intent.workspace,
        fingerprint: saved.fingerprint, bytes: plan.input.copy.bytes }))
      const sessionId = SessionId(intent.sessionId), route = `nidofy-rev-${plan.connectionRevision}--${plan.input.connection}`
      await this.authorize(plan, signal)
      handle = await this.ctx.agents.create({ sessionId, meta: { cwd: intent.workspace }, signal,
        agentOptions: { provider: route, model: plan.input.model, maxTokens: plan.input.budget.outputTokensPerRequest },
        setup: (ctx, agent) => {
          this.internalSession(agent.session)
          ctx.tools.presentAs('native'); ctx.tools.restrict({ allow: ['list_project_actions', 'run_project_action'] })
          ctx.on('session/event', (session, event) => {
            if (session.id === sessionId && event.type === 'tool/result' && event.data.message.isError) {
              budget.stop('EXPERIMENT_ENGINEERING_TOOL_FAILED')
            }
          })
          ctx.tools.guard((exec) => {
            if (signal.aborted || exec.agent !== agent || exec.parent !== undefined || !['list_project_actions', 'run_project_action'].includes(exec.name)) return 'EXPERIMENT_ENGINEERING_TOOL_REFUSED'
            if (exec.name === 'run_project_action') {
              const args = object(exec.arguments)
              if (Object.keys(args).length !== 1 || typeof args.id !== 'string' || !plan.input.actionIds.includes(args.id)) return 'EXPERIMENT_ENGINEERING_ACTION_REFUSED'
            }
            try { budget.check(); shell.check() } catch (error) { return code(error) }
            return undefined
          })
          ctx.on('tools/execute', async (exec, next) => {
            await this.authorize(plan, signal, agent.session)
            const current = await this.actions.inspect(intent.workspace)
            if (!current.trusted || current.fingerprint !== saved.fingerprint) throw Error('EXPERIMENT_ENGINEERING_ACTIONS_CHANGED')
            await resources.workspace('before-tool', signal)
            budget.tool(exec.name === 'run_project_action' ? String(object(exec.arguments).id) : null)
            let result: Awaited<ReturnType<typeof next>>
            try { result = await next() }
            finally {
              try { await resources.workspace('after-tool', signal) }
              catch (error) { budget.stop(code(error)) }
            }
            if (result.isError) budget.stop('EXPERIMENT_ENGINEERING_TOOL_FAILED')
            else if (exec.name === 'run_project_action') {
              const value = object(result.value), verification = object(value.verification), receipt = object(verification.receipt)
              if (verification.phase !== 'COMMITTED' || receipt.exitCode !== 0 || receipt.cancelled !== false
                || receipt.timedOut !== false || receipt.interrupted !== false || receipt.tests !== 'PASSED') {
                budget.stop('EXPERIMENT_ENGINEERING_ACTION_UNCONFIRMED')
              }
            }
            return result
          })
          ctx.on('agent/pre-step', async (payload, next) => { signal.throwIfAborted(); budget.check(); shell.check(); if (payload.turn !== 1) throw Error('EXPERIMENT_ENGINEERING_TURN_REFUSED'); return next() })
          ctx.on('llm/stream', (options, next) => {
            if (options.sessionId !== sessionId) return next()
            return (async function* (owner: EngineeringTaskOwner) {
              const index = ++cuts
              const chunks = await captureEngineeringRequest(owner.ctx, agent, options, next, budget,
                async () => { shell.check(); await resources.workspace('request', signal); await owner.authorize(plan, signal, agent.session) }, (kind, value) => kind === 'input'
                  ? quota.run(() => owner.publish(root, `input-${index}.json`, value))
                  : quota.terminal(() => owner.publish(root, `observation-${index}.json`, value)), resources, plan.cache?.input)
              yield* chunks
            })(this)
          }, { global: true })
        } })
      const agent = handle.agent, cancel = (): void => { agent.cancel({ kind: 'hook', reason: 'EXPERIMENT_ENGINEERING_CANCELLED' }) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        signal.throwIfAborted()
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: plan.input.text },
          ...plan.notebook?.text ? [{ type: 'text' as const, text: '\n\n' + plan.notebook.text }] : []] }))
        await agent.whenIdle(); signal.throwIfAborted(); budget.check()
        if (!await this.ctx.sessions.flush(agent.session)) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
        const durable = await observeEngineeringSession(this.ctx.sessionPersistence, sessionId, plan.resourceBudget, signal)
        const last = durable.events.at(-1)
        if (last?.type !== 'turn/end' || last.data.turn !== 1 || last.data.reason.kind !== 'completed') {
          throw Error(last?.type === 'turn/end' && last.data.reason.kind === 'error'
            ? last.data.reason.error.message : 'EXPERIMENT_ENGINEERING_TURN_UNCONFIRMED')
        }
        if (budget.snapshot().dispatches === 0) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
        status = 'COMPLETED'
      } finally { signal.removeEventListener('abort', cancel) }
    } catch (error) {
      diagnostic = code(error)
      status = signal.aborted ? signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' : 'UNKNOWN'
      budget.stop(diagnostic)
    } finally {
      await handle?.dispose()
      unbindShell()
      try { shell.check() } catch (error) { diagnostic ??= code(error); budget.stop(code(error)); if (status === 'COMPLETED') status = 'UNKNOWN' }
      try {
        await resources.workspace('drained', this.lifetime.signal)
        if (handle) {
          const persistence = this.ctx.sessionPersistence
          const durable = await resources.observe(persistence, intent.sessionId, 'drained', this.lifetime.signal)
          await persistence.withGeneration(intent.sessionId, durable.generation, async () => {
            resources.session(durable, await persistence.stat(intent.sessionId, { signal: this.lifetime.signal }), 'drained')
          }, { signal: this.lifetime.signal })
        }
      } catch (error) {
        diagnostic ??= code(error); budget.stop(diagnostic)
        if (status === 'COMPLETED') status = 'UNKNOWN'
      }
      await quota.terminal(() => this.publish(root, 'resource-result.json', resources.result()))
      await quota.terminal(() => this.publish(root, 'shell-result.json', shell.result()))
      await quota.terminal(() => this.publish(root, 'terminal.json', { schemaVersion: 1, kind: 'engineering-terminal', id: intent.id,
        endedAt: Date.now(), status, diagnostic, counts: budget.snapshot() }))
    }
  }
  private async read(runId: string, signal: AbortSignal) {
    // Official generation guards take exclusive physical ownership. Admission and UI reads must not compete for it.
    const next = this.readers.catch(() => {}).then(() => { signal.throwIfAborted(); return this.readOne(runId, signal) })
    this.readers = next
    try { return await next } catch (error) {
      if (error instanceof Error && code(error) === 'EXPERIMENT_ENGINEERING_UNCONFIRMED') {
        try { this.ctx.logger.warn(error.stack?.split('\n').slice(1).join('\n') ?? error.name) }
        catch (diagnosticError) { /* Diagnostics cannot replace the original read failure. */ void diagnosticError }
      }
      throw error
    }
  }
  private async readOne(runId: string, signal: AbortSignal) {
    const root = join(this.base, id(runId))
    const running = this.active?.id === runId
    const retained = await this.serialize(async () => {
      const original = await readRecord(join(root, 'intent.json'))
      if (!original) return null
      await size(root)
      const bytes = new Map<string, Buffer>()
      for (const name of await engineeringDirectoryNames(root, 80, signal, 'EXPERIMENT_ENGINEERING_STORAGE_LIMIT')) {
        const value = await readRecord(join(root, name)); if (!value) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
        bytes.set(name, value)
      }
      return bytes
    })
    const original = retained?.get('intent.json')
    if (!retained || !original) return null
    const row = object(JSON.parse(original.toString('utf8')))
    fields(row, ['schemaVersion', 'kind', 'id', 'sessionId', 'workspace', 'startedAt', 'input', 'configurationRevision', 'connectionRevision', 'policyRevision', 'actionConfig'])
    if (row.schemaVersion !== 1 || row.kind !== 'engineering-task' || row.id !== runId || row.sessionId !== 'engineering-task-' + runId
      || !text(row.workspace, 4096)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
    const input = parseInput(row.input), policy = object(row.policyRevision)
    const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    fields(policy, ['distribution', 'profile'])
    if (!isAbsolute(row.workspace) || !integer(row.startedAt) || !integer(row.configurationRevision)
      || !text(policy.distribution, 128) || !integer(policy.profile)
      || !text(row.connectionRevision, 36) || !UUID.test(row.connectionRevision)
      || input.copy.entries.length > COPY_BUDGET.maxEntries || input.copy.bytes > COPY_BUDGET.maxBytes
      || input.copy.entries.some(entry => entry.kind === 'file' && entry.stamp.bytes > COPY_BUDGET.maxFileBytes)
      || JSON.stringify(validateActionConfig(row.actionConfig)) !== JSON.stringify(row.actionConfig)) {
      throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
    }
    const copyBytes = retained.get('copy.json')
    if (copyBytes) {
      const copy = object(JSON.parse(copyBytes.toString('utf8')))
      fields(copy, ['schemaVersion', 'kind', 'workspace', 'fingerprint', 'bytes'])
      if (copy.schemaVersion !== 1 || copy.kind !== 'engineering-copy' || copy.workspace !== row.workspace
        || copy.bytes !== input.copy.bytes || !text(copy.fingerprint, 64) || !/^[a-f0-9]{64}$/u.test(copy.fingerprint)) {
        throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      }
    }
    const resourceBytes = retained.get('resource-allocation.json'), resourceResultBytes = retained.get('resource-result.json')
    const resourceAllocation = resourceBytes ? parseEngineeringResourceAllocation(JSON.parse(resourceBytes.toString('utf8')),
      runId, row.workspace) : null
    if (resourceResultBytes && !resourceAllocation) throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
    const resourceResult = resourceResultBytes && resourceAllocation
      ? parseEngineeringResourceResult(JSON.parse(resourceResultBytes.toString('utf8')), resourceAllocation) : null
    const shellBytes = retained.get('shell-allocation.json'), shellResultBytes = retained.get('shell-result.json')
    let shellBudget: EngineeringShellBudget | null = null
    if (shellBytes) {
      const allocation = object(JSON.parse(shellBytes.toString('utf8')))
      fields(allocation, ['schemaVersion', 'kind', 'id', 'budget'])
      if (allocation.schemaVersion !== 1 || allocation.kind !== 'engineering-shell-allocation' || allocation.id !== runId) throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
      shellBudget = parseEngineeringShellBudget(allocation.budget)
    }
    if (shellResultBytes && !shellBudget) throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
    const shellResult = shellResultBytes ? parseEngineeringShellResult(JSON.parse(shellResultBytes.toString('utf8')), runId) : null
    if (shellResult && shellBudget) {
      const total = shellResult.runs.reduce((sum, run) => sum + (run.stdout.bytes ?? 0) + (run.stderr.bytes ?? 0), 0)
      if (!Number.isSafeInteger(total) || shellResult.diagnostic === null && (total >= shellBudget.outputBytes
        || shellResult.runs.some(run => run.stdout.bytes === null || run.stderr.bytes === null))) throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
    }
    const files = [...retained.keys()], cuts: Record<string, unknown>[] = [], observations: Record<string, unknown>[] = []
    let cacheInput: DesktopCacheInput | null = null
    const cacheBytes = retained.get('cache-input.json')
    if (cacheBytes) {
      const envelope = object(JSON.parse(cacheBytes.toString('utf8'))), cache = object(envelope.input), policy = object(cache.policy)
      fields(envelope, ['schemaVersion', 'kind', 'id', 'input']); fields(cache, ['preferenceRevision', 'enabled', 'mounted', 'policy'])
      fields(policy, ['mode', 'models'])
      if (envelope.schemaVersion !== 1 || envelope.kind !== 'engineering-cache-input' || envelope.id !== runId
        || !integer(cache.preferenceRevision) || cache.enabled !== true || cache.mounted !== true
        || !['native', 'off', 'session'].includes(String(policy.mode)) || !Array.isArray(policy.models) || policy.models.length > 64
        || !policy.models.every((value: unknown): value is string => text(value, 256))) throw Error('EXPERIMENT_CACHE_INPUT_INVALID')
      cacheInput = { preferenceRevision: cache.preferenceRevision, enabled: true, mounted: true,
        policy: { mode: policy.mode as DesktopCacheInput['policy']['mode'], models: policy.models } }
    }
    let notebookInput: NotebookInputCapture | null = null
    const notebookBytes = retained.get('notebook-input.json')
    if (notebookBytes) {
      const notebook = object(JSON.parse(notebookBytes.toString('utf8')))
      fields(notebook, ['schemaVersion', 'kind', 'id', 'input'])
      if (notebook.schemaVersion !== 1 || notebook.kind !== 'engineering-notebook-input' || notebook.id !== runId) {
        throw Error('EXPERIMENT_NOTEBOOK_INPUT_INVALID')
      }
      notebookInput = parseTaskNotebookInput(notebook.input)
    }
    const fixedFiles = ['intent.json', 'terminal.json', 'copy.json', 'notebook-input.json', 'cache-input.json',
      'resource-allocation.json', 'resource-result.json', 'shell-allocation.json', 'shell-result.json']
    if (files.some(name => !fixedFiles.includes(name)
      && !/^(?:input|observation)-[1-8]\.json$/u.test(name))) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
    // Live writer disposal can change handle ownership. Only a terminal publication attests drained input/receipt facts.
    if (running && !retained.has('terminal.json')) {
      signal.throwIfAborted()
      return { intent: row, terminal: null, status: 'RUNNING', preparedInputs: [], dispatchInputs: null,
        requestObservations: null, counts: null, receipts: [], resourceAllocation, resourceResult, shellBudget, shellResult,
        exactModelVersion: null, quality: 'UNKNOWN', efficiencyEligible: false }
    }
    for (const name of files) {
      if (fixedFiles.includes(name)) continue
      if (!/^(?:input|observation)-[1-8]\.json$/u.test(name)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      const bytes = retained.get(name); if (!bytes) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      const value = object(JSON.parse(bytes.toString('utf8')))
      if (value.schemaVersion !== 1 || value.sessionId !== row.sessionId) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      if (name.startsWith('input-')) {
        fields(value, ['schemaVersion', 'kind', 'sessionId', 'generation', 'through', 'turn', 'step', 'input'])
        if (value.turn !== 1 || value.step !== Number(name.slice(6, -5))) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
        if (value.kind !== 'engineering-input-cut' || !text(value.generation, 512) || typeof value.through !== 'number'
          || !Number.isSafeInteger(value.through) || value.through < 0) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
        cuts.push(value)
      } else {
        fields(value, ['schemaVersion', 'kind', 'sessionId', 'through', 'invoked', 'complete', 'usage', 'observation'])
        if (value.kind !== 'engineering-request-observation' || value.invoked !== true || typeof value.complete !== 'boolean'
          || typeof value.through !== 'number' || !Number.isSafeInteger(value.through) || value.through < 0) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
        parseManagedRequestObservation(value.observation); observations.push(value)
      }
    }
    const terminalBytes = retained.get('terminal.json'), terminal = terminalBytes ? object(JSON.parse(terminalBytes.toString('utf8'))) : null
    if (terminal && (terminal.schemaVersion !== 1 || terminal.kind !== 'engineering-terminal' || terminal.id !== runId
      || !['COMPLETED', 'UNKNOWN', 'CANCELLED', 'TIMEOUT'].includes(String(terminal.status)))) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
    const invoked = cuts.filter(cut => observations.some(observation => observation.through === cut.through))
    if (new Set(cuts.map(cut => cut.through)).size !== cuts.length
      || new Set(observations.map(row => row.through)).size !== observations.length || invoked.length !== observations.length) {
      throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
    }
    if (cuts.some((cut, index) => cut.step !== index + 1)) throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
    if (terminal) {
      fields(terminal, ['schemaVersion', 'kind', 'id', 'endedAt', 'status', 'diagnostic', 'counts'])
      if (!integer(terminal.endedAt) || terminal.endedAt < row.startedAt
        || terminal.diagnostic !== null && !text(terminal.diagnostic, 128)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      const counts = object(terminal.counts)
      fields(counts, ['dispatches', 'providerWireRequests', 'allocatedOutputTokens', 'toolCalls', 'actionAttempts', 'diagnostic',
        'inputTokens', 'outputTokens', 'cacheReadTokens'])
      if (counts.providerWireRequests !== null || counts.dispatches !== observations.length || !integer(counts.toolCalls)
        || counts.toolCalls > input.budget.toolCalls || !integer(counts.actionAttempts) || counts.actionAttempts > input.budget.actions
        || counts.allocatedOutputTokens !== observations.length * input.budget.outputTokensPerRequest
        || observations.length > input.budget.requests || counts.allocatedOutputTokens > input.budget.outputTokens
        || counts.diagnostic !== null && !text(counts.diagnostic, 128)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens']) {
        let total = 0, complete = true
        for (const observation of observations) {
          const usage = observation.usage === null ? null : object(observation.usage), value = usage?.[key]
          if (!integer(value)) complete = false
          else { total += value; if (!integer(total)) complete = false }
        }
        if (counts[key] !== (complete ? total : null)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      }
      if (terminal.status === 'COMPLETED' && (observations.length === 0 || invoked.length !== cuts.length
        || observations.some(row => !row.complete) || terminal.diagnostic !== null || !copyBytes)) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      if (shellBudget && (!shellResult || shellResult.runs.length > counts.actionAttempts || terminal.status === 'COMPLETED'
        && (shellResult.runs.length !== counts.actionAttempts || shellResult.diagnostic !== null
          || shellResult.runs.some(run => run.stdout.bytes === null || run.stderr.bytes === null)))) {
        throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
      }
      if (terminal.status === 'COMPLETED' && resourceAllocation && (!resourceResult
        || resourceResult.checkpoints.some(row => row.diagnostic !== null)
        || !resourceResult.checkpoints.some(row => row.phase === 'copy' && row.workspace !== null && row.workspace.identity !== null)
        || !resourceResult.checkpoints.some(row => row.phase === 'drained' && row.workspace !== null)
        || !resourceResult.checkpoints.some(row => row.phase === 'drained' && row.session !== null))) {
        throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
      }
    }
    const receipts: { selection: ReceiptSelection; view: VerificationView; link: ModelStepLineage['link'] }[] = []
    if (cuts.length || resourceResult?.checkpoints.some(row => row.session !== null)) {
      const persistence = this.ctx.get('sessionPersistence'), sessions = this.ctx.get('sessions')
      if (!persistence || !sessions) throw Error('EXPERIMENT_ENGINEERING_INPUT_OWNER_UNAVAILABLE')
      const durable = await observeEngineeringSession(persistence, SessionId(row.sessionId), SESSION_SCAN_LIMIT, signal)
      if (durable.events.length > 4096 || Buffer.byteLength(JSON.stringify(durable)) > ROOT_LIMIT) throw Error('EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
      await persistence.withGeneration(durable.meta.id, durable.generation, async () => {
        if (durable.meta.id !== row.sessionId || durable.meta.cwd !== row.workspace || durable.inheritedEventCount !== 0) {
          throw Error('EXPERIMENT_ENGINEERING_INPUT_CHANGED')
        }
        for (const cut of cuts) {
          if (durable.generation !== cut.generation || durable.events.length <= Number(cut.through)) throw Error('EXPERIMENT_ENGINEERING_INPUT_CHANGED')
          const step = durable.events.slice(0, Number(cut.through) + 1).findLast(event => event.type === 'step/start')
          if (step?.type !== 'step/start' || step.data.turn !== cut.turn || step.data.step !== cut.step) {
            throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
          }
          const cold = Session.create(durable.meta.id, durable.events.slice(0, Number(cut.through) + 1), durable.meta,
            SessionLogOffset(0), sessions.messageProjections)
          const header = cold.requestHeader()
          if (!header) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
          const expected = { ...header.config, messages: cold.deriveMessages(), toolHistory: cold.toolHistory(),
            ...header.tools ? { tools: header.tools } : {}, sessionId: cold.id }
          if (JSON.stringify(cut.input) !== JSON.stringify(expected)) throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
          const task = durable.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
          if (task?.type !== 'user/message' || JSON.stringify(task.data.content) !== JSON.stringify([{ type: 'text', text: input.text },
            ...notebookInput?.text ? [{ type: 'text', text: '\n\n' + notebookInput.text }] : []])) {
            throw Error('EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
          }
        }
        const physical = resourceResult ? await persistence.stat(durable.meta.id, { signal }) : undefined
        if (resourceResult) validateEngineeringResourceSession(durable, physical, resourceResult)
        if (!terminal || !cuts.length) return
        if (terminal.status === 'COMPLETED') {
          const endings = durable.events.filter(event => event.type === 'turn/end' && event.data.turn === 1)
          const settlements = durable.events.filter(event => (event.type === 'assistant/attempt' || event.type === 'assistant/message')
            && event.data.turn === 1)
          const ending = endings[0]
          if (endings.length !== 1 || ending?.type !== 'turn/end' || ending.data.reason.kind !== 'completed'
            || settlements.length !== cuts.length || settlements.length !== observations.length
            || cuts.some((cut, index) => cut.step !== index + 1)) throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
        }
        for (const observation of observations) {
          const cut = cuts.find(cut => cut.through === observation.through)
          if (!cut) throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
          const settlements = durable.events.filter(event => (event.type === 'assistant/attempt' || event.type === 'assistant/message')
            && event.data.turn === cut.turn && event.data.step === cut.step)
          const settlement = settlements[0]
          if (settlements.length !== 1 || !settlement || settlement.type !== 'assistant/attempt' && settlement.type !== 'assistant/message') {
            throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
          }
          const chunks = expandAssistantStream(settlement.data.stream), usage = chunks.filter(row => row.chunk.type === 'usage').at(-1)?.chunk
          if (JSON.stringify(observation.usage) !== JSON.stringify(usage?.type === 'usage' ? usage.usage : null)) throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
          const finish = chunks.at(-1)?.chunk, input = object(cut.input), capture = parseManagedRequestObservation(observation.observation)
          if (cacheInput && terminal.status === 'COMPLETED' && (!capture.cache || !capture.cache.applied
            || capture.cache.preferenceRevision !== cacheInput.preferenceRevision
            || JSON.stringify(capture.cache.policy) !== JSON.stringify(cacheInput.policy))) throw Error('EXPERIMENT_CACHE_INPUT_INVALID')
          if (JSON.stringify(capture.response) !== JSON.stringify(reportedResponseModel(finish?.type === 'finish' ? finish : undefined,
            String(input.model), String(input.provider)))) throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
        }
        for (const event of durable.events) {
          if (event.type !== 'tool/result' || event.data.message.isError || event.data.message.content.length !== 1) continue
          const content = event.data.message.content[0]
          if (content?.type !== 'text') continue
          let result: Record<string, unknown>
          try { result = object(JSON.parse(content.text)) } catch (_error) { continue }
          if (!text(result.id, 36) || !UUID.test(result.id)) continue
          const source = await this.verification.executionSource(String(row.workspace), result.id)
          if (source?.source !== 'agent' || source.sessionId !== row.sessionId) continue
          const selection = { workspace: String(row.workspace), runId: brandString<VerificationRunId>(result.id) }
          const view = await this.verification.inspect(selection.workspace, selection.runId)
          const lineage = modelStepLineage(selection, view, durable, sessions.messageProjections)
          if (lineage.status === 'LINKED') receipts.push({ selection, view, link: lineage.link })
        }
      }, { signal })
    }
    const result = { intent: row, terminal, status: terminal?.status ?? (running ? 'RUNNING' : 'INTERRUPTED'),
      preparedInputs: cuts, dispatchInputs: terminal ? invoked : null, requestObservations: terminal ? observations : null,
      counts: terminal?.counts ?? null, receipts, notebookInput, cacheInput, resourceAllocation, resourceResult, shellBudget, shellResult,
      exactModelVersion: null, quality: 'UNKNOWN', efficiencyEligible: false }
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('EXPERIMENT_ENGINEERING_RESULT_LIMIT')
    signal.throwIfAborted(); return result
  }
  private async compare(data: Record<string, unknown>, signal: AbortSignal) {
    fields(data, ['a', 'b', 'factor'])
    if (data.factor !== 'notebook' && data.factor !== 'cache') throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
    const facts = async (runId: string): Promise<EngineeringComparisonRun> => {
      const active = this.active, value = await this.read(runId, signal)
      if (!value) throw Error('EXPERIMENT_ENGINEERING_RECORD_MISSING')
      if (value.terminal && active?.id === runId) await active.done
      if (typeof value.status !== 'string') throw Error('EXPERIMENT_ENGINEERING_RECORD_INVALID')
      return { id: runId, status: value.status, input: parseInput(value.intent.input), actionConfig: value.intent.actionConfig,
        preparedInputs: value.preparedInputs.map(row => row.input), counts: value.counts ? object(value.counts) : null,
        notebook: 'notebookInput' in value ? value.notebookInput : null, cache: 'cacheInput' in value ? value.cacheInput : null,
        resources: value.resourceAllocation ? { allocation: value.resourceAllocation, result: value.resourceResult } : null,
        shell: value.shellBudget ? { budget: value.shellBudget, result: value.shellResult } : null,
        original: { intent: value.intent, terminal: value.terminal },
        reportedModels: value.requestObservations?.map(row => parseManagedRequestObservation(row.observation).response) ?? null,
        receipts: value.receipts }
    }
    const a = await facts(id(data.a)), b = await facts(id(data.b)), result = compareEngineeringRuns(data.factor, a, b)
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('EXPERIMENT_ENGINEERING_RESULT_LIMIT')
    signal.throwIfAborted(); return result
  }
  /** Dispatch exact local-user engineering prepare/start/read/cancel operations; missing/unknown outcomes are never retried.
   * @param method - Independent engineering operation, separate from T19 and single analysis tasks.
   * @param data - Complete authenticated JSON; starts consume a one-use full-input/action/budget preview.
   * @param signal - HTTP read lifetime; committed work retains its own cancellation controller.
   * @returns Retained run identity and bounded facts. No acceptance decision is generated.
   */
  request(method: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.stopped) return Promise.reject(Error('EXPERIMENT_STOPPING'))
    const lifetime = AbortSignal.any([this.lifetime.signal, ...signal ? [signal] : []])
    const work = (async () => {
      if (method === 'engineering-prepare') return this.prepare(data, lifetime)
      if (method === 'engineering-start') return this.start(data)
      if (method === 'engineering-compare') return this.compare(data, lifetime)
      if (!['engineering-read', 'engineering-cancel'].includes(method)) throw Error('EXPERIMENT_ENGINEERING_INPUT_INVALID')
      fields(data, ['id']); const runId = id(data.id)
      const active = this.active
      if (method === 'engineering-cancel') {
        if (!active || active.id !== runId) throw Error('EXPERIMENT_ENGINEERING_CHANGED')
        active.controller.abort(Error('CANCELLED')); await active.done
      }
      const result = await this.read(runId, lifetime)
      if (result?.terminal && active?.id === runId) await active.done
      return result && { ...result, canCancel: this.active?.id === runId && !this.active.controller.signal.aborted }
    })()
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work)).catch(() => { /* The initiating caller receives failures. */ })
    return work
  }
  /** Revoke previews, cancel copy/Agent work and wait for the official driver, protected actions and quota writers to drain. */
  async close(): Promise<void> {
    this.stopped = true; this.plans.clear(); this.lifetime.abort(); this.active?.controller.abort(Error('CANCELLED'))
    await Promise.allSettled(this.pending); await this.active?.done
  }
}
