/** Read-only task comparison uses retained T11 facts; caller labels never establish model-input or factor equivalence. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { VerificationView, VerificationRunId } from '../workbench/verification.ts'

/** Caller-selected grouping identity; it is not evidence of a common task or permission to execute. */
export type ExperimentId = Branded<'nidofy.ExperimentId'>
/** Explicit case grouping within an experiment, independently checked against the retained receipts. */
export type ExperimentCaseId = Branded<'nidofy.ExperimentCaseId'>
/** Exact existing run selected by the local user; no retrospective association is inferred from diagnostics. */
export interface ReceiptSelection { workspace: string; runId: VerificationRunId }
/** Requested single-factor comparison; the factor label does not attest that either run used that setting. */
export interface ComparisonSelection {
  experimentId: ExperimentId
  caseId: ExperimentCaseId
  factor: 'notebook' | 'cache'
  a: ReceiptSelection
  b: ReceiptSelection
}
type CheckName = 'distinct-runs' | 'committed-receipts' | 'intent' | 'source' | 'input' | 'configuration'
  | 'command' | 'coverage' | 'freshness' | 'log' | 'model-version' | 'model-input' | 'factor-state'
type Check = { name: CheckName; result: 'SAME' | 'DIFFERENT' | 'UNKNOWN' }
/** Complete comparison with independent acceptance and explicitly missing counts; no efficiency claim follows from tests. */
export interface TaskComparison {
  selection: ComparisonSelection
  verification: 'MATCHED' | 'NOT_MATCHED' | 'UNKNOWN'
  task: 'NOT_COMPARABLE' | 'UNKNOWN'
  quality: 'BOTH_ACCEPTED' | 'REJECTED' | 'UNKNOWN'
  efficiencyEligible: false
  checks: Check[]
  a: VerificationView
  b: VerificationView
  counts: {
    requests: { a: null; b: null; missing: 2 }
    inputTokens: { a: null; b: null; missing: 2 }
    outputTokens: { a: null; b: null; missing: 2 }
    cacheReadTokens: { a: null; b: null; missing: 2 }
    tests: { a: number | null; b: number | null; missing: number }
  }
}

/** Compare actual receipt observations without reading archives, creating directories or dispatching work.
 * @param selection - Explicit grouping and exact run references; labels are retained separately from measured facts.
 * @param a - Current owner inspection of the selected A run.
 * @param b - Current owner inspection of the selected B run.
 * @returns Known differences reject direct comparison; unavailable model inputs, versions, factors and counts stay unknown.
 */
export function compareReceipts(selection: ComparisonSelection, a: VerificationView, b: VerificationView): TaskComparison {
  const checks: Check[] = []
  const add = (name: CheckName, result: Check['result']): void => { checks.push({ name, result }) }
  const equal = (name: CheckName, x: string | number | null | undefined, y: string | number | null | undefined): void => {
    add(name, x === null || x === undefined || y === null || y === undefined ? 'UNKNOWN' : x === y ? 'SAME' : 'DIFFERENT')
  }
  const x = a.receipt, y = b.receipt
  const aCommitted = a.phase === 'COMMITTED' && x?.runId === selection.a.runId && String(x.id) === selection.a.runId
  const bCommitted = b.phase === 'COMMITTED' && y?.runId === selection.b.runId && String(y.id) === selection.b.runId
  const committed = aCommitted && bCommitted
  const workspaceKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
  const sameWorkspace = workspaceKey(selection.a.workspace) === workspaceKey(selection.b.workspace)
  const distinct = !sameWorkspace || selection.a.runId !== selection.b.runId
  add('distinct-runs', distinct ? 'SAME' : 'DIFFERENT')
  add('committed-receipts', committed ? 'SAME' : 'UNKNOWN')
  equal('intent', x?.intent, y?.intent)
  equal('source', x?.sourceFingerprint, y?.sourceFingerprint)
  equal('input', x?.inputFingerprint, y?.inputFingerprint)
  if (sameWorkspace) equal('configuration', x?.configRevision, y?.configRevision)
  else add('configuration', 'UNKNOWN')
  equal('command', x ? JSON.stringify(x.command) : null, y ? JSON.stringify(y.command) : null)
  add('coverage', committed && x.coverage === 'complete' && y.coverage === 'complete' ? 'SAME' : 'UNKNOWN')
  add('freshness', x?.freshness === 'STALE' || y?.freshness === 'STALE' ? 'DIFFERENT'
    : committed && x.freshness === 'CURRENT' && y.freshness === 'CURRENT' ? 'SAME' : 'UNKNOWN')
  add('log', committed && a.logAvailable && b.logAvailable && x.log.complete && y.log.complete ? 'SAME' : 'UNKNOWN')
  const receiptChecks = checks.slice()
  for (const name of ['model-version', 'model-input', 'factor-state'] as const) add(name, 'UNKNOWN')
  const verification = receiptChecks.some(row => row.result === 'DIFFERENT') ? 'NOT_MATCHED'
    : receiptChecks.some(row => row.result === 'UNKNOWN') ? 'UNKNOWN' : 'MATCHED'
  const testsA = aCommitted && a.logAvailable && x.log.complete ? x.summary?.tests ?? null : null
  const testsB = bCommitted && b.logAvailable && y.log.complete ? y.summary?.tests ?? null : null
  const missing = () => ({ a: null, b: null, missing: 2 } as const)
  return { selection, verification, task: verification === 'NOT_MATCHED' ? 'NOT_COMPARABLE' : 'UNKNOWN',
    quality: !committed || !distinct ? 'UNKNOWN' : x.acceptance === 'REJECTED' || y.acceptance === 'REJECTED' ? 'REJECTED'
      : x.acceptance === 'ACCEPTED' && y.acceptance === 'ACCEPTED' ? 'BOTH_ACCEPTED' : 'UNKNOWN',
    efficiencyEligible: false, checks, a, b,
    counts: { requests: missing(), inputTokens: missing(), outputTokens: missing(), cacheReadTokens: missing(),
      tests: { a: testsA, b: testsB, missing: Number(testsA === null) + Number(testsB === null) } } }
}
