/** Secret drafts stay in component memory until explicit save or discard. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { en } from './locales.ts'
export type DraftGuardRegistration = SettingsSectionOwnerProps['registerNavigationGuard']
/** Protect a typed credential from local Cancel, section navigation.
 * @param dirty - Whether an unsaved secret is present.
 * @param busy - Whether its owner is committing.
 * @param t - Models-owned copy.
 * @param register - Optional settings-shell navigation registration.
 * @returns Explicit discard decision and its confirmation surface.
 */
export function useCredentialDraftGuard(dirty: boolean, busy: boolean,
  t: (key: keyof typeof en) => string, register?: DraftGuardRegistration) {
  const [open, setOpen] = useState(false)
  const pending = useRef<{ promise: Promise<boolean>; resolve(value: boolean): void } | null>(null)
  const decide = useCallback((value: boolean) => { pending.current?.resolve(value); pending.current = null; setOpen(false) }, [])
  const ask = useCallback((): Promise<boolean> => {
    if (busy) return Promise.resolve(false)
    if (!dirty) return Promise.resolve(true)
    if (!pending.current) { pending.current = Promise.withResolvers<boolean>(); setOpen(true) }
    return pending.current.promise
  }, [dirty, busy])
  useEffect(() => dirty || busy ? register?.(ask) : undefined, [register, ask, dirty, busy])
  useEffect(() => () => { pending.current?.resolve(false) }, [])
  return { ask, confirmation: <Modal open={open} onClose={() => { decide(false) }} title={t('discardTitle')} closeLabel={t('close')} description={t('discardDescription')}
    footer={<><Button data-modal-autofocus onClick={() => { decide(false) }}>{t('keepEditing')}</Button><Button onClick={() => { decide(true) }}>{t('discard')}</Button></>} /> }
}
