/** Shared read-only Session recovery projection; source events remain authoritative. */
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import * as legacy from './legacy/task-recovery.mjs'
/** Create an empty recovery projection for the retained Session.
 * @param header - Actual Session header.
 * @param inheritedEventCount - Fork prefix excluded from current events.
 * @returns Initial recovery view. */
export function recoveryInitial(header: SessionHeader, inheritedEventCount = 0): Record<string, unknown> {
  return legacy.recoveryInitial(header, inheritedEventCount)
}
/** Fold one authoritative event into the recovery projection.
 * @param state - Prior recovery view.
 * @param event - Original Session event.
 * @returns Folded view. */
export function recoveryFold(state: Record<string, unknown>, event: SessionEvent): Record<string, unknown> {
  return legacy.recoveryFold(state, event)
}
/** Read projected facts together with current owner availability.
 * @param state - Folded view.
 * @param running - Actual live-owner observation.
 * @returns Read-only current recovery facts. */
export function recoveryView(state: Record<string, unknown>, running: boolean): Record<string, unknown> {
  return legacy.recoveryView(state, running)
}
/** Map a turn end reason without promoting unknown extensions to success.
 * @param kind - Original turn/end reason.
 * @returns Shared semantic state; unknown extensions remain unknown. */
export function terminalStatus(kind: unknown): 'COMPLETED' | 'CANCELLED' | 'BLOCKED' | 'FAILED' | 'LIMIT_REACHED' | 'INTERRUPTED' | 'UNKNOWN' {
  return legacy.terminalStatus(kind)
}
