/** New task-only built qualification uses a local synthetic SSE server and retains every journal through cold restart. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Exercise authenticated task requests on the complete supported profile, without repeating receipt-comparison checks.
 * @param fixture - Parent-owned full profile, Host lifecycle and private synthetic evidence paths.
 */
export async function runTaskRequestsProfile({ host, api, launch, evidence, root, home }) {
  const requests = [], responses = new Set(), observations = [], failures = []
  let mode = 'complete'
  const provider = createServer(async (request, response) => {
    responses.add(response); response.once('close', () => responses.delete(response))
    try {
      const parts = []; for await (const part of request) parts.push(part)
      const body = JSON.parse(Buffer.concat(parts).toString())
      assert.equal(body.model, 'task-model-alias'); assert.equal(body.max_tokens ?? body.max_completion_tokens, 64)
      assert.equal(body.tools, undefined); assert.equal(request.headers.authorization, 'Bearer synthetic-task-only')
      requests.push(body)
      if (mode === 'failure') { response.writeHead(500); response.end('{"error":{"message":"synthetic provider failure"}}'); return }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: ' + JSON.stringify({ model: 'synthetic-built-model-2026-10-11',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic analysis' }, finish_reason: null }] }) + '\n\n')
      if (mode === 'hold') return
      response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 9, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } } }) + '\n\ndata: [DONE]\n\n')
    } catch (error) { failures.push(String(error)); response.destroy() }
  })
  await new Promise(done => provider.listen(0, '127.0.0.1', done))
  try {
    const endpoint = 'http://127.0.0.1:' + provider.address().port
    const saved = await fetch(api.base + '/api/nidofy/mutate', { method: 'POST',
      headers: { cookie: api.cookie, origin: api.base, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save', operationId: randomUUID(), connection: 'synthetic-task', expectedRevision: 0,
        profile: { api: 'openai-completions', baseURL: endpoint + '/v1', models: [{ id: 'task-model-alias' }],
          defaultContextWindow: 8192, defaultMaxTokens: 64, retryPolicy: { mode: 'normal', maxRetries: 0 } },
        credential: { mode: 'replace', value: 'synthetic-task-only' } }) })
    assert.equal(saved.status, 200, await saved.text())
    for (const method of ['task-prepare', 'task-start', 'task-read', 'task-cancel']) {
      const url = api.base + '/api/nidofy/workbench/experiments/' + method
      assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401)
      assert.equal((await fetch(url, { method: 'POST', headers: { cookie: api.cookie, origin: 'https://foreign.invalid' }, body: '{}' })).status, 403)
    }
    for (const [locale, title] of [['en', 'Single task request'], ['zh-CN', '单次任务请求']]) {
      const page = await fetch(api.base + '/api/nidofy/workbench/experiments/ui?locale=' + locale, { headers: { cookie: api.cookie } })
      assert.equal(page.status, 200); assert.match(await page.text(), new RegExp(title))
    }
    const local = async (path, data) => {
      const response = await fetch(api.base + path, { method: 'POST',
        headers: { cookie: api.cookie, origin: api.base, 'content-type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(45000) })
      const bytes = await response.text(); assert.equal(response.status, 200, path + ': ' + bytes); return JSON.parse(bytes)
    }
    const source = await local('/api/experiments-notebook-source', {})
    const extras = await local('/api/nidofy-extras/status', {})
    const preferences = await local('/api/nidofy-extras/preferences', { ...extras.preferences, cache: true,
      cachePolicy: { mode: 'session', models: ['task-model-alias'] } })
    const input = { experimentId: randomUUID(), caseId: randomUUID(), connection: 'synthetic-task', model: 'task-model-alias',
      text: '完整独立合成任务\nAnalyze this private input without tools.', maxOutputTokens: 64 }
    const prepare = () => api.post('experiments/task-prepare', input)
    const settled = async id => {
      const deadline = Date.now() + 45000
      for (;;) {
        const value = await api.post('experiments/task-read', { id })
        if (value?.status !== 'RUNNING') return value
        if (Date.now() > deadline) throw Error('Task request did not settle')
        await new Promise(done => setTimeout(done, 20))
      }
    }
    const waitRequests = async count => {
      const deadline = Date.now() + 15000
      while (requests.length < count) {
        if (Date.now() > deadline) throw Error('Synthetic provider did not receive task request')
        await new Promise(done => setTimeout(done, 20))
      }
    }
    const plan = await api.post('experiments/task-prepare', { ...input, notebookSessionId: source.sessionId }), id = randomUUID()
    assert.equal(requests.length, 0); assert.deepEqual(plan.budget, { requests: 1, retries: 0 })
    assert.equal(plan.text, input.text); assert.equal(plan.maxOutputTokens, 64)
    assert.equal(plan.notebookInput.scope.sessionId, source.sessionId)
    assert.match(plan.notebookInput.text, /Keep this analysis free of tools and commands/u)
    assert.equal((await api.post('experiments/task-start', { id, ticket: plan.ticket, accepted: false }, 400)).error, 'EXPERIMENT_TASK_INPUT_INVALID')
    await api.post('experiments/task-start', { id, ticket: plan.ticket, accepted: true })
    const result = await settled(id)
    assert.equal(result.status, 'COMPLETED', JSON.stringify(result))
    assert.deepEqual(result.counts, { dispatches: 1, providerWireRequests: null, inputTokens: 6, outputTokens: 4, cacheReadTokens: 3 })
    assert.equal(result.dispatchInput.messages[0].content.map(block => block.text).join(''), requests[0].messages[0].content)
    assert.deepEqual(result.notebookInput, plan.notebookInput)
    assert.equal(result.factors.notebook, 'CAPTURED_INPUT')
    assert.deepEqual(result.executionObservation.cache, { policy: { mode: 'session', models: ['task-model-alias'] },
      preferenceRevision: preferences.revision, api: 'openai-completions', applied: true, hint: 'SESSION_KEY' })
    assert.deepEqual(result.executionObservation.response, { status: 'REPORTED', model: 'synthetic-built-model-2026-10-11' })
    assert.match(requests[0].prompt_cache_key, /^dsh_/u)
    assert.equal(result.exactModelVersion, null); assert.equal(result.receipt, null); assert.equal(result.efficiencyEligible, false)
    assert.equal((await api.post('experiments/task-start', { id: randomUUID(), ticket: plan.ticket, accepted: true }, 400)).error, 'EXPERIMENT_CONFIRMATION_EXPIRED')
    const original = await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'dispatch.json'))
    const originalNotebook = await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'notebook-input.json'))
    const originalObservation = await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'execution-observation.json'))
    await writeFile(join(evidence, 'completed-task.json'), JSON.stringify(result, null, 2) + '\n')
    observations.push('authenticated-task-single-confirmation-official-input-native-quota-bilingual-zero-agent')
    observations.push('actual-notebook-input-cache-hint-official-response-model-cold-observation')
    mode = 'hold'
    const cancelPlan = await prepare(), cancelledId = randomUUID()
    await api.post('experiments/task-start', { id: cancelledId, ticket: cancelPlan.ticket, accepted: true })
    await waitRequests(2); await api.post('experiments/task-cancel', { id: cancelledId })
    assert.equal((await settled(cancelledId)).status, 'CANCELLED')
    observations.push('task-cancel-drains-synthetic-provider-no-retry')
    mode = 'failure'
    const failedPlan = await prepare(), failedId = randomUUID()
    await api.post('experiments/task-start', { id: failedId, ticket: failedPlan.ticket, accepted: true })
    assert.equal((await settled(failedId)).status, 'FAILED'); assert.equal(requests.length, 3)
    observations.push('failed-task-no-retry-no-failover-no-tools')
    mode = 'hold'
    const orphanPlan = await prepare(), orphanId = randomUUID()
    await api.post('experiments/task-start', { id: orphanId, ticket: orphanPlan.ticket, accepted: true }); await waitRequests(4)
    host.child.kill(); await host.done
    host = launch(); api = await host.api()
    const cold = await api.post('experiments/task-read', { id }), orphan = await api.post('experiments/task-read', { id: orphanId })
    assert.deepEqual(cold, result); assert.deepEqual(await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'dispatch.json')), original)
    assert.deepEqual(await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'notebook-input.json')), originalNotebook)
    assert.deepEqual(await readFile(join(home, 'nidofy-extras/experiments/task-requests-v1', id, 'execution-observation.json')), originalObservation)
    assert.equal(orphan.status, 'INTERRUPTED'); assert.equal(orphan.dispatchInput, null); assert.ok(orphan.preparedInput)
    assert.equal(orphan.counts.dispatches, null); assert.equal(requests.length, 4)
    assert.deepEqual(await api.counts(), { modelRequests: 0, createdAgents: 0 }); assert.deepEqual(failures, [])
    await writeFile(join(evidence, 'interrupted-task.json'), JSON.stringify(orphan, null, 2) + '\n')
    await writeFile(join(evidence, 'wire-inputs.json'), JSON.stringify(requests, null, 2) + '\n')
    observations.push('cold-task-restart-original-bytes-orphan-unknown-no-replay')
    await host.stop()
    await writeFile(join(evidence, 'summary.json'), JSON.stringify({ root, observations, syntheticWireRequests: 4,
      paidRequests: 0, createdAgents: 0, actualActions: 0, renderer: 'UNKNOWN', installer: 'UNKNOWN',
      taskComparison: 'UNQUALIFIED', factors: 'EXPLICIT_NOTE_INPUT_AND_APPLIED_HINT_ONLY', exactModelVersion: 'UNKNOWN' }, null, 2) + '\n')
    console.log(JSON.stringify({ evidence, root, observations, syntheticWireRequests: 4, paidRequests: 0, createdAgents: 0 }))
  } finally {
    for (const response of responses) response.destroy()
    await new Promise(done => provider.close(done))
  }
}
