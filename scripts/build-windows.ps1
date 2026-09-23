param([switch]$ReusePreparedRuntime, [switch]$SkipPackage, [string]$HarnessSourceArtifact)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if (![Environment]::Is64BitOperatingSystem) { throw 'Windows x64 build host required' }
if ($HarnessSourceArtifact) {
    if ($ReusePreparedRuntime) { throw 'Source artifact and reused runtime cannot be selected together' }
    & (Join-Path $root 'runtime/runtime/node.exe') scripts/harness-source.mjs admission $HarnessSourceArtifact
    if ($LASTEXITCODE -ne 0) { throw 'Source candidate requires desktop adapter qualification before integration' }
}
foreach ($tool in @('cargo','rustc','node','npm.cmd')) { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Build tool missing: $tool (developer machine only)" } }
if (!$ReusePreparedRuntime) { & "$PSScriptRoot/fetch-runtime.ps1"; & "$PSScriptRoot/prepare-dsh.ps1" -HarnessSourceArtifact $HarnessSourceArtifact }
& "$PSScriptRoot/fetch-webview2.ps1" -Offline:$ReusePreparedRuntime
& (Join-Path $root 'runtime/runtime/node.exe') scripts/generate-provider-catalog.mjs
if ($LASTEXITCODE -ne 0) { throw 'Provider catalog generation failed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/sync-desktop-theme.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop theme synchronization failed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/sync-desktop-runtime.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop runtime synchronization failed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/runtime-integrity.mjs create-runtime
if ($LASTEXITCODE -ne 0) { throw 'Runtime integrity baseline failed; prepare dependencies again if the dependency tree changed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/make-icon.mjs
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs begin
if ($LASTEXITCODE -ne 0) { throw 'Cannot capture release build inputs' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/release-receipt.mjs
if ($LASTEXITCODE -ne 0) { throw 'Release build provenance contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/runtime-integrity.mjs
if ($LASTEXITCODE -ne 0) { throw 'Runtime integrity contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/runtime-module-sync.mjs
if ($LASTEXITCODE -ne 0) { throw 'Runtime module staging contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') --test tests/harness-source.mjs
if ($LASTEXITCODE -ne 0) { throw 'Harness source artifact contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') --test tests/harness-adapter.mjs
if ($LASTEXITCODE -ne 0) { throw 'Harness versioned adapter contracts failed' }
& "$PSScriptRoot/../tests/source-runtime-staging.ps1"
$verificationShell = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/distribution-verifier.mjs (Join-Path $PSHOME $verificationShell)
if ($LASTEXITCODE -ne 0) { throw 'Standalone distribution verifier contracts failed' }
& "$PSScriptRoot/../tests/archive-integrity.ps1"
& (Join-Path $root 'runtime/runtime/node.exe') tests/settings-sync.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native settings synchronization tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/settings-transaction.mjs
if ($LASTEXITCODE -ne 0) { throw 'Settings transaction recovery tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/model-defaults.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop model selection migration failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/workspace-migration.mjs
if ($LASTEXITCODE -ne 0) { throw 'Shared workspace history migration failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/workspace-recovery-wire.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native duplicate workspace recovery failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/startup-errors.mjs
if ($LASTEXITCODE -ne 0) { throw 'Startup error classification failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/vision-provider.mjs
if ($LASTEXITCODE -ne 0) { throw 'Vision protocol contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability.mjs
if ($LASTEXITCODE -ne 0) { throw 'Observability unit tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/experiments.mjs
if ($LASTEXITCODE -ne 0) { throw 'Experiment tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/project-actions.mjs
if ($LASTEXITCODE -ne 0) { throw 'Project Actions tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-theme.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop appearance tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/task-recovery.mjs
if ($LASTEXITCODE -ne 0) { throw 'Task recovery projection tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-health.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop core readiness contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') --test tests/desktop-control.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop switch control and pet drag contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/storage-admission.mjs
if ($LASTEXITCODE -ne 0) { throw 'Shared storage admission and completion persistence failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/task-snapshot-bridge.mjs
if ($LASTEXITCODE -ne 0) { throw 'Task snapshot private pipe and admission contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-notifications.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop notification tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') --test tests/pet-animation.test.mjs tests/pet-state.test.mjs tests/pet-interaction.test.mjs tests/pet-extension.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Pet regression failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/pet-settings-ui.mjs
if ($LASTEXITCODE -ne 0) { throw 'Pet settings UI contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/pet-packages.mjs
if ($LASTEXITCODE -ne 0) { throw 'Pet package validation failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/pet-package-manager.mjs
if ($LASTEXITCODE -ne 0) { throw 'Pet package lifecycle failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-client.mjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop navigation tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-workspace.mjs
if ($LASTEXITCODE -ne 0) { throw 'Workspace environment panel tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/environment-repository.mjs
if ($LASTEXITCODE -ne 0) { throw 'Environment Git operations failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/cache-probe.mjs
if ($LASTEXITCODE -ne 0) { throw 'Cache probe tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/cache-center.mjs
if ($LASTEXITCODE -ne 0) { throw 'Cache center contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-cache-key.mjs
if ($LASTEXITCODE -ne 0) { throw 'Independent cache key adapter contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/prefix-regression.mjs
if ($LASTEXITCODE -ne 0) { throw 'Cache prefix classification contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/self-test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Self-test lifecycle and privacy contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/change-review.mjs --hg
if ($LASTEXITCODE -ne 0) { throw 'Change review contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/change-draft.mjs
if ($LASTEXITCODE -ne 0) { throw 'Selected diff draft contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/desktop-artifacts.mjs
if ($LASTEXITCODE -ne 0) { throw 'Artifact file contracts failed' }
& cargo test --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/provider-presets.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native known-provider catalog failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/known-provider-switch.mjs
if ($LASTEXITCODE -ne 0) { throw 'Known-provider session continuity failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/known-provider-switch.mjs --managed-cache-key
if ($LASTEXITCODE -ne 0) { throw 'Known-provider managed cache key regression failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/profile-network.mjs
if ($LASTEXITCODE -ne 0) { throw 'Profile network tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/protocol-models.mjs
if ($LASTEXITCODE -ne 0) { throw 'Protocol and multi-model integration tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability-wire.mjs runtime --vision-only
if ($LASTEXITCODE -ne 0) { throw 'Native vision tool integration failed' }
& cargo test --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc automatic_snapshots_real_dsh_wire -- --ignored --nocapture --test-threads=1
if ($LASTEXITCODE -ne 0) { throw 'Native task snapshot lifecycle tests failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/prefix-regression-wire.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native cache prefix regression failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability-wire.mjs runtime --self-test-only
if ($LASTEXITCODE -ne 0) { throw 'Native self-test center contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability-wire.mjs runtime --self-test-only --self-test-vcs
if ($LASTEXITCODE -ne 0) { throw 'Native self-tests with real Git and Mercurial failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability-wire.mjs runtime --cache-key-only
if ($LASTEXITCODE -ne 0) { throw 'Native independent cache key wire contracts failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/observability-wire.mjs
if ($LASTEXITCODE -ne 0) { throw 'Observability wire regression failed' }
& (Join-Path $root 'runtime/runtime/node.exe') tests/change-review-wire.mjs
if ($LASTEXITCODE -ne 0) { throw 'Native change review admission tests failed' }
& cargo build --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/runtime-integrity.mjs verify-runtime
if ($LASTEXITCODE -ne 0) { throw 'Runtime changed during build verification' }
& (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs complete
if ($LASTEXITCODE -ne 0) { throw 'Build inputs changed; complete gate must be rerun before packaging' }
if (!$SkipPackage) { & "$PSScriptRoot/package-portable.ps1" }
