// @vitest-environment jsdom
/** Actual schedule editor script; isolated transport does not qualify Host authentication. */
import { Script } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { extrasHtml } from '../src/ui.ts'
import { defaults } from '../src/state.ts'

afterEach(() => { document.body.replaceChildren() })
const input = (id: string) => document.getElementById(id) as HTMLInputElement
const button = (id: string) => document.getElementById(id) as HTMLButtonElement

it.each([false, true])('requires a new future rule and separate consent for paused plans in Chinese=%s', async (chinese) => {
  const restored: Record<string, unknown>[] = []
  const plans = [{ id: 'plan', status: 'PAUSED', title: 'Local plan', prompt: 'isolated prompt', original: { scheduledAt: 1 } }]
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('JSON required')
    const value = JSON.parse(init.body) as Record<string, unknown>
    if (url.endsWith('/status')) return Response.json({ preferences: defaults(), features: {} })
    if (url.endsWith('/models') || url.endsWith('/diagnostics/list')) return Response.json([])
    if (url.endsWith('/pet/packages')) return Response.json({ items: [] })
    if (url.endsWith('/diagnostics')) return Response.json({ records: [] })
    if (url.endsWith('/schedule/list')) return Response.json({ enabled: true, paused: plans, official: [] })
    if (url.endsWith('/schedule/restore')) { restored.push(value); plans[0]!.status = 'RESTORED'; return Response.json({ status: 'RESTORED' }) }
    return Response.json({})
  })
  const page = extrasHtml(chinese), script = page.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Missing script')
  document.body.innerHTML = page.replace(/<script>[\s\S]*<\/script>/, '')
  new Script(script).runInNewContext({ document, fetch, location: { search: '?tab=schedule' }, URLSearchParams,
    setInterval: () => 1, clearInterval: () => {}, window, crypto: {}, structuredClone })
  button('refreshschedule').click()
  await vi.waitFor(() => { expect(document.querySelectorAll('#paused option')).toHaveLength(1) })
  expect(document.getElementById('schedule')?.textContent).toMatchSnapshot()
  expect(input('scheduleinterval').value).toBe('')
  expect(button('restoreschedule').disabled).toBe(true)
  for (const [id, value] of [['schedulesession', 'selected-main'], ['scheduleinterval', '120']]) {
    input(id!).value = value!; input(id!).dispatchEvent(new Event('input'))
  }
  expect(button('restoreschedule').disabled).toBe(true)
  input('scheduleconsent').checked = true; input('scheduleconsent').dispatchEvent(new Event('input'))
  button('restoreschedule').click()
  await vi.waitFor(() => { expect(restored).toHaveLength(1); expect(input('scheduleconsent').checked).toBe(false) })
  expect(restored[0]).toMatchObject({ id: 'plan', sessionId: 'selected-main', accepted: true,
    request: { title: 'Local plan', prompt: 'isolated prompt', every_seconds: 120 } })
  expect(restored[0]!.request).not.toHaveProperty('scheduledAt')
  expect(button('restoreschedule').disabled).toBe(true)
})
