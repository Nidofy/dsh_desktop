---
kind: upgrade-guide
description: "New engineering previews require explicit copy and Session resource checkpoint limits."
---

# Explicit engineering resource limits

English | [中文](guide.zh.md)

## Change

`engineering-prepare` and each `matrix-prepare` row now require `resourceBudget` independently of the existing request/output budget. The previous request format refuses without allocating a copy or sending. Existing engineering, matrix, T11 and official Session records retain their formats. Old engineering journals without resource allocation sidecars remain readable with unknown resources; new admission refuses those unaccounted allocations without adopting or deleting them.

New previews also require `shellBudget` for complete Shell output and retained spill charges. Missing original Shell accounting refuses new admission; old records remain readable with unknown Shell observations. Completed action results and T11 receipts survive output exhaustion; only subsequent work is refused.

Engineering Session reads now require actual physical length before full decoding and refuse changed metadata revisions. Cold reads retain their 2 MiB/4,096-event scan ceiling; small compressed files still undergo a complete logical-size check after official decoding. Resource observations without a request cut are revalidated instead of being returned unchecked.

## Migration

1. Add all six `resourceBudget` limits and both `shellBudget` limits to each engineering preview request, including matrix rows. The current local page provides editable values. For example:

```json
{"resourceBudget":{"workspaceBytes":33554432,"workspaceEntries":1024,"retainedWorkspaceBytes":536870912,"sessionBytes":2097152,"sessionDiskBytes":2097152,"sessionEvents":4096},"shellBudget":{"outputBytes":8388608,"retainedSpillBytes":134217728}}
```

2. Preview and explicitly confirm the complete input, reviewed commands and the explicit budgets. Retained workspace and Shell allowances remain charged after a run. If a prior allocation lacks its resource owner or exceeds a limit, preserve the original files and inspect the refusal; no automatic repair, deletion or retry is available.
3. Read the original engineering journal and its resource checkpoints. Drained copy lengths, physical Session lengths and logical snapshot bytes are separate observations. Runtime disk and Host memory peaks remain null. Full behavior and limitations belong to the [engineering owner](../../../../apps/desktop-host/src/experiments/README.md#isolated-engineering-task).
4. If a read refuses missing or excessive physical metadata, preserve the original Session and journal and inspect the official persistence owner. Reading, raising a confirmed checkpoint budget or seeing no request cut grants no automatic repair, pruning or replay.
