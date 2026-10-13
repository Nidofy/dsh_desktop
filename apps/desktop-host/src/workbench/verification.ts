/** Durable verification owner over real ProjectActions and artifact observations; no execution replay or Session writes. */
import { createHash } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { object } from '../connections/store.ts'
import { commandFacts, tapSummary, type TestLogSummary } from './evidence.ts'
import type { Action, ProjectActions, Run, VerificationHooks, VerificationSpec, ExecutionObservation } from './legacy/project-actions.mjs'
import type { DesktopArtifacts } from './legacy/desktop-artifacts.mjs'
import { executionFingerprint, runtimeFingerprint, observeInputs, type InputObservation } from './verification-input.ts'
import { publishRecord, readRecord } from './verification-storage.ts'

/** Verification identity derived from one retained real run, never an authority to repeat it. */
export type ReceiptId = Branded<'nidofy.VerificationReceiptId'>
/** ProjectActions-owned run identity persisted before command execution. */
export type VerificationRunId = Branded<'nidofy.VerificationRunId'>
/** Actual file observation associated with settlement of this run; it does not assert which process wrote the file. */
export interface RunArtifact {
  runId: VerificationRunId
  path: string
  observation: 'observed-after-run' | 'missing' | 'unknown'
  digest: string | null
  bytes: number | null
}
/** Immutable execution/test facts; freshness and acceptance are projected from independent current observations. */
export interface VerificationReceipt {
  schemaVersion: 1
  id: ReceiptId
  runId: VerificationRunId
  intent: string
  sourceFingerprint: string | null
  inputFingerprint: string | null
  coverage: 'complete' | 'unknown'
  configRevision: number
  completedAt: number
  command: { actionId: string; digest: string; cwd: string; environmentDigest: string }
  exitCode: number | null
  cancelled: boolean
  timedOut: boolean
  interrupted: boolean
  log: { digest: string | null; complete: boolean; parserVersion: 'node-tap-13/1' | null }
  tests: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'UNKNOWN'
  summary: TestLogSummary | null
  artifacts: RunArtifact[]
  acceptance: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'
}
/** A pending or unavailable commit remains unknown after restart; legacy runs never acquire a retrospective receipt. */
export interface VerificationView {
  phase: 'LEGACY' | 'PENDING' | 'INTERRUPTED' | 'COMMITTED'
  receipt: VerificationReceipt | null
  acceptanceRevision: number
  logAvailable: boolean
  diagnostic: string | null
}
/** Sync-confirmed result identity for subscribers; consumers read facts from the durable owner. */
export interface VerificationCommit {
  workspace: string
  receiptId: ReceiptId
  runId: VerificationRunId
  scope: { sessionId: string } | null
}
/** Retained terminal facts consumed by durable notifications without reading present workspace files. */
export interface CommittedVerification extends VerificationCommit { receipt: VerificationReceipt }
type Intent = {
  schemaVersion: 1
  runId: string
  workspace: string
  configRevision: number
  configFingerprint: string
  source: string
  intent: string
  actionId: string
  command: VerificationReceipt['command']
  spec?: VerificationSpec
  scope: { sessionId: string } | null
}
type Prepared = InputObservation & { schemaVersion: 1; runId: string; runtimeFingerprint: string | null; executionFingerprint: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hex = /^[a-f0-9]{64}$/
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const nullableHash = (value: unknown): value is string | null => value === null || typeof value === 'string' && hex.test(value)
function parse(bytes: Buffer): Record<string, unknown> {
  const value: unknown = JSON.parse(bytes.toString('utf8'))
  const row = object(value)
  if (row.schemaVersion !== 1) throw Error('VERIFICATION_SCHEMA_UNSUPPORTED')
  return row
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function string(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096 && !value.includes('\0') }
function intentRecord(bytes: Buffer, workspace: string, id: string): Intent {
  const row = parse(bytes), command = object(row.command), scope = row.scope === null ? null : object(row.scope)
  if (row.runId !== id || row.workspace !== workspace || !integer(row.configRevision) || !string(row.configFingerprint)
    || !hex.test(row.configFingerprint) || !string(row.source) || !string(row.intent) || !string(row.actionId)
    || command.actionId !== row.actionId || !string(command.digest) || !hex.test(command.digest)
    || !string(command.environmentDigest) || !hex.test(command.environmentDigest) || !string(command.cwd)
    || scope !== null && !string(scope.sessionId)) throw Error('VERIFICATION_RECORD_REFUSED')
  let spec: VerificationSpec | undefined
  if (row.spec !== undefined) {
    const selected = object(row.spec)
    const paths = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64
      && value.every(p => string(p) && p.length > 0)
    const parameters = object(selected.parameters)
    if (selected.schemaVersion !== 1 || !string(selected.intent) || !['complete', 'unknown'].includes(String(selected.coverage))
      || selected.parser !== null && selected.parser !== 'node-tap-13/1' || !paths(selected.sources)
      || !paths(selected.inputs) || !paths(selected.toolchain) || Object.keys(parameters).length > 64
      || Object.values(parameters).some(v => v !== null && typeof v !== 'boolean' && typeof v !== 'string'
        && !(typeof v === 'number' && Number.isFinite(v)))) throw Error('VERIFICATION_RECORD_REFUSED')
    spec = { schemaVersion: 1, intent: selected.intent, parser: selected.parser,
      coverage: selected.coverage as VerificationSpec['coverage'], sources: selected.sources,
      inputs: selected.inputs, toolchain: selected.toolchain, parameters: parameters as VerificationSpec['parameters'] }
  }
  return { schemaVersion: 1, runId: id, workspace, configRevision: row.configRevision, configFingerprint: row.configFingerprint,
    source: row.source, intent: row.intent, actionId: row.actionId,
    command: { actionId: row.actionId, digest: command.digest, environmentDigest: command.environmentDigest, cwd: command.cwd },
    ...(spec ? { spec } : {}), scope: scope === null ? null : { sessionId: String(scope.sessionId) } }
}
function preparedRecord(bytes: Buffer, id: string): Prepared {
  const row = parse(bytes)
  if (row.runId !== id || !nullableHash(row.sourceFingerprint) || !nullableHash(row.inputFingerprint)
    || !['complete', 'unknown'].includes(String(row.coverage)) || !nullableHash(row.runtimeFingerprint)
    || !string(row.executionFingerprint) || !hex.test(row.executionFingerprint)
    || row.diagnostic !== null && !string(row.diagnostic)) throw Error('VERIFICATION_RECORD_REFUSED')
  return { schemaVersion: 1, runId: id, sourceFingerprint: row.sourceFingerprint, inputFingerprint: row.inputFingerprint,
    coverage: row.coverage as Prepared['coverage'], runtimeFingerprint: row.runtimeFingerprint, executionFingerprint: row.executionFingerprint,
    diagnostic: row.diagnostic }
}
function receiptRecord(bytes: Buffer, intent: Intent): VerificationReceipt {
  const row = parse(bytes), log = object(row.log), command = object(row.command)
  if (row.id !== intent.runId || row.runId !== intent.runId || row.intent !== intent.intent || row.configRevision !== intent.configRevision
    || !integer(row.completedAt)
    || JSON.stringify(command) !== JSON.stringify(intent.command) || !nullableHash(row.sourceFingerprint)
    || !nullableHash(row.inputFingerprint) || !['complete', 'unknown'].includes(String(row.coverage))
    || row.exitCode !== null && !(typeof row.exitCode === 'number' && Number.isSafeInteger(row.exitCode))
    || typeof row.cancelled !== 'boolean' || typeof row.timedOut !== 'boolean' || typeof row.interrupted !== 'boolean'
    || !nullableHash(log.digest) || typeof log.complete !== 'boolean' || log.parserVersion !== null && log.parserVersion !== 'node-tap-13/1'
    || !['NOT_RUN', 'PASSED', 'FAILED', 'UNKNOWN'].includes(String(row.tests)) || row.acceptance !== 'PENDING'
    || !['CURRENT', 'STALE', 'UNKNOWN'].includes(String(row.freshness)) || !Array.isArray(row.artifacts) || row.artifacts.length > 20)
    throw Error('VERIFICATION_RECORD_REFUSED')
  let summary: TestLogSummary | null = null
  if (row.summary !== null) {
    const value = object(row.summary)
    if (!integer(value.tests) || !integer(value.passed) || !integer(value.failed) || !integer(value.cancelled)
      || !integer(value.skipped) || !integer(value.todo)
      || value.tests !== value.passed + value.failed + value.cancelled + value.skipped + value.todo)
      throw Error('VERIFICATION_RECORD_REFUSED')
    summary = { tests: value.tests, passed: value.passed, failed: value.failed,
      cancelled: value.cancelled, skipped: value.skipped, todo: value.todo }
  }
  const artifacts = row.artifacts.map((item: unknown): RunArtifact => {
    const value = object(item)
    if (value.runId !== intent.runId || !string(value.path) || !['observed-after-run', 'missing', 'unknown'].includes(String(value.observation))
      || !nullableHash(value.digest) || value.bytes !== null && !integer(value.bytes)) throw Error('VERIFICATION_RECORD_REFUSED')
    return { runId: brandString<VerificationRunId>(intent.runId), path: value.path,
      observation: value.observation as RunArtifact['observation'], digest: value.digest, bytes: value.bytes }
  })
  if (row.tests === 'PASSED' && (!log.complete || log.parserVersion === null || log.digest === null || !summary || summary.tests === 0
    || summary.passed !== summary.tests || row.exitCode !== 0 || row.cancelled || row.timedOut || row.interrupted))
    throw Error('VERIFICATION_RECORD_REFUSED')
  return { schemaVersion: 1, id: brandString<ReceiptId>(intent.runId), runId: brandString<VerificationRunId>(intent.runId),
    intent: intent.intent, configRevision: intent.configRevision, completedAt: row.completedAt, command: intent.command,
    sourceFingerprint: row.sourceFingerprint, inputFingerprint: row.inputFingerprint, coverage: row.coverage as VerificationReceipt['coverage'],
    exitCode: row.exitCode, cancelled: row.cancelled, timedOut: row.timedOut, interrupted: row.interrupted,
    log: { digest: log.digest, complete: log.complete, parserVersion: log.parserVersion }, summary, artifacts,
    tests: row.tests as VerificationReceipt['tests'], acceptance: 'PENDING', freshness: row.freshness as VerificationReceipt['freshness'] }
}

/** Durable result and independent acceptance owner. Retained receipts/logs are never pruned with action history. */
export class VerificationOwner {
  private actions: ProjectActions | undefined
  private readonly active = new Set<string>()
  private readonly listeners = new Set<(event: CommittedVerification) => void | Promise<void>>()
  private readonly pending = new Set<Promise<unknown>>()
  private stopping = false
  /** ProjectActions executes every hook within its already-admitted ordinary or terminal write allowance. */
  readonly hooks: VerificationHooks = {
    revision: (directory, fingerprint) => this.revision(directory, fingerprint),
    queued: (workspace, run, action, revision, scope) => this.queued(workspace, run, action, revision, scope),
    prepare: (workspace, run, action, settings) => this.prepare(workspace, run, action, settings),
    settled: (workspace, run) => this.settle(workspace, run),
  }
  constructor(private readonly home: string, private readonly artifacts: DesktopArtifacts,
    private readonly runtime: (workspace: string, action: Action, source: string) => Promise<string | null>) {}
  /** Bind the real execution owner before accepting requests.
   * @param actions - The ProjectActions instance whose hooks this owner receives.
   */
  bind(actions: ProjectActions): void { this.actions = actions }
  /** Subscribe only to complete result publications; callback failure never changes committed facts.
   * @param listener - Current consumer; replay reads durable receipts instead of invoking this callback.
   * @returns Disposer that prevents later deliveries to this consumer.
   */
  subscribe(listener: (event: CommittedVerification) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private async directory(workspace: string, id?: string): Promise<string> {
    const root = await realpath(workspace)
    if (id !== undefined && !uuid.test(id)) throw Error('VERIFICATION_RUN_INVALID')
    const key = hash(process.platform === 'win32' ? root.toLowerCase() : root)
    return join(this.home, 'desktop-actions', key, 'verification', ...(id ? [id] : []))
  }
  private owner(): ProjectActions {
    if (!this.actions || this.stopping) throw Error('VERIFICATION_OWNER_UNAVAILABLE')
    return this.actions
  }
  private async names(directory: string, expression: RegExp): Promise<string[]> {
    let names
    try { names = await readdir(directory) }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    if (names.length > 8192) throw Error('VERIFICATION_HISTORY_LIMIT')
    return names.filter(name => expression.test(name)).sort()
  }
  private async revision(directory: string, fingerprint: string): Promise<number> {
    const path = join(directory, 'verification-config')
    for (let attempt = 0; attempt < 32; attempt++) {
      const names = await this.names(path, /^\d{16}\.json$/), last = names.at(-1)
      let revision = 0
      if (last) {
        const bytes = await readRecord(join(path, last))
        if (!bytes) throw Error('VERIFICATION_CONFIG_UNKNOWN')
        const row = parse(bytes)
        revision = Number(last.slice(0, 16))
        if (row.revision !== revision || !integer(revision) || !nullableHash(row.fingerprint) || row.fingerprint === null)
          throw Error('VERIFICATION_RECORD_REFUSED')
        if (row.fingerprint === fingerprint) return revision
      }
      if (revision >= Number.MAX_SAFE_INTEGER) throw Error('VERIFICATION_HISTORY_LIMIT')
      const next = revision + 1
      if (await publishRecord(join(path, String(next).padStart(16, '0') + '.json'),
        JSON.stringify({ schemaVersion: 1, revision: next, fingerprint }))) return next
    }
    throw Error('VERIFICATION_CONFIG_BUSY')
  }
  private async queued(workspace: string, run: Run, action: Action, revision: number, scope: Intent['scope']): Promise<void> {
    const dir = await this.directory(workspace, run.id)
    const intent: Intent = { schemaVersion: 1, runId: run.id, workspace: await realpath(workspace), configRevision: revision,
      configFingerprint: String(run.fingerprint), source: String(run.source), intent: action.verification?.intent ?? action.label,
      actionId: action.id, command: { actionId: action.id, digest: hash(action.command), cwd: action.cwd,
        environmentDigest: hash(JSON.stringify(action.env)) },
      ...(action.verification ? { spec: action.verification } : {}), scope }
    if (!await publishRecord(join(dir, 'intent.json'), JSON.stringify(intent))) throw Error('VERIFICATION_RUN_ALREADY_EXISTS')
    this.active.add(run.id)
  }
  private async intent(workspace: string, id: string): Promise<Intent | null> {
    const bytes = await readRecord(join(await this.directory(workspace, id), 'intent.json'))
    return bytes ? intentRecord(bytes, await realpath(workspace), id) : null
  }
  private async prepare(workspace: string, run: Run, action: Action, observation: ExecutionObservation): Promise<void> {
    const intent = await this.intent(workspace, run.id)
    if (!intent) throw Error('VERIFICATION_INTENT_REQUIRED')
    const runtime = intent.source === 'agent' ? null : await runtimeFingerprint(action, observation)
    const inputs = await observeInputs(workspace, intent.spec, intent.configFingerprint, runtime)
    const record: Prepared = { schemaVersion: 1, runId: run.id,
      executionFingerprint: executionFingerprint(action, observation.settings), ...inputs }
    if (!await publishRecord(join(await this.directory(workspace, run.id), 'prepared.json'), JSON.stringify(record)))
      throw Error('VERIFICATION_PREPARATION_ALREADY_EXISTS')
  }
  private async settle(workspace: string, run: Run): Promise<void> {
    try {
      const intent = await this.intent(workspace, run.id)
      if (!intent) return
      const dir = await this.directory(workspace, run.id), preparedBytes = await readRecord(join(dir, 'prepared.json'))
      const prepared = preparedBytes ? preparedRecord(preparedBytes, run.id) : null, facts = commandFacts(run)
      let logBytes: Buffer | null = null
      if (run.logAvailable === true) {
        const reference = await this.owner().logReference(workspace, run.id)
        logBytes = await readRecord(join(reference.root, reference.path))
        if (logBytes && !await publishRecord(join(dir, 'execution.log'), logBytes)) throw Error('VERIFICATION_LOG_ALREADY_EXISTS')
      }
      const complete = !!prepared && !!logBytes && run.logTruncated === false && !facts.interrupted
        && !facts.cancelled && !facts.timedOut && (run.signal === null || run.signal === undefined) && ['PASS', 'FAIL'].includes(run.status)
      const summary = intent.spec?.parser && complete && logBytes ? tapSummary(logBytes.toString('utf8')) : null
      const tests: VerificationReceipt['tests'] = facts.outcome === 'NOT_RUN' ? 'NOT_RUN' : !summary ? 'UNKNOWN'
        : summary.failed > 0 || summary.cancelled > 0 || facts.outcome === 'FAILED' ? 'FAILED'
          : summary.passed > 0 && summary.passed === summary.tests && facts.outcome === 'SUCCEEDED' ? 'PASSED' : 'UNKNOWN'
      const artifacts: RunArtifact[] = typeof run.startedAt === 'string'
        ? await Promise.all((run.artifacts ?? []).map(async path => ({ ...await this.artifacts.observeRun(workspace, path),
          runId: brandString<VerificationRunId>(run.id) }))) : []
      const current = await this.owner().inspect(workspace), action = current.config.actions.find(a => a.id === intent.actionId)
      const after = await observeInputs(workspace, intent.spec, current.fingerprint,
        action ? await this.runtime(workspace, action, intent.source) : null)
      const freshness = this.freshness(prepared, after, intent, current.configRevision)
      const receipt: VerificationReceipt = { schemaVersion: 1, id: brandString<ReceiptId>(run.id),
        runId: brandString<VerificationRunId>(run.id),
        intent: intent.intent, configRevision: intent.configRevision,
        completedAt: Date.parse(String(run.finishedAt)), command: intent.command,
        sourceFingerprint: prepared?.sourceFingerprint ?? null, inputFingerprint: prepared?.inputFingerprint ?? null,
        coverage: intent.source === 'agent' ? 'unknown' : prepared?.coverage ?? 'unknown', exitCode: facts.exitCode,
        cancelled: facts.cancelled, timedOut: facts.timedOut, interrupted: facts.interrupted || !prepared && facts.outcome !== 'NOT_RUN',
        log: { digest: logBytes ? hash(logBytes) : null, complete, parserVersion: intent.spec?.parser ?? null },
        tests, summary, artifacts, acceptance: 'PENDING', freshness: intent.source === 'agent' && freshness === 'CURRENT' ? 'UNKNOWN' : freshness }
      if (!await publishRecord(join(dir, 'result.json'), JSON.stringify(receipt))) throw Error('VERIFICATION_RESULT_ALREADY_EXISTS')
      const event: CommittedVerification = { workspace, receiptId: receipt.id, runId: receipt.runId, scope: intent.scope, receipt }
      for (const listener of this.listeners) {
        if (this.stopping) break
        try { await listener(event) }
        catch (error) { /* The committed result survives a consumer failure; that consumer reconciles from disk. */ void error }
      }
    } finally { this.active.delete(run.id) }
  }
  private freshness(before: InputObservation | null, after: InputObservation, intent: Intent,
    revision: number | undefined): VerificationReceipt['freshness'] {
    if (!before) return 'UNKNOWN'
    const comparableRuntime = before.runtimeFingerprint === after.runtimeFingerprint
      || before.runtimeFingerprint !== null && after.runtimeFingerprint !== null
    if (revision !== undefined && revision !== intent.configRevision
      || before.sourceFingerprint !== null && after.sourceFingerprint !== null && before.sourceFingerprint !== after.sourceFingerprint
      || comparableRuntime && before.inputFingerprint !== null && after.inputFingerprint !== null
      && before.inputFingerprint !== after.inputFingerprint) return 'STALE'
    return before.coverage === 'complete' && after.coverage === 'complete' && before.sourceFingerprint !== null
      && after.sourceFingerprint !== null && before.inputFingerprint !== null && after.inputFingerprint !== null ? 'CURRENT' : 'UNKNOWN'
  }
  /** Read a historical result and independently observe present inputs, log integrity and user acceptance.
   * @param workspace - Current canonical workspace; foreign run IDs refuse.
   * @param id - Real run ID; old runs without a durable intent remain legacy.
   * @returns Immutable facts with a current freshness projection; no missing result is reconstructed from old logs.
   */
  async inspect(workspace: string, id: string): Promise<VerificationView> {
    this.owner()
    const intent = await this.intent(workspace, id)
    if (!intent) return { phase: 'LEGACY', receipt: null, acceptanceRevision: 0, logAvailable: false, diagnostic: null }
    const dir = await this.directory(workspace, id), bytes = await readRecord(join(dir, 'result.json'))
    if (!bytes) return { phase: this.active.has(id) ? 'PENDING' : 'INTERRUPTED', receipt: null, acceptanceRevision: 0,
      logAvailable: false, diagnostic: 'VERIFICATION_RESULT_UNKNOWN' }
    const receipt = receiptRecord(bytes, intent), preparedBytes = await readRecord(join(dir, 'prepared.json'))
    const prepared = preparedBytes ? preparedRecord(preparedBytes, id) : null, current = await this.owner().inspect(workspace)
    const action = current.config.actions.find(a => a.id === intent.actionId)
    const inputs = await observeInputs(workspace, intent.spec, current.fingerprint,
      action ? await this.runtime(workspace, action, intent.source) : null)
    if (receipt.freshness !== 'STALE') receipt.freshness = this.freshness(prepared, inputs, intent, current.configRevision)
    if (intent.source === 'agent' && receipt.freshness === 'CURRENT') receipt.freshness = 'UNKNOWN'
    const log = await readRecord(join(dir, 'execution.log')), logAvailable = !!log && hash(log) === receipt.log.digest
    let diagnostic = inputs.diagnostic
    if (receipt.log.digest !== null && !logAvailable) {
      receipt.log.complete = false; receipt.tests = 'UNKNOWN'; receipt.summary = null; diagnostic = 'VERIFICATION_LOG_UNAVAILABLE'
    }
    if (logAvailable && receipt.log.complete && receipt.log.parserVersion === 'node-tap-13/1'
      && JSON.stringify(tapSummary(log.toString('utf8'))) !== JSON.stringify(receipt.summary)) throw Error('VERIFICATION_RECEIPT_LOG_CONFLICT')
    const acceptance = await this.acceptance(dir)
    receipt.acceptance = acceptance.value
    return { phase: 'COMMITTED', receipt, acceptanceRevision: acceptance.revision, logAvailable, diagnostic }
  }
  /** Read the original execution source without inferring a turn, step or model request from its Session label.
   * @param workspace - Existing receipt workspace.
   * @param id - Exact retained run identity.
   * @returns Original source and optional Session identity; legacy runs have no association.
   */
  async executionSource(workspace: string, id: string): Promise<{ source: string; sessionId: string | null } | null> {
    this.owner()
    const intent = await this.intent(workspace, id)
    return intent ? { source: intent.source, sessionId: intent.scope?.sessionId ?? null } : null
  }
  private async acceptance(dir: string): Promise<{ value: VerificationReceipt['acceptance']; revision: number }> {
    const path = join(dir, 'acceptance'), names = await this.names(path, /^\d{16}\.json$/), last = names.at(-1)
    if (!last) return { value: 'PENDING', revision: 0 }
    const bytes = await readRecord(join(path, last))
    if (!bytes) throw Error('VERIFICATION_ACCEPTANCE_UNKNOWN')
    const row = parse(bytes), revision = Number(last.slice(0, 16))
    if (row.revision !== revision || !integer(revision) || !['ACCEPTED', 'REJECTED'].includes(String(row.value)))
      throw Error('VERIFICATION_RECORD_REFUSED')
    return { value: row.value as VerificationReceipt['acceptance'], revision }
  }
  /** Persist a local user's independent decision with exclusive revision CAS; model tools cannot call this API.
   * @param workspace - Receipt workspace.
   * @param id - Committed run identity.
   * @param expectedRevision - Last observed acceptance revision.
   * @param decision - Explicit accepted/rejected user choice.
   * @returns Current receipt view; a changed acceptance refuses without overwriting history.
   */
  async accept(workspace: string, id: string, expectedRevision: unknown, decision: unknown): Promise<VerificationView> {
    if (!integer(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER || decision !== 'ACCEPTED' && decision !== 'REJECTED')
      throw Error('VERIFICATION_ACCEPTANCE_INVALID')
    const view = await this.inspect(workspace, id)
    if (!view.receipt) throw Error('VERIFICATION_RESULT_UNKNOWN')
    if (view.acceptanceRevision !== expectedRevision) throw Error('VERIFICATION_ACCEPTANCE_CONFLICT')
    const work = (async () => {
      const path = join(await this.directory(workspace, id), 'acceptance', String(expectedRevision + 1).padStart(16, '0') + '.json')
      if (!await publishRecord(path, JSON.stringify({ schemaVersion: 1, revision: expectedRevision + 1, value: decision, at: Date.now() })))
        throw Error('VERIFICATION_ACCEPTANCE_CONFLICT')
      return this.inspect(workspace, id)
    })()
    this.pending.add(work)
    try { return await work } finally { this.pending.delete(work) }
  }
  /** Read retained identities independently of ProjectActions' 100-run retention.
   * @param workspace - Existing workspace.
   * @param after - Lexical run identity cursor or null.
   * @returns At most 100 identities and an explicit cursor; pending and interrupted intents remain visible.
   */
  async list(workspace: string, after: unknown = null): Promise<{ ids: string[]; next: string | null }> {
    this.owner()
    if (after !== null && (typeof after !== 'string' || !uuid.test(after))) throw Error('VERIFICATION_CURSOR_INVALID')
    const names = (await this.names(await this.directory(workspace), uuid)).filter(name => after === null || name > after)
    const ids = names.slice(0, 100)
    return { ids, next: names.length > 100 ? ids.at(-1) ?? null : null }
  }
  /** Read the verified retained log without depending on the action-log retention window.
   * @param workspace - Receipt workspace.
   * @param id - Committed run.
   * @returns Exact original log text; a missing or changed log refuses.
   */
  async log(workspace: string, id: string): Promise<string> {
    const view = await this.inspect(workspace, id)
    if (!view.receipt || !view.logAvailable) throw Error('VERIFICATION_LOG_UNAVAILABLE')
    const bytes = await readRecord(join(await this.directory(workspace, id), 'execution.log'))
    if (!bytes || hash(bytes) !== view.receipt.log.digest) throw Error('VERIFICATION_LOG_UNAVAILABLE')
    return bytes.toString('utf8')
  }
  /** Read actual run-linked artifact observations without substituting files observed at query time.
   * @param workspace - Existing receipt workspace.
   * @param id - Real run ID.
   * @returns Retained artifact facts, or an empty list when no result was committed.
   */
  async observedArtifacts(workspace: string, id: string): Promise<RunArtifact[]> {
    this.owner()
    const intent = await this.intent(workspace, id)
    if (!intent) return []
    const bytes = await readRecord(join(await this.directory(workspace, id), 'result.json'))
    return bytes ? receiptRecord(bytes, intent).artifacts : []
  }
  /** Read only committed result publications across retained workspace namespaces for consumer reconciliation.
   * @param after - Lexical storage cursor from the preceding page, or null.
   * @returns At most 100 committed results and a continuation cursor; no command is replayed or workspace input read.
   */
  async committedRecords(after: string | null = null): Promise<{ records: CommittedVerification[]; next: string | null }> {
    this.owner()
    if (after !== null && !/^[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(after)) throw Error('VERIFICATION_CURSOR_INVALID')
    const base = join(this.home, 'desktop-actions'), candidates: string[] = []
    for (const workspace of await this.names(base, hex)) {
      for (const id of await this.names(join(base, workspace, 'verification'), uuid)) {
        const key = workspace + '/' + id
        if (after === null || key > after) candidates.push(key)
        if (candidates.length > 8192) throw Error('VERIFICATION_HISTORY_LIMIT')
      }
    }
    const page = candidates.sort().slice(0, 100), records: CommittedVerification[] = []
    for (const key of page) {
      const [workspaceKey, id] = key.split('/')
      if (!workspaceKey || !id) throw Error('VERIFICATION_RECORD_REFUSED')
      const directory = join(base, workspaceKey, 'verification', id), result = await readRecord(join(directory, 'result.json'))
      if (!result) continue
      const bytes = await readRecord(join(directory, 'intent.json'))
      if (!bytes) throw Error('VERIFICATION_INTENT_REQUIRED')
      const data = parse(bytes)
      if (!string(data.workspace) || hash(process.platform === 'win32' ? data.workspace.toLowerCase() : data.workspace) !== workspaceKey)
        throw Error('VERIFICATION_RECORD_REFUSED')
      const intent = intentRecord(bytes, data.workspace, id), receipt = receiptRecord(result, intent)
      records.push({ workspace: intent.workspace, receiptId: receipt.id, runId: receipt.runId, scope: intent.scope, receipt })
    }
    return { records, next: candidates.length > 100 ? page.at(-1) ?? null : null }
  }
  /** Disable consumers before draining writes; ProjectActions is closed first by the composition owner. */
  async close(): Promise<void> { this.listeners.clear(); await Promise.allSettled(this.pending); this.stopping = true }
}
