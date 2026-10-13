/** Real isolated Shell actions, durable receipt publication and native quota; no provider calls or user data. */
import { Context } from '@deepseek-ai/cordis'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, onTestFinished } from 'vitest'
import { ProjectActions, type Action, type VerificationSpec } from '../src/workbench/legacy/project-actions.mjs'
import { DesktopArtifacts } from '../src/workbench/legacy/desktop-artifacts.mjs'
import { installStorageAdmission } from '../src/workbench/legacy/storage-admission.mjs'
import { VerificationOwner } from '../src/workbench/verification.ts'
import { runtimeFingerprint } from '../src/workbench/verification-input.ts'

const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"
/** Keyless test input used by the isolated verification cases. */
export const passedSource = "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('isolated', () => assert.equal(1,1));"
/** Create a real isolated Shell/quota/verification composition and register its teardown.
 * @param agentSessionId - Optional synthetic scope injection; no Agent is created and Shell execution stays real.
 * @param retainRoot - Preserve this synthetic workspace and raw logs for continuation evidence.
 * @returns Actual owners, locally trusted actions and independent TEMP workspace.
 */
export async function verificationFixture(agentSessionId?: string, retainRoot = false) {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-verification-')), home = join(root, 'harness'), workspace = join(root, 'project')
  await mkdir(home); await mkdir(workspace); await mkdir(join(workspace, 'src')); await mkdir(join(workspace, 'inputs'))
  await writeFile(join(workspace, 'src/sample.test.mjs'), passedSource)
  await writeFile(join(workspace, 'inputs/case.json'), '{"tolerance":0}')
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime); await ctx.plugin(PwshLocalExecutor, { graceMs: 200 })
  const storage = new StorageService(ctx, home, { limitBytes: 128 * 1024 * 1024, safetyBytes: 1024 * 1024,
    executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)) })
  const dispose = installStorageAdmission(storage), artifacts = new DesktopArtifacts(home)
  const settings = (action: Action) => {
    const spec = ctx.shell.resolve({ command: action.command, workdir: resolve(workspace, action.cwd), timeoutMs: action.timeoutMs,
      onExpiry: 'kill', stdoutMaxBytes: 512 * 1024, env: action.env })
    return { command: spec.command, workdir: spec.workdir, timeoutMs: spec.timeoutMs, onExpiry: spec.onExpiry,
      stdoutMaxBytes: spec.stdoutMaxBytes, env: spec.env, dshEnv: spec.dshEnv, sandboxPolicy: spec.sandboxPolicy }
  }
  const runtime = async (_workspace: string, action: Action, source: string) => source === 'agent' ? null
    : runtimeFingerprint(action, { settings: settings(action),
      provider: await ctx.shell.verificationInputs(ctx.shell.resolve(settings(action))) })
  const verification = new VerificationOwner(home, artifacts, runtime)
  let preparations = 0, commands = 0, omitPreparation = false
  const actions = new ProjectActions(home, async (action) => {
    expect((await verification.inspect(workspace, action.runId)).phase)
      .toBe('PENDING')
    const spec = ctx.shell.resolve({ command: action.command, workdir: action.cwd, signal: action.signal,
      timeoutMs: action.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 512 * 1024, env: action.env })
    if (!omitPreparation) { await action.recordExecution?.({ settings: settings({ ...action, cwd: '.' }),
      provider: await ctx.shell.verificationInputs(spec) }); preparations++ }
    commands++
    return (await ctx.shell.execute(spec)).result()
  }, { ...verification.hooks, queued: (workspace, run, action, revision, scope) => verification.hooks.queued(
    workspace, run, action, revision, agentSessionId ? { sessionId: agentSessionId } : scope) })
  verification.bind(actions)
  onTestFinished(async () => {
    await actions.close(); await verification.close(); await ctx.fiber.dispose(); dispose(); await storage.close()
    if (!retainRoot) await rm(root, { recursive: true, force: true })
  })
  if (!(ctx.shell instanceof PwshLocalExecutor)) throw Error('Expected actual local executor')
  const spec: VerificationSpec = { schemaVersion: 1, intent: 'Run the isolated Node test', parser: 'node-tap-13/1',
    coverage: 'complete', sources: ['src'], inputs: ['inputs'], toolchain: [process.execPath, ctx.shell.pwshPath], parameters: { tolerance: 0 } }
  const command = '& ' + quote(process.execPath) + ' --test --test-isolation=none --test-reporter=tap ' + quote(join(workspace, 'src/sample.test.mjs'))
  const save = async (patch: Partial<Action> = {}) => {
    const view = await actions.save(workspace, { schemaVersion: 1, actions: [{ id: 'local', label: 'Isolated Node test',
      command, timeoutMs: 10000, ...patch, verification: patch.verification ?? spec }] })
    await actions.trust(workspace, view.fingerprint)
    return view
  }
  const run = async (patch: Partial<Action> = {}) => {
    await save(patch)
    const row = await actions.start(workspace, 'local', agentSessionId ? { source: 'agent' } : {})
    return actions.wait(workspace, row.id)
  }
  const directory = async () => join(home, 'desktop-actions', (await readdir(join(home, 'desktop-actions'))).find(name => /^[a-f0-9]{64}$/.test(name))!, 'verification')
  return { ctx, root, home, workspace, storage, actions, artifacts, verification, runtime, spec, command, save, run, directory,
    counts: () => ({ preparations, commands }), omit: () => { omitPreparation = true } }
}
