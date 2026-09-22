// The official CLI owns application logic; a pinned adapter extension exposes
// pi-ai's public onPayload hook for the independent desktop cache key policy.
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synchronizeDesktopSettings } from './settings-sync.mjs';
import {receiveDiagnosticKey,loadDiagnosticPreferences} from './diagnostic-state.mjs';
import {validateExtraCa} from './desktop-network.mjs';
import {installCacheKeyBridge} from './desktop-cache-key-bridge.mjs';
import {snapshotPipe} from './task-snapshot-bridge.mjs';
import {storageAdmission} from './storage-admission.mjs';
import {migrateWorkspaceHistory} from './workspace-migration.mjs';
import {failStartup,installStartupErrors} from './startup-errors.mjs';
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
}));
// The supervisor has stopped the old engine before this start gate opens.
// No settings watcher or old process can restore stale overrides afterward.
try { await validateExtraCa(); }
catch {
  // Fixed code only: the supervisor can explain the failure without persisting
  // an arbitrary exception, certificate contents or local path.
  console.log('dsh desktop error: EXTRA_CA_INVALID');
  process.exit(1);
}
try { await migrateWorkspaceHistory({root:process.env.DSH_DESKTOP_ROOT,home:process.env.DSH_HOME}); }
catch { console.log('dsh desktop error: WORKSPACE_MIGRATION_FAILED'); process.exit(1); }
try { await loadDiagnosticPreferences(process.env.DSH_HOME); }
catch(error) { failStartup(error,'PREFERENCES'); await new Promise(()=>{}); }
try { installCacheKeyBridge(dirname(fileURLToPath(import.meta.url))); }
catch { console.log('dsh desktop error: CACHE_KEY_ADAPTER_MISMATCH'); process.exit(1); }
try { await synchronizeDesktopSettings({home:process.env.DSH_HOME, patchFile:process.env.DSH_DESKTOP_PATCH, runtimeRoot:dirname(fileURLToPath(import.meta.url))}); }
catch(error) { failStartup(error,'SETTINGS'); await new Promise(()=>{}); }
input.on('close', () => {
  snapshotPipe.close();
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
  else process.exit(0);
});
