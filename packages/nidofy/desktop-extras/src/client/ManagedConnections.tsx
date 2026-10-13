/** Read-only discovery beside official provider settings; edits stay with the connection owner. */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { companionRequest } from './companion.ts'
interface Row { id: string; name: string; availability: string }
/** @param props - Localized copy and an explicitly invoked management-window action.
 * @returns Managed connection discovery without credentials or provider configuration mutations.
 */
export function ManagedConnections({ open, t }: PropsLocale<'nidofy.environment'> & { open(this: void): Promise<void> }) {
  const [rows, setRows] = useState<Row[]>(), [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void companionRequest('/api/nidofy/status', {}, controller.signal).then((value) => {
      if (!value || typeof value !== 'object' || !('connections' in value) || !Array.isArray(value.connections)) throw Error('CONNECTION_STATUS_INVALID')
      const rows = value.connections.map((value: unknown): Row => {
        if (!value || typeof value !== 'object' || !('connection' in value) || typeof value.connection !== 'string'
          || !('availability' in value) || typeof value.availability !== 'string') throw Error('CONNECTION_STATUS_INVALID')
        const profile: unknown = 'profile' in value ? value.profile : null
        const name = profile && typeof profile === 'object' && 'displayName' in profile && typeof profile.displayName === 'string'
          ? profile.displayName : value.connection
        return { id: value.connection, name, availability: value.availability }
      })
      if (!controller.signal.aborted) setRows(rows)
    }).catch((error: unknown) => { if (!controller.signal.aborted) setFailed(true); void error })
    return () => { controller.abort() }
  }, [])
  return <section><h3>{t('connections')}</h3><p>{t('managedConnectionsHint')}</p>
    {rows?.map(row => <p key={row.id}>{row.name} · {t(row.availability === 'available' ? 'managedAvailable' : 'managedUnavailable')}</p>)}
    {failed && <p role="alert">{t('managedReadFailed')}</p>}
    <button type="button" onClick={() => { void open().catch(() => { setFailed(true) }) }}>{t('openConnections')}</button></section>
}
