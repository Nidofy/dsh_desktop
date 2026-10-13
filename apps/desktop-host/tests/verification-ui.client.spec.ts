// @vitest-environment jsdom
/** Actual bilingual receipt controls; transport fixture supplies committed independent facts and CAS acceptance. */
import { Script } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { workbenchHtml } from '../src/workbench/ui.ts'

const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
})
afterEach(() => {
  document.body.replaceChildren()
  for (const method of ['showModal', 'close']) {
    const original = dialogMethods[method]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  }
})
async function mount(zh: boolean) {
  const html = workbenchHtml(zh), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Expected workbench script')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  const requests: Record<string, unknown>[] = [], id = '11111111-1111-1111-1111-111111111111'
  const view = { phase: 'COMMITTED', receipt: { id, runId: id, tests: 'PASSED', coverage: 'complete', freshness: 'STALE',
    acceptance: 'PENDING', artifacts: [] }, acceptanceRevision: 0, logAvailable: true }
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split('/workbench/')[1]
    if (typeof init.body !== 'string') throw Error('Expected JSON request')
    const request: unknown = JSON.parse(init.body)
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('Expected request object')
    requests.push({ method, ...request })
    if (method === 'notifications/preferences') return Response.json({ revision: 0, enabled: false })
    if (method === 'verification/list') return Response.json({ ids: [id], next: null })
    if (method === 'verification/inspect') return Response.json(view)
    if (method === 'verification/log') return Response.json({ text: 'retained actual log' })
    if (method === 'verification/accept') {
      if (!('expectedRevision' in request) || request.expectedRevision !== view.acceptanceRevision) return Response.json({ error: 'VERIFICATION_ACCEPTANCE_CONFLICT' }, { status: 409 })
      view.acceptanceRevision++; view.receipt.acceptance = 'decision' in request ? String(request.decision) : 'INVALID'
      return Response.json(view)
    }
    return Response.json({ config: { actions: [] }, trusted: true, runs: [{ id, label: 'Isolated test', status: 'PASS', exitCode: 0 }] })
  })
  new Script(script).runInNewContext({ document, fetch, location: { search: '?tab=builds&workspace=C:/isolated' },
    URLSearchParams, localStorage: { getItem: () => null, setItem: () => {} }, BroadcastChannel: class { postMessage() {} close() {} },
    window, setInterval: () => 1, setTimeout: () => 1, crypto: {}, confirm: () => true })
  await vi.waitFor(() => { expect(document.querySelectorAll('[data-receipt]')).toHaveLength(1) })
  return { fetch, requests, id, view }
}

it.each([false, true])('shows stale parsed tests and records an independent local acceptance in Chinese=%s', async (zh) => {
  const f = await mount(zh)
  document.querySelector<HTMLButtonElement>('[data-receipt]')!.click()
  await vi.waitFor(() => { expect(document.getElementById('receiptView')!.textContent).toContain('STALE') })
  expect(document.getElementById('receiptView')!.textContent).toMatchSnapshot()
  document.getElementById('receiptAccept')!.click()
  const dialog = document.querySelector('dialog')!
  expect(document.activeElement).toBe(dialog.querySelector('button'))
  expect(f.requests.some(row => row.method === 'verification/accept')).toBe(false)
  dialog.querySelector<HTMLButtonElement>('button:last-child')!.click()
  await vi.waitFor(() => { expect(document.getElementById('receiptView')!.textContent).toContain('ACCEPTED') })
  expect(f.requests).toContainEqual({ method: 'verification/accept', workspace: 'C:/isolated', id: f.id, expectedRevision: 0, decision: 'ACCEPTED' })
  expect(f.view.receipt.freshness).toBe('STALE')
  expect(f.view.receipt.tests).toBe('PASSED')
  document.getElementById('receiptLog')!.click()
  await vi.waitFor(() => { expect(document.getElementById('runLog')!.textContent).toBe('retained actual log') })
  document.getElementById('loadReceipts')!.click()
  await vi.waitFor(() => { expect(document.querySelectorAll('[data-retained]')).toHaveLength(1) })
})

it('discards a receipt arriving after a workspace change and prevents acceptance in the new workspace', async () => {
  const f = await mount(false)
  let finish: (value: Response) => void = () => { throw Error('Expected held request') }
  f.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const button = document.querySelector<HTMLButtonElement>('[data-receipt]')!
  const pending: unknown = button.onclick!.call(button, new PointerEvent('click'))
  const input = document.getElementById('workspace') as HTMLInputElement
  input.value = 'C:/other'; input.dispatchEvent(new Event('input')); finish(Response.json(f.view)); await pending
  expect(document.getElementById('receiptView')!.textContent).toBe('')
  expect((document.getElementById('receiptAccept') as HTMLButtonElement).disabled).toBe(true)
  expect(f.requests.some(row => row.method === 'verification/accept')).toBe(false)
})
