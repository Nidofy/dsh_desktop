import {copyFile,lstat,mkdir,readdir,readFile,link,unlink,open} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {writeAtomic} from './project-actions.mjs';

const profileId=/^p-[a-f0-9]{32}$/;
export const workspaceMigration={migrationId:'desktop-shared-workspace-v2',sourceVersion:2,targetVersion:2,repairId:'duplicate-path-v1'};
const incompatible=()=>Object.assign(Error('Unsupported workspace storage version'),{code:'WORKSPACE_VERSION_UNSUPPORTED'});
async function optionalStat(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function regular(path){const info=await optionalStat(path);if(info && (info.isSymbolicLink() || !info.isFile()))throw Error('Migration source is not a regular file');return info;}
async function hash(path){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
async function safeParents(root,relative){
  let path=root;
  for(const part of dirname(relative).split(/[\\/]/).filter(p=>p!=='.')){
    path=join(path,part);const info=await optionalStat(path);
    if(info && (!info.isDirectory() || info.isSymbolicLink()))throw Error('Linked destination refused');
  }
}
async function copyMissing(source,target){
  const info=await regular(source);if(!info)return false;
  const present=await regular(target);
  if(present){if(info.size!==present.size || await hash(source)!==await hash(target))throw Error('Existing workspace history conflicts with an older connection');return false;}
  await mkdir(dirname(target),{recursive:true});
  const temporary=join(dirname(target),'.migration-'+randomUUID());
  try {
    await copyFile(source,temporary,constants.COPYFILE_EXCL);
    const file=await open(temporary,'r+');try{await file.sync();}finally{await file.close();}
    await link(temporary,target);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return true;
}
async function collect(root,relative='',out=[]){
  const dir=join(root,relative),info=await optionalStat(dir);if(!info)return out;
  if(!info.isDirectory() || info.isSymbolicLink())throw Error('Linked migration directory refused');
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(out.length>200000)throw Error('Too many files to migrate');
    const name=join(relative,entry.name);
    if(entry.isSymbolicLink())throw Error('Linked migration file refused');
    if(entry.isDirectory())await collect(root,name,out);
    else if(entry.isFile() && !entry.name.startsWith('.') && !entry.name.endsWith('.lock'))out.push(name);
  }
  return out;
}
async function workspaceDocument(path){
  const info=await regular(path);if(!info)return null;if(info.size>16*1024*1024)throw Error('Workspace list too large');
  const data=JSON.parse(await readFile(path,'utf8'));
  if(data?.unit?.name!=='workspace' || data.unit.version!==workspaceMigration.sourceVersion)throw incompatible();
  if(!Array.isArray(data.global?.workspaceIds) || !data.tables?.workspaces || typeof data.tables.workspaces!=='object' || Array.isArray(data.tables.workspaces))throw Error('Unsupported workspace list');
  return data;
}
export function mergeWorkspaces(current,incoming){
  if(!current)return reconcileWorkspaces(incoming);
  if(current.global.pendingMutation || incoming.global.pendingMutation)throw Error('Workspace mutation must recover before migration');
  const next=structuredClone(current);
  for(const [id,row] of Object.entries(incoming.tables.workspaces)){
    if(Object.hasOwn(next.tables.workspaces,id)){
      const existing=next.tables.workspaces[id];
      if(existing.path!==row.path)throw Error('Workspace identity refers to different paths');
      // Keep the current title/order, but retain sessions from both homes.
      existing.sessionIds=[...new Set([...(existing.sessionIds??[]),...(row.sessionIds??[])])];
      continue;
    }
    Object.defineProperty(next.tables.workspaces,id,{value:row,enumerable:true,writable:true,configurable:true});
  }
  for(const key of ['workspaceIds','archivedSessionIds'])next.global[key]=[...new Set([...(current.global[key]??[]),...(incoming.global[key]??[])])];
  next.global.initialized=current.global.initialized && incoming.global.initialized;
  return reconcileWorkspaces(next);
}

// DSH identifies directories by exact equality of its stored realpath. IDs
// generated independently in old connection homes are not directory identities.
export function reconcileWorkspaces(document){
  const next=structuredClone(document),table=next.tables.workspaces;
  const order=[...new Set([...next.global.workspaceIds,...Object.keys(table)])];
  const paths=new Map(),aliases=new Map();
  for(const id of order){
    if(!Object.hasOwn(table,id))throw Error('Workspace order references a missing record');
    const row=table[id];
    if(typeof row.path!=='string' || !row.path || (row.sessionIds!==undefined && (!Array.isArray(row.sessionIds) || row.sessionIds.some(s=>typeof s!=='string'))))throw Error('Malformed workspace record');
    const keeper=paths.get(row.path);
    if(keeper===undefined){paths.set(row.path,id);continue;}
    if(next.global.pendingMutation)throw Error('Workspace mutation must recover before duplicate repair');
    table[keeper].sessionIds=[...new Set([...(table[keeper].sessionIds??[]),...(row.sessionIds??[])])];
    aliases.set(id,keeper);delete table[id];
  }
  if(!aliases.size)return next;
  next.global.workspaceIds=[...new Set(order.map(id=>aliases.get(id)??id))];
  const owners=new Map();
  for(const [id,row] of Object.entries(table))for(const session of row.sessionIds??[]){
    if(owners.has(session) && owners.get(session)!==id)throw Error('Session belongs to different workspace paths');
    owners.set(session,id);
  }
  return next;
}

async function repairWorkspaceDuplicates(home){
  await safeParents(home,'storages/workspace.json');
  const file=join(home,'storages','workspace.json'),current=await workspaceDocument(file);
  if(!current)return 0;
  const next=reconcileWorkspaces(current);
  if(JSON.stringify(current)===JSON.stringify(next))return 0;
  // Preserve the exact damaged document before publishing the repaired table.
  const backup=join('desktop-workspace-repairs',`${Date.now()}-${randomUUID()}.json`);
  await safeParents(home,backup);
  await copyMissing(file,join(home,backup));
  await writeAtomic(file,JSON.stringify(next,null,2));
  return Object.keys(current.tables.workspaces).length-Object.keys(next.tables.workspaces).length;
}
// Runs only after the previous engine has stopped, before the new CLI boots.
// Old profile homes remain intact; a completed source is never re-imported.
export async function migrateWorkspaceHistory({root,home,repairDuplicates=false}){
  if(!root)return {migrated:0};
  if(resolve(home)!==resolve(root,'dsh'))throw Error('Shared workspace home mismatch');
  await mkdir(home,{recursive:true});
  const statePath=join(home,'desktop-workspace-migration.json');
  let state={version:2,migrationId:workspaceMigration.migrationId,completed:[],repairs:[]};
  const stateInfo=await regular(statePath);
  if(stateInfo){
    if(stateInfo.size>1024*1024)throw Error('Migration record too large');
    state=JSON.parse(await readFile(statePath,'utf8'));
    if(![1,2].includes(state.version) || !Array.isArray(state.completed) || state.completed.length>10000 || state.completed.some(id=>typeof id!=='string'||!profileId.test(id)))throw Error('Invalid migration record');
    if(state.version===1)state={...state,version:2,migrationId:workspaceMigration.migrationId,repairs:[]};
    if(state.migrationId!==workspaceMigration.migrationId || !Array.isArray(state.repairs) || state.repairs.some(id=>id!==workspaceMigration.repairId))throw Error('Invalid migration record');
  }
  // Validate every participating format before any repair, copy or checkpoint.
  // A future source must not cause partial writes to today's shared home.
  await safeParents(home,'storages/workspace.json');
  await workspaceDocument(join(home,'storages','workspace.json'));
  const profiles=join(root,'profiles');const info=await optionalStat(profiles);
  if(info && (info.isSymbolicLink() || !info.isDirectory()))throw Error('Invalid profiles directory');
  const entries=info?(await readdir(profiles,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)):[];
  for(const entry of entries){
    if(!profileId.test(entry.name)||state.completed.includes(entry.name))continue;
    if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Invalid profile directory');
    const source=join(profiles,entry.name,'dsh');const si=await optionalStat(source);if(!si)continue;
    if(!si.isDirectory()||si.isSymbolicLink())throw Error('Invalid profile home');
    await safeParents(source,'storages/workspace.json');
    await workspaceDocument(join(source,'storages','workspace.json'));
  }
  let repaired=0;
  if(repairDuplicates||!state.repairs.includes(workspaceMigration.repairId)){
    repaired=await repairWorkspaceDuplicates(home);
    state.repairs=[workspaceMigration.repairId];
    await writeAtomic(statePath,JSON.stringify(state));
  }
  let migrated=0;
  for(const entry of entries){
    if(!profileId.test(entry.name) || state.completed.includes(entry.name))continue;
    if(!entry.isDirectory() || entry.isSymbolicLink())throw Error('Invalid profile directory');
    const source=join(profiles,entry.name,'dsh');const sourceInfo=await optionalStat(source);if(!sourceInfo)continue;
    if(!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())throw Error('Invalid profile home');
    const workspacePath=join(home,'storages','workspace.json');
    const incoming=await workspaceDocument(join(source,'storages','workspace.json'));
    const current=await workspaceDocument(workspacePath);
    const merged=incoming?mergeWorkspaces(current,incoming):null;
    const files=[];
    for(const dir of ['sessions','attachments'])for(const relative of await collect(join(source,dir)))files.push(join(dir,relative));
    // Validate all collisions before publishing anything from this source.
    for(const relative of [...files,'storages/workspace.json'])await safeParents(home,relative);
    for(const relative of files){const from=join(source,relative),to=join(home,relative),present=await regular(to);if(present && ((await regular(from)).size!==present.size || await hash(from)!==await hash(to)))throw Error('Existing workspace history conflicts with an older connection');}
    for(const relative of files)await copyMissing(join(source,relative),join(home,relative));
    if(incoming){
      await mkdir(dirname(workspacePath),{recursive:true});
      if(current && !await optionalStat(join(home,'desktop-workspace-before-migration.json')))await copyMissing(workspacePath,join(home,'desktop-workspace-before-migration.json'));
      await writeAtomic(workspacePath,JSON.stringify(merged,null,2));
    }
    // Fresh installations with only profile homes retain their UI/plugin
    // settings. Existing shared settings remain authoritative.
    for(const name of ['settings.yaml','.credentials.yaml','desktop-appearance.json'])if(!await optionalStat(join(home,name)))await copyMissing(join(source,name),join(home,name));
    state.completed.push(entry.name);await writeAtomic(statePath,JSON.stringify(state));migrated++;
  }
  return {migrated,repaired};
}
