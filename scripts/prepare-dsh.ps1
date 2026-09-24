param([string]$Root = (Split-Path $PSScriptRoot -Parent), [string]$HarnessSourceArtifact)
$ErrorActionPreference = 'Stop'
$buildVersions=Get-Content -LiteralPath (Join-Path $Root 'versions.json') -Raw | ConvertFrom-Json
if ($buildVersions.dsh -eq '0.1.7-alpha.2' -and !$HarnessSourceArtifact) { throw 'Source build requires -HarnessSourceArtifact; registry preparation is not allowed' }
$out = Join-Path $Root 'runtime/dsh'
if ($HarnessSourceArtifact) {
    . (Join-Path $PSScriptRoot 'source-runtime-staging.ps1')
    $null = Restore-SourceRuntime -Root $Root
    $node = Join-Path $Root 'runtime/runtime/node.exe'
    & $node (Join-Path $PSScriptRoot 'harness-source.mjs') admission $HarnessSourceArtifact
    if ($LASTEXITCODE -ne 0) { throw 'Source artifact does not match approved desktop combination' }
    $prepared = Join-Path $Root ('.build/source-prepared-' + [Guid]::NewGuid().ToString('N'))
    $null = Assert-SourceStagePath $Root $prepared
    $runtime = Assert-SourceStagePath $Root (Join-Path $Root 'runtime')
    # Check the old tree against its own sealed manifest, not the new build's
    # version selection. Unknown old files must not enter a newly sealed baseline.
    $integrityModule = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../runtime-src/runtime-integrity.mjs'))
    & $node --input-type=module -e "import {pathToFileURL} from 'node:url'; const {verifyRuntime}=await import(pathToFileURL(process.argv[1])); await verifyRuntime(process.argv[2]);" $integrityModule $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Previous runtime integrity failed; source staging was not changed' }
    & $node (Join-Path $PSScriptRoot 'harness-source.mjs') import $HarnessSourceArtifact $prepared
    if ($LASTEXITCODE -ne 0) { throw 'Source artifact staging failed' }
    # Source import owns these three entries. Preserve the pinned Node/WebView and
    # remaining resources in a separate tree; synchronization cannot modify old staging.
    foreach ($entry in Get-ChildItem -LiteralPath $runtime -Force) {
        if ($entry.Name -in @('dsh','dsh-integrity.json','harness-source-artifact.json','runtime-integrity.json')) { continue }
        $null = Assert-SourceStagePath $Root $entry.FullName
        Copy-Item -LiteralPath $entry.FullName -Destination $prepared -Recurse -ErrorAction Stop
    }
    & $node (Join-Path $PSScriptRoot 'sync-desktop-runtime.mjs') $prepared
    if ($LASTEXITCODE -ne 0) { throw "Desktop synchronization failed in $prepared; previous runtime unchanged" }
    & $node (Join-Path $PSScriptRoot 'runtime-integrity.mjs') create-runtime $prepared
    if ($LASTEXITCODE -ne 0) { throw "Source runtime verification failed in $prepared; previous runtime unchanged" }
    $result = Publish-SourceRuntime -Root $Root -Prepared $prepared
    $env:LEGACY_TEST_RUNTIME=$result.backup
    Write-Output "Source runtime staged; complete previous runtime retained at $($result.backup)"
    return
}
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'build-deps/package.json'),(Join-Path $Root 'build-deps/package-lock.json') -Destination $out -Force
# Developer/build environment only. Never included as a runtime launch step.
& npm.cmd ci --prefix $out --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org --cache (Join-Path $Root '.build/npm-cache')
if ($LASTEXITCODE -ne 0) { throw 'Pinned DSH production installation failed' }
& (Join-Path $Root 'runtime/runtime/node.exe') (Join-Path $PSScriptRoot 'runtime-integrity.mjs') create-dsh (Join-Path $Root 'runtime')
if ($LASTEXITCODE -ne 0) { throw 'DSH dependency integrity baseline failed' }
& (Join-Path $Root 'runtime/runtime/node.exe') (Join-Path $PSScriptRoot 'sync-desktop-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop runtime synchronization failed' }
$v = Get-Content -LiteralPath (Join-Path $Root 'versions.json') -Raw | ConvertFrom-Json
$actual = Get-Content -LiteralPath (Join-Path $out 'node_modules/@deepseek-ai/dsh/package.json') -Raw | ConvertFrom-Json
if ($actual.version -ne $v.dsh) { throw 'DSH version mismatch' }
