/**
 * Windows ACL write-restriction sandbox backend for the DeepSeek Harness
 * sandbox seam. Mirrors the mechanism of github.com/huoyaoyuan/
 * windows-acl-restrict-poc @ 10e4dfb (the fixed revision): a WRITE_RESTRICTED
 * token whose restricting SIDs include distinct workspace and temp write
 * SIDs that this sandbox adds to their owning directories' DACLs — the
 * intersection check then allows writes exactly where either capability has
 * a Write ACE, and nowhere else those SIDs are concerned (the check ALSO
 * inherits the ambient write ACEs of the other restricting SIDs — the
 * keep-alive group logon SID + Everyone; Authenticated Users, INTERACTIVE,
 * and LOCAL are absent from both lists — see the seam's dual-list contract
 * in `packages/sandbox/sandbox-local` and the package README's Modes section
 * for the complete boundary). The intersection covers only the object's own
 * access check, so the token is also lowered to Low integrity and every
 * granted directory carries a Low no-write-up label and the ambient-delete
 * deny the `acl` module documents. The write SID is the per-WORKSPACE identity
 * ({@link workspaceWriteSid}): deterministic from the canonical workspace
 * path. Live process leases share one snapshotted grant; final release restores
 * its original DACL, mandatory label and owned inheritance controls. Each private temp directory instead receives its own SID,
 * so sibling sessions sharing a workspace cannot enter one another's temp
 * trees. Unlike the POC, every API failure throws with the API
 * name and exact Win32 code; a child is NEVER spawned unrestricted.
 *
 * Known boundaries (inherent to restricted tokens, not this port):
 *  - writes are restricted; reads, network, and process visibility are NOT
 *    (WRITE_RESTRICTED intersects only write accesses);
 *  - console isolation is unavailable — children share the host console
 *    (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE children die with
 *    STATUS_DLL_INIT_FAILED under the restriction);
 *  - the private temp directory and every writable directory must be owned by the
 *    caller (owner-implicit WRITE_DAC);
 *  - workspace grants temporarily change real filesystem security. Final lease
 *    release restores snapshotted fields; incomplete recovery keeps its journal.
 *    Callers must wait for all children before dispose. With manageDacls: false,
 *    the caller owns that lifecycle and must not revoke under live children.
 * @module @deepseek-ai/dsh-sandbox-windows-acl
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { workspaceWriteSid } from './workspace-sid.ts'
import { resolve } from 'node:path'
import { Win32Error } from '@deepseek-ai/dsh-win32-process'

import { grantWrite, revokeWrite } from './acl.ts'
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import { assertPrivateTempDisjoint } from './path-boundary.ts'
import { drainPipe, spawnSandboxed, spawnSandboxedInherited, waitForExit } from './spawn.ts'
import { createRestrictedToken, findLogonSid, makeWellKnownSid, openCurrentProcessToken, restrictTokenIntegrity, setTokenDefaultDaclGrant } from './token.ts'
import * as abi from './win32-abi.ts'
import { WorkspaceGrantLease } from './recovery.ts'

export { AclWriteGrant } from './grant.ts'
export { assertTempRootOutsideWorkspace } from './path-boundary.ts'
export { tempWriteSid, workspaceWriteSid } from './workspace-sid.ts'
export { ACL_DIAGNOSIS_SKILL, registerAclDiagnosisSkill } from './acl-skill.ts'
/** Construction options: the workspace/temp allowlists and their distinct SID identities. */
export interface AclSandboxOptions {
  /** Existing caller-owned directories. Managed workspace-write requires exactly one canonical workspace. */
  writableDirs: readonly string[]
  /**
   * Existing private temp directory to grant. Workspace-write callers must
   * pass it explicitly or pass null to disable temp writes; the ambient temp
   * root is never an implicit grant. Read-only accepts only null/undefined.
   */
  tempDir?: string | null
  /**
   * The write SID forming the workspace-write allowlist: REQUIRED under
   * workspace-write, ignored (and must be absent) under read-only. Callers
   * derive it from the workspace via {@link workspaceWriteSid} — the identity
   * is shared only while a live workspace lease exists.
   */
  writeSid?: string
  /**
   * The private temp directory's write SID. Required whenever
   * workspace-write grants a temp directory, absent otherwise. It must be
   * distinct from {@link writeSid}, so sibling sessions sharing a workspace
   * cannot use the workspace capability in one another's temp tree.
   */
  tempWriteSid?: string
  /**
   * The file-effect mode this instance confines under — selects the
   * restricted token's restricting-SID list (I for read-only, J for
   * workspace-write) and MUST match the grant shape: read-only pairs with
   * zero grants. The runner validates the argv-borne mode string at its
   * boundary; this typed seam trusts the union.
   */
  mode: 'read-only' | 'workspace-write'
  /**
   * Whether this instance owns its DACL grants (default true). False means
   * the CALLER has already materialized the ACEs (the sandbox seam's
   * workspace/temp capability lifecycle): init()/dispose() skip grant/revoke entirely —
   * the caller holds the grants for its own lifetime and revokes them.
   */
  manageDacls?: boolean
}

/** Per-spawn options: the program, its argv/cwd, and the stdio shape. */
export interface AclSandboxSpawnOptions {
  /** Program to run (resolved via PATH search when unqualified, like CreateProcess). */
  command: string
  /** Arguments, quoted per CommandLineToArgvW rules. */
  args?: readonly string[]
  /** Working directory; defaults to the caller's cwd. */
  cwd?: string
  /**
   * 'pipe' (default): capture stdout/stderr via anonymous pipes.
   * 'inherit': the child inherits the caller's stdio directly (runner usage —
   * bytes flow straight through), always wrapped in a kill-on-close job so the
   * child dies with the caller; stdout/stderr in the result are empty.
   */
  stdio?: 'pipe' | 'inherit'
  /** Control pipe forwarded to the same payload descriptor in inherited-stdio mode. */
  controlFileDescriptor?: 7
}

/** A settled confined child: captured stdio and the exit code. */
export interface AclSandboxChildResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number
}

/** A running confined child: its pid and a settlement promise. */
export interface AclSandboxChild {
  /** Child process id. */
  pid: number
  /** Resolve stdout/stderr and the exit code once the child exits. */
  wait(): Promise<AclSandboxChildResult>
}

/** Free one optional SID while retaining a failure for best-effort sibling cleanup. */
function freeSidBestEffort(
  api: Win32Bindings,
  sidPtr: NativePtr | undefined,
  label: string,
  failures: unknown[],
): void {
  if (sidPtr === undefined) return
  try {
    const freed = api.localFree(sidPtr)
    if (!isNullPtr(freed)) throwLastError(api, 'LocalFree', label)
  } catch (error) {
    failures.push(error)
  }
}

/**
 * One write-restricted sandbox instance: token + write-SID grants + spawn.
 * init fails closed; dispose releases workspace leases, revokes temp grants and
 * frees allocations, reporting all failures. Wait for children before disposal.
 * With manageDacls: false the caller owns grant and lease lifetime.
 */
export class AclSandbox {
  /** Absolute writable directories (constructor-validated). */
  readonly writableDirs: string[]
  /** The workspace SID string whose ACEs form the workspace allowlist. */
  readonly writeSid: string | undefined
  /** The private temp directory's write SID (workspace-write with temp only). */
  readonly tempWriteSid: string | undefined
  /** The file-effect mode — the restricted token's restricting-SID list selection. */
  readonly mode: 'read-only' | 'workspace-write'
  private readonly tempDirOption: string | null | undefined
  private readonly manageDacls: boolean
  private tempDirResolved: string | null | undefined
  private api: Win32Bindings | undefined
  private token: NativePtr | undefined
  private writeSidPtr: NativePtr | undefined
  private tempWriteSidPtr: NativePtr | undefined
  /** The well-known/logon SID allocations init() makes; freed by dispose() alongside the write SIDs. */
  private sidAllocations: NativePtr[] = []
  private grantedPaths: Array<{ path: string; sidPtr: NativePtr }> = []
  private readonly workspaceLeases: WorkspaceGrantLease[] = []

  constructor(options: AclSandboxOptions) {
    this.mode = options.mode
    this.manageDacls = options.manageDacls ?? true
    this.writableDirs = options.writableDirs.map((directory) => {
      const absolute = resolve(directory)
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        throw new Error(`AclSandbox writable dir does not exist or is not a directory: ${absolute}`)
      }
      return absolute
    })
    this.tempDirOption = options.tempDir
    this.writeSid = options.writeSid
    this.tempWriteSid = options.tempWriteSid
    if (this.mode === 'workspace-write' && this.writeSid === undefined) {
      throw new Error('AclSandbox workspace-write requires a write SID — derive it from the workspace via workspaceWriteSid()')
    }
    if (this.mode === 'workspace-write' && this.tempDirOption === undefined) {
      throw new Error('AclSandbox workspace-write requires an explicit private temp directory or null')
    }
    if (this.mode === 'read-only' && this.tempDirOption !== undefined && this.tempDirOption !== null) {
      throw new Error('AclSandbox read-only does not accept a temp directory')
    }
    if (this.mode === 'read-only' && (this.writeSid !== undefined || this.tempWriteSid !== undefined)) {
      throw new Error('AclSandbox read-only does not accept write SIDs')
    }
    if (this.mode === 'workspace-write' && this.tempDirOption !== null && this.tempWriteSid === undefined) {
      throw new Error('AclSandbox workspace-write with temp requires a temp write SID — derive it via tempWriteSid()')
    }
    if (this.tempDirOption === null && this.tempWriteSid !== undefined) {
      throw new Error('AclSandbox temp write SID requires a temp directory')
    }
    if (this.writeSid !== undefined && this.tempWriteSid === this.writeSid) {
      throw new Error('AclSandbox workspace and temp write SIDs must be distinct')
    }
    if (this.mode === 'workspace-write' && this.manageDacls) {
      const root = this.writableDirs[0]
      if (this.writableDirs.length !== 1 || root === undefined) {
        throw new Error('AclSandbox managed workspace-write requires exactly one workspace directory')
      }
      if (this.writeSid !== workspaceWriteSid(realpathSync(root))) {
        throw new Error('AclSandbox managed workspace-write requires workspaceWriteSid(canonical workspace)')
      }
    }
  }

  /** Resolved temp directory (available after init; null when temp grants are disabled). */
  get tempDir(): string | null | undefined {
    return this.tempDirResolved
  }

  /** Create the restricted token and apply the capability-SID grants. Idempotent-unsafe: once per instance. */
  async init(): Promise<void> {
    if (this.api !== undefined) throw new Error('AclSandbox is already initialized')
    const api = await win32()
    const currentToken = openCurrentProcessToken(api)
    let currentTokenOpen = true
    let restrictedToken: NativePtr | undefined
    try {
      const parseSid = (sid: string): NativePtr => {
        const sidSlot = allocPtrSlot()
        if (api.convertStringSidToSidW(sid, sidSlot) === 0) {
          throwLastError(api, 'ConvertStringSidToSidW', sid)
        }
        const parsedSid = decodePtr(sidSlot)
        if (parsedSid === null) throw new Win32Error('ConvertStringSidToSidW', api.getLastError(), sid)
        return parsedSid
      }
      this.writeSidPtr = this.writeSid === undefined ? undefined : parseSid(this.writeSid)
      this.tempWriteSidPtr = this.tempWriteSid === undefined ? undefined : parseSid(this.tempWriteSid)

      const tempDir = this.mode === 'read-only' || this.tempDirOption === null ? null : this.tempDirOption
      /* v8 ignore next -- constructor validation requires workspace-write to supply
         an explicit temp directory or null; the other branches normalize to null. */
      if (tempDir === undefined) throw new Error('AclSandbox workspace-write temp directory was not resolved')
      if (tempDir !== null) {
        if (!existsSync(tempDir) || !statSync(tempDir).isDirectory()) {
          throw new Error(`AclSandbox temp dir does not exist or is not a directory: ${tempDir}`)
        }
        assertPrivateTempDisjoint(this.writableDirs, tempDir)
      }
      this.tempDirResolved = tempDir

      // manageDacls: false — the caller (the sandbox seam's grant) already
      // materialized the ACEs; this instance must neither add nor remove any.
      // Owned workspace leases snapshot and restore permissions; private-temp grants
      // remain disposable. The ambient temp root is never granted.
      // The Low label SID and the world SID the grants deny and label with.
      const lowLabelSid = makeWellKnownSid(api, abi.WinLowLabelSid)
      const worldSid = makeWellKnownSid(api, abi.WinWorldSid)
      this.sidAllocations.push(lowLabelSid, worldSid)

      if (this.manageDacls) {
        if (this.writeSidPtr !== undefined && this.writeSid !== undefined) {
          for (const path of this.writableDirs) {
            this.workspaceLeases.push(WorkspaceGrantLease.acquire(api, path, this.writeSid))
          }
          if (tempDir !== null && this.tempWriteSidPtr !== undefined) {
            // Record BEFORE granting: grantWrite can throw after a successful
            // apply (a LocalFree failure), and the fail-closed catch must still
            // revoke that path (revoking an ungranted path is a no-op merge).
            this.grantedPaths.push({ path: tempDir, sidPtr: this.tempWriteSidPtr })
            grantWrite(api, tempDir, this.tempWriteSidPtr, lowLabelSid, worldSid)
          }
        }
      }
      const logonSid = findLogonSid(api, currentToken)
      this.sidAllocations.push(logonSid)
      const writeSids = [this.writeSidPtr, this.tempWriteSidPtr].filter((sid): sid is NativePtr => sid !== undefined)
      restrictedToken = createRestrictedToken(
        api, currentToken, logonSid, writeSids,
        { world: worldSid },
        this.mode,
      )
      restrictTokenIntegrity(api, restrictedToken, lowLabelSid)
      this.token = restrictedToken
      // The restricted token's default DACL still names only the user's
      // ambient SIDs — none of the restricting SIDs. Every NEW object the
      // confined process creates (anonymous stdio pipes, sync objects) takes
      // its DACL from that default, so the write pass-2 check would deny
      // pipe creation (ERROR_ACCESS_DENIED; Node EPERM) and break every
      // piped-stdio grandchild spawn. Merge a full-access ACE for a
      // restricting SID (the PRIVATE temp SID when present, otherwise the
      // workspace SID, or Everyone under read-only): new-object creation
      // stays gated by the parent object's DACL, while the new object's own
      // DACL passes pass-2. Choosing the temp SID prevents default-DACL
      // objects in one session's temp tree from acquiring the shared
      // workspace capability.
      setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid)
      if (api.closeHandle(currentToken) === 0) throwLastError(api, 'CloseHandle', 'current process token')
      currentTokenOpen = false
      this.api = api
    } catch (error) {
      // Release every partially acquired resource; workspace recovery retains its
      // durable journal if safe rollback cannot complete.
      const cleanupFailures: unknown[] = []
      for (const lease of this.workspaceLeases.splice(0)) {
        try { lease.dispose() } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      if (currentTokenOpen && api.closeHandle(currentToken) === 0) {
        cleanupFailures.push(new Win32Error('CloseHandle', api.getLastError(), 'current process token after init failure'))
      }
      if (restrictedToken !== undefined && api.closeHandle(restrictedToken) === 0) {
        cleanupFailures.push(new Win32Error('CloseHandle', api.getLastError(), 'restricted token after init failure'))
      }
      for (const grant of this.grantedPaths) {
        try {
          revokeWrite(api, grant.path, grant.sidPtr)
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      for (const [label, sidPtr] of [['workspace write SID', this.writeSidPtr], ['temp write SID', this.tempWriteSidPtr]] as const) {
        freeSidBestEffort(api, sidPtr, label, cleanupFailures)
      }
      for (const sidPtr of this.sidAllocations.splice(0)) {
        freeSidBestEffort(api, sidPtr, 'init SID allocation', cleanupFailures)
      }
      this.token = undefined
      this.writeSidPtr = undefined
      this.tempWriteSidPtr = undefined
      this.tempDirResolved = undefined
      this.grantedPaths = []
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          `AclSandbox init failed and ${cleanupFailures.length} cleanup operation(s) also failed`,
        )
      }
      throw error
    }
  }

  /**
   * Spawn a process under the restricted token. Fails closed: throws on every
   * Win32 failure; the child is never created unrestricted. With
   * `stdio: 'inherit'` the child shares the caller's stdio directly and is
   * placed in a kill-on-close job (dies with the caller). Call dispose() only
   * after all children have exited — revoking grants under a live child
   * removes its remaining write allowance.
   * @param options - the program, argv/cwd, and stdio shape.
   * @returns the running child.
   */
  spawn(options: AclSandboxSpawnOptions): AclSandboxChild {
    const api = this.api
    const token = this.token
    if (api === undefined || token === undefined) throw new Error('AclSandbox is not initialized: call init() first')
    if (options.controlFileDescriptor !== undefined && options.stdio !== 'inherit') {
      throw new Error('control pipe requires inherited stdio')
    }
    const args = options.args ?? []
    const cwd = options.cwd ?? process.cwd()

    if (options.stdio === 'inherit') {
      const native = spawnSandboxedInherited(api, token, {
        command: options.command, args, cwd,
        ...options.controlFileDescriptor === undefined ? {} : { controlFileDescriptor: options.controlFileDescriptor },
      })
      let exitCodePromise: Promise<number> | undefined
      return {
        pid: native.pid,
        wait: async () => {
          exitCodePromise ??= Promise.resolve(waitForExit(api, native.process))
          const exitCode = await exitCodePromise
          if (api.closeHandle(native.job) === 0) throwLastError(api, 'CloseHandle', 'kill-on-close job')
          return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode }
        },
      }
    }

    const native = spawnSandboxed(api, token, { command: options.command, args, cwd })
    const stdout = drainPipe(api, native.stdoutRead)
    const stderr = drainPipe(api, native.stderrRead)
    // waitForExit is deliberately NOT started here: WaitForSingleObject blocks
    // the thread and would starve the drains while the child is still running
    // (pipe-buffer deadlock). The drains resolve only after the child closed
    // its pipe ends — by then the wait returns immediately.
    let exitCodePromise: Promise<number> | undefined
    return {
      pid: native.pid,
      wait: async () => {
        const stdoutBuffer = await stdout
        const stderrBuffer = await stderr
        exitCodePromise ??= Promise.resolve(waitForExit(api, native.process))
        return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode: await exitCodePromise }
      },
    }
  }

  /**
   * Release workspace leases, revoke private-temp grants, and free native resources.
   * Call only after every child exits. Cleanup failures are aggregated.
   */
  dispose(): void {
    const api = this.api
    if (api === undefined) return
    const failures: unknown[] = []
    for (const lease of this.workspaceLeases.splice(0)) {
      try { lease.dispose() } catch (error) { failures.push(error) }
    }
    if (this.manageDacls) {
      for (const grant of this.grantedPaths) {
        try {
          revokeWrite(api, grant.path, grant.sidPtr)
        } catch (error) {
          failures.push(error)
        }
      }
    }
    for (const [label, sidPtr] of [['workspace write SID', this.writeSidPtr], ['temp write SID', this.tempWriteSidPtr]] as const) {
      freeSidBestEffort(api, sidPtr, label, failures)
    }
    const token = this.token
    /* v8 ignore next -- init assigns this.api only after this.token, so an initialized instance always
       has its token; the guard mirrors the write-SID guard. */
    if (token !== undefined) {
      try {
        if (api.closeHandle(token) === 0) throwLastError(api, 'CloseHandle', 'restricted token')
      } catch (error) {
        failures.push(error)
      }
    }
    for (const sidPtr of this.sidAllocations.splice(0)) {
      freeSidBestEffort(api, sidPtr, 'init SID allocation', failures)
    }
    this.api = undefined
    this.token = undefined
    this.writeSidPtr = undefined
    this.tempWriteSidPtr = undefined
    this.grantedPaths = []
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclSandbox dispose completed with ${failures.length} cleanup failure(s)`)
    }
  }
}
