/** Main owns cancellation of an admitted renderer's pending scoped navigation. */
const fields = ['hostEpoch', 'windowId', 'viewId', 'panelId', 'workspaceId', 'sessionId', 'turn', 'revision'] as const
interface Selection {
  readonly fields: readonly unknown[]
  readonly revision: number
  readonly connected: boolean
  readonly lifetime: AbortController
}
function observation(value: unknown, windowId: number): { fields: readonly unknown[]; revision: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('COMPANION_SCOPE_INVALID')
  const row = { ...value } as Record<string, unknown>
  if (Object.keys(row).some(key => !fields.includes(key as typeof fields[number]))
    || row.windowId !== null && row.windowId !== windowId
    || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0
    || row.turn !== null && !(typeof row.turn === 'number' && Number.isSafeInteger(row.turn) && row.turn >= 0)) {
    throw Error('COMPANION_SCOPE_INVALID')
  }
  for (const key of ['hostEpoch', 'viewId', 'panelId', 'workspaceId', 'sessionId']) {
    if (row[key] !== null && (typeof row[key] !== 'string' || row[key].length > 128 || row[key].includes('\0'))) {
      throw Error('COMPANION_SCOPE_INVALID')
    }
  }
  return { fields: fields.map(key => row[key]), revision: row.revision }
}
/** Scope registrations are ephemeral per WebContents document; they grant navigation alone. */
export class CompanionNavigation {
  private readonly selections = new Map<number, Selection>()
  /** Publish only from a separately admitted app top frame.
   * @param sender - Actual WebContents id obtained by Main.
   * @param windowId - Actual BrowserWindow id obtained by Main.
   * @param scope - Renderer observation; ids cannot select another native window.
   * @param connected - Whether the Client has its current Host baseline.
   */
  publish(sender: number, windowId: number, scope: unknown, connected: unknown): void {
    if (typeof connected !== 'boolean') throw Error('COMPANION_SCOPE_INVALID')
    const row = observation(scope, windowId), previous = this.selections.get(sender)
    if (previous && row.revision < previous.revision) throw Error('COMPANION_SCOPE_CHANGED')
    const equal = previous && row.fields.every((field, index) => field === previous.fields[index])
    if (previous && row.revision === previous.revision && !equal) throw Error('COMPANION_SCOPE_CHANGED')
    if (equal && previous.connected === connected) return
    previous?.lifetime.abort()
    this.selections.set(sender, { ...row, connected, lifetime: new AbortController() })
  }
  /** Admit navigation and capture its cancellation before any asynchronous window loading.
   * @param sender - Actual admitted WebContents id.
   * @param windowId - Actual native window id.
   * @param scope - Entire observation supplied with the action.
   * @returns Signal aborted by selection/Host/permission change or document teardown.
   */
  capture(sender: number, windowId: number, scope: unknown): AbortSignal {
    const row = observation(scope, windowId), selected = this.selections.get(sender)
    if (!selected?.connected || row.fields[0] === null || row.fields[1] === null
      || !row.fields.every((field, index) => field === selected.fields[index])) throw Error('COMPANION_SCOPE_CHANGED')
    return selected.lifetime.signal
  }
  /** Invalidate a document before navigation, reload or destruction.
   * @param sender - Main-observed WebContents identity.
   */
  release(sender: number): void { this.selections.get(sender)?.lifetime.abort(); this.selections.delete(sender) }
}
