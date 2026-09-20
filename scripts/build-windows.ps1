param([switch]$ReusePreparedRuntime)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if (![Environment]::Is64BitOperatingSystem) { throw 'Windows x64 build host required' }
foreach ($tool in @('cargo','rustc','node','npm.cmd')) { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Build tool missing: $tool (developer machine only)" } }
if (!$ReusePreparedRuntime) { & "$PSScriptRoot/fetch-runtime.ps1"; & "$PSScriptRoot/prepare-dsh.ps1" }
& "$PSScriptRoot/fetch-webview2.ps1" -Offline:$ReusePreparedRuntime
& node scripts/make-icon.mjs
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed' }
& cargo test --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
& cargo build --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
& "$PSScriptRoot/package-portable.ps1"
