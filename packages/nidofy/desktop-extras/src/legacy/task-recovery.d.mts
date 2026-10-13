import type {SessionEvent,SessionHeader} from '@deepseek-ai/dsh-session'
export function recoveryInitial(header: SessionHeader,inheritedEventCount?: number): Record<string,unknown>
export function recoveryFold(state: Record<string,unknown>,event: SessionEvent): Record<string,unknown>
export function recoveryView(state: Record<string,unknown>,running: boolean): Record<string,unknown>

export function terminalStatus(kind: unknown): 'COMPLETED'|'CANCELLED'|'BLOCKED'|'FAILED'|'LIMIT_REACHED'|'INTERRUPTED'|'UNKNOWN'
