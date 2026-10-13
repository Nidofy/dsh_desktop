// @vitest-environment jsdom
/** Explicit whole-turn comparison reads retain full private facts and reject edited or closed-page late responses. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { experimentsHtml } from '../src/experiments/ui.ts'
afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
async function mount(zh: boolean) {
  const html = experimentsHtml(zh), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Expected engineering comparison controls')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json({ quality: 'UNKNOWN',
    counts: { dispatches: { a: 2, b: null, missing: 1 }, inputTokens: { a: 0, b: null, missing: 1 } },
    resourceCounts: { workspaceBytes: { a: 0, b: null, missing: 1 }, diskPeakBytes: { a: null, b: null, missing: 2 } },
    a: { id: 'original-a', preparedInputs: ['Full private input'], receipts: [{ selection: { workspace: 'isolated', runId: 'original-receipt' } }] } })))
  new Script(script).runInNewContext({ document, fetch, location: { search: '' }, URLSearchParams, localStorage, window,
    AbortController, TextDecoder, Blob, URL, Date, crypto })
  const click = async () => {
    const button = document.getElementById('engineeringCompare') as HTMLButtonElement
    await button.onclick?.call(button, new PointerEvent('click'))
  }
  expect(fetch).not.toHaveBeenCalled(); return { fetch, click }
}
it.each([false, true])('reads explicit original identities with their missing-side counts in Chinese=%s', async (zh) => {
  const f = await mount(zh)
  expect(document.getElementById('engineeringCompare')!.closest('section')!.textContent).toMatchSnapshot()
  ;(document.getElementById('engineeringCompareA') as HTMLInputElement).value = 'original-a'
  ;(document.getElementById('engineeringCompareB') as HTMLInputElement).value = 'original-b'
  await f.click()
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toEqual({ a: 'original-a', b: 'original-b', factor: 'notebook' })
  expect(document.getElementById('engineeringComparison')!.textContent).toContain('Full private input')
  expect(document.getElementById('engineeringComparison')!.textContent).toContain('missing')
  expect(f.fetch).toHaveBeenCalledTimes(1)
  expect(document.getElementById('engineeringComparisonMetrics')!.querySelectorAll('td')).toHaveLength(16)
  expect(document.getElementById('engineeringComparisonMetrics')!.querySelectorAll('td')[5]!.textContent).toBe('0')
  const resources = document.getElementById('engineeringComparisonMetrics')!.querySelectorAll('table')[1]!
  expect(resources.querySelectorAll('td')[1]!.textContent).toBe('0')
  expect(resources.querySelectorAll('td')[2]!.textContent).toBe(zh ? '未知' : 'Unknown')
  expect(resources.querySelectorAll('td')[7]!.textContent).toBe('2')
  const link = document.getElementById('engineeringComparisonMetrics')!.querySelector('a')!
  expect(link.getAttribute('href')).toContain('receipt=original-receipt')
  const original = document.getElementById('engineeringComparisonMetrics')!.querySelector('button')!
  await original.onclick?.call(original, new PointerEvent('click'))
  expect(JSON.parse(f.fetch.mock.calls[1]![1].body as string)).toEqual({ id: 'original-a' })
})
it('discards a changed identity while the original read is pending without another read', async () => {
  const f = await mount(false); let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const pending = f.click(), input = document.getElementById('engineeringCompareB') as HTMLInputElement
  input.value = 'new'; input.dispatchEvent(new Event('input'))
  finish(Response.json({ private: 'old result' })); await pending
  expect(document.getElementById('engineeringComparison')!.textContent).toBe(''); expect(f.fetch).toHaveBeenCalledTimes(1)
})
