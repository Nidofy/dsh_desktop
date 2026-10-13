// @vitest-environment jsdom
/** Real generated editor behavior; transport is isolated and does not qualify Host authentication. */
import { afterEach, expect, it, vi } from 'vitest'
import { Script } from 'node:vm'
import { randomUUID } from 'node:crypto'
import { connectionsHtml } from '../src/connections/ui.ts'

it('submits catalog overrides with inherited models and keeps independent retention and credential settings', async () => {
  const f = await mount('openai-completions')
  edit('models', ''); edit('catalog', 'deepseek')
  edit('modelOverrides', JSON.stringify({ 'catalog-model': { contextWindow: 128000, maxTokens: 8192 } }))
  button('save').click()
  await vi.waitFor(() => { expect(f.mutations).toHaveLength(1); expect(button('save').disabled).toBe(false) })
  expect(f.mutations[0]).toMatchObject({ credential: { mode: 'keep' }, profile: {
    models: [], catalogProvider: 'deepseek', modelOverrides: { 'catalog-model': { contextWindow: 128000, maxTokens: 8192 } },
    cacheRetention: 'short', retryPolicy: f.profile.retryPolicy, compat: f.profile.compat,
  } })
})

afterEach(() => { document.body.replaceChildren() })

const field = (id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement)) throw Error('Missing field ' + id)
  return value
}
const edit = (id: string, value: string): void => { field(id).value = value; field(id).dispatchEvent(new Event('input')) }
const button = (id: string): HTMLButtonElement => {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLButtonElement)) throw Error('Missing button ' + id)
  return value
}

/** Execute the actual inline page script against jsdom and capture transport requests.
 * @param api - selected protocol.
 * @param initiallyUnavailable - first status response reports a degraded owner.
 * @returns captured mutations and a selected existing connection.
 */
async function mount(api: string, initiallyUnavailable = false, chinese = false) {
  const profile = { api, displayName: '<img src=x onerror=alert(1)>', baseURL: 'https://provider.invalid',
    models: [{ id: 'model', contextWindow: 64000, maxTokens: 4096, input: ['text'], reasoningEfforts: ['high'] }],
    defaultInput: ['text'], thinkingBudgets: { high: 2000 }, defaultContextWindow: 32000, defaultMaxTokens: 2048,
    timeoutMs: 90000, streamIdleTimeoutMs: 15000, cacheRetention: 'short', retryPolicy: { mode: 'normal', maxRetries: 2 },
    compat: api === 'openai-completions' ? { supportsStore: false } : { supportsLongCacheRetention: false } }
  const row = { connection: 'saved', profile, availability: 'available', pendingReview: { network: { proxy: 'private-unrendered' } } }
  const state = { desiredRevision: 7, appliedRevision: 6, recovery: 'ready', connections: [row] }
  const mutations: Record<string, unknown>[] = []
  const networkRequests: Record<string, unknown>[] = []
  const imports: Record<string, unknown>[] = []
  const networkState = { revision: 'isolated', ca: { configured: true }, fields: Object.fromEntries(
    ['httpProxy','httpsProxy','allProxy','noProxy'].map(field => [field, {
      saved: { value: field === 'httpProxy' ? 'http://proxy.invalid:8080/' : '', credentialed: field === 'httpProxy' },
      applied: { value: '' }, pending: false, overridden: field === 'httpsProxy',
    }])) }
  let refuse = initiallyUnavailable
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('Expected JSON')
    const args = JSON.parse(init.body) as Record<string, unknown>
    if (url.endsWith('/import')) {
      imports.push(args)
      const report = { verification: 'inventory-and-settings-only', settingNamespaces: ['session-persistence-jsonl', '<img src=x>'], categories: [
        { category: 'sessions', disposition: 'migrate', count: 1, destination: 'harness/sessions', detail: 'retain-generations' },
        { category: 'workspace', disposition: 'review', count: 1, destination: '<img src=x>', detail: 'new-workspace-confirmation' },
      ] }
      if (args.action === 'preview') return Response.json({ status: 'PREVIEW', fingerprint: 'preview-fingerprint',
        execution: 'explicit-bounded-copy', sourceBytes: 200, report })
      if (args.action === 'review') return Response.json({ operationId: args.operationId, phase: 'adopted', report,
        runningHome: 'C:/current/harness', launch: { harnessHome: 'C:/imports/selected/harness', desktopDataRoot: 'C:/imports/selected',
          argument: '--nidofy-desktop-data-root=C:/imports/selected', switchesRunningHost: false } })
      return Response.json({ operationId: args.operationId, phase: args.action === 'adopt' ? 'adopted' : 'ready' })
    }
    if (url.endsWith('/deployment')) {
      if (args.action === 'save') {
        networkRequests.push(args)
        for (const [field, value] of Object.entries(args.fields as Record<string, string>)) {
          const row = networkState.fields[field]
          if (!row) throw Error('Unexpected field')
          row.saved.value = value; row.pending = true
        }
      }
      return new Response(JSON.stringify(networkState))
    }
    if (url.endsWith('/status') && refuse) {
      refuse = false
      return new Response(JSON.stringify({ error: 'CONNECTION_OWNER_UNAVAILABLE', diagnosticCode: 'SYNTHETIC_DIRECTORY_DENIED' }), { status: 503 })
    }
    if (url.endsWith('/mutate')) { mutations.push(args); row.profile = args.profile as typeof profile; state.appliedRevision = ++state.desiredRevision }
    return new Response(JSON.stringify(state))
  })
  const page = connectionsHtml(chinese), script = page.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Missing page script')
  document.body.innerHTML = page.replace(/<script>[\s\S]*<\/script>/, '')
  new Script(script).runInNewContext({ document, fetch, crypto: { randomUUID }, AbortController })
  if (initiallyUnavailable) {
    await vi.waitFor(() => { expect(document.getElementById('receipt')?.textContent).toContain('SYNTHETIC_DIRECTORY_DENIED') })
    return { profile, mutations, fetch, networkRequests, imports }
  }
  await vi.waitFor(() => { expect(button('save').disabled).toBe(false); expect(document.querySelectorAll('#list button')).toHaveLength(1) })
  const choice = document.querySelector<HTMLButtonElement>('#list button')
  if (!choice) throw Error('Missing connection')
  choice.click()
  return { profile, mutations, fetch, networkRequests, imports }
}

it.each([false, true])('requires preview and carries explicit ceiling/identity through import and adoption in Chinese=%s', async (chinese) => {
  const f = await mount('openai-completions', false, chinese)
  expect(document.querySelector('label[for="importBudget"]')?.closest('section')?.textContent).toMatchSnapshot()
  edit('source', 'C:/isolated/old-home')
  button('migrationPreview').click()
  await vi.waitFor(() => { expect(f.imports).toHaveLength(1); expect(button('migrationPreview').disabled).toBe(false) })
  expect(f.imports[0]).toMatchObject({ action: 'preview', source: 'C:/isolated/old-home' })
  expect(button('import').disabled).toBe(true)
  expect(document.querySelectorAll('#importReport tr')).toHaveLength(2)
  expect(document.querySelector('#importReport img')).toBeNull()
  expect(document.getElementById('importNamespaces')?.textContent).toContain('session-persistence-jsonl, <img src=x>')
  expect(document.querySelector('#importNamespaces img')).toBeNull()
  expect(document.getElementById('receipt')?.textContent).toContain('explicit-bounded-copy')
  expect(f.imports.some(row => row.action !== 'preview')).toBe(false)
  const operationId = field('importId').value
  edit('importBudget', '65536')
  const consent = document.getElementById('confirmImport') as HTMLInputElement
  consent.checked = true; consent.dispatchEvent(new Event('input'))
  button('import').click()
  await vi.waitFor(() => { expect(f.imports).toHaveLength(2); expect(button('migrationPreview').disabled).toBe(false) })
  expect(f.imports[1]).toMatchObject({ action: 'execute', operationId, confirm: true, maxWriteBytes: 65536,
    expectedFingerprint: 'preview-fingerprint' })
  expect(button('import').disabled).toBe(true)
  button('inspectImport').click()
  await vi.waitFor(() => { expect(f.imports).toHaveLength(3); expect(button('inspectImport').disabled).toBe(false) })
  expect(f.imports[2]).toMatchObject({ action: 'inspect', operationId })
  expect(button('adoptImport').disabled).toBe(true)
  const adopt = document.getElementById('confirmAdopt') as HTMLInputElement
  adopt.checked = true; adopt.dispatchEvent(new Event('input'))
  button('adoptImport').click()
  await vi.waitFor(() => { expect(f.imports).toHaveLength(4); expect(button('reviewImport').disabled).toBe(false) })
  expect(f.imports[3]).toMatchObject({ action: 'adopt', confirm: true, operationId })
  button('reviewImport').click()
  await vi.waitFor(() => { expect(f.imports).toHaveLength(5); expect(button('reviewImport').disabled).toBe(false) })
  expect(button('selectImportHome').disabled).toBe(true)
  const home = document.getElementById('confirmHome') as HTMLInputElement
  home.checked = true; home.dispatchEvent(new Event('input')); button('selectImportHome').click()
  expect(field('selectedHome').value).toBe('C:/imports/selected/harness')
  expect(field('runningImportHome').value).toBe('C:/current/harness')
  expect(f.imports).toHaveLength(5)
  edit('importId', randomUUID())
  expect(document.getElementById('importLaunch')?.hidden).toBe(true)
  expect(button('selectImportHome').disabled).toBe(true)
})

it('discards a late preview after the source changes', async () => {
  const f = await mount('openai-completions'), reply = Promise.withResolvers<Response>()
  f.fetch.mockImplementationOnce(() => reply.promise)
  edit('source', 'C:/first'); button('migrationPreview').click()
  edit('source', 'C:/second')
  reply.resolve(Response.json({ execution: 'explicit-bounded-copy', fingerprint: 'stale', report: { categories: [] } }))
  await vi.waitFor(() => { expect(button('migrationPreview').disabled).toBe(false) })
  expect(button('import').disabled).toBe(true)
  expect(document.querySelectorAll('#importReport tr')).toHaveLength(0)
})

it.each([false, true])('edits only changed deployment fields and explains Host and CA restart scope in Chinese=%s', async (chinese) => {
  const f = await mount('openai-completions', false, chinese)
  await vi.waitFor(() => { expect(button('deploymentSave').disabled).toBe(false) })
  expect(field('httpProxy').value).toBe('http://proxy.invalid:8080/')
  expect(document.getElementById('deploymentStatus')?.textContent).toContain(chinese ? '启动环境覆盖' : 'launch environment overrides')
  expect(document.getElementById('caState')?.textContent).toContain(chinese ? '尚未验证证书' : 'certificate and connectivity unverified')
  edit('noProxy', 'intranet.invalid'); button('deploymentSave').click()
  await vi.waitFor(() => { expect(f.networkRequests).toHaveLength(1); expect(button('deploymentSave').disabled).toBe(false) })
  expect(f.networkRequests[0]).toEqual({ action: 'save', expectedRevision: 'isolated', fields: { noProxy: 'intranet.invalid' } })
  expect(document.getElementById('deploymentStatus')?.textContent).toContain(chinese ? '排空活动请求后重启 Host' : 'Drain active requests and restart the Host')
  expect(document.body.textContent).toContain('NODE_EXTRA_CA_CERTS')
  expect(document.body.textContent).toContain(chinese ? '重启整个桌面' : 'restarting all of Desktop')
  expect(f.mutations).toEqual([])
})

it('shows initial owner failure diagnostics and reloads before enabling mutations', async () => {
  const f = await mount('openai-completions', true)
  expect(button('save').disabled).toBe(true); expect(button('revoke').disabled).toBe(true)
  expect(button('refresh').disabled).toBe(false)
  button('refresh').click()
  await vi.waitFor(() => { expect(button('save').disabled).toBe(false); expect(document.querySelectorAll('#list button')).toHaveLength(1) })
  expect(f.mutations).toEqual([])
})

it.each(['openai-completions', 'anthropic-messages'])('retains untouched advanced fields and keys while editing %s', async (api) => {
  const f = await mount(api)
  expect(document.querySelector('#list img')).toBeNull()
  expect(document.getElementById('pendingReview')?.textContent).toContain('have not been applied')
  expect(document.getElementById('revisionState')?.textContent).toContain('Desired revision: 7 · Applied revision: 6')
  expect(document.body.textContent).toContain('actual model capabilities and cache hit counts are unverified')
  expect(document.body.textContent).toContain('draining active requests and restarting the Host')
  expect(document.getElementById('pendingReview')?.textContent).not.toContain('private-unrendered')
  edit('modelDetails', JSON.stringify([{ id: 'model', contextWindow: 128000, maxTokens: 8192 }]))
  edit('timeoutMs', '120000'); edit('cacheRetention', 'long')
  button('save').click()
  await vi.waitFor(() => { expect(f.mutations).toHaveLength(1); expect(button('save').disabled).toBe(false) })
  expect(f.mutations[0]).toMatchObject({ expectedRevision: 7, credential: { mode: 'keep' }, profile: {
    ...f.profile, timeoutMs: 120000, cacheRetention: 'long', models: [{ ...f.profile.models[0], contextWindow: 128000, maxTokens: 8192 }],
  } })
  expect(field('key').value).toBe('')
})

it('refuses malformed declarations before transport, retains the entered key, and supports resetting advanced fields', async () => {
  const f = await mount('openai-completions')
  edit('modelDetails', JSON.stringify([{ id: 'other', maxTokens: 1 }]))
  edit('key', 'local-secret'); button('save').click()
  await vi.waitFor(() => { expect(button('save').disabled).toBe(false) })
  expect(f.mutations).toEqual([]); expect(field('key').value).toBe('local-secret')
  expect(document.getElementById('status')?.textContent).toContain('Per-model IDs must be unique')
  expect(document.getElementById('receipt')?.textContent).not.toContain('local-secret')
  edit('modelDetails', ''); edit('retryPolicy', '[]'); button('save').click()
  await vi.waitFor(() => { expect(button('save').disabled).toBe(false) })
  expect(f.mutations).toEqual([])
  edit('retryPolicy', ''); edit('timeoutMs', '0'); button('save').click()
  await vi.waitFor(() => { expect(button('save').disabled).toBe(false) })
  expect(f.mutations).toEqual([])
  edit('timeoutMs', ''); button('save').click()
  await vi.waitFor(() => { expect(f.mutations).toHaveLength(1); expect(button('save').disabled).toBe(false) })
  const saved = f.mutations[0]!.profile as Record<string, unknown>
  expect(saved).not.toHaveProperty('retryPolicy'); expect(saved).not.toHaveProperty('timeoutMs')
  expect(saved.models).toEqual(f.profile.models)
  expect(field('key').value).toBe('')
})
