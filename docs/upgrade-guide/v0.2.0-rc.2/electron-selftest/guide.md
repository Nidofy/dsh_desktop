---
kind: upgrade-guide
description: "The Desktop presence-check endpoint refuses; formal local self-tests use durable run identities."
---

# Desktop self-test uses durable runs

English | [中文](guide.zh.md)

## Change

`POST /api/nidofy-extras/selftest` no longer returns six service-presence rows labelled PASS. It refuses with `SELFTEST_USE_FORMAL_RUNNER`. The formal local runner has 25 scoped results, persistent intent/checkpoints, read-only interrupted recovery and a zero-model budget. Reports use separate `nidofy-extras/selftests` storage; existing user data is not migrated.

Confirmed managed-connection checks publish schemaVersion 2 reports with a one-to-five-request budget and 64 output tokens per request. Local schemaVersion 1 reports remain readable without rewriting; older programs refuse version 2. Complete synthetic request inputs are retained in separate private official JSONL logs, never included in exports. No Session format changes.

## Migration

1. Open Personal extensions → Local checks. Direct consumers use `/api/nidofy/workbench/selftest/start` with `mode: 'local'` and a fresh UUID `operationId`; retain it before sending.
2. After an uncertain response, use `read` with `id`, not another `start`. `list`, `cancel` and `export` use the same authenticated namespace. For connection checks, use `connection-options`, then `connection-prepare`; confirm the returned model, connection and HTTP revisions and budget with `mode: 'provider'`, `ticket` and `accepted: true`. The ticket expires after two minutes and cannot be reused. Disable route retries explicitly.
3. Confirm `kind: 'electron-self-test'`, all 25 rows and both field rows UNKNOWN. Local mode has `budget.modelRequests: 0`; provider mode has `modelRequests: 1..5` and `maxOutputTokens: 64`. COMPLETED does not mean all PASS. See the [owner reference](../../../../apps/desktop-host/src/selftest/README.md).
4. Version 2 readers must preserve missing counters and failed/unknown requests without retry or replay, and omit private inputs from export. For rollback, use the prior program with its prior data copy; it cannot read new reports in place.
