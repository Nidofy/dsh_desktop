/** Real Windows CurrentUser DPAPI, synthetic application/profile identities and Electron-local homes. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { installConnections } from '../../../../apps/desktop-host/src/connections/runtime.ts'
import { WindowsDpapiProtector } from '../src/dpapi.ts'
import { SecureCredentialProvider } from '../src/index.ts'
import { boot, cleanup, config, directory, storageDirectory, trackContext } from './harness.ts'

afterEach(cleanup)
const windows = it.skipIf(process.platform !== 'win32')
const ref = credentialRef('T02_WINDOWS_KEY')
const key = credentialKey('llm-pi-ai', 'cross-process')

windows('bounds a real helper lifetime and returns a value-free refusal after close', async () => {
  const backend = new WindowsDpapiProtector(1, 1024)
  await expect(backend.protect(Buffer.from('synthetic-timeout'), Buffer.from('test-entropy')))
    .rejects.toMatchObject({ message: 'SECURE_BACKEND_UNAVAILABLE', code: 'SECURE_BACKEND_UNAVAILABLE' })
}, 10_000)

windows('uses real DPAPI for cold read, rotation, revocation and a 240KiB opaque record', async () => {
  const home = await directory()
  const first = await boot(config(home))
  await first.provider.set(ref, 'synthetic-windows-A')
  await first.provider.modifyRecord(key, async () => ({ kind: 'grant', payload: { refresh: 'x'.repeat(240 * 1024) } }))
  const disk = await readFile(join(await storageDirectory(home), 'current.json'), 'utf8')
  expect(disk).not.toContain('synthetic-windows')
  expect(disk).not.toContain('x'.repeat(100))
  await first.ctx.fiber.dispose()
  const second = await boot(config(home))
  expect((await second.provider.resolve(ref))?.value).toBe('synthetic-windows-A')
  const record = await second.provider.readRecord(key)
  expect(record?.kind === 'grant' && JSON.stringify(record.payload).length).toBe(240 * 1024 + 14)
  await second.provider.set(ref, 'synthetic-windows-B')
  expect((await second.provider.resolve(ref))?.value).toBe('synthetic-windows-B')
  await second.provider.unset(ref); await second.provider.deleteRecord(key)
  expect(await second.provider.resolve(ref)).toBeUndefined()
  expect(await second.provider.listRecords()).toEqual([])
}, 30_000)

windows('rejects ciphertext copied across application/profile/home entropy and direct wrong-entropy decryption', async () => {
  const home = await directory(), a = await boot(config(home))
  await a.provider.set(ref, 'synthetic-windows-identity')
  const source = join(await storageDirectory(home), 'current.json')
  const envelope = JSON.parse(await readFile(source, 'utf8')) as { ciphertext: string }
  const backend = new WindowsDpapiProtector(10_000, 2 * 1024 * 1024)
  await expect(backend.unprotect(Buffer.from(envelope.ciphertext, 'base64'), Buffer.from('wrong-identity')))
    .rejects.toThrow('SECURE_BACKEND_UNAVAILABLE')
  const specs = [{ ...config(home), applicationId: 'other-app' },
    { ...config(home), profileId: 'other-profile' }, config(await directory())]
  for (const spec of specs) {
    const before = spec.dshHome === home ? await readdir(join(home, 'secure-credentials')) : []
    const b = await boot(spec)
    expect(await b.provider.resolve(ref)).toBeUndefined()
    await b.provider.set(ref, 'synthetic-windows-other')
    const dirs = await readdir(join(spec.dshHome, 'secure-credentials'))
    const created = dirs.filter(dir => !before.includes(dir))
    expect(created).toHaveLength(1)
    const target = join(spec.dshHome, 'secure-credentials', created[0]!, 'current.json')
    await copyFile(source, target)
    await expect(b.provider.resolve(ref)).rejects.toThrow('SECURE_INVALID_DOCUMENT')
  }
}, 30_000)

windows('serializes two real source-provider processes refreshing the same record without lost rotations', async () => {
  const home = await directory()
  const spec = config(home)
  const { provider } = await boot(spec)
  await provider.modifyRecord(key, async () => ({ kind: 'grant', payload: 0 }))
  const configPath = join(home, 'test-config.json'); await writeFile(configPath, JSON.stringify(spec))
  // This subprocess exercises the source provider; the built Loader uses the package exports separately.
  const launch = resolveExampleLaunch({ srcBin: fileURLToPath(new URL('./refresh-child.ts', import.meta.url)),
    configArgs: [configPath], mode: 'src', sourceImport: 'tsx/esm', tsconfigPath: resolve('tsconfig.base.json') })
  const run = (): Promise<void> => new Promise((resolveRun, reject) => {
    const child = spawn(launch.command, launch.args, { windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, windir: process.env.windir, TEMP: process.env.TEMP,
        TMP: process.env.TMP, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data: Buffer) => { output += data.toString() })
    child.stderr.resume()
    const timer = setTimeout(() => child.kill(), 30_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && output.trim() === 'T02_REFRESH_COMMITTED') resolveRun()
      else reject(new Error('T02_REFRESH_PROCESS_FAILED'))
    })
  })
  await Promise.all([run(), run()])
  expect(await provider.readRecord(key)).toEqual({ kind: 'grant', payload: 6 })
}, 45_000)

windows('boots real YAML Loader, persists through T01, and cold-boots its repair surface after DPAPI refusal', async () => {
  const home = await directory(), spec = config(home)
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'secure', name: 'cordis:t02-secure', config: spec }, { id: 'llm', name: 'cordis:t02-llm' },
  ]))
  const loaded = async () => {
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
    trackContext(ctx)
    ctx.baseUrl = pathToFileURL(home).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins['t02-secure'] = SecureCredentialProvider
    ctx.loader.builtins['t02-llm'] = LlmRuntime
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.get('credentials')).toBeInstanceOf(SecureCredentialProvider)
    expect([...ctx.loader.entries()].filter(entry => !entry.disabled && !entry.fiber)).toEqual([])
    const store = await installConnections(ctx, home)
    return { ctx, store }
  }
  const first = await loaded()
  await first.store.mutate({ action: 'save', operationId: randomUUID(), connection: 'test', expectedRevision: 0,
    profile: { api: 'openai-completions', baseURL: 'http://127.0.0.1:12345/v1', models: [{ id: 'same' }] },
    credential: { mode: 'replace', value: 'synthetic-loader-secret' } })
  const path = join(await storageDirectory(home), 'current.json')
  const selected = await readFile(path, 'utf8')
  await first.ctx.fiber.dispose()
  const envelope = JSON.parse(selected) as { ciphertext: string }
  const bytes = Buffer.from(envelope.ciphertext, 'base64')
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
  await writeFile(path, JSON.stringify({ ...JSON.parse(selected), ciphertext: bytes.toString('base64') }))
  const refused = await loaded()
  expect(refused.store.status().connections[0]).toMatchObject({ availability: 'backend-unavailable' })
  expect(refused.store.status().recovery).toBe('ready')
  expect(JSON.stringify(refused.store.status())).not.toContain('synthetic-loader-secret')
  await writeFile(path, selected)
  await refused.store.inspect()
  expect(refused.store.status().connections[0]).toMatchObject({ availability: 'available' })
}, 30_000)
