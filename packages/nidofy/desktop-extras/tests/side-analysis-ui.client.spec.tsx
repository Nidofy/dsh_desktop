// @vitest-environment jsdom
/** Explicit selected-input confirmation and append; unmount cancels and refuses an uncooperative late result. */
import { expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { SideAnalysis } from '../src/client/SideAnalysis.tsx'
import { AnalysisHistory } from '../src/client/AnalysisHistory.tsx'
import { en } from '../src/client/locales.ts'
import type { EnvironmentInjected } from '../src/client/index.ts'
import type { CompanionScope } from '../src/client/companion.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Freeze only the fixture's time zone; production continues to use the user's zone.
// oxlint-disable-next-line typescript/unbound-method -- Invoked with the original Date receiver through call below.
const localDate = Date.prototype.toLocaleString
beforeEach(() => { vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, locales, options) {
  return localDate.call(this, locales, { ...options, timeZone: 'UTC' })
}) })
afterEach(() => { vi.restoreAllMocks() })
const scope: CompanionScope = { hostEpoch: null, windowId: null, viewId: null, panelId: null,
  workspaceId: null, sessionId: null, turn: null, revision: 1 }
const t: PropsLocale<'nidofy.environment'>['t'] = (key, parameters) => (key in en ? en[key as keyof typeof en] : key).replace(/\{(\w+)\}/gu,
  (_match: string, name: string) => String(parameters ? Reflect.get(parameters, name) : ''))
const result = { id: '11111111-1111-1111-1111-111111111111', status: 'COMPLETED', text: 'Private result', diagnostic: null,
  counts: { inputTokens: 7, outputTokens: 3 }, journal: { exactInput: 'Selected question', tools: false } }
afterEach(cleanup)
function fixture(run?: EnvironmentInjected['analysis']) {
  const analysis = vi.fn<EnvironmentInjected['analysis']>(async (scope, method, input, signal) => {
    if (method === 'options') return [{ connection: 'local', model: 'selected-model' }]
    if (method === 'prepare') return { ticket: 'ticket', input: 'Selected question', connection: 'local', model: 'selected-model', inputBytes: 17, maxOutputTokens: 512 }
    return run ? run(scope, method, input, signal) : result
  })
  const append = vi.fn<EnvironmentInjected['appendAnalysis']>(async () => true)
  const view = render(createElement(SideAnalysis, { scope, analysis, appendAnalysis: append, t }))
  return { view, analysis, append }
}
async function preview() {
  await screen.findByRole('option', { name: 'local / selected-model' })
  fireEvent.change(screen.getByLabelText('Connection and model'), { target: { value: 'local/selected-model' } })
  fireEvent.change(screen.getByLabelText('Selected text or question'), { target: { value: 'Selected question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview request' }))
  await screen.findByRole('button', { name: 'Send this one request' })
}
it('previews without dispatch, separates usage and appends only after the explicit user choice', async () => {
  const f = fixture(); await preview()
  expect(f.analysis.mock.calls.some(row => row[1] === 'run')).toBe(false)
  expect(f.append).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Send this one request' }))
  await screen.findByText('Private result')
  expect(screen.getByText(/Separate usage: input 7, output 3/)).toBeTruthy()
  expect(f.append).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Append result to draft' }))
  await screen.findByText('Appended to the current draft; nothing sent.')
  expect(f.append).toHaveBeenCalledExactlyOnceWith(scope, result.id)
})
it('cancels an unmounted run and never publishes or appends a late response', async () => {
  const gate = Promise.withResolvers<unknown>(); let signal: AbortSignal | undefined
  const f = fixture(async (_scope, _method, _input, lifetime) => { signal = lifetime; return gate.promise })
  await preview(); fireEvent.click(screen.getByRole('button', { name: 'Send this one request' }))
  expect(signal?.aborted).toBe(false); f.view.unmount(); expect(signal?.aborted).toBe(true)
  await act(async () => { gate.resolve(result); await gate.promise })
  expect(screen.queryByText('Private result')).toBeNull(); expect(f.append).not.toHaveBeenCalled()
})

it('loads exact history on demand and previews retention without appending or dispatching', async () => {
  const row = { id: result.id, status: 'COMPLETED', startedAt: 1, connection: 'local', model: 'selected-model', archived: false }
  let archived = false, activeLimit = 20
  const analysis = vi.fn<EnvironmentInjected['analysis']>(async (_scope, method, input) => {
    if (method === 'history') return { budget: { activeLimit, archiveLimit: 80 }, active: archived ? 0 : 1, archived: Number(archived), total: 1, rows: [{ ...row, archived }], next: null }
    if (method === 'history-read') return { ...row, text: result.text, journal: result.journal }
    if (method === 'archive-preview') return { ticket: 'archive-ticket', action: 'archive', journal: result.journal, after: { active: 0, archived: 1 } }
    if (method === 'budget-preview') return { ticket: 'budget-ticket', action: 'budget', after: { activeLimit: 2, archiveLimit: 80 } }
    if (method === 'retention-confirm') {
      if ('ticket' in input && input.ticket === 'archive-ticket') { archived = true; return { status: 'ARCHIVED' } }
      activeLimit = 2; return { status: 'BUDGET_APPLIED' }
    }
    throw Error('UNEXPECTED_SEND')
  })
  const view = render(createElement(AnalysisHistory, { scope, analysis, t }))
  expect(analysis).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Analysis history and retention'))
  fireEvent.click(screen.getByRole('button', { name: 'Load or refresh history' }))
  await screen.findByText(/Shared retention: 1\/20 active/)
  fireEvent.click(screen.getByRole('button', { name: 'Inspect original request and result' }))
  await screen.findByText('Private result')
  fireEvent.click(screen.getByRole('button', { name: 'Preview archive' }))
  await screen.findByRole('button', { name: 'Confirm retention change' })
  expect(archived).toBe(false)
  expect(analysis.mock.calls.some(row => row[1] === 'retention-confirm')).toBe(false)
  expect(view.asFragment()).toMatchSnapshot('exact record and retention preview')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm retention change' }))
  await screen.findByText('Record archived; original request and result retained.')
  expect(screen.getByRole('button', { name: 'Preview archive' }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByLabelText('Active record limit (1–20)'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview retention budget' }))
  await screen.findByRole('button', { name: 'Confirm retention change' })
  expect(activeLimit).toBe(20)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm retention change' }))
  await screen.findByText('Retention budget applied.')
  expect(activeLimit).toBe(2)
  expect(analysis.mock.calls.every(row => !['run', 'prepare'].includes(row[1]))).toBe(true)
})

it('withdraws an unmounted retention preview and refuses late confirmation controls', async () => {
  const gate = Promise.withResolvers<unknown>(); let signal: AbortSignal | undefined
  const analysis = vi.fn<EnvironmentInjected['analysis']>(async (_scope, _method, _input, lifetime) => { signal = lifetime; return gate.promise })
  const view = render(createElement(AnalysisHistory, { scope, analysis, t }))
  fireEvent.click(screen.getByText('Analysis history and retention'))
  fireEvent.click(screen.getByRole('button', { name: 'Load or refresh history' }))
  view.unmount(); expect(signal?.aborted).toBe(true)
  await act(async () => { gate.resolve({ ticket: 'late', action: 'archive', after: {} }); await gate.promise })
  expect(screen.queryByRole('button', { name: 'Confirm retention change' })).toBeNull()
  expect(analysis).toHaveBeenCalledTimes(1)
})

it('resets pages on filter changes and exports only the explicitly previewed original record', async () => {
  const row = { id: result.id, status: 'COMPLETED', startedAt: 1, connection: 'local', model: 'selected-model', archived: true }
  const path = 'D:/isolated-home/nidofy-extras/analysis-exports-v1/selected.json'
  const analysis = vi.fn<EnvironmentInjected['analysis']>(async (_scope, method, input) => {
    if (method === 'history') return { budget: { activeLimit: 20, archiveLimit: 80 }, active: 0, archived: 1,
      total: 'filter' in input && input.filter === 'active' ? 0 : 1,
      rows: 'filter' in input && input.filter === 'active' ? [] : [row], next: null }
    if (method === 'export-preview') return { ticket: 'export-ticket', action: 'export', journal: result.journal,
      after: { path, bytes: 123, format: 'side-analysis-export-v1', exactLocalFiles: true } }
    if (method === 'export-confirm') return { status: 'EXPORTED', path, bytes: 123 }
    throw Error('UNEXPECTED_SEND')
  })
  const view = render(createElement(AnalysisHistory, { scope, analysis, t }))
  fireEvent.click(screen.getByText('Analysis history and retention'))
  fireEvent.change(screen.getByLabelText('Show analysis records'), { target: { value: 'active' } })
  await screen.findByText('No retained analysis for this conversation.')
  fireEvent.change(screen.getByLabelText('Show analysis records'), { target: { value: 'archived' } })
  await screen.findByRole('button', { name: 'Preview local record export' })
  expect(analysis).toHaveBeenLastCalledWith(scope, 'history', { offset: 0, filter: 'archived' }, expect.any(AbortSignal))
  fireEvent.click(screen.getByRole('button', { name: 'Preview local record export' }))
  await screen.findByRole('button', { name: 'Export this exact record' })
  expect(analysis.mock.calls.some(row => row[1] === 'export-confirm')).toBe(false)
  expect(view.asFragment()).toMatchSnapshot('explicit exact local export preview')
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss export preview' }))
  expect(screen.queryByRole('button', { name: 'Export this exact record' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview local record export' }))
  await screen.findByRole('button', { name: 'Export this exact record' })
  fireEvent.click(screen.getByRole('button', { name: 'Export this exact record' }))
  await screen.findByText('Original record exported locally.')
  expect(screen.getByText('Saved to: ' + path)).toBeTruthy()
  expect(analysis.mock.calls.filter(row => row[1] === 'export-confirm')).toHaveLength(1)
  expect(analysis.mock.calls.every(row => !['run', 'prepare'].includes(row[1]))).toBe(true)
})
