/** Full transient foreground identity shared by Desktop consumers and authenticated Host operations. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
/** Actual managed ConnectionStore epoch. */
export type CompanionHostEpoch = Branded<'NidofyHostEpoch'>
/** Main-owned BrowserWindow identity. */
export type CompanionWindowId = BrandedNumber<'nidofy.CompanionWindowId'>
/** Registered foreground Conversation view. */
export type CompanionViewId = Branded<'nidofy.CompanionViewId'>
/** Null identities remain unavailable; revision advances on permission, view or Host changes. */
export interface CompanionScope {
  readonly hostEpoch: CompanionHostEpoch | null
  readonly windowId: CompanionWindowId | null
  readonly viewId: CompanionViewId | null
  readonly panelId: string | null
  readonly workspaceId: WorkspaceId | null
  readonly sessionId: SessionId | null
  readonly turn: number | null
  readonly revision: number
}
