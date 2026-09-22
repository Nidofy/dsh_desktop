$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$fixture=Join-Path $root ('.build/archive-integrity-'+[Guid]::NewGuid().ToString('N'))
$stage=Join-Path $fixture 'SyntheticPackage'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $stage 'one.txt'),'ONE')
[IO.File]::WriteAllText((Join-Path $stage 'desktop.ini'),'SYNTHETIC_ICON')
$files=@('one.txt','desktop.ini') | ForEach-Object { @{path=$_;bytes=(Get-Item -LiteralPath (Join-Path $stage $_)).Length;sha256=(Get-FileHash -LiteralPath (Join-Path $stage $_) -Algorithm SHA256).Hash.ToLowerInvariant()} }
[IO.File]::WriteAllText((Join-Path $stage 'package-integrity.json'),(@{schemaVersion=1;kind='desktop-package';files=@($files)} | ConvertTo-Json -Depth 5))
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-TestArchive([string]$mode) {
    $zip=Join-Path $fixture ($mode+'.zip')
    $archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($name in @('one.txt','desktop.ini','package-integrity.json')) {
            if ($mode -eq 'missing' -and $name -eq 'desktop.ini') { continue }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $stage $name),('SyntheticPackage/'+$name)) | Out-Null
        }
        if ($mode -in @('extra','duplicate','unsafe')) {
            $name=switch($mode){'extra'{'extra.txt'} 'duplicate'{'ONE.txt'} 'unsafe'{'../outside'}}
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $stage 'one.txt'),('SyntheticPackage/'+$name)) | Out-Null
        }
    } finally { $archive.Dispose() }
    return $zip
}
& (Join-Path $root 'scripts/verify-archive.ps1') -ZipPath (New-TestArchive 'valid') -PackagePath $stage
foreach($mode in @('missing','extra','duplicate','unsafe')) {
    $failed=$false
    try { & (Join-Path $root 'scripts/verify-archive.ps1') -ZipPath (New-TestArchive $mode) -PackagePath $stage } catch { $failed=$true }
    if (!$failed) { throw "Archive verifier accepted $mode" }
}
$zip=New-TestArchive 'changed'
[IO.File]::WriteAllText((Join-Path $stage 'one.txt'),'TWO')
$m=Get-Content -LiteralPath (Join-Path $stage 'package-integrity.json') -Raw | ConvertFrom-Json
$m.files[0].sha256=(Get-FileHash -LiteralPath (Join-Path $stage 'one.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
# Construct a trusted expected tree with altered same-length bytes. The old ZIP must fail.
[IO.File]::WriteAllText((Join-Path $stage 'package-integrity.json'),($m | ConvertTo-Json -Depth 5))
$failed=$false
try { & (Join-Path $root 'scripts/verify-archive.ps1') -ZipPath $zip -PackagePath $stage } catch { $failed=$true }
if (!$failed) { throw 'Archive verifier accepted changed content' }
Write-Output "PASS archive contracts: valid/missing/extra/case duplicate/traversal/changed; $fixture"
