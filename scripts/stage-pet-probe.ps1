$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$target=Join-Path $root '.build/pet-window-probe'
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe') -Destination $target
Copy-Item -LiteralPath (Join-Path $root 'runtime') -Destination (Join-Path $target 'resources') -Recurse -Force
Write-Output $target
