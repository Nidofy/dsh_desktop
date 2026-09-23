import {readFile,mkdir,rename,open} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {sourceProbeArguments,sourceProfile} from './harness-adapter.mjs';
import {settingsTransaction,readSettingsFile} from './settings-transaction.mjs';
import {diagnosticState} from './diagnostic-state.mjs';
import {migrateSourceSettings} from './source-settings-migration.mjs';

const fail=code=>Object.assign(Error(code),{code});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Profile settings remain the live writer. Launcher patches supply plugin entries,
// while desktop connection fields are persisted only when their revision changes.
export async function prepareSourceProfile({root,home,runtimeRoot,patch,transactionOptions}) {
  const args=await sourceProbeArguments({root,home});
  const require=createRequire(join(runtimeRoot,'dsh/package.json'));
  const load=id=>import(id.startsWith('file:')?id:pathToFileURL(require.resolve(id)).href);
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
  const cleanProviders=structuredClone(providers??{});
  for(const item of Object.values(cleanProviders))delete item.desktopCacheKey;
  const experimentModes={spillMode:diagnosticState.preferences.spillMode,skillMode:diagnosticState.preferences.skillMode};
  const documentsDirectory=join(root,'workspace');
  const fingerprint=hash({profileSchema:2,patch,experimentModes,documentsDirectory});
  diagnosticState.effectiveSpillBytes=experimentModes.spillMode==='compact'?24000:50000;
  diagnosticState.effectiveSkillDescription=experimentModes.skillMode==='compact'?250:500;
  diagnosticState.managedProvider=route;
  diagnosticState.managedModels=provider?{provider:route,models:provider.models.map(model=>model.id),defaultModel:selection.model}:undefined;
  diagnosticState.providerConfiguration=provider?JSON.stringify(provider):undefined;
  diagnosticState.overlayHash=hash(patch);
  const lockTarget=join(dir,'package.json');
  await withFileLock(lockTarget,async()=>{
    const owner=process.env.DSH_DESKTOP_SETTINGS_OWNER;
    if(/^p-[a-f0-9]{32}$/.test(owner??'')){
      const lock=await open(lockTarget+'.lock','r+');try{await lock.writeFile('DSHDesktop-startup:'+owner);await lock.sync();}finally{await lock.close();}
    }
    const transaction=settingsTransaction(dir,writeFileAtomic,transactionOptions);await transaction.recover();
    await migrateSourceSettings({home,dir,load,require,writeFileAtomic,transactionOptions,patch,installAnchor:join(runtimeRoot,'dsh/package.json')});
    const original=await readSettingsFile(dir,'cordis.patch.yml');
    const marker=await readSettingsFile(dir,'desktop-settings-revision.json');
    const baselineText=await readSettingsFile(dir,'desktop-experiment-baseline.json');
    const baseline=baselineText?JSON.parse(baselineText):{};
    const previous=marker?JSON.parse(marker):{};
    const doc=parseDocument(original??'[]');
    if(doc.errors.length||!isSeq(doc.contents))throw fail('SOURCE_PROFILE_SETTINGS_INVALID');
    const oldRoutes=Object.keys(previous.owned?.find(row=>row.id==='llm-pi-ai')?.config?.providers??{});
    diagnosticState.retiredManagedProviders=[...new Set([...(previous.retiredProviders??[]),...oldRoutes,...(previous.route?[previous.route]:[])])].filter(id=>id!==route&&!Object.hasOwn(providers??{},id));
    if(previous.fingerprint===fingerprint){
      for(const key of ['effectiveSpillBytes','effectiveSkillDescription'])if(Number.isFinite(previous.effective?.[key]))diagnosticState[key]=previous.effective[key];
      return;
    }
    const nativeSelection=doc.contents.items.map(node=>node.toJSON()).filter(row=>row.id==='agent-default-model').at(-1)?.config;
    const sameModel=nativeSelection?.provider===selection?.provider&&nativeSelection?.model?.replace(/\[1m\]$/i,'')===selection?.model;
    const preservedEffort=sameModel&&['off','minimal','low','medium','high','xhigh','max'].includes(nativeSelection?.reasoningEffort)?nativeSelection.reasoningEffort:undefined;
    // This marker owns only dedicated entries appended by this writer. Refuse
    // competing edits to them instead of deleting unrelated user patches.
    let nativeProviders={};
    if(previous.owned) {
      for(const entry of previous.owned) {
        let index=doc.contents.items.findIndex(node=>isMap(node)&&JSON.stringify(node.toJSON())===JSON.stringify(entry));
        if(index<0&&(entry.id==='agent-default-model'||(/^desktop-(legacy|p-[a-f0-9]{32})$/.test(previous.route??'')&&entry.id==='llm-pi-ai'))){
          index=doc.contents.items.findLastIndex(node=>isMap(node)&&node.toJSON().id===entry.id);
          if(index>=0&&entry.id==='llm-pi-ai')nativeProviders=Object.fromEntries(Object.entries(doc.contents.items[index].toJSON().config?.providers??{}).filter(([id])=>!/^desktop-(legacy|p-[a-f0-9]{32})$/.test(id)));
        }
        if(index<0)throw fail('SETTINGS_TRANSACTION_CONFLICT');
        doc.contents.items.splice(index,1);
      }
    }
    const inheritedProviders={...(doc.contents.items.map(node=>node.toJSON()).filter(row=>row.id==='llm-pi-ai').at(-1)?.config?.providers??{}),...nativeProviders};
    const owned=structuredClone(patch).map(row=>row.id==='llm-pi-ai'?{...row,config:{...row.config,providers:{...inheritedProviders,...cleanProviders}}}:row);
    if(preservedEffort)owned.find(row=>row.id==='agent-default-model').config.reasoningEffort=preservedEffort;
    // First-use UI initialization resolves Documents independently of cwd. Keep
    // its newly created workspace in this candidate; registered paths are untouched.
    owned.push({id:'workspace-controller',config:{documentsDirectory}});
    owned.push({id:'credentials',disabled:true});
    owned.push({insert:[{id:'desktop-source-credentials',name:new URL('./source-credentials.mjs',import.meta.url).href}]});
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
    const legacyText=await readSettingsFile(dir,'desktop-legacy-migration.json');
    const legacyPolicies=legacyText?JSON.parse(legacyText).cachePolicies??{}:{};
    const cacheProviders=Object.fromEntries(Object.entries(inheritedProviders).map(([id,config])=>[id,{...config,...(legacyPolicies[id]?{desktopCacheKey:legacyPolicies[id]}:{})}]));
    owned.push({insert:[{id:'desktop-source-cache',name:new URL('./source-cache.mjs',import.meta.url).href,config:{providers:{...cacheProviders,...providers}}}]});
    for(const entry of owned)doc.contents.add(doc.createNode(entry));
    const effective={effectiveSpillBytes:diagnosticState.effectiveSpillBytes,effectiveSkillDescription:diagnosticState.effectiveSkillDescription};
    await transaction.commit({'cordis.patch.yml':String(doc),'desktop-settings-revision.json':JSON.stringify({schemaVersion:1,fingerprint,route,owned,effective,retiredProviders:diagnosticState.retiredManagedProviders}),
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
