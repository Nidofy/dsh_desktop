import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotebookSettingsStore } from '../src/settings.ts'

it('defaults off, serializes competing choices and retains the accepted preference after restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'working-note-settings-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const store = new NotebookSettingsStore(home, false); await store.open()
  const originalSignal = store.signal
  expect(store.value.autoOrganize).toBe(false)
  const results = await Promise.allSettled([
    store.save({ ...store.value, autoOrganize: true }), store.save({ ...store.value, autoOrganize: false }),
  ])
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(originalSignal.aborted).toBe(true)
  expect(store.signal.aborted).toBe(false)
  const acceptedSignal = store.signal
  await store.close()
  expect(acceptedSignal.aborted).toBe(true)
  const restarted = new NotebookSettingsStore(home, false); await restarted.open()
  expect(restarted.value).toEqual({ schemaVersion: 1, revision: 1, autoOrganize: true })
  await restarted.save({ ...restarted.value, autoOrganize: false }); await restarted.close()
  const off = new NotebookSettingsStore(home, true); await off.open()
  expect(off.value.autoOrganize).toBe(false)
})
it('refuses unknown or malformed persisted preferences without overwriting them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'working-note-invalid-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'settings.json'), JSON.stringify({ schemaVersion: 2, autoOrganize: true }))
  await expect(new NotebookSettingsStore(home, false).open()).rejects.toThrow('NOTEBOOK_SETTINGS_INVALID')
})
