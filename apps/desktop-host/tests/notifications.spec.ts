/** Durable notice identity, system claims and cursor CAS with real receipt/Shell/native quota producers. */
import { expect, it, onTestFinished } from 'vitest'
import { NotificationOwner } from '../src/workbench/notifications.ts'
import { WorkbenchNoticeConsumer } from '../../desktop/src/workbench-notifications.ts'
import { verificationFixture } from './verification-fixture.ts'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionPersistenceGeneration } from '@deepseek-ai/dsh-session-persistence'

async function fixture() {
  const f = await verificationFixture(), notices = new NotificationOwner(f.home, f.verification)
  const off = f.verification.subscribe(event => notices.committed(event).then(() => {}))
  onTestFinished(async () => { off(); await notices.close() })
  const request = async (method: string, data: Record<string, unknown> = {}): Promise<unknown> => {
    switch (method) {
      case 'notifications/attach': return notices.attach()
      case 'notifications/poll': return notices.poll()
      case 'notifications/preferences': return notices.preferences()
      case 'notifications/claim': return notices.claim(data.id, data.prefsRevision)
      case 'notifications/settle': return notices.settle(data.id, data.claimId, data.outcome)
      case 'notifications/advance': return notices.advance(data.expectedRevision, data.sequence)
      default: throw Error('Unexpected actual consumer operation')
    }
  }
  return { ...f, notices, off, request }
}

it.skipIf(process.platform !== 'win32')('reads legacy notices unchanged and retains version-two job identities across owner restart', async () => {
  const f = await fixture()
  await f.run()
  const path = join(f.home, 'desktop-actions/notifications/events/0000000000000001.json')
  const old = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const legacy = JSON.stringify({ ...old, schemaVersion: 1 })
  await writeFile(path, legacy)
  const epoch = randomUUID(), job = { id: JobId('bash-1'), kind: 'bash', label: 'private command not retained',
    owner: SessionId('synthetic-owner'), status: 'failed' as const, startedAt: 100, finishedAt: 200,
    output: { total: 0, earliest: 0 } }
  const first = await f.notices.jobTerminal(epoch, job, f.workspace)
  expect(await f.notices.jobTerminal(epoch, job, f.workspace)).toEqual(first)
  expect(first).toMatchObject({ schemaVersion: 2, sourceType: 'job', kind: 'failed', scope: { sessionId: job.owner } })
  expect(JSON.stringify(first)).not.toContain(job.label)
  const cold = new NotificationOwner(f.home, f.verification); onTestFinished(() => cold.close())
  expect((await cold.list()).notices.map(row => row.schemaVersion)).toEqual([1, 2])
  expect(await readFile(path, 'utf8')).toBe(legacy)
  expect((await cold.jobTerminal(randomUUID(), job, f.workspace)).id).not.toBe(first.id)
  expect(await cold.preferences()).toEqual({ revision: 0, enabled: false })
}, 60000)

it.skipIf(process.platform !== 'win32')('retains blocked, token-limit and interruption reasons independently from failure', async () => {
  const f = await fixture(), id = SessionId('synthetic-terminal')
  const generation = brandString<SessionPersistenceGeneration>('synthetic-generation')
  for (const [index, kind] of (['blocked', 'max-tokens', 'interrupted'] as const).entries()) {
    const event = { type: 'turn/end', seq: index, time: 100 + index, data: { turn: index + 1, reason: { kind } } } as SessionEvent<'turn/end'>
    await f.notices.sessionTerminal(id, generation, null, event)
  }
  expect((await f.notices.list()).notices.map(row => row.kind)).toEqual(['blocked', 'limit-reached', 'interrupted'])
}, 60000)

it.skipIf(process.platform !== 'win32')('uses one durable identity, exclusive display claims and independent handling across owner instances', async () => {
  const f = await fixture()
  expect(await f.notices.preferences()).toEqual({ revision: 0, enabled: false })
  await f.notices.configure(0, true)
  await f.notices.attach()
  const run = await f.run(), all = await f.notices.list(), row = all.notices[0]!
  expect(row).toMatchObject({ sourceId: run.id, kind: 'awaiting-acceptance', sourceRevision: 1,
    delivery: { system: 'unclaimed', handled: false, visibleToCompanion: true } })
  const cold = new NotificationOwner(f.home, f.verification)
  onTestFinished(() => cold.close())
  for (const event of (await f.verification.committedRecords()).records) await cold.committed(event)
  expect((await cold.list()).notices).toHaveLength(1)
  const lease = await f.storage.reserve('node:write', 128 * 1024, 0)
  let claims
  try { claims = await lease.run(() => Promise.all([f.notices.claim(row.id, 1), cold.claim(row.id, 1)])) }
  finally { await lease.release() }
  expect(claims.filter(Boolean)).toHaveLength(1)
  const claim = claims.find(value => value !== null)!
  expect(await f.notices.settle(row.id, claim.claimId, 'failed')).toEqual({ system: 'failed', handled: false, visibleToCompanion: true })
  expect((await cold.list()).notices[0]?.delivery.handled).toBe(false)
  expect((await f.verification.inspect(f.workspace, run.id)).receipt?.acceptance).toBe('PENDING')
  expect(await cold.handle(row.id)).toEqual({ system: 'failed', handled: true, visibleToCompanion: true })
  await expect(cold.configure(0, false)).rejects.toThrow('NOTICE_PREFERENCES_CONFLICT')
  await cold.configure(1, false)
  expect(await f.notices.preferences()).toEqual({ revision: 2, enabled: false })
  expect((await cold.list()).notices).toHaveLength(1)
}, 60000)

it.skipIf(process.platform !== 'win32')('reconciles missed terminal callbacks without replaying historical displays, preserving unknown OS outcomes', async () => {
  const f = await fixture(); await f.notices.configure(0, true); await f.notices.attach(); f.off()
  const missed = await f.run()
  expect((await f.notices.list()).notices).toHaveLength(0)
  const cold = new NotificationOwner(f.home, f.verification)
  onTestFinished(() => cold.close())
  await cold.reconcile()
  const row = (await cold.list()).notices[0]!
  expect(row.sourceId).toBe(missed.id)
  const claim = await cold.claim(row.id, 1)
  expect(claim).not.toBeNull()
  const reopened = new NotificationOwner(f.home, f.verification)
  onTestFinished(() => reopened.close())
  expect(await reopened.delivery(row.id)).toEqual({ system: 'unknown', handled: false, visibleToCompanion: true })
  expect(await reopened.claim(row.id, 1)).toBeNull()
  await reopened.attach()
  expect((await reopened.poll()).notices).toHaveLength(0)
  expect((await reopened.list()).notices).toHaveLength(1)
  expect((await f.verification.inspect(f.workspace, missed.id)).receipt?.tests).toBe('PASSED')
}, 60000)

it.skipIf(process.platform !== 'win32')('consumes real new receipts without any workbench window and skips history on Host reconnection', async () => {
  const f = await fixture(), shown: string[] = []
  await f.notices.configure(0, true)
  await f.run()
  const main = new WorkbenchNoticeConsumer(f.request, async (row) => { shown.push(row.sourceId); return 'sent' })
  onTestFinished(() => main.close())
  await main.tick('isolated-host-A'); expect(shown).toEqual([])
  const run = await f.run(); await main.tick('isolated-host-A')
  expect(shown).toEqual([run.id])
  expect((await f.notices.list()).notices.at(-1)?.delivery.system).toBe('sent')
  await main.tick('isolated-host-A'); expect(shown).toEqual([run.id])
  await f.run(); await main.tick('isolated-host-B')
  await main.tick('isolated-host-B'); expect(shown).toEqual([run.id])
  const cursor = await f.notices.cursor()
  await expect(f.notices.advance(cursor.revision - 1, cursor.sequence)).rejects.toThrow('NOTICE_CURSOR_CONFLICT')
}, 60000)

it.skipIf(process.platform !== 'win32')('suppresses disabled notices without handling sources and invalidates a claim arriving from an old Host scope', async () => {
  const f = await fixture(), shown: string[] = []
  await f.notices.configure(0, true)
  let finish: (() => void) | undefined
  const request = async (method: string, input?: Record<string, unknown>) => {
    const result = await f.request(method, input)
    if (method === 'notifications/claim') await new Promise<void>((resolve) => { finish = resolve })
    return result
  }
  const main = new WorkbenchNoticeConsumer(request, async (row) => { shown.push(row.id); return 'sent' })
  onTestFinished(() => main.close())
  await main.tick('Host-A'); await f.run()
  const pending = main.tick('Host-A')
  await expect.poll(() => finish !== undefined).toBe(true)
  const changed = main.tick('Host-B')
  if (!finish) throw Error('Expected held actual claim')
  finish(); await pending; await changed
  expect(shown).toEqual([])
  expect((await f.notices.list()).notices.at(-1)?.delivery).toMatchObject({ system: 'unknown', handled: false })
  await main.tick('Host-B')
  await f.notices.configure(1, false); await f.run(); await main.tick('Host-B')
  expect((await f.notices.list()).notices.at(-1)?.delivery).toMatchObject({ system: 'suppressed', visibleToCompanion: true, handled: false })
  expect(shown).toEqual([])
  await f.notices.close()
  await expect(f.notices.configure(2, true)).rejects.toThrow('NOTICE_OWNER_STOPPING')
  expect(await f.notices.preferences()).toEqual({ revision: 2, enabled: false })
}, 60000)

it.skipIf(process.platform !== 'win32')('re-establishes a baseline after a transport failure even when the Host identity is unchanged', async () => {
  const f = await fixture(), shown: string[] = []
  await f.notices.configure(0, true)
  let disconnected = false
  const request = (method: string, input?: Record<string, unknown>) => {
    if (disconnected) return Promise.reject(Error('Isolated transport loss'))
    return f.request(method, input)
  }
  const main = new WorkbenchNoticeConsumer(request, async (row) => { shown.push(row.sourceId); return 'sent' })
  onTestFinished(() => main.close())
  await main.tick('same-Host'); disconnected = true
  await expect(main.tick('same-Host')).rejects.toThrow('Isolated transport loss')
  await f.run(); disconnected = false
  await main.tick('same-Host'); await main.tick('same-Host')
  expect(shown).toEqual([])
  const current = await f.run(); await main.tick('same-Host')
  expect(shown).toEqual([current.id])
}, 60000)
