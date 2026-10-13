// @vitest-environment jsdom
/** Matrix confirmation displays complete rows and preserves unknown identities without automatic sends or retries. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { experimentsHtml } from '../src/experiments/ui.ts'
afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
async function mount(zh: boolean) {
  const html = experimentsHtml(zh), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Expected matrix script')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json({ ticket: 'matrix-ticket',
    rows: [{ id: 'row-a', preview: { input: { text: 'Full task' } } }, { id: 'row-b', preview: { input: { text: 'Full task' } } }] })))
  new Script(script).runInNewContext({ document, fetch, location: { search: '' }, URLSearchParams, localStorage, window,
    AbortController, TextDecoder, Blob, URL, Date, crypto: { randomUUID: () => '33333333-3333-3333-3333-333333333333' } })
  expect(fetch).not.toHaveBeenCalled()
  const click = async (id: string) => {
    const button = document.getElementById(id) as HTMLButtonElement
    await button.onclick?.call(button, new PointerEvent('click'))
  }
  return { fetch, click }
}
it.each([false, true])('requires the full row and aggregate budget preview in Chinese=%s', async (zh) => {
  const f = await mount(zh)
  expect(document.getElementById('matrixPrepare')!.closest('section')!.textContent).toMatchSnapshot()
  ;(document.getElementById('matrixRows') as HTMLTextAreaElement).value = '[{"text":"Full task"},{"text":"Full task"}]'
  await f.click('matrixPrepare')
  expect(document.getElementById('matrixPreview')!.textContent).toContain('row-b')
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({
    budget: { requests: 4, outputTokens: 256, durationMs: 30000 },
  })
  f.fetch.mockRejectedValueOnce(Error('unconfirmed'))
  await f.click('matrixConfirm'); expect(localStorage.getItem('nidofy-engineering-matrix-pending')).not.toBeNull()
  await f.click('matrixPrepare'); expect(f.fetch).toHaveBeenCalledTimes(2)
})
it('invalidates edited row inputs and discards late previews without dispatch', async () => {
  const f = await mount(false); let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const preview = f.click('matrixPrepare'), field = document.getElementById('matrixRows') as HTMLTextAreaElement
  field.value = '[{}]'; field.dispatchEvent(new Event('input'))
  finish(Response.json({ ticket: 'late', rows: [{ private: 'old' }] })); await preview
  expect(document.getElementById('matrixPreview')!.textContent).toBe('')
  await f.click('matrixConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('restores an unconfirmed identity without reading or resubmitting', async () => {
  localStorage.setItem('nidofy-engineering-matrix-pending', 'unknown-id')
  const f = await mount(false)
  expect((document.getElementById('matrixId') as HTMLInputElement).value).toBe('unknown-id')
  await f.click('matrixPrepare'); expect(f.fetch).not.toHaveBeenCalled()
})
it('reads an import only on explicit action, bounds file size and rejects changed files during a read', async () => {
  const f = await mount(false), input = document.getElementById('matrixFile') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 1048577, text: vi.fn() }] })
  await f.click('matrixImport'); expect(f.fetch).not.toHaveBeenCalled()
  let finish!: (value: string) => void
  Object.defineProperty(input, 'files', { configurable: true,
    value: [{ size: 10, text: () => new Promise<string>((resolve) => { finish = resolve }) }] })
  const pending = f.click('matrixImport'); input.dispatchEvent(new Event('change'))
  finish('{}'); await pending; expect(f.fetch).not.toHaveBeenCalled()
  Object.defineProperty(input, 'files', { value: [{ size: 2, text: () => Promise.resolve('{}') }] })
  f.fetch.mockResolvedValueOnce(Response.json({ terminal: { status: 'COMPLETED' } }))
  await f.click('matrixImport'); expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toEqual({ report: '{}' })
  expect(document.getElementById('matrixResult')!.textContent).toContain('COMPLETED')
  expect(localStorage.getItem('nidofy-engineering-matrix-pending')).toBeNull()
})
