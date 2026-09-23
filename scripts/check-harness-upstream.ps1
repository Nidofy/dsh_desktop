param(
    [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) '../deepseek-harness'),
    [switch]$Fetch
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pin = Get-Content -LiteralPath (Join-Path $root 'build-deps/harness-source.json') -Raw | ConvertFrom-Json
$source = (Resolve-Path -LiteralPath $SourcePath).Path
function Read-Git([string[]]$Arguments) {
    $value = & git -C $source @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $($Arguments[0])" }
    return $value
}
if ((Read-Git @('remote','get-url','origin')) -ne $pin.repository -or (Read-Git @('remote','get-url','upstream')) -ne $pin.upstream) { throw 'Fork/upstream remotes differ from source pin' }
if ($Fetch) {
    Read-Git @('fetch','upstream','--tags') | Out-Host
    Read-Git @('fetch','origin') | Out-Host
}
[ordered]@{
    source = $source
    checkedOut = Read-Git @('rev-parse','HEAD')
    pinnedCandidate = $pin.commit
    productionBaseline = $pin.baseline.commit
    upstream = Read-Git @('rev-parse','upstream/master')
    fork = Read-Git @('rev-parse','origin/master')
    candidateVsUpstream = Read-Git @('rev-list','--left-right','--count',($pin.commit + '...upstream/master'))
    dirty = [bool](Read-Git @('status','--porcelain'))
    recentTags = @(Read-Git @('tag','--list','dsh-v*','--sort=-version:refname') | Select-Object -First 8)
    changesSinceProduction = @(Read-Git @('diff','--stat',$pin.baseline.commit,$pin.commit,'--','apps/cli','apps/desktop','packages/boot','packages/core','packages/llm','packages/client','packages/session','packages/settings'))
} | ConvertTo-Json -Depth 4
