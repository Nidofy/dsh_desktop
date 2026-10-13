import { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'
/** Complete UTF-8 budgets and ordered-prefix selection, independent of R's pending runtime wiring. */
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { NotebookBudgets, NotebookV2 } from '../src/notebook.ts'
import { notebookActiveInput, selectNotebookEvidence, validateNotebookCandidate } from '../src/notebook-evidence.ts'

const budgets: NotebookBudgets = { maxActiveEntries: 8, maxActiveBytes: 4096,
  maxEvidenceBytes: 4096, maxDeltaBytes: 4096, maxHistoryBytes: 65536 }
const previous: NotebookV2 = { schemaVersion: 2, scope: { sessionId: 'budget', generation: SessionPersistenceGeneration('test-file-7') }, revision: 0,
  active: [], cursors: { evidenceThrough: -1, commitThrough: -1 }, historyRevision: 0 }
const event = (body: string, seq: number): SessionEvent<'user/message'> => ({ type: 'user/message', seq: SessionSeq(seq), time: seq + 1,
  data: createUserMessage({ content: [{ type: 'text', text: body }], source: { kind: 'user' } }),
  surfaceOp: 'append' })
const candidate = (plan: ReturnType<typeof selectNotebookEvidence>, operations: unknown[] = []) => ({
  schemaVersion: 2, scope: plan.previous.scope,
  baseRevision: plan.previous.revision, policyRevision: plan.policyRevision, evidenceThrough: plan.evidenceThrough, operations })

it('counts the complete active wrapper at exact Chinese UTF-8 limits', () => {
  const projection = { scope: previous.scope, revision: 0, entries: [] }
  const body = notebookActiveInput(projection, budgets), size = Buffer.byteLength(body)
  expect(notebookActiveInput(projection, { ...budgets, maxActiveBytes: size })).toBe(body)
  expect(() => notebookActiveInput(projection, { ...budgets, maxActiveBytes: size - 1 })).toThrow('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
})
it('selects the same complete prefix under the same budget and retains the first unread event', () => {
  const events = [event('完整中文证据，测试尚未验证。', 0), event('第二条中文证据。'.repeat(100), 1), event('small later event', 2)]
  const one = selectNotebookEvidence(previous, events.slice(0, 1), 4, budgets)
  const bound = { ...budgets, maxEvidenceBytes: one.evidenceBytes }
  const plan = selectNotebookEvidence(previous, events, 4, bound)
  expect(plan).toEqual(selectNotebookEvidence(previous, events, 4, bound))
  expect(plan.sources).toEqual([{ seq: 0, excerpt: '完整中文证据，测试尚未验证。' }])
  expect(plan.evidenceThrough).toBe(0)
  expect(plan.blockedSeq).toBe(1)
  expect(plan.evidenceBytes).toBe(bound.maxEvidenceBytes)
  expect(plan.inputBytes).toBeLessThanOrEqual(bound.maxEvidenceBytes + bound.maxActiveBytes)
})
it('does not truncate an oversized single event or jump to a later short event', () => {
  const tool: SessionEvent<'tool/result'> = { type: 'tool/result', seq: SessionSeq(0), time: 1, data: {
    turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('large-result'),
      content: [{ type: 'text', text: '工具大结果中文'.repeat(5000) }], isError: false }),
  }, surfaceOp: 'append' }
  const plan = selectNotebookEvidence(previous, [tool, event('later', 1)], 0, budgets)
  expect(plan.outcome).toBe('budget-skipped')
  expect(plan.evidenceThrough).toBe(-1)
  expect(plan.blockedSeq).toBe(0)
  expect(plan.sources).toEqual([])
})
it('pins the complete model-visible v2 directive, state, selected evidence and JSON wrapping', () => {
  const plan = selectNotebookEvidence(previous, [event('中文原文：尚未验证。', 0)], 2, budgets)
  expect(plan.instruction).toMatchSnapshot('complete v2 appendix')
})
it('counts inherited appendix text, serialized old notes and instructions in the evidence budget', () => {
  const events = [event('new evidence', 0)]
  const plan = selectNotebookEvidence(previous, events, 0, budgets)
  expect(selectNotebookEvidence(previous, events, 0, { ...budgets, maxEvidenceBytes: plan.evidenceBytes }, 'existing instruction').outcome).toBe('budget-skipped')
  expect(selectNotebookEvidence(previous, events, 0, { ...budgets, maxEvidenceBytes: 0 }).instruction).toBe('')
  expect(selectNotebookEvidence(previous, [], 0, { ...budgets, maxEvidenceBytes: 0 }).outcome).toBe('budget-skipped')
})
it('still admits bounded new evidence when the old active notebook is near its separate limit', () => {
  const state = { ...previous, active: [{ id: 'old', kind: 'constraint' as const, text: '长中文笔记'.repeat(120),
    seq: 0, quote: 'source', pinned: false, active: true, revision: 0 }] }
  const projection = { scope: state.scope, revision: state.revision, entries: state.active }
  const bounds = { ...budgets, maxActiveBytes: Buffer.byteLength(notebookActiveInput(projection, budgets)), maxEvidenceBytes: 1500 }
  const plan = selectNotebookEvidence(state, [event('new source evidence', 0)], 0, bounds)
  expect(plan.outcome).toBe('selected')
  expect(plan.activeBytes).toBe(bounds.maxActiveBytes)
  expect(plan.evidenceBytes).toBeLessThanOrEqual(bounds.maxEvidenceBytes)
  expect(plan.inputBytes).toBeLessThanOrEqual(bounds.maxActiveBytes + bounds.maxEvidenceBytes)
})
it('examines non-evidence events but never recycles an injected notebook or checkpoint as original evidence', () => {
  const injected = { ...event('injected notes', 0), data: createUserMessage({ content: [{ type: 'text', text: 'injected notes' }], source: { kind: 'system-prompt' } }) }
  const plan = selectNotebookEvidence(previous, [injected], 0, budgets)
  expect(plan.outcome).toBe('no-new-evidence')
  expect(plan.sources).toEqual([])
  expect(plan.evidenceThrough).toBe(0)
  expect(previous.cursors).toEqual({ evidenceThrough: -1, commitThrough: -1 })
})
it('rejects a quote from an event outside the exact selected model input', () => {
  const events = [event('first selected', 0), event('unseen later quote'.repeat(500), 1)]
  const plan = selectNotebookEvidence(previous, events, 0, budgets)
  const op = { action: 'ADD', id: 'new', kind: 'next', text: 'unseen', seq: 1, quote: 'unseen later quote' }
  expect(() => validateNotebookCandidate(candidate(plan, [op]), plan, events, budgets)).toThrow('NOTEBOOK_EVIDENCE_MISMATCH')
})
it('counts the delta envelope and tag wrappers, independent of evidence and disk quotas', () => {
  const events = [event('source', 0)], plan = selectNotebookEvidence(previous, events, 0, budgets)
  const delta = candidate(plan), bytes = Buffer.byteLength('<nidofy-notebook-delta>' + JSON.stringify(delta) + '</nidofy-notebook-delta>')
  expect(validateNotebookCandidate(delta, plan, events, { ...budgets, maxDeltaBytes: bytes })).toEqual([])
  expect(() => validateNotebookCandidate(delta, plan, events, { ...budgets, maxDeltaBytes: bytes - 1 })).toThrow('NOTEBOOK_DELTA_BUDGET_EXCEEDED')
})
it('bounds the resulting active injection and permits retirement to release active capacity', () => {
  const events = [event('source', 0)], initial = selectNotebookEvidence(previous, events, 0, budgets)
  const add = { action: 'ADD', id: 'new', kind: 'next', text: '中文'.repeat(100), seq: 0, quote: 'source' }
  expect(() => validateNotebookCandidate(candidate(initial, [add]), initial, events,
    { ...budgets, maxActiveBytes: 420 })).toThrow('NOTEBOOK_ACTIVE_BUDGET_EXCEEDED')
  const old = { ...previous, active: [{ id: add.id, kind: 'next' as const, text: add.text, seq: 0, quote: 'source', pinned: false, active: true, revision: 0 }] }
  const plan = selectNotebookEvidence(old, events, 0, budgets)
  expect(validateNotebookCandidate(candidate(plan, [{ action: 'REMOVE', id: 'new' }]), plan, events, { ...budgets, maxActiveEntries: 1 })).toHaveLength(1)
})
it('refuses non-contiguous original logs and model-selected scope, policy or evidence cursors', () => {
  expect(() => selectNotebookEvidence(previous, [event('gap', 1)], 0, budgets)).toThrow('NOTEBOOK_NONCONTIGUOUS_EVENTS')
  const events = [event('source', 0)], plan = selectNotebookEvidence(previous, events, 0, budgets)
  for (const delta of [{ ...candidate(plan), scope: { ...previous.scope, generation: SessionPersistenceGeneration('test-file-8') } },
    { ...candidate(plan), policyRevision: 1 }, { ...candidate(plan), evidenceThrough: 2 }]) {
    expect(() => validateNotebookCandidate(delta, plan, events, budgets)).toThrow('NOTEBOOK_INVALID_CANDIDATE')
  }
})
