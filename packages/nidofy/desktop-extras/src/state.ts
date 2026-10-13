/** Versioned optional preferences; legacy byte budgets remain explicitly identified. */
import { mkdir, readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { StorageService } from './storage.ts'

export interface PetSettings {
  id: string
  enabled: boolean
  resource: string
  scale: number
  interaction: boolean
  look: boolean
  pinned: string | null
  quiet: boolean
  position: { x: number; y: number } | null
  moodEnabled: boolean
  affinity: number
  lastInteractionMs: number
  bubble: { placement: 'top' | 'bottom'; fontSize: number; durationMs: number; theme: 'dark' | 'light' | 'blue'; templates: Record<string, string> }
}
export interface Preferences {
  schemaVersion: 2
  revision: number
  diagnostics: boolean
  cache: boolean
  vision: boolean
  pets: boolean
  cachePolicy: { mode: 'native' | 'off' | 'session'; models: string[] }
  visionRoute: { provider: string; model: string; maxTokens: number }
  pet: PetSettings
  companions: PetSettings[]
}
export const defaultPet = (id = '1'): PetSettings => ({ id, enabled: true, resource: 'xiaojing', scale: 1, interaction: true, look: true, pinned: null, quiet: false,
  position: null, moodEnabled: false, affinity: 0, lastInteractionMs: 0, bubble: { placement: 'top', fontSize: 14, durationMs: 5000, theme: 'dark', templates: {} } })
export const defaults = (): Preferences => ({ schemaVersion: 2, revision: 0, diagnostics: false, cache: false, vision: false, pets: false,
  cachePolicy: { mode: 'native', models: [] }, visionRoute: { provider: '', model: '', maxTokens: 4096 },
  pet: defaultPet(), companions: [] })

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_OBJECT')
  return value as Record<string, unknown>
}
export function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw Error('INVALID_TEXT')
  return value
}
export function validate(value: unknown): Preferences {
  const p = object(value), c = object(p.cachePolicy), v = object(p.visionRoute)
  if (p.schemaVersion !== 2 || !Number.isSafeInteger(p.revision) || Number(p.revision) < 0) throw Error('PREFERENCES_VERSION_UNSUPPORTED')
  for (const k of ['diagnostics', 'cache', 'vision', 'pets']) if (typeof p[k] !== 'boolean') throw Error('INVALID_PREFERENCE')
  if (!['native', 'off', 'session'].includes(String(c.mode)) || !Array.isArray(c.models) || c.models.length > 64) throw Error('INVALID_CACHE_POLICY')
  if (!Number.isInteger(v.maxTokens) || Number(v.maxTokens) < 64 || Number(v.maxTokens) > 32768) throw Error('INVALID_VISION_BUDGET')
  const pet = validatePet(p.pet, '1')
  const companions = p.companions ?? []
  if (!Array.isArray(companions) || companions.length > 2) throw Error('PET_INSTANCE_LIMIT')
  const others = companions.map(row => validatePet(row))
  if (new Set(['1', ...others.map(row => row.id)]).size !== others.length + 1) throw Error('INVALID_PET_ID')
  return { schemaVersion: 2, revision: Number(p.revision), diagnostics: p.diagnostics === true,
    cache: p.cache === true, vision: p.vision === true, pets: p.pets === true,
    cachePolicy: { mode: c.mode as Preferences['cachePolicy']['mode'], models: c.models.map(m => text(m)) },
    visionRoute: { provider: text(v.provider), model: text(v.model), maxTokens: Number(v.maxTokens) }, pet, companions: others }
}
function validatePet(value: unknown, requiredId?: string): PetSettings {
  const pet = { ...defaultPet(requiredId), ...object(value) }
  if (typeof pet.scale !== 'number' || ![0.75, 1, 1.25, 1.5].includes(pet.scale)) throw Error('INVALID_PET_SCALE')
  for (const k of ['interaction', 'look', 'quiet'] as const) if (typeof pet[k] !== 'boolean') throw Error('INVALID_PET_PREFERENCE')
  const resource = text(pet.resource, 48), pinned = pet.pinned === null ? null : text(pet.pinned, 128)
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(resource) || pinned !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(pinned)) throw Error('INVALID_PET_ID')
  const id = text(pet.id, 32), bubble = object(pet.bubble)
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || requiredId !== undefined && id !== requiredId || typeof pet.enabled !== 'boolean' || typeof pet.moodEnabled !== 'boolean') throw Error('INVALID_PET_ID')
  if (!Number.isSafeInteger(pet.affinity) || pet.affinity < 0 || pet.affinity > 100 || !Number.isSafeInteger(pet.lastInteractionMs) || pet.lastInteractionMs < 0) throw Error('INVALID_PET_MOOD')
  if (!['top', 'bottom'].includes(String(bubble.placement)) || !['dark', 'light', 'blue'].includes(String(bubble.theme)) || !Number.isInteger(bubble.fontSize) || Number(bubble.fontSize) < 10 || Number(bubble.fontSize) > 22 || !Number.isInteger(bubble.durationMs) || Number(bubble.durationMs) < 1000 || Number(bubble.durationMs) > 15000) throw Error('INVALID_PET_BUBBLE')
  const templates = object(bubble.templates)
  for (const [k, v] of Object.entries(templates)) if (!['WAITING_INPUT', 'WAITING_PERMISSION', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED', 'LIMIT_REACHED', 'UNKNOWN', 'INTERRUPTED'].includes(k) || text(v, 160).length > 160) throw Error('INVALID_PET_TEMPLATE')
  const position = pet.position === null ? null : object(pet.position)
  if (position && (!Number.isInteger(position.x) || !Number.isInteger(position.y) || Math.abs(Number(position.x)) > 100000 || Math.abs(Number(position.y)) > 100000)) throw Error('INVALID_PET_POSITION')
  return { id, enabled: pet.enabled, resource, pinned, scale: pet.scale, interaction:  pet.interaction, look:  pet.look, quiet:  pet.quiet,
    position: position ? { x: Number(position.x), y: Number(position.y) } : null,
    moodEnabled: pet.moodEnabled, affinity: pet.affinity, lastInteractionMs: pet.lastInteractionMs,
    bubble: { placement: bubble.placement as 'top' | 'bottom', theme: bubble.theme as 'dark' | 'light' | 'blue', fontSize: Number(bubble.fontSize), durationMs: Number(bubble.durationMs), templates: Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, text(v, 160)])) } }
}

/** Bounded regular-file reads exclude resource links before parsing. */
export async function readJson(path: string, max = 2 * 1024 * 1024): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > max) throw Error('FILE_REFUSED')
  const bytes = await readFile(path)
  if (bytes.length > max) throw Error('FILE_REFUSED')
  return JSON.parse(bytes.toString()) as unknown
}

/** Serialize CAS publication; unreadable state fails closed without replacing the original. */
export class PreferenceStore {
  value = defaults()
  warning: string | undefined
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly home: string, private readonly storage?: Pick<StorageService, 'write'>) {}
  async open(): Promise<void> {
    try { this.value = validate(await readJson(join(this.home, 'preferences.json'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = 'PREFERENCES_UNREADABLE' }
  }
  save(input: unknown): Promise<Preferences> {
    const operation = this.queue.catch(() => {}).then(async () => {
      if (this.warning) throw Error(this.warning)
      const next = validate(input)
      if (next.revision !== this.value.revision) throw Error('PREFERENCES_CONFLICT')
      next.revision++
      await mkdir(this.home, { recursive: true, mode: 0o700 })
      const path = join(this.home, 'preferences.json'), bytes = JSON.stringify(next)
      const write = () => writeFileAtomic(path, bytes, { mode: 0o600 })
      await (this.storage ? this.storage.write(path, Buffer.byteLength(bytes) * 2, write) : write())
      this.value = next
      return structuredClone(next)
    })
    this.queue = operation
    return operation
  }
  async close(): Promise<void> { await this.queue.catch(() => {}) }
}

/** Preserve old units. A byte value cannot become a token limit without an explicit new choice. */
export function migrateBudget(value: unknown): Record<string, unknown> {
  const p = object(value)
  if (p.schemaVersion === 1) {
    const budget = object(p.budget)
    if (!Number.isSafeInteger(budget.inputBytes) || Number(budget.inputBytes) < 1 || Number(budget.inputBytes) > 32768) throw Error('INVALID_LEGACY_BUDGET')
    return { sourceSchemaVersion: 1, originalUnit: 'bytes', originalInputBytes: budget.inputBytes, inputTokens: null, status: 'REVIEW_REQUIRED', autoRun: false }
  }
  if (p.schemaVersion === 2 && Number.isSafeInteger(p.inputTokens) && [512, 2048, 8192].includes(Number(p.inputTokens))) {
    return { schemaVersion: 2, unit: 'estimated-tokens', inputTokens: p.inputTokens, estimator: 'characters/4', autoRun: false }
  }
  throw Error('BUDGET_VERSION_UNSUPPORTED')
}
