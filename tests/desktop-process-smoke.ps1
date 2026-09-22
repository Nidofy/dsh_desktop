param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$package=(Resolve-Path -LiteralPath $PackagePath).Path
$root=Split-Path $PSScriptRoot -Parent
$profile=Join-Path $root ('.build/desktop-process-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $profile | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this acceptance check as a non-administrator' }
$savedPath=$env:PATH
$savedLocal=$env:LOCALAPPDATA
$savedBrowser=$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
$desktop=$null
$backend=$null
$evidence=[ordered]@{administratorToken=$false;package=$package;profile=$profile}
try {
    $env:PATH="$env:SystemRoot\System32;$env:SystemRoot"
    $env:LOCALAPPDATA=$profile
    $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=Join-Path $profile 'invalid-inherited-browser'
    $desktop=Start-Process -FilePath (Join-Path $package 'DSHDesktop.exe') -WorkingDirectory $package -WindowStyle Hidden -PassThru
    $log=Join-Path $profile 'DSHDesktop/logs/desktop.log'
    $deadline=(Get-Date).AddSeconds(100)
    $ready=$null
    while ((Get-Date) -lt $deadline -and !$desktop.HasExited) {
        if (Test-Path -LiteralPath $log) {
            $ready=Get-Content -LiteralPath $log | Select-String -Pattern 'backend ready pid=(\d+) port=(\d+) startup_ms=(\d+)' | Select-Object -Last 1
            if ($ready) { break }
        }
        Start-Sleep -Milliseconds 200
    }
    if (!$ready) {
        $desktop.Refresh()
        $evidence.desktopExited=$desktop.HasExited
        if ($desktop.HasExited) { $evidence.desktopExitCode=$desktop.ExitCode }
        throw 'Desktop did not become ready'
    }
    $backend=[int]$ready.Matches[0].Groups[1].Value
    $port=[int]$ready.Matches[0].Groups[2].Value
    $evidence.startupMs=[int]$ready.Matches[0].Groups[3].Value
    $listener=@(Get-NetTCPConnection -State Listen -OwningProcess $backend)
    if ($listener.Count -lt 1 -or @($listener | Where-Object LocalAddress -ne '127.0.0.1').Count -gt 0) { throw 'Backend listener is missing or not loopback-only' }
    $evidence.loopbackOnly=$true
    $evidence.port=$port
    $browsers=@(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object ParentProcessId -eq $desktop.Id)
    $bundledBrowser=Join-Path $package 'resources/webview2/msedgewebview2.exe'
    $evidence.observedWebViewProcesses=@($browsers | Select-Object ProcessId,ParentProcessId,ExecutablePath)
    if ($browsers.Count -lt 1 -or @($browsers | Where-Object ExecutablePath -ne $bundledBrowser).Count -gt 0) { throw 'Desktop did not launch its bundled WebView2' }
    $evidence.webview2Executable=$bundledBrowser
    $evidence.webview2Version=(Get-Item -LiteralPath $bundledBrowser).VersionInfo.FileVersion
    $evidence.inheritedBrowserOverrideIgnored=$true
    $second=Start-Process -FilePath (Join-Path $package 'DSHDesktop.exe') -WindowStyle Hidden -PassThru
    if (!$second.WaitForExit(5000)) { Stop-Process -Id $second.Id; throw 'Second instance did not exit' }
    $evidence.secondInstanceExited=$true
    Stop-Process -Id $backend
    $deadline=(Get-Date).AddSeconds(10)
    do { Start-Sleep -Milliseconds 200; $failure=Get-Content -LiteralPath $log | Select-String -Pattern 'DSH 引擎意外退出|stopped unexpectedly' } while (!$failure -and (Get-Date) -lt $deadline)
    if (!$failure) { throw 'Backend crash did not reach supervisor error state' }
    $evidence.backendCrashReported=$true
    $evidence.desktopStayedAliveAfterBackendCrash=!(Get-Process -Id $desktop.Id).HasExited
    Stop-Process -Id $desktop.Id
    $desktop.WaitForExit(5000) | Out-Null
    $evidence.backendRemains=[bool](Get-Process -Id $backend -ErrorAction SilentlyContinue)
    if ($evidence.backendRemains) { throw 'Backend remained after desktop termination' }
    $evidence.result='PASS'
} finally {
    $env:PATH=$savedPath
    $env:LOCALAPPDATA=$savedLocal
    $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$savedBrowser
    if ($desktop -and !$desktop.HasExited) { Stop-Process -Id $desktop.Id -ErrorAction SilentlyContinue }
    if ($backend) { Stop-Process -Id $backend -ErrorAction SilentlyContinue }
    $evidence | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profile 'report.json') -Encoding utf8
}
$evidence | ConvertTo-Json
