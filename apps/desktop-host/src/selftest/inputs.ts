/** Private official Session logs preserve every synthetic request input; report exports never include these bytes. */
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, PreparedLlmCall, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { StorageService } from '@nidofy/dsh-desktop-extras/storage'
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SelfTestStore, unlinked } from './store.ts'

const LIMIT = 64 * 1024
interface LoggedInput {
  options: GenerateOptions
  dispatch<T>(send: () => Promise<T>): Promise<T>
}
/** Read-only allocation evidence; a capacity observation grants neither deletion nor request permission. */
export interface SelfTestInputCapacity {
  roots: number
  unsettled: number | null
  available: boolean
  code: 'OK' | 'SELFTEST_INPUT_LOG_LIMIT' | 'SELFTEST_LEFTOVER_LIMIT'
}
async function size(path: string, count = { entries: 0 }): Promise<number> {
  if (++count.entries > 80) throw Error('SELFTEST_INPUT_LOG_LIMIT')
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw Error('SELFTEST_PATH_REFUSED')
  if (info.isFile() && info.nlink === 1) return info.size
  if (!info.isDirectory()) throw Error('SELFTEST_PATH_REFUSED')
  const names = await readdir(path)
  if (names.length > 32) throw Error('SELFTEST_INPUT_LOG_LIMIT')
  let total = 0
  for (const name of names) { total += await size(join(path, name), count); if (total > LIMIT) throw Error('SELFTEST_INPUT_LOG_LIMIT') }
  return total
}

/** Retained input logs have their own twenty-root/64-KiB bounds; unknown or old roots are never adopted or deleted. */
export class SelfTestInputs {
  private readonly ctx = new Context()
  private readonly base: string
  private readonly root: string
  private readonly reports: SelfTestStore
  private opened = false
  private identity: string | undefined
  constructor(home: string, private readonly id: string, private readonly storage: Pick<StorageService, 'write'>) {
    this.base = join(home, 'nidofy-extras', 'selftests', 'inputs'); this.root = join(this.base, id)
    this.reports = new SelfTestStore(home, storage)
  }
  /** Inspect retained private inputs without allocation, writes, pruning or provider preparation.
   * @param signal - Read lifetime; capacity and unsettled counts are conservative, never repair authority.
   * @returns Counts and the current allocation refusal; at twenty roots no log scan is attempted and unsettled is unknown.
   */
  async capacity(signal: AbortSignal): Promise<SelfTestInputCapacity> {
    signal.throwIfAborted(); await unlinked(this.base)
    let names: string[]
    try { names = await readdir(this.base) }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      return { roots: 0, unsettled: 0, available: true, code: 'OK' }
    }
    if (names.length >= 20) return { roots: names.length, unsettled: null, available: false, code: 'SELFTEST_INPUT_LOG_LIMIT' }
    let unsettled = 0
    for (const name of names) {
      signal.throwIfAborted()
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(name)) throw Error('SELFTEST_PATH_REFUSED')
      const path = join(this.base, name)
      await this.verifyRoot(path, name); await size(path)
      const report = await this.reports.read(name)
      if (!report || report.status === 'INTERRUPTED') unsettled++
      const cold = new Context()
      try {
        await cold.plugin(JsonlSessionPersistence, { root: path, compression: 'none' })
        const sessions = await cold.sessionPersistence.list()
        if (sessions.length > 5) throw Error('SELFTEST_INPUT_LOG_LIMIT')
        for (const session of sessions) {
          if (!Array.from({ length: 5 }, (_, index) => `selftest-input-${name}-${index}`).includes(session.header.id)) {
            throw Error('SELFTEST_INPUT_LOG_UNCONFIRMED')
          }
          await cold.sessionPersistence.observeDurable(session.header.id, { signal })
        }
      } finally { await cold.fiber.dispose() }
    }
    signal.throwIfAborted()
    return { roots: names.length, unsettled, available: unsettled < 10,
      code: unsettled >= 10 ? 'SELFTEST_LEFTOVER_LIMIT' : 'OK' }
  }
  /** Allocate only after durable run intent; retain logs independently of report eviction.
   * @param signal - Run lifetime, with no restart adoption; every allocation rechecks capacity.
   */
  async open(signal: AbortSignal): Promise<void> {
    const capacity = await this.capacity(signal)
    if (!capacity.available) throw Error(capacity.code)
    await unlinked(this.base); await mkdir(this.base, { recursive: true, mode: 0o700 })
    signal.throwIfAborted()
    await this.storage.write(this.root, 2 * LIMIT, async () => {
      await mkdir(this.root, { mode: 0o700 })
      const info = await lstat(this.root, { bigint: true })
      this.identity = `${info.dev}:${info.ino}`
      await writeFile(join(this.root, 'owner.json'), JSON.stringify({ schemaVersion: 1, id: this.id,
        root: await realpath(this.root), identity: this.identity }), { flag: 'wx', mode: 0o600 })
    })
    if ((await readdir(this.base)).length > 20) throw Error('SELFTEST_INPUT_LOG_LIMIT')
    await this.ctx.plugin(JsonlSessionPersistence, { root: this.root, compression: 'none' })
    this.opened = true
  }
  private async verify(): Promise<void> {
    await this.verifyRoot(this.root, this.id, this.identity)
  }
  private async verifyRoot(root: string, id: string, identity?: string): Promise<void> {
    await unlinked(root)
    const info = await lstat(root, { bigint: true }), path = join(root, 'owner.json'), marker = await lstat(path)
    if (!info.isDirectory() || !marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 || marker.size > 4096) {
      throw Error('SELFTEST_PATH_REFUSED')
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('SELFTEST_PATH_REFUSED')
    const fields = value as Record<string, unknown>
    if (Object.keys(fields).some(key => !['schemaVersion', 'id', 'root', 'identity'].includes(key))) throw Error('SELFTEST_PATH_REFUSED')
    if (identity !== undefined && `${info.dev}:${info.ino}` !== identity || fields.identity !== `${info.dev}:${info.ino}` || fields.id !== id
      || fields.schemaVersion !== 1 || fields.root !== await realpath(root)) throw Error('SELFTEST_PATH_REFUSED')
  }
  /** Commit the full header, tool schemas and raw input, then reconstruct exclusively from official durable events.
   * @param index - Single-use request number within this run.
   * @param call - Official prepared call with immutable configuration.
   * @param text - Complete fixed synthetic input.
   * @param tools - Complete model-visible tool definitions, or no tools.
   * @param signal - Run lifetime checked again by the sender.
   * @returns Frozen reconstructed request and dispatch under the same official physical generation; no unlogged cache body.
   */
  async request(index: number, call: PreparedLlmCall, text: string, tools: ToolSchema[] | undefined,
    signal: AbortSignal): Promise<LoggedInput> {
    if (!this.opened) throw Error('SELFTEST_NOT_OPEN')
    const session = Session.create(SessionId(`selftest-input-${this.id}-${index}`))
    const events = [session.append('turn/start', { turn: 1 }), session.append('step/start', { turn: 1, step: 1 }),
      session.append('request/header', { reason: 'initial', header: { config: { ...call.config },
        ...Object.keys(call.adapterDefaults).length ? { adapterDefaults: { ...call.adapterDefaults } } : {}, ...tools ? { tools } : {} } }),
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })]
    signal.throwIfAborted()
    await this.verify()
    const before = await size(this.root)
    if (before + Buffer.byteLength(JSON.stringify(events)) + 4096 > LIMIT) throw Error('SELFTEST_INPUT_LOG_LIMIT')
    await this.storage.write(this.root, 2 * LIMIT, async () => {
      await this.verify()
      const writer = await this.ctx.sessionPersistence.create(session.header)
      try { await writer.append(events); await writer.flush() }
      finally { await writer.close() }
    })
    await size(this.root)
    await this.verify()
    const durable = await this.ctx.sessionPersistence.observeDurable(session.id, { signal })
    const cold = Session.create(durable.meta.id, durable.events, durable.meta)
    const header = cold.requestHeader()
    if (!header || durable.events.length !== 4 || durable.durableThrough !== 3) throw Error('SELFTEST_INPUT_LOG_UNCONFIRMED')
    const messages = cold.deriveMessages(); Object.freeze(messages)
    const options = Object.freeze({ ...header.config, messages, toolHistory: cold.toolHistory(),
      ...header.tools ? { tools: header.tools } : {}, sessionId: cold.id, signal })
    return { options, dispatch: <T>(send: () => Promise<T>): Promise<T> => this.storage.write(this.root, 2 * LIMIT,
      () => this.ctx.sessionPersistence.withGeneration(cold.id, durable.generation,
        async () => { await this.verify(); signal.throwIfAborted(); return send() }, { signal })) }
  }
  /** Drain official persistence; retained input bytes are never part of workspace cleanup. */
  async close(): Promise<void> { await this.ctx.fiber.dispose() }
}
