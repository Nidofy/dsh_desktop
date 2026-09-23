# The caller fully verifies Prepared before promotion. Never merge into Runtime.
function Assert-SourceStagePath {
    param([string]$Root, [string]$Path)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    $target = [IO.Path]::GetFullPath($Path)
    if (!$target.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe source staging path' }
    $cursor = $target
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source staging path is a link' }
        $parent = Split-Path $cursor -Parent
        if (!$parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $target
}

function Write-SourceStageRecord($Path,$Record) {
    $temporary=$Path+'.new'
    if ((Test-Path -LiteralPath $temporary) -and ((Get-Item -LiteralPath $temporary -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Linked staging journal refused'}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Depth 8))
    $file=[IO.File]::Open($temporary,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
    if (Test-Path -LiteralPath $Path) {[IO.File]::Replace($temporary,$Path,[NullString]::Value)} else {[IO.File]::Move($temporary,$Path)}
}
function Get-SourceStageFingerprint([string]$Root,[string]$Path) {
    $path=Assert-SourceStagePath $Root $Path
    if (!(Test-Path -LiteralPath $path)) {return $null}
    $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($path)
    $rows=[Collections.Generic.List[string]]::new();$count=0
    while ($pending.Count) {
        $dir=$pending.Pop()
        foreach ($entry in Get-ChildItem -LiteralPath $dir -Force) {
            $null=Assert-SourceStagePath $Root $entry.FullName
            if (++$count -gt 500000) {throw 'Source staging inventory too large'}
            $relative=$entry.FullName.Substring($path.Length)
            if ($entry.PSIsContainer) {$rows.Add('D '+$relative);$pending.Push($entry.FullName)}
            else {$rows.Add('F '+$relative+' '+(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash)}
        }
    }
    $hash=[Security.Cryptography.SHA256]::Create()
    try {return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes((($rows | Sort-Object -CaseSensitive) -join "`n")))).Replace('-','')} finally {$hash.Dispose()}
}
function Restore-SourceRuntime {
    param([string]$Root)
    $build=Assert-SourceStagePath $Root (Join-Path $Root '.build')
    $lockPath=Assert-SourceStagePath $Root (Join-Path $build 'source-staging.lock')
    if (!(Test-Path -LiteralPath $lockPath)) {return $false}
    # Exclusive open proves no publisher still holds this lock. Unknown content,
    # a live recorded process, or any inventory mismatch stops recovery.
    $lock=[IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $remove=$false
    try {
        if ($lock.Length -gt 4096) {throw 'Unknown staging lock'}
        $bytes=[byte[]]::new($lock.Length);$null=$lock.Read($bytes,0,$bytes.Length)
        $journal=[Text.Encoding]::UTF8.GetString($bytes)
        $null=Assert-SourceStagePath $Root $journal
        if ((Split-Path $journal -Parent) -ne $build -or (Split-Path $journal -Leaf) -notmatch '^source-transaction-[a-f0-9]{32}\.json$') {throw 'Unknown staging lock'}
        if ((Get-Item -LiteralPath $journal).Length -gt 16384) {throw 'Staging record too large'}
        $record=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
        if ($record.schemaVersion -ne 2 -or $record.id -notmatch '^[a-f0-9]{32}$' -or $journal -ne (Join-Path $build "source-transaction-$($record.id).json")) {throw 'Unknown staging record'}
        if ($record.phase -notin @('prepared','previous-retained','complete','rolled-back')) {throw 'Unknown staging phase'}
        if ($record.pid -le 0) {throw 'Staging owner identity missing'}
        $alive=$true
        try {$null=Get-Process -Id $record.pid -ErrorAction Stop} catch {
            if ($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId,*') {throw}
            $alive=$false
        }
        if ($alive) {throw 'Staging owner may still be running'}
        $runtime=Assert-SourceStagePath $Root $record.runtime;$prepared=Assert-SourceStagePath $Root $record.prepared;$backup=Assert-SourceStagePath $Root $record.backup
        if ($runtime -ne (Join-Path ([IO.Path]::GetFullPath($Root)) 'runtime') -or $backup -ne (Join-Path $build "source-previous-$($record.id)") -or (Split-Path $prepared -Parent) -ne $build -or (Split-Path $prepared -Leaf) -notlike 'source-prepared-*') {throw 'Staging record path mismatch'}
        if ($record.newHash -notmatch '^[A-F0-9]{64}$' -or ($null -ne $record.oldHash -and $record.oldHash -notmatch '^[A-F0-9]{64}$')) {throw 'Staging inventory missing'}
        $current=Get-SourceStageFingerprint $Root $runtime;$pending=Get-SourceStageFingerprint $Root $prepared;$previous=Get-SourceStageFingerprint $Root $backup
        if ($record.phase -eq 'complete') {
            if ($current -ne $record.newHash -or $null -ne $pending -or $previous -ne $record.oldHash) {throw 'Completed staging inventory conflict'}
        } else {
            if ($current -eq $record.newHash -and $null -eq $pending -and $previous -eq $record.oldHash) {
                [IO.Directory]::Move($runtime,$prepared);$current=$null;$pending=$record.newHash
            }
            if ($null -eq $current -and $pending -eq $record.newHash -and $previous -eq $record.oldHash -and $null -ne $record.oldHash) {
                [IO.Directory]::Move($backup,$runtime);$current=$record.oldHash;$previous=$null
            }
            if ($current -ne $record.oldHash -or $pending -ne $record.newHash -or $null -ne $previous) {throw 'Staging recovery inventory conflict'}
            $record.phase='rolled-back';Write-SourceStageRecord $journal $record
        }
        $remove=$true
    } finally {$lock.Dispose();if($remove){Remove-Item -LiteralPath $lockPath -ErrorAction Stop}}
    return $true
}
function Publish-SourceRuntime {
    param([string]$Root, [string]$Prepared, [scriptblock]$AfterInstall = {}, [scriptblock]$AfterPhase = {})
    $runtime = Assert-SourceStagePath $Root (Join-Path $Root 'runtime')
    $preparedPath = Assert-SourceStagePath $Root $Prepared
    $build = Assert-SourceStagePath $Root (Join-Path $Root '.build')
    if (!(Split-Path $preparedPath -Parent).Equals($build, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $preparedPath -Leaf).StartsWith('source-prepared-')) { throw 'Prepared runtime must be a dedicated build child' }
    if (!(Test-Path -LiteralPath $preparedPath -PathType Container)) { throw 'Prepared runtime missing' }
    New-Item -ItemType Directory -Path $build -Force | Out-Null
    $id = [Guid]::NewGuid().ToString('N')
    $backup = Assert-SourceStagePath $Root (Join-Path $build "source-previous-$id")
    $journalPath = Join-Path $build "source-transaction-$id.json"
    $lockPath = Join-Path $build 'source-staging.lock'
    # Unknown locks, including a terminated build's lock, require inspection. No age test.
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $oldMoved = $false
    $newMoved = $false
    $retainLock = $false
    $record = [ordered]@{schemaVersion=2; id=$id; pid=$PID; prepared=$preparedPath; runtime=$runtime; backup=$backup; phase='prepared';oldHash=$null;newHash=$null}
    try {
        $identity = [Text.Encoding]::UTF8.GetBytes($journalPath)
        $lock.Write($identity,0,$identity.Length); $lock.Flush($true)
        $record.oldHash=Get-SourceStageFingerprint $Root $runtime;$record.newHash=Get-SourceStageFingerprint $Root $preparedPath
        Write-SourceStageRecord $journalPath $record
        & $AfterPhase 'prepared'
        if (Test-Path -LiteralPath $runtime) {
            [IO.Directory]::Move($runtime, $backup)
            $oldMoved = $true
            & $AfterPhase 'old-renamed'
        }
        $record.phase='previous-retained'; Write-SourceStageRecord $journalPath $record
        [IO.Directory]::Move($preparedPath, $runtime)
        $newMoved = $true
        & $AfterPhase 'new-renamed'
        & $AfterInstall
        $record.phase='complete'; Write-SourceStageRecord $journalPath $record
        & $AfterPhase 'complete'
        return [pscustomobject]$record
    } catch {
        $original = $_
        try {
            if ($newMoved) { [IO.Directory]::Move($runtime, $preparedPath) }
            if ($oldMoved) { [IO.Directory]::Move($backup, $runtime) }
            $record.phase='rolled-back'; Write-SourceStageRecord $journalPath $record
        } catch {
            $retainLock = $true
            throw "Source staging rollback failed. Preserve runtime, prepared and backup; inspect $journalPath. Original: $original; recovery: $_"
        }
        throw $original
    } finally {
        $lock.Dispose()
        if (!$retainLock) { Remove-Item -LiteralPath $lockPath -ErrorAction Stop }
    }
}
