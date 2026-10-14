// @vitest-environment jsdom
/** Cancellation withdraws late UI work while preserving actual owner settlement semantics. */
import { it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { NaturalSettings } from '../src/client/NaturalSettings.tsx'
import { en, zh } from '../src/client/locales.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CompanionScope } from '../src/client/companion.ts'
import type { EnvironmentInjected } from '../src/client/index.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsPreview, SettingsReceipt, SettingsSnapshot } from '../src/client/natural-settings.ts'
// Freeze only the fixture's time zone; production continues to use the user's zone.
// oxlint-disable-next-line typescript/unbound-method -- Invoked with the original Date receiver through call below.
const localDate = Date.prototype.toLocaleString
beforeEach(() => { vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, locales, options) {
  return localDate.call(this, locales, { ...options, timeZone: 'UTC' })
}) })
afterEach(() => { vi.restoreAllMocks() })
const scope: CompanionScope = { hostEpoch: null, windowId: null, viewId: null, panelId: null,
  workspaceId: null, sessionId: null, turn: null, revision: 1 }
const t: PropsLocale<'nidofy.environment'>['t'] = key => key in en ? en[key as keyof typeof en] : key
const plan: SettingsPreview = { id: 'explicit-plan', action: 'follow', scope, target: null, expiresAt: Date.now() + 60000, ownerPreview: null }
const snapshot: SettingsSnapshot = { scope, readAt: Date.parse('2026-10-13T04:00:00Z'), selectedPet: '1',
  toneEnabled: true, toneRevision: 2, petsEnabled: true,
  pet: { id: '1', enabled: true, pinned: 'observed-session', quiet: true }, followingSessionId: 'observed-session' }
const receipt: SettingsReceipt = { id: plan.id, action: 'follow', status: 'APPLIED', result: { followed: true } }
afterEach(() => { cleanup(); vi.useRealTimers() })
function props(previewSettings: EnvironmentInjected['previewSettings'], executeSettings: EnvironmentInjected['executeSettings']) {
  return { readSettings: vi.fn<EnvironmentInjected['readSettings']>(async () => snapshot), scope, pet: '1', t, previewSettings, executeSettings }
}
function begin() {
  fireEvent.click(screen.getByText('Quick settings'))
  fireEvent.change(screen.getByLabelText('One instruction'), { target: { value: 'Please follow this conversation.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview setting' }))
}
it('cancels a pending preview, ignores late controls and permits a new explicit preview', async () => {
  const gate = Promise.withResolvers<SettingsPreview>(); let signal: AbortSignal | undefined; let calls = 0
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async (_scope, _text, _pet, lifetime) => {
    signal = lifetime; return ++calls === 1 ? gate.promise : plan
  })
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  const view = render(createElement(NaturalSettings, props(preview, execute))); begin()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting' })); expect(signal?.aborted).toBe(true)
  expect(view.asFragment()).toMatchSnapshot('cancelled waiting preserves owner uncertainty')
  await act(async () => { gate.resolve(plan); await gate.promise })
  expect(screen.queryByRole('button', { name: 'Confirm this action' })).toBeNull(); expect(execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Preview setting' }))
  await screen.findByRole('button', { name: 'Confirm this action' })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm this action' }))
  await screen.findByText('Owner confirmed the action:'); expect(execute).toHaveBeenCalledTimes(1)
})
it('cancels waiting for execution without displaying a late receipt or automatically replaying it', async () => {
  const gate = Promise.withResolvers<SettingsReceipt>(); let signal: AbortSignal | undefined
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async () => plan)
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async (_scope, _id, lifetime) => { signal = lifetime; return gate.promise })
  render(createElement(NaturalSettings, props(preview, execute))); begin()
  await screen.findByRole('button', { name: 'Confirm this action' })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm this action' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel waiting' })); expect(signal?.aborted).toBe(true)
  await act(async () => { gate.resolve(receipt); await gate.promise })
  expect(screen.queryByText('Owner confirmed the action:')).toBeNull(); expect(execute).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Confirm this action' })).toBeNull()
})
it('withdraws pending previews on scope or selected-pet changes and ignores an older completion during new work', async () => {
  const first = Promise.withResolvers<SettingsPreview>(), second = Promise.withResolvers<SettingsPreview>()
  const signals: AbortSignal[] = []
  let calls = 0
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async (_scope, _text, _pet, lifetime) => {
    signals.push(lifetime); return ++calls === 1 ? first.promise : second.promise
  })
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  const input = props(preview, execute), view = render(createElement(NaturalSettings, input)); begin()
  const nextScope = { ...scope, revision: 2 }
  view.rerender(createElement(NaturalSettings, { ...input, scope: nextScope, pet: '2' }))
  expect(signals[0]?.aborted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Preview setting' }))
  await act(async () => { first.resolve(plan); await first.promise })
  expect(screen.queryByRole('button', { name: 'Confirm this action' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Cancel waiting' })).toBeTruthy()
  await act(async () => { second.resolve({ ...plan, scope: nextScope }); await second.promise })
  await screen.findByRole('button', { name: 'Confirm this action' }); expect(execute).not.toHaveBeenCalled()
  view.rerender(createElement(NaturalSettings, { ...input, scope: nextScope, pet: '3' }))
  expect(screen.queryByRole('button', { name: 'Confirm this action' })).toBeNull()
})
it('selects one finite action without previewing or executing and withdraws a previous choice', async () => {
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async (scope, _text, pet) => ({ ...plan, scope, action: 'mute', target: pet }))
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  render(createElement(NaturalSettings, props(preview, execute)))
  fireEvent.click(screen.getByText('Quick settings'))
  expect(screen.getByRole('combobox', { name: 'Available actions' }).querySelectorAll('option')).toHaveLength(13)
  fireEvent.change(screen.getByLabelText('Available actions'), { target: { value: 'mute' } })
  expect(screen.getByLabelText('One instruction')).toHaveProperty('value', 'Mute pet')
  expect(preview).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Preview setting' }))
  await screen.findByRole('button', { name: 'Confirm this action' })
  expect(preview).toHaveBeenCalledWith(scope, 'Mute pet', '1', expect.any(AbortSignal))
  expect(screen.getByText('1')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Available actions'), { target: { value: 'connections' } })
  expect(screen.queryByRole('button', { name: 'Confirm this action' })).toBeNull()
  expect(screen.getByText('Not used by this action')).toBeTruthy(); expect(preview).toHaveBeenCalledTimes(1)
  expect(execute).not.toHaveBeenCalled()
})
it.each(['en', 'zh'] as const)('shows selected targets and the bound deadline in %s and refuses an expired confirmation without replay', async (language) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T04:00:00Z'))
  const locale = language === 'en' ? en : zh
  const translated: PropsLocale<'nidofy.environment'>['t'] = key => key in locale ? locale[key as keyof typeof en] : key
  const boundScope: CompanionScope = { ...scope,
    sessionId: brandString<NonNullable<CompanionScope['sessionId']>>('settings-session'),
    workspaceId: brandString<NonNullable<CompanionScope['workspaceId']>>('settings-workspace') }
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async (scope, _text, pet) => ({ ...plan, scope, action: 'mute', target: pet, expiresAt: Date.now() + 1000 }))
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  const view = render(createElement(NaturalSettings, { ...props(preview, execute), t: translated, scope: boundScope, pet: 'bluewhale-2' }))
  fireEvent.click(screen.getByText(locale.naturalSettings))
  fireEvent.change(screen.getByLabelText(locale.settingsChoices), { target: { value: 'mute' } })
  expect(view.asFragment()).toMatchSnapshot('explicit finite choice and selected targets')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: locale.settingsPreview })) })
  expect(screen.getByText('settings-session')).toBeTruthy(); expect(screen.getByText('settings-workspace')).toBeTruthy()
  expect(screen.getByText('bluewhale-2')).toBeTruthy()
  const time = view.container.querySelector('time')
  expect(time?.dateTime).toBe('2026-10-12T04:00:01.000Z')
  expect(time?.textContent).toBe(new Date('2026-10-12T04:00:01Z').toLocaleString(locale.dateLocale))
  await act(async () => { vi.advanceTimersByTime(1000) })
  expect(screen.getByText(locale.settingsExpired)).toBeTruthy()
  expect(screen.getByRole('button', { name: locale.settingsExecute })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: locale.settingsExecute }))
  expect(preview).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: locale.settingsPreview })) })
  expect(screen.getByRole('button', { name: locale.settingsExecute })).toHaveProperty('disabled', false)
  expect(preview).toHaveBeenCalledTimes(2); expect(execute).not.toHaveBeenCalled()
})

it.each(['en', 'zh'] as const)('reads only on explicit choice, shows original settings and withdraws failed refresh in %s', async (language) => {
  const locale = language === 'en' ? en : zh
  const translated: PropsLocale<'nidofy.environment'>['t'] = key => key in locale ? locale[key as keyof typeof en] : key
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async () => plan)
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  const input = { ...props(preview, execute), t: translated }
  const view = render(createElement(NaturalSettings, input))
  fireEvent.click(screen.getByText(locale.naturalSettings))
  expect(input.readSettings).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: locale.settingsRead })) })
  expect(input.readSettings).toHaveBeenCalledWith(scope, '1', expect.any(AbortSignal))
  expect(screen.getByRole('region', { name: locale.settingsObservedLabel })).toBeTruthy()
  expect(view.asFragment()).toMatchSnapshot('explicit owner settings snapshot')
  expect(preview).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
  input.readSettings.mockRejectedValueOnce(Error('READ_UNAVAILABLE'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: locale.settingsRead })) })
  expect(screen.queryByRole('region', { name: locale.settingsObservedLabel })).toBeNull()
  expect(screen.getByText(locale.settingsReadFailed)).toBeTruthy()
  expect(screen.queryByRole('button', { name: locale.settingsExecute })).toBeNull()
  expect(execute).not.toHaveBeenCalled()
})
it('reads after uncertain execution without replay and clears the observation before a new explicit preview', async () => {
  const gate = Promise.withResolvers<SettingsReceipt>()
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async () => plan)
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => gate.promise)
  const input = props(preview, execute)
  render(createElement(NaturalSettings, input)); begin()
  await screen.findByRole('button', { name: en.settingsExecute })
  fireEvent.click(screen.getByRole('button', { name: en.settingsExecute }))
  fireEvent.click(screen.getByRole('button', { name: en.settingsCancelWaiting }))
  expect(screen.getByText(en.settingsCancelled)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.settingsRead })) })
  await act(async () => { gate.resolve(receipt); await gate.promise })
  expect(screen.getByRole('region', { name: en.settingsObservedLabel })).toBeTruthy()
  expect(screen.queryByText(en.settingsApplied)).toBeNull()
  expect(execute).toHaveBeenCalledTimes(1); expect(preview).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.settingsPreview })) })
  expect(screen.queryByRole('region', { name: en.settingsObservedLabel })).toBeNull()
  expect(preview).toHaveBeenCalledTimes(2); expect(execute).toHaveBeenCalledTimes(1)
})
it('withdraws a late read after target change or cancellation without automatically rereading', async () => {
  const first = Promise.withResolvers<SettingsSnapshot>(), second = Promise.withResolvers<SettingsSnapshot>()
  const preview = vi.fn<EnvironmentInjected['previewSettings']>(async () => plan)
  const execute = vi.fn<EnvironmentInjected['executeSettings']>(async () => receipt)
  const signals: AbortSignal[] = []
  const input = props(preview, execute)
  input.readSettings.mockImplementation(async (_scope, _pet, signal) => {
    signals.push(signal); return signals.length === 1 ? first.promise : second.promise
  })
  const view = render(createElement(NaturalSettings, input))
  fireEvent.click(screen.getByText(en.naturalSettings))
  fireEvent.click(screen.getByRole('button', { name: en.settingsRead }))
  view.rerender(createElement(NaturalSettings, { ...input, pet: '2', scope: { ...scope, revision: 2 } }))
  expect(signals[0]?.aborted).toBe(true)
  await act(async () => { first.resolve(snapshot); await first.promise })
  expect(screen.queryByRole('region', { name: en.settingsObservedLabel })).toBeNull()
  expect(input.readSettings).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: en.settingsRead }))
  fireEvent.click(screen.getByRole('button', { name: en.settingsCancelWaiting }))
  await act(async () => { second.resolve(snapshot); await second.promise })
  expect(signals[1]?.aborted).toBe(true)
  expect(screen.queryByRole('region', { name: en.settingsObservedLabel })).toBeNull()
  expect(preview).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled()
})
