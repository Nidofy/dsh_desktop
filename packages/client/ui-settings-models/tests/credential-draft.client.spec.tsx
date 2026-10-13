// @vitest-environment jsdom
/** Every dirty secret asks before disposal; Escape keeps it and unmount settles pending decisions. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useCredentialDraftGuard, type DraftGuardRegistration } from '../src/client/credential-draft.tsx'
import { en, zh } from '../src/client/locales.ts'
afterEach(cleanup)
it.each([en, zh])('keeps the key until explicit discard and cancels pending navigation on unmount', async (copy) => {
  let guard: (() => Promise<boolean>) | undefined
  const off = vi.fn()
  const register: DraftGuardRegistration = (callback) => { guard = callback; return off }
  function Editor() {
    const [key, edit] = useState('')
    const { confirmation } = useCredentialDraftGuard(key.length > 0, false, name => copy[name], register)
    return <><input aria-label="key" value={key} onChange={(event) => { edit(event.target.value) }} />{confirmation}</>
  }
  const view = render(<Editor />)
  expect(guard).toBeUndefined()
  fireEvent.change(screen.getByLabelText('key'), { target: { value: 'synthetic-secret' } })
  let pending!: Promise<boolean>
  act(() => { pending = guard!() })
  expect(document.activeElement?.textContent).toBe(copy.keepEditing)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(await pending).toBe(false)
  expect((screen.getByLabelText('key') as HTMLInputElement).value).toBe('synthetic-secret')
  act(() => { pending = guard!() })
  fireEvent.click(screen.getByRole('button', { name: copy.discard }))
  expect(await pending).toBe(true)
  act(() => { pending = guard!() })
  view.unmount(); expect(await pending).toBe(false); expect(off).toHaveBeenCalled()
})
