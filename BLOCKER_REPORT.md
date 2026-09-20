# Acceptance blocker report

Status: **DSH_DESKTOP_MVP_BLOCKED** / **BLOCKED_BY_CLEAN_ENVIRONMENT_AND_GUI_VALIDATION**.

This is an acceptance-evidence blocker, not a discovered upstream incompatibility hard stop. The Windows x64 executable and portable ZIP exist and have passed the recorded automated tests. No upstream code was patched or functionality replaced.

## Observed behavior and evidence

- Original DSH UI HTTP assets, workspace/session, mock custom LLM, read/edit/pwsh, persistence, API failures, ordinary-user execution, exact localhost binding, second-instance behavior, backend crash reporting and forced-close cleanup passed. See docs/TEST_REPORT.md and docs/evidence/.
- Native GUI inspection initially timed out. Subsequent checks passed actual rendering, icons/backgrounds, welcome acknowledgement persistence and main-window close. Version 0.1.2 additionally verified the bundled WebView2 process, native Restart Engine and Quit with backend cleanup. Real connection-form saving, copy diagnostics and the full exit matrix remain unverified. See docs/TEST_REPORT.md.
- No clean corporate Windows image/VM is available in this task. PATH isolation and Node transport interception are useful partial evidence; they do not prove absent system installations, all native DLL prerequisites or WebView/OS-wide egress behavior.
- Windows logout/shutdown tests were not run on the user's working machine.
- Version 0.1.3 added and tested native basic connection saving, both protocol transports, multiple-model switching, close-to-tray and tray-click restore. Tray context-menu labels were inspected; automated selection of its Exit item was interrupted by changing desktop focus, so that specific click is not recorded as passed. The existing explicit quit handler and bounded cleanup remain unchanged.

## Root cause

The remaining blockers are the incomplete native interaction matrix and clean target-environment evidence. No requirement for elevation or mandatory runtime dependency installation was established. The initial restricted-token failure was specific to the nested Codex sandbox; the same default DSH sandbox succeeded under a normal non-admin token.

## Upstream behavior

The published CLI supports --host 127.0.0.1 --port 0 --no-open, authenticated launch URLs and the native pi-ai custom-provider configuration. New plugin installation is an explicit upstream pnpm action, not a required core launch path. Prebundled core plugins run without package managers.

## Possible options

1. Execute the remaining native settings/save/copy and exit matrix.
2. Supply the company's normal Windows image, or perform the documented matrix in a clean non-admin test VM with its public route blocked.
3. Version 0.1.2 now bundles official Fixed Version WebView2 for the reported Windows 10 target. Qualify the actual package on that image, including AppContainer RX setup in a user-owned directory; no preinstallation is required.

## Recommended next step

Use the supplied candidate ZIP for those acceptance checks. Keep the status blocked until their evidence is recorded; do not disable DSH's sandbox or substitute another Harness to obtain a passing label.
