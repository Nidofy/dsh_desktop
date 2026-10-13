---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-07-notebook-compaction

English | [中文](2026-10-07-notebook-compaction.zh.md)

## Summary

Registers the required nidofy/notebook-compaction event for exact auxiliary requests and compaction decisions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-notebook-compaction
baseline: false
changes:
  - root: "event:nidofy/notebook-compaction"
    previous: null
    after: "1c3218e0484d634fadfddd61203ed85c5ba34b42c16fcbe384aa927be38fb66d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs remain valid because no existing event or header changes. New request events retain the exact model input used by notebook candidate validation and recovery. Older builds that do not know this required event refuse the log; no ignorable marker or downgrade support is introduced. The root addition does not require a structural Session format increase.

<a id="verification"></a>
## Verification

Integrated focused Vitest run: 18 files and 182 tests passed. Compaction protocol fixtures now write required request events without ignorable:true and cold-read through the actual JSONL provider. Production generation wiring and v2 activation remain pending.

<a id="dev-note"></a>
## Dev Note

None.
