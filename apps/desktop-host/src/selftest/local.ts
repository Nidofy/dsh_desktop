/** Real isolated filesystem, Shell, action, artifact and notification measurements; no user rules or model requests. */
import { Context } from '@deepseek-ai/cordis'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { LlmRuntime, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdir, lstat, readFile, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ProjectActions } from '../workbench/legacy/project-actions.mjs'
import type { Action, ExecutionObservation } from '../workbench/legacy/project-actions.mjs'
import { DesktopArtifacts } from '../workbench/legacy/desktop-artifacts.mjs'
import { ChangeReview } from '../workbench/legacy/change-review.mjs'
import { VerificationOwner } from '../workbench/verification.ts'
import { NotificationOwner } from '../workbench/notifications.ts'
import { SelfTestStore, unlinked } from './store.ts'
import type { LocalChecks } from './runner.ts'
import type { CheckId, CheckResult } from './types.ts'
import { checkPrefix } from './prefix.ts'

/** Private execution capability supplied by the existing workbench; it retains Shell policy and native protection. */
export type LocalCheckExecutor = (action: Action & {
  workspace: string
  signal: AbortSignal
  recordExecution?: (observation: ExecutionObservation) => Promise<void>
}) => Promise<ShellRunResult>
const success = (metrics: CheckResult['metrics'] = {}): CheckResult => ({ status: 'PASS', code: 'OK', metrics })
const unknown = (code: CheckResult['code']): CheckResult => ({ status: 'UNKNOWN', code, metrics: {} })
function requireFact(value: boolean): void { if (!value) throw Error('SELFTEST_ASSERTION_FAILED') }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('SELFTEST_ASSERTION_FAILED')
  return value as Record<string, unknown>
}
const quote = (value: string): string => process.platform === 'win32'
  ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'"
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const own: unknown = Reflect.get(error, 'code')
  return typeof own === 'string' ? own : error.message
}
class FailingLocalAdapter extends LlmAdapter {
  preparations = 0
  sends = 0
  override prepareCall(): Promise<PreparedAdapterCall> {
    this.preparations++
    return Promise.reject(new LlmError('Synthetic preparation refusal', 'SELFTEST_SYNTHETIC_REFUSAL'))
  }
  stream(): AsyncIterable<StreamChunk> {
    return { [Symbol.asyncIterator]: () => ({ next: () => {
      this.sends++; return Promise.reject(Error('SELFTEST_UNEXPECTED_SEND'))
    } }) }
  }
}

/** New synthetic root per run; crash leftovers are preserved, and ten leftovers refuse another allocation. */
export class ElectronLocalChecks implements LocalChecks {
  private readonly base: string
  private readonly root: string
  private readonly home: string
  private readonly workspace: string
  private readonly artifacts: DesktopArtifacts
  private readonly verification: VerificationOwner
  private readonly notices: NotificationOwner
  private readonly actions: ProjectActions
  private readonly contexts: Context[] = []
  private readonly removeNoticeProducer: () => void
  private identity: string | undefined
  private configuration: ReturnType<ElectronLocalChecks['config']> | undefined
  private actionRunId: string | undefined
  constructor(home: string, private readonly id: string, private readonly storage: StorageService,
    private readonly execute: LocalCheckExecutor, private readonly reports: SelfTestStore, private readonly nodeExecutable: string) {
    this.base = join(home, 'nidofy-extras', 'selftests', 'workspaces')
    this.root = join(this.base, id); this.home = join(this.root, 'home'); this.workspace = join(this.root, 'project')
    this.artifacts = new DesktopArtifacts(this.home)
    // The self-test checks actual commands and parsed logs; it does not qualify the user's source/input closure.
    this.verification = new VerificationOwner(this.home, this.artifacts, () => Promise.resolve(null))
    this.actions = new ProjectActions(this.home, action => this.execute(action), this.verification.hooks)
    this.verification.bind(this.actions)
    this.notices = new NotificationOwner(this.home, this.verification)
    this.removeNoticeProducer = this.verification.subscribe(event => this.notices.committed(event).then(() => {}))
  }
  /** Allocate only after the runner's intent commit and refuse old or linked roots.
   * @param signal - Whole-run cancellation; no directory is adopted on restart.
   */
  async open(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const runtime = await lstat(this.nodeExecutable)
    if (!runtime.isFile() || runtime.isSymbolicLink()) throw Error('SELFTEST_RUNTIME_UNAVAILABLE')
    signal.throwIfAborted(); await unlinked(this.base)
    await mkdir(this.base, { recursive: true, mode: 0o700 })
    if ((await readdir(this.base)).length >= 10) throw Error('SELFTEST_LEFTOVER_LIMIT')
    await mkdir(this.root, { mode: 0o700 })
    const info = await lstat(this.root, { bigint: true })
    this.identity = `${info.dev}:${info.ino}`
    const marker = JSON.stringify({ schemaVersion: 1, id: this.id, root: await realpath(this.root), identity: this.identity })
    await this.write(join(this.root, 'owner.json'), marker, true)
    await mkdir(this.home); await mkdir(this.workspace)
    await mkdir(join(this.workspace, 'empty-template'))
    await this.write(join(this.workspace, 'sample.mjs'),
      "import {writeFileSync} from 'node:fs'; writeFileSync('sample.txt', 'isolated UTF-8 中文'); console.log('isolated-complete');")
    await this.write(join(this.workspace, 'sample.test.mjs'),
      "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('isolated output',()=>assert.equal(2+2,4));")
    await this.write(join(this.workspace, 'cancel.mjs'),
      "import {writeFileSync} from 'node:fs'; writeFileSync('started.txt','ready'); setInterval(()=>{},1000);")
    this.configuration = this.config()
    signal.throwIfAborted()
  }
  private async write(path: string, bytes: string, exclusive = false): Promise<void> {
    await unlinked(path)
    await this.storage.write(path, Math.max(1, Buffer.byteLength(bytes) * 2), async () => {
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 })
      if (exclusive) await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
      else await writeFileAtomic(path, bytes, { mode: 0o600, dirMode: 0o700 })
    })
  }
  private config() {
    return { schemaVersion: 1, actions: [{ id: 'sample', label: 'Isolated output', cwd: '.',
      command: this.node('sample.test.mjs', ['--test', '--test-isolation=none', '--test-reporter=tap']),
      timeoutMs: 10000, env: { ELECTRON_RUN_AS_NODE: '1' }, verification: { schemaVersion: 1,
        intent: 'Run the fixed isolated test', parser: 'node-tap-13/1', coverage: 'unknown', sources: ['sample.test.mjs'],
        inputs: [], toolchain: [this.nodeExecutable], parameters: {} } },
    { id: 'cancel', label: 'Isolated cancellation', cwd: '.', command: this.node('cancel.mjs'),
      timeoutMs: 15000, env: { ELECTRON_RUN_AS_NODE: '1' } }] }
  }
  private node(file: string, flags: string[] = []): string {
    return (process.platform === 'win32' ? '& ' : '') + quote(this.nodeExecutable) + ' '
      + [...flags, join(this.workspace, file)].map(quote).join(' ')
  }
  private command(command: string, signal: AbortSignal, env: Record<string, string> = {}, cwd = this.workspace): Promise<ShellRunResult> {
    return this.execute({ id: 'fixed', label: 'Fixed isolated command', workspace: this.workspace,
      cwd, command, signal, timeoutMs: 10000, env: { ELECTRON_RUN_AS_NODE: '1', ...env } })
  }
  private async refused(work: () => Promise<unknown>, expected: string): Promise<void> {
    try { await work() }
    catch (error) { requireFact(errorCode(error) === expected); return }
    throw Error('SELFTEST_ASSERTION_FAILED')
  }
  /** Execute the named real measurement or report its precise missing evidence.
   * @param id - Stable catalogue identity.
   * @param signal - Run lifetime; command completion includes process/output drain.
   * @returns Explicit qualification and numeric observations only.
   */
  async check(id: CheckId, signal: AbortSignal): Promise<CheckResult> {
    signal.throwIfAborted()
    if (!this.configuration) throw Error('SELFTEST_NOT_OPEN')
    switch (id) {
      case 'node': return process.versions.electron && (await lstat(process.execPath)).isFile()
        ? success() : unknown('CARRIER_UNVERIFIED')
      case 'dsh': case 'modules': case 'webview': return unknown('CARRIER_UNVERIFIED')
      case 'storage': {
        const path = join(this.home, 'atomic.json'), first = JSON.stringify({ text: '合成 α' }), second = JSON.stringify({ text: '替换 β' })
        await this.write(path, first); requireFact(await readFile(path, 'utf8') === first)
        await this.write(path, second); requireFact(await readFile(path, 'utf8') === second)
        const status = await this.storage.status()
        if (!Number.isSafeInteger(status.limitBytes + 1)) return unknown('SOURCE_UNAVAILABLE')
        let refused = false
        try { const lease = await this.storage.reserve('node:selftest-refusal', status.limitBytes + 1, 0); await lease.release() }
        catch (error) {
          if (!(error instanceof Error) || errorCode(error.cause) !== 'STORAGE_QUOTA_EXCEEDED') throw error
          refused = true
        }
        requireFact(refused)
        return success({ bytes: Buffer.byteLength(second), quotaRefusals: 1 })
      }
      case 'shell': {
        const result = await this.command(this.node('sample.mjs'), signal)
        requireFact(result.exitCode === 0 && !result.aborted && !result.timedOut && !result.sandbox?.runnerFailed)
        requireFact(await readFile(join(this.workspace, 'sample.txt'), 'utf8') === 'isolated UTF-8 中文')
        return success({ exitCode: 0, files: 1, requests: 0 })
      }
      case 'skills': {
        const root = join(this.workspace, 'skills'), ctx = new Context(); this.contexts.push(ctx)
        await this.write(join(root, 'isolated-check', 'SKILL.md'),
          '---\nname: isolated-check\ndescription: Synthetic local measurement\n---\nSynthetic skill body.\n')
        const provider = new FileSystemSkillProvider(ctx, { signal, invalidate: () => {} }, {
          providerName: 'selftest', includeDefaultRoots: false, customSkillDirs: [root],
          dshHome: this.home, agentsHome: join(this.root, 'agents'), watch: false,
        })
        try {
          const result = await provider.list({ cwd: this.workspace, signal })
          const candidates = Array.isArray(result) ? result : result.candidates
          requireFact((Array.isArray(result) || result.complete) && candidates.length === 1)
          const candidate = candidates[0]
          if (!candidate) throw Error('SELFTEST_ASSERTION_FAILED')
          requireFact((await provider.get(candidate, { cwd: this.workspace, signal }))?.content.trim() === 'Synthetic skill body.')
        } finally { await provider.dispose() }
        return success({ files: 1, requests: 0 })
      }
      case 'action-trust':
        await this.actions.save(this.workspace, this.configuration)
        await this.refused(() => this.actions.start(this.workspace, 'sample', { signal }), 'TRUST_REQUIRED')
        return success()
      case 'action-run': {
        const view = await this.actions.inspect(this.workspace)
        await this.actions.trust(this.workspace, view.fingerprint)
        const started = await this.actions.start(this.workspace, 'sample', { signal }), run = await this.actions.wait(this.workspace, started.id)
        const cold = new ProjectActions(this.home, action => this.execute(action))
        try {
          requireFact(run.exitCode === 0 && run.aborted === false && run.timedOut === false && !run.persistenceFailed)
          requireFact((await cold.inspect(this.workspace)).runs.some(row => row.id === run.id && row.exitCode === 0))
          requireFact((await this.verification.inspect(this.workspace, run.id)).receipt?.tests === 'PASSED')
          this.actionRunId = run.id
        } finally { await cold.close() }
        return success({ exitCode: 0, requests: 0 })
      }
      case 'action-change': {
        await this.actions.save(this.workspace, { ...this.configuration, actions: this.configuration.actions.map(row => ({ ...row, label: row.label + ' changed' })) })
        requireFact(!(await this.actions.inspect(this.workspace)).trusted)
        await this.refused(() => this.actions.start(this.workspace, 'sample', { signal }), 'TRUST_REQUIRED')
        return success()
      }
      case 'cancel': {
        const view = await this.actions.inspect(this.workspace); await this.actions.trust(this.workspace, view.fingerprint)
        const run = await this.actions.start(this.workspace, 'cancel', { signal })
        try {
          const deadline = Date.now() + 10000
          for (;;) {
            signal.throwIfAborted()
            try { if (await readFile(join(this.workspace, 'started.txt'), 'utf8') === 'ready') break }
            catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
            if (Date.now() > deadline) throw Error('SELFTEST_EXECUTION_UNCONFIRMED')
            await delay(20, undefined, { signal })
          }
        } finally { await this.actions.cancel(this.workspace, run.id) }
        const result = await this.actions.wait(this.workspace, run.id)
        requireFact(result.aborted === true && result.timedOut === false && !result.persistenceFailed)
        return success({ cancelled: 1, timedOut: 0 })
      }
      case 'git': case 'hg': return this.vcs(id, signal)
      case 'artifact': {
        const path = join(this.workspace, 'artifact.txt'); await this.write(path, 'first')
        const item = await this.artifacts.describe(this.workspace, 'artifact.txt')
        requireFact(typeof item.id === 'string')
        await this.write(path, 'second changed')
        await this.refused(() => this.artifacts.resolveLease(String(item.id)), 'CHANGED')
        return success({ files: 1 })
      }
      case 'prefix': return checkPrefix(this.home, this.id, this.storage, signal)
      case 'recovery': {
        const before = await readFile(join(this.reports.directory, this.id + '.json'))
        const cold = await this.reports.read(this.id)
        requireFact(cold?.status === 'INTERRUPTED' && cold.rows.find(row => row.id === 'recovery')?.status === 'UNKNOWN')
        requireFact(before.equals(await readFile(join(this.reports.directory, this.id + '.json'))))
        return success({ requests: 0 })
      }
      case 'notification': {
        if (!this.actionRunId) return unknown('SOURCE_UNAVAILABLE')
        const records = (await this.verification.committedRecords()).records
        const source = records.find(row => row.runId === this.actionRunId)
        if (!source) return unknown('SOURCE_UNAVAILABLE')
        await this.notices.committed(source); await this.notices.committed(source)
        const rows = (await this.notices.list()).notices
        requireFact(rows.filter(row => row.sourceId === this.actionRunId).length === 1)
        requireFact(!(await this.notices.preferences()).enabled)
        await this.notices.attach(); requireFact((await this.notices.poll()).notices.length === 0)
        return success({ requests: 0 })
      }
      case 'probe-failure': {
        const ctx = new Context(); this.contexts.push(ctx)
        const llm = new LlmRuntime(ctx), adapter = new FailingLocalAdapter(), remove = llm.registerAdapter(['selftest'], adapter)
        let refused = false
        try {
          try { for (let index = 0; index < 5; index++) await llm.prepareCall({ provider: 'selftest', model: 'synthetic', maxTokens: 64 }, signal) }
          catch (error) { requireFact(errorCode(error) === 'SELFTEST_SYNTHETIC_REFUSAL'); refused = true }
          requireFact(refused && adapter.preparations === 1 && adapter.sends === 0)
        } finally { remove() }
        return success({ requests: 0 })
      }
      default: return unknown('NOT_IMPLEMENTED')
    }
  }
  private async vcs(vcs: 'git' | 'hg', signal: AbortSignal): Promise<CheckResult> {
    const candidates = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)
      .map(path => join(path, process.platform === 'win32' ? vcs + '.exe' : vcs))
    let available = false
    for (const path of candidates) {
      try { if ((await lstat(path)).isFile()) { available = true; break } }
      catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
    }
    if (!available) return { status: 'SKIPPED', code: 'DEPENDENCY_MISSING', metrics: {} }
    const root = join(this.workspace, vcs); await mkdir(root)
    const prefix = process.platform === 'win32' ? '& ' : ''
    const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_TERMINAL_PROMPT: '0', GIT_TEMPLATE_DIR: join(this.workspace, 'empty-template'),
      HGPLAIN: '1', HGRCPATH: '', HGRCSKIPREPO: '1' }
    const version = await this.command(prefix + vcs + ' --version', signal, env, root)
    requireFact(version.exitCode === 0 && !version.sandbox?.runnerFailed && !version.aborted && !version.timedOut)
    const init = await this.command(prefix + vcs + (vcs === 'git'
      ? ' -c init.templateDir=' + quote(env.GIT_TEMPLATE_DIR) + ' init --initial-branch=selftest --template=' + quote(env.GIT_TEMPLATE_DIR)
      : ' --config ui.interactive=false init'), signal, env, root)
    requireFact(init.exitCode === 0 && !init.aborted && !init.timedOut)
    const review = new ChangeReview(this.home), baseline = await review.capture(root, { signal })
    await this.write(join(root, 'change.txt'), 'synthetic change')
    const difference = object(await review.inspect(root, String(baseline.id), signal))
    requireFact(Array.isArray(difference.rows) && difference.rows.some(row => object(row).path === 'change.txt'))
    return success({ files: 1, requests: 0 })
  }
  private async removeOwned(path: string): Promise<void> {
    const rel = relative(this.root, path)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw Error('SELFTEST_PATH_REFUSED')
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw Error('SELFTEST_PATH_REFUSED')
    if (!info.isDirectory()) { if (!info.isFile() || info.nlink !== 1) throw Error('SELFTEST_PATH_REFUSED'); await unlink(path); return }
    const names = await readdir(path)
    if (names.length > 512) throw Error('SELFTEST_CLEANUP_LIMIT')
    for (const name of names) await this.removeOwned(join(path, name))
    await rmdir(path)
  }
  /** Drain action children, receipt/notice writers and provider contexts before deleting only this run's verified root. */
  async close(): Promise<void> {
    this.removeNoticeProducer()
    await this.actions.close(); await this.verification.close(); await this.notices.close()
    for (const ctx of this.contexts) await ctx.fiber.dispose()
    if (!this.identity) return
    await unlinked(this.root)
    const info = await lstat(this.root, { bigint: true }), canonical = await realpath(this.root)
    const marker = object(JSON.parse(await readFile(join(this.root, 'owner.json'), 'utf8')))
    requireFact(`${info.dev}:${info.ino}` === this.identity && marker.identity === this.identity
      && marker.id === this.id && marker.root === canonical && marker.schemaVersion === 1)
    await this.removeOwned(this.root)
  }
}
