/** Saved geometry survives restart without placing a window outside the remaining monitor. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fitWindowBounds, readWindowState } from '../src/window-state.ts'
it('fits a removed monitor and a work area smaller than normal minimum dimensions', () => {
  expect(fitWindowBounds({ x: 2200, y: -900, width: 1280, height: 820 }, { x: 0, y: 0, width: 800, height: 560 }))
    .toEqual({ x: 0, y: 0, width: 800, height: 560 })
  expect(fitWindowBounds({ x: -1700, y: 80, width: 600, height: 700 }, { x: -1920, y: 0, width: 1920, height: 1080 }))
    .toEqual({ x: -1700, y: 80, width: 600, height: 700 })
})
it('reads owned saved bounds and rejects invalid dimensions', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-window-state-')), file = join(root, 'geometry.json')
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  expect(readWindowState(file)).toBeUndefined()
  const state = { bounds: { x: 80, y: 90, width: 1000, height: 700 }, maximized: true }
  writeFileSync(file, JSON.stringify(state)); expect(readWindowState(file)).toEqual(state)
  writeFileSync(file, JSON.stringify({ ...state, bounds: { ...state.bounds, width: 1e100 } }))
  expect(readWindowState(file)).toBeUndefined()
})
