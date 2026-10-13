import { expect, it } from 'vitest'
import { Capture, usageMetadata } from '../src/legacy/diagnostic-capture.mjs'
import { normalizeReport, summarize } from '../src/legacy/diagnostic-comparison.mjs'
import { ToolTelemetry } from '../src/legacy/diagnostic-tools.mjs'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

it('uses the three billing buckets and keeps an incompletely observed cache rate unknown', () => {
  const usage = usageMetadata({ inputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20, outputTokens: 4, totalTokens: 999 })
  expect(usage.aggregateInputTokens).toBe(100)
  expect(usage.cacheReporting).toBe('adapter-count-not-server-presence')
  const complete = { schemaVersion: 2, records: [{ usage }], tools: [] }
  expect(summarize(normalizeReport(complete)).cacheRate).toEqual({ value: 0.3, known: 1, total: 1 })
  const missing = usageMetadata({ inputTokens: 50, outputTokens: 4, totalTokens: 54 })
  expect(missing.aggregateInputTokens).toBeNull(); expect(missing.cacheReadTokens).toBeNull()
  expect(summarize(normalizeReport({ ...complete, records: [{ usage }, { usage: missing }] })).cacheRate)
    .toEqual({ value: null, known: 1, total: 2 })
  const zero = usageMetadata({ inputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 })
  expect(summarize(normalizeReport({ ...complete, records: [{ usage: zero }] })).cacheRate)
    .toEqual({ value: 0, known: 1, total: 1 })
})

it('marks unresolved tools unconfirmed at the recorded step boundary without inventing a result or duration', () => {
  const capture = new Capture({ key: Buffer.alloc(32, 7) }), tools = new ToolTelemetry(capture)
  const session = Session.create(SessionId('synthetic-tools'))
  tools.event(session, { type: 'tool/call', seq: 0, time: 100, data: { turn: 1, step: 1, callId: 'call', name: 'read', arguments: '{}' } } as SessionEvent)
  tools.event(session, { type: 'step/end', seq: 1, time: 200, data: { turn: 1, step: 1 } } as SessionEvent)
  expect(tools.rows).toEqual([expect.objectContaining({ status: 'unconfirmed' })])
  expect(tools.rows[0]).not.toHaveProperty('durationMs')
  const summary = summarize(normalizeReport({ schemaVersion: 2, records: [], tools: tools.rows }))
  expect(summary.toolGroups).toMatchObject({ read: { calls: 1, unsettled: 1, completed: 0, errors: 0 } })
})
