/** Synthetic full-turn projections keep observed bytes, unknown counters and independent acceptance separate without sending work. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it } from 'vitest'
import { compareEngineeringRuns, type EngineeringComparisonRun } from '../src/experiments/engineering-comparison.ts'
import type { ReceiptId, VerificationRunId, VerificationView } from '../src/workbench/verification.ts'
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222'
function fixture(id: string): EngineeringComparisonRun {
  const runId = brandString<VerificationRunId>(id)
  const view: VerificationView = { phase: 'COMMITTED', acceptanceRevision: 0, logAvailable: true, diagnostic: null,
    receipt: { schemaVersion: 1, id: brandString<ReceiptId>(id), runId, intent: 'same task', sourceFingerprint: 'a'.repeat(64),
      inputFingerprint: 'b'.repeat(64), coverage: 'complete', configRevision: 1, completedAt: 1,
      command: { actionId: 'case', digest: 'c'.repeat(64), cwd: '.', environmentDigest: 'd'.repeat(64) }, exitCode: 0,
      cancelled: false, timedOut: false, interrupted: false, log: { digest: 'e'.repeat(64), complete: true, parserVersion: 'node-tap-13/1' },
      tests: 'PASSED', summary: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }, artifacts: [],
      acceptance: 'PENDING', freshness: 'CURRENT' } }
  return { id, status: 'COMPLETED', actionConfig: { actions: ['case'] }, notebook: null, resources: null,
    cache: { preferenceRevision: 1, enabled: true, mounted: true, policy: { mode: 'off', models: ['alias'] } },
    input: { experimentId: 'experiment', caseId: 'case', text: 'Full task', connection: 'managed', model: 'alias', actionIds: ['case'],
      budget: { requests: 2 }, copy: { source: 'synthetic', paths: ['src'], entries: [{ path: 'src', kind: 'file', digest: 'a'.repeat(64),
        stamp: { identity: id, bytes: 3, modified: '1', changed: '1' } }], bytes: 3,
      root: { identity: id, bytes: 0, modified: '1', changed: '1' } } },
    preparedInputs: [{ sessionId: id, provider: 'managed', model: 'alias', messages: [{ role: 'user', content: 'Full task' }] }],
    counts: { dispatches: 2, inputTokens: 0, outputTokens: 10, cacheReadTokens: null, providerWireRequests: null },
    original: { intent: { configurationRevision: 1, connectionRevision: 'original', policyRevision: { profile: 0 }, startedAt: 1 },
      terminal: { endedAt: 2 } }, reportedModels: [{ id: 'reported-v1' }],
    receipts: [{ selection: { workspace: 'isolated-' + id, runId }, view }] }
}
it('compares complete input bytes apart from the run locator and preserves every missing or explicit-zero counter', () => {
  const left = fixture(a), right = fixture(b), before = structuredClone([left, right])
  const result = compareEngineeringRuns('cache', left, right)
  expect(result).toMatchObject({ task: 'UNKNOWN', quality: 'UNKNOWN', exactModelVersion: null, efficiencyEligible: false,
    counts: { dispatches: { a: 2, b: 2, missing: 0 }, inputTokens: { a: 0, b: 0, missing: 0 },
      cacheReadTokens: { a: null, b: null, missing: 2 }, providerWireRequests: { a: null, b: null, missing: 2 } } })
  expect(result.checks.find(row => row.name === 'copied-input-closure')?.result).toBe('SAME')
  expect(result.checks.find(row => row.name === 'first-complete-model-input')?.result).toBe('SAME')
  expect([left, right]).toEqual(before)
  expect(result.resourceCounts.diskPeakBytes).toEqual({ a: null, b: null, missing: 2 })
  expect(result.resourceCounts.workspaceBytes).toEqual({ a: null, b: null, missing: 2 })
})
it.each(['closure', 'context', 'model', 'case', 'budget', 'reported-model', 'configuration', 'receipt-command', 'receipt-source'])('refuses changed %s even when labels and tests agree', (change) => {
  const left = fixture(a), right = fixture(b)
  if (change === 'closure') right.input.copy.entries[0]!.digest = 'b'.repeat(64)
  if (change === 'context') right.preparedInputs = [{ messages: [{ role: 'user', content: 'Different full context' }] }]
  if (change === 'model') right.input.model = 'different'
  if (change === 'case') right.input.caseId = 'different'
  if (change === 'budget') right.input.budget = { requests: 3 }
  if (change === 'reported-model') right.reportedModels = [{ id: 'reported-v2' }]
  if (change === 'configuration') right.original.intent.connectionRevision = 'changed'
  if (change === 'receipt-command') right.receipts[0]!.view.receipt!.command.digest = 'f'.repeat(64)
  if (change === 'receipt-source') right.receipts[0]!.view.receipt!.sourceFingerprint = 'f'.repeat(64)
  expect(compareEngineeringRuns('cache', left, right).task).toBe('NOT_COMPARABLE')
})
it('retains two independent acceptances without certifying version or efficiency and refuses stale or repeated runs', () => {
  const left = fixture(a), right = fixture(b)
  for (const run of [left, right]) run.receipts[0]!.view.receipt!.acceptance = 'ACCEPTED'
  expect(compareEngineeringRuns('cache', left, right)).toMatchObject({ quality: 'BOTH_ACCEPTED', task: 'UNKNOWN', efficiencyEligible: false })
  right.receipts[0]!.view.receipt!.freshness = 'STALE'; right.receipts[0]!.view.receipt!.acceptance = 'REJECTED'
  expect(compareEngineeringRuns('cache', left, right)).toMatchObject({ task: 'NOT_COMPARABLE', quality: 'REJECTED' })
  expect(compareEngineeringRuns('cache', left, left)).toMatchObject({ task: 'NOT_COMPARABLE', quality: 'UNKNOWN' })
})
it('does not infer counters from receipts or refill interrupted observations from current settings', () => {
  const left = fixture(a), right = fixture(b); right.counts = null; right.preparedInputs = []; right.status = 'INTERRUPTED'
  const result = compareEngineeringRuns('notebook', left, right)
  expect(result.counts.dispatches).toEqual({ a: 2, b: null, missing: 1 })
  expect(result.quality).toBe('UNKNOWN'); expect(result.checks.find(row => row.name === 'notebook-input')?.result).toBe('UNKNOWN')
})
