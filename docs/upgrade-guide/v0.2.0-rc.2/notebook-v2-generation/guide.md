---
kind: upgrade-guide
description: Working Notebook uses independent budgets and physical Session identities in its v2 API.
---

# Working Notebook v2

English | [中文](guide.zh.md)

## Change

The private Nidofy Working Notebook plugin uses v2 active notes, history and two evidence cursors. Its Config replaces `maxEntries` and `maxBytes` with `maxActiveEntries`, `maxActiveBytes`, `maxDeltaBytes`, `maxEvidenceBytes` and `maxHistoryBytes`. The update API requires the scope returned by the read API and uses `cursors.evidenceThrough`; the read API returns `active` instead of `entries`.

Notebook scopes carry the official persistence provider's opaque physical generation. A numeric generation in an existing v2 file cannot establish that identity. Such files remain untouched and produce `NOTEBOOK_GENERATION_REBIND_REQUIRED`. A changed physical generation produces `NOTEBOOK_SCOPE_CONFLICT`. Neither refusal resets the committed cursors or deletes history.

## Migration

1. Update any Working Notebook Config overrides to the five new fields. They separately bound active entry count, complete active injection bytes, delta bytes, evidence appendix bytes and history disk bytes. Profiles without overrides use the validated defaults.
2. Update custom API clients to retain the complete returned scope and revision and submit both with each edit. Refresh after a conflict. The shipped Panel and tools use this protocol.
3. Existing v1 files convert by copying into the v2 namespace; original files remain. Existing numeric v2 state or state from a replaced/restored Session requires explicit evidence reconciliation before rebinding. No automatic rebind is provided. Preserve those files and resolve the diagnostic before using notes for that Session.
4. Verify a new Session can save an edit, show it after reopening, and include it at the next turn boundary. Physical generation identity is stable across appends and cold starts on the same filesystem, but copying a Session file creates a different incarnation.
