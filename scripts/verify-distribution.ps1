param([string]$PackagePath=$PSScriptRoot)
$ErrorActionPreference='Stop'
$package=(Resolve-Path -LiteralPath $PackagePath).Path
$manifestPath=Join-Path $package 'package-integrity.json'
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf) -or (Get-Item -LiteralPath $manifestPath).Length -gt 33554432) { throw 'Package manifest missing or too large' }
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.kind -ne 'desktop-package') { throw 'Unsupported package manifest' }
# Validate the official Node pin before executing anything from the bundle.
$node=Join-Path $package 'resources/runtime/node.exe'
$nodeHash=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
if ($nodeHash -ne 'b3094d0b49f9ad602262a9921551737bb97637c05dd357a06ae98188d7290aa3') { throw 'Official Node checksum mismatch' }
# The verifier module is covered by the package checksum. This is corruption
# detection relative to a trusted ZIP/manifest, not an independent signature.
$module=Join-Path $package 'resources/runtime-integrity.mjs'
$entry=@($manifest.files | Where-Object { $_.path -ceq 'resources/runtime-integrity.mjs' })
if ($entry.Count -ne 1 -or (Get-FileHash -LiteralPath $module -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry[0].sha256) { throw 'Integrity verifier checksum mismatch' }
$verification=@'
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.argv[1];
const {readManifest,verifyInventory,verifyRuntime}=await import(pathToFileURL(join(root,'resources/runtime-integrity.mjs')));
const m=await readManifest(join(root,'package-integrity.json'));
if(m.schemaVersion!==1||m.kind!=='desktop-package')throw Error('Invalid package manifest');
const metrics=await verifyInventory(root,m.files,{exclude:['package-integrity.json']});
await verifyRuntime(join(root,'resources'));
console.log(JSON.stringify({status:'PASS',files:metrics.files,bytes:metrics.bytes}));
'@
& $node --input-type=module --eval $verification $package
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed; restore the complete trusted ZIP' }
Write-Output 'File integrity verified. This does not verify GUI, gateway connectivity, or corporate policy acceptance.'
