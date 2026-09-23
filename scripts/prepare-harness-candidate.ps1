param([Parameter(Mandatory=$true)][string]$ArtifactPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = Join-Path $root 'runtime/runtime/node.exe'
$driver = Join-Path $PSScriptRoot 'harness-source.mjs'
$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$candidates = Join-Path $root '.build/harness-candidates'
New-Item -ItemType Directory -Path $candidates -Force | Out-Null
$output = Join-Path $candidates ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
& $node $driver import $artifact $output
if ($LASTEXITCODE -ne 0) { throw 'Harness artifact import failed' }
$admission = & $node $driver admission $artifact
$admissionCode = $LASTEXITCODE
if ($admissionCode -ne 0 -and $admissionCode -ne 2) { throw 'Harness desktop admission check failed' }
$admission | Set-Content -LiteralPath (Join-Path $output 'desktop-admission.json') -Encoding utf8
Write-Output $admission
Write-Output "Imported runtime candidate: $output"
if ($admissionCode -eq 2) { Write-Output 'Desktop adapter migration is required; production runtime was not changed.' }
exit 0
