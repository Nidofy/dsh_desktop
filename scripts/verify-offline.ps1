param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$package=(Resolve-Path -LiteralPath $PackagePath).Path
$node=Join-Path $package 'resources/runtime/node.exe'
& "$PSScriptRoot/verify-webview2.ps1" -RuntimePath (Join-Path $package 'resources')
foreach ($f in @('DSHDesktop.exe','resources/runtime/node.exe','resources/host.mjs','resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')) {
    if (!(Test-Path -LiteralPath (Join-Path $package $f))) { throw "Missing portable resource: $f" }
}
$v=Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ne $v.nodeSha256) { throw 'Bundled Node checksum mismatch' }
& $node (Join-Path $root 'tests/runtime-smoke.mjs') (Join-Path $package 'resources')
if ($LASTEXITCODE -ne 0) { throw 'Runtime offline smoke failed' }
& $node (Join-Path $root 'tests/api-negative.mjs') (Join-Path $package 'resources')
if ($LASTEXITCODE -ne 0) { throw 'Native API negative tests failed' }
Write-Output 'PASS: bundled runtime + restricted PATH + loopback-only test transport. Clean VM and WebView egress require separate acceptance evidence.'
