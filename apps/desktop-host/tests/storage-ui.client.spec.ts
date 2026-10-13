// @vitest-environment jsdom
/** Actual page script; source behavior below is independent of native/build authentication qualification. */
import { expect, it, vi, afterEach } from 'vitest'
import { Script } from 'node:vm'
import { storageHtml } from '../src/storage/ui.ts'

afterEach(() => { document.body.replaceChildren() })
function button(id: string): HTMLButtonElement {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLButtonElement)) throw Error('Missing button')
  return value
}
function input(id: string): HTMLInputElement {
  const value = document.getElementById(id)
  if (!(value instanceof HTMLInputElement)) throw Error('Missing field')
  return value
}
async function mount(chinese: boolean, fails = false,
  dispatch?: (url: string, args: Record<string, unknown>) => Promise<Response> | Response | undefined) {
  const calls: Record<string, unknown>[] = []
  const quota = { scan: 'not-run', measuredBytes: null, observedBytes: 1200, reservedBytes: 6000,
    ordinaryBytes: 4000, terminalBytes: 2000, pendingOperations: 1, limitBytes: 1000000, safetyBytes: 100000,
    ledgerBytes: 400, ledgerLimitBytes: 134217728, drained: null as boolean | null }
  let refuse = fails
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw Error('Expected JSON request')
    const args = JSON.parse(init.body) as Record<string, unknown>
    if (url.endsWith('/storage')) return Response.json({ measuredBytes: null, observedBytes: 1234,
      scan: 'incomplete', issues: [{ code: 'UNKNOWN_ENTRY', path: '<img src=x>' }] })
    calls.push(args)
    const response = dispatch?.(url, args)
    if (response) return response
    if (refuse) { refuse = false; return Response.json({ error: 'STORAGE_SCAN_INCOMPLETE' }, { status: 400 }) }
    if (args.action === 'inspect') return Response.json({ status: 'unknown' })
    if (args.action === 'configure') { quota.limitBytes = Number(args.limitBytes); return Response.json({ limitBytes: quota.limitBytes }) }
    if (args.action === 'recover') { quota.scan = 'incomplete'; quota.drained = false; return Response.json(quota) }
    return Response.json(quota)
  })
  const html = storageHtml(chinese), script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
  if (!script) throw Error('Missing script')
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '')
  new Script(script).runInNewContext({ document, fetch })
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false) })
  return { calls, quota }
}

it.each([false, true])('keeps incomplete totals and retained terminal grants separate in Chinese=%s', async (chinese) => {
  const f = await mount(chinese)
  expect(document.getElementById('measuredBytes')?.textContent).toBe(chinese ? '未知' : 'Unknown')
  expect(document.getElementById('reservedBytes')?.textContent).toBe('6000')
  expect(document.getElementById('terminalBytes')?.textContent).toBe('2000')
  expect(document.getElementById('inventoryMeasured')?.textContent).toBe(chinese ? '未知' : 'Unknown')
  expect(document.querySelector('#inventoryDetails img')).toBeNull()
  expect(f.calls).toEqual([{ action: 'status' }])
  expect(button('recover').disabled).toBe(true)
  input('confirm').checked = true; input('confirm').dispatchEvent(new Event('change'))
  button('recover').click()
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false); expect(input('confirm').checked).toBe(false) })
  expect(document.getElementById('scan')?.textContent).toContain(chinese ? '尚未排空' : 'undrained')
  expect(document.getElementById('reservedBytes')?.textContent).toBe('6000')
  input('limit').value = '100'; button('configure').click()
  await vi.waitFor(() => { expect(f.quota.limitBytes).toBe(100); expect(button('refresh').disabled).toBe(false) })
  expect(document.getElementById('terminalBytes')?.textContent).toBe('2000')
  input('operationId').value = 'unknown-operation'; button('inspect').click()
  await vi.waitFor(() => { expect(document.getElementById('operationStatus')?.textContent).toContain(chinese ? '没有重放' : 'no authority to replay') })
  expect(f.calls.filter(row => row.action === 'recover')).toHaveLength(1)
})

it('keeps capacity mutations disabled after a failed initial read and allows explicit refresh', async () => {
  await mount(false, true)
  expect(button('configure').disabled).toBe(true); expect(button('recover').disabled).toBe(true)
  expect(document.getElementById('status')?.textContent).toContain('STORAGE_SCAN_INCOMPLETE')
  button('refresh').click()
  await vi.waitFor(() => { expect(button('configure').disabled).toBe(false) })
})

function chooseSnapshot(id: string): void {
  const select = document.getElementById('snapshot')
  if (!(select instanceof HTMLSelectElement)) throw Error('Missing snapshot selector')
  select.value = id; select.dispatchEvent(new Event('change'))
}
function check(id: string): void { input(id).checked = true; input(id).dispatchEvent(new Event('change')) }
const snapshots = [{ id: 'one', workspace: '<img src=x>', sealed: true }, { id: 'two', workspace: 'other', sealed: true }]
const preview = { revision: 'a'.repeat(64), rows: [
  { path: 'safe.txt', status: 'READY', message: '<img src=x>' }, { path: 'changed.txt', status: 'CONFLICT', message: 'changed' },
] }

it.each([false, true])('requires file selection and a separate restore confirmation in Chinese=%s', async (chinese) => {
  const f = await mount(chinese, false, (_url, args) => {
    if (args.action === 'list') return Response.json({ items: snapshots })
    if (args.action === 'preview') return Response.json(preview)
    if (args.action === 'restore') return Response.json({ rows: [{ path: 'safe.txt', status: 'RESTORED' }] })
  })
  button('snapshotList').click()
  await vi.waitFor(() => { expect(document.querySelectorAll('#snapshot option')).toHaveLength(3) })
  chooseSnapshot('one'); button('preview').click()
  await vi.waitFor(() => { expect(document.querySelectorAll('#restoreRows input')).toHaveLength(2) })
  expect(document.querySelector('#restoreRows img')).toBeNull()
  expect(document.querySelectorAll('#restoreRows input:checked')).toHaveLength(0)
  const ready = document.querySelector<HTMLInputElement>('#restoreRows input')
  if (!ready) throw Error('Missing READY row')
  expect(document.querySelector<HTMLInputElement>('#restoreRows input[value="changed.txt"]')?.disabled).toBe(true)
  ready.checked = true; ready.dispatchEvent(new Event('change'))
  expect(button('restore').disabled).toBe(true)
  check('restoreConfirm'); button('restore').click()
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false); expect(document.getElementById('snapshotResult')?.textContent).toContain('RESTORED') })
  expect(f.calls.filter(row => row.action === 'restore')).toEqual([
    { action: 'restore', id: 'one', paths: ['safe.txt'], expectedRevision: preview.revision },
  ])
  expect(input('restoreConfirm').checked).toBe(false); expect(button('restore').disabled).toBe(true)
})

it('discards late restore and archive previews when their selected inputs change', async () => {
  let finishPreview: ((value: Response) => void) | undefined, finishArchive: ((value: Response) => void) | undefined
  const f = await mount(false, false, (_url, args) => {
    if (args.action === 'list') return Response.json({ items: snapshots })
    if (args.action === 'preview') return new Promise((resolve) => { finishPreview = resolve })
    if (args.action === 'verifyArchive') return new Promise((resolve) => { finishArchive = resolve })
  })
  button('snapshotList').click()
  await vi.waitFor(() => { expect(document.querySelectorAll('#snapshot option')).toHaveLength(3) })
  chooseSnapshot('one'); button('preview').click()
  await vi.waitFor(() => { expect(finishPreview).toBeDefined() })
  chooseSnapshot('two'); finishPreview?.(Response.json(preview))
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false) })
  expect(document.querySelectorAll('#restoreRows input')).toHaveLength(0)
  input('archiveDirectory').value = 'old'; button('verify').click()
  await vi.waitFor(() => { expect(finishArchive).toBeDefined() })
  input('archiveDirectory').value = 'new'; input('archiveDirectory').dispatchEvent(new Event('input'))
  finishArchive?.(Response.json({ revision: 'b'.repeat(64), files: 1, bytes: 20 }))
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false) })
  check('importConfirm'); expect(button('importArchive').disabled).toBe(true)
  expect(f.calls.some(row => row.action === 'importArchive' || row.action === 'restore')).toBe(false)
})

it('imports a verified archive without restoration and disables replay after an unknown result', async () => {
  const f = await mount(false, false, (_url, args) => {
    if (args.action === 'verifyArchive') return Response.json({ revision: 'b'.repeat(64), files: 1, bytes: 20 })
    if (args.action === 'importArchive') return Response.json({ error: 'STORAGE_NATIVE_OUTCOME_UNKNOWN', operationId: 'retained-operation' }, { status: 400 })
  })
  input('archiveDirectory').value = 'archive'; button('verify').click()
  await vi.waitFor(() => { expect(document.getElementById('archiveStatus')?.textContent).toContain('Archive verified') })
  expect(button('importArchive').disabled).toBe(true)
  check('importConfirm'); button('importArchive').click()
  await vi.waitFor(() => { expect(button('refresh').disabled).toBe(false); expect(input('operationId').value).toBe('retained-operation') })
  expect(f.calls.filter(row => row.action === 'importArchive')).toEqual([
    { action: 'importArchive', directory: 'archive', expectedRevision: 'b'.repeat(64) },
  ])
  expect(f.calls.some(row => row.action === 'restore')).toBe(false)
  expect(button('importArchive').disabled).toBe(true); expect(input('importConfirm').checked).toBe(false)
  expect(document.getElementById('snapshotStatus')?.textContent).toContain('unknown results cannot replay')
})
