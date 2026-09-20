param([Parameter(Mandatory=$true)][string]$RuntimePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$pins=Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
$runtime=(Resolve-Path -LiteralPath $RuntimePath).Path
$folder=Join-Path $runtime 'webview2'
$manifest=Get-Content -LiteralPath (Join-Path $runtime 'webview2-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $pins.webview2 -or $manifest.cabSha256 -ne $pins.webview2CabSha256 -or $manifest.architecture -ne 'x64') { throw 'WebView2 provenance/version mismatch' }
if (@($manifest.files).Count -lt 100) { throw 'WebView2 file inventory incomplete' }
foreach($file in $manifest.files) {
    $path=[IO.Path]::GetFullPath((Join-Path $folder $file.path))
    if (!$path.StartsWith($folder+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid browser inventory path' }
    if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Missing/corrupt WebView2 file: $($file.path)" }
}
if ((Get-Item -LiteralPath (Join-Path $folder 'msedgewebview2.exe')).VersionInfo.FileVersion -ne $pins.webview2) { throw 'WebView2 binary version mismatch' }
Write-Output "PASS pinned WebView2 $($pins.webview2), $(@($manifest.files).Count) files verified"
