param([Parameter(Mandatory=$true)][string]$PackagePath)
$ErrorActionPreference='Stop'
$package=(Resolve-Path -LiteralPath $PackagePath).Path
if(Get-Process DSHDesktop -ErrorAction SilentlyContinue){throw 'Close existing DSHDesktop before isolated visual probe'}
$root=Split-Path $PSScriptRoot -Parent
$probe=Join-Path $root ('.build/pet-native-inspect-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force (Join-Path $probe 'DSHDesktop') | Out-Null
$resourceRoot=Join-Path $package 'resources'
$resourceRequest=@{home=Join-Path $probe 'DSHDesktop';resources=$resourceRoot;action='preview';source=Join-Path $root 'tests/fixtures/pets/standard-8x9'}
$preview=$resourceRequest|ConvertTo-Json -Compress| & (Join-Path $resourceRoot 'runtime/node.exe') (Join-Path $resourceRoot 'pet-packages.mjs') | ConvertFrom-Json
if(!$preview.ok){throw 'Native compatibility preflight failed'}
$resourceRequest.action='import';$resourceRequest.expected=$preview.value.digest
$installed=$resourceRequest|ConvertTo-Json -Compress| & (Join-Path $resourceRoot 'runtime/node.exe') (Join-Path $resourceRoot 'pet-packages.mjs') | ConvertFrom-Json
if(!$installed.ok){throw 'Native compatibility import failed'}
@{schemaVersion=3;enabled=$true;instances=@(1..3|ForEach-Object {@{id="$_";x=60+($_-1)*250;y=120;resource=$(if($_-eq 3){'compat-standard'}else{'xiaojing'})}})} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $probe 'DSHDesktop/pets.json') -Encoding utf8
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class PetNativeProbe {
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 public delegate bool EnumProc(IntPtr w,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc p,IntPtr v);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr w,StringBuilder b,int n);
 [DllImport("user32.dll")]static extern IntPtr GetMenu(IntPtr w);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr w,int n);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr w);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr w,IntPtr dc,uint flags);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr w,uint m,IntPtr a,IntPtr b);
 public struct Rect {public int Left,Top,Right,Bottom;}
 public class Entry {public long Handle,Menu;public string Title;public int Style,ExStyle,Dpi;public bool Visible;public Rect Bounds,Client;}
 public static Entry[] Windows(int pid){var result=new List<Entry>();EnumWindows((w,p)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner!=pid)return true;var title=new StringBuilder(256);GetWindowText(w,title,256);if(title.ToString()!="吃白饭的大肥鱼"&&title.ToString()!="标准格式样例")return true;Rect r,c;GetWindowRect(w,out r);GetClientRect(w,out c);result.Add(new Entry{Handle=w.ToInt64(),Menu=GetMenu(w).ToInt64(),Client=c,Title=title.ToString(),Style=GetWindowLong(w,-16),ExStyle=GetWindowLong(w,-20),Dpi=(int)GetDpiForWindow(w),Visible=IsWindowVisible(w),Bounds=r});return true;},IntPtr.Zero);return result.ToArray();}
}
"@
[void][PetNativeProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
$saved=$env:LOCALAPPDATA;$desktop=$null
try{
 $env:LOCALAPPDATA=$probe
 $desktop=Start-Process (Join-Path $package 'DSHDesktop.exe') -WorkingDirectory $package -WindowStyle Hidden -PassThru
 $log=Join-Path $probe 'DSHDesktop/logs/desktop.log';$deadline=(Get-Date).AddSeconds(80)
 do{Start-Sleep -Milliseconds 250;$ready=if(Test-Path $log){@(Get-Content $log|Select-String 'pet production atlas decoded in native window').Count}else{0}}while($ready-lt 3-and(Get-Date)-lt $deadline-and !$desktop.HasExited)
 if($ready-lt 3){throw 'Three native atlases were not decoded'}
 Start-Sleep -Milliseconds 700
 $windows=@([PetNativeProbe]::Windows($desktop.Id));$windows|ConvertTo-Json -Depth 5|Set-Content (Join-Path $probe 'windows.json') -Encoding utf8;Write-Output $probe;Write-Output ($windows|ConvertTo-Json -Depth 5);if($windows.Count-ne 3){throw 'Expected three native pet windows'}
 foreach($w in $windows){if(!$w.Visible-or !($w.ExStyle-band 8)-or $w.Menu-ne 0-or ($w.Client.Right-$w.Client.Left)-ne ($w.Bounds.Right-$w.Bounds.Left)-or ($w.Client.Bottom-$w.Client.Top)-ne ($w.Bounds.Bottom-$w.Bounds.Top)){throw 'Pet must be visible/topmost with no menu or nonclient inset'};if(($w.Bounds.Bottom-$w.Bounds.Top)/(($w.Dpi)/96.0)-gt 210){throw 'Unexpected idle bubble or resource fallback'};if(($w.Bounds.Right-$w.Bounds.Left)-gt 900-or($w.Bounds.Bottom-$w.Bounds.Top)-gt 900){throw 'Unexpected large pet surface'}}
 $index=0;foreach($w in $windows){$width=$w.Bounds.Right-$w.Bounds.Left;$height=$w.Bounds.Bottom-$w.Bounds.Top;$bitmap=[Drawing.Bitmap]::new($width,$height);$graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc();try{[void][PetNativeProbe]::PrintWindow([IntPtr]$w.Handle,$dc,2)}finally{$graphics.ReleaseHdc($dc)};$bitmap.Save((Join-Path $probe "pet-$index.png"));$graphics.Dispose();$bitmap.Dispose();$index++}
 [void][PetNativeProbe]::PostMessage([IntPtr]$windows[0].Handle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
 Start-Sleep -Seconds 1
 $remaining=@([PetNativeProbe]::Windows($desktop.Id));$config=Get-Content (Join-Path $probe 'DSHDesktop/pets.json') -Raw|ConvertFrom-Json
 if($remaining.Count-ne 2-or @($config.instances|Where-Object enabled).Count-ne 2){throw 'Native close did not disable exactly one instance'}
 @{status='PASS';profile=$probe;windows=$windows;nativeCloseDisabledOne=$true;resources=@('xiaojing-v2','xiaojing-v2','compat-standard-v1-without-interactions');remainingWindows=$remaining.Count;hardwareInput='NOT_MEASURED';capture='PrintWindow; visually inspect PNG separately'}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $probe 'report.json') -Encoding utf8
 Get-Content (Join-Path $probe 'report.json')
}finally{$env:LOCALAPPDATA=$saved;if($desktop-and !$desktop.HasExited){Stop-Process -Id $desktop.Id;$desktop.WaitForExit(5000)|Out-Null}}
