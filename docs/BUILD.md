# Developer build

Build on Windows x64. Tested compiler: Rust 1.97.1 with Visual Studio 2026 MSVC. Put `cargo`/`rustc` on the developer PATH. Node/npm are build-time tools only. All direct versions are in `versions.json` and `src-tauri/Cargo.toml`; the complete npm/Cargo resolutions are committed in `build-deps/package-lock.json` and `src-tauri/Cargo.lock`.

```powershell
.\scripts\build-windows.ps1
# Reuse a previously verified staging tree:
.\scripts\build-windows.ps1 -ReusePreparedRuntime
```

Stages: verify build tools → pinned official Node → `npm ci --omit=dev` → pinned Microsoft WebView2 Fixed Version CAB (hash/signature/file inventory) → local icon/wallpaper conversion → release Rust tests → locked release build → copy full production and browser trees → collect original licenses → offline smoke → ZIP with folder icon metadata → SHA256.

Node and DSH dependencies are not installed at runtime. Do not copy a macOS/Linux node_modules tree into a Windows package. No tree pruning, bundling transform, upstream patch or package-manager executable is added by the wrapper. Package scripts operate only on build directories. Packaging never recursively deletes an old artifact directory.

Direct build:

```powershell
./scripts/fetch-webview2.ps1
node scripts/make-icon.mjs
cargo test --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
cargo build --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

`.cargo/config.toml` links the desktop CRT statically. The Node binary and upstream native npm dependencies retain their upstream build choices; clean-image DLL verification is still required.

Some restricted agent execution environments cannot create a second Windows restricted token. The native DSH shell smoke then reports Win32 87. Run the build/smoke under a normal **non-elevated** developer account outside the agent's nested sandbox. Do not change DSH to `danger-full-access` to pass tests. The working verification run had `AdministratorToken=False`.

`tests/runtime-smoke.mjs` uses the packaged node.exe, removes developer tools from child PATH, uses fresh Chinese/space/parenthesis paths, an HTTP mock, and a test-only network interception preload. It must never be represented as a firewall/VM or WebView-wide egress proof.

Changing DSH requires repeating the investigation, provider contract tests, complete production install, native tools test, network audit and clean-image acceptance. The new CLI guards `runCli()` with `import.meta.main`; an imported-only CLI is inert. The wrapper uses `node --import host.mjs <official-bin> web ...` so the official entry remains main.
