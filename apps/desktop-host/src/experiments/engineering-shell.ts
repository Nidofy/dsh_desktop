/** Cooperative complete Shell output observations and independent retained spill charges. */
import type { ShellExecution, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { object } from '../connections/store.ts'

/** Explicit whole-run output allowance and cross-run retained spill allowance; neither is a physical peak cap. */
export interface EngineeringShellBudget { outputBytes: number; retainedSpillBytes: number }
type Stream = { bytes: number | null; spill: { path: string; identity: string; bytes: number } | null }
/** Original settled stream coordinates, retained independently from the action's bounded result and receipt. */
export interface EngineeringShellResult {
  schemaVersion: 1
  kind: 'engineering-shell-result'
  id: string
  runs: { stdout: Stream; stderr: Stream }[]
  diagnostic: string | null
}
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
/** Parse explicit Shell limits without provider defaults or tail-length inference.
 * @param input - Authenticated preview limits.
 * @returns Detached complete limits; unknown fields and invalid totals refuse.
 */
export function parseEngineeringShellBudget(input: unknown): EngineeringShellBudget {
  const row = object(input)
  if (Object.keys(row).length !== 2 || !integer(row.outputBytes) || row.outputBytes < 1 || row.outputBytes > 64 * 1024 * 1024
    || !integer(row.retainedSpillBytes) || row.retainedSpillBytes < row.outputBytes || row.retainedSpillBytes > 512 * 1024 * 1024) {
    throw Error('EXPERIMENT_RESOURCE_SHELL_BUDGET_INVALID')
  }
  return { outputBytes: row.outputBytes, retainedSpillBytes: row.retainedSpillBytes }
}
async function stream(handle: ShellExecution, name: 'stdout' | 'stderr', result?: ShellRunResult): Promise<{ value: Stream; unknownSpill: boolean }> {
  const observed = handle.observed[name].readFrom(0), path = result?.[name].spillPath ?? observed.spillPath
  if (!integer(observed.nextOffset)) throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  const value: Stream = { bytes: observed.nextOffset, spill: null }
  if (!path) return { value, unknownSpill: observed.lossy || result?.[name].truncated === true }
  try {
    const info = await lstat(path, { bigint: true })
    if (!isAbsolute(path) || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n
      || info.size !== BigInt(observed.nextOffset)) throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
    value.spill = { path, identity: `${info.dev}:${info.ino}`, bytes: Number(info.size) }
    return { value, unknownSpill: false }
  } catch (error) {
    // A missing/failed spill observation cannot erase the independently observed whole-stream coordinate.
    void error; return { value, unknownSpill: true }
  }
}
/** One operation's refusal latch: completed actions retain their original results; only subsequent admission throws. */
export class EngineeringShellRun {
  private readonly runs: EngineeringShellResult['runs'] = []
  private diagnostic: string | null = null
  constructor(private readonly id: string, readonly budget: EngineeringShellBudget) {}
  /** Refuse subsequent execution after an unknown or exhausted complete output observation. */
  check(): void { if (this.diagnostic) throw Error(this.diagnostic) }
  /** Observe the settled real handle without consuming its output cursor or replacing its result.
   * @param handle - Original Shell handle after result settlement.
   * @param result - Original result, absent only for infrastructure failure.
   */
  async settled(handle: ShellExecution, result?: ShellRunResult): Promise<void> {
    const row: EngineeringShellResult['runs'][number] = { stdout: { bytes: null, spill: null }, stderr: { bytes: null, spill: null } }
    this.runs.push(row)
    for (const name of ['stdout', 'stderr'] as const) {
      try {
        const observed = await stream(handle, name, result)
        row[name] = observed.value
        if (observed.unknownSpill) this.diagnostic = 'EXPERIMENT_RESOURCE_SHELL_UNKNOWN'
      }
      catch (error) { void error; this.diagnostic ??= 'EXPERIMENT_RESOURCE_SHELL_UNKNOWN' }
    }
    const bytes = this.runs.reduce((total, run) => total + (run.stdout.bytes ?? 0) + (run.stderr.bytes ?? 0), 0)
    if (!Number.isSafeInteger(bytes) || bytes >= this.budget.outputBytes) this.diagnostic ??= 'EXPERIMENT_RESOURCE_SHELL_LIMIT'
    if (!result) this.diagnostic ??= 'EXPERIMENT_RESOURCE_SHELL_UNKNOWN'
  }
  /** Return independent stream observations, preserving unknowns and every original spill identity.
   * @returns Detached publication input; no peak or full-output recovery claim is added.
   */
  result(): EngineeringShellResult {
    return { schemaVersion: 1, kind: 'engineering-shell-result', id: this.id, runs: structuredClone(this.runs), diagnostic: this.diagnostic }
  }
}
/** Bind only the current isolated engineering Session to the actual Workbench Shell consumer. */
export class EngineeringShellObserver {
  private readonly scopes = new Map<SessionId, EngineeringShellRun>()
  /** Bind one admitted run and return its disposer.
   * @param id - Explicit official Session identity.
   * @param run - Current independently budgeted operation.
   * @returns Removal after Shell and Agent drainage.
   */
  bind(id: SessionId, run: EngineeringShellRun): () => void {
    if (this.scopes.has(id)) throw Error('EXPERIMENT_RESOURCE_SHELL_BUSY')
    this.scopes.set(id, run); return () => { this.scopes.delete(id) }
  }
  /** Find the operation attached to the actual caller Session.
   * @param id - Caller identity, absent for local non-Agent work.
   * @returns Scoped owner or undefined for operations outside engineering experiments.
   */
  get(id: SessionId | undefined): EngineeringShellRun | undefined { return id ? this.scopes.get(id) : undefined }
}
/** Validate original independent observations without reconstructing missing historical output.
 * @param input - Retained sidecar.
 * @param id - Original run identity.
 * @returns Original bounded observation, with invalid coordinates or fields refused.
 */
export function parseEngineeringShellResult(input: unknown, id: string): EngineeringShellResult {
  const row = object(input)
  if (Object.keys(row).sort().join() !== 'diagnostic,id,kind,runs,schemaVersion' || row.schemaVersion !== 1
    || row.kind !== 'engineering-shell-result' || row.id !== id || !Array.isArray(row.runs) || row.runs.length > 8
    || row.diagnostic !== null && (typeof row.diagnostic !== 'string'
      || !['EXPERIMENT_RESOURCE_SHELL_UNKNOWN', 'EXPERIMENT_RESOURCE_SHELL_LIMIT'].includes(row.diagnostic))) {
    throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
  }
  const runs = row.runs.map((input: unknown) => {
    const run = object(input)
    if (Object.keys(run).sort().join() !== 'stderr,stdout') throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
    const read = (input: unknown): Stream => {
      const value = object(input)
      if (Object.keys(value).sort().join() !== 'bytes,spill' || value.bytes !== null && !integer(value.bytes)) throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
      if (value.spill === null) return { bytes: value.bytes, spill: null }
      const spill = object(value.spill)
      if (Object.keys(spill).sort().join() !== 'bytes,identity,path' || typeof spill.path !== 'string' || !isAbsolute(spill.path)
        || spill.path.length > 4096 || typeof spill.identity !== 'string' || !/^\d+:\d+$/u.test(spill.identity)
        || !integer(spill.bytes) || spill.bytes !== value.bytes) throw Error('EXPERIMENT_RESOURCE_SHELL_RECORD_INVALID')
      return { bytes: value.bytes, spill: { path: spill.path, identity: spill.identity, bytes: spill.bytes } }
    }
    return { stdout: read(run.stdout), stderr: read(run.stderr) }
  })
  return { schemaVersion: 1, kind: 'engineering-shell-result', id, runs, diagnostic: row.diagnostic }
}
/** Validate existing spills and retain at least each run's full output reservation across subsequent admissions.
 * @param budget - Original confirmed allowance.
 * @param result - Original drained sidecar; missing or incomplete output refuses new work.
 * @returns Persistent charge, including actual over-limit spill bytes; no file is removed.
 */
export async function engineeringShellCharge(budget: EngineeringShellBudget, result: EngineeringShellResult | null): Promise<number> {
  if (!result || result.runs.some(run => run.stdout.bytes === null || run.stderr.bytes === null)
    || result.diagnostic === 'EXPERIMENT_RESOURCE_SHELL_UNKNOWN') throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  let bytes = 0
  const outputBytes = result.runs.reduce((sum, run) => sum + (run.stdout.bytes ?? 0) + (run.stderr.bytes ?? 0), 0)
  for (const run of result.runs) for (const name of ['stdout', 'stderr'] as const) {
    const spill = run[name].spill
    if (!spill) continue
    const info = await lstat(spill.path, { bigint: true })
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || `${info.dev}:${info.ino}` !== spill.identity
      || info.size !== BigInt(spill.bytes)) throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
    bytes += spill.bytes
  }
  if (!integer(bytes) || !integer(outputBytes)) throw Error('EXPERIMENT_RESOURCE_SHELL_UNKNOWN')
  return Math.max(budget.outputBytes, outputBytes, bytes)
}
