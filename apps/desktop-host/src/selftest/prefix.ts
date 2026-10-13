/** Isolated raw-log, committed Notebook and prepared PiAi classifications; no Agent or stream is created. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, canonicalHeader, headerEquals } from '@deepseek-ai/dsh-session'
import type { EpochHeader, SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreparedLlmCall, ToolSchema } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { installContextV2 } from '@nidofy/dsh-desktop-extras/context'
import { NotebookV2Store } from '@nidofy/dsh-desktop-extras/notebook'
import type { NotebookV2 } from '@nidofy/dsh-desktop-extras/notebook'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { join } from 'node:path'
import { unlinked } from './store.ts'
import type { CheckResult } from './types.ts'
import { checkCache } from './cache.ts'

function requireFact(value: boolean): void { if (!value) throw Error('SELFTEST_ASSERTION_FAILED') }
async function refused(work: () => Promise<unknown>, expected: string): Promise<void> {
  try { await work() }
  catch (error) { requireFact(error instanceof Error && error.message === expected); return }
  throw Error('SELFTEST_ASSERTION_FAILED')
}
function header(call: PreparedLlmCall, tools?: ToolSchema[]): EpochHeader {
  return canonicalHeader({ config: call.config, adapterDefaults: call.adapterDefaults, ...tools ? { tools } : {} })
}

/** Measure current consumers using private official logs and native-admitted Notebook publications.
 * @param home - This run's canonical, marker-verified synthetic home; normal cleanup drains it.
 * @param id - This run's identity, never a user Session or model route.
 * @param storage - Original native quota owner for logs, generation locks and Notebook writes.
 * @param signal - Whole-run cancellation; each operation drains before cleanup.
 * @returns PASS only for measured local classifications; no provider cache-hit or streaming qualification.
 */
export async function checkPrefix(home: string, id: string, storage: Pick<StorageService, 'write' | 'reserve'>, signal: AbortSignal): Promise<CheckResult> {
  const ctx = new Context(), restored = new Context(), root = join(home, 'prefix'), copy = join(home, 'prefix-restored')
  const notes = join(home, 'prefix-notes'), budgets = { maxActiveEntries: 4, maxActiveBytes: 4096,
    maxDeltaBytes: 4096, maxEvidenceBytes: 8192, maxHistoryBytes: 65536 }
  const write = <T>(path: string, bytes: number, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted()
    return storage.write(path, bytes, async () => { await unlinked(path); signal.throwIfAborted(); return work() })
  }
  const admit = { admit: async (request: { maxWriteBytes: number }) => {
    const lease = await storage.reserve('notebook:publish', request.maxWriteBytes, 0)
    return { run: <T>(work: () => Promise<T>) => lease.run(work), settle: async () => { await lease.release() } }
  } }
  let writer: Awaited<ReturnType<typeof ctx.sessionPersistence.create>> | undefined
  let copied: Awaited<ReturnType<typeof restored.sessionPersistence.create>> | undefined
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(LlmRuntime)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await restored.plugin(JsonlSessionPersistence, { root: copy, compression: 'none' })
    // Generation exclusion writes metadata, so admission spans its entire callback as well as log writes.
    const protectedWrite = <T>(work: () => Promise<T>) => write(notes, 128 * 1024, work)
    const api = installContextV2(ctx, notes, budgets, () => ({ enabled: false, revision: 0, signal }),
      { maxCachedSessions: 1, recentEventLimit: 4, recentScanEvents: 8 }, admit)
    const session = Session.create(SessionId('selftest-prefix-' + id)), events: SessionEvent[] = []
    writer = await write(root, 128 * 1024, () => ctx.sessionPersistence.create(session.header))
    const append = async (batch: SessionEvent[]): Promise<void> => {
      const active = writer
      if (!active) throw Error('SELFTEST_NOT_OPEN')
      await write(root, 128 * 1024, async () => { await active.append(batch); await active.flush() })
      events.push(...batch)
    }
    await append([session.append('turn/start', { turn: 1 }), session.append('step/start', { turn: 1, step: 1 }),
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Original synthetic evidence 中文' }] }), { surfaceOp: 'append' })])
    const initial = await ctx.sessionPersistence.observeDurable(session.id, { signal })
    const initialFile = await ctx.sessionPersistence.stat(session.id, { signal })
    requireFact(initial.durableThrough === 2 && initial.events.length === 3)
    const empty = await protectedWrite(() => ctx.nidofyNotebookV2.synchronize(session.id, signal))
    requireFact(empty.revision === 0 && empty.cursors.evidenceThrough === -1 && empty.cursors.commitThrough === -1)
    const original = events[2]
    if (original?.type !== 'user/message') throw Error('SELFTEST_ASSERTION_FAILED')
    const note = await protectedWrite(() => api('update', { sessionId: session.id, delta: { scope: empty.scope,
      baseRevision: 0, cursors: { evidenceThrough: original.seq }, operations: [{ action: 'ADD', id: 'synthetic-note',
        kind: 'constraint', text: 'Preserve original evidence', seq: original.seq, quote: 'Original synthetic evidence' }] } }, signal)) as NotebookV2
    const selected = await protectedWrite(() => ctx.nidofyNotebookV2.read(session.id, signal))
    requireFact(JSON.stringify(selected) === JSON.stringify(note) && note.cursors.commitThrough === -1)
    await append([session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Appended synthetic evidence' }] }), { surfaceOp: 'append' })])
    const appended = await ctx.sessionPersistence.observeDurable(session.id, { signal })
    requireFact(appended.generation === initial.generation && appended.durableThrough === 3
      && JSON.stringify(appended.events.slice(0, 3)) === JSON.stringify(initial.events))
    requireFact((await ctx.sessionPersistence.stat(session.id, { signal }))?.revision !== initialFile?.revision)
    requireFact(JSON.stringify(await protectedWrite(() => ctx.nidofyNotebookV2.read(session.id, signal))) === JSON.stringify(note))
    requireFact(ctx.nidofyNotebookV2.synchronization(session.id).synchronizedThrough === 2)
    await protectedWrite(() => ctx.nidofyNotebookV2.synchronize(session.id, signal))
    requireFact(ctx.nidofyNotebookV2.synchronization(session.id).synchronizedThrough === 3)
    // A surface replacement is another raw event. Original evidence remains at its original seq.
    await append([session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Replacement synthetic view' }] }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })])
    const replacement = await ctx.sessionPersistence.observeDurable(session.id, { signal })
    const cold = Session.create(replacement.meta.id, replacement.events, replacement.meta)
    requireFact(replacement.generation === initial.generation && replacement.events.length === 5
      && JSON.stringify(replacement.events.slice(0, 4)) === JSON.stringify(appended.events))
    requireFact(!cold.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text.includes('Original synthetic evidence'))))
    requireFact(cold.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text === 'Replacement synthetic view')))
    requireFact(JSON.stringify(await protectedWrite(() => ctx.nidofyNotebookV2.synchronize(session.id, signal))) === JSON.stringify(note))
    const corrected = await protectedWrite(() => api('update', { sessionId: session.id, delta: { scope: note.scope,
      baseRevision: note.revision, operations: [{ action: 'UPDATE', id: 'synthetic-note', expectedRevision: note.revision,
        kind: 'constraint', text: 'Explicit synthetic correction', seq: original.seq, quote: 'Original synthetic evidence' }] } }, signal)) as NotebookV2
    requireFact(corrected.revision === note.revision + 1 && corrected.active[0]?.text === 'Explicit synthetic correction'
      && corrected.cursors.evidenceThrough === original.seq && corrected.cursors.commitThrough === -1)
    await refused(() => protectedWrite(() => api('update', { sessionId: session.id,
      delta: { scope: note.scope, baseRevision: note.revision, operations: [] } }, signal)), 'NOTEBOOK_REVISION_CONFLICT')
    requireFact(JSON.stringify(await protectedWrite(() => ctx.nidofyNotebookV2.read(session.id, signal))) === JSON.stringify(corrected))

    // A second official writer restores the same originals to a different physical root. No committed file is rewritten.
    copied = await write(copy, 128 * 1024, () => restored.sessionPersistence.create(session.header))
    const copyWriter = copied
    await write(copy, 128 * 1024, async () => { await copyWriter.append(events); await copyWriter.flush() })
    const physical = await restored.sessionPersistence.observeDurable(session.id, { signal })
    requireFact(physical.generation !== initial.generation && JSON.stringify(physical.events) === JSON.stringify(replacement.events))
    await refused(() => write(copy, 128 * 1024, () => restored.sessionPersistence.withGeneration(session.id, initial.generation,
      () => Promise.reject(Error('SELFTEST_UNEXPECTED_PUBLICATION')), { signal })), 'SESSION_GENERATION_CONFLICT')
    const coldNotes = new NotebookV2Store(notes, budgets)
    try {
      await refused(() => write(copy, 128 * 1024, () => restored.sessionPersistence.withGeneration(session.id, physical.generation,
        () => coldNotes.readSelected({ sessionId: session.id, generation: physical.generation }, signal), { signal })), 'NOTEBOOK_SCOPE_CONFLICT')
    } finally { await coldNotes.close() }
    requireFact(JSON.stringify(await protectedWrite(() => ctx.nidofyNotebookV2.read(session.id, signal))) === JSON.stringify(corrected))

    let authReads = 0
    const denyAuth = (): Promise<never> => { authReads++; return Promise.reject(Error('SELFTEST_UNEXPECTED_SEND')) }
    const base: PiAiProviderProfile = { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'SELFTEST_SYNTHETIC_UNUSED', models: [{ id: 'first', maxTokens: 64 }, { id: 'second', maxTokens: 64 }], defaultContextWindow: 8192,
      defaultMaxTokens: 64, retryPolicy: { mode: 'normal', maxRetries: 0 } }
    let profiles = resolveProfiles({ synthetic: base })
    const endpoints: string[] = []
    const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: denyAuth,
      prepareHttp: (url) => { endpoints.push(url); return Promise.resolve(undefined) },
      auth: { credentials: { read: denyAuth, list: denyAuth, modify: denyAuth, delete: denyAuth },
        authContext: { env: denyAuth, fileExists: denyAuth } } })
    const registration = ctx.llm.registerAdapter(['synthetic'], adapter)
    try {
      const first = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first' }, signal)
      const repeated = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first' }, signal)
      requireFact(headerEquals(header(first), header(repeated)) && first.config.maxTokens === 64
        && first.adapterDefaults.maxTokens === true && first.systemPromptUpdate === undefined && first.toolUpdate === undefined)
      const explicit = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first', maxTokens: 64 }, signal)
      requireFact(!headerEquals(header(first), header(explicit)) && explicit.adapterDefaults.maxTokens === undefined)
      const model = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'second' }, signal)
      const tokens = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first', maxTokens: 32 }, signal)
      requireFact(!headerEquals(header(first), header(model)) && !headerEquals(header(first), header(tokens)))
      const tools: ToolSchema[] = [{ name: 'synthetic_view', description: 'Fixed schema only; never executed.', parameters: { type: 'object', properties: {} } }]
      requireFact(headerEquals(header(first), header(first, [])) && !headerEquals(header(first), header(first, tools)))
      profiles = resolveProfiles({ synthetic: { ...base, baseURL: 'http://127.0.0.1:2/v1' } })
      const endpointOnly = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first' }, signal)
      requireFact(headerEquals(header(first), header(endpointOnly)) && endpoints[0] === base.baseURL
        && endpoints.at(-1) === 'http://127.0.0.1:2/v1')
      profiles = resolveProfiles({ synthetic: { ...base, defaultContextWindow: 16384, models: [{ id: 'first', maxTokens: 32 }, { id: 'second', maxTokens: 32 }],
        baseURL: 'http://127.0.0.1:2/v1', retryPolicy: { mode: 'normal', maxRetries: 1 } } })
      registration.replace(['synthetic'])
      const changed = await ctx.llm.prepareCall({ provider: 'synthetic', model: 'first' }, signal)
      requireFact(first.context?.contextWindow === 8192 && first.config.maxTokens === 64 && first.retryPolicy.mode === 'normal'
        && first.retryPolicy.maxRetries === 0 && changed.context?.contextWindow === 16384 && changed.config.maxTokens === 32
        && changed.retryPolicy.mode === 'normal' && changed.retryPolicy.maxRetries === 1)
      requireFact(!headerEquals(header(first), header(changed)))
      await append([session.append('request/header', { reason: 'initial', header: header(first, tools) }),
        session.append('request/header', { reason: 'change', header: header(changed) }),
        session.append('step/end', { turn: 1, step: 1 }), session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })])
      const routed = await ctx.sessionPersistence.observeDurable(session.id, { signal })
      requireFact(routed.generation === initial.generation
        && JSON.stringify(routed.events.slice(0, 5)) === JSON.stringify(replacement.events))
      const reconstructed = Session.create(routed.meta.id, routed.events, routed.meta)
      const reconstructedHeader = reconstructed.requestHeader()
      requireFact(reconstructedHeader !== undefined && headerEquals(reconstructedHeader, header(changed)))
      // Publication and route changes do not silently organize or advance Notebook cursors.
      const organized = await protectedWrite(() => ctx.nidofyNotebookV2.synchronize(session.id, signal))
      requireFact(JSON.stringify(organized) === JSON.stringify(corrected))
      requireFact(ctx.sessions.list().length === 0 && authReads === 0)
      await checkCache(home, id, signal)
      return { status: 'PASS', code: 'OK', metrics: { files: 2, requests: 0 } }
    } finally { registration() }
  } finally { await writer?.close(); await copied?.close(); await ctx.fiber.dispose(); await restored.fiber.dispose() }
}
