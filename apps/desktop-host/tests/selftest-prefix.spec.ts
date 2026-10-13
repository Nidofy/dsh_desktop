/** Prefix checks consume actual Notebook/JSONL/PiAi owners with zero Agent registration or provider dispatch. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { StorageService, QuotaLeaseId, ManagedRootId, StorageOperationId } from '@nidofy/dsh-desktop-extras/storage'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { checkPrefix } from '../src/selftest/prefix.ts'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'selftest-prefix-')), id = randomUUID(), writes: string[] = []
  const ctx = new Context(), storage = { write: async <T>(path: string, _bytes: number, work: () => Promise<T>) => {
    writes.push(path); return work()
  }, reserve: async (_scope: string, reservedBytes: number, terminalBytes: number) => ({
    id: brandString<QuotaLeaseId>(randomUUID()), rootId: brandString<ManagedRootId>('synthetic'),
    operationId: brandString<StorageOperationId>(randomUUID()), reservedBytes, terminalBytes,
    run: <T>(work: () => Promise<T>) => work(), terminal: <T>(work: () => Promise<T>) => work(),
    release: async () => ({ status: 'unknown' as const }),
  }) } satisfies Pick<StorageService, 'write' | 'reserve'>
  onTestFinished(async () => { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  return { home, id, writes, ctx, storage }
}

it('classifies raw append/replacement, Notebook warm/cold revisions and prepared route changes without HTTP', async () => {
  const f = await fixture(), http = vi.spyOn(globalThis, 'fetch')
  const result = await checkPrefix(f.home, f.id, f.storage, new AbortController().signal)
  expect(result).toEqual({ status: 'PASS', code: 'OK', metrics: { files: 2, requests: 0 } })
  expect(http).not.toHaveBeenCalled()
  await f.ctx.plugin(JsonlSessionPersistence, { root: join(f.home, 'prefix'), compression: 'none' })
  const observed = await f.ctx.sessionPersistence.observeDurable(SessionId('selftest-prefix-' + f.id))
  expect(observed.events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'user/message', 'user/message',
    'user/message', 'request/header', 'request/header', 'step/end', 'turn/end'])
  expect(observed.events[2]?.type === 'user/message' && observed.events[2].data.content[0]).toMatchObject({ text: 'Original synthetic evidence 中文' })
  expect(f.writes.some(path => path.endsWith('prefix-notes'))).toBe(true)
})

it('refuses quota admission before creating logs or preparing routes', async () => {
  const f = await fixture(), prepare = vi.spyOn(PiAiAdapter.prototype, 'prepareCall')
  vi.spyOn(f.storage, 'write').mockRejectedValue(Error('Synthetic quota refusal'))
  await expect(checkPrefix(f.home, f.id, f.storage, new AbortController().signal)).rejects.toThrow('Synthetic quota refusal')
  expect(prepare).not.toHaveBeenCalled(); expect(f.writes).toEqual([])
})

it('fails classification when the actual PiAi preparation unexpectedly promises in-history prompt updates', async () => {
  const f = await fixture()
  // oxlint-disable-next-line typescript/unbound-method -- The fault wrapper rebinds the captured method to its actual adapter.
  const prepare = PiAiAdapter.prototype.prepareCall, spy = vi.spyOn(PiAiAdapter.prototype, 'prepareCall')
  spy.mockImplementation(async function (this: PiAiAdapter, ...args) {
    const call = await prepare.apply(this, args)
    return { ...call, model: { ...call.model, systemPromptUpdate: 'in-history' } }
  })
  await expect(checkPrefix(f.home, f.id, f.storage, new AbortController().signal)).rejects.toThrow('SELFTEST_ASSERTION_FAILED')
})

it('checks run cancellation before any native admission or preparation', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort(Error('Synthetic cancelled run'))
  await expect(checkPrefix(f.home, f.id, f.storage, controller.signal)).rejects.toThrow('Synthetic cancelled run')
  expect(f.writes).toEqual([])
})
