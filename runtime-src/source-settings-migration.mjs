import {readFile,lstat,mkdir,open,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {settingsTransaction,readSettingsFile} from './settings-transaction.mjs';
import {cacheKeyBridgeRequired} from './desktop-cache-key-bridge.mjs';

const fail=code=>Object.assign(Error(code),{code});
const hash=text=>createHash('sha256').update(text).digest('hex');
const map=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const aliases={'ui-developer-tools':'ui-settings','ui-onboarding':'ui-settings-general',shell:'pwsh-sandbox'};
async function optional(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function knownShape(value,id,refs){
  const node=refs[id];if(!node)return false;
  if(node.type==='union')return node.list.some(child=>knownShape(value,child,refs));
  if(node.type==='object')return map(value)&&Object.entries(value).every(([key,item])=>Object.hasOwn(node.dict??{},key)&&knownShape(item,node.dict[key],refs));
  if(node.type==='dict')return map(value)&&Object.values(value).every(item=>knownShape(item,node.inner,refs));
  if(node.type==='array')return Array.isArray(value)&&value.every(item=>knownShape(item,node.inner,refs));
  if(node.type==='const')return Object.is(value,node.value);
  return ['string','number','boolean'].includes(node.type)&&typeof value===node.type;
}

// Runs under the profile writer lock before the CLI starts. Original bytes are
// archived only after the complete validated profile transaction is durable.
export async function migrateSourceSettings({home,dir,load,require,writeFileAtomic,transactionOptions,installAnchor,patch=[],fault=async()=>{}}){
  if(await optional(join(home,'settings.yaml.imported')))throw fail('SOURCE_LEGACY_PARTIAL_IMPORT');
  const path=join(home,'settings.yaml'),stat=await optional(path);
  if(!stat)return false;
  if(await optional(path+'.lock'))throw fail('SOURCE_LEGACY_WRITER_LOCKED');
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw fail('SOURCE_LEGACY_SETTINGS_INVALID');
  const bytes=await readFile(path),original=bytes.toString('utf8'),digest=hash(original);
  if(bytes.length>2*1024*1024||!Buffer.from(original).equals(bytes))throw fail('SOURCE_LEGACY_SETTINGS_INVALID');
  const transaction=settingsTransaction(dir,writeFileAtomic,transactionOptions);await transaction.recover();
  const markerText=await readSettingsFile(dir,'desktop-legacy-migration.json');
  if(markerText){
    const marker=JSON.parse(markerText);
    if(marker.schemaVersion!==1||marker.sourceSha256!==digest)throw fail('SETTINGS_TRANSACTION_CONFLICT');
  }else{
    const {parseDocument,isSeq}=require('yaml');
    const legacy=parseDocument(original);
    if(legacy.errors.length||!map(legacy.toJS()))throw fail('SOURCE_LEGACY_SETTINGS_INVALID');
    const {loadProfileDirectory,composeEntries}=await load('@deepseek-ai/dsh-app-boot');
    const profile=loadProfileDirectory('DSHDesktop',dir,installAnchor,{userLayer:false});
    if(profile.layers.length!==2)throw fail('SOURCE_LEGACY_SETTINGS_INVALID');
    const entries=composeEntries([...profile.layers.map(layer=>layer.patches),patch.filter(row=>row.insert)]);
    const all=[];const visit=rows=>{for(const entry of rows){all.push(entry);if(Array.isArray(entry.group))visit(entry.group);}};visit(entries);
    const rows=[],cachePolicies={};
    for(const [section,values] of Object.entries(legacy.toJS())){
      const id=aliases[section]??section,entry=all.find(row=>row.id===id);
      if(!entry||!map(values)||typeof entry.name!=='string')throw fail('SOURCE_LEGACY_SECTION_UNSUPPORTED');
      // Inline secrets are never copied into a new settings document. A native
      // credentials-local reference or a Windows environment reference is kept.
      if(id==='llm-pi-ai'&&Object.values(values.providers??{}).some(p=>Object.hasOwn(p??{},'apiKey')))throw fail('SOURCE_LEGACY_SECRET_INLINE');
      if(id==='llm-pi-ai')for(const [provider,config] of Object.entries(values.providers??{})){
        if(!Object.hasOwn(config??{},'desktopCacheKey'))continue;
        try{cacheKeyBridgeRequired([{id,config:{providers:{[provider]:config}}}]);}catch{throw fail('SOURCE_LEGACY_SETTINGS_INVALID');}
        cachePolicies[provider]=config.desktopCacheKey;delete config.desktopCacheKey;
      }
      const module=await load(entry.name),schema=module.Config??module.default?.Config;
      if(typeof schema!=='function')throw fail('SOURCE_LEGACY_SECTION_UNSUPPORTED');
      const shape=schema.toJSON();
      if(!knownShape(values,shape.uid,shape.refs))throw fail('SOURCE_LEGACY_SECTION_UNSUPPORTED');
      let converted;try{converted=schema(values);}catch{throw fail('SOURCE_LEGACY_SETTINGS_INVALID');}
      // Schemas may ignore unknown fields. Refuse any loss instead of silently
      // accepting a partial import. Volatile wrappers expose the parsed value.
      const plain=value=>typeof value?.get==='function'?plain(value.get()):Array.isArray(value)?value.map(plain):map(value)?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v)])):value;
      const keeps=(before,after)=>map(before)?Object.entries(before).every(([k,v])=>Object.hasOwn(after??{},k)&&keeps(v,after[k])):Array.isArray(before)?Array.isArray(after)&&before.length===after.length&&before.every((v,i)=>keeps(v,after[i])):Object.is(before,after);
      if(!keeps(values,plain(converted)))throw fail('SOURCE_LEGACY_SECTION_UNSUPPORTED');
      rows.push({id,config:values});
    }
    const oldPatch=await readSettingsFile(dir,'cordis.patch.yml');
    const doc=parseDocument(oldPatch??'[]');
    if(doc.errors.length||!isSeq(doc.contents)||doc.contents.items.length)throw fail('SOURCE_LEGACY_PROFILE_CONFLICT');
    for(const row of rows)doc.contents.add(doc.createNode(row));
    await transaction.commit({'cordis.patch.yml':String(doc),'desktop-legacy-migration.json':JSON.stringify({schemaVersion:1,sourceSha256:digest,sections:rows.map(row=>row.id),cachePolicies,sessionWriter:4})},{'cordis.patch.yml':oldPatch,'desktop-legacy-migration.json':null});
  }
  await fault('profile-committed');
  if(hash(await readFile(path,'utf8'))!==digest)throw fail('SETTINGS_TRANSACTION_CONFLICT');
  const archive=join(home,'desktop-legacy-settings');
  const archiveStat=await optional(archive);
  if(archiveStat&&(!archiveStat.isDirectory()||archiveStat.isSymbolicLink()))throw fail('SOURCE_LEGACY_SETTINGS_INVALID');
  await mkdir(archive,{recursive:true,mode:0o700});
  const target=join(archive,'settings.yaml');
  if(await optional(target))throw fail('SOURCE_LEGACY_PROFILE_CONFLICT');
  const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
  await rename(path,target);
  await fault('legacy-archived');
  return true;
}
