// Reconcile only the desktop-owned provider before the official CLI reads settings.
import {readFile, mkdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function synchronizeDesktopSettings({home, patchFile, runtimeRoot}) {
  if (!home || !patchFile) return;
  const patch = JSON.parse(await readFile(patchFile, 'utf8'));
  const provider = patch.find(row => row.id === 'llm-pi-ai')?.config?.providers?.['desktop-internal'];
  const selection = patch.find(row => row.id === 'agent-default-model')?.config;
  if (!provider) return; // Unconfigured desktop, or a non-desktop test harness.
  if (!provider.models?.length || selection?.provider !== 'desktop-internal' ||
      !provider.models.some(model => model.id === selection.model)) throw new Error('Invalid desktop model configuration');
  const require = createRequire(join(runtimeRoot, 'dsh/package.json'));
  const {parseDocument} = require('yaml');
  const {withFileLock, writeFileAtomic} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href);
  const filename = join(home, 'settings.yaml');
  const marker = join(home, 'desktop-settings-revision.json');
  const fingerprint = createHash('sha256').update(JSON.stringify({provider,selection})).digest('hex');
  const readOptional = async file => {
    try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  };
  await mkdir(home, {recursive:true, mode:0o700});
  await withFileLock(filename, async () => {
    const text = await readOptional(filename);
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error('Cannot synchronize invalid DSH settings.yaml; original file was preserved');
    const data = doc.toJS() ?? {};
    const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!isMap(data) || ['llm-pi-ai','agent-default-model'].some(key => data[key] !== undefined && !isMap(data[key])) ||
        (data['llm-pi-ai']?.providers !== undefined && !isMap(data['llm-pi-ai'].providers))) {
      throw new Error('Cannot synchronize malformed DSH model settings; original file was preserved');
    }
    const previousMarker = await readOptional(marker);
    const changed = previousMarker !== JSON.stringify({fingerprint});
    let dirty = false;
    if (JSON.stringify(data['llm-pi-ai']?.providers?.['desktop-internal']) !== JSON.stringify(provider)) {
      doc.setIn(['llm-pi-ai','providers','desktop-internal'], provider);
      dirty = true;
    }
    const current = data['agent-default-model'];
    if (changed || (current?.provider === 'desktop-internal' && !provider.models.some(model => model.id === current.model))) {
      const sameModel = current?.provider === selection.provider && current.model?.replace(/\[1m\]$/i, '') === selection.model;
      const effort = sameModel && ['off','minimal','low','medium','high','xhigh','max'].includes(current.reasoningEffort) ? current.reasoningEffort : undefined;
      doc.setIn(['agent-default-model'], {...selection,...(effort ? {reasoningEffort:effort} : {})});
      dirty = true;
    }
    if (dirty) {
      if (text) await writeFileAtomic(join(home, 'desktop-settings-backups', `${Date.now()}-${randomUUID()}.yaml`), text, {mode:0o600,dirMode:0o700});
      await writeFileAtomic(filename, String(doc), {mode:0o600,dirMode:0o700});
    }
    // Commit last: an interrupted synchronization retries safely on the next start.
    if (changed) await writeFileAtomic(marker, JSON.stringify({fingerprint}), {mode:0o600,dirMode:0o700});
  });
}
