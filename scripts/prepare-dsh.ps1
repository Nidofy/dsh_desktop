param([string]$Root = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$out = Join-Path $Root 'runtime/dsh'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'build-deps/package.json'),(Join-Path $Root 'build-deps/package-lock.json') -Destination $out -Force
# Developer/build environment only. Never included as a runtime launch step.
& npm.cmd ci --prefix $out --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org --cache (Join-Path $Root '.build/npm-cache')
if ($LASTEXITCODE -ne 0) { throw 'Pinned DSH production installation failed' }
Get-ChildItem -LiteralPath (Join-Path $Root 'runtime-src') -Filter '*.mjs' | Copy-Item -Destination (Join-Path $Root 'runtime') -Force
$v = Get-Content -LiteralPath (Join-Path $Root 'versions.json') -Raw | ConvertFrom-Json
$actual = Get-Content -LiteralPath (Join-Path $out 'node_modules/@deepseek-ai/dsh/package.json') -Raw | ConvertFrom-Json
if ($actual.version -ne $v.dsh) { throw 'DSH version mismatch' }
