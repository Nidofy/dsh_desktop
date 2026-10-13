---
kind: upgrade-guide
description: "Historical JSONL write-open now stops on precommit cancellation and returns a committed handle after late cancellation."
---

# JSONL migration cancellation

English | [中文](guide.zh.md)

## Change

Historical JSONL write-open previously finished successor publication after cancellation during staging, then rejected the open. It now honors cancellation during encoding, verification and the final source check, closes the stage and drains the verifier before rejecting, and preserves the source. Once exclusive publication starts, a successful open returns its handle even if cancellation arrives afterward. A postpublication I/O failure can still reject with the successor present; rejection alone never proves absence.

## Migration

1. Update callers of `SessionPersistence.open(id, 'write', { signal })` to close every returned handle even when `signal.aborted` is true. Treat a returned handle as a completed open.
2. After failure, inspect the selected generation before any explicit recovery. Preserve historical sources and existing current generations. Do not infer permission to replay another side effect from a cancellation or I/O error.
3. Confirm precommit cancellation leaves no new current generation or live verifier, while cancellation after successful publication retains the current generation. The optional trusted JSONL migration writer measures and enforces successor bytes; it grants no product import-root or adoption authority.
