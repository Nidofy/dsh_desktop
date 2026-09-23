import {readFile,mkdir,lstat,rename,open} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {sourceProbeArguments,sourceProfile} from './harness-adapter.mjs';
import {settingsTransaction,readSettingsFile} from './settings-transaction.mjs';
import {diagnosticState} from './diagnostic-state.mjs';

const fail=code=>Object.assign(Error(code),{code});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Profile settings remain the live writer. Launcher patches supply plugin entries,
// while desktop connection fields are persisted only when their revision changes.
export async function prepareSourceProfile({root,home,runtimeRoot,patch,transactionOptions}) {
  const args=await sourceProbeArguments({root,home});
  for(const name of ['settings.yaml','settings.yaml.imported']) {
    try {await lstat(join(home,name));throw fail('SOURCE_LEGACY_SETTINGS_PENDING');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const require=createRequire(join(runtimeRoot,'dsh/package.json'));
  const load=id=>import(pathToFileURL(require.resolve(id)).href);
  const {initProfile}=await load('@deepseek-ai/dsh-app-boot');
  const {withFileLock,writeFileAtomic}=await load('@deepseek-ai/dsh-atomic-write');
  const {parseDocument,isSeq,isMap}=require('yaml');
  const dir=join(home,'profiles',sourceProfile);
  if(args.includes('--from-default-profile')) {
    await mkdir(join(home,'profiles'),{recursive:true});
    const pending=join(home,'profiles','.desktop-init-'+randomUUID());
    initProfile(pending,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']);
    await rename(pending,dir);
  }
  const filename=join(dir,'cordis.patch.yml');
  const selection=patch.find(row=>row.id==='agent-default-model')?.config;
  const providers=patch.find(row=>row.id==='llm-pi-ai')?.config?.providers;
  const route=selection?.provider,provider=providers?.[route];
  if(provider&&(!Array.isArray(provider.models)||!provider.models.some(m=>m.id===selection.model)))throw fail('SOURCE_PROVIDER_INVALID');
  const cleanProvider=provider?structuredClone(provider):undefined;
  if(cleanProvider)delete cleanProvider.desktopCacheKey;
  const experimentModes={spillMode:diagnosticState.preferences.spillMode,skillMode:diagnosticState.preferences.skillMode};
  const fingerprint=hash({patch,experimentModes});
  diagnosticState.effectiveSpillBytes=experimentModes.spillMode==='compact'?24000:50000;
  diagnosticState.effectiveSkillDescription=experimentModes.skillMode==='compact'?250:500;
  diagnosticState.managedProvider=route;
  diagnosticState.providerConfiguration=provider?JSON.stringify(provider):undefined;
  diagnosticState.overlayHash=hash(patch);
  await withFileLock(filename,async()=>{
    const owner=process.env.DSH_DESKTOP_SETTINGS_OWNER;
    if(/^p-[a-f0-9]{32}$/.test(owner??'')){
      const lock=await open(filename+'.lock','r+');try{await lock.writeFile('DSHDesktop-startup:'+owner);await lock.sync();}finally{await lock.close();}
    }
    const transaction=settingsTransaction(dir,writeFileAtomic,transactionOptions);await transaction.recover();
    const original=await readSettingsFile(dir,'cordis.patch.yml');
    const marker=await readSettingsFile(dir,'desktop-settings-revision.json');
    const baselineText=await readSettingsFile(dir,'desktop-experiment-baseline.json');
    const baseline=baselineText?JSON.parse(baselineText):{};
    const previous=marker?JSON.parse(marker):{};
    const doc=parseDocument(original??'[]');
    if(doc.errors.length||!isSeq(doc.contents))throw fail('SOURCE_PROFILE_SETTINGS_INVALID');
    diagnosticState.retiredManagedProviders=previous.route&&previous.route!==route?[previous.route]:[];
    if(previous.fingerprint===fingerprint){
      for(const key of ['effectiveSpillBytes','effectiveSkillDescription'])if(Number.isFinite(previous.effective?.[key]))diagnosticState[key]=previous.effective[key];
      return;
    }
    // This marker owns only dedicated entries appended by this writer. Refuse
    // competing edits to them instead of deleting unrelated user patches.
    if(previous.owned) {
      for(const entry of previous.owned) {
        const index=doc.contents.items.findIndex(node=>isMap(node)&&JSON.stringify(node.toJSON())===JSON.stringify(entry));
        if(index<0)throw fail('SETTINGS_TRANSACTION_CONFLICT');
        doc.contents.items.splice(index,1);
      }
    }
    const owned=structuredClone(patch).map(row=>row.id==='llm-pi-ai'?{...row,config:{...row.config,providers:{[route]:cleanProvider}}}:row);
    for(const [modeKey,id,field,native,compact,stateKey] of [
      ['spillMode','spill-policy','maxInlineBytes',50000,24000,'effectiveSpillBytes'],
      ['skillMode','tool-skill','catalogDescriptionMaxLength',500,250,'effectiveSkillDescription']]){
      const mode=experimentModes[modeKey];
      const inherited=doc.contents.items.map(node=>node.toJSON()).filter(row=>row.id===id&&Object.hasOwn(row.config??{},field)).at(-1)?.config?.[field];
      if(mode&&mode!=='restore'&&!Object.hasOwn(baseline,modeKey))baseline[modeKey]={present:inherited!==undefined,value:inherited??null};
      const value=mode==='compact'?compact:mode==='native'?native:mode==='restore'&&baseline[modeKey]?.present?baseline[modeKey].value:undefined;
      if(value!==undefined)owned.push({id,config:{[field]:value}});
      diagnosticState[stateKey]=value??inherited??native;
    }
    owned.push({insert:[{id:'desktop-source-cache',name:new URL('./source-cache.mjs',import.meta.url).href,config:{providers:providers??{}}}]});
    for(const entry of owned)doc.contents.add(doc.createNode(entry));
    const effective={effectiveSpillBytes:diagnosticState.effectiveSpillBytes,effectiveSkillDescription:diagnosticState.effectiveSkillDescription};
    await transaction.commit({'cordis.patch.yml':String(doc),'desktop-settings-revision.json':JSON.stringify({schemaVersion:1,fingerprint,route,owned,effective}),
      'desktop-experiment-baseline.json':JSON.stringify(baseline)},
      {'cordis.patch.yml':original,'desktop-settings-revision.json':marker,'desktop-experiment-baseline.json':baselineText});
  });
  // Entries introduced by CLI overlays cannot be edited through SettingsForms.
  // All desktop plugins therefore live in the profile's own persisted layer.
  const launcher=[];
  const overlay=join(root,'desktop.source.patch.json');
  await writeFileAtomic(overlay,JSON.stringify(launcher,null,2),{mode:0o600});
  return ['--profile',sourceProfile,'--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'];
}
