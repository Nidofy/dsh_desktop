---
kind: upgrade-guide
description: "Durable receipt notifications replace transient workbench polling and raw renderer notification IPC."
---

# Durable workbench verification and notifications

English | [中文](guide.zh.md)

## Change

The authenticated `workbench/notifications` response is a paged notice object rather than a transient turn-end array. Notification preferences are home-wide, revisioned and persistent; the old process-local checkbox and raw `nidofy:notify` renderer IPC no longer produce notifications. Main consumes committed receipt notices and raw-durable Session terminal notices even while the workbench is closed. A completed Session turn never establishes project verification.

Old action records/logs remain readable as execution facts. They have no pre-execution intent and cannot receive a retrospective passing receipt. New verification records and retained logs live separately under `desktop-actions`, and are not removed with the 100-run action-history trim.

New notice files use schemaVersion 2, adding background-job identity and distinct blocked, limit, interrupted and unknown reasons. Current readers preserve and read v1 records. Keep a pre-upgrade home backup before first use: older builds that accept only v1 cannot open new v2 records. Keeping an old portable executable does not make downgrading the same home supported.

## Migration

1. Reopen the workbench and explicitly enable notifications if wanted. Preferences default to disabled. Refresh before a conflicting edit; `notifications/configure` requires the observed `expectedRevision`.
2. Update custom consumers to read the paged notice response and keep source ID/type, system delivery, companion visibility and handled state separate. Remove calls to `nidofy:notify`; use the Host's claim/settle/cursor APIs through Main. On startup/reconnect establish a new baseline without displaying history. Never retry an unknown OS attempt.
3. Add an explicitly reviewed action `verification` scope when using receipts. Read [the owner reference](../../../../apps/desktop-host/src/workbench/README.md) for supported parsers, input/toolchain coverage and independent acceptance. Unsupported provider enumeration remains UNKNOWN even after a zero exit or parsed test pass.
4. Confirm a new actual run has a committed receipt and retained log, then change a selected input and observe STALE. Accept/reject separately. Keep prior data and receipts; there is no automatic deletion, execution replay or source-log migration.
