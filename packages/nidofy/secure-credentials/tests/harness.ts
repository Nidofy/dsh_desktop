/** Isolated synthetic data and an explicitly labelled encrypted backend substitute. */
import { Context } from '@deepseek-ai/cordis'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SecureCredentialProvider } from '../src/index.ts'
import type { Config, SecretProtector } from '../src/types.ts'

const root = resolve('.build/dispatch/tmp/T02-tests')
const directories: string[] = []
const contexts: Context[] = []

/** Own a test composition through asynchronous teardown.
 * @param ctx - allocated composition.
 */
export function trackContext(ctx: Context): void { contexts.push(ctx) }

/** AES-GCM substitute: exercises encrypted-file protocols, never claimed as Windows evidence. */
export class SubstituteProtector implements SecretProtector {
  readonly key = randomBytes(32)
  refused = false
  private check(): void { if (this.refused) throw new Error('synthetic-secret-in-backend-error') }
  async protect(data: Buffer, entropy: Buffer): Promise<Buffer> {
    this.check()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(createHash('sha256').update(entropy).digest())
    const out = Buffer.concat([cipher.update(data), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), out])
  }
  async unprotect(data: Buffer, entropy: Buffer): Promise<Buffer> {
    this.check()
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12))
    cipher.setAAD(createHash('sha256').update(entropy).digest())
    cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()])
  }
}

/** Allocate under T02, never the user's actual application home.
 * @returns exclusive test directory.
 */
export async function directory(): Promise<string> {
  await mkdir(root, { recursive: true })
  const value = await mkdtemp(join(root, 'run-'))
  directories.push(value)
  return value
}

/** Explicit deployment fixture.
 * @param home - allocated test home.
 * @returns provider parameters.
 */
export function config(home: string): Config {
  return { applicationId: 'nidofy-t02-test', profileId: 'personal', dshHome: home,
    maxPlaintextBytes: 512 * 1024, backendTimeoutMs: 10_000, lockWaitMs: 15_000, refreshIntervalMs: 0 }
}

/** Boot the real provider, varying only encryption at its external platform boundary.
 * @param spec - provider parameters.
 * @param protector - encryption substitute, or undefined for real DPAPI.
 * @param ctx - optional preconfigured context.
 * @returns context and provider.
 */
export async function boot(spec: Config, protector?: SecretProtector, ctx = new Context()) {
  if (!ctx.get('launchEnvironment')) ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
  trackContext(ctx)
  class TestProvider extends SecureCredentialProvider {
    constructor(context: Context) { super(context, spec, protector) }
  }
  await ctx.plugin(TestProvider)
  return { ctx, provider: ctx.credentials as SecureCredentialProvider }
}

/** Find the selected scope's encrypted files.
 * @param home - isolated test home.
 * @returns generated namespace directory.
 */
export async function storageDirectory(home: string): Promise<string> {
  const namespaces = await readdir(join(home, 'secure-credentials'))
  if (namespaces.length !== 1) throw new Error('fixture requires one namespace')
  return join(home, 'secure-credentials', namespaces[0]!)
}

/** Drain contexts before removing only allocated paths within the T02 root. */
export async function cleanup(): Promise<void> {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(root + sep)) throw new Error('unsafe fixture cleanup')
    await rm(path, { recursive: true, force: true })
  }
}
