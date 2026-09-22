// Reconcile only the desktop-owned provider before the official CLI reads settings.
import {readFile, mkdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {diagnosticState} from './diagnostic-state.mjs';

export async function synchronizeDesktopSettings({home, patchFile, runtimeRoot}) {
  if (!home || !patchFile) return;
  const patch = JSON.parse(await readFile(patchFile, 'utf8'));
  const selection = patch.find(row => row.id === 'agent-default-model')?.config;
  const route = selection?.provider;
  const provider = patch.find(row => row.id === 'llm-pi-ai')?.config?.providers?.[route];
  if (provider && (!provider.models?.length || typeof route !== 'string' ||
      !provider.models.some(model => model.id === selection.model))) throw new Error('Invalid desktop model configuration');
  diagnosticState.providerConfiguration = provider ? JSON.stringify(provider) : undefined;
  diagnosticState.overlayHash=createHash('sha256').update(JSON.stringify(patch)).digest('hex');
  const manifestBytes=await readFile(join(runtimeRoot,'dsh/package-lock.json')).catch(()=>null);
  diagnosticState.runtimeManifestHash=manifestBytes?createHash('sha256').update(manifestBytes).digest('hex'):null;
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
    const previous=previousMarker?JSON.parse(previousMarker):{};
    const changed = previous.fingerprint !== fingerprint;
    const previousRoute=Object.hasOwn(previous,'route')?previous.route??undefined:'desktop-internal';
    const nodeValue=path=>{const value=doc.getIn(path);return typeof value?.toJSON==='function'?value.toJSON():value;};
    let dirty = false;
    // A catalog route can also have a native DSH configuration. Restore it
    // when this desktop connection stops owning the route.
    const restore=(path,value)=>{if(value===undefined||value===null)doc.deleteIn(path);else doc.setIn(path,value);};
    let original=previous.original??null;
    let originalSelection=previous.originalSelection??null;
    if(previousRoute!==route){
      if(data['llm-pi-ai']?.providers?.[previousRoute]){
        restore(['llm-pi-ai','providers',previousRoute],original);dirty=true;
      }
      if(data['agent-default-model']?.provider===previousRoute){restore(['agent-default-model'],originalSelection);dirty=true;}
      original=route&&route!=='desktop-internal'?data['llm-pi-ai']?.providers?.[route]??null:null;
      originalSelection=nodeValue(['agent-default-model'])??null;
    }
    diagnosticState.managedProvider=route;
    const retired=new Set(previous.retiredProviders??[]);
    if(previousRoute&&previousRoute!==route){if(previous.original)retired.delete(previousRoute);else retired.add(previousRoute);}
    if(route)retired.delete(route);
    diagnosticState.retiredManagedProviders=[...retired];
    if(provider && JSON.stringify(nodeValue(['llm-pi-ai','providers',route]))!==JSON.stringify(provider)){
      doc.setIn(['llm-pi-ai','providers',route],provider);dirty=true;
    }
    const current=nodeValue(['agent-default-model']);
    if (provider && (changed || (current?.provider === route && !provider.models.some(model => model.id === current.model)))) {
      const sameModel = current?.provider === selection.provider && current.model?.replace(/\[1m\]$/i, '') === selection.model;
      const effort = sameModel && ['off','minimal','low','medium','high','xhigh','max'].includes(current.reasoningEffort) ? current.reasoningEffort : undefined;
      doc.setIn(['agent-default-model'], {...selection,...(effort ? {reasoningEffort:effort} : {})});
      dirty = true;
    }
    const baselineFile=join(home,'desktop-experiment-baseline.json');
    const baselineText=await readOptional(baselineFile), baseline=baselineText?JSON.parse(baselineText):{};
    let baselineChanged=false;
    for(const [modeKey,plugin,field,native,compact,stateKey] of [
      ['spillMode','spill-policy','maxInlineBytes',50000,24000,'effectiveSpillBytes'],
      ['skillMode','tool-skill','catalogDescriptionMaxLength',500,250,'effectiveSkillDescription']]) {
      const mode=diagnosticState.preferences[modeKey],path=[plugin,field];
      if(data[plugin]!==undefined&&!isMap(data[plugin]))throw Error('Invalid experimental plugin settings');
      if(mode&&mode!=='restore'&&!Object.hasOwn(baseline,modeKey)){baseline[modeKey]={present:doc.hasIn(path),value:doc.getIn(path)??null};baselineChanged=true;}
      const desired=mode==='native'?native:mode==='compact'?compact:mode==='restore'&&baseline[modeKey]?.present?baseline[modeKey].value:undefined;
      if(mode==='restore'&&baseline[modeKey]&&!baseline[modeKey].present&&doc.hasIn(path)){doc.deleteIn(path);dirty=true;}
      if(desired!==undefined&&doc.getIn(path)!==desired){doc.setIn(path,desired);dirty=true;}
      diagnosticState[stateKey]=doc.getIn(path)??patch.find(row=>row.id===plugin)?.config?.[field]??native;
    }
    // Persist the original values before changing settings, including absence of a key.
    if(baselineChanged)await writeFileAtomic(baselineFile,JSON.stringify(baseline),{mode:0o600,dirMode:0o700});
    if (dirty) {
      if (text) await writeFileAtomic(join(home, 'desktop-settings-backups', `${Date.now()}-${randomUUID()}.yaml`), text, {mode:0o600,dirMode:0o700});
      await writeFileAtomic(filename, String(doc), {mode:0o600,dirMode:0o700});
    }
    // Commit last: an interrupted synchronization retries safely on the next start.
    if (changed) await writeFileAtomic(marker, JSON.stringify({fingerprint,route:route??null,original,originalSelection,retiredProviders:[...retired]}), {mode:0o600,dirMode:0o700});
  });
}
