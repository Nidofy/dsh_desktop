// @vitest-environment jsdom
/** Synthetic fixed closure and an uncooperative renderer factory; local licensed assets and GPU are separate smoke checks. */
import { expect, it, vi, afterEach } from 'vitest'
import { FixedLive2dController, loadBluewhale } from '../src/client/fixed-live2d.ts'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function resourceFixture(modify?: (path: string, bytes: Uint8Array) => Uint8Array | null) {
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
  const resources: Record<string, Uint8Array> = {
    'bluewhale.model3.json': encode({ Version: 3, FileReferences: { Moc: 'bluewhale.moc3', Textures: ['bluewhale.2048/texture_00.png'],
      DisplayInfo: 'bluewhale.cdi3.json', Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] } } }),
    'bluewhale.moc3': new TextEncoder().encode('MOC3 synthetic closure'), 'bluewhale.2048/texture_00.png': new Uint8Array([137, 80, 78, 71]),
    'bluewhale.cdi3.json': encode({}), 'motions/idle.motion3.json': encode({ Version: 3, Curves: [{ Id: 'ParamBodySway' }] }),
  }
  const requested: string[] = [], prefix = '/api/nidofy-extras/assets/companion/bluewhale/live2d/'
  vi.stubGlobal('fetch', async (url: string) => {
    expect(url.startsWith(prefix)).toBe(true); const path = url.slice(prefix.length); requested.push(path)
    const bytes = resources[path]
    if (!bytes) throw Error('Unexpected fixture resource')
    const value = modify ? modify(path, bytes) : bytes
    return value ? new Response(new Uint8Array(value).buffer) : new Response('', { status: 404 })
  })
  return requested
}
it('loads only the five-file fixed closure and rejects a foreign or extra resource before fetching it', async () => {
  const requested = resourceFixture(), resources = await loadBluewhale(new AbortController().signal)
  expect(new TextDecoder().decode(resources.moc)).toBe('MOC3 synthetic closure'); expect(requested).toHaveLength(5)
  resourceFixture((path, bytes) => {
    if (path !== 'bluewhale.model3.json') return bytes
    const model = JSON.parse(new TextDecoder().decode(bytes)) as { FileReferences: { Moc: string } }
    model.FileReferences.Moc = 'https://foreign.invalid/model.moc3'
    return new TextEncoder().encode(JSON.stringify(model))
  })
  await expect(loadBluewhale(new AbortController().signal)).rejects.toThrow('LIVE2D_REFERENCE_REFUSED')
})
it('refuses missing bytes and preserves cancellation before creating any renderer', async () => {
  resourceFixture(path => path.endsWith('.moc3') ? null : new Uint8Array([0]))
  await expect(loadBluewhale(new AbortController().signal)).rejects.toThrow()
  resourceFixture()
  const owner = new FixedLive2dController(), factory = vi.fn()
  const start = owner.start(document.createElement('canvas'), factory), stopped = owner.stop()
  await expect(start).rejects.toThrow(); await stopped; expect(factory).not.toHaveBeenCalled()
})
it('disposes a late renderer and leaves no animation loop after unmount or replacement', async () => {
  resourceFixture(); const frames = new Set<number>(); let next = 0
  vi.stubGlobal('requestAnimationFrame', () => { const id = ++next; frames.add(id); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const gate = Promise.withResolvers<{ draw: () => void; dispose: () => void }>(), renderer = { draw: vi.fn(), dispose: vi.fn() }
  const factory = vi.fn(async () => gate.promise), owner = new FixedLive2dController(), canvas = document.createElement('canvas')
  const start = owner.start(canvas, factory)
  await expect.poll(() => factory.mock.calls.length).toBe(1)
  const stopped = owner.stop(); gate.resolve(renderer)
  await expect(start).rejects.toThrow(); await stopped
  expect(renderer.dispose).toHaveBeenCalledTimes(1); expect(renderer.draw).not.toHaveBeenCalled(); expect(frames.size).toBe(0)
})
