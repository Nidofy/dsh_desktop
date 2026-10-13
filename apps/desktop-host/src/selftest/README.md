---
description: "Run isolated Electron local checks and inspect bounded, secret-free reports."
---

# Electron self-test

English | [中文](README.zh.md)

## Summary

The authenticated Desktop workbench runs isolated local checks and explicitly confirmed connection checks. Local mode creates a fresh synthetic workspace, uses existing Shell policy, native quota and action/artifact owners, and loads no user rules, user Skills or model requests. Connection mode sends only fixed synthetic inputs. Viewing, history, polling and export never start checks.

## Table of Contents

- [Run and inspect](#run-and-inspect)
- [Persistence and cancellation](#persistence-and-cancellation)
- [Measurement limits](#measurement-limits)
- [Prefix classifications](#prefix-classifications)
- [Known limitations](#known-limitations)

<a id="run-and-inspect"></a>
## Run and inspect

Personal extensions → Local checks opens `/api/nidofy/workbench/selftest/ui` on the existing authenticated carrier. `start` accepts `mode: 'local'` and a fresh caller-retained UUID `operationId`. After an uncertain response, `read` uses that identity without resending; null is UNKNOWN, not replay permission. Other operations are `list`, `cancel` and `export`. Callers cannot select directories, commands or arbitrary input bodies. No model-callable self-test tool is registered.

“Read retained input capacity” calls `connection-capacity` with no fields. It reads only retained private inputs and reports root/unsettled counts or the existing allocation refusal, without allocating directories, reading credentials, preparing calls or deleting bytes. At twenty roots it reports the root limit and leaves unsettled count unmeasured. Damaged/future/linked inputs stay an explicit read refusal. Counts are observations, not permission to send or repair; allocation rechecks them independently. Host shutdown cancels and drains these reads.

Connection checks first read `connection-options` without discovery HTTP, then `connection-prepare` with an existing managed `connection`, its exact `model` and integer `requests: 1..5`. The preview displays the real connection UUID/publication revision and separate T23 distribution/profile revisions. Confirm with `start`, `mode: 'provider'`, the fresh `operationId`, returned single-use `ticket` and `accepted: true` before its two-minute expiry. The dashboard requires an explicit checkbox. Each request fixes `maxTokens: 64`; the managed route must have `retryPolicy: { mode: 'normal', maxRetries: 0 }`. No retry, failover or model-generated command executes. Model, connection publication, revocation, policy/provider and budget checks precede every send. Failure, unknown finish, output exhaustion or unknown evidence stops later requests. These product operations may incur provider charges; local verification uses only a synthetic loopback provider and Key.

All 25 identities have independent scope, phase, result and closed diagnostic codes. Local mode leaves provider rows SKIPPED; connection mode leaves local rows SKIPPED. Both field rows remain UNKNOWN. COMPLETED means the workflow ended; it never turns missing evidence into PASS.

<a id="persistence-and-cancellation"></a>
## Persistence and cancellation

Reports live under `nidofy-extras/selftests/reports`. The runner reserves ordinary checkpoints and separate terminal bytes through the existing native owner. Intent commits before check-provider construction; each RUNNING row commits before execution. Results become visible only after complete checkpoint publication. Failed or uncertain checkpoints stop subsequent side effects and are never blindly repeated. Cancellation awaits check, command/output drain and cleanup before terminal publication; closing the page does not cancel. Host disposal rejects new starts, aborts and drains.

Cold reads project unsettled runs to INTERRUPTED, executing rows to UNKNOWN and pending rows to SKIPPED without editing original bytes or replaying work. A new explicit run uses a fresh identity/workspace, never adopting the interrupted one. Each complete report/export is capped at 64 KiB. Twenty reports are retained; only known terminal records may be evicted. Interrupted, damaged/future and temporary bytes are preserved or explicitly refused. History discovery refuses above 80 entries or a total of 22 × 64 KiB + 4 KiB, including replacement space, locks and residue; linked paths are refused.

JSON exports rebuild allowed fields and omit the internal run ID; Markdown uses the same report and fixed localized scopes. Exports contain no paths, addresses, accounts, model names, keys, bodies or raw exceptions. Synthetic roots use random identities and exclusive canonical-directory markers. Normal cleanup drains work, revalidates the marker and refuses links/special files before removing only this run's root. Crash leftovers are preserved; ten leftovers refuse allocation. Skill discovery disables default roots and uses one explicit synthetic directory. Private receipt-notice owners have no system-display consumer.

Connection reports use schemaVersion 2; local schemaVersion 1 remains readable without rewriting. Full synthetic input checkpoints live separately under `nidofy-extras/selftests/inputs/<run>`. The official JSONL writer commits the turn/step framing, exact request header, tool definitions and raw user message, flushes, cold-reconstructs the actual request, and dispatches under the same official physical-generation protection. Each request has a fresh private Session identity and no Agent or user-session registration. Input checkpoints record dispatch prerequisites, not provider outcome or replay permission. A canonical marker is revalidated for each write/read. These retained inputs have a twenty-root, eighty-entry-per-root and 64-KiB-per-root limits including markers and residual bytes. Discovery cold-validates existing logs; damaged/future/linked bytes refuse, and ten unsettled or unknown roots refuse allocation. Limits never authorize deleting old inputs. Native quota includes these writes and the generation-lock metadata; dispatch keeps its admitted lease until the provider drains. They never enter reports, exports or normal workspace cleanup.

<a id="measurement-limits"></a>
## Measurement limits

Real checks measure UTF-8 atomic replacement/cold read, native quota refusal, fixed Shell file output, isolated official Skill loading, execution-time action trust/change refusal, fixed TAP execution and cold journal read, cancellation of a started command, isolated Git/Hg baseline comparison, artifact lease invalidation, read-only checkpoint recovery and private notice deduplication. Exit, parsed tests and user input coverage remain separate; synthetic receipts never certify user projects. Only a missing VCS executable is SKIPPED, not an observed execution failure.

Desktop selects the standalone Node from its existing primary-runtime payload for fixed synthetic commands and TAP parsing, through the same resource resolver used by Office. Main and Host still run under Electron. The provider checks that executable before workspace allocation; missing or linked resources refuse. Commands retain the existing Shell policy, native protection and quota. Ordinary Node test/repair compositions use their current executable. An exit code without the independently read synthetic output never qualifies a check.

The prefix row qualifies only the [local classifications](#prefix-classifications), using official raw JSONL, committed Notebook and prepared PiAi/cache-hint consumers without creating an Agent or sending a request. It does not qualify provider cache hits, Agent-loop prompt admission or turn-snapshot rendering. The provider-failure row uses official preparation and a private failing adapter before any payload/send, stopping later preparations; it does not qualify streaming retries. The Node row observes an actual Electron Node-mode process/executable only. Development Node, installed runtime/module inventory and renderer/preload evidence stay UNKNOWN. No SHA or signature qualification is inferred.

Connection mode uses one request to observe connection, streaming and the fixed `selftest_echo` protocol without executing that tool. Cache counters qualify only when the adapter actually reports them. The cache-repeat row needs four remaining requests: two independent 2-KiB groups, each repeated twice. It reports PASS only for an actual positive cache read; absent counters remain UNKNOWN without fabricated zeroes. A smaller confirmed budget ends that measurement UNKNOWN without sending a partial group.

<a id="prefix-classifications"></a>
## Prefix classifications

The local prefix check measures the following cases on fresh synthetic data. PASS applies to these consumer decisions, never to a provider's cache behavior. Request bodies and routing keys stay outside reports. Existing reports and Notebook generations are not rewritten.

| Change | Measured consumer decision |
|---|---|
| Raw append | Physical generation stays fixed; the original raw prefix remains intact, the persistence revision changes and explicit Notebook synchronization catches up. A committed read alone does not synchronize. |
| Surface replacement | The replacement appends a raw event and changes cold-derived model history. The original citation remains available and committed notes/cursors remain unchanged. |
| Explicit note correction or stale CAS | Successful correction publishes the next note revision; stale revision refuses. Reads see only the selected revision; no implicit evidence or commit cursor advance occurs. |
| Official restore to another physical root | Identical logical events retain their format but acquire a different physical generation. Old generation protection and the old Notebook scope refuse; the original selected notes remain readable. |
| Prepared model, token/default or tool changes | Official canonical headers distinguish model, output cap, default provenance and tool definitions; an empty tool list canonicalizes to no tools. PiAi declares neither in-history system-prompt nor tool updates. |
| Endpoint or deployment changes | An endpoint-only change can retain an equal logged header. New preparations observe the new endpoint/capacity/retry policy while old preparation facts stay fixed; header equality grants no route or policy permission. |
| Cache routing hint | Same provider/model/endpoint/home/Session/key retains its hint across message append/replacement, note correction, tool and token changes. Changing any scope member or the private key separates it. Native/other protocols keep the payload; off, disallowed model or absent Session removes the hint. Existing captures retain their policy and preserve every other payload field. A matching hint never proves a matching prefix or a cache hit. |

<a id="known-limitations"></a>
## Known limitations

Managed connection mode requires the actual connection, storage and HTTP owners; repair compositions without them refuse. Retained input capacity has no automatic eviction or repair UI. The old cache Probe does not satisfy the official input-log obligation. The [development carrier](../../../desktop/tests/README.md#verification-selftest) qualifies the real authenticated local and synthetic connection dashboard; report rows do not consume that external evidence, so renderer/resource-inventory rows remain UNKNOWN. Installer, multi-display/sleep/window recovery, real provider cache behavior and enterprise gateway remain unqualified. Application HTTP policy does not qualify Shell/Git/sockets/workers or global zero-egress; see the [HTTP owner](../connections/README.md).
