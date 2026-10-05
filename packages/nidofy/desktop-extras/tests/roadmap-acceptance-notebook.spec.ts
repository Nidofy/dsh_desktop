/** T25 independent acceptance: retirement-capacity behavior of the Notebook v1 store.
 * Characterizes present behavior against migration/roadmap/contracts-v1.md §Notebook 活动投影与双游标;
 * requirement gaps are recorded in migration/roadmap/handoffs/T25.md, not silently asserted as satisfied. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { applyNotebookDelta, emptyNotebook, NotebookStore } from '../src/notebook.ts'

const events: SessionEvent[] = [{ type: 'user/message', seq: SessionSeq(0), time: 1, data: createUserMessage({ content: [{ type: 'text', text: 'T25 capacity source. Keep the official engine. Retirement evidence sentence.' }], source: { kind: 'user' } }), surfaceOp: 'append' }]
const add = (id: string, text: string) => ({ action: 'ADD', id, kind: 'next', text, seq: 0, quote: 'Keep the official engine' }) as const

it('retired notes still consume the active entry budget after restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 't25-notes-entries-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookStore(home, { maxEntries: 3, maxBytes: 65536 })
  const filled = await store.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('n1', 'first'), add('n2', 'second'), add('n3', 'third')] }, events, 'user')
  expect(filled.entries).toHaveLength(3)
  const retired = await store.update('session', { baseRevision: 1, sourceThrough: 0, operations: [{ action: 'REMOVE', id: 'n1' }] }, events, 'user')
  expect(retired.entries.find(row => row.id === 'n1')).toMatchObject({ active: false, text: 'first', quote: 'Keep the official engine' })
  await store.close()
  const reopened = new NotebookStore(home, { maxEntries: 3, maxBytes: 65536 })
  const state = await reopened.read('session')
  expect(state.entries).toHaveLength(3)
  // Present behavior: only 2 entries are active, yet a new ADD still exceeds the budget.
  await expect(reopened.update('session', { baseRevision: 2, sourceThrough: 0, operations: [add('n4', 'fourth')] }, events, 'user')).rejects.toThrow('NOTEBOOK_BUDGET_EXCEEDED')
  await reopened.close()
})

it('retired bytes stay counted in the serialized snapshot budget', async () => {
  const home = await mkdtemp(join(tmpdir(), 't25-notes-bytes-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const limits = { maxEntries: 64, maxBytes: 900 }
  const store = new NotebookStore(home, limits)
  const big = await store.update('session', { baseRevision: 0, sourceThrough: 0, operations: [add('bulk', 'b'.repeat(500))] }, events, 'user')
  expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThanOrEqual(900)
  await store.update('session', { baseRevision: 1, sourceThrough: 0, operations: [{ action: 'REMOVE', id: 'bulk' }] }, events, 'user')
  await store.close()
  const state = await new NotebookStore(home, limits).read('session')
  expect(state.entries.find(row => row.id === 'bulk')?.active).toBe(false)
  // Present behavior: the retired entry's bytes still occupy the budget, so fresh notes do not fit.
  expect(() => applyNotebookDelta(state, { baseRevision: 2, sourceThrough: 0, operations: [add('small', 'c'.repeat(120))] }, events, 'user', limits)).toThrow('NOTEBOOK_BUDGET_EXCEEDED')
})

it('never reuses a retired id and restores a retired entry only through an explicit UPDATE', async () => {
  const limits = { maxEntries: 64, maxBytes: 65536 }
  const first = applyNotebookDelta(emptyNotebook('session'), { baseRevision: 0, sourceThrough: 0, operations: [add('alpha', 'original')] }, events, 'user', limits)
  const retired = applyNotebookDelta(first, { baseRevision: 1, sourceThrough: 0, operations: [{ action: 'REMOVE', id: 'alpha' }] }, events, 'user', limits)
  expect(() => applyNotebookDelta(retired, { baseRevision: 2, sourceThrough: 0, operations: [add('alpha', 'replacement')] }, events, 'user', limits)).toThrow('NOTEBOOK_ENTRY_CONFLICT')
  const restored = applyNotebookDelta(retired, { baseRevision: 2, sourceThrough: 0, operations: [{ action: 'UPDATE', id: 'alpha', kind: 'next', text: 'explicitly restored', seq: 0, quote: 'Keep the official engine', expectedRevision: 2 }] }, events, 'user', limits)
  expect(restored.entries.find(row => row.id === 'alpha')).toMatchObject({ active: true, text: 'explicitly restored', revision: 3 })
})
