/** Actual home environment edits and immutable launch-time policy; no network or user data. */
import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { DeploymentSettings } from '../src/connections/deployment.ts'

async function fixture(values: Record<string, string> = {}, source: 'process' | 'user-env' = 'user-env') {
  const home = await mkdtemp(join(tmpdir(), 'deployment-settings-')), ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  ctx.provide('launchEnvironment', { get: name => values[name] === undefined ? undefined : { value: values[name], source },
    getFrom: (name, sources) => sources.includes(source) && values[name] !== undefined ? { value: values[name], source } : undefined })
  return { home, settings: new DeploymentSettings(ctx, home) }
}

it('preserves unrelated bytes and values, edits only dirty fields, and keeps this launch policy', async () => {
  const { home, settings } = await fixture({ HTTP_PROXY: 'http://old.invalid:8080/' })
  const untouched = '# User comments\nUNRELATED_KEY="synthetic-unrendered"\nMULTILINE="first\nsecond"\nhttp_proxy=http://old.invalid:8080/\n'
  await writeFile(join(home, '.env'), untouched)
  const prior = await settings.status()
  const result = await settings.request({ action: 'save', expectedRevision: prior.revision,
    fields: { httpProxy: 'http://new.invalid:8081', noProxy: 'intranet.invalid,.example.invalid' } })
  const file = await readFile(join(home, '.env'), 'utf8')
  expect(file.startsWith(untouched)).toBe(true)
  expect(parseEnv(file)).toMatchObject({ UNRELATED_KEY: 'synthetic-unrendered', MULTILINE: 'first\nsecond',
    HTTP_PROXY: 'http://new.invalid:8081/', http_proxy: 'http://new.invalid:8081/' })
  expect(result.fields.httpProxy).toMatchObject({ saved: { value: 'http://new.invalid:8081/' },
    applied: { value: 'http://old.invalid:8080/' }, pending: true, overridden: false })
  expect(JSON.stringify(result)).not.toContain('synthetic-unrendered')
  const clear = await settings.request({ action: 'save', expectedRevision: result.revision, fields: { httpProxy: '' } })
  expect(clear.fields.httpProxy.saved.value).toBe('')
  expect(parseEnv(await readFile(join(home, '.env'), 'utf8')).http_proxy).toBe('')
  expect((await readFile(join(home, '.env'), 'utf8')).match(/# BEGIN DSH DESKTOP PROXY SETTINGS/g)).toHaveLength(1)
})

it('shows inherited overrides and custom CA declaration without claiming a verified certificate', async () => {
  const { settings } = await fixture({ HTTP_PROXY: 'http://inherited.invalid:8000/', NODE_EXTRA_CA_CERTS: 'private-ca-location' }, 'process')
  const prior = await settings.status()
  const state = await settings.request({ action: 'save', expectedRevision: prior.revision, fields: { httpProxy: 'http://saved.invalid/' } })
  expect(state.fields.httpProxy).toMatchObject({ source: 'process', overridden: true, pending: false,
    applied: { value: 'http://inherited.invalid:8000/' }, saved: { value: 'http://saved.invalid/' } })
  expect(state.ca).toEqual({ configured: true, source: 'launch-environment', restart: 'desktop' })
  expect(JSON.stringify(state)).not.toContain('private-ca-location')
})

it('redacts existing proxy authentication and retains it when only bypass is edited', async () => {
  const { home, settings } = await fixture()
  await writeFile(join(home, '.env'), 'HTTPS_PROXY=http://user:synthetic-hidden@proxy.invalid:8080/\n')
  const state = await settings.status()
  expect(state.fields.httpsProxy.saved).toEqual({ value: 'http://proxy.invalid:8080/', credentialed: true })
  await settings.request({ action: 'save', expectedRevision: state.revision, fields: { noProxy: 'internal.invalid' } })
  expect(parseEnv(await readFile(join(home, '.env'), 'utf8')).HTTPS_PROXY).toContain('synthetic-hidden')
  expect(JSON.stringify(await settings.status())).not.toContain('synthetic-hidden')
})

it('admits one concurrent CAS save and refuses the stale writer without overwriting its result', async () => {
  const { settings } = await fixture(), prior = await settings.status()
  const results = await Promise.allSettled(['http://first.invalid/', 'http://second.invalid/'].map(httpProxy =>
    settings.request({ action: 'save', expectedRevision: prior.revision, fields: { httpProxy } })))
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(row => row.status === 'rejected')
  if (rejected?.status !== 'rejected') throw Error('Expected stale writer')
  expect(String(rejected.reason)).toContain('DEPLOYMENT_REVISION_CONFLICT')
})

it.each([
  { httpProxy: 'socks5://proxy.invalid' }, { httpProxy: 'http://user:password@proxy.invalid' },
  { noProxy: 'internal\nNODE_TLS_REJECT_UNAUTHORIZED=0' }, { ca: 'unapproved' },
])('rejects unsafe deployment edits and keeps the original file: %j', async (fields) => {
  const { home, settings } = await fixture(), text = '# retained\nUNRELATED=keep\n'
  await writeFile(join(home, '.env'), text)
  await expect(settings.request({ action: 'save', expectedRevision: (await settings.status()).revision, fields })).rejects.toThrow('DEPLOYMENT_')
  expect(await readFile(join(home, '.env'), 'utf8')).toBe(text)
})

it('refuses malformed managed blocks instead of replacing unrelated multiline values', async () => {
  const { home, settings } = await fixture()
  const text = 'SECRET="before\n# BEGIN DSH DESKTOP PROXY SETTINGS\ninside\n# END DSH DESKTOP PROXY SETTINGS\nafter"\n'
  await writeFile(join(home, '.env'), text)
  await expect(settings.request({ action: 'save', expectedRevision: (await settings.status()).revision,
    fields: { httpProxy: 'http://new.invalid/' } })).rejects.toThrow('DEPLOYMENT_FILE_INVALID')
  expect(await readFile(join(home, '.env'), 'utf8')).toBe(text)
})
