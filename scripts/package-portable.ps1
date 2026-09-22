param([switch]$SkipArchive)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
& (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'No current complete build receipt; run build-windows.ps1 first' }
# Packaging consumes the already-built runtime; it must not silently rebaseline
# dependency modifications or resynchronize source files after the build gate.
& (Join-Path $root 'runtime/runtime/node.exe') (Join-Path $PSScriptRoot 'runtime-integrity.mjs') verify-runtime (Join-Path $root 'runtime')
if ($LASTEXITCODE -ne 0) { throw 'Built runtime integrity failed; rebuild before packaging' }
& "$PSScriptRoot/verify-webview2.ps1" -RuntimePath (Join-Path $root 'runtime')
$dist=Join-Path $root 'dist'
$desktopVersion=(Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json).desktop
$stage=Join-Path $dist $(if ($SkipArchive) { "DSHDesktop-$desktopVersion-win-x64" } else { 'DSHDesktop-win-x64-portable' })
# A unique staging directory avoids deleting any previous deliverable.
if (Test-Path -LiteralPath $stage) { $stage += '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8) }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'runtime') -Destination (Join-Path $stage 'resources') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'README.md'),(Join-Path $root 'versions.json'),(Join-Path $root 'MVP_STATUS.json'),(Join-Path $root 'BLOCKER_REPORT.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root '.build/release-build-receipt.json') -Destination (Join-Path $stage 'BUILD_RECEIPT.json')
& "$PSScriptRoot/set-folder-icon.ps1" -PackagePath $stage
& cargo metadata --locked --offline --format-version 1 --manifest-path (Join-Path $root 'src-tauri/Cargo.toml') --filter-platform x86_64-pc-windows-msvc | Out-File -LiteralPath (Join-Path $root '.build/cargo-metadata.json') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Rust license metadata failed' }
& (Join-Path $stage 'resources/runtime/node.exe') (Join-Path $root 'scripts/license-inventory.mjs') $stage
if ($LASTEXITCODE -ne 0) { throw 'License inventory failed' }
Copy-Item -LiteralPath (Join-Path $root 'scripts/verify-distribution.ps1') -Destination (Join-Path $stage 'Verify-DSHDesktop.ps1')
& (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'Build inputs or outputs changed while staging the package' }
$receipt=Get-Content -LiteralPath (Join-Path $stage 'BUILD_RECEIPT.json') -Raw | ConvertFrom-Json
$builtExe=@($receipt.outputs | Where-Object { $_.path -ceq 'src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe' })
if ($builtExe.Count -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $stage 'DSHDesktop.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $builtExe[0].sha256) { throw 'Staged executable does not match the tested build' }
& (Join-Path $stage 'resources/runtime/node.exe') (Join-Path $root 'scripts/runtime-integrity.mjs') create-package $stage
if ($LASTEXITCODE -ne 0) { throw 'Package file manifest failed' }
& "$PSScriptRoot/verify-offline.ps1" -PackagePath $stage
if ($LASTEXITCODE -ne 0) { throw 'Offline smoke failed; ZIP was not published' }
if ($SkipArchive) {
    & (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs verify
    if ($LASTEXITCODE -ne 0) { throw 'Build changed before directory publication' }
    & (Join-Path $stage 'resources/runtime/node.exe') (Join-Path $root 'scripts/runtime-integrity.mjs') verify-package $stage
    if ($LASTEXITCODE -ne 0) { throw 'Staged directory integrity failed' }
    $result=[ordered]@{schemaVersion=1;status='PASS';desktopVersion=$desktopVersion;buildId=$receipt.id;directory=$stage;archiveCreated=$false}
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.build/latest-staged-package.json') -Encoding utf8
    $result | ConvertTo-Json
    return
}
$desktopVersion=(Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json).desktop
$zipName="DSHDesktop-$desktopVersion-win-x64-portable.zip"
$zip=Join-Path $dist $zipName
if (Test-Path -LiteralPath $zip) { $zipName="DSHDesktop-$desktopVersion-win-x64-portable-"+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)+'.zip';$zip=Join-Path $dist $zipName }
$candidate=Join-Path $dist ('.candidate-'+[Guid]::NewGuid().ToString('N')+'.zip')
Compress-Archive -LiteralPath $stage -DestinationPath $candidate -CompressionLevel Optimal
& "$PSScriptRoot/set-folder-icon.ps1" -PackagePath $stage -ZipPath $candidate
& "$PSScriptRoot/verify-archive.ps1" -PackagePath $stage -ZipPath $candidate
& (Join-Path $root 'runtime/runtime/node.exe') scripts/release-receipt.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'Build changed before archive publication; candidate ZIP remains unpublished' }
# Hash publication occurs only after verifying actual compressed contents.
[IO.File]::Move($candidate,$zip)
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'), "$hash  $zipName`n")
[IO.File]::WriteAllText(($zip+'.sha256'), "$hash  $zipName`n")
Get-Item -LiteralPath $zip | Select-Object FullName,Length
Write-Output "SHA256 $hash"
