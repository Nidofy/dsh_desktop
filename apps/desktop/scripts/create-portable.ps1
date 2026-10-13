param(
  [Parameter(Mandatory = $true)][string]$AppDirectory,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$taskSource = (Resolve-Path -LiteralPath $AppDirectory).Path
$taskTarget = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $taskTarget) { throw 'Portable destination already exists; choose a fresh directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'Nidofy DSH Desktop.exe'))) { throw 'Personal directory application is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'resources/app.asar'))) { throw 'Full application runtime is missing.' }
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw '.NET Framework compiler is unavailable.' }
New-Item -ItemType Directory -Path $taskTarget | Out-Null
Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskTarget 'app') -Recurse
& $taskCompiler /nologo /target:winexe /platform:anycpu /r:System.Windows.Forms.dll "/out:$(Join-Path $taskTarget 'Start DSH.exe')" (Join-Path $PSScriptRoot '../portable/Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Portable launcher compilation failed; directory retained.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../portable/README.txt') -Destination (Join-Path $taskTarget 'README.txt')
Compress-Archive -LiteralPath $taskTarget -DestinationPath ($taskTarget + '.zip') -CompressionLevel Optimal
Write-Output $taskTarget
Write-Output ($taskTarget + '.zip')
