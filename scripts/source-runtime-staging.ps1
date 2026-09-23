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

function Publish-SourceRuntime {
    param([string]$Root, [string]$Prepared, [scriptblock]$AfterInstall = {})
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
    $record = [ordered]@{schemaVersion=1; id=$id; prepared=$preparedPath; runtime=$runtime; backup=$backup; phase='prepared'}
    try {
        $identity = [Text.Encoding]::UTF8.GetBytes($journalPath)
        $lock.Write($identity,0,$identity.Length); $lock.Flush($true)
        $record | ConvertTo-Json | Set-Content -LiteralPath $journalPath -Encoding utf8
        if (Test-Path -LiteralPath $runtime) {
            [IO.Directory]::Move($runtime, $backup)
            $oldMoved = $true
        }
        $record.phase='previous-retained'; $record | ConvertTo-Json | Set-Content -LiteralPath $journalPath -Encoding utf8
        [IO.Directory]::Move($preparedPath, $runtime)
        $newMoved = $true
        & $AfterInstall
        $record.phase='complete'; $record | ConvertTo-Json | Set-Content -LiteralPath $journalPath -Encoding utf8
        return [pscustomobject]$record
    } catch {
        $original = $_
        try {
            if ($newMoved) { [IO.Directory]::Move($runtime, $preparedPath) }
            if ($oldMoved) { [IO.Directory]::Move($backup, $runtime) }
            $record.phase='rolled-back'; $record | ConvertTo-Json | Set-Content -LiteralPath $journalPath -Encoding utf8
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
