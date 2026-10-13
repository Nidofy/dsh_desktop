/** Synthetic comparisons exercise independent T11 facts; these fixtures confer no task-run qualification. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it } from 'vitest'
import { compareReceipts, type ComparisonSelection, type ExperimentId, type ExperimentCaseId } from '../src/experiments/comparison.ts'
import type { VerificationView, VerificationRunId, ReceiptId } from '../src/workbench/verification.ts'

const a = brandString<VerificationRunId>('11111111-1111-1111-1111-111111111111')
const b = brandString<VerificationRunId>('22222222-2222-2222-2222-222222222222')
const selection: ComparisonSelection = { experimentId: brandString<ExperimentId>('33333333-3333-3333-3333-333333333333'),
  caseId: brandString<ExperimentCaseId>('44444444-4444-4444-4444-444444444444'), factor: 'notebook',
  a: { workspace: 'isolated', runId: a }, b: { workspace: 'isolated', runId: b } }
const view = (id: VerificationRunId): VerificationView => ({ phase: 'COMMITTED', acceptanceRevision: 0, logAvailable: true,
  diagnostic: null, receipt: { schemaVersion: 1, id: brandString<ReceiptId>(id), runId: id, intent: 'same reviewed task',
    sourceFingerprint: 'a'.repeat(64), inputFingerprint: 'b'.repeat(64), coverage: 'complete', configRevision: 1, completedAt: 1,
    command: { actionId: 'test', digest: 'c'.repeat(64), cwd: '.', environmentDigest: 'd'.repeat(64) }, exitCode: 0,
    cancelled: false, timedOut: false, interrupted: false, log: { digest: 'e'.repeat(64), complete: true, parserVersion: 'node-tap-13/1' },
    tests: 'PASSED', summary: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }, artifacts: [],
    acceptance: 'PENDING', freshness: 'CURRENT' } })

it('keeps same receipt inputs separate from full task comparability, factor evidence, acceptance and missing model counts', () => {
  const result = compareReceipts(selection, view(a), view(b))
  expect(result).toMatchObject({ verification: 'MATCHED', task: 'UNKNOWN', quality: 'UNKNOWN', efficiencyEligible: false,
    counts: { requests: { a: null, b: null, missing: 2 }, tests: { a: 1, b: 1, missing: 0 } } })
  expect(result.checks.slice(-3)).toEqual(['model-version', 'model-input', 'factor-state'].map(name => ({ name, result: 'UNKNOWN' })))
})
it.each(['sourceFingerprint', 'inputFingerprint', 'intent', 'configRevision'] as const)('refuses different %s without rewriting either receipt', (key) => {
  const first = view(a), second = view(b)
  if (!second.receipt) throw Error('Expected fixture receipt')
  if (key === 'configRevision') second.receipt[key]++
  else second.receipt[key] = 'f'.repeat(64)
  const before = structuredClone([first, second])
  expect(compareReceipts(selection, first, second).task).toBe('NOT_COMPARABLE')
  expect([first, second]).toEqual(before)
})
it('does not turn two manual acceptances, missing logs or a stale result into an efficiency conclusion', () => {
  const first = view(a), second = view(b)
  if (!first.receipt || !second.receipt) throw Error('Expected fixture receipts')
  first.receipt.acceptance = second.receipt.acceptance = 'ACCEPTED'
  expect(compareReceipts(selection, first, second)).toMatchObject({ quality: 'BOTH_ACCEPTED', task: 'UNKNOWN', efficiencyEligible: false })
  second.receipt.acceptance = 'REJECTED'; second.receipt.freshness = 'STALE'; second.logAvailable = false
  expect(compareReceipts(selection, first, second)).toMatchObject({ quality: 'REJECTED', task: 'NOT_COMPARABLE',
    counts: { tests: { a: 1, b: null, missing: 1 } } })
})
it.each(['LEGACY', 'INTERRUPTED', 'PENDING'] as const)('keeps %s and receipt identity conflicts unknown without reconstructing results', (phase) => {
  const unavailable: VerificationView = { phase, receipt: null, acceptanceRevision: 0, logAvailable: false, diagnostic: null }
  expect(compareReceipts(selection, unavailable, view(b))).toMatchObject({ verification: 'UNKNOWN', quality: 'UNKNOWN',
    counts: { tests: { a: null, b: 1, missing: 1 } } })
  expect(compareReceipts(selection, view(b), view(b)).verification).toBe('UNKNOWN')
  expect(compareReceipts({ ...selection, b: selection.a }, view(a), view(a)).task).toBe('NOT_COMPARABLE')
})

it.skipIf(process.platform !== 'win32')('treats differently cased canonical Windows workspace references as one execution', () => {
  const first = view(a)
  if (!first.receipt) throw Error('Expected fixture receipt')
  first.receipt.acceptance = 'ACCEPTED'
  const aliases = { ...selection, b: { workspace: selection.a.workspace.toUpperCase(), runId: a } }
  expect(compareReceipts(aliases, first, first)).toMatchObject({ verification: 'NOT_MATCHED', task: 'NOT_COMPARABLE', quality: 'UNKNOWN' })
})
