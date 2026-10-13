/** Application authorization is prepared and rechecked through the actual profile editor. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { configurationFixture } from './configuration-fixture.ts'

it.each(['prepare', 'commit'])('refuses %s authorization without changing the profile patch, and disposes the validator', async (phase) => {
  const { ctx, profile } = await configurationFixture({ hmr: false })
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'first')!
  const before = readFileSync(profile.patchPath, 'utf8')
  const dispose = ctx.configEditor.registerValidator(async (candidate, config) => {
    expect(candidate).toBe(entry); expect(config.count).toBe(6)
    if (phase === 'prepare') throw Error('SYNTHETIC_POLICY_REFUSED')
    return async () => { throw Error('SYNTHETIC_POLICY_CHANGED') }
  })
  await expect(ctx.configEditor.edit(entry, raw => ({ ...raw, count: 6 }))).rejects.toThrow('SYNTHETIC_POLICY_')
  expect(readFileSync(profile.patchPath, 'utf8')).toBe(before)
  dispose()
  await ctx.configEditor.edit(entry, raw => ({ ...raw, count: 6 }))
  expect(readFileSync(profile.patchPath, 'utf8')).toContain('count: 6')
})
