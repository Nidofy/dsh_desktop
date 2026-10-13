/** Server-side workspace leases and private-temp grants. Workspace release restores
 * snapshotted permissions after the last live process lease; failures retain recovery data.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/grant
 */

import { grantWrite, revokeWrite } from './acl.ts'
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32Sync } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import { makeWellKnownSid } from './token.ts'
import * as abi from './win32-abi.ts'
import { recoverAbandonedGrants, WorkspaceGrantLease } from './recovery.ts'

/** One capability owner. add(path, true) acquires a recoverable workspace lease;
 * add(path) grants a disposable private-temp directory. dispose releases both and frees SIDs.
 */
export class AclWriteGrant {
  /** The write SID in SDDL string form. */
  readonly writeSid: string
  private readonly api: Win32Bindings
  private readonly sidPtr: NativePtr
  private readonly lowLabelSidPtr: NativePtr
  private readonly worldSidPtr: NativePtr
  private readonly revocablePaths: string[] = []
  private readonly standingPaths: string[] = []
  private readonly workspaceLeases = new Map<string, WorkspaceGrantLease>()
  private disposed = false

  private constructor(
    api: Win32Bindings,
    sidPtr: NativePtr,
    lowLabelSidPtr: NativePtr,
    worldSidPtr: NativePtr,
    writeSid: string,
  ) {
    this.api = api
    this.sidPtr = sidPtr
    this.lowLabelSidPtr = lowLabelSidPtr
    this.worldSidPtr = worldSidPtr
    this.writeSid = writeSid
  }

  /**
   * Parse the SID string, create the Low integrity SID the grants label with
   * and the world SID their ambient-delete deny names, and open the binding
   * table (lazily, once per server). Fail-closed: any failure throws — nothing
   * is granted yet.
   * @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
   * @param api - optional already-resolved bindings (tests).
   * @returns the ready grant (no ACEs yet).
   */
  static create(writeSid: string, api?: Win32Bindings): AclWriteGrant {
    const bindings = api ?? win32Sync()
    const sidSlot = allocPtrSlot()
    if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) {
      throwLastError(bindings, 'ConvertStringSidToSidW', writeSid)
    }
    const sidPtr = decodePtr(sidSlot)
    if (sidPtr === null) throwLastError(bindings, 'ConvertStringSidToSidW', `null SID for ${writeSid}`)
    try {
      const lowLabelSidPtr = makeWellKnownSid(bindings, abi.WinLowLabelSid)
      try {
        const worldSidPtr = makeWellKnownSid(bindings, abi.WinWorldSid)
        return new AclWriteGrant(bindings, sidPtr, lowLabelSidPtr, worldSidPtr, writeSid)
      } catch (error) {
        // The Low label SID is LocalAlloc'd: release it before the world-SID
        // failure propagates to the sidPtr release below.
        bindings.localFree(lowLabelSidPtr)
        throw error
      }
    } catch (error) {
      bindings.localFree(sidPtr)
      throw error
    }
  }

  /**
   * Grant a private-temp directory or acquire a recoverable workspace lease.
   * Repeated adds on this owner are idempotent. Failed workspace preparation
   * rolls back or retains its original snapshot for recovery. Dispose after failure.
   * @param path - existing directory, disjoint from recovery storage.
   * @param standing - compatibility flag: true now means a shared, recoverable
   *   workspace lease; false means a disposable private-temp grant.
   */
  add(path: string, standing = false): void {
    if (this.disposed) throw new Error('AclWriteGrant has been disposed')
    if (standing) {
      const key = path.toLowerCase()
      if (this.workspaceLeases.has(key)) return
      this.workspaceLeases.set(key, WorkspaceGrantLease.acquire(this.api, path, this.writeSid))
      this.standingPaths.push(path)
      return
    }
    if (this.revocablePaths.some(existing => existing.toLowerCase() === path.toLowerCase())) return
    this.revocablePaths.push(path)
    grantWrite(this.api, path, this.sidPtr, this.lowLabelSidPtr, this.worldSidPtr)
  }

  /** Return a live workspace authorization for a runner to join.
   * @param path - workspace previously acquired with add(path, true).
   * @returns process-held owner reference; stale references cannot create grants.
   */
  authorization(path: string): string {
    const lease = this.workspaceLeases.get(path.toLowerCase())
    if (this.disposed || lease === undefined) throw new Error(`No live Windows ACL workspace authorization: ${path}`)
    return lease.authorization
  }

  /** Recover abandoned grants during provider startup, preserving failures for diagnosis.
   * @returns recovery failures; each affected workspace still refuses a new grant.
   */
  static recover(): readonly unknown[] {
    return recoverAbandonedGrants(win32Sync())
  }

  /** Every directory currently carrying the grant, in grant order. */
  get paths(): readonly string[] {
    return [...this.standingPaths, ...this.revocablePaths]
  }

  /** Release workspace leases, revoke private-temp grants and free SIDs; aggregate cleanup failures. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const failures: unknown[] = []
    for (const lease of this.workspaceLeases.values()) {
      try { lease.dispose() } catch (error) { failures.push(error) }
    }
    for (const path of this.revocablePaths) {
      try {
        revokeWrite(this.api, path, this.sidPtr)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const [label, sidPtr] of [
      ['write SID', this.sidPtr],
      ['Low label SID', this.lowLabelSidPtr],
      ['world SID', this.worldSidPtr],
    ] as const) {
      try {
        const freed = this.api.localFree(sidPtr)
        if (!isNullPtr(freed)) throwLastError(this.api, 'LocalFree', label)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`)
    }
  }
}
