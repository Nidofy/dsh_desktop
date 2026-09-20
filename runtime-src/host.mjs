// Launcher protocol only. The unmodified official CLI owns all application logic.
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
// --import preload gates the real CLI entry; import.meta.main remains true in DSH.
await new Promise(resolve => input.on('line', line => {
  if (line === 'start') resolve();
  if (line === 'stop') {
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(0);
  }
}));
input.on('close', () => {
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
  else process.exit(0);
});
