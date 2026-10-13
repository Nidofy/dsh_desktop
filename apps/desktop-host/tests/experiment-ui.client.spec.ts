// @vitest-environment jsdom
/** Bilingual local-user controls preserve unknown records and discard late reads without task execution. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { experimentsHtml } from '../src/experiments/ui.ts'

afterEach(() => { document.body.replaceChildren(); localStorage.clear() })
const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222'
const selection = { experimentId: a, caseId: b, factor: 'notebook',
  a: { workspace: 'C:/isolated', runId: a }, b: { workspace: 'C:/isolated', runId: b } }
const comparison = { selection, verification: 'MATCHED', task: 'UNKNOWN', quality: 'BOTH_ACCEPTED',
  a: { receipt: { tests: 'PASSED', freshness: 'CURRENT', acceptance: 'ACCEPTED' } },
  b: { receipt: { tests: 'PASSED', freshness: 'CURRENT', acceptance: 'ACCEPTED' } },
  checks: [{ name: 'source', result: 'SAME' }, { name: 'model-input', result: 'UNKNOWN' }, { name: 'factor-state', result: 'UNKNOWN' }],
  counts: { requests: { a: null, b: null, missing: 2 }, inputTokens: { a: null, b: null, missing: 2 },
    outputTokens: { a: null, b: null, missing: 2 }, cacheReadTokens: { a: null, b: null, missing: 2 }, tests: { a: 1, b: 1, missing: 0 } } }
async function mount(zh: boolean) {
  const html = experimentsHtml(zh), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Expected comparison script')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  const requests: { method: string; data: Record<string, unknown> }[] = []
  let saved: Record<string, unknown> | null = null
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('Expected request body')
    const data: unknown = JSON.parse(init.body)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Expected request object')
    const method = url.split('/workbench/')[1]!
    requests.push({ method, data: data as Record<string, unknown> })
    if (method === 'verification/list') return Response.json({ ids: [a, b], next: null })
    if (method === 'experiments/compare') return Response.json(comparison)
    if (method === 'experiments/model-step') return Response.json({ status: 'UNKNOWN', diagnostic: 'EXPERIMENT_MODEL_SOURCE_UNAVAILABLE',
      counts: { requests: null }, dispatchInput: null, taskTotals: null })
    if (method === 'experiments/record') {
      saved = { id: 'id' in data ? data.id : null, recordedAt: 0, selection }
      return Response.json(saved)
    }
    if (method === 'experiments/read') return Response.json(saved ? { record: saved, comparison, changedSinceRecord: true } : null)
    if (method === 'experiments/list') return Response.json(saved ? [saved] : [])
    return Response.json({ error: 'EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED' }, { status: 400 })
  })
  new Script(script).runInNewContext({ document, fetch, location: { search: '?workspace=C:/isolated' },
    URLSearchParams, localStorage, window, AbortController, TextDecoder, Blob, URL, Date,
    crypto: { randomUUID: () => '33333333-3333-3333-3333-333333333333' } })
  expect(fetch).not.toHaveBeenCalled()
  const click = async (id: string) => {
    const button = document.getElementById(id) as HTMLButtonElement
    await button.onclick!.call(button, new PointerEvent('click'))
  }
  return { fetch, requests, click, published: () => saved }
}
it.each([false, true])('previews a single private task in Chinese=%s, invalidates edited input and sends only an explicit confirmation', async (zh) => {
  const f = await mount(zh)
  for (const [id, value] of [['taskConnection', 'local'], ['taskModel', 'alias'], ['taskText', 'Complete private task']] as const) {
    const field = document.getElementById(id) as HTMLInputElement
    field.value = value
  }
  expect(document.body.textContent).toContain(zh ? '预览显式选择的 Notebook 输入' : 'Preview any explicitly selected Notebook input')
  expect(document.getElementById('taskPrepare')!.closest('section')!.textContent).toMatchSnapshot()
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ ticket: a, text: 'Complete private task',
    budget: { requests: 1, retries: 0 }, exactModelVersion: null })))
  await f.click('taskPrepare')
  expect(f.requests).toEqual([])
  expect(document.getElementById('taskPreview')!.textContent).toContain('Complete private task')
  const text = document.getElementById('taskText') as HTMLTextAreaElement
  text.dispatchEvent(new Event('input'))
  expect((document.getElementById('taskConfirm') as HTMLButtonElement).disabled).toBe(true)
  await f.click('taskConfirm'); expect(f.fetch).toHaveBeenCalledTimes(1)
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ ticket: b, text: text.value, budget: { requests: 1, retries: 0 } })))
  await f.click('taskPrepare')
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ id: a, status: 'RUNNING' })))
  await f.click('taskConfirm'); await f.click('taskConfirm')
  expect(f.fetch).toHaveBeenCalledTimes(3)
  expect(JSON.parse(f.fetch.mock.calls[2]![1].body as string)).toMatchObject({ ticket: b, accepted: true })
  expect(localStorage.getItem('nidofy-task-request-pending')).toBe('33333333-3333-3333-3333-333333333333')
})
it('retains an unknown task start across reload without automatic private reads or repeat sends', async () => {
  localStorage.setItem('nidofy-task-request-pending', a)
  const f = await mount(false)
  expect(f.fetch).not.toHaveBeenCalled()
  expect((document.getElementById('taskId') as HTMLInputElement).value).toBe(a)
  await f.click('taskPrepare'); expect(f.fetch).not.toHaveBeenCalled()
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json(null)))
  await f.click('taskRead')
  expect(localStorage.getItem('nidofy-task-request-pending')).toBe(a)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it.each([false, true])('requires the complete explicit Notebook preview in Chinese=%s and discards a late source selection', async (zh) => {
  const f = await mount(zh), field = document.getElementById('taskNotebook') as HTMLInputElement
  field.value = 'explicit-source'
  let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const pending = f.click('taskPrepare')
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body as string)).toMatchObject({ notebookSessionId: 'explicit-source' })
  field.value = 'other-source'; field.dispatchEvent(new Event('input'))
  finish(Response.json({ ticket: a, notebookInput: { text: 'Private old source input' } })); await pending
  expect(document.getElementById('taskPreview')!.textContent).toBe('')
  expect((document.getElementById('taskConfirm') as HTMLButtonElement).disabled).toBe(true)
  const text = '<script>Private committed source</script>'
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ ticket: b, notebookInput: { text, revision: 7 } })))
  await f.click('taskPrepare')
  expect(document.getElementById('taskPreview')!.textContent).toContain(text)
  expect(document.querySelector('#taskPreview script')).toBeNull()
  expect(f.fetch).toHaveBeenCalledTimes(2)
})
it('clears private selecting-step input immediately while a history read is held and discards the old late side', async () => {
  const f = await mount(false)
  await f.click('load'); await f.click('compare'); await f.click('archive'); await f.click('history'); await f.click('modelA')
  expect(document.getElementById('model')!.textContent).not.toBe('')
  let finishModel!: (value: Response) => void, finishHistory!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishModel = resolve }))
  const model = f.click('modelA')
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishHistory = resolve }))
  const button = document.querySelector<HTMLButtonElement>('#records button')!
  const history = (async () => { await button.onclick!.call(button, new PointerEvent('click')) })()
  expect(document.getElementById('model')!.textContent).toBe('')
  expect((document.getElementById('modelA') as HTMLButtonElement).disabled).toBe(true)
  finishModel(Response.json({ privateInput: 'old side' })); await model
  expect(document.getElementById('model')!.textContent).toBe('')
  finishHistory(Response.json({ record: f.published(), comparison, changedSinceRecord: false })); await history
  expect(document.getElementById('model')!.textContent).toBe('')
})
it.each([false, true])('renders independent facts/missing counters in Chinese=%s and archives only on an explicit action', async (zh) => {
  const f = await mount(zh)
  await f.click('load'); await f.click('compare')
  expect(document.getElementById('result')!.textContent).toMatchSnapshot()
  expect(document.querySelector<HTMLAnchorElement>('#result a')!.getAttribute('href'))
    .toContain('receipt=' + a)
  expect(f.requests.map(row => row.method)).toEqual(['verification/list', 'experiments/compare'])
  expect((document.getElementById('archive') as HTMLButtonElement).disabled).toBe(false)
  await f.click('archive')
  expect(f.requests[2]).toMatchObject({ method: 'experiments/record', data: { selection } })
  expect(localStorage.getItem('nidofy-task-comparison-pending')).toBeNull()
  await f.click('history')
  const button = document.querySelector<HTMLButtonElement>('#records button')!
  await button.onclick!.call(button, new PointerEvent('click'))
  expect(document.getElementById('status')!.textContent).toBe(zh ? '当前回执观察与已保存选择不同。'
    : 'Current receipt observations differ from this saved selection.')
  expect(f.requests.some(row => /start|accept|cache\/|selftest/.test(row.method))).toBe(false)
})
it.each([false, true])('reads private model-step evidence only on an explicit action in Chinese=%s and rejects a late side result', async (zh) => {
  const f = await mount(zh)
  expect(document.getElementById('model')!.textContent).toBe('')
  await f.click('load'); await f.click('compare')
  expect(f.requests.some(row => row.method === 'experiments/model-step')).toBe(false)
  await f.click('modelA')
  expect(f.requests.at(-1)).toMatchObject({ method: 'experiments/model-step', data: { side: 'a', selection } })
  expect(document.getElementById('model')!.textContent).toContain('"requests": null')
  expect(document.body.textContent).toContain(zh ? '日志输入前缀不等于已确认发送输入' : 'A logged input prefix is not a confirmed dispatch input')
  let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const pending = f.click('modelA')
  await f.click('modelB')
  const shown = document.getElementById('model')!.textContent
  finish(Response.json({ status: 'LINKED', privateInput: 'late side A' })); await pending
  expect(document.getElementById('model')!.textContent).toBe(shown)
  const factor = document.getElementById('factor') as HTMLSelectElement
  factor.dispatchEvent(new Event('change'))
  expect(document.getElementById('model')!.textContent).toBe('')
  expect((document.getElementById('modelA') as HTMLButtonElement).disabled).toBe(true)
})
it('clears private model evidence when history changes the visible receipt selection and reads only that displayed selection', async () => {
  const f = await mount(false)
  await f.click('load'); await f.click('compare'); await f.click('modelA'); await f.click('archive'); await f.click('history')
  const chosen = { ...selection, a: { workspace: 'C:/other', runId: b }, b: { workspace: 'C:/other', runId: a } }
  f.fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ record: f.published(),
    comparison: { ...comparison, selection: chosen }, changedSinceRecord: false })))
  const button = document.querySelector<HTMLButtonElement>('#records button')!
  await button.onclick!.call(button, new PointerEvent('click'))
  expect(document.getElementById('model')!.textContent).toBe('')
  await f.click('modelA')
  expect(f.requests.at(-1)).toMatchObject({ method: 'experiments/model-step', data: { selection: chosen, side: 'a' } })
})
it('discards a late comparison after a selection change and refuses to archive it', async () => {
  const f = await mount(false); await f.click('load')
  let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const pending = f.click('compare')
  const factor = document.getElementById('factor') as HTMLSelectElement
  factor.value = 'cache'; factor.dispatchEvent(new Event('change'))
  finish(Response.json(comparison)); await pending
  expect(document.getElementById('result')!.textContent).toBe('')
  expect((document.getElementById('archive') as HTMLButtonElement).disabled).toBe(true)
  await f.click('archive')
  expect(f.requests.filter(row => row.method === 'experiments/record')).toEqual([])
})
it('retains an uncertain archive identity across reload and only inspects it on an explicit action', async () => {
  const f = await mount(false); await f.click('load'); await f.click('compare')
  f.fetch.mockRejectedValueOnce(Error('Synthetic response lost'))
  await f.click('archive'); await f.click('archive')
  const retained = localStorage.getItem('nidofy-task-comparison-pending')
  expect(retained).toBe('33333333-3333-3333-3333-333333333333')
  const cold = await mount(false)
  await cold.click('inspect')
  expect(cold.requests).toEqual([{ method: 'experiments/read', data: { id: retained } }])
  expect(document.getElementById('status')!.textContent).toContain('record remains unconfirmed')
  expect(localStorage.getItem('nidofy-task-comparison-pending')).toBe(retained)
})
it('refuses an oversized file before transport and clears only a known pre-publication import refusal', async () => {
  const f = await mount(false), input = document.getElementById('file') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 64 * 1024 + 1 }] })
  await f.click('import'); expect(f.fetch).not.toHaveBeenCalled()
  const bytes = new TextEncoder().encode(JSON.stringify({ id: a }))
  Object.defineProperty(input, 'files', { configurable: true,
    value: [{ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) }] })
  await f.click('import')
  expect(f.requests).toEqual([{ method: 'experiments/import', data: { report: '{"id":"' + a + '"}' } }])
  expect(document.getElementById('status')!.textContent).toContain('EXPERIMENT_IMPORT_SOURCE_UNCONFIRMED')
  expect(localStorage.getItem('nidofy-task-comparison-pending')).toBeNull()
  expect((document.getElementById('inspect') as HTMLButtonElement).disabled).toBe(true)
})
