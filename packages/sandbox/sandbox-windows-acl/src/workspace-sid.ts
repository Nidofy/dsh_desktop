/**
 * The per-workspace write identity: a deterministic `S-1-4-x-y` SID derived
 * from the canonical workspace path, whose ACEs form that workspace's write
 * allowlist. Every confined execution of the same workspace — across
 * sessions, server restarts, and calls — carries the SAME write SID, so the
 * active workspace leases can share one grant without relabeling on reentry.
 * The SID's power is defined solely by the ACEs that name it in the workspace,
 * and only tokens minted for that workspace carry it — the SID
 * string itself is not a secret. Temporary directories use a separate,
 * per-directory identity from {@link tempWriteSid}; sharing the workspace
 * identity with temp would let sibling sessions write one another's temp
 * trees.
 *
 * The input MUST be the canonical workspace path (`realpathSync.native` on
 * Windows — the sandbox-policy `resolveWorkspaceRoot` already applies it):
 * canonicalization converges case/alias spellings, so two spellings of one
 * workspace derive one SID; an as-spelled fallback path would mint a second
 * identity for the same directory, which the recovery lease rejects.
 * Renaming a workspace derives a new SID; finish its leases before moving it.
 * A missing or replaced live root retains its journal for operator recovery.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/workspace-sid
 */

import { createHash } from 'node:crypto'

/**
 * Derive the workspace's write SID (`S-1-4-x-y`; subauthorities 30-bit,
 * matching the workspace-capability shape the token and ACE layers carry).
 * @param workspaceRoot - the canonical workspace path.
 * @returns the SDDL string form.
 */
export function workspaceWriteSid(workspaceRoot: string): string {
  const digest = createHash('sha256').update(workspaceRoot, 'utf8').digest()
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}`
}

/**
 * Derive one private temp directory's write SID. The random directory path
 * is the capability identity; a fixed third subauthority domain-separates
 * the result from every two-subauthority workspace SID.
 * @param tempDir - the private temp directory's absolute path.
 * @returns the SDDL string form.
 */
export function tempWriteSid(tempDir: string): string {
  const digest = createHash('sha256').update('temp\0', 'utf8').update(tempDir, 'utf8').digest()
  const first = (digest.readUInt32LE(0) % (2 ** 30 - 1)) + 1
  const second = (digest.readUInt32LE(4) % (2 ** 30 - 1)) + 1
  return `S-1-4-${first}-${second}-1`
}
