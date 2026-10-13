/** Engineering runs reserve per-request output limits before dispatch and stop on missing or failed settlements. */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { object } from '../connections/store.ts'

/** Independently confirmed limits; zero retries and one turn are enforced by the engineering runner. */
export interface EngineeringBudget {
  requests: number
  outputTokensPerRequest: number
  outputTokens: number
  toolCalls: number
  actions: number
  durationMs: number
}
/** Reject unrelated fields, unsafe integers and limits outside the independent engineering envelope.
 * @param input - Authenticated complete budget JSON; self-test and analysis budgets are never reused.
 * @returns Explicit limits with no hidden defaults or retry allowance.
 */
export function parseEngineeringBudget(input: unknown): EngineeringBudget {
  const row = object(input)
  if (Object.keys(row).length !== 6 || Object.keys(row).some(key => !['requests', 'outputTokensPerRequest',
    'outputTokens', 'toolCalls', 'actions', 'durationMs'].includes(key))) throw Error('EXPERIMENT_ENGINEERING_BUDGET_INVALID')
  const number = (key: string, max: number): number => {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
      throw Error('EXPERIMENT_ENGINEERING_BUDGET_INVALID')
    }
    return value
  }
  const budget = { requests: number('requests', 8), outputTokensPerRequest: number('outputTokensPerRequest', 8192),
    outputTokens: number('outputTokens', 65536), toolCalls: number('toolCalls', 16), actions: number('actions', 4),
    durationMs: number('durationMs', 180000) }
  if (budget.outputTokens < budget.outputTokensPerRequest || budget.actions > budget.toolCalls) {
    throw Error('EXPERIMENT_ENGINEERING_BUDGET_INVALID')
  }
  return budget
}

/** One controller accounts actual stream entries and reviewed action attempts; failed/unknown work never authorizes more. */
export class EngineeringBudgetOwner {
  private entries = 0
  private allocated = 0
  private tools = 0
  private readonly attemptedActions = new Set<string>()
  private inFlight = false
  private refusal: string | null = null
  private readonly usage: (TokenUsage | null)[] = []
  constructor(readonly budget: EngineeringBudget) {}
  /** Consume one request and its full output ceiling before the actual bound stream is entered.
   * @returns Remaining per-request limit; refusals leave counters unchanged and stop subsequent work.
   */
  dispatch(): number {
    this.checkDispatch()
    this.entries++; this.allocated += this.budget.outputTokensPerRequest; this.inFlight = true
    return this.budget.outputTokensPerRequest
  }
  /** Refuse an exhausted or overlapping dispatch before publishing another input cut; this consumes no request. */
  checkDispatch(): void {
    this.check()
    if (this.inFlight || this.entries >= this.budget.requests
      || this.allocated + this.budget.outputTokensPerRequest > this.budget.outputTokens) {
      this.stop('EXPERIMENT_ENGINEERING_BUDGET_EXHAUSTED'); this.check()
    }
  }
  /** Settle one stream entry with official usage; absent usage remains null and prevents subsequent dispatch/tools.
   * @param usage - Official final usage, never derived from wire prompt totals.
   * @param completed - Actual successful finish; error/abort/missing finish stops the run.
   */
  settle(usage: TokenUsage | null, completed: boolean): void {
    if (!this.inFlight) throw Error('EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
    this.inFlight = false; this.usage.push(usage)
    const output = usage?.outputTokens
    if (!completed) this.stop('EXPERIMENT_ENGINEERING_REQUEST_FAILED')
    else if (output === undefined || !Number.isSafeInteger(output) || output < 0) this.stop('EXPERIMENT_ENGINEERING_USAGE_MISSING')
    else if (output > this.budget.outputTokensPerRequest) this.stop('EXPERIMENT_ENGINEERING_OUTPUT_LIMIT')
  }
  /** Charge a tool-body entry once; an action ID may run at most once even if its prior outcome was unknown.
   * @param action - Reviewed action ID, or null for the read-only action-list tool.
   */
  tool(action: string | null): void {
    this.check()
    if (this.inFlight || this.tools >= this.budget.toolCalls || action !== null
      && (this.attemptedActions.has(action) || this.attemptedActions.size >= this.budget.actions)) {
      this.stop('EXPERIMENT_ENGINEERING_TOOL_BUDGET_EXHAUSTED'); this.check()
    }
    this.tools++; if (action !== null) this.attemptedActions.add(action)
  }
  /** Revoke subsequent requests/tool bodies without resetting any retained accounting.
   * @param diagnostic - Stable refusal from the owning runner.
   */
  stop(diagnostic: string): void { this.refusal ??= diagnostic }
  /** Refuse work after the first failure/unknown settlement, including direct alternate tool callers. */
  check(): void { if (this.refusal) throw Error(this.refusal) }
  /** Project official counters, retaining each missing value and separating dispatches from provider wire calls.
   * @returns Snapshot; allocated output ceilings are budgets, never measured usage.
   */
  snapshot() {
    const total = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens'): number | null => {
      let sum = 0
      if (this.inFlight || this.usage.length !== this.entries) return null
      for (const usage of this.usage) {
        const value = usage?.[key]
        if (value === undefined || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) return null
        sum += value
      }
      return sum
    }
    return { dispatches: this.entries, providerWireRequests: null, allocatedOutputTokens: this.allocated,
      toolCalls: this.tools, actionAttempts: this.attemptedActions.size, diagnostic: this.refusal,
      inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), cacheReadTokens: total('cacheReadTokens') }
  }
}
