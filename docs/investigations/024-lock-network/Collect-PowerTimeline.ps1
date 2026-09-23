param([int]$Hours=4,[string]$OutputDirectory=$PSScriptRoot)
$ErrorActionPreference='Stop'
if($Hours -lt 1 -or $Hours -gt 72){throw 'Hours must be 1..72'}
$start=(Get-Date).AddHours(-$Hours)
$result=[ordered]@{createdAt=(Get-Date).ToUniversalTime().ToString('o');hours=$Hours;events=@();notes='Read-only; no power settings changed. Missing events do not prove no lock or sleep.'}
foreach($filter in @(@{LogName='System';ProviderName='Microsoft-Windows-Kernel-Power';Id=@(42,107,506,507);StartTime=$start},@{LogName='System';ProviderName='Microsoft-Windows-Power-Troubleshooter';Id=1;StartTime=$start},@{LogName='Security';Id=@(4800,4801);StartTime=$start})){
 try{$rows=@(Get-WinEvent -FilterHashtable $filter -MaxEvents 200 -ErrorAction Stop|Select-Object @{n='timeUtc';e={$_.TimeCreated.ToUniversalTime().ToString('o')}},Id,ProviderName);$result.events+=@{log=$filter.LogName;status='read';records=$rows}}
 catch{$result.events+=@{log=$filter.LogName;status='unavailable-or-no-events';errorId=$_.FullyQualifiedErrorId}}
}
$result.sleepStates=@(& powercfg /a)
$result.sleepIdle=@(& powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE)
$result.displayIdle=@(& powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE)
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$path=Join-Path $OutputDirectory ('power-timeline-'+(Get-Date -Format yyyyMMdd-HHmmss)+'.json')
$result|ConvertTo-Json -Depth 7|Set-Content -LiteralPath $path -Encoding utf8
Write-Output $path
