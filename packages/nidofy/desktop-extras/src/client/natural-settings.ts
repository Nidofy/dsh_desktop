/** Local finite intent parsing; no model-produced paths, URLs, prompts or Shell commands are accepted. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CompanionScope } from './companion.ts'

/** Only these registered actions can appear in a settings preview. */
export type SettingsAction = 'follow' | 'unfollow' | 'connections' | 'builds' | 'pets' | 'bind' | 'unbind' | 'mute' | 'unmute' | 'interact' | 'toneOn' | 'toneOff'
/** One expiring choice; operation IDs are consumed before delegation. */
export interface SettingsPreview {
  id: string
  scope: CompanionScope
  action: SettingsAction
  target: string | null
  expiresAt: number
  ownerPreview: object | null
}
/** Explicit read of the current owners; values are a snapshot, never an execution receipt. */
export interface SettingsSnapshot {
  scope: CompanionScope
  readAt: number
  selectedPet: string
  toneEnabled: boolean
  toneRevision: number
  petsEnabled: boolean
  pet: { id: string; enabled: boolean; pinned: string | null; quiet: boolean } | null
  followingSessionId: string | null
}
/** Confirmed facts come from the original owner rather than the user's requested wording. */
export interface SettingsReceipt { id: string; action: SettingsAction; status: 'APPLIED'; result: object }
const phrases: Record<SettingsAction, readonly string[]> = {
  follow: ['关注这个会话', '关注当前会话', 'follow this conversation'], unfollow: ['停止关注', '取消关注', 'stop following'],
  connections: ['打开连接设置', '打开连接编辑器', 'open connections'], builds: ['打开工程工作台', 'open workbench'],
  pets: ['打开桌宠设置', 'open pet settings'], bind: ['绑定桌宠', 'bind pet'], unbind: ['解绑桌宠', 'unbind pet'],
  mute: ['静音桌宠', '关闭桌宠气泡', 'mute pet'], unmute: ['取消桌宠静音', '打开桌宠气泡', 'unmute pet'],
  interact: ['和桌宠打招呼', '向桌宠挥手', 'wave to pet'], toneOn: ['启用伙伴口吻', '打开伙伴口吻', 'enable companion tone'],
  toneOff: ['关闭伙伴口吻', '恢复普通口吻', 'disable companion tone'],
}
/** The action picker and local parser share the existing finite action list. */
export const settingsActions: readonly SettingsAction[] = Object.keys(phrases) as SettingsAction[]
/** @param action - Registered choice. @returns Whether this action uses the explicitly selected pet instance. */
export function settingsTargetsPet(action: SettingsAction): boolean {
  return ['bind', 'unbind', 'mute', 'unmute', 'interact'].includes(action)
}
/** @param text - One short local instruction. @returns Registered action or an explicit refusal; no remote parsing. */
export function parseSettingsIntent(text: string): SettingsAction {
  if (!text.isWellFormed() || text.length > 512) throw Error('SETTINGS_INTENT_REFUSED')
  const normalized = text.trim().toLowerCase().replace(/^(?:请(?:帮我)?\s*|please\s+)/u, '').replace(/[。.!！]$/u, '')
  const matches = settingsActions.filter(action => phrases[action].includes(normalized))
  const action = matches[0]
  if (matches.length !== 1 || action === undefined) throw Error('SETTINGS_INTENT_REFUSED')
  return action
}
/** Operation-local preview and receipt owner over the original scoped executors. */
export class NaturalSettingsOwner {
  private readonly plans = new Map<string, SettingsPreview>()
  private readonly executions = new Map<string, { scope: CompanionScope; result: Promise<SettingsReceipt> }>()
  constructor(private readonly current: (scope: CompanionScope) => boolean,
    private readonly previewOwner: (scope: CompanionScope, action: SettingsAction, signal: AbortSignal) => Promise<object | null>,
    private readonly executeOwner: (plan: SettingsPreview, signal: AbortSignal) => Promise<object>, private readonly now = Date.now) {}
  /** @param scope - Complete foreground observation. @param text - Exact finite intent. @param pet - Explicit selected instance.
   * @param signal - UI lifetime.
   * @returns Bound preview, expiring within sixty seconds or at the earlier owner deadline; performs no mutation.
   */
  async preview(scope: CompanionScope, text: string, pet: string, signal: AbortSignal): Promise<SettingsPreview> {
    signal.throwIfAborted(); if (!this.current(scope)) throw Error('SETTINGS_SCOPE_CHANGED')
    const action = parseSettingsIntent(text), target = settingsTargetsPet(action) ? pet : null
    if (target !== null && !/^[a-zA-Z0-9_-]{1,32}$/u.test(target)) throw Error('SETTINGS_TARGET_REQUIRED')
    for (const [id, plan] of this.plans) if (plan.expiresAt <= this.now()) this.plans.delete(id)
    if (this.plans.size >= 16 || this.executions.size >= 128) throw Error('SETTINGS_OPERATION_LIMIT')
    const ownerPreview = await this.previewOwner(scope, action, signal)
    signal.throwIfAborted(); if (!this.current(scope)) throw Error('SETTINGS_SCOPE_CHANGED')
    let expiresAt = this.now() + 60000
    if (ownerPreview && 'expiresAt' in ownerPreview) {
      if (typeof ownerPreview.expiresAt !== 'number' || !Number.isFinite(ownerPreview.expiresAt)) throw Error('SETTINGS_PREVIEW_EXPIRED')
      expiresAt = Math.min(expiresAt, ownerPreview.expiresAt)
    }
    if (expiresAt <= this.now()) throw Error('SETTINGS_PREVIEW_EXPIRED')
    const plan: SettingsPreview = { id: randomUUID(), scope, action, target, expiresAt, ownerPreview }
    this.plans.set(plan.id, plan); return plan
  }
  /** @param scope - Current foreground. @param id - Previously issued operation ID. @param signal - UI lifetime.
   * @returns Original owner's actual result; duplicates join the same settlement and failures are never replayed.
   */
  execute(scope: CompanionScope, id: string, signal: AbortSignal): Promise<SettingsReceipt> {
    signal.throwIfAborted(); if (!this.current(scope)) return Promise.reject(Error('SETTINGS_SCOPE_CHANGED'))
    const prior = this.executions.get(id)
    if (prior) return JSON.stringify(prior.scope) === JSON.stringify(scope) ? prior.result : Promise.reject(Error('SETTINGS_SCOPE_CHANGED'))
    const plan = this.plans.get(id); this.plans.delete(id)
    if (!plan || plan.expiresAt <= this.now() || JSON.stringify(plan.scope) !== JSON.stringify(scope)) return Promise.reject(Error('SETTINGS_PREVIEW_EXPIRED'))
    const work = (async (): Promise<SettingsReceipt> => {
      const result = await this.executeOwner(plan, signal)
      signal.throwIfAborted()
      return { id, action: plan.action, status: 'APPLIED', result }
    })()
    this.executions.set(id, { scope: plan.scope, result: work }); return work
  }
}
