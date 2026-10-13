/** Bounded, secret-free Electron self-test records; no Session or model input is stored here. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { checks, codes } from './catalogue.ts'

/** Caller-retained identity for inspect after an uncertain start response. */
export type SelfTestRunId = Branded<'nidofy.SelfTestRunId'>
/** Expiring single-use confirmation identity issued by the authenticated connection-check owner. */
export type SelfTestConfirmationId = Branded<'nidofy.SelfTestConfirmationId'>
/** Stable measurement identity, never localized text. */
export type CheckId = typeof checks[number][0]
/** Qualification applies only to the named measurement. */
export type CheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIPPED'
/** Whitelisted diagnostic code. */
export type CheckCode = typeof codes[number]
/** Numeric observations only; paths, accounts, models and text are deliberately absent. */
export interface CheckMetrics {
  bytes?: number
  files?: number
  requests?: number
  quotaRefusals?: number
  exitCode?: number
  cancelled?: number
  timedOut?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
}
/** One checkpoint, including whether execution had started before process loss. */
export interface CheckRow {
  id: CheckId
  phase: 'PENDING' | 'RUNNING' | 'SETTLED'
  status: CheckStatus
  code: CheckCode
  durationMs: number | null
  metrics: CheckMetrics
}
/** Explicit measured result; completing a callback never implicitly grants PASS. */
export type CheckResult = Pick<CheckRow, 'status' | 'code' | 'metrics'>
/** Durable owner record. Version 1 local reports remain readable; version 2 adds confirmed provider budgets. */
export interface SelfTestReport {
  schemaVersion: 1 | 2
  kind: 'electron-self-test'
  id: SelfTestRunId
  mode: 'local' | 'provider'
  status: 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'TIMEOUT' | 'INTERRUPTED' | 'FAILED'
  startedAt: number
  endedAt: number | null
  warning: CheckCode | null
  budget: { modelRequests: number; timeoutMs: 180000; retries: 0; maxOutputTokens?: 64 }
  rows: CheckRow[]
}
