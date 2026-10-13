/** Desktop pet navigation uses the official workspace service and never touches conversation DOM. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Environment } from './Environment.tsx'
import { NotificationSettings } from './NotificationSettings.tsx'
import { ManagedConnections } from './ManagedConnections.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { en, zh } from './locales.ts'
import { wallpaperCss } from './appearance.ts'
import { createCompanionDraftStore } from './drafts.ts'
import { CompanionOwner, companionRequest } from './companion.ts'
import type { CompanionAction, CompanionScope, CompanionView } from './companion.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NaturalSettingsOwner, settingsTargetsPet } from './natural-settings.ts'
import type { SettingsPreview, SettingsReceipt, SettingsSnapshot } from './natural-settings.ts'
export type { CompanionOwnerProps } from './Environment.tsx'
export type { CompanionFacts, CompanionNoticeFact, CompanionReceiptFact } from '../shared/companion-facts.ts'
export type { HintPreferences } from '../shared/companion-facts.ts'
export type { Hint, HintId, CompanionReturnCard } from './hints.ts'
export type { Companion, CompanionAction, CompanionScope, CompanionView, CompanionHostEpoch, CompanionViewId, CompanionWindowId } from './companion.ts'

/** Framework-bound read source and scope-checked navigation for the rail. */
export interface EnvironmentInjected {
  /** @param scope - Current foreground. @param signal - UI lifetime. @returns Actual configured pet instances and master switch. */
  readPets(scope: CompanionScope, signal: AbortSignal): Promise<{
    enabled: boolean
    instances: { id: string; enabled: boolean; pinned: string | null; quiet: boolean }[]
  }>
  /** @param scope - Current foreground. @param pet - Explicit selected instance. @param signal - UI lifetime.
   * @returns Last read tone, pet and attention values; never previews or executes an action.
   */
  readSettings(scope: CompanionScope, pet: string, signal: AbortSignal): Promise<SettingsSnapshot>
  /** @param scope - Current foreground. @param text - Finite local instruction.
   * @param pet - Selected pet. @param signal - UI lifetime. @returns Expiring action preview.
   */
  previewSettings(scope: CompanionScope, text: string, pet: string, signal: AbortSignal): Promise<SettingsPreview>
  /** @param scope - Current foreground. @param id - Issued operation ID. @param signal - UI lifetime. @returns Original owner receipt. */
  executeSettings(scope: CompanionScope, id: string, signal: AbortSignal): Promise<SettingsReceipt>
  /** @param scope - Current idle foreground. @param method - Registered analysis operation.
   * @param input - Explicit selected input. @param signal - UI lifetime. @returns Private analysis facts.
   */
  analysis(scope: CompanionScope, method: 'options' | 'prepare' | 'run' | 'history' | 'history-read' | 'export-preview' | 'export-confirm' | 'archive-preview' | 'budget-preview' | 'retention-confirm', input: object, signal: AbortSignal): Promise<unknown>
  /** @param scope - Current foreground. @param id - Explicit completed result choice.
   * @returns Whether the unchanged resident draft accepted the authorized append.
   */
  appendAnalysis(scope: CompanionScope, id: string): Promise<boolean>
  readonly hooks: { readonly companion: HostObservable<CompanionView>; readonly attention: HostObservable<CompanionView | null> }
  follow: CompanionOwner['follow']
  releaseAttention: CompanionOwner['releaseAttention']
  openAttention: CompanionOwner['openAttention']
  refreshFacts: CompanionOwner['refresh']
  preferHints: CompanionOwner['preferHints']
  offeredHints: CompanionOwner['offeredHints']
  current: CompanionOwner['current']
  /** Delegate one local Session-level pet choice through the admitted Main document.
   * @param scope - Complete currently observed foreground scope.
   * @param action - Explicit binding, quiet or local interaction choice.
   * @param target - Configured pet instance selected by the user.
   * @returns Completion only while scope is current; ambiguous commits are not retried.
   */
  coordinatePet(scope: CompanionScope, action: 'bind' | 'unbind' | 'mute' | 'unmute' | 'interact', target: string): Promise<object>
  /** @param scope - Current full scope. @param method - Existing repository owner route.
   * @param input - Existing preview/read/confirm input. @param signal - Component lifetime.
   * @returns Bounded result while the complete scope remains current.
   */
  workbench(scope: CompanionScope, method: 'review/changes' | 'review/patch' | 'git/preview' | 'git/apply', input: object, signal: AbortSignal): Promise<unknown>
  /** @param scope - Observed scope. @param signal - Component lifetime. @returns Bounded environment observation. */
  readEnvironment(scope: CompanionScope, signal: AbortSignal): Promise<unknown>
  /** @param scope - Observed scope. @param action - Registered panel. @returns Scoped navigation completion. */
  open(scope: CompanionScope, action: CompanionAction): Promise<void>
}

export const name = 'nidofy-extras-client'
export const inject = ['uiWorkspace', 'uiSession', 'uiConversation', 'conversation', 'connection', 'sessions', 'workspaces', 'layout', 'slots', 'locale']
export function apply(ctx: Context): void {
  if (location.protocol !== 'dsh-app:' || location.hostname !== 'app') return
  const native = (window as Window & { dshDesktop?: { windowIdentity(): Promise<number> }
    nidofyWorkbench?: { openPanel(panel: string, workspace: string | undefined, scope: CompanionScope): Promise<void>
      coordinatePet?(scope: CompanionScope, input: object): Promise<unknown>
      onPetNavigate?(listener: (sessionId: string) => void): () => void
      scopeChanged(scope: CompanionScope, connected: boolean): void } })
  const desktop = native.dshDesktop, workbench = native.nidofyWorkbench
  if (!desktop || !workbench) throw Error('COMPANION_DESKTOP_UNAVAILABLE')
  const companion = new CompanionOwner(ctx, { windowIdentity: () => desktop.windowIdentity(),
    openPanel: (panel, workspace, scope) => workbench.openPanel(panel, workspace, scope) })
  const record = (raw: unknown): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('SETTINGS_RECEIPT_INVALID')
    return raw as Record<string, unknown>
  }
  const readPets: EnvironmentInjected['readPets'] = (scope, signal) => companion.using(scope, async (lifetime) => {
    const status = record(await companionRequest('/api/nidofy-extras/status', {}, lifetime)), preferences = record(status.preferences)
    const companions: readonly unknown[] = Array.isArray(preferences.companions) ? preferences.companions : []
    const instances = [preferences.pet, ...companions].map((raw) => {
      const row = record(raw)
      if (typeof row.id !== 'string' || typeof row.enabled !== 'boolean' || typeof row.quiet !== 'boolean'
        || row.pinned !== null && typeof row.pinned !== 'string') throw Error('PET_SETTINGS_INVALID')
      return { id: row.id, enabled: row.enabled, pinned: row.pinned, quiet: row.quiet }
    })
    return { enabled: preferences.pets === true, instances }
  }, signal)
  const settings = new NaturalSettingsOwner(scope => companion.current(scope), async (scope, action, signal) => {
    if (action === 'toneOn' || action === 'toneOff') return record(await companion.using(scope,
      lifetime => companionRequest('/api/nidofy/workbench/style/preview', { scope, enabled: action === 'toneOn' }, lifetime), signal))
    if (action === 'unfollow') return { followingSessionId: companion.attention.getSnapshot()?.scope.sessionId ?? null }
    if (settingsTargetsPet(action)) return companion.using(scope, async (lifetime) => {
      const raw = record(await companionRequest('/api/nidofy-extras/status', {}, lifetime)), preferences = record(raw.preferences)
      if (preferences.pets !== true) throw Error('PET_COMMAND_UNAVAILABLE')
      return { revision: preferences.revision }
    }, signal)
    return null
  }, async (plan, signal) => {
    const { scope, action } = plan
    if (action === 'toneOn' || action === 'toneOff') return record(await companion.using(scope,
      lifetime => companionRequest('/api/nidofy/workbench/style/execute', { scope, ticket: plan.ownerPreview && record(plan.ownerPreview).ticket,
        id: plan.id, accepted: true }, lifetime), signal))
    if (action === 'follow') { companion.follow(scope); return { sessionId: companion.attention.getSnapshot()?.scope.sessionId ?? null } }
    if (action === 'unfollow') {
      const followed = companion.attention.getSnapshot()?.scope.sessionId ?? null
      if (!plan.ownerPreview || record(plan.ownerPreview).followingSessionId !== followed) throw Error('SETTINGS_TARGET_CHANGED')
      companion.releaseAttention(); return { following: false }
    }
    if (action === 'connections' || action === 'builds' || action === 'pets') { await companion.open(scope, action); return { opened: action } }
    return companion.using(scope, async () => {
      if (!workbench.coordinatePet) throw Error('PET_COMMAND_UNAVAILABLE')
      return record(await workbench.coordinatePet(scope, { actionId: plan.id, action, target: plan.target,
        expiry: Math.min(plan.expiresAt, Date.now() + 10000),
        expectedRevision: plan.ownerPreview && record(plan.ownerPreview).revision }))
    }, signal)
  })
  ctx.effect(() => {
    const publish = () => {
      const view = companion.view.getSnapshot()
      workbench.scopeChanged(view.scope, view.connected)
    }
    const off = companion.view.subscribe(publish)
    publish()
    return () => { off(); workbench.scopeChanged(companion.view.getSnapshot().scope, false) }
  })
  ctx.effect(() => ctx.locale.register('nidofy.environment', { en, zh }))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({ name: 'settings.models.footer', id: 'nidofy-connections',
    locale: 'nidofy.environment', inject: () => ({ open: () => companion.open(companion.view.getSnapshot().scope, 'connections') }) }, ManagedConnections))
  const notificationBridge = (window as Window & { nidofyWorkbench?: { notifications?: () => Promise<unknown> } }).nidofyWorkbench
  if (notificationBridge?.notifications) {
    const read = notificationBridge.notifications
    const save = (expectedRevision: number, enabled: boolean) => companionRequest('/api/nidofy/workbench/notifications/configure',
      { expectedRevision, enabled }, AbortSignal.timeout(15000))
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'nidofy-notifications',
      order: 60, locale: 'nidofy.environment', inject: () => ({ read, save }) }, NotificationSettings))
  }
  ctx.slots.inject('shell.accessory', () => ctx.slots.register({ name: 'shell.accessory', locale: 'nidofy.environment', store: createCompanionDraftStore(), children: {
    'nidofy.companion': { kind: 'single', scope: 'root' }, 'nidofy.notebook': { kind: 'single', scope: 'root' },
  }, inject: (): EnvironmentInjected => ({ hooks: { companion: companion.view, attention: companion.attention },
    follow: (scope) =>{  companion.follow(scope) }, releaseAttention: () =>{  companion.releaseAttention() },
    openAttention: (scope) =>{  companion.openAttention(scope) }, refreshFacts: scope => companion.refresh(scope),
    preferHints: (scope, action, id, until) => companion.preferHints(scope, action, id, until),
    offeredHints: scope => companion.offeredHints(scope),
    current: scope => companion.current(scope),
    readPets,
    readSettings: (scope, pet, signal) => companion.using(scope, async (lifetime) => {
      const tone = record(await companionRequest('/api/nidofy/workbench/style/read', { scope }, lifetime))
      if (typeof tone.enabled !== 'boolean' || typeof tone.revision !== 'number' || !Number.isSafeInteger(tone.revision)
        || tone.revision < 0 || tone.effective !== 'next-turn') throw Error('SETTINGS_STATE_INVALID')
      const pets = await readPets(scope, lifetime)
      return { scope, readAt: Date.now(), selectedPet: pet, toneEnabled: tone.enabled, toneRevision: tone.revision,
        petsEnabled: pets.enabled, pet: pets.instances.find(row => row.id === pet) ?? null,
        followingSessionId: companion.attention.getSnapshot()?.scope.sessionId ?? null }
    }, signal),
    previewSettings: (scope, text, pet, signal) => settings.preview(scope, text, pet, signal),
    executeSettings: (scope, id, signal) => settings.execute(scope, id, signal),
    analysis: (scope, method, input, signal) => companion.using(scope, lifetime => companionRequest(
      '/api/nidofy/workbench/analysis/' + method, { ...input, scope }, lifetime), signal),
    appendAnalysis: async (scope, id) => {
      if (!companion.current(scope) || !scope.sessionId) return false
      const binding = ctx.sessions.binding(scope.sessionId)
      if (!binding) return false
      const input = ctx.conversation.input.for(binding.ctx)
      const revision = input.state.getSnapshot().draftRev
      const result = await companion.using(scope, signal => companionRequest('/api/nidofy/workbench/analysis/append', { scope, id }, signal))
      if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') throw Error('ANALYSIS_RESULT_INVALID')
      return input.appendText(result.text, revision)
    },
    coordinatePet: (scope, action, target) => companion.using(scope, async () => {
      if (!workbench.coordinatePet) throw Error('PET_COMMAND_UNAVAILABLE')
      return record(await workbench.coordinatePet(scope, { actionId: randomUUID(), action, target, expiry: Date.now() + 10000 }))
    }),
    workbench: (scope, method, input, signal) => companion.using(scope,
      operationSignal => companionRequest('/api/nidofy/workbench/' + method, input, operationSignal), signal),
    readEnvironment: (scope, signal) => companion.using(scope, operationSignal => companionRequest('/api/nidofy/workbench/context',
      { sessionId: scope.sessionId }, operationSignal), signal),
    open: (scope, action) => companion.open(scope, action),
  }) }, Environment))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.nidofyAppearance = ''
    style.textContent = wallpaperCss
    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.href = '/api/nidofy-extras/assets/theme/icon.png'
    document.head.append(style, icon)
    return () => { style.remove(); icon.remove() }
  })
  ctx.effect(() => {
    const off = workbench.onPetNavigate?.((sessionId) => {
      ctx.uiWorkspace.openSession(brandString<SessionId>(sessionId))
    })
    return () => { off?.() }
  })
}
