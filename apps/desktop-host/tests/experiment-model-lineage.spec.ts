/** Synthetic official JSONL plus real isolated T11 runs exercise attribution without creating an Agent or dispatching a model. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createUserMessage, createToolResultMessage, type ToolCallId, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, it, onTestFinished, vi } from 'vitest'
import { modelStepLineage, TaskModelLineageOwner } from '../src/experiments/model-lineage.ts'
import { TaskComparisonOwner } from '../src/experiments/owner.ts'
import type { VerificationView, VerificationRunId } from '../src/workbench/verification.ts'
import { verificationFixture } from './verification-fixture.ts'

async function fixture() {
  const id = SessionId('model-lineage-' + randomUUID()), f = await verificationFixture(id, true)
  const roots = join(process.cwd(), '.build/dispatch/evidence/relay-24/input-roots')
  await mkdir(roots, { recursive: true })
  await writeFile(join(roots, id + '.json'), JSON.stringify({ root: f.root, sessionId: id, synthetic: true, agents: 0, modelRequests: 0 }) + '\n', { flag: 'wx' })
  console.info('Retained synthetic model-lineage root:', f.root)
  const run = await f.run(), view = await f.verification.inspect(f.workspace, run.id)
  const session = Session.create(id, undefined, { ...Session.create(id).header, cwd: f.workspace })
  const events: SessionEvent[] = []
  const push = (event: SessionEvent) => { events.push(event); return event }
  const callId = brandString<ToolCallId>('synthetic-call')
  push(session.append('turn/start', { turn: 1 })); push(session.append('step/start', { turn: 1, step: 1 }))
  push(session.append('request/header', { reason: 'initial', header: { config: { provider: 'synthetic', model: 'alias-model' },
    tools: [{ name: 'run_project_action', description: 'Synthetic tool declaration', parameters: { type: 'object' } }] } }))
  push(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Complete synthetic task input 中文' }] }), { surfaceOp: 'append' }))
  const settle = (usage?: TokenUsage, failed = false, responseModel?: string) => {
    const block = { type: 'tool-call' as const, id: callId, name: 'run_project_action', arguments: '{"id":"local"}' }
    const stream = [...failed ? [] : [{ type: 'chunk' as const, time: 0,
      chunk: { type: 'block-start' as const, index: 0, blockType: 'tool-call' as const } },
    { type: 'chunk' as const, time: 0, chunk: { type: 'block-end' as const, index: 0, block } }],
    ...usage ? [{ type: 'chunk' as const, time: 0, chunk: { type: 'usage' as const, usage } }] : [],
    { type: 'chunk' as const, time: 1, chunk: { type: 'finish' as const, reason: { kind: failed ? 'stop' as const : 'tool-calls' as const },
      ...responseModel ? { replayState: { response: { kind: 'pi-ai', version: 2, provider: 'synthetic',
        model: 'alias-model', responseModel, api: 'openai-completions', stopReason: 'toolUse' }, blocks: [] } } : {} } }]
    if (failed) return push(session.append('assistant/attempt', { turn: 1, step: 1, stream }))
    return push(session.append('assistant/message', { turn: 1, step: 1, stream, ...usage ? { usage } : {},
      message: createAssistantMessage({ source: { provider: 'synthetic', model: 'alias-model' }, content: [block] }) }, { surfaceOp: 'append' }))
  }
  const result = (resultView: VerificationView = view) => {
    push(session.append('tool/call', { turn: 1, step: 1, callId, name: 'run_project_action', arguments: '{"id":"local"}' }))
    push(session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ id: run.id, verification: resultView }) }] }) }, { surfaceOp: 'append' }))
  }
  const root = join(f.root, 'synthetic-official-inputs')
  await f.ctx.plugin(SessionStore)
  await f.ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const selection = { workspace: f.workspace, runId: brandString<VerificationRunId>(run.id) }
  const persist = async () => {
    const writer = await f.ctx.sessionPersistence.create(session.header)
    try { await writer.append(events); await writer.flush() } finally { await writer.close() }
    const cold = new Context(); await cold.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    try { return await cold.sessionPersistence.observeDurable(id) } finally { await cold.fiber.dispose() }
  }
  return { ...f, id, run, view, session, events, push, selection, settle, result, persist, root }
}
it.skipIf(process.platform !== 'win32')('links a real receipt by call identity after official writer flush and cold durable read, without promoting a logged prefix to dispatch input', async () => {
  const f = await fixture()
  f.settle({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 0 }, true)
  f.settle({ inputTokens: 7, outputTokens: 3, cacheReadTokens: 4 }); f.result()
  const durable = await f.persist(), original = JSON.stringify(durable)
  const reader = new TaskModelLineageOwner(f.ctx, f.verification)
  const owner = new TaskComparisonOwner(f.verification, f.home, f.storage, reader)
  onTestFinished(() => owner.close())
  const chosen = { experimentId: randomUUID(), caseId: randomUUID(), factor: 'cache', a: f.selection, b: f.selection }
  const value = await owner.request('model-step', { selection: chosen, side: 'a' })
  expect(value).toMatchObject({ status: 'LINKED', sessionId: f.id, generation: durable.generation,
    link: { turn: 1, step: 1, callId: 'synthetic-call' }, exactModelVersion: null, taskTotals: null, efficiencyEligible: false,
    factors: { notebook: 'UNKNOWN', cache: 'UNKNOWN' },
    counts: { requests: null, settledAttempts: 2, inputTokens: { value: 12, missingAttempts: 0 },
      outputTokens: { value: 5, missingAttempts: 0 }, cacheReadTokens: { value: 4, missingAttempts: 0 } } })
  const linked = modelStepLineage(f.selection, f.view, durable, [])
  expect(linked.attempts).toHaveLength(2)
  expect(linked.attempts[0]).toMatchObject({ dispatchInput: null, loggedInput: { provider: 'synthetic', model: 'alias-model',
    messages: [{ content: [{ type: 'text', text: 'Complete synthetic task input 中文' }] }], tools: [{ name: 'run_project_action' }] } })
  expect(JSON.stringify(durable)).toBe(original)
  expect(f.counts().commands).toBe(1)
  await expect(owner.request('model-step', { selection: chosen, side: 'a', inputTokens: 0 })).rejects.toThrow('EXPERIMENT_INPUT_INVALID')
}, 60000)
it.skipIf(process.platform !== 'win32')('refuses inherited or changed receipt identities without assigning unrelated Session usage', async () => {
  const f = await fixture()
  f.settle({ inputTokens: 3, outputTokens: 2 }); f.result()
  const durable = await f.persist()
  const inherited = { ...durable, inheritedEventCount: f.session.seq }
  expect(modelStepLineage(f.selection, f.view, inherited, []).diagnostic).toBe('EXPERIMENT_MODEL_LINK_MISSING')
  const changed = structuredClone(f.view)
  if (!changed.receipt) throw Error('Expected actual receipt')
  changed.receipt.command.digest = 'f'.repeat(64)
  expect(modelStepLineage(f.selection, changed, durable, []).diagnostic).toBe('EXPERIMENT_MODEL_LINK_MISSING')
  expect(await new TaskModelLineageOwner(f.ctx, f.verification).read({ ...f.selection, workspace: f.home },
    new AbortController().signal)).toMatchObject({ status: 'UNKNOWN', diagnostic: 'EXPERIMENT_MODEL_SOURCE_UNAVAILABLE', attempts: [] })
}, 60000)
it.skipIf(process.platform !== 'win32')('drains a held selecting-step read on unload and rejects its late private input', async () => {
  const f = await fixture()
  f.settle({ inputTokens: 3, outputTokens: 2 }); f.result(); await f.persist()
  const reader = new TaskModelLineageOwner(f.ctx, f.verification)
  const result = await reader.read(f.selection, new AbortController().signal)
  let release!: (value: typeof result) => void, entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  vi.spyOn(reader, 'read').mockImplementation(() => { entered(); return new Promise((resolve) => { release = resolve }) })
  const owner = new TaskComparisonOwner(f.verification, f.home, f.storage, reader)
  const selection = { experimentId: randomUUID(), caseId: randomUUID(), factor: 'notebook', a: f.selection, b: f.selection }
  const pending = owner.request('model-step', { selection, side: 'a' })
  void pending.catch(() => { /* Assert the same late rejection after the read drains. */ })
  await ready
  let stopped = false
  const close = owner.close().then(() => { stopped = true })
  await Promise.resolve(); expect(stopped).toBe(false)
  release(result); await close
  await expect(pending).rejects.toThrow()
  await expect(owner.request('model-step', { selection, side: 'b' })).rejects.toThrow('EXPERIMENT_STOPPING')
}, 60000)
it.skipIf(process.platform !== 'win32')('retains missing per-attempt usage and explicit zero separately and refuses unrelated or duplicate tool results', async () => {
  const f = await fixture()
  f.settle(undefined, true); f.settle({ inputTokens: 0, outputTokens: 0 }); f.result()
  const durable = await f.persist(), linked = modelStepLineage(f.selection, f.view, durable, [])
  expect(linked.counts).toMatchObject({ inputTokens: { value: null, missingAttempts: 1 },
    outputTokens: { value: null, missingAttempts: 1 }, cacheReadTokens: { value: null, missingAttempts: 2 } })
  const noResult = { ...durable, events: durable.events.slice(0, -1), durableThrough: durable.durableThrough - 1 }
  expect(modelStepLineage(f.selection, f.view, noResult, []).status).toBe('UNKNOWN')
  const last = f.push(f.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
    callId: brandString<ToolCallId>('synthetic-call'), isError: false,
    content: [{ type: 'text', text: JSON.stringify({ id: f.run.id, verification: f.view }) }] }) }, { surfaceOp: 'append' }))
  expect(modelStepLineage(f.selection, f.view, { ...durable, events: f.events, durableThrough: last.seq }, []).diagnostic)
    .toBe('EXPERIMENT_MODEL_LINK_AMBIGUOUS')
}, 60000)
it.skipIf(process.platform !== 'win32')('reads desktop runs as unknown and refuses oversized complete input evidence without cropping', async () => {
  const f = await verificationFixture(undefined, true), run = await f.run()
  console.info('Retained synthetic desktop receipt root:', f.root)
  expect(await new TaskModelLineageOwner(f.ctx, f.verification).read({ workspace: f.workspace,
    runId: brandString<VerificationRunId>(run.id) }, new AbortController().signal)).toMatchObject({ status: 'UNKNOWN', counts: { requests: null } })
  const g = await fixture()
  g.push(g.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(64 * 1024) }] }), { surfaceOp: 'append' }))
  g.settle({ inputTokens: 1, outputTokens: 1 }); g.result()
  const durable = await g.persist()
  expect(() => modelStepLineage(g.selection, g.view, durable, [])).toThrow('EXPERIMENT_MODEL_RESULT_LIMIT')
  expect(await g.ctx.sessionPersistence.observeDurable(g.id)).toEqual(durable)
}, 60000)
it.skipIf(process.platform !== 'win32')('associates an official per-attempt response model with the unique receipt-selecting step without asserting an exact version or complete task', async () => {
  const f = await fixture()
  f.settle(undefined, true); f.settle({ inputTokens: 1, outputTokens: 1 }, false, 'provider-reported-2026-10-11'); f.result()
  const durable = await f.persist(), bytes = JSON.stringify(durable)
  const result = await new TaskModelLineageOwner(f.ctx, f.verification).read(f.selection, new AbortController().signal)
  expect(result.status).toBe('LINKED'); expect(result.selection.runId).toBe(f.run.id)
  expect(result.attempts.map(row => row.responseModel)).toEqual([{ status: 'UNOBSERVED', model: null },
    { status: 'REPORTED', model: 'provider-reported-2026-10-11' }])
  expect(result.exactModelVersion).toBeNull(); expect(result.taskTotals).toBeNull(); expect(result.counts.requests).toBeNull()
  expect(result.efficiencyEligible).toBe(false); expect(await f.ctx.sessionPersistence.observeDurable(f.id)).toEqual(durable)
  expect(JSON.stringify(durable)).toBe(bytes); expect(f.counts().commands).toBe(1)
}, 60000)
