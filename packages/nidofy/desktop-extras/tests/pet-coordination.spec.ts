/** Session-level local commands remain distinct from execution and notification delivery. */
import { expect, it, vi } from 'vitest'
import { PetCoordination, parsePetCommand } from '../src/pet-coordination.ts'
const command = { actionId: '11111111-1111-1111-1111-111111111111', action: 'bind', target: '1', sessionId: 'old-session',
  scopeVersion: 7, generation: 'actual-feed', expiry: 2000 }
const signal = () => new AbortController().signal
function fixture() {
  const current = { enabled: true, revision: 7, generation: 'actual-feed' }, ensure = vi.fn(async () => {}), update = vi.fn(async () => ({ updated: true }))
  return { current, ensure, update, owner: new PetCoordination(() => current, ensure, update, () => 1000) }
}
it('requires complete expiring scope fields and rejects unrelated fields or an expired action', () => {
  expect(parsePetCommand(command, 1000)).toEqual(command)
  for (const input of [{ ...command, expiry: 1000 }, { ...command, scopeVersion: -1 }, { ...command, extra: true },
    { ...command, sessionId: '../escape' }, { ...command, action: 'execute' }, { ...command, expiry: 16001 }]) {
    expect(() => parsePetCommand(input, 1000)).toThrow('PET_COMMAND_INVALID')
  }
})
it('loads the explicit historical Session before delegating binding to the original owner', async () => {
  const f = fixture(); expect(await f.owner.execute(command, signal())).toEqual({ updated: true })
  expect(f.ensure).toHaveBeenCalledWith('old-session', expect.any(AbortSignal)); expect(f.update).toHaveBeenCalledWith(command)
})
it('consumes action identity before async work so simultaneous duplicates cannot execute', async () => {
  const f = fixture(), first = f.owner.execute(command, signal())
  expect(() => f.owner.execute(command, signal())).toThrow('PET_COMMAND_DUPLICATE')
  await first; expect(f.update).toHaveBeenCalledTimes(1)
})
it('refuses a preference or generation race during the historical read without committing', async () => {
  const f = fixture(); f.ensure.mockImplementation(async () => { f.current.revision++ })
  await expect(f.owner.execute(command, signal())).rejects.toThrow('PET_TARGET_CHANGED'); expect(f.update).not.toHaveBeenCalled()
  const other = fixture(); other.current.generation = 'replacement-feed'
  await expect(other.owner.execute(command, signal())).rejects.toThrow('PET_TARGET_CHANGED'); expect(other.ensure).not.toHaveBeenCalled()
})
it('refuses a disconnected command after cold reading, with no automatic retry', async () => {
  const f = fixture(), controller = new AbortController()
  f.ensure.mockImplementation(async () => { controller.abort(Error('DISCONNECTED')) })
  await expect(f.owner.execute(command, controller.signal)).rejects.toThrow('DISCONNECTED'); expect(f.update).not.toHaveBeenCalled()
  expect(() => f.owner.execute(command, signal())).toThrow('PET_COMMAND_DUPLICATE')
})
it.each(['unbind', 'mute', 'unmute', 'interact'])('delegates explicit %s without cold loading or dispatching model work', async (action) => {
  const f = fixture(); await f.owner.execute({ ...command, action }, signal()); expect(f.ensure).not.toHaveBeenCalled()
  expect(f.update).toHaveBeenCalledWith({ ...command, action })
})
it('keeps optional feature disable and disposal effective for every command', async () => {
  const f = fixture(); f.current.enabled = false
  await expect(f.owner.execute(command, signal())).rejects.toThrow('PET_COMMAND_UNAVAILABLE'); expect(f.update).not.toHaveBeenCalled()
  const other = fixture(); await other.owner.close(); expect(() => other.owner.execute(command, signal())).toThrow('PET_COMMAND_UNAVAILABLE')
})
