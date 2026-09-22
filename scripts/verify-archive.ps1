param([Parameter(Mandatory=$true)][string]$ZipPath,[Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$package=(Resolve-Path -LiteralPath $PackagePath).Path
$manifestPath=Join-Path $package 'package-integrity.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.kind -ne 'desktop-package') { throw 'Invalid package manifest' }
$expected=@{}
foreach ($file in $manifest.files) {
    if (!$file.path -or $file.path -match '[\\:\x00-\x1f]' -or $file.path.StartsWith('/') -or @($file.path.Split('/') | Where-Object { !$_ -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[. ]$' }).Count -or $expected.ContainsKey($file.path)) { throw 'Invalid or duplicate manifest path' }
    $expected[$file.path]=$file
}
$expected['package-integrity.json']=@{path='package-integrity.json';bytes=(Get-Item -LiteralPath $manifestPath).Length;sha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()}
$prefix=(Split-Path $package -Leaf)+'/'
$archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZipPath).Path)
$seen=@{}
try {
    foreach ($entry in $archive.Entries) {
        $name=$entry.FullName
        if (!$name.StartsWith($prefix,[StringComparison]::Ordinal) -or $name -match '[\\:\x00-\x1f]' -or (($entry.ExternalAttributes -band 0xF0000000) -eq 0xA0000000) -or (($entry.ExternalAttributes -band 1024) -ne 0)) { throw 'Unsafe archive entry' }
        $relative=$name.Substring($prefix.Length)
        if ($relative.EndsWith('/')) { $relative=$relative.TrimEnd('/'); if ($relative -and @($relative.Split('/') | Where-Object { !$_ -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[. ]$' }).Count) { throw 'Unsafe archive directory' }; continue }
        if (!$relative) { continue }
        if (!$expected.ContainsKey($relative) -or $seen.ContainsKey($relative)) { throw 'Extra or duplicate archive file' }
        $record=$expected[$relative]
        if ($relative -cne $record.path) { throw 'Archive file casing mismatch' }
        if ($entry.Length -ne $record.bytes) { throw 'Archive file length mismatch' }
        $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
        try { $actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose();$stream.Dispose() }
        if ($actual -cne $record.sha256) { throw 'Archive file checksum mismatch' }
        $seen[$relative]=$true
    }
    if ($seen.Count -ne $expected.Count) { throw 'Archive is missing manifest files' }
} finally { $archive.Dispose() }
Write-Output "PASS ZIP integrity: $($seen.Count) files, including package manifest, match the staged package"
