/** Quarantine imported plans until individual confirmation; uncertain creation is never replayed. */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ScheduleCreateRequest } from '@deepseek-ai/dsh-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { object, text, readJson } from './state.ts'

interface ImportedPlan { id: string; title: string; prompt: string; original: Record<string, unknown>; status: 'PAUSED' | 'UNKNOWN' | 'RESTORED'; target?: string }
function required(value: unknown, max: number): string { const result = text(value, max).trim(); if (!result) throw Error('SCHEDULE_INPUT_REQUIRED'); return result }
/** Decode only explicit future rules; an old overdue timestamp is never replayed. */
export function createRequest(input: unknown): ScheduleCreateRequest {
  const r = object(input), title = required(r.title, 120), prompt = required(r.prompt, 16000)
  if (Object.keys(r).filter(k => ['at', 'every_seconds', 'daily', 'weekly', 'cron'].includes(k)).length !== 1) throw Error('SCHEDULE_RULE_REQUIRED')
  if (r.at !== undefined) {
    const at = text(r.at)
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now() + 60000) throw Error('SCHEDULE_FUTURE_REQUIRED')
    return { title, prompt, at }
  }
  if (r.every_seconds !== undefined) {
    const every = Number(r.every_seconds)
    if (!Number.isSafeInteger(every) || every < 60 || every > 31536000) throw Error('SCHEDULE_INTERVAL_INVALID')
    return { title, prompt, every_seconds: every }
  }
  const kind = r.daily ? 'daily' : r.weekly ? 'weekly' : 'cron', rule = object(r[kind]), time_zone = text(rule.time_zone)
  try { new Intl.DateTimeFormat('en', { timeZone: time_zone }).format() } catch { throw Error('SCHEDULE_ZONE_INVALID') }
  if (kind === 'cron') return { title, prompt, cron: { expression: required(rule.expression, 128), time_zone } }
  const time = text(rule.time)
  if (!/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(time)) throw Error('SCHEDULE_TIME_INVALID')
  if (kind === 'daily') return { title, prompt, daily: { time, time_zone } }
  const weekdays = rule.weekdays
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.length > 7 || weekdays.some(d => !Number.isInteger(d) || Number(d) < 1 || Number(d) > 7)) throw Error('SCHEDULE_DAYS_INVALID')
  return { title, prompt, weekly: { time, time_zone, weekdays: weekdays.map(Number) } }
}
export class ScheduleImport {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly ctx: Context, private readonly home: string) {}
  private async read(): Promise<ImportedPlan[]> {
    try {
      const saved = object(await readJson(join(this.home, 'paused-schedules.json')))
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.items) || saved.items.length > 100) throw Error('SCHEDULE_IMPORT_UNREADABLE')
      return saved.items.map((value) => {
        const row = object(value)
        if (!['PAUSED', 'UNKNOWN', 'RESTORED'].includes(String(row.status))) throw Error('SCHEDULE_IMPORT_UNREADABLE')
        return { id: text(row.id), title: text(row.title, 120), prompt: text(row.prompt, 16000), original: object(row.original), status: row.status as ImportedPlan['status'], ...(row.target === undefined ? {} : { target: text(row.target) }) }
      })
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
  }
  private async save(items: ImportedPlan[]): Promise<void> {
    await mkdir(this.home, { recursive: true })
    const path = join(this.home, 'paused-schedules.json'), bytes = JSON.stringify({ schemaVersion: 1, items }), storage = this.ctx.get('nidofyStorage')
    const write = () => writeFileAtomic(path, bytes, { mode: 0o600 })
    await (storage ? storage.write(path, Buffer.byteLength(bytes) * 2, write) : write())
  }
  async close(): Promise<void> { await this.queue.catch(() => {}) }
  request(method: string, input: Record<string, unknown>): Promise<unknown> {
    const work = this.queue.catch(() => {}).then(async () => {
      const items = await this.read(), official = this.ctx.get('schedule')
      if (method === 'list') return { enabled: official !== undefined, paused: items, official: official ? await official.catalog() : [], bundled: true }
      if (method === 'import') {
        const data = object(await readJson(text(input.path, 4096)))
        if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 100) throw Error('SCHEDULE_EXPORT_REQUIRED')
        for (const value of data.items) {
          const r = object(value), title = required(r.title, 120), prompt = required(r.prompt, 16000)
          // Persist only review metadata, never executable plugin code or source credentials.
          const original = Object.fromEntries(['id', 'sessionId', 'kind', 'scheduledAt', 'timeZone', 'time', 'expression', 'everySeconds', 'weekdays'].filter(k => r[k] !== undefined).map(k => [k, r[k]]))
          if (JSON.stringify(original).length > 4096) throw Error('SCHEDULE_EXPORT_INVALID')
          const id = createHash('sha256').update(JSON.stringify({ title, prompt, original })).digest('hex')
          if (!items.some(row => row.id === id)) items.push({ id, title, prompt, original, status: 'PAUSED' })
        }
        if (items.length > 100) throw Error('SCHEDULE_IMPORT_LIMIT')
        await this.save(items); return { paused: items, activated: 0 }
      }
      if (method === 'restore') {
        if (!official) throw Error('ENABLE_OFFICIAL_SCHEDULE_PLUGIN')
        if (input.accepted !== true) throw Error('SCHEDULE_CONFIRMATION_REQUIRED')
        const item = items.find(row => row.id === input.id)
        if (!item || item.status !== 'PAUSED') throw Error('SCHEDULE_STATE_CONFLICT')
        const sessionId = SessionId(required(input.sessionId, 128)), request = createRequest(input.request)
        const observed = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none', signal: AbortSignal.timeout(10000) })
        try { if (observed.header.origin === 'subagent') throw Error('ROOT_SESSION_REQUIRED') } finally { observed[Symbol.dispose]() }
        // Persist uncertainty before the external owner may commit. An interrupted attempt requires inspection, not retry.
        item.status = 'UNKNOWN'; await this.save(items)
        const result = await official.create(sessionId, request)
        item.status = 'RESTORED'; item.target = result.id; await this.save(items)
        return { id: item.id, status: item.status, target: result.id }
      }
      throw Error('UNKNOWN_SCHEDULE_OPERATION')
    })
    this.queue = work; return work
  }
}
