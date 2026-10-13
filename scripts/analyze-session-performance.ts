/** Read-only, metrics-only analysis of one extracted current-generation Session export. */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expandAssistantStream, isTokenDelta } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'

type ObjectValue = Record<string, unknown>
interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
interface Step {
  turn: number
  step: number
  closed: boolean
  settled: boolean
  attempts: number
  retries: number
  tools: number
  toolAliases: string[]
  toolArgumentBytes: number
  toolResultBytes: number
  modelMs: number | null
  ttftMs: number | null
  firstTextMs: number | null
  firstReasoningMs: number | null
  decodeMs: number | null
  usage: Usage | null
  textUtf16Units: number
  reasoningUtf16Units: number
  discardedTextUtf16Units: number
  discardedReasoningUtf16Units: number
}
interface OpenStep {
  report: Step
  start: number
  first: number | null
  text: number | null
  reasoning: number | null
}

/** Fixed diagnostics never include input values, JSON snippets, or file paths. */
export class PerformanceInputError extends Error {
  constructor(line: number, reason: string) {
    super(`Line ${line}: ${reason}. Use an extracted session.v4.jsonl from Download session log or /export.`)
    this.name = 'PerformanceInputError'
  }
}
function object(value: unknown, line: number): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PerformanceInputError(line, 'Expected an object')
  return value as ObjectValue
}
function integer(value: unknown, line: number, nonnegative = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (nonnegative && value < 0)) throw new PerformanceInputError(line, 'Missing or invalid integer')
  return value
}
function string(value: unknown, line: number): string {
  if (typeof value !== 'string') throw new PerformanceInputError(line, 'Missing or invalid string')
  return value
}
function usage(value: unknown, line: number): Usage | null {
  if (value === undefined) return null
  const source = object(value, line), result: Usage = {}
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (source[key] !== undefined) result[key] = integer(source[key], line)
  }
  return result
}
function streamSummary(value: unknown, line: number) {
  if (!Array.isArray(value)) throw new PerformanceInputError(line, 'Missing assistant stream')
  let chunks
  try { chunks = expandAssistantStream(value as AssistantStreamRecord[]) }
  catch { throw new PerformanceInputError(line, 'Invalid packed assistant stream') }
  let first: number | null = null, text: number | null = null, reasoning: number | null = null
  let textUnits = 0, reasoningUnits = 0, backwards = 0, previous: number | undefined
  for (const { time, chunk } of chunks) {
    if (previous !== undefined && time < previous) backwards++
    previous = time
    if (first === null && isTokenDelta(chunk)) first = time
    if (chunk.type === 'text-delta') {
      textUnits += chunk.text.length
      if (text === null && chunk.text !== '') text = time
    } else if (chunk.type === 'reasoning-delta') {
      reasoningUnits += chunk.text.length
      if (reasoning === null && chunk.text !== '') reasoning = time
    }
  }
  return { first, text, reasoning, textUnits, reasoningUnits, backwards }
}
function unionMs(intervals: Array<[number, number]>): number {
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [start, stop] of intervals) {
    total += Math.max(0, stop - Math.max(start, end))
    end = Math.max(end, stop)
  }
  return total
}
function summarize(values: number[]) {
  if (values.length === 0) return { count: 0, sum: 0, mean: null, p50: null, p95: null }
  values.sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  return {
    count: values.length, sum, mean: sum / values.length,
    p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1],
  }
}

/**
 * Analyze JSONL without emitting content, route names, tool names, ids or paths.
 * Only the envelope and measured fields are admitted; unrelated plugin data is ignored.
 * @param lines - decoded lines from exactly one exported v4 Session.
 * @returns aggregate and per-step metrics, with explicit incomplete/invalid coverage.
 */
export async function analyzeSessionPerformance(lines: AsyncIterable<string> | Iterable<string>) {
  let line = 0, seq = 0, headerSeen = false, events = 0, previousTime: number | null = null
  let firstTime: number | null = null, lastTime: number | null = null, unknownEvents = 0
  let backwardEventTimes = 0, backwardStreamTimes = 0, invalidIntervals = 0, unmatchedResults = 0, abandonedCalls = 0
  let orphanAssistantEvents = 0, duplicateSettledMessages = 0, retryEvents = 0, compactions = 0
  let toolCalls = 0, orphanToolCalls = 0
  let open: OpenStep | null = null
  const steps: Step[] = [], closedTurns = new Set<number>(), aliases = new Map<string, string>()
  const pending = new Map<string, { start: number; step: Step | null }>()
  const intervals: Array<[number, number]> = []
  const diff = (start: number, end: number): number | null => {
    const delta = end - start
    if (!Number.isSafeInteger(delta) || delta < 0) { invalidIntervals++; return null }
    return delta
  }
  for await (const raw of lines) {
    line++
    // readline removes the final newline; a final empty split member is also harmless.
    if (raw.trim() === '') continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new PerformanceInputError(line, 'Invalid JSON or compressed input') }
    const event = object(parsed, line)
    if (!headerSeen) {
      if (event.type !== 'session' || event.version !== 4) throw new PerformanceInputError(line, 'Expected a v4 session header')
      string(event.id, line); integer(event.createdAt, line)
      if (typeof event.isSeeded !== 'boolean') throw new PerformanceInputError(line, 'Missing isSeeded header field')
      integer(event.delegationDepth, line)
      headerSeen = true
      continue
    }
    const type = string(event.type, line)
    if (integer(event.seq, line) !== seq++) throw new PerformanceInputError(line, 'Event sequence must start at zero and remain contiguous')
    const time = integer(event.time, line, false), data = object(event.data, line)
    events++
    if (previousTime !== null && time < previousTime) backwardEventTimes++
    previousTime = time
    firstTime ??= time; lastTime = time
    const matchingStep = () => {
      const turn = integer(data.turn, line), step = integer(data.step, line)
      return open?.report.turn === turn && open.report.step === step ? open : null
    }
    switch (type) {
      case 'step/start': {
        if (open !== null) throw new PerformanceInputError(line, 'Overlapping step/start')
        const report: Step = {
          turn: integer(data.turn, line), step: integer(data.step, line), closed: false, settled: false,
          attempts: 0, retries: 0, tools: 0, toolAliases: [], toolArgumentBytes: 0, toolResultBytes: 0,
          modelMs: null, ttftMs: null, firstTextMs: null, firstReasoningMs: null, decodeMs: null, usage: null,
          textUtf16Units: 0, reasoningUtf16Units: 0, discardedTextUtf16Units: 0, discardedReasoningUtf16Units: 0,
        }
        steps.push(report); open = { report, start: time, first: null, text: null, reasoning: null }
        break
      }
      case 'assistant/attempt':
      case 'assistant/message': {
        const current = matchingStep()
        const stream = streamSummary(data.stream, line)
        backwardStreamTimes += stream.backwards
        if (current === null) { orphanAssistantEvents++; break }
        const row = current.report
        if (row.settled) { duplicateSettledMessages++; break }
        row.attempts++
        current.first ??= stream.first; current.text ??= stream.text; current.reasoning ??= stream.reasoning
        if (type === 'assistant/attempt') {
          row.discardedTextUtf16Units += stream.textUnits; row.discardedReasoningUtf16Units += stream.reasoningUnits
          break
        }
        row.settled = true
        row.usage = usage(data.usage, line)
        row.textUtf16Units = stream.textUnits; row.reasoningUtf16Units = stream.reasoningUnits
        row.modelMs = diff(current.start, time)
        // Unlike the UI's clamping, anomalies remain null and are counted.
        if (current.first !== null) {
          if (current.first > time) invalidIntervals++
          else row.ttftMs = diff(current.start, current.first)
          if (row.ttftMs !== null) row.decodeMs = diff(current.first, time)
        }
        if (current.text !== null && current.text <= time) row.firstTextMs = diff(current.start, current.text)
        if (current.reasoning !== null && current.reasoning <= time) row.firstReasoningMs = diff(current.start, current.reasoning)
        break
      }
      case 'llm/retry':
        retryEvents++; if (open !== null) open.report.retries++
        break
      case 'step/end': {
        const current = matchingStep()
        if (current === null || current.report.closed) throw new PerformanceInputError(line, 'Unmatched or duplicate step/end')
        current.report.closed = true; closedTurns.add(current.report.turn); open = null
        break
      }
      case 'tool/call': {
        toolCalls++
        const id = string(data.callId, line), name = string(data.name, line)
        if (pending.has(id)) throw new PerformanceInputError(line, 'Duplicate pending tool call')
        const current = matchingStep()
        if (current === null) orphanToolCalls++
        let alias = aliases.get(name)
        if (alias === undefined) { alias = `tool-${aliases.size + 1}`; aliases.set(name, alias) }
        if (current !== null) {
          current.report.tools++
          current.report.toolAliases.push(alias)
          current.report.toolArgumentBytes += Buffer.byteLength(string(data.arguments, line))
        }
        pending.set(id, { start: time, step: current?.report ?? null })
        break
      }
      case 'tool/result': {
        const message = object(data.message, line), source = object(message.source, line)
        const id = string(source.callId, line), call = pending.get(id)
        if (call === undefined) { unmatchedResults++; break } // Includes durable result replacements.
        pending.delete(id)
        const elapsed = diff(call.start, time)
        if (elapsed !== null) intervals.push([call.start, time])
        if (!Array.isArray(message.content)) throw new PerformanceInputError(line, 'Missing tool result content')
        if (call.step !== null) call.step.toolResultBytes += Buffer.byteLength(JSON.stringify(message.content))
        break
      }
      case 'turn/end':
        abandonedCalls += pending.size; pending.clear(); break
      case 'compaction/start':
        compactions++; break
      default:
        unknownEvents++; break
    }
  }
  if (!headerSeen) throw new PerformanceInputError(line, 'No v4 header')
  const metric = (key: 'modelMs' | 'ttftMs' | 'decodeMs') => summarize(steps.flatMap(step => step[key] === null ? [] : [step[key]]))
  const model = metric('modelMs'), ttft = metric('ttftMs'), decode = metric('decodeMs')
  const coveredDecode = steps.flatMap(step => step.decodeMs === null || step.usage?.outputTokens === undefined
    ? [] : [{ milliseconds: step.decodeMs, tokens: step.usage.outputTokens }])
  const decodeTokens = coveredDecode.reduce((sum, step) => sum + step.tokens, 0)
  const tokensPerSecondCoverage = { steps: coveredDecode.length,
    decodeMs: coveredDecode.reduce((sum, step) => sum + step.milliseconds, 0) }
  const usageTotals: Usage = {}, usageCoverage: Record<string, number> = {}
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    const values = steps.flatMap(step => step.usage?.[key] === undefined ? [] : [step.usage[key]])
    if (values.length > 0) usageTotals[key] = values.reduce((sum, value) => sum + value, 0)
    usageCoverage[key] = values.length
  }
  return {
    format: 'dsh-session-performance-v1', sessionFormat: 4,
    scope: 'one log including inherited history; no descendant aggregation; event span is not active task time',
    units: { times: 'milliseconds', content: 'UTF-16 code units; not tokens', toolSizes: 'UTF-8 bytes of logged arguments/content JSON; not HTTP bytes' },
    limitations: [
      'TTFT starts at step/start, includes request-chain preparation and retries; it is not server prefill or HTTP first byte.',
      'pre-step flush precedes step/start and is outside this TTFT.',
      'Tool interval sum may overlap model time and other tools; union is not necessarily the task critical path.',
      'Provider output tokens may include reasoning. Character lengths do not split output tokens.',
      'Usage totals cover settled assistant events only; discarded attempts may have unreported billed usage.',
      'Input values including tool and route names are replaced or omitted. Unknown event payloads are not schema-validated.',
    ],
    events, ignoredEvents: unknownEvents, closedTurns: closedTurns.size, steps: steps.length,
    closedSteps: steps.filter(step => step.closed).length, settledSteps: steps.filter(step => step.settled).length,
    retryEvents, compactions,
    eventSpanMs: firstTime === null || lastTime === null || backwardEventTimes > 0 ? null : diff(firstTime, lastTime),
    model, ttft, decode, decodeTokens, tokensPerSecondCoverage,
    tokensPerSecond: tokensPerSecondCoverage.decodeMs > 0 ? decodeTokens * 1000 / tokensPerSecondCoverage.decodeMs : null,
    usageTotals, usageCoverage,
    tools: { calls: toolCalls, matchedIntervals: intervals.length,
      intervalSumMs: intervals.reduce((sum, pair) => sum + pair[1] - pair[0], 0), intervalUnionMs: unionMs(intervals),
      stepsWithMultipleCalls: steps.filter(step => step.tools > 1).length, distinctAliases: aliases.size,
      unmatchedResults, incompleteCalls: abandonedCalls + pending.size },
    anomalies: {
      backwardEventTimes, backwardStreamTimes, invalidIntervals,
      orphanAssistantEvents, duplicateSettledMessages, orphanToolCalls,
    },
    perStep: steps,
  }
}

const HELP = 'Usage: pnpm exec tsx scripts/analyze-session-performance.ts <extracted-session.v4.jsonl>\nReads one file; writes metrics JSON to stdout. No network, credentials, or automatic session discovery.\nExtract session.v4.jsonl from Download session log or /export first; ZIP, zstd and Markdown are not accepted.\n'
/** CLI entry kept separate from imports and errors deliberately omit filesystem paths. */
export async function performanceCli(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return }
  const path = args[0]
  if (args.length !== 1 || path === undefined || path.startsWith('-')) throw new PerformanceInputError(0, 'Expected exactly one input file')
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try { process.stdout.write(JSON.stringify(await analyzeSessionPerformance(lines), null, 2) + '\n') }
  finally { lines.close(); input.destroy() }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await performanceCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write((error instanceof PerformanceInputError ? error.message : 'Unable to read or analyze input file; no input details were emitted.') + '\n')
    process.exitCode = 1
  })
}
