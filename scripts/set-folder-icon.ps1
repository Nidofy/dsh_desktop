param(
    [Parameter(Mandatory=$true)][string]$PackagePath,
    [string]$ZipPath,
    [switch]$RefreshShell
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$folder=(Resolve-Path -LiteralPath $PackagePath).Path
if (!(Test-Path -LiteralPath (Join-Path $folder 'DSHDesktop.exe') -PathType Leaf)) { throw 'Expected a DSHDesktop package directory' }
$icon=Join-Path $folder 'DSHDesktop.ico'
$ini=Join-Path $folder 'desktop.ini'
Copy-Item -LiteralPath (Join-Path $root 'src-tauri/icons/icon.ico') -Destination $icon -Force
$content="[.ShellClassInfo]`r`nIconFile=DSHDesktop.ico`r`nIconIndex=0`r`nIconResource=DSHDesktop.ico,0`r`n"
# FileMode.Create refuses to overwrite an existing hidden/system desktop.ini.
# Open the existing file without replacing it so repeated packaging is safe.
$stream=[IO.File]::Open($ini,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try {
    $stream.SetLength(0)
    $bytes=[Text.Encoding]::Unicode.GetPreamble()+[Text.Encoding]::Unicode.GetBytes($content)
    $stream.Write($bytes,0,$bytes.Length)
} finally { $stream.Dispose() }
[IO.File]::SetAttributes($ini,([IO.File]::GetAttributes($ini) -bor [IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System))
# Windows uses the directory's read-only bit to enable desktop.ini customization.
# This does not mark its contents read-only.
[IO.File]::SetAttributes($folder,([IO.File]::GetAttributes($folder) -bor [IO.FileAttributes]::ReadOnly))

if ($ZipPath) {
    # Compress-Archive skips hidden files. Explicitly include desktop.ini and
    # DOS attributes so compatible Windows extractors can restore the folder icon.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::Open((Resolve-Path -LiteralPath $ZipPath).Path,[IO.Compression.ZipArchiveMode]::Update)
    try {
        $executables=@($archive.Entries | Where-Object { $_.FullName -match '^[^/]+/DSHDesktop.exe$' })
        if ($executables.Count -ne 1) { throw 'Expected exactly one package root in ZIP' }
        $prefix=$executables[0].FullName.Split('/')[0]+'/'
        $directory=$archive.GetEntry($prefix)
        if (!$directory) { $directory=$archive.CreateEntry($prefix) }
        $directory.ExternalAttributes=17 # Directory | ReadOnly (DOS attributes)
        foreach ($name in @('DSHDesktop.ico','desktop.ini')) {
            $entry=$archive.GetEntry($prefix+$name)
            if ($entry) { $entry.Delete() }
            $entry=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $folder $name),$prefix+$name,[IO.Compression.CompressionLevel]::Optimal)
            $entry.ExternalAttributes=if($name -eq 'desktop.ini'){6}else{32}
        }
    } finally { $archive.Dispose() }
}

if ($RefreshShell) {
    if (-not ('DSHDesktop.ShellIcons' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace DSHDesktop {
    public static class ShellIcons {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
        public static void ItemChanged(string path) {
            IntPtr value = Marshal.StringToHGlobalUni(path);
            try { SHChangeNotify(0x2000, 0x1005, value, IntPtr.Zero); }
            finally { Marshal.FreeHGlobal(value); }
        }
    }
}
'@
    }
    [DSHDesktop.ShellIcons]::ItemChanged((Join-Path $folder 'DSHDesktop.exe'))
    [DSHDesktop.ShellIcons]::ItemChanged($folder)
    [DSHDesktop.ShellIcons]::ItemChanged((Split-Path $folder -Parent))
    # Invalidate stale Explorer images without deleting caches or restarting it.
    [DSHDesktop.ShellIcons]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
}
Write-Output "Unified Explorer icon: $folder"
