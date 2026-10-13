// @vitest-environment jsdom
/** Preference controls wait for the owner and require rereading after ambiguity. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { NotificationSettings } from '../src/client/NotificationSettings.tsx'
import { en, zh } from '../src/client/locales.ts'
afterEach(cleanup)
it.each([en, zh])('keeps opt-in off until confirmation and withdraws controls after an unconfirmed write', async (copy) => {
  const read = vi.fn(async () => ({ enabled: false, revision: 4 }))
  const saved = Promise.withResolvers<unknown>()
  const save = vi.fn(() => saved.promise)
  render(<NotificationSettings read={read} save={save} t={makeTranslate(copy)} />)
  const checkbox = screen.getByRole('checkbox') as HTMLInputElement
  await act(async () => { await Promise.resolve() })
  expect(checkbox.checked).toBe(false)
  fireEvent.click(checkbox)
  expect(save).toHaveBeenCalledWith(4, true)
  expect(checkbox.disabled).toBe(true)
  expect(checkbox.checked).toBe(false)
  await act(async () => { saved.reject(Error('disconnected')); await saved.promise.catch(() => {}) })
  expect(screen.getByRole('alert').textContent).toBe(copy.notificationFailed)
  expect(checkbox.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }))
  await act(async () => { await Promise.resolve() })
  expect(read).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenCalledTimes(1)
  expect(checkbox.disabled).toBe(false)
})
