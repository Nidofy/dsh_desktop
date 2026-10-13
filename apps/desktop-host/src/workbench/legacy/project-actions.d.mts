import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
/** Locally reviewed input closure. Complete is an explicit assertion that all command dependencies are selected. */
export interface VerificationSpec { schemaVersion: 1; intent: string; parser: 'node-tap-13/1' | null; coverage: 'complete' | 'unknown'; sources: string[]; inputs: string[]; toolchain: string[]; parameters: Record<string,string | number | boolean | null> }
export interface Action { id: string; label: string; command: string; cwd: string; timeoutMs: number; env: Record<string,string>; artifacts?: string[]; verification?: VerificationSpec }
export interface Run extends Record<string,unknown> { id: string; status: string; artifacts?: string[] }
export interface View { workspace: string; config: { schemaVersion: number; actions: Action[] }; fingerprint: string; configRevision?: number; trusted: boolean; runs: Run[] }
/** Owner hooks run in the action's admitted storage context; prepare must finish before Shell starts. */
export interface VerificationHooks {
  revision(directory: string, fingerprint: string): Promise<number>
  queued(workspace: string, run: Run, action: Action, revision: number, scope: {sessionId: string} | null): Promise<void>
  prepare(workspace: string, run: Run, action: Action, observation: ExecutionObservation): Promise<void>
  settled(workspace: string, run: Run): Promise<void>
}
/** Real resolver/provider observations; null provider inputs keep coverage unknown. */
export interface ExecutionObservation { settings: object; provider: { executablePaths: readonly string[]; configuration: object } | null }
export class ActionError extends Error { code: string }
export function validateActionConfig(value: unknown): View['config']
export class ProjectActions {
  constructor(home: string, execute: (action: Action & {runId: string; workspace: string; signal: AbortSignal; context?: ToolRunContext; recordExecution?: (observation: ExecutionObservation) => Promise<void>}) => Promise<ShellRunResult>, hooks?: VerificationHooks)
  inspect(path: string): Promise<View>
  save(path: string, value: unknown): Promise<View>
  trust(path: string, fingerprint: string): Promise<View>
  revoke(path: string): Promise<View>
  start(path: string, actionId: string, options?: {signal?: AbortSignal; context?: ToolRunContext; source?: string}): Promise<Run>
  wait(path: string, id: string): Promise<Run>
  cancel(path: string, id: string): Promise<unknown>
  log(path: string, id: string): Promise<string>
  logReference(path: string, id: string): Promise<{root: string; path: string}>
  close(): Promise<void>
}
