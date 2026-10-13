import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { serializeSessionLog } from '../packages/session-query/session-log-export/src/archive.ts'
import { analyzeSessionPerformance } from './analyze-session-performance.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const header = { type: 'session', version: 4, id: 'PRIVATE_SESSION', createdAt: 0, isSeeded: false, delegationDepth: 0 }
const packed = (type = 'text-chunks', time0 = 150, texts = ['hi'], dt: number[] = []) => ({ type, index: 0, time0, texts, dt })
const event = (type: string, time: number, data: Record<string, unknown>) => ({ type, time, data })
const start = (time = 100) => event('step/start', time, { turn: 1, step: 1 })
const end = (time = 400) => event('step/end', time, { turn: 1, step: 1 })
const assistant = (stream: unknown[], time = 300, extra: Record<string, unknown> = {}) => event('assistant/message', time, { turn: 1, step: 1, stream, usage: { inputTokens: 100, outputTokens: 20 }, ...extra })
const call = (id: string, time: number) => event('tool/call', time, { turn: 1, step: 1, callId: id, name: 'PRIVATE_TOOL', arguments: '{"secret":"PRIVATE_ARGUMENT"}' })
const result = (id: string, time: number) => event('tool/result', time, { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: id }, content: [{ type: 'text', text: 'PRIVATE_RESULT' }] } })
function lines(events: ReturnType<typeof event>[], customHeader: unknown = header) {
  return [JSON.stringify(customHeader), ...events.map((item, seq) => JSON.stringify({ ...item, seq }))]
}
const analyze = (events: ReturnType<typeof event>[]) => analyzeSessionPerformance(lines(events))

describe('offline Session performance analysis', () => {
  it('distinguishes model time, decode, packed empty deltas and character counts', async () => {
    const report = await analyze([start(), assistant([packed('reasoning-chunks', 120, ['', '考'], [30]), packed('text-chunks', 200, ['ok'])]), end()])
    expect(report.model.sum).toBe(200)
    expect(report.ttft.mean).toBe(50)
    expect(report.decode.sum).toBe(150)
    expect(report.tokensPerSecond).toBeCloseTo(20 / .15)
    expect(report.perStep[0]).toMatchObject({ firstReasoningMs: 50, firstTextMs: 100, reasoningUtf16Units: 1, textUtf16Units: 2 })
    expect(report.usageCoverage).toMatchObject({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 })
  })

  it('counts a name-only tool delta as the first token and does not invent text tokens', async () => {
    const report = await analyze([start(), assistant([{ type: 'tool-call-chunks', time0: 130, index: 0, id: 'PRIVATE_CALL', name: 'lookup', args: [''], dt: [] }]), end()])
    expect(report.ttft.sum).toBe(30)
    expect(report.perStep[0]).toMatchObject({ textUtf16Units: 0, reasoningUtf16Units: 0, firstTextMs: null })
  })

  it('retains the first attempt token across retries and excludes discarded usage estimates', async () => {
    const report = await analyze([
      start(), event('assistant/attempt', 160, { turn: 1, step: 1, stream: [packed('reasoning-chunks', 120, ['discarded'])] }),
      event('llm/retry', 170, {}), assistant([packed('text-chunks', 220, ['done'])]), end(),
    ])
    expect(report.ttft.sum).toBe(20)
    expect(report.perStep[0]).toMatchObject({ attempts: 2, retries: 1, discardedReasoningUtf16Units: 9, textUtf16Units: 4 })
    expect(report.usageTotals.outputTokens).toBe(20)
  })

  it('separates overlapping tool sum/union and ignores result replacements', async () => {
    const report = await analyze([start(), assistant([], 150), call('a', 200), call('b', 200), result('a', 1200), result('b', 1200), result('a', 1300), end(1400)])
    expect(report.tools).toMatchObject({
      calls: 2, matchedIntervals: 2, intervalSumMs: 2000, intervalUnionMs: 1000,
      stepsWithMultipleCalls: 1, unmatchedResults: 1, incompleteCalls: 0,
    })
    expect(report.perStep[0]?.toolAliases).toEqual(['tool-1', 'tool-1'])
    expect(JSON.stringify(report)).not.toContain('PRIVATE')
  })

  it('reports missing tokens, empty streams, unsettled steps and abandoned calls honestly', async () => {
    const report = await analyze([
      start(), assistant([], 200, { usage: undefined }), call('a', 250), end(),
      event('turn/end', 450, { turn: 1 }), event('step/start', 500, { turn: 2, step: 1 }),
    ])
    expect(report).toMatchObject({ steps: 2, closedSteps: 1, settledSteps: 1, tokensPerSecond: null, usageTotals: {} })
    expect(report.ttft.count).toBe(0)
    expect(report.tools.incompleteCalls).toBe(1)
  })

  it('admits signed packed gaps but exposes reversed clocks instead of clamping them', async () => {
    const report = await analyze([start(), assistant([packed('text-chunks', 110, ['', 'late'], [-30])]), end(250)])
    expect(report.ttft.count).toBe(0)
    expect(report.eventSpanMs).toBeNull()
    expect(report.anomalies).toMatchObject({ backwardEventTimes: 1, backwardStreamTimes: 1, invalidIntervals: 2 })
  })

  it('does not count duplicate settled messages or plugin payloads as new model work', async () => {
    const report = await analyze([start(), assistant([packed()]), assistant([packed()], 350), event('PRIVATE_EVENT', 360, { secret: 'PRIVATE_DATA' }), end()])
    expect(report.model.count).toBe(1)
    expect(report.anomalies.duplicateSettledMessages).toBe(1)
    expect(report.ignoredEvents).toBe(1)
    expect(JSON.stringify(report)).not.toContain('PRIVATE')
  })

  it.each([
    ['old header', [JSON.stringify({ ...header, version: 3 })]],
    ['normalized events', [JSON.stringify(header), JSON.stringify({ type: 'step/start', data: { turn: 1, step: 1 } })]],
    ['missing timestamp', [JSON.stringify(header), JSON.stringify({ ...start(), time: undefined, seq: 0 })]],
    ['sequence gap', [JSON.stringify(header), JSON.stringify({ ...start(), seq: 1 })]],
    ['broken last line', [JSON.stringify(header), '{"PRIVATE_SECRET"']],
    ['ZIP', ['PK\u0003\u0004PRIVATE_SECRET']],
    ['bad packed gaps', lines([start(), assistant([packed('text-chunks', 150, ['a', 'b'], [])])])],
    ['bad usage', lines([start(), assistant([], 300, { usage: { outputTokens: -1 } })])],
    ['unmatched end', lines([end()])],
  ])('rejects %s with a sanitized actionable error', async (_name, input) => {
    try { await analyzeSessionPerformance(input); expect.fail('input accepted') }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('session.v4.jsonl')
      expect((error as Error).message).not.toContain('PRIVATE_SECRET')
    }
  })

  it('accepts the production export serializer including the original event clocks', async () => {
    const events: SessionEvent[] = [
      { type: 'step/start', seq: SessionSeq(0), time: 100, data: { turn: 1, step: 1 } },
      { type: 'step/end', seq: SessionSeq(1), time: 200, data: { turn: 1, step: 1 } },
    ]
    const exported = serializeSessionLog({ version: 4, id: SessionId('PRIVATE_SESSION'), createdAt: 0, isSeeded: false }, events)
    expect(await analyzeSessionPerformance(exported.split('\n'))).toMatchObject({ events: 2, closedSteps: 1, eventSpanMs: 100 })
  })

  it('runs the real read-only CLI on an explicit export and emits no private values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-performance-test-'))
    try {
      const path = join(directory, 'PRIVATE_PATH.v4.jsonl')
      const source = lines([start(), assistant([packed('text-chunks', 120, ['PRIVATE_CONTENT'])]), end()]).join('\n') + '\n'
      await writeFile(path, source)
      const child = await execa(process.execPath, ['--import', 'tsx', resolve('scripts/analyze-session-performance.ts'), path], { reject: false, timeout: 30_000 })
      expect(child.timedOut).toBe(false)
      expect(child.signal).toBeUndefined()
      expect(child.exitCode, child.stderr).toBe(0)
      expect(JSON.parse(child.stdout)).toMatchObject({ settledSteps: 1 })
      expect(child.stdout).not.toContain('PRIVATE')
      expect(child.stderr).toBe('')
      expect(await readFile(path, 'utf8')).toBe(source)
      const missing = await execa(process.execPath, ['--import', 'tsx', resolve('scripts/analyze-session-performance.ts'), join(directory, 'PRIVATE_MISSING')], { reject: false, timeout: 30_000 })
      expect(missing.timedOut).toBe(false)
      expect(missing.signal).toBeUndefined()
      expect(missing.exitCode).toBe(1)
      expect(missing.stderr).not.toContain('PRIVATE')
    } finally { removeFixtureSafely(directory) }
  })
})


it('computes decode throughput only where output usage and duration are both present', async () => {
  const missing = await analyze([start(), assistant([packed()], 300, { usage: undefined }), end()])
  expect(missing).toMatchObject({ tokensPerSecond: null, tokensPerSecondCoverage: { steps: 0, decodeMs: 0 } })
  const partial = await analyze([start(), assistant([packed()], 300, { usage: undefined }), end(),
    event('step/start', 500, { turn: 2, step: 1 }),
    event('assistant/message', 800, { turn: 2, step: 1, stream: [packed('text-chunks', 600)], usage: { outputTokens: 20 } }),
    event('step/end', 900, { turn: 2, step: 1 })])
  expect(partial.decode.sum).toBe(350)
  expect(partial).toMatchObject({ tokensPerSecond: 100, decodeTokens: 20,
    tokensPerSecondCoverage: { steps: 1, decodeMs: 200 }, usageCoverage: { outputTokens: 1 } })
  const zero = await analyze([start(), assistant([packed()], 300, { usage: { outputTokens: 0 } }), end()])
  expect(zero).toMatchObject({ tokensPerSecond: 0, tokensPerSecondCoverage: { steps: 1, decodeMs: 150 } })
})
