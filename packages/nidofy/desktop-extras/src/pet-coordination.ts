/** Explicit local pet actions retain their original preference owner and never dispatch model work. */
import { object } from './state.ts'
/** Expiring Session-level command; revision and generation cannot authorize a different Host or preference state. */
export interface PetCommand {
  actionId: string
  action: 'bind' | 'unbind' | 'mute' | 'unmute' | 'interact'
  target: string
  sessionId: string
  scopeVersion: number
  generation: string
  expiry: number
}
/** Parse the complete external command before any state change.
 * @param input - Authenticated wire command.
 * @param now - Actual clock used for admission.
 * @returns Valid command with bounded remaining lifetime.
 */
export function parsePetCommand(input: unknown, now: number): PetCommand {
  const row = object(input)
  if (Object.keys(row).sort().join() !== 'action,actionId,expiry,generation,scopeVersion,sessionId,target'
    || typeof row.actionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.actionId)
    || !['bind', 'unbind', 'mute', 'unmute', 'interact'].includes(typeof row.action === 'string' ? row.action : '')
    || typeof row.target !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/u.test(row.target)
    || typeof row.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(row.sessionId)
    || typeof row.generation !== 'string' || row.generation.length < 1 || row.generation.length > 128
    || typeof row.scopeVersion !== 'number' || !Number.isSafeInteger(row.scopeVersion) || row.scopeVersion < 0
    || typeof row.expiry !== 'number' || !Number.isSafeInteger(row.expiry) || row.expiry <= now || row.expiry > now + 15000) {
    throw Error('PET_COMMAND_INVALID')
  }
  return { actionId: row.actionId, action: row.action as PetCommand['action'], target: row.target, sessionId: row.sessionId,
    scopeVersion: row.scopeVersion, generation: row.generation, expiry: row.expiry }
}
/** Serial command admission consumes an identity before asynchronous work; ambiguous outcomes are never replayed. */
export class PetCoordination {
  private readonly seen = new Map<string, number>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  constructor(private readonly current: () => { enabled: boolean; revision: number; generation: string },
    private readonly ensure: (sessionId: string, signal: AbortSignal) => Promise<void>,
    private readonly update: (command: PetCommand) => Promise<unknown>, private readonly now = Date.now) {}
  /** Admit one explicit command and delegate to the existing preference owner after cold reads finish.
   * @param input - Complete authenticated command.
   * @param signal - Admitted request lifetime; disconnect prevents a pending cold read from committing.
   * @returns Original committed update; stale, expired, disabled or repeated commands refuse.
   */
  execute(input: unknown, signal: AbortSignal): Promise<unknown> {
    const command = parsePetCommand(input, this.now())
    if (this.closed) throw Error('PET_COMMAND_UNAVAILABLE')
    for (const [id, expiry] of this.seen) if (expiry <= this.now()) this.seen.delete(id)
    if (this.seen.has(command.actionId)) throw Error('PET_COMMAND_DUPLICATE')
    if (this.seen.size >= 256) throw Error('PET_COMMAND_CAPACITY')
    this.seen.set(command.actionId, command.expiry)
    const work = this.queue.catch(() => {}).then(async () => {
      const check = (): void => {
        signal.throwIfAborted()
        const current = this.current()
        if (this.closed || !current.enabled) throw Error('PET_COMMAND_UNAVAILABLE')
        if (command.expiry <= this.now() || command.scopeVersion !== current.revision || command.generation !== current.generation) {
          throw Error('PET_TARGET_CHANGED')
        }
      }
      check()
      if (command.action === 'bind') await this.ensure(command.sessionId, signal)
      check()
      return this.update(command)
    })
    this.queue = work; return work
  }
  /** Revoke new actions and await every admitted update before the optional plugin disposes. */
  async close(): Promise<void> { this.closed = true; await this.queue.catch(() => {}); this.seen.clear() }
}
