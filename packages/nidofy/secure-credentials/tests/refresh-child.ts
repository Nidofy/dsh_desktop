/** Test-only source-provider process: synthetic token rotation across a real filesystem lock and DPAPI. */
import { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { SecureCredentialProvider } from '../src/index.ts'
import type { Config } from '../src/types.ts'

const ctx = new Context()
ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
// Only the private test process reads this config; production admission stays in the provider.
const spec = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as Config
try {
  await ctx.plugin(SecureCredentialProvider, spec)
  const key = credentialKey('llm-pi-ai', 'cross-process')
  for (let index = 0; index < 3; index++) {
    await ctx.credentials.modifyRecord(key, async current => ({ kind: 'grant',
      payload: current?.kind === 'grant' && typeof current.payload === 'number' ? current.payload + 1 : 1 }))
  }
  process.stdout.write('T02_REFRESH_COMMITTED\n')
} catch (error) {
  void error
  process.stderr.write('T02_REFRESH_FAILED\n')
  process.exitCode = 1
} finally { await ctx.fiber.dispose() }
