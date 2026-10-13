import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveDesktopDistribution } from '../scripts/desktop-distribution.mjs'
import { resolveDesktopPolicyEnvironment } from '../scripts/desktop-policy-environment.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { distributionPaths, permitsDistributionRequest, readDesktopDistribution } from '../src/distribution.ts'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { desktopTargetBuildPaths, resolveDesktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'

const environment = { DSH_DESKTOP_DISTRIBUTION: 'intranet', DSH_DESKTOP_APP_ID: 'io.github.nidofy.dsh.intranet' }
const personal = { DSH_DESKTOP_DISTRIBUTION: 'personal', DSH_DESKTOP_APP_ID: 'io.github.nidofy.dsh.desktop' }

it.each([environment, personal])('preserves private distribution data on OS-launched uninstall: $DSH_DESKTOP_DISTRIBUTION', (distribution) => {
  const config = createElectronBuilderConfig({ ...distribution, DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  const include = readFileSync(config.nsis.include, 'utf8')
  expect(config.nsis.include.replaceAll('\\', '/')).toMatch(/\/installer-private\.nsh$/)
  expect(include).toContain('!define DSH_KEEP_DISTRIBUTION_DATA')
  expect(include).toContain('installer.nsh')
})

it('retains the upstream uninstall cleanup policy without private distribution metadata', () => {
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.installer', DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }) }, 'win32', 'x64')
  expect(config.nsis.include.replaceAll('\\', '/')).toMatch(/\/installer\.nsh$/)
  expect(readFileSync(config.nsis.include, 'utf8')).not.toContain('!define DSH_KEEP_DISTRIBUTION_DATA')
})

it('keeps personal identity and data separate from intranet and upstream', () => {
  const policy = readDesktopDistribution(resolveDesktopDistribution(personal))
  if (policy === undefined) throw new Error('personal policy is required')
  expect(policy).toMatchObject({ kind: 'personal', productName: 'Nidofy DSH Desktop', protocol: 'nidofy-dsh' })
  expect(distributionPaths(process.cwd(), undefined, policy.dataDirectory)).not.toEqual(distributionPaths(process.cwd()))
  expect(resolveDesktopPolicyEnvironment(personal)).toBeUndefined()
  expect(() => resolveDesktopDistribution({ ...personal, DSH_DESKTOP_APP_ID: environment.DSH_DESKTOP_APP_ID })).toThrow()
  expect(() => readDesktopDistribution({ ...policy, dataDirectory: 'Nidofy DSH Intranet' })).toThrow()
})

it('ships the personal overlay and no upstream auto-update feed', () => {
  const config = createElectronBuilderConfig({ ...personal, DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  expect(config).toMatchObject({ appId: personal.DSH_DESKTOP_APP_ID, productName: 'Nidofy DSH Desktop', publish: null })
  expect(config.files).toContain('resources/personal.patch.yml')
  expect(config.files).not.toContain('resources/intranet.patch.yml')
  expect(config.directories).toMatchObject({ output: desktopTargetBuildPaths('win-x64', 'personal').unsignedArtifacts })
  expect(resolveDesktopTargetBuildPaths({ ...personal, DSH_DESKTOP_TARGET_PLATFORM: 'win32' }).unsignedArtifacts)
    .not.toBe(desktopTargetBuildPaths('win-x64').unsignedArtifacts)
}, 15000)

it('builds an explicit offline policy without dummy update origins and preserves upstream validation', () => {
  expect(resolveDesktopPolicyEnvironment(environment)).toBeUndefined()
  expect(() => { validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' }, { unsigned: true }) }).not.toThrow()
  expect(() => resolveDesktopPolicyEnvironment({})).toThrow()
  expect(readDesktopDistribution(resolveDesktopDistribution(environment))).toMatchObject({ updates: 'offline', revision: 1 })
})

it('rejects mixed identity, online policy, and unsupported packaged revisions', () => {
  expect(() => resolveDesktopDistribution({ ...environment, DSH_DESKTOP_APP_ID: 'official' })).toThrow()
  expect(() => resolveDesktopDistribution({ ...environment, DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' })).toThrow()
  expect(() => readDesktopDistribution({ ...resolveDesktopDistribution(environment), revision: 2 })).toThrow()
  expect(() => readDesktopDistribution(null)).toThrow()
  expect(readDesktopDistribution(undefined)).toBeUndefined()
})

it('separates Chromium and Harness data under a distribution root', () => {
  const paths = distributionPaths(process.cwd())
  expect(paths.userData).toContain('Nidofy DSH Intranet')
  expect(paths.home).not.toBe(paths.userData)
  expect(() => distributionPaths(process.cwd(), 'relative')).toThrow()
})

it('packages isolated identity and policy without an online feed or mandatory service', () => {
  const config = createElectronBuilderConfig({ ...environment, DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  expect(config).toMatchObject({ appId: environment.DSH_DESKTOP_APP_ID, productName: 'Nidofy DSH Intranet', publish: null,
    protocols: [{ name: 'Nidofy DSH Intranet', schemes: ['nidofy-dsh-intranet'] }],
    extraMetadata: { dshDistribution: { kind: 'intranet', updates: 'offline' } },
  })
  expect(config.extraMetadata).toHaveProperty('dshMandatoryUpdatePolicy', undefined)
  expect(config.files).toContain('resources/intranet.patch.yml')
}, 15000)

it('permits only the active authenticated Host endpoint and local assets', () => {
  const host = 'http://127.0.0.1:43210/?token=synthetic'
  expect(permitsDistributionRequest('http://127.0.0.1:43210/api/settings', host)).toBe(true)
  expect(permitsDistributionRequest('ws://127.0.0.1:43210/events', host)).toBe(true)
  for (const url of ['https://example.com', 'http://127.0.0.1:43211/', 'http://user:pass@127.0.0.1:43210/',
    'http://localhost:43210', 'https://127.0.0.1:43210', 'invalid']) {
    expect(permitsDistributionRequest(url, host)).toBe(false)
  }
  expect(permitsDistributionRequest(host)).toBe(false)
  expect(permitsDistributionRequest('dsh-app://app/')).toBe(true)
})
