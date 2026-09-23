// The official CLI owns application logic; a pinned adapter extension exposes
// pi-ai's public onPayload hook for the independent desktop cache key policy.
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {readFile} from 'node:fs/promises';
import { synchronizeDesktopSettings } from './settings-sync.mjs';
import {receiveDiagnosticKey,loadDiagnosticPreferences} from './diagnostic-state.mjs';
import {validateExtraCa} from './desktop-network.mjs';
import {configureCacheKeyBridge} from './desktop-cache-key-bridge.mjs';
import {snapshotPipe} from './task-snapshot-bridge.mjs';
import {storageAdmission} from './storage-admission.mjs';
import {migrateWorkspaceHistory} from './workspace-migration.mjs';
import {failStartup,installStartupErrors} from './startup-errors.mjs';
import {desktopControl} from './desktop-control.mjs';
import {requireDesktopAdapter} from './harness-adapter.mjs';
installStartupErrors();
const input = createInterface({ input: process.stdin });
// --import preload gates the real CLI entry; import.meta.main remains true in DSH.
await new Promise(resolve => input.on('line', line => {
  if (line === 'start') resolve();
  if (line.startsWith('start ')) {
    // Credential bytes travel only through the inherited private supervisor pipe.
    try {const value=JSON.parse(line.slice(6));receiveDiagnosticKey(value.diagnosticKey);snapshotPipe.configure(value.snapshotBridge);storageAdmission.configure(value.storageQuota===true,process.env.DSH_HOME);} catch {}
    resolve();
  }
  if (line === 'stop') {
    storageAdmission.close();
    snapshotPipe.close();
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(0);
  }
  if (line.startsWith('snapshot ')) snapshotPipe.receive(line);
  if (line.startsWith('desktop-control ') && line.length<256) void desktopControl(line.slice(16));
}));
try { await requireDesktopAdapter(dirname(fileURLToPath(import.meta.url))); }
catch(error) { failStartup(error,'ADAPTER'); await new Promise(()=>{}); }
// The supervisor has stopped the old engine before this start gate opens.
// No settings watcher or old process can restore stale overrides afterward.
try { await validateExtraCa(); }
catch {
  // Fixed code only: the supervisor can explain the failure without persisting
  // an arbitrary exception, certificate contents or local path.
  console.log('dsh desktop error: EXTRA_CA_INVALID');
  process.exit(1);
}
try { await migrateWorkspaceHistory({root:process.env.DSH_DESKTOP_ROOT,home:process.env.DSH_HOME,repairDuplicates:process.env.DSH_DESKTOP_REPAIR_WORKSPACES==='1'}); }
catch(error) { console.log('dsh desktop error: '+(error?.code==='WORKSPACE_VERSION_UNSUPPORTED'?'WORKSPACE_VERSION_UNSUPPORTED':'WORKSPACE_MIGRATION_FAILED')); process.exit(1); }
try { await loadDiagnosticPreferences(process.env.DSH_HOME); }
catch(error) { failStartup(error,'PREFERENCES'); await new Promise(()=>{}); }
let patch;
try {patch=process.env.DSH_DESKTOP_PATCH?JSON.parse(await readFile(process.env.DSH_DESKTOP_PATCH,'utf8')):[];if(!Array.isArray(patch))throw Error();}
catch(error){failStartup(error,'SETTINGS');await new Promise(()=>{});}
try {
  configureCacheKeyBridge(dirname(fileURLToPath(import.meta.url)),patch);
}
catch(error) {
  const code=['DESKTOP_CACHE_KEY_POLICY_INVALID','DESKTOP_CACHE_KEY_POLICY_UNSUPPORTED'].includes(error?.code)?'CACHE_KEY_POLICY_UNSUPPORTED':'CACHE_KEY_ADAPTER_MISMATCH';
  console.log('dsh desktop error: '+code);process.exit(1);
}
try { await synchronizeDesktopSettings({home:process.env.DSH_HOME, patchFile:process.env.DSH_DESKTOP_PATCH, runtimeRoot:dirname(fileURLToPath(import.meta.url))}); }
catch(error) { failStartup(error,'SETTINGS'); await new Promise(()=>{}); }
input.on('close', () => {
  snapshotPipe.close();
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
  else process.exit(0);
});
