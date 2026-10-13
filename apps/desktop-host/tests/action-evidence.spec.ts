/** Real local Shell, ProjectActions persistence and native quota; no provider or user data. */
import { Context } from '@deepseek-ai/cordis'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { actionEvidence, commandFacts } from '../src/workbench/evidence.ts'
import { ProjectActions } from '../src/workbench/legacy/project-actions.mjs'
import { installStorageAdmission } from '../src/workbench/legacy/storage-admission.mjs'

const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nidofy-action-evidence-')), home = join(root, 'harness'), workspace = join(root, 'project')
  await mkdir(home); await mkdir(workspace)
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(PwshLocalExecutor, { graceMs: 200 })
  const storage = new StorageService(ctx, home, { limitBytes: 64 * 1024 * 1024, safetyBytes: 1024 * 1024,
    executable: fileURLToPath(new URL('../../../native/nidofy-protection/target/release/nidofy-protection.exe', import.meta.url)) })
  const release = installStorageAdmission(storage)
  const actions = new ProjectActions(home, async (action) => {
    const spec = ctx.shell.resolve({ command: action.command, workdir: action.cwd, signal: action.signal,
      timeoutMs: action.timeoutMs, onExpiry: 'kill', stdoutMaxBytes: 512 * 1024, env: action.env })
    return (await ctx.shell.execute(spec)).result()
  })
  onTestFinished(async () => {
    await actions.close(); await ctx.fiber.dispose(); release(); await storage.close(); await rm(root, { recursive: true, force: true })
  })
  const run = async (command: string, timeoutMs = 10000) => {
    const view = await actions.save(workspace, { schemaVersion: 1, actions: [{ id: 'local', label: 'Isolated command', command, timeoutMs }] })
    await actions.trust(workspace, view.fingerprint)
    const row = await actions.start(workspace, 'local')
    return actions.wait(workspace, row.id)
  }
  return { root, home, workspace, actions, run }
}

it.skipIf(process.platform !== 'win32')('reads actual passing/failing Node TAP logs without minting a fresh verification receipt', async () => {
  const f = await fixture(), path = join(f.workspace, 'sample.test.mjs')
  const command = '& ' + quote(process.execPath) + ' --test --test-reporter=tap ' + quote(path)
  await writeFile(path, "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('local', () => assert.equal(1,1));")
  const passed = await f.run(command)
  const noParser = await actionEvidence(f.actions, f.workspace, passed.id)
  expect(noParser.log.tests).toBeNull()
  const evidence = await actionEvidence(f.actions, f.workspace, passed.id, 'node-tap-13/1')
  expect(evidence).toMatchObject({ command: { outcome: 'SUCCEEDED', exitCode: 0 },
    log: { complete: true, tests: { tests: 1, passed: 1, failed: 0 } }, coverage: 'unknown', freshness: 'UNKNOWN', acceptance: 'PENDING', receipt: null })
  expect(evidence.log.digest).toMatch(/^[0-9a-f]{64}$/)
  await writeFile(path, "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('local', () => assert.equal(1,2));")
  const failed = await f.run(command), rejected = await actionEvidence(f.actions, f.workspace, failed.id, 'node-tap-13/1')
  expect(rejected).toMatchObject({ command: { outcome: 'FAILED' }, log: { complete: true, tests: { passed: 0, failed: 1 } } })
  expect((await actionEvidence(f.actions, f.workspace, passed.id, 'node-tap-13/1')).freshness).toBe('UNKNOWN')
  expect(await readFile(path, 'utf8')).toContain('assert.equal(1,2)')
}, 30000)

it.skipIf(process.platform !== 'win32')('rejects caller claims and unsupported parser/path/size inputs, retaining independent interruption facts', async () => {
  const f = await fixture(), run = await f.run("Write-Output 'tests PASSED'; exit 0")
  expect((await actionEvidence(f.actions, f.workspace, run.id, 'node-tap-13/1')).log.tests).toBeNull()
  await expect(actionEvidence(f.actions, f.workspace, run.id, 'model-claim')).rejects.toThrow('ACTION_EVIDENCE_PARSER_UNSUPPORTED')
  await expect(actionEvidence(f.actions, f.workspace, 'not-an-existing-run')).rejects.toThrow('ACTION_EVIDENCE_RUN_UNKNOWN')
  const reference = await f.actions.logReference(f.workspace, run.id), path = join(reference.root, reference.path)
  const bytes = await readFile(path)
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1))
  await expect(actionEvidence(f.actions, f.workspace, run.id)).rejects.toThrow('ACTION_EVIDENCE_LOG_TOO_LARGE')
  await rm(path)
  const outside = join(f.root, 'outside.log'); await writeFile(outside, bytes)
  await symlink(outside, path)
  await expect(actionEvidence(f.actions, f.workspace, run.id)).rejects.toThrow('ACTION_EVIDENCE_PATH_REFUSED')
  await rm(path); await writeFile(path, bytes)
  const metadata = path.replace(/\.log$/, '.json'), row: unknown = JSON.parse(await readFile(metadata, 'utf8'))
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid actual run metadata')
  await writeFile(metadata, JSON.stringify({ ...row, status: 'RUNNING' }))
  const reopened = new ProjectActions(f.home, () => { throw Error('No automatic execution') })
  onTestFinished(() => reopened.close())
  const evidence = await actionEvidence(reopened, f.workspace, run.id, 'node-tap-13/1')
  expect(evidence).toMatchObject({ command: { interrupted: true, outcome: 'UNKNOWN' }, log: { complete: false, tests: null }, receipt: null })
}, 30000)

it.skipIf(process.platform !== 'win32')('keeps real Shell timeout and output truncation outside complete test evidence', async () => {
  const f = await fixture(), timed = await f.run('Start-Sleep -Seconds 3', 1000)
  expect(await actionEvidence(f.actions, f.workspace, timed.id, 'node-tap-13/1'))
    .toMatchObject({ command: { timedOut: true, outcome: 'UNKNOWN' }, log: { complete: false, tests: null } })
  const path = join(f.workspace, 'large.mjs'); await writeFile(path, "process.stdout.write('x'.repeat(600000));")
  const truncated = await f.run('& ' + quote(process.execPath) + ' ' + quote(path))
  expect(truncated.logTruncated).toBe(true)
  expect(await actionEvidence(f.actions, f.workspace, truncated.id, 'node-tap-13/1'))
    .toMatchObject({ command: { outcome: 'SUCCEEDED' }, log: { complete: false, tests: null } })
}, 30000)

it('keeps zero exit, cancellation, timeout and absent execution independent', () => {
  expect(commandFacts({ id: 'timed', status: 'TIMEOUT', startedAt: 'actual-start', exitCode: 0, timedOut: true, aborted: false }))
    .toMatchObject({ exitCode: 0, timedOut: true, cancelled: false, outcome: 'UNKNOWN' })
  expect(commandFacts({ id: 'queued', status: 'CANCELLED' })).toMatchObject({ cancelled: true, outcome: 'NOT_RUN' })
  expect(commandFacts({ id: 'old', status: 'PASS', exitCode: 0 })).toMatchObject({ outcome: 'UNKNOWN' })
})

it.skipIf(process.platform !== 'win32')('retains bounded execution error codes without storing arbitrary error details', async () => {
  const f = await fixture()
  for (const detail of ['SANDBOX_UNAVAILABLE', 'private path with synthetic-secret']) {
    const actions = new ProjectActions(f.home, () => { throw Error(detail) })
    onTestFinished(() => actions.close())
    const view = await actions.save(f.workspace, { schemaVersion: 1,
      actions: [{ id: 'failure', label: 'Failure injection', command: 'unused', timeoutMs: 1000 }] })
    await actions.trust(f.workspace, view.fingerprint)
    const run = await actions.start(f.workspace, 'failure'), done = await actions.wait(f.workspace, run.id)
    expect(done.status).toBe('UNKNOWN')
    expect(String(done.message)).not.toContain('synthetic-secret')
    if (detail === 'SANDBOX_UNAVAILABLE') expect(done.message).toContain('(SANDBOX_UNAVAILABLE)')
  }
}, 30000)
