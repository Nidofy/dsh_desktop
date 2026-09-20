param([string]$Root = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$v = Get-Content -LiteralPath (Join-Path $Root 'versions.json') -Raw | ConvertFrom-Json
$out = Join-Path $Root 'runtime/runtime'
New-Item -ItemType Directory -Force $out | Out-Null
$node = Join-Path $out 'node.exe'
if (!(Test-Path -LiteralPath $node) -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ne $v.nodeSha256) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$($v.node)/win-x64/node.exe" -OutFile $node
}
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ne $v.nodeSha256) { throw 'Official Node SHA256 mismatch' }
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/v$($v.node)/LICENSE" -OutFile (Join-Path $out 'LICENSE')
if ((& $node --version) -ne "v$($v.node)") { throw 'Node version mismatch' }
