/** Current built Main/preload and Client qualification in private real Electron windows. */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.runIf(process.platform === 'win32')('qualifies current Companion navigation, editing and Notebook lifecycle in the actual Electron carrier', async () => {
  const evidence = resolve('.build/dispatch/evidence/relay-15')
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/companion-carrier.mjs', import.meta.url)), evidence],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  child.stderr?.on('data', (chunk: Buffer) => { output.push(chunk.toString()) })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { done({ code, signal }) })
  })
  expect(result, output.join('')).toEqual({ code: 0, signal: null })
  for (const behavior of ['production-main-preload-authenticated-companion-bootstrap',
    'actual-electron-read-only-physical-facts-no-invented-verification',
    'actual-electron-hint-ignore-snooze-exact-project-mute-reload-restore-and-return-dedup-zero-model-calls',
    'actual-electron-notebook-edit-withdraws-old-hint-and-restores-corrected-source-without-scope-change',
    'actual-scoped-ipc-cancels-destroys-hidden-target-on-switch',
    'actual-host-client-notebook-hot-disable-enable-zero-model-requests',
    'native-narrow-modal-composition-escape-focus-draft-attachment-caret-retention',
    'actual-app-workbench-dual-window-native-identity-and-cross-sender-refusal',
    'actual-child-frame-stream-refusal',
    'actual-unowned-complete-root-refused-before-after-reload-and-destroyed',
    'actual-owned-root-reload-rejects-old-scope-and-restores-stream',
    'actual-electron-chinese-source-preview-explicit-draft-reference-zero-model-calls',
    'actual-electron-explicit-workspace-project-search-reference-unlinked-refusal-and-removal-zero-model-calls']) {
    expect(output.join('')).toContain(behavior)
  }
  console.log(output.join(''))
}, 120_000)
