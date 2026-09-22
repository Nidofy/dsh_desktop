param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$package=(Resolve-Path -LiteralPath $PackagePath).Path
$node=Join-Path $package 'resources/runtime/node.exe'
& "$PSScriptRoot/verify-webview2.ps1" -RuntimePath (Join-Path $package 'resources')
foreach ($f in @('desktop-client/package.json','desktop-client/index.mjs','desktop-client/client.js','task-recovery.mjs','task-recovery-integration.mjs','task-recovery-page.mjs','desktop-notifications.mjs','cache-probe.mjs','cache-center.mjs','cache-page.mjs','change-review.mjs','change-review-integration.mjs','change-review-page.mjs','desktop-artifacts.mjs','artifacts-integration.mjs','artifacts-page.mjs')) {
    if (!(Test-Path -LiteralPath (Join-Path $package "resources/$f"))) { throw "Missing desktop resource: $f" }
}
foreach ($f in @('DSHDesktop.exe','resources/runtime/node.exe','resources/host.mjs','resources/desktop-network.mjs','resources/settings-sync.mjs','resources/model-defaults.mjs','resources/desktop-observability.mjs','resources/desktop-theme.mjs','resources/desktop-theme-assets.mjs','resources/project-actions.mjs','resources/project-actions-integration.mjs','resources/project-actions-page.mjs','resources/diagnostic-capture.mjs','resources/diagnostic-state.mjs','resources/diagnostic-page.mjs','resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')) {
    if (!(Test-Path -LiteralPath (Join-Path $package $f))) { throw "Missing portable resource: $f" }
}
$v=Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ne $v.nodeSha256) { throw 'Bundled Node checksum mismatch' }
& $node (Join-Path $root 'scripts/runtime-integrity.mjs') verify-package $package
if ($LASTEXITCODE -ne 0) { throw 'Complete portable file integrity failed' }
& $node (Join-Path $root 'tests/runtime-smoke.mjs') (Join-Path $package 'resources')
if ($LASTEXITCODE -ne 0) { throw 'Runtime offline smoke failed' }
& $node (Join-Path $root 'tests/api-negative.mjs') (Join-Path $package 'resources')
if ($LASTEXITCODE -ne 0) { throw 'Native API negative tests failed' }
Write-Output 'PASS: bundled runtime + restricted PATH + loopback-only test transport. Clean VM and WebView egress require separate acceptance evidence.'
