/** Main refuses stale navigation and aborts hidden windows before they can be shown. */
import { expect, it } from 'vitest'
import { CompanionNavigation } from '../src/companion-navigation.ts'
const scope = { hostEpoch: '11111111-1111-1111-1111-111111111111', windowId: 17, viewId: 'chat', panelId: null,
  workspaceId: 'workspace-parent', sessionId: 'parent', turn: 1, revision: 1 }
it('binds to actual window identity and cancels prior revisions, disconnect and document reload', () => {
  const owner = new CompanionNavigation()
  expect(() =>{  owner.publish(100, 18, scope, true) }).toThrow('COMPANION_SCOPE_INVALID')
  owner.publish(100, 17, scope, true)
  const signal = owner.capture(100, 17, { ...scope })
  owner.publish(100, 17, { ...scope, sessionId: 'child', revision: 2 }, true)
  expect(signal.aborted).toBe(true)
  expect(() => owner.capture(100, 17, scope)).toThrow('COMPANION_SCOPE_CHANGED')
  expect(() =>{  owner.publish(100, 17, scope, true) }).toThrow('COMPANION_SCOPE_CHANGED')
  const child = { ...scope, sessionId: 'child', revision: 2 }, next = owner.capture(100, 17, child)
  owner.publish(100, 17, child, false)
  expect(next.aborted).toBe(true)
  expect(() => owner.capture(100, 17, child)).toThrow('COMPANION_SCOPE_CHANGED')
  owner.release(100); owner.publish(100, 17, scope, true)
  expect(owner.capture(100, 17, scope).aborted).toBe(false)
  owner.release(100)
  expect(() => owner.capture(100, 17, scope)).toThrow('COMPANION_SCOPE_CHANGED')
})
