param([switch]$Offline)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$v=Get-Content -LiteralPath (Join-Path $root 'versions.json') -Raw | ConvertFrom-Json
$runtime=Join-Path $root 'runtime'
$target=Join-Path $runtime 'webview2'
$manifest=Join-Path $runtime 'webview2-manifest.json'
if (Test-Path -LiteralPath $manifest) {
    & "$PSScriptRoot/verify-webview2.ps1" -RuntimePath $runtime
    return
}
if (Test-Path -LiteralPath $target) { throw 'Unverified WebView2 directory exists; preserve it outside runtime before preparing a fresh pinned runtime.' }
$cab=Join-Path $root ".build/Microsoft.WebView2.FixedVersionRuntime.$($v.webview2).x64.cab"
New-Item -ItemType Directory -Force (Split-Path $cab -Parent) | Out-Null
if (!(Test-Path -LiteralPath $cab)) {
    if ($Offline) { throw 'Prepared WebView2/CAB missing. Run fetch-webview2.ps1 on the connected build host first.' }
    Invoke-WebRequest -Uri $v.webview2Url -OutFile $cab
}
if ((Get-FileHash -LiteralPath $cab -Algorithm SHA256).Hash -ne $v.webview2CabSha256) { throw 'WebView2 CAB SHA256 mismatch' }
$unpack=Join-Path $root ('.build/webview2-unpack-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $unpack | Out-Null
& "$env:SystemRoot/System32/expand.exe" $cab '-F:*' $unpack | Out-File -LiteralPath ($unpack+'.log') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'WebView2 CAB extraction failed' }
$source=Join-Path $unpack "Microsoft.WebView2.FixedVersionRuntime.$($v.webview2).x64"
$exe=Join-Path $source 'msedgewebview2.exe'
$signature=Get-AuthenticodeSignature -LiteralPath $exe
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 Microsoft signature validation failed' }
if ((Get-Item -LiteralPath $exe).VersionInfo.FileVersion -ne $v.webview2) { throw 'WebView2 version mismatch' }
Copy-Item -LiteralPath $source -Destination $target -Recurse
$files=@(Get-ChildItem -LiteralPath $target -Recurse -Force -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($target.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
[ordered]@{version=$v.webview2;architecture='x64';source=$v.webview2Url;cabSha256=$v.webview2CabSha256;files=$files} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding utf8
& "$PSScriptRoot/verify-webview2.ps1" -RuntimePath $runtime
