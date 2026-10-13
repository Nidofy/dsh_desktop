/** Engineering resource checks measure owned copies and logical Session snapshots; neither observation attests a physical peak. */
import { lstat, opendir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { SessionDurableObservation, SessionPersistenceSnapshot, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { object } from '../connections/store.ts'

/** Explicit checkpoint limits, independent of incoming closure and native managed-journal capacity. */
export interface EngineeringResourceBudget {
  workspaceBytes: number
  workspaceEntries: number
  retainedWorkspaceBytes: number
  sessionBytes: number
  sessionDiskBytes: number
  sessionEvents: number
}
/** Physical allocation identity published before copying; an old intent alone cannot authorize scanning an external tree. */
export interface EngineeringResourceAllocation {
  schemaVersion: 1
  kind: 'engineering-resource-allocation'
  id: string
  workspace: string
  identity: string
  budget: EngineeringResourceBudget
}
/** Complete logical file lengths; allocation overhead, transient growth and memory remain unobserved. */
export interface EngineeringWorkspaceMeasurement { bytes: number; entries: number; identity: string | null }
type Checkpoint = {
  phase: 'copy' | 'request' | 'before-tool' | 'after-tool' | 'drained'
  workspace: EngineeringWorkspaceMeasurement | null
  session: { bytes: number; diskBytes: number; events: number; generation: string; through: number } | null
  diagnostic: string | null
}
/** Immutable checkpoint observations, distinct from current lengths and independent test/acceptance facts. */
export interface EngineeringResourceResult {
  schemaVersion: 1
  kind: 'engineering-resource-result'
  id: string
  checkpoints: Checkpoint[]
  diskPeakBytes: null
  memoryPeakBytes: null
}
function fields(row: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(row).length !== names.length || Object.keys(row).some(key => !names.includes(key))) {
    throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
  }
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const identity = (value: unknown): value is string => typeof value === 'string' && /^\d+:\d+$/u.test(value)
const metadata = (path: string) => lstat(path, { bigint: true })
const stamp = (info: Awaited<ReturnType<typeof metadata>>): string =>
  `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
/** Read bounded ordinary journal directory names without materializing an unbounded listing.
 * @param path - Caller-owned directory; the caller retains physical identity and link validation.
 * @param maximum - Complete entry ceiling, including lock and temporary residue.
 * @param signal - Read lifetime, or undefined for an already-admitted terminal writer that must drain.
 * @param refusal - Caller's existing capacity diagnostic, preserved for its current consumers.
 * @returns Sorted complete names; overflow or cancellation returns no partial listing and preserves every file.
 */
export async function engineeringDirectoryNames(path: string, maximum: number,
  signal: AbortSignal | undefined, refusal: string): Promise<string[]> {
  signal?.throwIfAborted()
  const names: string[] = [], directory = await opendir(path, { bufferSize: 32 })
  for await (const entry of directory) {
    signal?.throwIfAborted()
    if (names.length >= maximum) throw Error(refusal)
    names.push(entry.name)
  }
  signal?.throwIfAborted()
  return names.sort()
}
/** Refuse unknown or excessive physical Session files before requesting their complete official decode.
 * @param persistence - Actual official owner; metadata is not a substitute for its durable reader.
 * @param id - Independently retained engineering Session identity.
 * @param budget - Explicit logical, physical and event limits; historical reads use their existing scan ceilings.
 * @param signal - Owning read lifetime.
 * @returns Complete bounded durable observation before detached Session construction; changed metadata refuses.
 * Callers still protect its generation and recheck physical length.
 */
export async function observeEngineeringSession(persistence: Pick<SessionPersistence, 'stat' | 'observeDurable'>,
  id: SessionId, budget: Pick<EngineeringResourceBudget, 'sessionBytes' | 'sessionDiskBytes' | 'sessionEvents'>,
  signal: AbortSignal): Promise<SessionDurableObservation> {
  signal.throwIfAborted()
  const storage = await persistence.stat(id, { signal })
  if (!storage || storage.header.id !== id || !integer(storage.sizeBytes)) throw Error('EXPERIMENT_RESOURCE_SESSION_STORAGE_UNKNOWN')
  if (storage.sizeBytes > budget.sessionDiskBytes || storage.eventCount !== undefined
    && (!integer(storage.eventCount) || storage.eventCount > budget.sessionEvents)) throw Error('EXPERIMENT_RESOURCE_SESSION_LIMIT')
  signal.throwIfAborted()
  const durable = await persistence.observeDurable(id, { signal })
  signal.throwIfAborted()
  if (durable.meta.id !== id || durable.durableThrough !== durable.events.length - 1
    || JSON.stringify(storage.header) !== JSON.stringify(durable.meta)) throw Error('EXPERIMENT_RESOURCE_SESSION_STORAGE_UNKNOWN')
  if (durable.events.length > budget.sessionEvents || engineeringSessionBytes(durable, durable.durableThrough) > budget.sessionBytes
    || Buffer.byteLength(JSON.stringify(durable)) > 2 * 1024 * 1024) throw Error('EXPERIMENT_RESOURCE_SESSION_LIMIT')
  const after = await persistence.stat(id, { signal })
  signal.throwIfAborted()
  if (!after || after.revision !== storage.revision || after.sizeBytes !== storage.sizeBytes
    || JSON.stringify(after.header) !== JSON.stringify(storage.header)) throw Error('EXPERIMENT_RESOURCE_SESSION_STORAGE_CHANGED')
  return durable
}
/** Parse complete authenticated resource limits; every field is explicit and historical absence supplies no default.
 * @param input - User-confirmed checkpoint budget.
 * @returns Detached limits; unrelated fields, unsafe integers or incompatible totals refuse.
 */
export function parseEngineeringResourceBudget(input: unknown): EngineeringResourceBudget {
  const row = object(input)
  fields(row, ['workspaceBytes', 'workspaceEntries', 'retainedWorkspaceBytes', 'sessionBytes', 'sessionDiskBytes', 'sessionEvents'])
  const read = (key: string, max: number): number => {
    const value = row[key]
    if (!integer(value) || value < 1 || value > max) throw Error('EXPERIMENT_RESOURCE_BUDGET_INVALID')
    return value
  }
  const budget = { workspaceBytes: read('workspaceBytes', 128 * 1024 * 1024), workspaceEntries: read('workspaceEntries', 4096),
    retainedWorkspaceBytes: read('retainedWorkspaceBytes', 512 * 1024 * 1024), sessionBytes: read('sessionBytes', 2 * 1024 * 1024),
    sessionDiskBytes: read('sessionDiskBytes', 2 * 1024 * 1024), sessionEvents: read('sessionEvents', 4096) }
  if (budget.retainedWorkspaceBytes < budget.workspaceBytes) throw Error('EXPERIMENT_RESOURCE_BUDGET_INVALID')
  return budget
}
/** Validate original allocation fields without adopting an old copy, creating a directory or scanning its contents.
 * @param input - Retained independent allocation sidecar.
 * @param id - Original engineering identity.
 * @param workspace - Original engineering intent's exact workspace.
 * @returns Parsed allocation, bound to the fresh physical parent; unknown versions and aliases refuse.
 */
export function parseEngineeringResourceAllocation(input: unknown, id: string, workspace: string): EngineeringResourceAllocation {
  const row = object(input)
  fields(row, ['schemaVersion', 'kind', 'id', 'workspace', 'identity', 'budget'])
  if (row.schemaVersion !== 1 || row.kind !== 'engineering-resource-allocation' || row.id !== id || row.workspace !== workspace
    || !isAbsolute(workspace) || workspace !== join(dirname(workspace), 'project') || !identity(row.identity)) {
    throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
  }
  return { schemaVersion: 1, kind: 'engineering-resource-allocation', id, workspace, identity: row.identity,
    budget: parseEngineeringResourceBudget(row.budget) }
}
async function noLinks(path: string): Promise<void> {
  if ((await metadata(path)).isSymbolicLink()) throw Error('EXPERIMENT_RESOURCE_PATH_REFUSED')
  const parent = resolve(path, '..')
  if (parent !== path) await noLinks(parent)
}
/** Measure the complete owned allocation with bounded directory iteration, without reading file bodies or following links.
 * @param allocation - Original physical parent and explicit budget, published before the copy writer starts.
 * @param signal - Scan lifetime; cancellation never returns a partial count as complete.
 * @param expectedWorkspace - Previously observed physical project identity, when copying has finished.
 * @returns Complete logical lengths including all later output files; missing/changed/oversized trees refuse without deletion.
 */
export async function measureEngineeringWorkspace(allocation: EngineeringResourceAllocation, signal: AbortSignal,
  expectedWorkspace?: string): Promise<EngineeringWorkspaceMeasurement> {
  const parent = dirname(allocation.workspace)
  await noLinks(parent)
  const before = await metadata(parent)
  if (!before.isDirectory() || `${before.dev}:${before.ino}` !== allocation.identity) throw Error('EXPERIMENT_RESOURCE_PATH_CHANGED')
  let bytes = 0, entries = 0
  const project: { identity: string | null } = { identity: null }
  const visit = async (path: string, depth: number): Promise<void> => {
    signal.throwIfAborted()
    if (++entries > allocation.budget.workspaceEntries || depth > 128) throw Error('EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
    const before = await metadata(path)
    if (before.isSymbolicLink() || before.isFile() && before.nlink !== 1n) throw Error('EXPERIMENT_RESOURCE_PATH_REFUSED')
    if (path === allocation.workspace) {
      if (!before.isDirectory()) throw Error('EXPERIMENT_RESOURCE_PATH_REFUSED')
      project.identity = `${before.dev}:${before.ino}`
      if (expectedWorkspace !== undefined && project.identity !== expectedWorkspace) throw Error('EXPERIMENT_RESOURCE_PATH_CHANGED')
    }
    if (before.isFile()) {
      bytes += Number(before.size)
      if (!Number.isSafeInteger(bytes) || bytes > allocation.budget.workspaceBytes) throw Error('EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
    } else if (before.isDirectory()) {
      const directory = await opendir(path)
      for await (const entry of directory) await visit(join(path, entry.name), depth + 1)
    } else { throw Error('EXPERIMENT_RESOURCE_PATH_REFUSED') }
    if (stamp(await metadata(path)) !== stamp(before)) throw Error('EXPERIMENT_RESOURCE_PATH_CHANGED')
  }
  const directory = await opendir(parent)
  for await (const entry of directory) {
    if (entry.name !== 'project') throw Error('EXPERIMENT_RESOURCE_PATH_REFUSED')
    await visit(allocation.workspace, 0)
  }
  signal.throwIfAborted()
  if (stamp(await metadata(parent)) !== stamp(before) || expectedWorkspace !== undefined && project.identity === null) {
    throw Error('EXPERIMENT_RESOURCE_PATH_CHANGED')
  }
  return { bytes, entries, identity: project.identity }
}
/** Request-local checkpoint accounting prevents more work after an unknown/oversized observation, preserving all existing evidence. */
export class EngineeringResourceOwner {
  private readonly checkpoints: Checkpoint[] = []
  private workspaceIdentity: string | undefined
  constructor(readonly allocation: EngineeringResourceAllocation) {}
  /** Read through the official owner after physical preflight; refused decodes retain an unknown checkpoint.
   * @param persistence - Actual official Session owner.
   * @param id - This run's independently retained Session identity.
   * @param phase - Request or drainage read; successful measurements still require same-generation stat.
   * @param signal - Owning read lifetime.
   * @returns Complete bounded observation before detached Session construction; no memory peak is asserted.
   */
  async observe(persistence: Pick<SessionPersistence, 'stat' | 'observeDurable'>, id: SessionId,
    phase: 'request' | 'drained', signal: AbortSignal): Promise<SessionDurableObservation> {
    try { return await observeEngineeringSession(persistence, id, this.allocation.budget, signal) }
    catch (error) {
      this.add({ phase, workspace: null, session: null, diagnostic: diagnostic(error) }); throw error
    }
  }
  /** Measure the complete copied tree at one cooperative operation boundary.
   * @param phase - Actual caller checkpoint; this is not an execution-time peak sample.
   * @param signal - Owning operation lifetime.
   * @returns Complete file lengths; refusal records an unknown measurement and rejects subsequent work.
   */
  async workspace(phase: Checkpoint['phase'], signal: AbortSignal): Promise<EngineeringWorkspaceMeasurement> {
    const checkpoint: Checkpoint = { phase, workspace: null, session: null, diagnostic: null }
    this.add(checkpoint)
    try {
      const result = await measureEngineeringWorkspace(this.allocation, signal, this.workspaceIdentity)
      if (phase === 'copy' && result.identity === null) throw Error('EXPERIMENT_RESOURCE_PATH_CHANGED')
      this.workspaceIdentity ??= result.identity ?? undefined
      checkpoint.workspace = result; return result
    } catch (error) { checkpoint.diagnostic = diagnostic(error); throw error }
  }
  /** Account the full official durable logical snapshot after its owner has loaded it; physical/decoded peaks remain unknown.
   * @param durable - Actual observeDurable result for this engineering Session.
   * @param storage - Actual official stat observation taken under the same generation.
   * @param phase - Request or drained checkpoint, with no assertion about intervening peaks.
   */
  session(durable: SessionDurableObservation, storage: SessionPersistenceSnapshot | undefined, phase: 'request' | 'drained'): void {
    const checkpoint: Checkpoint = { phase, workspace: null, session: null, diagnostic: null }
    this.add(checkpoint)
    const budget = this.allocation.budget
    if (!storage || JSON.stringify(storage.header) !== JSON.stringify(durable.meta) || !integer(storage.sizeBytes)) {
      checkpoint.diagnostic = 'EXPERIMENT_RESOURCE_SESSION_STORAGE_UNKNOWN'; throw Error(checkpoint.diagnostic)
    }
    if (durable.events.length > budget.sessionEvents) {
      checkpoint.diagnostic = 'EXPERIMENT_RESOURCE_SESSION_LIMIT'; throw Error(checkpoint.diagnostic)
    }
    const bytes = engineeringSessionBytes(durable, durable.durableThrough)
    if (bytes > budget.sessionBytes || storage.sizeBytes > budget.sessionDiskBytes) {
      checkpoint.diagnostic = 'EXPERIMENT_RESOURCE_SESSION_LIMIT'; throw Error(checkpoint.diagnostic)
    }
    checkpoint.session = { bytes, diskBytes: storage.sizeBytes, events: durable.events.length,
      generation: durable.generation, through: durable.durableThrough }
  }
  private add(checkpoint: Checkpoint): void {
    if (this.checkpoints.length >= 64) throw Error('EXPERIMENT_RESOURCE_CHECKPOINT_LIMIT')
    this.checkpoints.push(checkpoint)
  }
  /** Retain exact successful and refused checkpoints without converting missing physical or memory observations into zero.
   * @returns Detached immutable-publication input; it grants no task quality or peak qualification.
   */
  result(): EngineeringResourceResult {
    return { schemaVersion: 1, kind: 'engineering-resource-result', id: this.allocation.id,
      checkpoints: structuredClone(this.checkpoints), diskPeakBytes: null, memoryPeakBytes: null }
  }
}
/** Count the complete official logical prefix using fixed fields; this excludes physical encoding and decoded allocation overhead.
 * @param durable - Actual official durable observation.
 * @param through - Inclusive observed prefix, never a fabricated watermark.
 * @returns UTF-8 JSON bytes of the complete prefix and metadata, for checkpoint and cold-read equality.
 */
export function engineeringSessionBytes(durable: SessionDurableObservation, through: number): number {
  return Buffer.byteLength(JSON.stringify({ meta: durable.meta, inheritedEventCount: durable.inheritedEventCount,
    generation: durable.generation, durableThrough: through, events: durable.events.slice(0, through + 1) }))
}
/** Recheck every retained logical prefix and the complete drained physical length under the caller's official generation guard.
 * @param durable - Complete current official observation, including a run that dispatched no request.
 * @param physical - Actual stat taken while that generation remains protected.
 * @param result - Original owner-validated resource sidecar; this check never writes a replacement observation.
 */
export function validateEngineeringResourceSession(durable: SessionDurableObservation,
  physical: SessionPersistenceSnapshot | undefined, result: EngineeringResourceResult): void {
  for (const checkpoint of result.checkpoints) {
    const measured = checkpoint.session
    if (measured && (measured.generation !== durable.generation || measured.through > durable.durableThrough
      || measured.events !== measured.through + 1 || engineeringSessionBytes(durable, measured.through) !== measured.bytes
      || checkpoint.phase === 'drained' && (measured.diskBytes !== physical?.sizeBytes || measured.through !== durable.durableThrough))) {
      throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
    }
  }
}
function diagnostic(error: unknown): string {
  return error instanceof Error && /^EXPERIMENT_RESOURCE_[A-Z_]+$/u.test(error.message)
    ? error.message : 'EXPERIMENT_RESOURCE_UNCONFIRMED'
}
/** Validate the original bounded resource observations; historical absence never fabricates checkpoints.
 * @param input - Complete independent terminal resource sidecar.
 * @param allocation - Original allocation and explicit limits.
 * @returns Original observations; forged peaks, counts, versions and unrelated fields refuse.
 */
export function parseEngineeringResourceResult(input: unknown, allocation: EngineeringResourceAllocation): EngineeringResourceResult {
  const row = object(input)
  fields(row, ['schemaVersion', 'kind', 'id', 'checkpoints', 'diskPeakBytes', 'memoryPeakBytes'])
  if (row.schemaVersion !== 1 || row.kind !== 'engineering-resource-result' || row.id !== allocation.id
    || row.diskPeakBytes !== null || row.memoryPeakBytes !== null || !Array.isArray(row.checkpoints) || row.checkpoints.length > 64) {
    throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
  }
  const checkpoints = row.checkpoints.map((input: unknown): Checkpoint => {
    const value = object(input); fields(value, ['phase', 'workspace', 'session', 'diagnostic'])
    if (!['copy', 'request', 'before-tool', 'after-tool', 'drained'].includes(String(value.phase))
      || value.diagnostic !== null && (typeof value.diagnostic !== 'string' || !/^EXPERIMENT_RESOURCE_[A-Z_]+$/u.test(value.diagnostic))) {
      throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
    }
    let workspace: Checkpoint['workspace'] = null, session: Checkpoint['session'] = null
    if (value.workspace !== null) {
      const measured = object(value.workspace); fields(measured, ['bytes', 'entries', 'identity'])
      if (!integer(measured.bytes) || measured.bytes > allocation.budget.workspaceBytes || !integer(measured.entries)
        || measured.entries > allocation.budget.workspaceEntries || measured.identity !== null && !identity(measured.identity)
        || (measured.entries === 0) !== (measured.identity === null)) throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
      workspace = { bytes: measured.bytes, entries: measured.entries, identity: measured.identity }
    }
    if (value.session !== null) {
      const measured = object(value.session); fields(measured, ['bytes', 'diskBytes', 'events', 'generation', 'through'])
      if (!integer(measured.bytes) || measured.bytes > allocation.budget.sessionBytes || !integer(measured.events)
        || !integer(measured.diskBytes) || measured.diskBytes > allocation.budget.sessionDiskBytes
        || measured.events > allocation.budget.sessionEvents || typeof measured.generation !== 'string' || !measured.generation
        || measured.generation.length > 512 || typeof measured.through !== 'number' || !Number.isSafeInteger(measured.through)
        || measured.through !== measured.events - 1) throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
      session = { bytes: measured.bytes, diskBytes: measured.diskBytes, events: measured.events,
        generation: measured.generation, through: measured.through }
    }
    if (workspace !== null && session !== null || value.diagnostic !== null && (workspace !== null || session !== null)
      || value.diagnostic === null && workspace === null && session === null
      || session !== null && value.phase !== 'request' && value.phase !== 'drained') throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
    return { phase: value.phase as Checkpoint['phase'], workspace, session, diagnostic: value.diagnostic }
  })
  const identities = new Set(checkpoints.flatMap(row => row.workspace?.identity ? [row.workspace.identity] : []))
  if (identities.size > 1) throw Error('EXPERIMENT_RESOURCE_RECORD_INVALID')
  return { schemaVersion: 1, kind: 'engineering-resource-result', id: allocation.id, checkpoints, diskPeakBytes: null, memoryPeakBytes: null }
}
