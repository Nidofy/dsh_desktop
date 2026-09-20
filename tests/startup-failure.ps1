param([Parameter(Mandatory=$true)][string]$Executable,[switch]$CorruptBrowser)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$fixture=Join-Path $root ('.build/missing-runtime-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $fixture | Out-Null
Copy-Item -LiteralPath (Resolve-Path -LiteralPath $Executable).Path -Destination (Join-Path $fixture 'DSHDesktop.exe')
$expected='随包 WebView2 文件缺失'
if ($CorruptBrowser) {
    $browser=Join-Path $fixture 'resources/webview2'
    New-Item -ItemType Directory -Force $browser | Out-Null
    foreach($name in @('msedgewebview2.exe','msedge.dll','icudtl.dat','resources.pak')) { [IO.File]::WriteAllText((Join-Path $browser $name),'deliberately invalid test fixture') }
    $expected='无法加载随包 WebView2'
}
$saved=$env:LOCALAPPDATA
$app=$null
try {
    $env:LOCALAPPDATA=Join-Path $fixture 'userdata'
    $app=Start-Process -FilePath (Join-Path $fixture 'DSHDesktop.exe') -WindowStyle Hidden -PassThru
    $log=Join-Path $env:LOCALAPPDATA 'DSHDesktop/logs/desktop.log'
    $deadline=(Get-Date).AddSeconds(15)
    $failure=$null
    do {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $log) { $failure=Get-Content -LiteralPath $log -Encoding utf8 | Select-String -SimpleMatch $expected }
    } while (!$failure -and (Get-Date) -lt $deadline -and !$app.HasExited)
    if (!$failure) { throw 'Missing-runtime error was not reported' }
    if (@(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $app.Id | Where-Object Name -eq 'node.exe').Count -ne 0) { throw 'Missing runtime incorrectly launched system Node' }
    if (@(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $app.Id | Where-Object Name -eq 'msedgewebview2.exe').Count -ne 0) { throw 'Bad bundle incorrectly fell back to installed WebView2' }
    [ordered]@{result='PASS';startupFailureReported=$true;corruptBrowser=[bool]$CorruptBrowser;systemNodeFallback=$false;systemWebViewFallback=$false;fixture=$fixture} | ConvertTo-Json | Set-Content (Join-Path $fixture 'report.json')
    Get-Content (Join-Path $fixture 'report.json')
} finally {
    $env:LOCALAPPDATA=$saved
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id }
}
