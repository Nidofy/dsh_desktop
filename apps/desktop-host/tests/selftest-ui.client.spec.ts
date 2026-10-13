/** Localized dashboard interactions over an explicit request boundary; this does not qualify an Electron renderer. */
import { expect, it, onTestFinished } from 'vitest'
import { JSDOM } from 'jsdom'
import { randomUUID } from 'node:crypto'
import { selftestHtml } from '../src/selftest/ui.ts'
import { checks } from '../src/selftest/catalogue.ts'

it.each([false, true])('reads retained input capacity explicitly without starting or preparing checks (Chinese: %s)', async (chinese) => {
  const calls: string[] = []
  const dom = new JSDOM(selftestHtml(chinese), { url: 'https://selftest.invalid', runScripts: 'dangerously', beforeParse(window) {
    window.fetch = async (url) => {
      if (typeof url !== 'string') throw Error('Expected dashboard route')
      const method = url.split('/').at(-1)!; calls.push(method)
      if (method === 'list') return new Response(JSON.stringify({ activeId: null, history: [] }))
      if (method === 'connection-capacity') return new Response(JSON.stringify({ roots: 20, unsettled: null,
        available: false, code: 'SELFTEST_INPUT_LOG_LIMIT' }))
      throw Error('Unexpected operation')
    }
  } })
  onTestFinished(() => { dom.window.close() })
  await expect.poll(() => calls.length).toBe(1)
  dom.window.document.getElementById('capacity')?.click()
  await expect.poll(() => dom.window.document.getElementById('capacity-status')?.textContent).toContain('SELFTEST_INPUT_LOG_LIMIT')
  expect(dom.window.document.getElementById('capacity-status')?.textContent).toContain(chinese ? '未测量' : 'Not measured')
  expect(dom.window.document.getElementById('capacity-status')?.textContent).toMatchSnapshot()
  expect(calls).toEqual(['list', 'connection-capacity'])
})

it.each([false, true])('renders all checks and retains an uncertain start identity without sending again (Chinese: %s)', async (chinese) => {
  const calls: { method: string; data: Record<string, unknown> }[] = [], id = randomUUID(), errors: unknown[] = []
  let selected: string | null = id, lost = false
  const report = { status: 'COMPLETED', warning: null, rows: checks.map(([id, group]) => ({ id,
    phase: 'SETTLED', status: group === 'field' ? 'UNKNOWN' : 'SKIPPED', code: group === 'field' ? 'FIELD_UNVERIFIED' : 'NOT_SELECTED' })) }
  const dom = new JSDOM(selftestHtml(chinese), { url: 'https://selftest.invalid', runScripts: 'dangerously', beforeParse(window) {
    window.sessionStorage.setItem('nidofy-selftest-id', id)
    window.addEventListener('error', event => errors.push(event.error))
    window.fetch = async (url, init) => {
      if (typeof url !== 'string' || typeof init?.body !== 'string') throw Error('Expected the actual dashboard request')
      const method = url.split('/').at(-1)!, parsed: unknown = JSON.parse(init.body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Expected request data')
      const data = parsed as Record<string, unknown>
      calls.push({ method, data })
      if (method === 'list') return new Response(JSON.stringify({ activeId: null, history: selected ? [{ id: selected, startedAt: 1, status: 'COMPLETED' }] : [] }))
      if (method === 'start') { selected = String(data.operationId); lost = true; throw Error('SYNTHETIC_RESPONSE_LOST') }
      if (method === 'read') return new Response(JSON.stringify(lost ? null : report))
      throw Error('Unexpected mutating operation')
    }
  } })
  onTestFinished(() => { dom.window.close() })
  const doc = dom.window.document
  await expect.poll(() => doc.querySelectorAll('#rows tr').length).toBe(25)
  expect(doc.querySelector('#counts')?.textContent).toContain('UNKNOWN: 2')
  expect(doc.querySelector('#status')?.textContent).toContain('COMPLETED')
  expect(doc.querySelector('#report')?.textContent).toMatchSnapshot()
  expect(calls.every(row => ['list', 'read'].includes(row.method))).toBe(true)
  doc.getElementById('start')?.click()
  await expect.poll(() => lost).toBe(true)
  const retained = dom.window.sessionStorage.getItem('nidofy-selftest-id')
  expect(retained).toBe(selected); expect(retained).not.toBe(id)
  doc.getElementById('refresh')?.click()
  await expect.poll(() => calls.filter(row => row.method === 'read').length).toBeGreaterThan(1)
  expect(calls.filter(row => row.method === 'start')).toHaveLength(1)
  expect(doc.querySelector('#status')?.textContent).toContain(chinese ? '未知' : 'unknown')
  expect(errors).toEqual([])
})

it.each([false, true])('requires an explicit fixed-model confirmation and retains a lost provider-start identity (Chinese: %s)', async (chinese) => {
  const calls: { method: string; data: Record<string, unknown> }[] = [], ticket = randomUUID()
  const dom = new JSDOM(selftestHtml(chinese), { url: 'https://selftest.invalid', runScripts: 'dangerously', beforeParse(window) {
    window.fetch = async (url, init) => {
      if (typeof url !== 'string' || typeof init?.body !== 'string') throw Error('Expected dashboard JSON request')
      const method = url.split('/').at(-1)!, data = JSON.parse(init.body) as Record<string, unknown>
      calls.push({ method, data })
      if (method === 'list') return new Response(JSON.stringify({ activeId: null, history: [] }))
      if (method === 'read') return new Response('null')
      if (method === 'connection-options') return new Response(JSON.stringify([{ connection: 'synthetic', model: 'fixed-model' }]))
      if (method === 'connection-prepare') return new Response(JSON.stringify({ ticket, connection: 'synthetic', model: 'fixed-model',
        connectionRevision: 'actual-connection-revision', configurationRevision: 7, policyRevision: { distribution: 'fixed-v1', profile: 3 },
        requests: 5, maxOutputTokens: 64, retries: 0, expiresAt: Date.now() + 60000 }))
      if (method === 'start') throw Error('SYNTHETIC_START_RESPONSE_LOST')
      throw Error('Unexpected request')
    }
  } })
  onTestFinished(() => { dom.window.close() })
  const doc = dom.window.document, provider = doc.getElementById('provider') as HTMLButtonElement
  await expect.poll(() => calls.length).toBeGreaterThan(0)
  expect(provider.disabled).toBe(true); doc.getElementById('connections')?.click()
  await expect.poll(() => doc.querySelectorAll('#route option').length).toBe(1)
  doc.getElementById('prepare')?.click()
  await expect.poll(() => doc.getElementById('confirmation')?.textContent).toContain('actual-connection-revision')
  expect(doc.getElementById('confirmation')?.textContent).toContain('"profile": 3')
  expect(provider.disabled).toBe(true); expect(calls.filter(row => row.method === 'start')).toEqual([])
  doc.getElementById('accept')?.click(); expect(provider.disabled).toBe(false); provider.click()
  await expect.poll(() => calls.filter(row => row.method === 'start').length).toBe(1)
  expect(calls.find(row => row.method === 'start')?.data).toMatchObject({ ticket, accepted: true, mode: 'provider' })
  expect(dom.window.sessionStorage.getItem('nidofy-selftest-id')).toBe(calls.find(row => row.method === 'start')?.data.operationId)
  doc.getElementById('refresh')?.click()
  await expect.poll(() => calls.filter(row => row.method === 'read').length).toBe(1)
  expect(calls.filter(row => row.method === 'start')).toHaveLength(1); expect(provider.disabled).toBe(true)
})
