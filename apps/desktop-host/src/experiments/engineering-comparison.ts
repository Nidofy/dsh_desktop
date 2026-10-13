/** Whole engineering-turn comparisons use original dispatch inputs and independently inspected protected-action receipts. */
import type { DesktopCacheInput } from '@nidofy/dsh-desktop-extras/cache'
import type { EngineeringShellBudget, EngineeringShellResult } from './engineering-shell.ts'
import type { NotebookInputCapture } from '@nidofy/dsh-desktop-extras/context'
import type { ProjectCopyPreview } from './project-copy.ts'
import type { ReceiptSelection } from './comparison.ts'
import type { VerificationView } from '../workbench/verification.ts'
import type { EngineeringResourceAllocation, EngineeringResourceResult } from './engineering-resources.ts'

/** Owner-validated original run facts; this projection grants no execution or local-user acceptance authority. */
export interface EngineeringComparisonRun {
  id: string
  status: string
  input: {
    experimentId: string
    caseId: string
    text: string
    connection: string
    model: string
    actionIds: string[]
    budget: object
    copy: ProjectCopyPreview
  }
  actionConfig: unknown
  preparedInputs: readonly unknown[]
  counts: Record<string, unknown> | null
  original: { intent: Record<string, unknown>; terminal: Record<string, unknown> | null }
  reportedModels: readonly unknown[] | null
  notebook: NotebookInputCapture | null
  cache: DesktopCacheInput | null
  resources: { allocation: EngineeringResourceAllocation; result: EngineeringResourceResult | null } | null
  shell?: { budget: EngineeringShellBudget; result: EngineeringShellResult | null } | null
  receipts: { selection: ReceiptSelection; view: VerificationView }[]
}
type Check = { name: string; result: 'SAME' | 'DIFFERENT' | 'UNKNOWN' }
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, row: unknown) => typeof row === 'object' && row !== null && !Array.isArray(row)
    ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row)
}
/** Compare full owner-validated turns without replacing dispatch evidence, filling missing counts or asserting efficiency.
 * @param factor - Explicit requested factor; changes to any other observed input reject direct comparison.
 * @param a - Original A run and current independent receipt inspections.
 * @param b - Original B run and current independent receipt inspections.
 * @returns Measured turn counts, original references, differences and separate acceptance; exact versions remain unobserved.
 */
export function compareEngineeringRuns(factor: 'notebook' | 'cache', a: EngineeringComparisonRun, b: EngineeringComparisonRun) {
  const checks: Check[] = []
  const equal = (name: string, left: unknown, right: unknown): void => {
    checks.push({ name, result: left === null || left === undefined || right === null || right === undefined
      ? 'UNKNOWN' : canonical(left) === canonical(right) ? 'SAME' : 'DIFFERENT' })
  }
  checks.push({ name: 'distinct-runs', result: a.id === b.id ? 'DIFFERENT' : 'SAME' })
  equal('experiment', a.input.experimentId, b.input.experimentId); equal('case', a.input.caseId, b.input.caseId)
  equal('task-text', a.input.text, b.input.text); equal('requested-model', a.input.model, b.input.model)
  equal('connection', a.input.connection, b.input.connection); equal('budget', a.input.budget, b.input.budget)
  const configuration = (run: EngineeringComparisonRun) => ({ revision: run.original.intent.configurationRevision,
    connection: run.original.intent.connectionRevision, policy: run.original.intent.policyRevision })
  equal('connection-configuration', configuration(a), configuration(b))
  equal('resource-budget', a.resources?.allocation.budget, b.resources?.allocation.budget)
  equal('shell-budget', a.shell?.budget, b.shell?.budget)
  equal('action-configuration', a.actionConfig, b.actionConfig)
  const executed = (run: EngineeringComparisonRun) => run.receipts.length && run.receipts.every(row => row.view.receipt
    && row.view.receipt.sourceFingerprint !== null && row.view.receipt.inputFingerprint !== null && row.view.receipt.coverage === 'complete')
    ? run.receipts.map(({ view }) => ({ intent: view.receipt?.intent, source: view.receipt?.sourceFingerprint,
      input: view.receipt?.inputFingerprint, command: view.receipt?.command })) : null
  equal('actual-receipt-execution-inputs', executed(a), executed(b))
  const closure = (run: EngineeringComparisonRun) => ({ paths: run.input.copy.paths,
    entries: run.input.copy.entries.map(row => ({ path: row.path, kind: row.kind, bytes: row.stamp.bytes, digest: row.digest })) })
  equal('copied-input-closure', closure(a), closure(b))
  const first = (run: EngineeringComparisonRun) => {
    const input = run.preparedInputs[0]
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    // Session identity is the independent run locator. Every model-visible field remains in this comparison.
    return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'sessionId'))
  }
  equal('first-complete-model-input', first(a), first(b))
  equal('notebook-input', a.notebook, b.notebook); equal('cache-input', a.cache, b.cache)
  const reported = (run: EngineeringComparisonRun) => run.reportedModels?.length && run.reportedModels.every(row => row !== null)
    ? [...new Set(run.reportedModels.map(row => canonical(row)))].sort() : null
  equal('provider-reported-models', reported(a), reported(b))
  checks.push({ name: 'immutable-model-version', result: 'UNKNOWN' })
  const committed = (run: EngineeringComparisonRun) => run.status === 'COMPLETED' && run.receipts.length > 0
    && run.receipts.every(({ selection, view }) => view.phase === 'COMMITTED' && view.receipt?.runId === selection.runId
      && view.logAvailable && view.receipt.log.complete)
  const fresh = (run: EngineeringComparisonRun) => committed(run)
    ? run.receipts.some(row => row.view.receipt?.freshness === 'STALE') ? 'DIFFERENT'
      : run.receipts.every(row => row.view.receipt?.freshness === 'CURRENT') ? 'SAME' : 'UNKNOWN' : 'UNKNOWN'
  checks.push({ name: 'completed-turns-and-receipts', result: committed(a) && committed(b) ? 'SAME' : 'UNKNOWN' },
    { name: 'freshness-a', result: fresh(a) }, { name: 'freshness-b', result: fresh(b) })
  const receipts = [...a.receipts, ...b.receipts], accepted = committed(a) && committed(b) && a.id !== b.id
  const quality = !accepted ? 'UNKNOWN' : receipts.some(row => row.view.receipt?.acceptance === 'REJECTED') ? 'REJECTED'
    : receipts.every(row => row.view.receipt?.acceptance === 'ACCEPTED') ? 'BOTH_ACCEPTED' : 'UNKNOWN'
  const count = (run: EngineeringComparisonRun, key: string) => {
    const value = run.counts?.[key]
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  const counts = Object.fromEntries(['dispatches', 'providerWireRequests', 'inputTokens', 'outputTokens', 'cacheReadTokens',
    'toolCalls', 'actionAttempts'].map((key) => {
    const left = key === 'providerWireRequests' ? null : count(a, key), right = key === 'providerWireRequests' ? null : count(b, key)
    return [key, { a: left, b: right, missing: Number(left === null) + Number(right === null) }]
  }))
  const differences = checks.filter(row => row.result === 'DIFFERENT' && row.name !== `${factor}-input`)
  const resource = (run: EngineeringComparisonRun, key: string): number | null => {
    if (key === 'shellOutputBytes' || key === 'shellSpillBytes') {
      const shell = run.shell?.result
      if (!shell || shell.runs.some(row => row.stdout.bytes === null || row.stderr.bytes === null)) return null
      if (key === 'shellSpillBytes' && shell.diagnostic === 'EXPERIMENT_RESOURCE_SHELL_UNKNOWN') return null
      return shell.runs.reduce((sum, row) => sum + (key === 'shellOutputBytes'
        ? (row.stdout.bytes ?? 0) + (row.stderr.bytes ?? 0) : (row.stdout.spill?.bytes ?? 0) + (row.stderr.spill?.bytes ?? 0)), 0)
    }
    const checkpoints = run.resources?.result?.checkpoints
    if (!checkpoints || checkpoints.some(row => row.diagnostic !== null)) return null
    const drained = checkpoints.filter(row => row.phase === 'drained')
    if (key === 'workspaceBytes') return drained.find(row => row.workspace)?.workspace?.bytes ?? null
    if (key === 'sessionDiskBytes') return drained.find(row => row.session)?.session?.diskBytes ?? null
    if (key === 'sessionLogicalBytes') return drained.find(row => row.session)?.session?.bytes ?? null
    return null
  }
  const resourceCounts = Object.fromEntries(['workspaceBytes', 'sessionDiskBytes', 'sessionLogicalBytes', 'shellOutputBytes', 'shellSpillBytes', 'diskPeakBytes', 'memoryPeakBytes']
    .map((key) => { const left = resource(a, key), right = resource(b, key)
      return [key, { a: left, b: right, missing: Number(left === null) + Number(right === null) }] }))
  return { factor, a, b, checks, counts, countScope: 'owned-engineering-turn-prepared-calls',
    resourceCounts, resourceScope: 'drained-checkpoints-not-runtime-peaks',
    task: differences.length ? 'NOT_COMPARABLE' : 'UNKNOWN', quality, exactModelVersion: null, efficiencyEligible: false }
}
