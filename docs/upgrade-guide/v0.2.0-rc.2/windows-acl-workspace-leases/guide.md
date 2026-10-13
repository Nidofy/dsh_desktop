---
kind: upgrade-guide
description: Windows workspace grants now require recoverable leases and refuse legacy permissions without an original backup.
---

# Windows workspace permission recovery

English | [中文](guide.zh.md)

## Change

Windows ACL workspace authorization no longer leaves permanent capability ACEs and Low integrity labels. The first live owner saves each object's DACL, mandatory label and relevant inheritance controls before granting access. The last owner restores those fields. Mode changes release session admission; already admitted runners retain their leases until their child jobs close. Startup recovers abandoned leases. Owner, group and audit ACEs are not written.

Existing grants from older releases have no original snapshots. They are refused unchanged; the new release cannot infer their original permissions. Recovery conflicts retain their journals and do not authorize overwriting external ACL edits.

Direct managed `AclSandbox` workspace-write calls now require exactly one `writableDirs` entry and its `workspaceWriteSid(realpathSync(root))`. Seam-managed runner invocations require `--workspace-lease` in addition to the two SID flags. `AclWriteGrant.add(path, true)` now acquires a recoverable lease.

## Migration

1. Finish running confined commands before upgrading. Inspect the affected root without modifying it using `icacls "C:\path\to\workspace"`; an unbacked `S-1-4-*` capability requires migration. Restore a verified original security backup, or copy only file contents into a fresh directory without copying security metadata and reopen it. Preserve the old directory until contents and permissions are reviewed. Without a backup, an operator must explicitly establish the intended permissions; neither the new release nor the ACL diagnosis script can reconstruct a missing historical mandatory label. The bundled diagnosis script performs repairs, so it is not a read-only inspection command.
2. Update direct callers to use one canonical workspace and its derived SID. Wait for every child before calling `dispose()`. Custom runner adapters must pass the live owner returned by `AclWriteGrant.authorization(root)` as `--workspace-lease`; a released owner cannot be reused.
3. Preserve active recovery records under the Windows Local AppData directory, `DeepSeek/Harness/acl-recovery-v1`. Installations owned by the same Windows user share this directory. Do not copy journals between users or manually remove failed records. Successful restoration removes the full journal and retains a small receipt.
4. Verify a confined write in a clean test workspace, then release its final lease and check that its original DACL and mandatory label return. First grant and final restoration scale with tree size; live reentry does not relabel the tree. See the [package contract](../../../../packages/sandbox/sandbox-windows-acl/README.md) for identity, conflict, legacy and platform limits.
