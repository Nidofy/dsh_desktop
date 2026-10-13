---
description: "Project action verification receipts, retained logs and durable notification delivery."
---

# Project verification and notifications

English | [中文](README.zh.md)

## Summary

Run a locally reviewed project action, read its retained verification receipt, and record an independent acceptance decision. Command exit, parsed tests, input coverage and present input freshness remain separate. New receipt notices use one durable identity even while the workbench is closed.

The workbench supplies fixed execution under the same Shell policy to the [formal isolated self-test](../selftest/README.md). That owner retains bounded reports and never interprets user Session completion as test qualification.

[Task receipt comparisons](../experiments/README.md) read explicit A/B run selections and retain bounded private records. Their independent reader also uses the original T11 execution source and official tool results to inspect a selecting model step. Missing task counts remain unknown; the reader never starts a task or infers factor settings from old diagnostics.

The same page offers a separately confirmed [single analysis request](../experiments/README.md#single-task-request) with its own budget and official input journal. It has no tools, Agent or project writes and does not reuse T19 confirmation. Receipt comparison, task quality and factor equivalence remain independent and unqualified.

## Table of Contents

- [Verification inputs](#verification-inputs)
- [Receipt and retention](#receipt-and-retention)
- [Notification delivery](#notification-delivery)
- [Companion evidence and Hint choices](#companion-evidence-and-hint-choices)
- [Known limitations](#known-limitations)
- [Dev Note](#dev-note)

<a id="verification-inputs"></a>
## Verification inputs

The optional action `verification` object uses schema version 1 and supplies `intent`, `parser`, `coverage`, `sources`, `inputs`, `toolchain` and scalar `parameters` for cases or tolerances. The local user reviews these fields with the command and trusts the resulting configuration. `sources` and `inputs` select workspace-relative files or whole directories; directories include dirty, ignored and untracked regular files. `toolchain` may select explicit absolute files or directories. Generated outputs belong in the action's artifact declarations and outside its input selection. No Git revision substitutes for observed bytes.

Declare `coverage: 'complete'` only after selecting every relevant dependency. The owner hashes selected bytes, actual action configuration, the Host executable/version/environment and resolver settings, plus provider-owned executable/configuration inputs reported by `ShellExecutor.verificationInputs`. Bare/unavailable provider paths, unsupported provider enumeration, links, unstable reads, missing inputs or observation ceilings keep coverage unknown. Local PowerShell reports its executable and collector configuration. The sandbox PowerShell provider has no complete read-only confinement/runtime enumeration and returns null; agent context cannot be reconstructed by an unrelated later reader, so agent receipts also retain unknown coverage/freshness unless an observed source/configuration change establishes STALE.

Each tree observation is bounded to 4,096 entries, 128 MiB per file and 512 MiB total bytes. Scope is explicitly reviewed, not inferred from a command string. Byte observations before and after execution detect retained changes; they do not lock project inputs or detect a transient edit restored between observations.

<a id="receipt-and-retention"></a>
## Receipt and retention

[VerificationOwner](verification.ts) publishes the intent before execution, then the prepared input observation before Shell starts. The ProjectActions-owned run ID identifies both records and the terminal receipt. Configuration revisions are exclusive, increasing publications of actually observed configuration/workspace digests; reverting configuration does not reuse an earlier revision. A missing preparation cannot create PASSED, and old runs without an intent remain legacy execution facts.

`node-tap-13/1` parses only complete supported Node TAP logs. PASSED requires a nonempty all-passed summary, zero exit and no cancellation, timeout, interruption or truncation. A zero exit alone gives no test conclusion. The immutable receipt preserves its original test facts; current reads independently compare inputs/configuration and project acceptance records. STALE does not erase the historical tests. Acceptance uses separate exclusive revision CAS and is available only through authenticated local-user requests, not model tools.

Declared artifact bytes are observed at this run's settlement and carry the actual run ID. Identical bytes across two runs remain two observations. The receipt does not identify the file's writer or claim a new file was produced. Query-time artifact listings remain separately labelled.

Records live under `desktop-actions/<workspace-digest>/verification/<run-id>`. The receipt retains its own at-most-1-MiB execution log, independently of ProjectActions' 100-terminal-run/log pruning. Retained receipt identities are paged in groups of 100. No receipt/log/configuration/acceptance history is automatically deleted; the existing native quota accounts for these files and refuses further admission when capacity is unavailable. Directory discovery is bounded to 8,192 entries and never presents a cropped scan as complete. Unsupported or damaged records refuse reads without replacing their bytes.

Missing terminal publication after reopen yields INTERRUPTED/UNKNOWN, with no command replay or retrospective result from old logs. Log loss or a digest mismatch makes the readable test projection UNKNOWN. Exclusive complete-file publication synchronizes file bytes before making the record visible; physical power loss, independent-SID behavior and hostile concurrent filesystem replacement remain unqualified.

<a id="notification-delivery"></a>
## Notification delivery

[NotificationOwner](notifications.ts) consumes committed receipts. Source ID, result revision and kind determine the one durable NoticeId. Completion with a zero exit produces an awaiting-acceptance notice; failure/unknown execution and cancellation use distinct kinds. Official Session terminals have separate source IDs derived from actual Session ID, physical generation and seq. The adapter uses official flush, observeDurable and generation-protected publication, checks the complete raw terminal against the live event, and refuses unavailable or synthetic observations. Session completion is never a verification receipt. Receipt reconciliation reads retained results after a missed callback; it never replays a command or displays history.

Preferences and the shared system-consumption cursor use durable revision CAS. Preferences default to disabled and survive Host restarts. Main attaches at the current published sequence on startup or reconnect, so it does not display historical notices. New notices require one exclusive durable system claim. Main records sent only after the OS show event, records failed for an observed refusal, and leaves an unacknowledged attempt unknown without automatic retry. Disabling notifications or advancing the startup baseline suppresses display without deleting notices or receipts.

System delivery, companion visibility and explicit user handling are independent. Failed/unknown delivery leaves the source and notice discoverable. Selecting a receipt notice opens its receipt; selecting a Session notice opens current recovery observation. Only successful user-directed location marks the notice handled. Handling a notice does not accept its verification result. The workbench updates the same persisted preferences and has no second polling-based notice producer.

<a id="companion-evidence-and-hint-choices"></a>
## Companion evidence and Hint choices

Companion side analysis has its own expiring confirmation, independent of experiment tickets. It pins the actual idle Session, Workspace membership/path, Host epoch, model and connection revision, egress lease and resolved sandbox permissions. Permission, identity or client lifetime changes cancel and drain the single official request. Selected text is untrusted input with no tools or main-history writes. Limits are 12 KiB input, 1–2048 output tokens, zero retries and 180 seconds; unavailable quota or active retention refuses admission. Exact source labels, dispatch input, result and reported token counts live under `nidofy-extras/experiments/side-analysis-v1`; monetary cost stays unknown. Explicit append authorizes only a completed result for its original scope and current permissions.

On-demand history pages ten records for the current Session and Workspace and cold-reads their original official input and result. Shared retention defaults to twenty active and eighty archived records. A separate 120-second preview and confirmation archives only a settled record, freeing one active slot while exclusively publishing `archive.json` in its original directory. No official generation, input, result or log is moved, replaced or deleted. Budget previews allow 1–20 active and 0–80 archived records, reject ceilings below current counts, and retain at most 256 immutable budget revisions under `retention-v1`. Admission and retention share the original collection lock and native quota. Confirmation rechecks the full selected journal, counts, budget, scope and permissions; expired, duplicate, changed and unfinished operations refuse. Reads and retention never prepare providers, invoke models, append drafts or change main history. Complete responses are bounded to 128 KiB; damaged or future metadata refuses untouched. Physical crash and hostile filesystem replacement remain unqualified.

History filters all, active or archived records before pagination while preserving shared budget counts. A selected-record export has an independent 120-second preview and one-shot confirmation under the current scope and permissions. It writes one quota-managed, exclusively published JSON under `nidofy-extras/analysis-exports-v1`, containing the cold journal and original relative filenames with base64 file bytes, including the original physical generation. Exports are capped at 512 KiB each and 100 retained files; quota or capacity refusal never deletes prior exports. Exact private text is included. Changes, expiry, duplicate confirmation and cancellation before publication refuse; a committed export survives later disconnection and is never automatically retried. Export is a local evidence copy, with no import, migration, provider preparation, draft append or original-record mutation.

Optional conversational tone uses private `nidofy-extras/companion-style-v1.json` with quota, atomic CAS revisions and bounded operation receipts. Local preview and explicit execution are scoped and expiring; duplicate operation IDs return their original receipt. The first official prompt assembly captures one tone choice for that turn and logs the system message through the normal loop. Disabling removes the prompt contribution after any already captured active turn. Cold reopening preserves the choice; unsupported or damaged data refuses without replacing bytes. Local finite settings and pet coordination presentation belong to the [Client reference](../../../../packages/nidofy/desktop-extras/README.md).

`companion/facts` reads the official raw durable generation and prefix, the already selected Notebook, and at most 16 retained T12 notices. Session notices must match the original generation, non-inherited seq, turn, terminal kind and time; logical Session/cwd matching alone leaves them historical. Receipt sources use real `VerificationOwner.inspect`, preserving independent tests, freshness, log availability and acceptance. Unknown or unreadable sources never become passed results. Notebook reads acquire their own generation hold before the final projection hold, avoiding nested acquisition. Provider replacement, cancellation and complete responses above 1 MiB refuse publication. Reads never synchronize or rebind notes, create notifications, advance cursors, claim delivery, handle notices or accept receipts.

[Hint preferences](hint-preferences.ts) use independent schema-version-1 immutable CAS revisions under `desktop-actions/companion-hints/preferences`, covered by existing action quota. Ignore, explicit snooze, exact Workspace ID/path mute and displayed-return-offer identities survive cold reopening. Mute requires an actual Session attachment and a reachable directory; stale edits and damaged/future records refuse without replacing bytes. Complete records are capped at 1 MiB and directory discovery at 8,192 entries, including residue and publication space. History is never silently pruned. An uncertain write is reread, not automatically retried. These choices grant no execution, delivery or acceptance authority. The [Client reference](../../../../packages/nidofy/desktop-extras/README.md) owns rule presentation and navigation.

<a id="known-limitations"></a>
## Known limitations

Official pending approvals remain in the approval owner and are not yet durable-notice producers here. The Desktop Companion owner now publishes explicit scope and an on-demand filtered view. Missed receipt callbacks are reconciled; missed Session callbacks are not cold-rebuilt from all historical Session logs. Receipt inspection currently requires its workspace directory to remain reachable; retained files are not deleted when it is unavailable. Raw Session observation may decode the full prefix; peak memory remains unqualified. Current tests cover actual Windows Node-mode Host/Shell/quota and the Main consumption controller with an observed display adapter; they do not qualify an installed Electron notification, renderer/preload interaction, corporate gateway, Office conversion, physical crash or installer.

<a id="dev-note"></a>
## Dev Note

None.

## Notification and recovery visibility

Notice readers accept v1 and v2; writers emit v2 for main Session reasons and observed background-job terminal records. Awaited, teardown, internal engineering and subagent activity is excluded. Job identities include the runtime epoch; a terminal state not observed before process death cannot be reconstructed. Existing v1 bytes are retained. Old builds that only accept v1 cannot read a home containing new v2 notices. Task inspection lists at most 100 recent main Sessions and also accepts an exact retained ID. Opening a conversation is read-only navigation and never resumes its agent. Historical task status does not confer cancellation authority.
