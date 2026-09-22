import {randomBytes} from 'node:crypto';
import {readFile, mkdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Shared only inside the supervised Node process. Never placed in its environment.
export const diagnosticState = {
  key: randomBytes(32), keyPersistence: 'ephemeral', preferences: {enabled:true},
  effectiveSpillBytes:50000, effectiveSkillDescription:500, preferenceWarning:false, home:undefined,
};
export function receiveDiagnosticKey(value) {
  if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) {
    diagnosticState.key = Buffer.from(value, 'hex');
    diagnosticState.keyPersistence = 'windows-credential-manager';
  }
}
export async function loadDiagnosticPreferences(home) {
  diagnosticState.home = home;
  try {
    const data = JSON.parse(await readFile(join(home, 'desktop-observability.json'), 'utf8'));
    diagnosticState.preferences = {enabled:data.enabled !== false,
      ...(['native','compact','restore'].includes(data.spillMode) ? {spillMode:data.spillMode} : {}),
      ...(['native','compact','restore'].includes(data.skillMode) ? {skillMode:data.skillMode} : {}),
      autoArchive:data.autoArchive===true,repoSummary:data.repoSummary===true};
  } catch (error) { if (error.code !== 'ENOENT') diagnosticState.preferenceWarning = true; }
}
let saving = Promise.resolve();
export function saveDiagnosticPreferences(patch) {
  const task = saving.catch(() => {}).then(async () => {
    const next = {...diagnosticState.preferences, ...patch};
    const home = diagnosticState.home;
    if (!home) throw new Error('Preferences storage unavailable');
    await mkdir(home, {recursive:true});
    const filename = join(home, 'desktop-observability.json');
    await writeFile(filename + '.new', JSON.stringify(next), {mode:0o600});
    await rename(filename + '.new', filename);
    diagnosticState.preferences = next;
    diagnosticState.preferenceWarning = false;
    return next;
  });
  saving = task;
  return task;
}
