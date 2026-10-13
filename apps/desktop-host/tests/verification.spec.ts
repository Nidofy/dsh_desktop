/** Real isolated Shell actions, durable receipt publication and native quota; no provider calls or user data. */
import { readFile,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect,it,onTestFinished,vi } from 'vitest'
import { ProjectActions } from '../src/workbench/legacy/project-actions.mjs'
import { VerificationOwner } from '../src/workbench/verification.ts'
import { actionEvidence } from '../src/workbench/evidence.ts'
import { verificationFixture as fixture,passedSource } from './verification-fixture.ts'
const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"

it.skipIf(process.platform !== 'win32')('commits actual tests with pre-execution intent, source/config/tool bytes and independent user acceptance', async () => {
  const f = await fixture(), committed: string[] = []
  const off = f.verification.subscribe((event) => { committed.push(event.receiptId) })
  f.verification.subscribe(() => { throw Error('Synthetic subscriber failure') })
  const run = await f.run(), view = await f.verification.inspect(f.workspace, run.id)
  expect(view).toMatchObject({ phase: 'COMMITTED', acceptanceRevision: 0, logAvailable: true, receipt: {
    tests: 'PASSED', coverage: 'complete', freshness: 'CURRENT', acceptance: 'PENDING', exitCode: 0,
    cancelled: false, timedOut: false, interrupted: false, log: { complete: true, parserVersion: 'node-tap-13/1' }, summary: { passed: 1 } } })
  expect(view.receipt?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(view.receipt?.inputFingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(committed).toEqual([run.id]); off()
  const accepted = await f.verification.accept(f.workspace, run.id, 0, 'ACCEPTED')
  expect(accepted).toMatchObject({ acceptanceRevision: 1, receipt: { acceptance: 'ACCEPTED', tests: 'PASSED' } })
  await expect(f.verification.accept(f.workspace, run.id, 0, 'REJECTED')).rejects.toThrow('VERIFICATION_ACCEPTANCE_CONFLICT')
  expect(f.counts()).toEqual({ commands: 1, preparations: 1 })
  expect(await f.verification.log(f.workspace, run.id)).toContain('# pass 1')
  const path = join(await f.directory(), run.id, 'result.json'), record: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Expected actual receipt')
  await writeFile(path, JSON.stringify({ ...record, summary: { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0 } }))
  await expect(f.verification.inspect(f.workspace, run.id)).rejects.toThrow('VERIFICATION_RECEIPT_LOG_CONFLICT')
}, 60000)

it.skipIf(process.platform !== 'win32')('keeps an unavailable current provider observation unknown without relabelling unchanged source as changed', async () => {
  const f = await fixture(), run = await f.run()
  expect((await f.verification.inspect(f.workspace, run.id)).receipt?.freshness).toBe('CURRENT')
  const observation = vi.spyOn(f.ctx.shell, 'verificationInputs').mockResolvedValue(null)
  onTestFinished(() =>{  observation.mockRestore() })
  expect(await f.verification.inspect(f.workspace, run.id)).toMatchObject({ receipt: { tests: 'PASSED', freshness: 'UNKNOWN' } })
  await writeFile(join(f.workspace, 'src/untracked.mjs'), 'export const changed = true')
  expect((await f.verification.inspect(f.workspace, run.id)).receipt?.freshness).toBe('STALE')
}, 60000)

it.skipIf(process.platform !== 'win32')('expires dirty and new untracked inputs without rewriting historical test facts or acceptance', async () => {
  const f = await fixture(), run = await f.run(), dir = join(await f.directory(), run.id), bytes = await readFile(join(dir, 'result.json'))
  await f.verification.accept(f.workspace, run.id, 0, 'ACCEPTED')
  await writeFile(join(f.workspace, 'src/sample.test.mjs'), passedSource.replace('1,1', '1,2'))
  expect(await f.verification.inspect(f.workspace, run.id)).toMatchObject({ receipt: { tests: 'PASSED', freshness: 'STALE', acceptance: 'ACCEPTED' } })
  expect(await readFile(join(dir, 'result.json'))).toEqual(bytes)
  await writeFile(join(f.workspace, 'src/sample.test.mjs'), passedSource)
  await writeFile(join(f.workspace, 'inputs/untracked-case.json'), '{}')
  expect(await f.verification.inspect(f.workspace, run.id)).toMatchObject({ receipt: { freshness: 'STALE' } })
  const failure = await f.run()
  await writeFile(join(f.workspace, 'src/sample.test.mjs'), passedSource.replace('1,1', '1,2'))
  const failed = await f.run()
  expect(await f.verification.inspect(f.workspace, failed.id)).toMatchObject({ receipt: { tests: 'FAILED', exitCode: 1, log: { complete: true } } })
  expect((await actionEvidence(f.actions, f.workspace, failure.id, 'node-tap-13/1')).receipt).toBeNull()
}, 60000)

it.skipIf(process.platform !== 'win32')('records monotonic actual configuration revisions and observes identical artifact bytes in each real run', async () => {
  const f = await fixture(), path = join(f.workspace, 'result.txt')
  await writeFile(path, 'same')
  const command = 'Set-Content -NoNewline -LiteralPath ' + quote(path) + " -Value 'same'; " + f.command
  const first = await f.run({ command, artifacts: ['result.txt'] }), firstView = await f.verification.inspect(f.workspace, first.id)
  const second = await f.run({ command, artifacts: ['result.txt'] }), secondView = await f.verification.inspect(f.workspace, second.id)
  expect(firstView.receipt?.configRevision).toBe(secondView.receipt?.configRevision)
  expect(firstView.receipt?.artifacts[0]).toMatchObject({ runId: first.id, path: 'result.txt', observation: 'observed-after-run', bytes: 4 })
  expect(firstView.receipt?.artifacts[0]?.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(secondView.receipt?.artifacts[0]?.digest).toBe(firstView.receipt?.artifacts[0]?.digest)
  expect(secondView.receipt?.artifacts[0]?.runId).toBe(second.id)
  await f.save({ command: "Write-Output 'changed config'" })
  await f.save({ command, artifacts: ['result.txt'] })
  expect((await f.actions.inspect(f.workspace)).configRevision).toBeGreaterThan(firstView.receipt!.configRevision)
  expect((await f.verification.inspect(f.workspace, first.id)).receipt?.freshness).toBe('STALE')
}, 60000)

it.skipIf(process.platform !== 'win32')('keeps timeout, truncation, absent preparation and zero-exit text claims outside PASSED receipts', async () => {
  const f = await fixture(), timed = await f.run({ command: 'Start-Sleep -Seconds 3', timeoutMs: 1000 })
  expect(await f.verification.inspect(f.workspace, timed.id)).toMatchObject({ receipt: { timedOut: true, tests: 'UNKNOWN', log: { complete: false } } })
  const truncated = await f.run({ command: "Write-Output ('x' * 600000)" })
  expect(await f.verification.inspect(f.workspace, truncated.id)).toMatchObject({ receipt: { exitCode: 0, tests: 'UNKNOWN', log: { complete: false } } })
  const claim = await f.run({ command: "Write-Output 'PASSED'; exit 0" })
  expect(await f.verification.inspect(f.workspace, claim.id)).toMatchObject({ receipt: { tests: 'UNKNOWN', exitCode: 0 } })
  f.omit()
  const unsupported = await f.run()
  expect(await f.verification.inspect(f.workspace, unsupported.id)).toMatchObject({ receipt: { tests: 'UNKNOWN', interrupted: true, log: { complete: false } } })
}, 60000)

it.skipIf(process.platform !== 'win32')('retains receipt logs through actual action-history pruning and cold reopening, refusing missing logs and unknown schemas', async () => {
  const f = await fixture(), run = await f.run(), dir = await f.directory(), actionDir = join(dir, '../runs')
  await f.storage.write(actionDir, 128 * 1024, async () => {
    for (let i = 0; i < 100; i++) {
      const id = '00000000-0000-0000-0000-' + String(i).padStart(12, '0')
      await writeFile(join(actionDir, id + '.json'), JSON.stringify({ schemaVersion: 1, id, status: 'NOT_STARTED', createdAt: '2099-01-01T00:00:00.000Z' }))
    }
  })
  const coldActions = new ProjectActions(f.home, () => { throw Error('No automatic execution') })
  const cold = new VerificationOwner(f.home, f.artifacts, f.runtime); cold.bind(coldActions)
  onTestFinished(async () => { await coldActions.close(); await cold.close() })
  expect((await coldActions.inspect(f.workspace)).runs.some(row => row.id === run.id)).toBe(false)
  expect(await cold.inspect(f.workspace, run.id)).toMatchObject({ receipt: { tests: 'PASSED', freshness: 'CURRENT' }, logAvailable: true })
  expect(await cold.log(f.workspace, run.id)).toContain('TAP version 13')
  expect((await cold.list(f.workspace)).ids).toContain(run.id)
  await rm(join(dir, run.id, 'execution.log'))
  expect(await cold.inspect(f.workspace, run.id)).toMatchObject({ receipt: { tests: 'UNKNOWN', log: { complete: false } }, logAvailable: false })
  const path = join(dir, run.id, 'result.json'), value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected actual receipt')
  await writeFile(path, JSON.stringify({ ...value, schemaVersion: 2 }))
  await expect(cold.inspect(f.workspace, run.id)).rejects.toThrow('VERIFICATION_SCHEMA_UNSUPPORTED')
}, 60000)

it.skipIf(process.platform !== 'win32')('keeps orphaned intents unknown, legacy runs unreceipted and incomplete input closures unknown after reopen', async () => {
  const f = await fixture(), view = await f.save(), id = '11111111-1111-1111-1111-111111111111'
  await f.verification.hooks.queued(f.workspace, { id, status: 'RUNNING', fingerprint: view.fingerprint, source: 'desktop' },
    view.config.actions[0]!, view.configRevision!, null)
  const cold = new VerificationOwner(f.home, f.artifacts, f.runtime); cold.bind(f.actions)
  onTestFinished(() => cold.close())
  expect(await cold.inspect(f.workspace, id)).toMatchObject({ phase: 'INTERRUPTED', receipt: null, diagnostic: 'VERIFICATION_RESULT_UNKNOWN' })
  expect(await cold.inspect(f.workspace, '22222222-2222-2222-2222-222222222222')).toMatchObject({ phase: 'LEGACY', receipt: null })
  expect(f.counts().commands).toBe(0)
  const run = await f.run({ verification: { ...f.spec, inputs: ['missing-case'], coverage: 'complete' } })
  expect(await f.verification.inspect(f.workspace, run.id)).toMatchObject({ receipt: { tests: 'PASSED', coverage: 'unknown', freshness: 'UNKNOWN' } })
}, 60000)
