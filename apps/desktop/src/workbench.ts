/** Native artifact actions revalidate a Host-owned lease before invoking Electron. */
import { ipcMain, dialog, shell, net, Notification } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { lstat, open } from 'node:fs/promises'
import { basename } from 'node:path'
import { WorkbenchNoticeConsumer } from './workbench-notifications.ts'
import type { SystemNotice } from './workbench-notifications.ts'
import type { DesktopMessages } from './locale.ts'
/** Register derived-desktop file actions on the existing authenticated Host.
 * @param admit - Existing top-frame app sender check.
 * @param backend - Current Host URL and private cookie, never exposed to the renderer.
 * @param messages - Current shell-owned localized notice copy.
 * @param openSource - Explicit notification-click locator; never grants execution or acceptance.
 * @param openSession - Navigate an existing main conversation without resuming its agent.
 * @returns Disposer for the IPC handlers.
 */
export function installWorkbenchDesktop(admit: (event: IpcMainInvokeEvent) => void, backend: () => {
  url: string
  cookie: string
}, messages: () => DesktopMessages,
openSource: (notice: SystemNotice) => Promise<void>, openSession: (id: string) => void): () => Promise<void> {
  const fetchHost = (path: string, init?: RequestInit): Promise<Response> => {
    const host = backend(), url = new URL(path, host.url)
    const headers = new Headers(init?.headers)
    headers.set('origin', url.origin)
    headers.set('cookie', host.cookie)
    return net.fetch(url.toString(), { ...init, headers, signal: AbortSignal.timeout(60000) })
  }
  ipcMain.handle('nidofy:artifact', async (event, id: unknown, action: unknown) => {
    admit(event)
    if (typeof id !== 'string' || id.length > 100 || !['open', 'reveal', 'save'].includes(String(action)))
      throw Error('ARTIFACT_REQUEST_INVALID')
    const response = await fetchHost('/api/nidofy/workbench/artifact/lease', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }) })
    const value: unknown = await response.json()
    if (!response.ok || value === null || typeof value !== 'object' || !('target' in value) || !('fingerprint' in value) || typeof value.target !== 'string')
      throw Error('ARTIFACT_LEASE_REFUSED')
    const target = value.target, info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':') !== value.fingerprint)
      throw Error('ARTIFACT_CHANGED')
    if (action === 'reveal') {
      shell.showItemInFolder(target)
      return { accepted: true }
    }
    if (action === 'open') {
      const error = await shell.openPath(target)
      if (error)
        throw Error('ARTIFACT_OPEN_FAILED')
      return { accepted: true }
    }
    const selected = await dialog.showSaveDialog({ defaultPath: basename(target) })
    if (selected.canceled || !selected.filePath)
      return { cancelled: true }
    const download = await fetchHost('/api/nidofy/workbench/artifact/download?id=' + encodeURIComponent(id))
    if (!download.ok || !download.body)
      throw Error('ARTIFACT_DOWNLOAD_REFUSED')
    // Exclusive creation avoids replacing a file changed after the save dialog's overwrite check.
    const file = await open(selected.filePath, 'wx', 0o600), reader = download.body.getReader()
    let bytes = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done)
          break
        bytes += chunk.value.byteLength
        if (bytes > 512 * 1024 * 1024)
          throw Error('ARTIFACT_TOO_LARGE')
        await file.writeFile(chunk.value)
      }
      if (bytes !== Number(download.headers.get('content-length')))
        throw Error('ARTIFACT_DOWNLOAD_INCOMPLETE')
      await file.sync()
    }
    finally {
      await reader.cancel()
      await file.close()
    }
    return { saved: true, bytes }
  })
  const request = async (method: string, input: object = {}): Promise<unknown> => {
    const response = await fetchHost('/api/nidofy/workbench/' + method, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    const value: unknown = await response.json()
    if (!response.ok) throw Error('NOTIFICATION_REQUEST_REFUSED')
    return value
  }
  let stopping = false
  const displayed = new Set<Notification>()
  const consumer = new WorkbenchNoticeConsumer(request, async (notice) => {
    if (stopping) return 'suppressed'
    if (!Notification.isSupported()) return 'failed'
    const t = messages(), notification = new Notification({ title: notice.sourceType === 'job' ? t.jobNoticeTitle : notice.sourceType === 'session' ? t.sessionNoticeTitle : t.verificationNoticeTitle,
      body: notice.sourceType === 'job' ? notice.kind === 'completed' ? t.jobNoticeCompleted : notice.kind === 'cancelled' ? t.jobNoticeCancelled : t.jobNoticeFailed
        : notice.sourceType === 'session' ? notice.kind === 'completed' ? t.sessionNoticeCompleted
          : notice.kind === 'cancelled' ? t.sessionNoticeCancelled : notice.kind === 'blocked' ? t.sessionNoticeBlocked
            : notice.kind === 'limit-reached' ? t.sessionNoticeLimit : notice.kind === 'interrupted' ? t.sessionNoticeInterrupted : t.sessionNoticeFailed
          : notice.kind === 'failed' ? t.verificationNoticeFailed : notice.kind === 'cancelled'
            ? t.verificationNoticeCancelled : t.verificationNoticeAcceptance })
    displayed.add(notification)
    notification.once('click', () => {
      if (stopping) return
      void openSource(notice).then(() => request('notifications/handle', { id: notice.id }))
        .catch(() => { /* A failed locator leaves the notice unhandled. */ })
    })
    notification.once('close', () => { displayed.delete(notification) })
    return new Promise((resolve) => {
      const finish = (outcome: 'sent' | 'failed' | 'unknown'): void => {
        clearTimeout(deadline); notification.removeListener('show', shown); notification.removeListener('failed', failed)
        notification.removeListener('close', closed)
        resolve(outcome)
      }
      const shown = (): void => { finish('sent') }, failed = (): void => { finish('failed') }
      const closed = (): void => { finish('unknown') }
      const deadline = setTimeout(() => { finish('unknown') }, 60000)
      notification.once('show', shown); notification.once('failed', failed); notification.once('close', closed)
      try { notification.show() } catch (error) { void error; finish('failed') }
    })
  })
  ipcMain.handle('nidofy:notifications', (event) => { admit(event); return request('notifications/preferences') })
  ipcMain.handle('nidofy:open-session', async (event, id: unknown) => {
    admit(event)
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('SESSION_ID_INVALID')
    await request('recovery', { sessionId: id })
    openSession(id)
  })
  const timer = setInterval(() => {
    if (stopping) return
    try {
      const host = backend()
      void consumer.tick(host.url + '\0' + host.cookie).catch(() => { /* Reconnection establishes a fresh durable baseline. */ })
    } catch (error) { /* The Host is not ready; no notice can be consumed. */ void error }
  }, 3000)
  timer.unref()
  return async () => {
    stopping = true; clearInterval(timer)
    ipcMain.removeHandler('nidofy:artifact'); ipcMain.removeHandler('nidofy:notifications'); ipcMain.removeHandler('nidofy:open-session')
    for (const notification of displayed) { notification.removeAllListeners('click'); notification.close() }
    displayed.clear(); await consumer.close()
  }
}
