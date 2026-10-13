# Desktop local verification

English | [中文](README.zh.md)

## Summary

The Companion source fixture uses production Client Loader/Frame/Conversation/Workspace composition with isolated Remote and preload adapters. It covers independent window identities, a non-first retained reference, late results during navigation, permission changes, reconnect, attention release, narrow draft/actual attachments, shared Modal IME/focus and single character disposal. The Main transient navigation owner refuses other actual windows and old revisions. The complete built profile adds authenticated Host epoch, restart replacement, scoped notices and read-only Notebook checks without additional model calls or notice mutation. The current Windows development carrier separately covers production Main/preload, authenticated page requests, delayed hidden-window cancellation, primary/workbench cross-sender refusal, real Notebook Host/Client hot lifecycle, drafts/attachments/caret, synthetic composition guards, locales, themes and zoom. The supported native combination is the primary Conversation window and auxiliary workbench. A second complete root is refused before and after reload; same-origin child streams and auxiliary bootstrap are refused. Primary reload invalidates the old scope and restores its stream. Physical OS IME and installed qualification remain open.

Local download and mandatory-dialog evidence is separate from production backend integration, visual acceptance, and installed-application upgrades. Run the command in the [Desktop README](../README.md) to produce a fresh isolated report.

Installed qualification can opt into `DSH_DESKTOP_UPDATE_JOURNAL_DIR`, an absolute directory outside the installation tree that both versions retain. Each main process flushes a separate JSONL file with its installed version, state transitions, and manual-operation milestones. Raw diagnostics and request data are excluded; storage errors propagate. The [journal decision](../../../.agents/notes/implemented/testing/2026-09-14-desktop-installed-update-journal.md) defines evidence limits. Unit and main-entry tests cover the journal; a signed installed upgrade is still unverified.

## Table of Contents

- [Companion carrier](#verification-companion)
- [Self-test carrier](#verification-selftest)
- [Receipt comparison profile](#verification-experiments)
- [Single task request profile](#verification-task-request)
- [Isolated engineering profile](#verification-engineering-task)
- [Native overlay visibility](#verification-overlay)
- [Evidence](#verification-evidence)
- [Manual walkthrough](#verification-interactive)
- [Open verification](#verification-open)

<a id="verification-companion"></a>

## Companion carrier

After building the current Desktop, desktop-extras Host and both Nidofy Client bundles, run the existing local Electron binary through the built e2e entry. The fixture creates private appData, Chromium state, Harness data and workspace directories and retains its result and stable PNGs under `.build/dispatch/evidence/relay-15/carrier-*`. It projects installed packages individually to preserve Windows module resolution, never invokes the Electron npm entry’s implicit downloader, and uses no billed provider. Test-only sources use the official Session writer and actual Workspace attachment. Project association, unlinked-source refusal, original preview, explicit draft insertion and association removal run through the assembled Panel and Host owners.

The same carrier reads generation-bound facts and real committed notes, creates a user correction through the authenticated Notebook API, and exercises Hint ignore, explicit snooze, exact-project mute/unmute, renderer-reload recovery and visible return-offer deduplication. English and Chinese screenshots retain the actual source labels. Source tests separately cover stale/unknown real Shell receipts, independent acceptance, cold preference owners, corruption/future-version refusal, concurrent CAS, same-scope late reads and bilingual expected output. These are development-carrier and owner-local evidence; they do not qualify a Host process restart, OS notification delivery, top-level recorded-session replay or installation.

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/companion-carrier.built.e2e.ts --retry=0
```

<a id="verification-selftest"></a>

## Self-test carrier

Build the current Desktop Main/preload and Host, and retain built Web/Client assets, the native protection helper and the existing Windows Electron binary. The [self-test fixture](fixtures/selftest-carrier.mjs) launches production Main with private TEMP appData, Chromium storage, Harness data and copied standalone Node resources. It uses the official base/Web/Nidofy profile, disables model/title/rule plugins, selects the existing system PowerShell through its declared configuration and directs first-use Documents initialization to a synthetic file that the actual owner refuses. This prevents default Workspace/Agent creation without changing shipped defaults. No user credentials, user Skills or OS protocol registration are used. Results, PNGs, native downloads and private-root locators remain under `.build/dispatch/evidence/relay-20/`; temporary roots and inputs are retained.

The local scenario follows Personal extensions into the real auxiliary self-test window, observes sandboxed preload isolation and refused Conversation bootstrap, reads capacity in both languages, explicitly starts one local run, reloads its report without replay and saves real JSON/Markdown downloads through Electron's `will-download`. The connection scenario previews exact route/publication and independent HTTP revisions with no sends, requires unchecked consent, discards it after a budget change, then sends five fixed 64-token requests to its own synthetic loopback SSE server. It cancels a sixth started stream and waits for drain, preserves CANCELLED and its independent warning, reloads without resending and cold-reconstructs all six complete private inputs through the official JSONL reader. Report bytes remain unchanged. Both scenarios observe zero Agents; only the connection scenario sends requests, with zero billed providers. Test teardown requests production quit and drains its private process subtree.

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/selftest-carrier.built.e2e.ts apps/desktop/tests/selftest-provider-carrier.built.e2e.ts --retry=0
```

This qualifies the current Windows development renderer and these authenticated interactions. It does not qualify an installed resource inventory, installer, physical multi-display/sleep/window recovery, real provider cache hits, top-level recorded-session replay or gateway. The runner's renderer/resource rows remain UNKNOWN because this external fixture result is not per-run product evidence. An observed ACL refusal or command exit without independent output remains a failure, never a sandbox-mode override.

<a id="verification-overlay"></a>

## Native overlay visibility

On macOS, reuse the cached Electron runtime after compiling the Desktop Host sources:

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

The fixture owns a unique profile and writes `result.json` under `.desktop-build/qualification/update-overlay-*`. It compares native visibility, unfiltered parent content, and listener cleanup with the owner-local expected output for parent hide/show and document readiness while the parent is hidden. It uses no network, product login, or dsh Host. This qualifies native window restoration rather than the full first-login flow.

<a id="verification-interactive"></a>

## Manual walkthrough

For actual installation, publication after startup, failure/retry, and restart evidence, use the [installed-update operator checklist](installed-update/README.md). The interactive runner below intercepts installation and is a different qualification.

With Host, client, and Desktop artifacts built, run `node --import tsx apps/desktop/scripts/test-workspace-updates.ts --interactive` from the repository root on Windows. The actual workspace stays open with a separate control window. Its menus select ordinary or mandatory updates, hold and release downloads, inject download failures, and queue or clear test tasks. Select a failure before starting the download. After installation approval and task shutdown, a fixture message reports the intercepted installer call; acknowledging it ends the walkthrough. Closing the control window also exits. Each run owns a private profile and loopback server; payloads are not installers. Restart the command for a fresh round. Omitting `--interactive` runs the automated scenarios with their 120-second deadline and automatic exit; interactive downloads have a ten-minute network deadline.

<a id="verification-evidence"></a>

## Evidence

On Windows, build the Host and locked native protection helper, then run `node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/connections-profile.built.e2e.ts`. The [full profile fixture](fixtures/connection-full-profile.mjs) starts the current built Desktop Host entry with official base/Web/Nidofy layers, a private TEMP data root/home, real Office resources, synthetic keys and local HTTP/HTTPS services. It records keyless and successful Agent sessions, repairs connections through the actual authenticated English/Chinese page script, verifies proxy edits across a Host restart, rejects an untrusted TLS issuer and completes a real Agent request after a child launch with `NODE_EXTRA_CA_CERTS`. The fixture also checks ready/fatal, graceful acknowledgement and listener closure. It retains evidence under `.build/dispatch/evidence/full-desktop-profile/`; fixture credentials and dependency projections are removed after child teardown. This qualifies the Node-mode Host, local TLS, resource registration and jsdom page replay; Electron renderer/preload and page network, Office conversion, corporate gateways and installation remain unqualified.

The authenticated storage-page replay separates cached ledger totals from reconciled measurement, explicit recovery and unknown operation inspection. The full Node-mode fixture executes an authenticated bounded legacy import, reads its committed category report, adopts in place and cold-reads the actual old Session with a second Host sharing the original root ledger. It prepares later launch parameters without switching the first Host, and imports a separate synthetic plan manifest as paused with no official task creation. Source page regressions separately exercise current snapshot selection, default unchecked restoration, late preview discard, archive confirmation and unknown-result retention; real Windows native tests exercise capture/seal/export/verify/import and selected-file restoration. Source migration regressions check independent confirmations, safe category/namespace rendering and stale-preview rejection. Native tests keep an adopted Desktop runtime file exclusively open while managed reconciliation succeeds. The full profile also runs real Node tests with --test-isolation=none through the authenticated Workbench/Shell/native protection path and commits a retained verification receipt with explicit Node TAP parsing, changed-input STALE and independent acceptance. It checks authenticated durable notice identity, one system claim, unknown display settlement and raw-durable Session terminal references. Installed OS display is not exercised. This qualifies the Windows sandbox's reported partial enforcement for that command, not nested process spawning or full runtime preparation. The fixture records its isolated data root beside retained evidence. Cleanup only lists read-only candidates. The TLS PEM and server key under `fixtures/connection-test-*` are disposable test identities, valid to October 2036; they are never production credentials or trusted in the system certificate store.

The local command builds Desktop and executes Electron 44 with the actual HTTP updater, policy client, sandboxed preload, and mandatory renderer. It records each scenario and preserves its report under `.desktop-build/qualification/local-updater-*`. The installer call, external browser, and clipboard are observation substitutes; downloaded bytes are not an executable installer.

Packaging supervision fixtures control their Git metadata and use real file hashes with inert child processes. Git-head and worktree changes still refuse packaging; concurrent tests cannot change the fixture’s recorded Git inputs.

| Layer | Observed result |
|---|---|
| Ordinary updater | Same/older-version rejection, user-authorized full download, SHA-512 rejection, interrupted transfer, stalled-feed/download deadlines, explicit retry, coalesced requests, same-address feed replacement, readiness, and separate install handoff pass |
| Mandatory policy | Flattened `40005`, exact release headers, guest requests, no-force validation, failure retention, interval/backoff, timeout, and disposal regressions pass |
| Ordinary scheduling | Fake-clock regressions with the real coordinator verify bounded jitter/backoff, manual joins, success reset, no automatic download retry, wall-clock independence, and disposal. Main-entry tests verify focus/resume throttling, immediate explicit checks, and quit cleanup |
| Actual mandatory window | Text-only server content, an embedded Windows shell frame with no additional native window and an enabled main window, Escape blocking, direct download, same-modal task confirmation, deferral, recovery-only page actions, navigation/copy feedback, and fresh policy clearance pass; a focused test verifies close-to-exit without clearing policy |
| Actual ordinary dialog | Isolated preload, 380px card, 24px corners, black primary button, parent blur, Escape cancellation retaining readiness, and task-warning approval with recorded installation handoff pass |
| Unlocked Windows interaction | OS-level clicks and screenshots of the actual mandatory renderer confirm Escape blocking, user-started download, readiness, red policy-error feedback, and modal clearance with the parent enabled again. A fixture-provided native task-warning dialog returns to readiness on deferral; task activity is simulated, not a full Host workload |
| Main entry | A known block refuses plugin mutations and recovery without stopping the Host; fresh success closes the block; packaged policy ignores environment overrides; installer failure after a clean stop restores the Host before another confirmation and retains mandatory blocking |
| Host task protection | The actual controller with substituted composition detects running agents, queued turns/steps, and global and agent jobs; API reads do not warn. Admission locking returns 503 for new requests, drains existing requests, and rechecks tasks; unlock restores admission |
| Visible output | Chinese mandatory-dialog DOM expectation and ordinary update presentation expectation pass; account-row component tests cover progress and persistent retry |
| Packaging configuration | Metadata embeds the configured application ID and policy; the built pre-pack hook rejects an HTTP policy origin without running packaging or upload |

The focused dialog, main-entry, settings, and sidebar run passes 119 regression cases. Five carrier tests cover all statements, branches, functions, and lines of the shared update-status source. The real-Electron command passes 17 scenarios and captures ordinary-ready, task-warning, and mandatory-error dialogs. These isolated checks do not certify the complete workspace or a release. Full-repository gate results and environment limitations remain separate from this focused evidence.

Chromium headless shell revision 1228 is installed in the ignored `.desktop-build/playwright` directory. The assembled settings and sidebar browser suites pass 18 cases. The [Desktop workspace browser scenario](../../web/tests/desktop-updates.e2e.ts) passes both Chinese and English cases, captures six screenshots per locale, and verifies bottom-row placement, compact progress with duplicate-click rejection, a top-toggle badge, persistent red retry with error tooltip, and a separate ready action. The presentation function, Host Web composition, client plugins, and CSS are real; the Desktop carrier is substituted. These cases do not exercise Electron IPC, menus, task authorization, or installation.

The [built Host scenario](fixtures/host-update-qualification.mjs) uses the actual profile Loader, standard agent preset, task services, and Node background processes. It verifies queued turns/steps, a running model request, pending questions/approvals, global and agent jobs in running/stopping states, admission locking without cancellation, restored admission, and rejected inspection after Host disposal. Only model responses and human answers are substituted. Two independent invocations pass concurrently with private profiles and session data; all owned agents, jobs, and Hosts finish before a success report is written.

The [Electron workspace runner](../scripts/test-workspace-updates.ts) executes a private copy of the compiled main entry with the real preload, workspace, and separate Host process. It acknowledges the first-run notice and drives renderer buttons through Electron input events and Chromium debugger input for the embedded Windows frame. The private application reuses the prepared target runtime resources. Ten scenarios pass, covering menu feedback, download failure and retry, separate installation confirmation, real confirmation-time task creation, deferral, mandatory blocking, and actual Host teardown timeout. Both ordinary and mandatory failures restore a replacement Host and require fresh installation confirmation; recovery does not clear mandatory policy. Delivery uses a local server and installation is intercepted; these are not signed installed-app results.

The [Windows signature runner](../scripts/test-windows-update-signature.mjs) uses the installed electron-builder metadata generator and `NsisUpdater` verifier with the public release certificate and real executable inputs. Matching publisher attributes pass; the same valid signature with a different expected publisher and an unsigned executable are rejected. A missing-publisher negative control confirms that verification is skipped. Unit regressions cover DN escaping, incomplete identities, and explicit or host-default Windows targets; removing the publisher configuration fails both metadata cases. This check does not download, install, or sign an artifact.

The [signed-download runner](../scripts/test-signed-updates.mjs) connects real Electron HTTP, `NsisUpdater`, Windows Authenticode, and the built coordinator. Four scenarios pass: valid-hash wrong-publisher rejection, valid-hash unsigned rejection, corrupt-transfer rejection before signature verification, and explicit retry to signed readiness with separate installation handoff. Rejected executable caches are empty, automatic checks issue no retry request, prepared downloads are retained, and original inputs keep their SHA-512. The synthetic feed and test application adapter do not establish installed-version compatibility; no installer or Host starts.

With an old installer and both original blockmaps, the same runner additionally verifies single-range and multipart-range reconstruction, missing-old-blockmap fallback, and rejected-range fallback. Reconstructed executables pass SHA-512 and Authenticode checks. Request records distinguish differential payload bytes from full downloads; a full fallback cannot satisfy a differential-success assertion. These loopback results do not certify CDN Range support or an installed application's cache.

<a id="verification-experiments"></a>

## Receipt comparison profile

The [built fixture](fixtures/experiments-full-profile.mjs) launches the existing supported Desktop Host with the complete base/Web/Nidofy profile and a fresh private TEMP home. It copies the current Node executable, selects existing system PowerShell and runs two locally trusted synthetic TAP actions in an independent project through production protection/Shell/T11/native quota. Authenticated bilingual page reads, cookie/origin refusals including the model-step endpoint, explicit experiment/case/run selections, missing model counts, independent acceptance, immutable archiving, changed-source import refusal and cold restart without replay are asserted. Desktop-origin model-step reads stay unknown and caller-supplied counters refuse. Both Host lifetimes observe zero model sends and zero Agents. Current roots, records, receipts and logs are retained under `.build/dispatch/evidence/relay-22/full-profile/`; earlier Relay21 evidence is preserved. Renderer interaction, task A/B sending/matrix, installed qualification and complete model-input association remain unverified. [Comparison semantics](../../desktop-host/src/experiments/README.md) belong to the owner.

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-profile.built.e2e.ts --retry=0
```

<a id="verification-engineering-task"></a>

## Isolated engineering profile

The [engineering fixture](fixtures/experiments-engineering-profile.mjs) launches the complete supported Node-mode Host with actual Agent/protected Shell/T11/native quota and private copied inputs. It checks full official inputs, causal receipts, Notebook/cache captures, sequential matrices, cancellation, cold original bytes, report validation and no retries. Independent resource scenarios refuse before dispatch for logical/physical Session budgets, preserve an executed TAP receipt and oversized copied output, refuse aggregate capacity before allocating a copy, and read absent historical sidecars without granting new admission. Forged peak claims refuse. A [test-only persistence observer](fixtures/experiments-session-resource-observer.mjs) confirms one actual durable observation and generation guard per completed or interrupted journal read, zero decoding for excessive physical files, one official decode before compressed logical-size refusal, and resource validation without a request cut followed by rejection of an appended durable watermark. Original sidecar bytes remain unchanged. The current Relay27 invocation observes twenty local synthetic HTTP calls, twenty-three official stream entries, fifteen actual Agents, nine protected actions, seven completed engineering turns and one completed matrix, with zero billed calls. Its three resource-refusal scenarios are included; two extra oversized Sessions and one empty/append Session are isolated synthetic persistence inputs, not Agent or completed-task counts. Overlapping calls and the earlier compression-fixture failure remain separate. Evidence belongs to `.build/dispatch/evidence/relay-27/`; old roots remain retained. [Resource semantics](../../desktop-host/src/experiments/README.md#isolated-engineering-task) distinguish physical length, logical snapshots and unqualified peaks. The separate [deadline fixture](fixtures/experiments-engineering-timeout.mjs) retains its earlier real 180-second qualification; this work does not rerun or upgrade that clock or the original analysis clock.

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-engineering-profile.built.e2e.ts --retry=0
```

The [engineering renderer fixture](fixtures/experiments-engineering-carrier.mjs) uses the retained physical Electron binary, production Main/sandboxed preload and complete isolated profile. Actual English/Chinese previews expose full resource limits and revoke edited previews with zero sends. Explicit confirmation completes one Agent/TAP task; the resource table separates drained lengths, null peaks and missing sides. Complete private input/log panes scroll without omitting bytes. Two explicitly confirmed rows then complete a sequential matrix, and selecting its original JSON file validates the retained report without replay. Future-version and altered-source report files refuse without replay. A synthetic lost response after a committed start retains its identity through renderer reload with no automatic read or restart; explicit cancellation drains it. Matrix cancellation retains its single drained round and never sends the next row. Reload reads of completed work require an explicit original identity; auxiliary closure preserves journals and creates no more work. This independent renderer invocation observes eight local synthetic HTTP/stream entries, five Agents, three protected TAP actions and one completed matrix, with zero billed calls. Its PNGs, requests and original results are retained under `.build/dispatch/evidence/relay-26/renderer/`. Installed qualification, hostile replacement, general model quality and complete disk/memory peaks remain unknown.

<a id="verification-task-request"></a>

## Single task request profile

The [task-only fixture](fixtures/experiments-task-profile.mjs) uses the same complete supported profile, fresh private home and native quota. It checks bilingual controls and cookie/origin rejection for all four task operations, prepares without sending and confirms one no-tool request from a complete official input cut. Its local synthetic SSE server independently observes four requests: completed, cancelled, failed and interrupted by Host process loss. Cancellation drains; failures do not retry or fail over. A cold Host reads unchanged completed bytes and an interrupted prepared cut without claiming a dispatch count or resending. The fixture also uses the actual Notebook owner, product cache hook and official finish metadata to check complete note capture, the Session routing key and provider response identifier; cold restart preserves both independent sidecars byte-for-byte. Current roots and wire inputs remain under `.build/dispatch/evidence/relay-24/full-profile/`; original Relay23 evidence is unchanged. No Agent, project action or billed provider is used. This Node-mode Host evidence does not qualify the renderer, exact model version, factor matrix, T11 task association or installation.

```sh
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts apps/desktop/tests/experiments-task-profile.built.e2e.ts --retry=0
```

<a id="verification-open"></a>

## Open verification

The following items are not passing evidence and must remain visible during review:

- Electron `capturePage()` captures individual windows. Windows interactive observations include composed dialogs and native menu selection, but cross-platform Figma/layout acceptance and a complete recording remain unverified. The automated workspace runner invokes the menu handler directly.
- The development launcher encounters a dangling optional Linux ARM64 dependency junction in this Windows checkout; the qualification runners link the existing dependency graph directly and do not validate that launcher's projection.
- The fixture does not execute an installer, overwrite an installed application, or establish that a new version starts successfully. Signed Windows and macOS installed-version qualification remains required for release.
- Two isolated Windows test installers pass signed-package inspection, including their embedded feed configuration. Installed startup, failure/retry, automatic restart, and data retention remain operator verification; file inspection does not certify a release.
- Live policy origins, gateway behavior, rate limits, approved page origins, and deployed policy configuration are pending backend integration. Local responses are not proof of a live service.
- Policy, updater feed, and updater download stalls reach their real deadlines and recover. Injected download-write `ENOSPC` is covered; actual volume exhaustion and installed-upgrade disk pressure remain unverified. Differential download and publisher rejection are verified through real Electron downloads, but not yet in a newly packaged application's installed-upgrade path.
- Native clipboard writing passes on Windows. Default-browser launch is attempted, but destination verification stops because the automation tool cannot reliably identify the current URL. macOS browser and clipboard integration remain unverified.
- Mandatory and ordinary failures use localized summaries and folded diagnostics; copy failure reveals a selectable address. Ordinary error tooltips show summaries rather than raw diagnostics. Installed Windows/macOS attention, notification permission, and focus-mode behavior remain unverified.
- Full `doc-sync` encounters Windows file-symlink `EPERM` in the documentation-site test. This is not an updater failure and does not make the full documentation gate green.
