# Test report — Windows x64 candidate

Status: **DSH_DESKTOP_MVP_BLOCKED** (acceptance evidence incomplete, not a confirmed upstream hard stop).

Date: 2026-09-20. Windows 11 build 26200, ordinary non-elevated token (`AdministratorToken=False`). Installed system developer tools exist on this host; runtime smoke removes them from child PATH and uses the bundled Node. This is not a clean VM.

## Executed evidence

### 0.1.4 model context and output limits

See [context fix details](CONTEXT-0.1.4.md). Nine Rust tests passed. Both native protocol integration paths verified per-model context windows and output limits, bare GLM wire IDs, model switching and restart persistence. Browser settings checks used mock IPC; actual provider capacity and million-token requests were not tested.

### 0.1.3 protocols, models and tray

See [feature implementation and validation](FEATURES-0.1.3.md). Both protocol integration paths, multiple-model catalogs/selection, old configuration compatibility and native settings save/restart passed. The main-window close behavior is intentionally changed: it now hides to the tray and keeps the engine running. Clicking the tray icon restored the main window; earlier tests claiming main-window close exits refer only to versions before 0.1.3.

### 0.1.2 bundled WebView2 fix

- The reported `Could not find the WebView2 Runtime` came from the previous package's dependency on a system-installed browser runtime. Version 0.1.2 includes the complete official Fixed Version 153.0.4234.48 x64 tree (257 files), pinned CAB checksum, file inventory and Microsoft license.
- Six Rust release tests passed, including missing/UNC browser rejection and ordinary-user AppContainer read/execute permission setup. Windows 10 runs that permission setup before browser creation; the browser sandbox stays enabled.
- The desktop explicitly selects its bundled browser before Tauri initialization. Process inspection confirmed the actual `msedgewebview2.exe` under package resources, even with an invalid inherited browser path. Missing/corrupt browser fixtures failed with useful startup diagnostics instead of falling back to the installed browser. See `evidence/webview2-desktop.json`, `webview2-missing.json` and `webview2-corrupt.json`.
- Packaged native runtime smoke and all four negative API cases passed again. See `evidence/webview2-runtime.json` and `webview2-api-negative.json`.
- The final ZIP was extracted into a fresh directory. All 257 browser hashes matched; its actual desktop started in 5280 ms under an ordinary user, used the extracted bundled browser, listened only on loopback, rejected a second instance, reported a killed backend and cleaned up. See `evidence/webview2-extracted-desktop.json`.
- Native settings displayed the bundled version/path and retained the requested icon/background. Clicking Restart Engine produced a new backend PID/port and readiness after 4229 ms. Clicking Quit closed the backend job and desktop. See `evidence/webview2-fixed-diagnostics.png` and `webview2-gui.json`.
- These checks ran on Windows 11 build 26200 with a non-admin token. They do not constitute actual Windows 10 or clean corporate-image acceptance. No system browser was uninstalled or disabled.

### Earlier baseline and appearance checks

- Rust release builds succeeded with Tauri 2.11.5 / Rust 1.97.1.
- Four Rust release tests passed: strict readiness origin parsing, URL validation, real Windows Credential Manager round-trip/endpoint isolation, and Job Object cleanup of both backend and grandchild. The credential test uses an isolated test target and removes it afterward.
- Bundled official Node SHA256 matched the pinned official manifest.
- Full upstream DSH 0.1.5-rc.2 starts through its own CLI and serves authenticated native UI on an OS-assigned loopback port.
- Actual desktop launch logged backend readiness in 5308 ms (test PID 2960, port 54106). No launch token was written to desktop logs.
- Second desktop instance exited; force-terminating the owning desktop removed its backend (`BackendRemains=False`).
- Mock-driven native read/edit/pwsh, workspace/session, restart persistence and restricted-PATH/network smoke passed. Detailed run: `.build/smoke-中文 (space)-jvu3Cr/report.json` (local evidence, not runtime resource).
- The actual ZIP was extracted into a new directory. Its full runtime smoke passed, and its desktop started in 5451 ms with isolated LOCALAPPDATA, Windows-only PATH and a non-admin token. Listener enumeration confirmed only 127.0.0.1. A killed backend reached the supervisor error state while the desktop stayed alive; no backend remained after cleanup. Portable-process and extracted-runtime reports are preserved in [evidence](evidence/extracted-desktop.json).
- The final executable with intentionally missing resources reported a useful error and did not launch system Node; see [startup failure evidence](evidence/startup-failure.json).
- Native API negative tests passed: AUTH/401 (wrong key), TRANSPORT (unreachable endpoint), PI_AI_ERROR/404 (unknown model), TIMEOUT (1000 ms test stream-idle limit). Each was verified in persisted native `turn/end` error events while HTTP UI remained available. See [negative API evidence](evidence/api-negative.json).
- Earlier shell failure (`CreateRestrictedToken`, Win32 87) occurred only inside Codex's nested sandbox. The identical test passed outside that sandbox under the ordinary user, with DSH sandbox unchanged.
- Native GUI automation initially timed out. The 0.1.1 appearance update subsequently verified actual rendering, window/settings icons, transparent backgrounds, welcome acknowledgement persistence and main-window close with backend cleanup. See [appearance evidence](APPEARANCE.md). Full settings/save/restart/menu interactions remain unverified.

## Matrix

| Test | Result | Scope |
|---|---|---|
| T01 clean launch | PASS | Fresh isolated DSH profile; desktop starts |
| T02 second launch | PASS | Existing desktop retained, second process exits |
| T03 startup failure | PASS | Final executable reports missing runtime without system Node fallback; visual error controls unverified |
| T04 backend crash | PASS / BLOCKED | Final executable records error and remains alive; visual error controls unverified |
| T05 restart | PASS | Backend persistence test and 0.1.2 native Restart Engine button passed |
| T06 app exit | PASS / BLOCKED | 0.1.3 native close-to-tray and click-to-restore passed; explicit Quit retains the prior shutdown path; full exit matrix pending |
| T07 forced close | PASS | Owning desktop killed, Job Object removed backend |
| T10–T12 no Node/npm/pnpm in PATH | PASS | Bundled executable, Windows-only child PATH |
| T13 no administrator | PASS | Token explicitly checked false; native shell smoke passed |
| T14 no public internet | BLOCKED | Node-level loopback guard passed; clean VM/system-wide/WebView isolation not performed |
| T20 ASCII | PASS | Runtime/developer path |
| T21–T22 spaces/Chinese | PASS | Workspace and DSH home use Chinese, spaces, parentheses, hyphen and underscore |
| T23 long-ish path | PASS | Nested test workspace/session path; MAX_PATH boundary not claimed |
| T30 workspace | PASS | Native workspace/create |
| T31 session | PASS | Native session/create |
| T32 file read | PASS | Real read tool result observed by mock |
| T33 file edit | PASS | Real edit tool changed fixture on disk |
| T34 shell | PASS | Native pwsh wrote proof file with default upstream sandbox |
| T35 tool call | PASS | Mock streamed tool_calls; original Harness executed them |
| T36 persistence | PASS | Native session/list after backend restart |
| T40 valid Base URL | PASS | Original provider reached mock Chat Completions endpoint |
| T41 invalid Base URL | PASS | Rust validator rejects malformed URLs, embedded credentials and query/fragment |
| T42 invalid key | PASS | Native persisted AUTH error; Web service stays available |
| T43 unreachable API | PASS | Native persisted TRANSPORT error; Web service stays available |
| T44 model error | PASS | Native persisted HTTP 404 error; Web service stays available |
| T45 timeout | PASS | Native stream idle watchdog produces TIMEOUT; test config uses 1000 ms |
| T50 portable unzip/run | PASS | Actual ZIP extracted and tested on current non-admin host |
| T51 clean VM/user | BLOCKED | No clean target image available |
| T52 runtime install | PASS | No install path in launcher; package-manager-free PATH smoke |

## Acceptance gates

| Gates | Verdict |
|---|---|
| G1 build | PASS |
| G2 portable | PASS on current non-admin host after actual ZIP extraction |
| G4/G5/G6 absent system runtimes | BLOCKED on clean-image proof; restricted PATH passed |
| G3 non-admin, G7 no runtime install, G9 automatic backend, G10 loopback | PASS on current host |
| G8 public internet independence | BLOCKED on system-wide/VM proof |
| G11 native UI loaded | PASS: native conversation and settings rendering inspected |
| G12 workspace, G13 session, G14 read, G15 edit, G16 shell | PASS |
| G17–G20 connection | Native configuration + mock request passed; actual desktop form round-trip BLOCKED |
| G21 log secret absence | Controlled-metadata design and inspected startup logs passed; full credentialed desktop run pending |
| G22 graceful desktop quit | Earlier settings Quit passed; 0.1.3 close hides to tray; full taskbar/logout/shutdown matrix remains pending |
| G23 orphan cleanup | PASS for forced desktop close; logout/shutdown unverified |
| G24 restart, G25 diagnostics | Restart button and displayed bundled-browser diagnostics PASS; clipboard copy interaction unverified |

Skills, additional plugins and subagents remain bundled and unmodified; their presence in tool/plugin inventory is not an execution test. No passing execution claim is made for them.

## Remaining release gate

Qualify the actual ZIP under the company standard image with no developer runtimes and no public route, including native settings/credential round-trip, full workspace workflow, restart/crash UI, normal close/taskbar close/logout/shutdown and WebView egress. Check WebView2 provisioning and native dependency DLLs. Only then may the final acceptance status change.
