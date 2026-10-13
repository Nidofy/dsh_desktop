---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-provider-selection-identity

English | [中文](2026-10-13-provider-selection-identity.zh.md)

## Summary

Adds optional providerIdentity to the logged LlmCallConfig.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-provider-selection-identity
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "2f09e4b30487c64bcaf3edce3ba0c987fb7823f16cf37e4ceceb36228262ed2b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing headers remain valid; absent identity retains the raw provider for selection replay. Dispatch and open-step retries continue to use the logged provider revision. This optional addition does not increase the Session writer version.

<a id="verification"></a>
## Verification

provider-identity-replay.host.spec.ts: two real JSONL storage and cold projection cases pass, preserving actual revision and old-header behavior; connection owner and cache partition focused suites pass.

<a id="dev-note"></a>
## Dev Note

None.
