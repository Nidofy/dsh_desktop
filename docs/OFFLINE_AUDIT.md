# Offline audit — 0.1.2 candidate

## Inspected surfaces

Official DSH npm 0.1.5-rc.2, full Windows production tree, bundled Node 24.16.0. Also inspected current upstream/source and four reference projects; commit identities are in ADR-001. Published-package behavior takes precedence over current-main documentation.

| Surface | Finding / treatment |
|---|---|
| Desktop update checks | No updater dependency, no GitHub polling, no remote manifest |
| Node installation | Downloaded and hash-checked at build time; absolute resource path required |
| WebView2 deployment | Complete Fixed Version 153.0.4234.48 bundled; no runtime installer/download or Evergreen lookup. Windows 10 sets AppContainer RX on the browser directory only |
| DSH dependency install | `npm ci` build-only; runtime only invokes official CLI |
| Profile bootstrap | Creates user configuration and module links from the installed dependency tree; no startup package install observed |
| Telemetry | Official base enables a telemetry plugin; `DSH_TELEMETRY_DISABLED=1` plus a native disabled-row overlay opts out |
| Model providers | Native pi-ai custom provider; `apiKeyEnv` reference; no model/agent code patch |
| Default credentials | Desktop isolates DSH_HOME/default cwd and removes inherited DEEPSEEK_API_KEY/BASE_URL |
| UI assets | HTTP smoke verifies local JS/CSS entry assets; full tree preserved. No required public CDN identified in inspected startup path |
| Plugin operations | Upstream explicit plugin install/lookup can invoke pnpm. Not required for startup/core tests, not supported for new packages in offline V1. No package manager is supplied by the launcher |
| Tools/MCP | Their user-requested network operations are outside the idle/startup proof |
| OAuth/sign-in | Not used by the desktop connection bridge; external provider sign-in is an upstream explicit action |
| WebView navigation | Exact engine origin only; remote UI has no desktop capability. Popup HTTP(S) links go to system browser; non-HTTP schemes denied; downloads denied |
| WebView/Windows network | Fixed Version does not self-update; other browser/Windows network behavior is not packet-captured or firewall-isolated |

## Executed proof

`tests/offline-guard.mjs` is loaded only in tests: non-loopback DNS/TCP is rejected and package-manager process launches are rejected. Child PATH contains only Windows and System32. The mock API is loopback. Native UI serving, workspace/session, read/edit/pwsh and persistence succeeded with the guard, under a non-admin token outside Codex's nested sandbox.

This instrumentation does not cover raw native socket calls, WebView traffic, or all grandchildren. It is **not equivalent to a disconnected clean VM or system firewall**. The final G8/T14 gate remains blocked on that evidence. No firewall/DNS/system-security configuration was changed.

## Secrets and content

Desktop stores its API key in Windows Credential Manager and passes it only in the backend environment. DSH/agent shells run as the same user and may access their environment; this is not a boundary against the user's own agent tools. The wrapper logs controlled metadata only and drops arbitrary upstream stdout/stderr text, preventing arbitrary prompts/source/provider errors from entering desktop logs. Startup URL tokens are never persisted in those logs.

The native DSH credentials/settings UI remains original. If a user chooses to store another credential through that UI, upstream `.credentials.yaml` is a user-scoped plaintext store; that separate upstream fallback is not Windows Credential Manager and should be treated accordingly. Diagnostics do not read it.

No upstream patches were applied. The JSON overlay uses DSH's supported configuration layering; it is not a source patch.
