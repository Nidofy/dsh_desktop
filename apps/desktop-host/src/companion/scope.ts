/** Shared foreground scope parsing and captured authority for explicit companion operations. */
import { symbols, type Context } from '@deepseek-ai/cordis'
import { relative } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandString, brandNumber } from '@deepseek-ai/dsh-brand'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { CompanionScope, CompanionHostEpoch, CompanionWindowId, CompanionViewId } from '@nidofy/dsh-desktop-extras/context'
import type { ConnectionStore } from '../connections/store.ts'
import { object } from '../connections/store.ts'
function implementation<T extends object>(value: T | undefined): T | undefined {
  return value && ((value as T & { [symbols.original]?: T })[symbols.original] ?? value)
}
type IdleScope = CompanionScope & { sessionId: SessionId; workspaceId: WorkspaceId; hostEpoch: CompanionHostEpoch }
/** @param value - Complete authenticated idle foreground identity. @returns Validated scope; partial identities refuse. */
export function parseCompanionScope(value: unknown): IdleScope {
  const row = object(value)
  if (Object.keys(row).sort().join() !== 'hostEpoch,panelId,revision,sessionId,turn,viewId,windowId,workspaceId'
    || typeof row.hostEpoch !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.hostEpoch)
    || !Number.isSafeInteger(row.windowId) || Number(row.windowId) < 1
    || typeof row.viewId !== 'string' || !row.viewId || row.viewId.length > 256 || row.panelId !== null
    || typeof row.workspaceId !== 'string' || !row.workspaceId || row.workspaceId.length > 256
    || typeof row.sessionId !== 'string' || !row.sessionId || row.sessionId.length > 128
    || row.turn !== null || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw Error('ANALYSIS_SCOPE_REQUIRED')
  return { hostEpoch: brandString<CompanionHostEpoch>(row.hostEpoch), windowId: brandNumber<CompanionWindowId>(Number(row.windowId)),
    viewId: brandString<CompanionViewId>(row.viewId), panelId: null, workspaceId: WorkspaceId(row.workspaceId),
    sessionId: SessionId(row.sessionId), turn: null, revision: Number(row.revision) }
}
/** @param ctx - Actual Host owners. @param connections - Managed Host epoch. @param scope - Validated foreground.
 * @returns Recheck of captured Session, Workspace, permission provider and idle foreground before every use.
 */
export function captureCompanionAuthority(ctx: Context, connections: ConnectionStore, scope: IdleScope): () => void {
  const session = ctx.sessions.get(scope.sessionId), registry = ctx.get('workspaceRegistry'), sandbox = ctx.get('sandboxPolicy')
  if (!session || !registry || !sandbox || scope.hostEpoch !== connections.hostEpoch) throw Error('ANALYSIS_SCOPE_CHANGED')
  const permissions = JSON.stringify(sandbox.resolve({ session }))
  return () => {
    const workspace = registry.list().find(row => row.id === scope.workspaceId && row.sessionIds.includes(session.id))
    if (implementation(ctx.get('workspaceRegistry')) !== implementation(registry)
      || implementation(ctx.get('sandboxPolicy')) !== implementation(sandbox)) throw Error('ANALYSIS_OWNER_CHANGED')
    if (ctx.sessions.get(session.id) !== session || scope.hostEpoch !== connections.hostEpoch) throw Error('ANALYSIS_SESSION_CHANGED')
    if (!workspace || !session.header.cwd || relative(workspace.path, session.header.cwd) !== '') throw Error('ANALYSIS_WORKSPACE_CHANGED')
    if (JSON.stringify(sandbox.resolve({ session })) !== permissions) throw Error('ANALYSIS_PERMISSION_CHANGED')
    if (ctx.agents.get(session.id)?.status === 'running') throw Error('ANALYSIS_FOREGROUND_BUSY')
  }
}
