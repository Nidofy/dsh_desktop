/**
 * The win32 chain's argv contract, denial dialect, and runner-failure rules,
 * exercised through the REAL LocalSandboxProvider.confine() with an injected
 * platform and runner argv prefix. Platform-independent assertions: they run
 * in every CI lane (Windows included, where sandbox-local's own POSIX-only
 * suites are excluded) — the end-to-end runner behavior lives in
 * runner.spec.ts on win32 hosts.
 */

import { tmpdir } from 'node:os'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { win32Sync } from '../src/ffi.ts'
import { WorkspaceGrantLease } from '../src/recovery.ts'
import { readSecurityState } from '../src/security-state.ts'
import { workspaceWriteSid } from '../src/workspace-sid.ts'
import { isolatedRecovery } from './fixtures/isolated-recovery.ts'

isolatedRecovery()

// The policy composition registers this extension. This backend fixture keeps
// its exact payload without mounting policy services or changing a real session log.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'sandbox/mode': { mode: SandboxMode; source?: 'delegation' }
  }
}

const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: '/ws' }
const WW: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/ws' }

async function setup(internals: LocalSandboxProvider['internals']) {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = internals
  return sandbox
}

describe('windows-acl win32 chain (LocalSandboxProvider)', () => {
  it.skipIf(process.platform !== 'win32').each(['mode', 'disposed'] as const)('%s rejects stale admission after ordinary events preserve it', async (event) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-acl-provider-')))
    const api = win32Sync()
    const before = readSecurityState(api, root)
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSandboxProvider, {})
    const session = Session.create(SessionId('native-lease-lifecycle'))
    const sandbox = ctx.sandbox as LocalSandboxProvider
    sandbox.internals = { platform: 'win32', windowsAclRunnerArgs: ['node', 'test-runner'] }
    let child: WorkspaceGrantLease | undefined
    try {
      const prepared = await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: root, sessionId: session.id })
      const owner = prepared.argv[prepared.argv.indexOf('--workspace-lease') + 1]
      expect(owner).toBeDefined()
      child = WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root), owner)
      ctx.emit('session/event', session, session.append('turn/start', { turn: 1 }))
      const ordinary = WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root), owner)
      ordinary.dispose()
      if (event === 'mode') ctx.emit('session/event', session, session.append('sandbox/mode', { mode: 'read-only' }))
      else ctx.emit('session/disposed', session)
      expect(() => WorkspaceGrantLease.acquire(api, root, workspaceWriteSid(root), owner)).toThrow(/released/)
      expect(readSecurityState(api, root)).not.toEqual(before)
      child.dispose()
      expect(readSecurityState(api, root)).toEqual(before)
    } finally {
      child?.dispose()
      await fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('agentless workspace-write: runner argv prefix, temp root, mode flag, partial enforcement, ACL denial dialect', async () => {
    const probeWindowsAcl = vi.fn(() => true)
    const sandbox = await setup({
      platform: 'win32',
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
      probeWindowsAcl,
    })
    const confined = await sandbox.confine(['pwsh', '/Command', 'x'], WW)
    expect(confined.argv).toEqual([
      'node', 'windows-acl-runner.js',
      '--workspace', '/ws',
      '--temp', tmpdir(),
      '--mode', 'workspace-write',
      '--',
      'pwsh', '/Command', 'x',
    ])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access is denied', 'access to the path', 'permission denied', 'operation not permitted'])
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
    // A sole candidate is selected unprobed.
    expect(probeWindowsAcl).not.toHaveBeenCalled()
  })

  it('read-only: same runner and contract, read-only mode flag', async () => {
    const sandbox = await setup({ platform: 'win32', windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'] })
    const confined = await sandbox.confine(['true'], RO)
    expect(confined.argv.slice(-4)).toEqual(['--mode', 'read-only', '--', 'true'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
  })
})
