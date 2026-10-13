/** Optional application HTTP authorization; proxy routing remains independently owned. */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** One endpoint and policy generation captured before credentials or payload preparation. */
export interface HttpEgressLease {
  /** Whether the captured settings contain an origin restriction. */
  readonly restricted: boolean
  /** Packaged maximum and editable profile revision captured with this lease. */
  readonly revision: Readonly<{ distribution: string; profile: number }>
  /** Recheck the distribution/profile target before saving a shared connection definition.
   * @returns Completion only for the captured policy revision; grants no send permission.
   */
  checkConfiguration(): Promise<void>
  /** Recheck this generation and the actual Session's Workspace before a side effect.
   * @param sessionId - Actual request Session; omission applies all narrower Workspace limits.
   * @returns Completion only while the captured authorization remains usable.
   */
  check(sessionId?: SessionId): Promise<void>
  /** Return a transport bound to the original origin and the actual request scope.
   * @param sessionId - Actual request Session, without synthetic Workspace authority.
   * @returns Fetch implementation that refuses stale authorization and redirects.
   */
  fetchFor(sessionId?: SessionId): typeof globalThis.fetch
}

/** Application provider consumed by model adapters, discovery and MCP HTTP. */
export interface HttpEgressPolicy {
  /** Capture the allowed endpoint and immutable authorization revision.
   * @param url - Provider's resolved HTTP endpoint without credentials, query or fragment.
   * @returns Authorization captured before authentication or payload preparation.
   */
  prepare(url: string): Promise<HttpEgressLease>
  /** Abort and drain owned transports when the supplying application closes. */
  close?(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { outboundHttp: HttpEgressPolicy }
}
