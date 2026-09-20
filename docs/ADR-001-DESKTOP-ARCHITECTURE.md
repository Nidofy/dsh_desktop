# ADR-001 — Windows offline desktop wrapper

Date: 2026-09-20. Decision: **A_ARCHITECTURE_ACCEPTED**. Complete production-tree launch and native tool tests found no upstream hard stop. Final desktop/clean-image acceptance remains unproven.

## Investigation

Source checkouts are in `.investigation/` (not redistributed). Read source, not only README:

| Reference | Commit | Findings |
|---|---|---|
| [nekocode](https://github.com/nekocode/dsh-desktop) | a4c7f2f732457e06a11d851686095f9e3e27968d | `scripts/trim.ts`, `src-tauri/src/backend.rs`: trims providers/workflow; Bun uses compatibility shims; OS-assigned port and startup watchdog. Do not adopt trimming, patches, or updater. |
| [xingj404-lab](https://github.com/xingj404-lab/dsh-desktop) | facb4e15c4b0ce0dbc89ad0472eb8ba9759bcb29 | `src-tauri/src/backend.rs`: bundled Node/tree, free-port allocation, TCP readiness, process watcher. System-runtime fallback, repeated restart and updater are unsuitable here. |
| [kyorakuyk](https://github.com/kyorakuyk/dsh-desktop) | fcbed01e9d19f30200d3a60fefcba361690ce63b | `host/main.mjs`, `src-tauri/src/host.rs`: full npm package, in-process CLI import, port 0; missing-runtime PATH fallback and hard kill need improvement. |
| [fendouai](https://github.com/fendouai/deepseek-harness-desktop) | 2d1b5051599bd6aafd286f73493521b5d433fed4 | `apps/desktop/scripts/prepare-runtime.mjs`, `src-tauri/src/lib.rs`: official Node with checksum, production pnpm deploy, sidecar, readiness URL. Windows lifecycle/readiness require further work. |
| [Official DSH](https://github.com/deepseek-ai/deepseek-harness) | ddefc45fbc7f8e46dd73185e68295696d1297887 | Current main identifies as 0.1.6-alpha.2; npm release inspected separately: 0.1.5-rc.2. Do not assume current main exactly matches release. CLI, profile boot, provider, shell and plugin manager inspected. |

[Tauri Node sidecar guide](https://tauri.app/learn/sidecar-nodejs/) describes self-contained executables, target-suffixed externalBin and shell-plugin permissions. These are options, not requirements to compile DSH into one file. Rust can supervise a bundled executable without exposing shell IPC to a web page.

## Options

| Criterion (priority order) | A: official node.exe + full production tree | B: self-contained DSH executable |
|---|---|---|
| Upstream compatibility | Native package resolution; exact published CLI | Packaging may affect ESM, computed imports and profile resolution |
| Runtime reliability | Official Windows Node and installed Windows native addons | Must validate extraction, native addons and executable virtual filesystem |
| Offline deployment | Entire dependency closure copied at build time | Possible, but extra asset discovery required |
| Implementation simplicity | Ordinary absolute-path process launch | Separate compiler/packager and compatibility work |
| Maintenance | Lock npm tree and Node checksum; repeat smoke tests | Revalidate packager on each upstream release |
| Size | Larger; accepted for correctness | Potentially smaller; assets/addons may still be external |
| Plugins/dynamic loading | Preserves normal npm resolution for prebundled plugins | Often needs explicit tracing/asset rules |
| Native dependencies | Install on Windows x64 at build time | ABI and extraction paths require additional handling |
| Version update | Build a new offline ZIP, no runtime updater | Recompile sidecar and retest |
| Debugging | Original upstream JS and normal Node stacks | Bundling can obscure stacks/resources |

Choose **A**. No upstream source modification; no dependency trimming. Tauri 2 owns lifecycle, windows, connection bridge, logging and packaging only. Never implement agent, sessions, tools, workspace or chat UI.

## Intended implementation contract

- `DSHDesktop.exe` with `resources/runtime/node.exe` and `resources/dsh/node_modules/`.
- Absolute bundled Node path only; missing resource is a startup error. No PATH fallback.
- CLI `web --host 127.0.0.1 --port 0 --no-open`; parse announced loopback address, then HTTP readiness with deadline and process-exit checks.
- Windows Job Object terminates descendants if desktop crashes; normal shutdown requests upstream disposal before bounded forced cleanup. Spawn without console.
- User data under `%LOCALAPPDATA%/DSHDesktop`; single instance protects the shared profile.
- Main WebView loads original upstream HTTP UI. Only exact selected origin navigates internally; remote UI gets no Tauri IPC. Separate local shell window for settings/diagnostics with narrowly scoped commands.
- Prefer Windows Credential Manager and pass credential through child environment using upstream `apiKeyEnv`; nonsecret settings through native provider configuration. Verify against installed release.
- Native `llm-pi-ai` custom provider supports `api`, `baseURL`, `apiKeyEnv`, models. Chat Completions and Responses need separate compatibility testing; no provider patches.
- `DSH_TELEMETRY_DISABLED=1`; audit every enabled default network service. Built-in plugins are bundled. Installing new npm plugins at runtime is forbidden; do not equate an optional install action with a required startup dependency.
- Superseded in 0.1.2 after the Windows 10 target reported missing WebView2: ship the complete official x64 Fixed Version runtime, select it before Tauri initialization, and apply Microsoft's Windows 10 AppContainer RX requirements to that browser directory. No runtime installer, elevation or online bootstrap.

## Gates

The pinned release booted from a complete bundled tree, and native read/edit/pwsh tests passed under an ordinary user with no developer tools in PATH and a Node-level loopback network guard. A confirmed user-defined hard stop would produce `BLOCKER_REPORT.md` and halt implementation; none was established. Clean-image and GUI evidence is still required before final acceptance.

Investigation correction: npm 0.1.5-rc.2 exports `runCli` but invokes it only when `import.meta.main` is true. The older dynamic-import-only reference launcher is inert for this release. Use the published CLI as the actual Node entry, with a small `--import` lifecycle preload. No upstream source change is needed.
