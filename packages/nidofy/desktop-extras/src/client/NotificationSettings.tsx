/** Profile-wide opt-in for native notifications; reads and revisioned writes never start work. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
interface Preferences { enabled: boolean; revision: number }
/** Injected operations keep native transport outside the component. */
export interface NotificationSettingsInjected {
  /** @returns Current profile preference, without sending a notification. */
  read(this: void): Promise<unknown>
  /** @param revision - Last observed preference revision. @param enabled - Explicit user choice.
   * @returns The owner-confirmed preference after compare-and-swap.
   */
  save(this: void, revision: number, enabled: boolean): Promise<unknown>
}
function preferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean'
    || !('revision' in value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0)
    throw Error('NOTICE_PREFERENCES_INVALID')
  return { enabled: value.enabled, revision: value.revision }
}
/** @param props - Localized copy and authenticated preference operations.
 * @returns An explicit opt-in control with retry after an unconfirmed write.
 */
export function NotificationSettings({ read, save, t }: NotificationSettingsInjected & PropsLocale<'nidofy.environment'>) {
  const [value, setValue] = useState<Preferences>(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const lifetime = useRef(0)
  const run = async (operation: () => Promise<unknown>) => {
    const current = lifetime.current
    setBusy(true); setFailed(false)
    try { const next = preferences(await operation()); if (current === lifetime.current) setValue(next) }
    catch (error) { if (current === lifetime.current) { setValue(undefined); setFailed(true) } void error }
    finally { if (current === lifetime.current) setBusy(false) }
  }
  useEffect(() => { void run(read); return () => { lifetime.current++ } }, [read])
  return <section><label><input type="checkbox" checked={value?.enabled ?? false} disabled={busy || !value}
    onChange={(event) => { if (value) void run(() => save(value.revision, event.target.checked)) }} />{t('notificationPreference')}</label>
  <p>{t('notificationHint')}</p>{failed && <p role="alert">{t('notificationFailed')}</p>}
  <button type="button" disabled={busy} onClick={() => { void run(read) }}>{t('refresh')}</button></section>
}
