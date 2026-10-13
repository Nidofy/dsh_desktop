// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { OfflineScriptOwner } from '../src/client/offline-script.ts'

it('removes the pending script when its last consumer cancels and permits a later retry', async () => {
  const owner = new OfflineScriptOwner('/fixed-core.js'), a = new AbortController(), b = new AbortController()
  const first = owner.acquire(a.signal), second = owner.acquire(b.signal)
  const rejectedA = expect(first).rejects.toThrow(), rejectedB = expect(second).rejects.toThrow()
  expect(document.head.querySelectorAll('script')).toHaveLength(1)
  a.abort(); await rejectedA; expect(document.head.querySelectorAll('script')).toHaveLength(1)
  b.abort(); await rejectedB; expect(document.head.querySelectorAll('script')).toHaveLength(0)
  const retry = owner.acquire(new AbortController().signal)
  document.head.querySelector('script')!.dispatchEvent(new Event('load')); await retry
  expect(document.head.querySelectorAll('script')).toHaveLength(0)
  await owner.acquire(new AbortController().signal)
  expect(document.head.querySelectorAll('script')).toHaveLength(0)
})

it('clears failed loader state so an explicit retry can succeed', async () => {
  const owner = new OfflineScriptOwner('/fixed-core.js'), failed = owner.acquire(new AbortController().signal)
  const rejected = expect(failed).rejects.toThrow('LIVE2D_WEB_SDK_UNAVAILABLE')
  document.head.querySelector('script')!.dispatchEvent(new Event('error')); await rejected
  const retry = owner.acquire(new AbortController().signal)
  document.head.querySelector('script')!.dispatchEvent(new Event('load')); await retry
  expect(document.head.querySelectorAll('script')).toHaveLength(0)
})
