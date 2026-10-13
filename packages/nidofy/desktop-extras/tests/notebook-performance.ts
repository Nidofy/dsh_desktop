/** Synthetic performance driver for the former full-read recipe and current committed/source-window paths. */
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { installContextV2 } from '../src/context-v2.ts'
import { NotebookV2Store } from '../src/notebook.ts'
import { readNotebookObservation } from '../src/notebook-commit.ts'

const output = resolve('.build/dispatch/evidence/relay-03')
const budgets = { maxActiveEntries: 64, maxActiveBytes: 16384, maxDeltaBytes: 4096, maxEvidenceBytes: 16384, maxHistoryBytes: 1048576 }
const reads = { maxCachedSessions: 32, recentEventLimit: 40, recentScanEvents: 256 }
async function measure(operation: () => Promise<unknown>) {
  global.gc?.()
  const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable()
  await delay(20)
  const memory = process.memoryUsage(), start = performance.now()
  const deadline = start + 10
  const timer = delay(10).then(() => Math.max(0, performance.now() - deadline))
  await operation()
  const elapsedMs = performance.now() - start, after = process.memoryUsage()
  const timerDelayMs = await timer
  histogram.disable()
  return { elapsedMs, heapDeltaBytes: after.heapUsed - memory.heapUsed, rssDeltaBytes: after.rss - memory.rss,
    eventLoopMaxMs: histogram.max / 1e6, timerDelayMs }
}
async function samples(operation: () => Promise<unknown>) {
  const values = []
  for (let index = 0; index < 5; index++) values.push(await measure(operation))
  const sorted = values.map(value => value.elapsedMs).sort((left, right) => left - right)
  return { medianMs: sorted[2], maxMs: sorted[4], samples: values }
}
await mkdir(join(output, 'tmp'), { recursive: true })
const results = []
for (const count of [1000, 10000, 100000]) {
  const home = await mkdtemp(join(output, 'tmp', 'notebook-perf-')), ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
  const id = SessionId('synthetic-' + String(count)), header = Session.create(id).header
  const events: SessionEvent[] = Array.from({ length: count }, (_, index) => ({ type: 'user/message', seq: SessionSeq(index),
    time: index + 1, surfaceOp: 'append', data: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: '合成原文证据，计划尚未验证。 Event ' + String(index) }] }) }))
  const writer = await ctx.sessionPersistence.create(header)
  await writer.append(events); await writer.flush()
  const api = installContextV2(ctx, join(home, 'notes'), budgets,
    () => ({ enabled: false, revision: 0, signal: new AbortController().signal }), reads)
  const signal = new AbortController().signal
  const baselineStore = new NotebookV2Store(join(home, 'baseline-notes'), budgets)
  // The old consumer recovered from one full observation, then obtained another for its state read.
  // This corpus contains no candidates, so the recovery scan performs no publications.
  const formerRead = async () => {
    const observation = await readNotebookObservation(ctx, id, signal)
    await ctx.sessionPersistence.withGeneration(id, observation.generation,
      () => baselineStore.readCommitted({ sessionId: id, generation: observation.generation }, signal))
    let candidates = 0
    for (const event of observation.events) if (event.type === 'nidofy/notebook-compaction') candidates++
    const second = await readNotebookObservation(ctx, id, signal)
    await ctx.sessionPersistence.withGeneration(id, second.generation,
      () => baselineStore.readCommitted({ sessionId: id, generation: second.generation }, signal))
    return candidates
  }
  try {
    const startup = await measure(() => ctx.nidofyNotebookV2.synchronize(id, signal))
    const before = await samples(formerRead)
    const committedRead = await samples(() => ctx.nidofyNotebookV2.read(id, signal))
    const status = await samples(() => api('status', { sessionId: id }))
    const recentSources = await samples(() => api('events', { sessionId: id }))
    const row = { events: count, startup, before, committedRead, status, recentSources }
    results.push(row)
    process.stdout.write(JSON.stringify({ events: count, beforeMs: before.medianMs, committedMs: committedRead.medianMs,
      statusMs: status.medianMs, recentMs: recentSources.medianMs, startupMs: startup.elapsedMs }) + '\n')
  } finally {
    await baselineStore.close(); await writer.close(); await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
}
await writeFile(join(output, 'notebook-performance.json'), JSON.stringify({ date: '2026-10-07', node: process.version,
  platform: process.platform, arch: process.arch, repetitions: 5,
  limitations: ['Synthetic original messages, not engineering production workloads.',
    'Before is the previous two-observation no-candidate read recipe, not a separate historical checkout.',
    'Memory deltas are end-of-operation observations, not peak heap measurements.',
    'Startup and provider cold decoding still read the complete prefix; range reads bound consumer output only.'], results }, null, 2) + '\n')
