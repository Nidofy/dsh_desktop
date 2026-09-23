$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/source-runtime-staging.ps1')
$base = Join-Path (Split-Path $PSScriptRoot -Parent) ('.build/staging-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $base | Out-Null
function Fixture([string]$Name) {
    $root=Join-Path $base $Name; $prepared=Join-Path $root '.build/source-prepared-test'
    New-Item -ItemType Directory -Path (Join-Path $root 'runtime/dsh'),$prepared -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'runtime/host.mjs'),'old host')
    [IO.File]::WriteAllText((Join-Path $root 'runtime/dsh/marker'),'old dependencies')
    [IO.File]::WriteAllText((Join-Path $prepared 'host.mjs'),'new host')
    return @{root=$root;prepared=$prepared}
}
function Expect-Old($f) {
    if ([IO.File]::ReadAllText((Join-Path $f.root 'runtime/host.mjs')) -ne 'old host' -or [IO.File]::ReadAllText((Join-Path $f.root 'runtime/dsh/marker')) -ne 'old dependencies') { throw 'Old runtime changed' }
}
$f=Fixture 'success'; $result=Publish-SourceRuntime -Root $f.root -Prepared $f.prepared
if ($result.phase -ne 'complete' -or [IO.File]::ReadAllText((Join-Path $result.backup 'host.mjs')) -ne 'old host' -or [IO.File]::ReadAllText((Join-Path $f.root 'runtime/host.mjs')) -ne 'new host') { throw 'Whole runtime promotion failed' }
$f=Fixture 'rollback'; $failed=$false
try { Publish-SourceRuntime -Root $f.root -Prepared $f.prepared -AfterInstall { throw 'injected failure after rename' } | Out-Null } catch { if ($_ -notmatch 'injected failure') { throw }; $failed=$true }
if (!$failed) { throw 'Expected failure' }; Expect-Old $f
if ([IO.File]::ReadAllText((Join-Path $f.prepared 'host.mjs')) -ne 'new host') { throw 'Failed candidate was lost' }
if ((Get-Content (Join-Path $f.root '.build/source-transaction-*.json') -Raw | ConvertFrom-Json).phase -ne 'rolled-back') { throw 'Rollback receipt missing' }
$f=Fixture 'locked'; $lock=Join-Path $f.root '.build/source-staging.lock'; [IO.File]::WriteAllText($lock,'unknown owner')
$failed=$false; try { Publish-SourceRuntime -Root $f.root -Prepared $f.prepared | Out-Null } catch { $failed=$true }
if (!$failed -or [IO.File]::ReadAllText($lock) -ne 'unknown owner') { throw 'Unknown lock was changed' }; Expect-Old $f
$f=Fixture 'outside'; $failed=$false; try { Publish-SourceRuntime -Root $f.root -Prepared $base | Out-Null } catch { $failed=$true }
if (!$failed) { throw 'Outside path accepted' }; Expect-Old $f
$f=Fixture 'linked'; $linked=Join-Path $f.root '.build/source-prepared-link'
New-Item -ItemType Junction -Path $linked -Target $f.prepared | Out-Null
$failed=$false; try { Publish-SourceRuntime -Root $f.root -Prepared $linked | Out-Null } catch { $failed=$true }
if (!$failed) { throw 'Linked path accepted' }; Expect-Old $f
$f=Fixture 'missing'; $failed=$false
try { Publish-SourceRuntime -Root $f.root -Prepared (Join-Path $f.root '.build/source-prepared-missing') | Out-Null } catch { $failed=$true }
if (!$failed) { throw 'Missing prepared path accepted' }; Expect-Old $f
$f=Fixture 'recovery-conflict'; $failed=$false
try { Publish-SourceRuntime -Root $f.root -Prepared $f.prepared -AfterInstall { New-Item -ItemType Directory -Path $f.prepared | Out-Null; throw 'injected conflict' } | Out-Null } catch { if ($_ -notmatch 'rollback failed') { throw }; $failed=$true }
if (!$failed -or !(Test-Path -LiteralPath (Join-Path $f.root '.build/source-staging.lock'))) { throw 'Recovery conflict must retain lock' }
$record=Get-Content (Join-Path $f.root '.build/source-transaction-*.json') -Raw | ConvertFrom-Json
if ([IO.File]::ReadAllText((Join-Path $record.backup 'host.mjs')) -ne 'old host') { throw 'Backup lost on conflict' }
Write-Output "PASS source staging: 7 scenarios; complete backup, rollback after rename, failed candidate retained, unknown lock retained, outside/link/missing paths refused, recovery conflict retains lock and backup. Evidence: $base"
$helper=Join-Path $base 'crash-publisher.ps1'
@'
param($Module,$Root,$Prepared,$Phase)
$ErrorActionPreference='Stop'
. $Module
Publish-SourceRuntime -Root $Root -Prepared $Prepared -AfterPhase {param($Point) if ($Point -eq $Phase) { Stop-Process -Id $PID -Force }}
'@ | Set-Content -LiteralPath $helper -Encoding utf8
$shell=(Get-Process -Id $PID).Path
foreach ($phase in @('prepared','old-renamed','new-renamed','complete')) {
    $f=Fixture ('crash-'+$phase)
    $arguments=@('-NoProfile','-File',('"'+$helper+'"'),('"'+[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/source-runtime-staging.ps1'))+'"'),('"'+$f.root+'"'),('"'+$f.prepared+'"'),$phase)
    $child=Start-Process -FilePath $shell -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (!$child.WaitForExit(30000)) {throw 'Crash fixture did not finish'}
    if (!(Restore-SourceRuntime -Root $f.root)) {throw 'Crash recovery did not run'}
    if ($phase -eq 'complete') {if ([IO.File]::ReadAllText((Join-Path $f.root 'runtime/host.mjs')) -ne 'new host') {throw 'Committed runtime lost'}} else {Expect-Old $f}
    if (Restore-SourceRuntime -Root $f.root) {throw 'Recovery was not idempotent'}
}
$f=Fixture 'crash-conflict'
$child=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-File',('"'+$helper+'"'),('"'+[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/source-runtime-staging.ps1'))+'"'),('"'+$f.root+'"'),('"'+$f.prepared+'"'),'new-renamed') -WindowStyle Hidden -PassThru
if (!$child.WaitForExit(30000)) {throw 'Crash conflict fixture did not finish'}
[IO.File]::WriteAllText((Join-Path $f.root 'runtime/host.mjs'),'external modification')
$failed=$false;try {Restore-SourceRuntime -Root $f.root | Out-Null} catch {$failed=$true}
if (!$failed -or !(Test-Path -LiteralPath (Join-Path $f.root '.build/source-staging.lock')) -or [IO.File]::ReadAllText((Join-Path $f.root 'runtime/host.mjs')) -ne 'external modification') {throw 'Conflicted crash state changed'}
Write-Output 'PASS 5 forced-termination scenarios: pre-move, both rename gaps, completed publication, and changed-tree refusal; known lock recovered only after owner exit and full inventory match.'
