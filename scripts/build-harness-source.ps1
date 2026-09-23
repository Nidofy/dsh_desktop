param(
    [string]$SourcePath = (Join-Path (Split-Path $PSScriptRoot -Parent) '../deepseek-harness'),
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = (Resolve-Path -LiteralPath $SourcePath).Path
$node = Join-Path $root 'runtime/runtime/node.exe'
$driver = Join-Path $PSScriptRoot 'harness-source.mjs'
$pin = Get-Content -LiteralPath (Join-Path $root 'build-deps/harness-source.json') -Raw | ConvertFrom-Json
& $node $driver inspect $source
if ($LASTEXITCODE -ne 0) { throw 'Harness source inspection failed' }
$runs = Join-Path $root '.build/harness-source'
New-Item -ItemType Directory -Force -Path $runs | Out-Null
$run = Join-Path $runs ($pin.commit.Substring(0,12) + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
& $node $driver begin $source $run
if ($LASTEXITCODE -ne 0) { throw 'Cannot record source build inputs' }
$oldPath = $env:PATH
$oldCi = $env:CI
$corepack = Join-Path (Split-Path (Get-Command corepack.cmd -ErrorAction Stop).Source -Parent) 'node_modules/corepack/dist/corepack.js'
if (!(Test-Path -LiteralPath $corepack)) { throw 'Corepack JS entry not found beside its Windows launcher' }
Push-Location -LiteralPath $source
try {
    $env:PATH = (Split-Path $node -Parent) + [IO.Path]::PathSeparator + $oldPath
    $env:CI = 'true'
    $actual = (& $node $corepack pnpm --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or ('pnpm@' + $actual) -ne $pin.packageManager) { throw 'Pinned pnpm unavailable through Corepack' }
    if (!$SkipInstall) {
        & $node $corepack pnpm install --frozen-lockfile --prod=false *> (Join-Path $run 'install.log')
        if ($LASTEXITCODE -ne 0) { throw "Source dependency install failed: $run/install.log" }
    }
    & $node $corepack pnpm run build:official *> (Join-Path $run 'build.log')
    if ($LASTEXITCODE -ne 0) { throw "Source build failed: $run/build.log" }
    # New, checked absolute directory only: pnpm deploy must not replace any existing output.
    $deploy = [IO.Path]::GetFullPath((Join-Path $run 'deploy-locked'))
    if (!$deploy.StartsWith($run + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $deploy)) { throw 'Unsafe deploy target' }
    # Shared-lockfile deploy derives a frozen consumer lock from the source lock.
    # Legacy + hoisted deployment resolves fresh versions and is not accepted here.
    & $node $corepack pnpm --filter '@deepseek-ai/dsh' deploy --prod --config.inject-workspace-packages=true --config.allow-unused-patches=true --config.node-linker=hoisted $deploy *> (Join-Path $run 'deploy.log')
    if ($LASTEXITCODE -ne 0) {
        $deployLog = Get-Content -LiteralPath (Join-Path $run 'deploy.log') -Raw
        if (!$deployLog.Contains('ERR_PNPM_IGNORED_BUILDS')) { throw "Source deploy failed: $run/deploy.log" }
        & $node $driver normalize-approval $source $run
        if ($LASTEXITCODE -ne 0) { throw 'Unreviewed deployment build script; inspect deploy.log' }
        & $node $corepack pnpm --dir $deploy rebuild '@deepseek-ai/dsh-subprocess-local' *> (Join-Path $run 'deploy-build.log')
        if ($LASTEXITCODE -ne 0) { throw 'Reviewed subprocess-local postinstall failed' }
        & $node $corepack pnpm --dir $deploy install --prod --frozen-lockfile --config.allow-unused-patches=true --config.node-linker=hoisted *> (Join-Path $run 'deploy-final.log')
        if ($LASTEXITCODE -ne 0) { throw 'Frozen deployment verification failed' }
    }
    & $node $driver complete-closure $source $run
    if ($LASTEXITCODE -ne 0) { throw 'Workspace runtime peer closure incomplete' }
    & $node $driver assemble $source $run
    if ($LASTEXITCODE -ne 0) { throw 'Source artifact assembly failed' }
    & $node $driver seal $source $run
    if ($LASTEXITCODE -ne 0) { throw 'Source smoke or artifact verification failed' }
    Write-Output "Source candidate: $run/artifact"
} finally {
    Pop-Location
    $env:PATH = $oldPath
    $env:CI = $oldCi
}
