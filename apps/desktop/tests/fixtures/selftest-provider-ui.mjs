/** Real renderer confirmation and cancellation against one private synthetic SSE provider. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Drive the shipped dashboard and managed connection owner without a user Session or billed request.
 * @param fixture - Caller-owned real Electron pages, authenticated request helpers and private evidence directories.
 * @returns Settled provider reports and exact synthetic wire-request count after listener teardown.
 */
export async function runProviderUi({ main, dashboard, request, observe, shot, root, home, project, record, steps, requests }) {
  const sends = [], responses = new Set(), errors = []
  let hold = false
  const provider = createServer(async (incoming, response) => {
    responses.add(response); response.once('close', () => responses.delete(response))
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      assert.equal(incoming.headers.authorization, 'Bearer synthetic-renderer-only')
      assert.equal(body.model, 'synthetic-renderer-model')
      assert.equal(body.max_tokens ?? body.max_completion_tokens, 64)
      sends.push(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const tools = body.tools?.length > 0
      response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: tools
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'synthetic-echo', type: 'function',
          function: { name: 'selftest_echo', arguments: '{"value":"synthetic"}' } }] }
        : { role: 'assistant', content: 'OK' }, finish_reason: null }] }) + '\n\n')
      if (hold) return
      response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 512, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 16 } } }) + '\n\ndata: [DONE]\n\n')
    } catch (error) { errors.push(String(error)); response.writeHead(500); response.end() }
  })
  await new Promise(done => provider.listen(0, '127.0.0.1', done))
  const endpoint = 'http://127.0.0.1:' + provider.address().port
  try {
    await main.evaluate(async endpoint => {
      const response = await fetch('/api/nidofy/mutate', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', operationId: crypto.randomUUID(), connection: 'synthetic-renderer', expectedRevision: 0,
          profile: { api: 'openai-completions', baseURL: endpoint + '/v1', models: [{ id: 'synthetic-renderer-model' }],
            defaultContextWindow: 8192, defaultMaxTokens: 64, retryPolicy: { mode: 'normal', maxRetries: 0 } },
          credential: { mode: 'replace', value: 'synthetic-renderer-only' } }) })
      if (!response.ok) throw Error(await response.text())
    }, endpoint)
    for (const locale of ['zh-CN', 'en']) {
      await dashboard.goto('dsh-app://app/api/nidofy/workbench/selftest/ui?locale=' + locale)
      await dashboard.locator('#connections').click()
      await dashboard.waitForFunction(() => document.querySelectorAll('#route option').length === 1)
      await dashboard.locator('#prepare').click()
      await dashboard.waitForFunction(() => document.querySelector('#confirmation').textContent.includes('synthetic-renderer-model'))
      const preview = JSON.parse(await dashboard.locator('#confirmation').textContent())
      assert.equal(preview.requests, 5)
      assert.equal(preview.maxOutputTokens, 64)
      assert.equal(preview.retries, 0)
      assert.equal(preview.configurationRevision, 1)
      assert.equal(preview.policyRevision.profile, 0)
      assert.equal(typeof preview.policyRevision.distribution, 'string')
      assert.equal(await dashboard.locator('#provider').isDisabled(), true)
      assert.equal(await dashboard.locator('#accept').isChecked(), false)
      assert.equal(sends.length, 0)
      assert.equal(requests.filter(row => row.method === 'start').length, 0)
      await shot(dashboard, locale + '-provider-confirmation.png')
    }
    await dashboard.locator('#accept').check()
    assert.equal(await dashboard.locator('#provider').isEnabled(), true)
    await dashboard.locator('#budget').selectOption('1')
    assert.equal(await dashboard.locator('#accept').isChecked(), false)
    assert.equal(await dashboard.locator('#provider').isDisabled(), true)
    assert.equal(await dashboard.locator('#confirmation').textContent(), '')
    assert.equal(sends.length, 0)
    await dashboard.locator('#budget').selectOption('5')
    await dashboard.locator('#prepare').click()
    await dashboard.waitForFunction(() => document.querySelector('#confirmation').textContent.includes('synthetic-renderer-model'))
    assert.deepEqual(await observe(dashboard), { modelRequests: 0, createdAgents: 0 })
    steps.push('actual-bilingual-fixed-route-revisions-budget-preview-unchecked-consent-and-budget-change-discard-zero-send')
    await dashboard.locator('#accept').check()
    await dashboard.locator('#provider').click()
    await dashboard.waitForFunction(() => /Workflow: (COMPLETED|FAILED|TIMEOUT|CANCELLED)/.test(document.querySelector('#status').textContent), null, { timeout: 45000 })
    const id = await dashboard.evaluate(() => sessionStorage.getItem('nidofy-selftest-id'))
    const report = await request(dashboard, 'read', { id })
    assert.equal(report.status, 'COMPLETED', JSON.stringify(report))
    assert.equal(report.schemaVersion, 2)
    assert.equal(report.rows.filter(row => row.status === 'PASS').length, 5)
    assert.ok(report.rows.slice(-2).every(row => row.status === 'UNKNOWN'))
    assert.equal(sends.length, 5)
    assert.deepEqual(await observe(dashboard), { modelRequests: 5, createdAgents: 0 })
    assert.deepEqual(await request(dashboard, 'connection-capacity'), { roots: 1, unsettled: 0, available: true, code: 'OK' })
    const start = requests.filter(row => row.method === 'start')
    assert.equal(start.length, 1)
    assert.deepEqual({ mode: start[0].data.mode, accepted: start[0].data.accepted }, { mode: 'provider', accepted: true })
    assert.match(start[0].data.ticket, /^[a-f0-9-]{36}$/)
    const path = join(home, 'nidofy-extras/selftests/reports', id + '.json'), before = await readFile(path)
    await shot(dashboard, 'en-provider-completed.png')
    await dashboard.reload()
    await dashboard.waitForFunction(() => document.querySelector('#status').textContent === 'Workflow: COMPLETED')
    await dashboard.locator('#refresh').click()
    assert.equal(requests.filter(row => row.method === 'start').length, 1)
    assert.equal(sends.length, 5)
    assert.deepEqual(await readFile(path), before)
    const exported = await request(dashboard, 'export', { id })
    for (const privateText of [root, endpoint, 'synthetic-renderer-model', 'synthetic-renderer-only', id, 'Call selftest_echo']) {
      assert.ok(!JSON.stringify(exported).includes(privateText))
    }
    steps.push('actual-renderer-five-fixed-64-token-sse-sends-private-inputs-capacity-whitelist-readonly-reload-zero-agent')
    hold = true
    await dashboard.locator('#connections').click()
    await dashboard.waitForFunction(() => document.querySelectorAll('#route option').length === 1)
    await dashboard.locator('#prepare').click()
    await dashboard.waitForFunction(() => document.querySelector('#confirmation').textContent.includes('synthetic-renderer-model'))
    await dashboard.locator('#accept').check()
    await dashboard.locator('#provider').click()
    const deadline = Date.now() + 15000
    while (sends.length < 6) {
      if (Date.now() > deadline) throw Error('Confirmed synthetic SSE did not start')
      await new Promise(done => setTimeout(done, 20))
    }
    await dashboard.locator('#cancel').click()
    await dashboard.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Workflow: CANCELLED'))
    const cancelledId = await dashboard.evaluate(() => sessionStorage.getItem('nidofy-selftest-id'))
    const cancelled = await request(dashboard, 'read', { id: cancelledId })
    assert.equal(cancelled.status, 'CANCELLED')
    assert.equal(sends.length, 6)
    assert.equal(responses.size, 0)
    assert.deepEqual(await observe(dashboard), { modelRequests: 6, createdAgents: 0 })
    const cancelledPath = join(home, 'nidofy-extras/selftests/reports', cancelledId + '.json'), cancelledBefore = await readFile(cancelledPath)
    await dashboard.reload()
    await dashboard.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Workflow: CANCELLED'))
    assert.equal(requests.filter(row => row.method === 'start').length, 2)
    assert.equal(sends.length, 6)
    assert.deepEqual(await readFile(cancelledPath), cancelledBefore)
    const require = createRequire(join(project, 'package.json'))
    const [{ Context }, { default: Jsonl }, { Session }] = await Promise.all([
      '@deepseek-ai/cordis', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session',
    ].map(name => import(pathToFileURL(require.resolve(name)).href)))
    for (const [run, offset, count] of [[id, 0, 5], [cancelledId, 5, 1]]) {
      const cold = new Context()
      await cold.plugin(Jsonl, { root: join(home, 'nidofy-extras/selftests/inputs', run), compression: 'none' })
      try {
        const retained = await cold.sessionPersistence.list()
        assert.equal(retained.length, count)
        for (const row of retained) {
          const raw = await cold.sessionPersistence.observeDurable(row.header.id)
          const session = Session.create(raw.meta.id, raw.events, raw.meta)
          const index = Number(String(row.header.id).split('-').at(-1))
          assert.equal(session.requestHeader().config.maxTokens, 64)
          assert.equal(session.deriveMessages()[0].content[0].text, sends[offset + index].messages[0].content)
        }
      } finally { await cold.fiber.dispose() }
    }
    assert.deepEqual(await readFile(path), before)
    assert.deepEqual(await readFile(cancelledPath), cancelledBefore)
    assert.deepEqual(await observe(dashboard), { modelRequests: 6, createdAgents: 0 })
    await shot(dashboard, 'en-provider-cancelled.png')
    assert.deepEqual(errors, [])
    steps.push('actual-renderer-cancel-started-sse-drain-six-total-sends-no-retry-reload-or-resume')
    steps.push('official-six-private-inputs-cold-reconstruct-exact-wire-text-and-output-cap-zero-agent')
    await writeFile(join(record, 'provider-wire.json'), JSON.stringify({ syntheticRequests: sends.length, paidRequests: 0,
      createdAgents: 0, requests: sends, inputRoot: join(home, 'nidofy-extras/selftests/inputs'), report, cancelled }, null, 2) + '\n')
    return { reports: [report, cancelled], modelRequests: sends.length }
  } finally {
    for (const response of responses) response.destroy()
    provider.closeAllConnections()
    await new Promise(done => provider.close(done))
    await writeFile(join(record, 'provider-sends.json'), JSON.stringify({ syntheticRequests: sends.length,
      paidRequests: 0, requests: sends, errors }, null, 2) + '\n')
  }
}
