$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Get-ChildItem -LiteralPath (Join-Path $root 'runtime-src') -Filter '*.mjs' | Copy-Item -Destination (Join-Path $root 'runtime') -Force
& "$PSScriptRoot/verify-webview2.ps1" -RuntimePath (Join-Path $root 'runtime')
$dist=Join-Path $root 'dist'
$stage=Join-Path $dist 'DSHDesktop-win-x64-portable'
# A unique staging directory avoids deleting any previous deliverable.
if (Test-Path -LiteralPath $stage) { $stage += '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'runtime') -Destination (Join-Path $stage 'resources') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'README.md'),(Join-Path $root 'versions.json'),(Join-Path $root 'MVP_STATUS.json'),(Join-Path $root 'BLOCKER_REPORT.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination $stage -Recurse
& "$PSScriptRoot/set-folder-icon.ps1" -PackagePath $stage
& cargo metadata --locked --offline --format-version 1 --manifest-path (Join-Path $root 'src-tauri/Cargo.toml') --filter-platform x86_64-pc-windows-msvc | Out-File -LiteralPath (Join-Path $root '.build/cargo-metadata.json') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Rust license metadata failed' }
& (Join-Path $stage 'resources/runtime/node.exe') (Join-Path $root 'scripts/license-inventory.mjs') $stage
if ($LASTEXITCODE -ne 0) { throw 'License inventory failed' }
& "$PSScriptRoot/verify-offline.ps1" -PackagePath $stage
if ($LASTEXITCODE -ne 0) { throw 'Offline smoke failed; ZIP was not published' }
$zip=Join-Path $dist 'DSHDesktop-win-x64-portable.zip'
Compress-Archive -LiteralPath $stage -DestinationPath $zip -Force -CompressionLevel Optimal
& "$PSScriptRoot/set-folder-icon.ps1" -PackagePath $stage -ZipPath $zip
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'), "$hash  DSHDesktop-win-x64-portable.zip`n")
Get-Item -LiteralPath $zip | Select-Object FullName,Length
Write-Output "SHA256 $hash"
