// Launcher protocol only. The unmodified official CLI owns all application logic.
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synchronizeDesktopSettings } from './settings-sync.mjs';
const input = createInterface({ input: process.stdin });
// --import preload gates the real CLI entry; import.meta.main remains true in DSH.
await new Promise(resolve => input.on('line', line => {
  if (line === 'start') resolve();
  if (line === 'stop') {
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(0);
  }
}));
// The supervisor has stopped the old engine before this start gate opens.
// No settings watcher or old process can restore stale overrides afterward.
await synchronizeDesktopSettings({home:process.env.DSH_HOME, patchFile:process.env.DSH_DESKTOP_PATCH, runtimeRoot:dirname(fileURLToPath(import.meta.url))});
input.on('close', () => {
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
  else process.exit(0);
});
