/** Independent engineering limits stop missing settlements and repeated action bodies without dispatching any model. */
import { describe, expect, it } from 'vitest'
import { EngineeringBudgetOwner, parseEngineeringBudget } from '../src/experiments/engineering-budget.ts'
const budget = { requests: 2, outputTokensPerRequest: 64, outputTokens: 128, toolCalls: 3, actions: 2, durationMs: 1000 }
describe('independent engineering budget', () => {
  it('requires complete explicit limits and refuses excess, fractions and retry fields', () => {
    expect(parseEngineeringBudget(budget)).toEqual(budget)
    for (const invalid of [{ ...budget, retries: 0 }, { ...budget, requests: 9 }, { ...budget, outputTokens: 63 },
      { ...budget, actions: 4 }, { ...budget, toolCalls: 0 }, { ...budget, requests: 1.5 }, { ...budget, durationMs: 180001 }]) {
      expect(() => parseEngineeringBudget(invalid)).toThrow('EXPERIMENT_ENGINEERING_BUDGET_INVALID')
    }
  })
  it('allocates the full requested ceiling and refuses another entry after exhaustion', () => {
    const owner = new EngineeringBudgetOwner(parseEngineeringBudget({ ...budget, outputTokens: 64 }))
    expect(owner.dispatch()).toBe(64); owner.settle({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, true)
    expect(owner.snapshot()).toMatchObject({ dispatches: 1, allocatedOutputTokens: 64, outputTokens: 0, cacheReadTokens: 0,
      providerWireRequests: null })
    expect(() => owner.dispatch()).toThrow('EXPERIMENT_ENGINEERING_BUDGET_EXHAUSTED')
    expect(owner.snapshot().dispatches).toBe(1)
  })
  it('retains missing values and refuses more work after an unknown or failed settlement', () => {
    for (const usage of [null, { inputTokens: 0, outputTokens: 65 }]) {
      const owner = new EngineeringBudgetOwner(budget)
      owner.dispatch(); owner.settle(usage, true)
      expect(owner.snapshot().cacheReadTokens).toBeNull()
      expect(() => { owner.tool('case') }).toThrow(); expect(() => owner.dispatch()).toThrow()
    }
    const failed = new EngineeringBudgetOwner(budget)
    failed.dispatch(); failed.settle({ inputTokens: 1, outputTokens: 1 }, false)
    expect(() => failed.dispatch()).toThrow('EXPERIMENT_ENGINEERING_REQUEST_FAILED')
  })
  it('charges tools only at body entry and refuses a repeated reviewed action even with remaining capacity', () => {
    const owner = new EngineeringBudgetOwner(budget)
    owner.dispatch(); owner.settle({ inputTokens: 1, outputTokens: 1 }, true)
    owner.tool(null); owner.tool('case')
    expect(() => { owner.tool('case') }).toThrow('EXPERIMENT_ENGINEERING_TOOL_BUDGET_EXHAUSTED')
    expect(owner.snapshot()).toMatchObject({ actionAttempts: 1, toolCalls: 2 })
  })
  it('leaves in-flight usage unknown and prevents overlapping entries', () => {
    const owner = new EngineeringBudgetOwner(budget)
    owner.dispatch(); expect(owner.snapshot().outputTokens).toBeNull()
    expect(() => owner.dispatch()).toThrow('EXPERIMENT_ENGINEERING_BUDGET_EXHAUSTED')
    expect(owner.snapshot().dispatches).toBe(1)
  })
})
