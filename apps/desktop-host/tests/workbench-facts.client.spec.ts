// @vitest-environment jsdom
/** Actual workbench presentation; isolated transport uses the published execution evidence projection. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { workbenchHtml } from '../src/workbench/ui.ts'

afterEach(() => { document.body.replaceChildren() })
async function mount(zh: boolean) {
  const page = workbenchHtml(zh), script = page.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Missing script')
  document.body.innerHTML = page.replace(/<script>[\s\S]*<\/script>/, '')
  const requests: Record<string, unknown>[] = []
  const evidence = { runId: 'completed', log: { complete: true, tests: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } },
    coverage: 'unknown', freshness: 'UNKNOWN', acceptance: 'PENDING', receipt: null }
  const fetch = vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith('notifications/preferences')) return Promise.resolve(Response.json({ revision: 0, enabled: false }))
    if (url.endsWith('actions/evidence')) {
      if (typeof init.body !== 'string') throw Error('Expected JSON request')
      const body: unknown = JSON.parse(init.body)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Expected request object')
      requests.push({ ...body })
      return Promise.resolve(Response.json(evidence))
    }
    return Promise.resolve(Response.json({ config: { actions: [] }, trusted: false,
      runs: [{ id: 'completed', label: 'Local command', status: 'PASS', exitCode: 0, aborted: false, timedOut: false, execution: { outcome: 'SUCCEEDED' } },
        { id: 'timed-out', label: 'Timed command', status: 'TIMEOUT', exitCode: 0, aborted: false, timedOut: true, execution: { outcome: 'UNKNOWN' } }] }))
  })
  new Script(script).runInNewContext({ document, fetch, location: { search: '?tab=builds&workspace=C:/isolated' },
    URLSearchParams, localStorage: { getItem: () => null, setItem: () => {} }, BroadcastChannel: class { postMessage() {} close() {} },
    window, setInterval: () => 1, setTimeout: () => 1, crypto: {} })
  await vi.waitFor(() => { expect(document.querySelectorAll('#runs .item')).toHaveLength(2) })
  return { fetch, requests, evidence }
}
it.each([false, true])('separates command success and explicit test-log parsing in Chinese=%s', async (zh) => {
  const f = await mount(zh), text = document.getElementById('runs')!.textContent
  expect(text).toMatchSnapshot()
  expect(text).toContain(zh ? '命令以 0 退出' : 'Command exited 0')
  expect(text).toContain(zh ? '已超时: true' : 'Timed out: true')
  expect(text).toContain(zh ? '分别检查已记录' : 'separately recorded')
  const parser = document.getElementById('evidenceParser') as HTMLSelectElement
  expect(parser.value).toBe('')
  parser.value = 'node-tap-13/1'; parser.dispatchEvent(new Event('change'))
  document.querySelector<HTMLButtonElement>('[data-evidence="completed"]')!.click()
  await vi.waitFor(() => { expect(document.getElementById('runEvidence')!.textContent).toContain(zh ? '通过: 1' : 'Passed: 1') })
  expect(f.requests).toEqual([{ workspace: 'C:/isolated', id: 'completed', parser: 'node-tap-13/1' }])
  expect(document.getElementById('runEvidence')!.textContent).toContain(zh ? '不会创建验证回执' : 'no verification receipt is created')
})
it('discards execution evidence that arrives after the workspace changes', async () => {
  const f = await mount(false)
  let finish: (value: Response) => void = () => { throw Error('Request not held') }
  f.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve }))
  const button = document.querySelector<HTMLButtonElement>('[data-evidence="completed"]')!
  const pending: unknown = button.onclick!.call(button, new PointerEvent('click'))
  const workspace = document.getElementById('workspace') as HTMLInputElement
  workspace.value = 'C:/another-workspace'; workspace.dispatchEvent(new Event('input'))
  finish(Response.json(f.evidence))
  await pending
  expect(document.getElementById('runEvidence')!.textContent).toBe('')
  expect(document.querySelectorAll('#runs .item')).toHaveLength(0)
})
