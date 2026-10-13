// @vitest-environment jsdom
/** Independent engineering controls preview private input, invalidate edits and retain unknown starts without automatic work. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { experimentsHtml } from '../src/experiments/ui.ts'
afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
async function mount(zh: boolean) {
  const html = experimentsHtml(zh), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Expected engineering controls')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(Response.json({ ticket: 'preview-ticket',
    input: { text: 'Complete private task', copy: { paths: ['src'], bytes: 5 } }, reviewedActions: [{ command: 'reviewed local test' }] })))
  new Script(script).runInNewContext({ document, fetch, location: { search: '' }, URLSearchParams, localStorage,
    window, AbortController, TextDecoder, Blob, URL, Date, crypto: { randomUUID: () => '33333333-3333-3333-3333-333333333333' } })
  const click = async (id: string) => {
    const button = document.getElementById(id) as HTMLButtonElement
    await button.onclick?.call(button, new PointerEvent('click'))
  }
  for (const [id, value] of [['Source', 'C:/synthetic'], ['Paths', 'src\ninputs'], ['Actions', 'case'], ['Connection', 'managed'],
    ['Model', 'alias'], ['Text', 'Complete private task']] as const) {
    (document.getElementById('engineering' + id) as HTMLInputElement).value = value
  }
  expect(fetch).not.toHaveBeenCalled()
  return { fetch, click }
}
it('keeps explicit experiment/case identities across independently previewed factor trials and invalidates edited grouping', async () => {
  const f = await mount(false), experiment = document.getElementById('engineeringExperiment') as HTMLInputElement
  const caseId = document.getElementById('engineeringCase') as HTMLInputElement
  experiment.value = '11111111-1111-1111-1111-111111111111'; caseId.value = '22222222-2222-2222-2222-222222222222'
  await f.click('engineeringPrepare'); await f.click('engineeringPrepare')
  for (const row of f.fetch.mock.calls) expect(JSON.parse(row[1].body as string)).toMatchObject({
    experimentId: experiment.value, caseId: caseId.value,
  })
  caseId.value = 'changed'; caseId.dispatchEvent(new Event('input'))
  await f.click('engineeringConfirm'); expect(f.fetch).toHaveBeenCalledTimes(2)
})
it('generates blank grouping labels once without creating a task or automatically sending a request', async () => {
  const f = await mount(false)
  const experiment = document.getElementById('engineeringExperiment') as HTMLInputElement
  expect(experiment.value).toBe(''); await f.click('engineeringPrepare')
  const first = experiment.value; expect(first).not.toBe(''); await f.click('engineeringPrepare')
  expect(experiment.value).toBe(first); expect(f.fetch.mock.calls.every(row => row[0].includes('engineering-prepare'))).toBe(true)
})
it.each([false, true])('requires an independent full input/action/budget confirmation in Chinese=%s', async (zh) => {
  const f = await mount(zh)
  expect(document.getElementById('engineeringPrepare')!.closest('section')!.textContent).toMatchSnapshot()
  await f.click('engineeringPrepare')
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({ text: 'Complete private task',
    paths: ['src', 'inputs'], actionIds: ['case'], budget: { requests: 2, actions: 1, durationMs: 30000 } })
  expect(document.getElementById('engineeringPreview')!.textContent).toContain('reviewed local test')
  expect(f.fetch).toHaveBeenCalledTimes(1)
  f.fetch.mockRejectedValueOnce(Error('unconfirmed response'))
  await f.click('engineeringConfirm')
  expect(f.fetch.mock.calls[1]![0]).toContain('engineering-start')
  expect(localStorage.getItem('nidofy-engineering-task-pending')).toBe('33333333-3333-3333-3333-333333333333')
  await f.click('engineeringPrepare'); expect(f.fetch).toHaveBeenCalledTimes(2)
})
it('revokes edited previews and discards late private input without dispatch', async () => {
  const f = await mount(false)
  let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const preview = f.click('engineeringPrepare')
  const text = document.getElementById('engineeringText') as HTMLTextAreaElement
  text.value = 'changed'; text.dispatchEvent(new Event('input'))
  finish(Response.json({ ticket: 'late', input: { text: 'private old input' } })); await preview
  expect(document.getElementById('engineeringPreview')!.textContent).toBe('')
  await f.click('engineeringConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('restores only an unknown identity and never reads, starts or cancels it automatically', async () => {
  localStorage.setItem('nidofy-engineering-task-pending', 'unconfirmed-id')
  const f = await mount(false)
  expect((document.getElementById('engineeringId') as HTMLInputElement).value).toBe('unconfirmed-id')
  await f.click('engineeringPrepare'); expect(f.fetch).not.toHaveBeenCalled()
  f.fetch.mockResolvedValueOnce(Response.json(null)); await f.click('engineeringRead')
  expect(localStorage.getItem('nidofy-engineering-task-pending')).toBe('unconfirmed-id')
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('includes only an explicit Notebook source and revokes the full preview when it changes', async () => {
  const f = await mount(false), source = document.getElementById('engineeringNotebook') as HTMLInputElement
  source.value = 'explicit-notebook-source'
  await f.click('engineeringPrepare')
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({ notebookSessionId: 'explicit-notebook-source' })
  source.value = 'changed-source'; source.dispatchEvent(new Event('input'))
  expect(document.getElementById('engineeringPreview')!.textContent).toBe('')
  expect((document.getElementById('engineeringConfirm') as HTMLButtonElement).disabled).toBe(true)
  await f.click('engineeringConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('confirms only the explicitly selected current cache mode and invalidates changed selections', async () => {
  const f = await mount(false), mode = document.getElementById('engineeringCache') as HTMLSelectElement
  mode.value = 'off'; await f.click('engineeringPrepare')
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({ cacheMode: 'off' })
  mode.value = 'session'; mode.dispatchEvent(new Event('input'))
  await f.click('engineeringConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('confirms complete explicit resource limits and invalidates edited limits before any start', async () => {
  const f = await mount(false), resources = document.getElementById('engineeringResources') as HTMLTextAreaElement
  await f.click('engineeringPrepare')
  const expectedResources: unknown = JSON.parse(resources.value)
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({ resourceBudget: expectedResources })
  resources.value = '{}'; resources.dispatchEvent(new Event('input'))
  await f.click('engineeringConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
  expect((document.getElementById('engineeringConfirm') as HTMLButtonElement).disabled).toBe(true)
})
