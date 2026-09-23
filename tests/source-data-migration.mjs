import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {migrateWorkspaceHistory} from '../runtime-src/workspace-migration.mjs';
import {prepareSourceProfile} from '../runtime-src/source-profile.mjs';
const oldRuntime=resolve(process.env.LEGACY_TEST_RUNTIME??'runtime'),runtimeRoot=resolve(process.env.SOURCE_TEST_RUNTIME??'.build/source-qualification-s2/resources');
const loadFrom=root=>{const require=createRequire(join(root,'dsh/package.json'));return id=>import(pathToFileURL(require.resolve(id)).href);};
const old=loadFrom(oldRuntime),next=loadFrom(runtimeRoot);
const protection={protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>Buffer.from(bytes)};
async function backend(load,root){const {Context}=await load('@deepseek-ai/cordis'),{default:Plugin}=await load('@deepseek-ai/dsh-session-persistence-jsonl');const ctx=new Context();await ctx.plugin(Plugin,{root,compression:'zstd'});return ctx;}
async function inventory(root,relative='',result={}){for(const entry of await readdir(join(root,relative),{withFileTypes:true})){const name=join(relative,entry.name);if(entry.isDirectory())await inventory(root,name,result);else result[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');}return result;}
const events=[{type:'turn/start',seq:0,time:2,data:{turn:1}},{type:'turn/end',seq:1,time:3,data:{turn:1,reason:{kind:'completed'}}}];

test('real v3 writer copy migrates to v4, continues and restores an independent v3 downgrade copy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-source-migration-')),source=join(root,'source'),backup=join(root,'backup'),candidate=join(root,'candidate'),project=join(root,'isolated-project');
  await mkdir(project);await writeFile(join(project,'AGENTS.md'),'Synthetic migration rules');await mkdir(join(project,'.claude'));await writeFile(join(project,'.claude/CLAUDE.md'),'Synthetic nested rules');
  const home=join(source,'dsh');await mkdir(home,{recursive:true});
  const oldCtx=await backend(old,join(home,'sessions'));
  try{const handle=await oldCtx.sessionPersistence.create({id:'migration-main',version:3,createdAt:1,cwd:project,delegationDepth:0,isSeeded:false});await handle.append(events);await handle.flush();await handle.close();}finally{await oldCtx.fiber.dispose();}
  await writeFile(join(home,'settings.yaml'),'ui-theme:\n  preference: dark\n');
  await mkdir(join(home,'skills/migration-fixture'),{recursive:true});await writeFile(join(home,'skills/migration-fixture/SKILL.md'),'Synthetic skill');
  await mkdir(join(home,'attachments'));await writeFile(join(home,'attachments/fixture.txt'),'Synthetic attachment');
  await mkdir(join(home,'storages'));const document={unit:{name:'workspace',version:2},global:{workspaceIds:['w1'],archivedSessionIds:['migration-main'],initialized:true},tables:{workspaces:{w1:{path:project,name:'Original',sessionIds:['migration-main']}}}};
  await writeFile(join(home,'storages/workspace.json'),JSON.stringify(document));
  const second=join(source,'profiles/p-'+'a'.repeat(32),'dsh');await mkdir(join(second,'storages'),{recursive:true});
  await writeFile(join(second,'storages/workspace.json'),JSON.stringify({...document,global:{...document.global,workspaceIds:['w2']},tables:{workspaces:{w2:{...document.tables.workspaces.w1,name:'Duplicate'}}}}));
  const before=await inventory(source),projectBefore=await inventory(project);
  await cp(source,backup,{recursive:true,errorOnExist:true,force:false});await cp(backup,candidate,{recursive:true,errorOnExist:true,force:false});
  await migrateWorkspaceHistory({root:candidate,home:join(candidate,'dsh')});
  await prepareSourceProfile({root:candidate,home:join(candidate,'dsh'),runtimeRoot,patch:[],transactionOptions:{protection}});
  const sessions=join(candidate,'dsh/sessions'),historical=await inventory(sessions);
  let ctx=await backend(next,sessions);
  try{
    const reader=await ctx.sessionPersistence.open('migration-main','read');assert.equal(reader.header.version,4);assert.deepEqual((await reader.read()).events,events);await reader.close();assert.deepEqual(await inventory(sessions),historical);
    const writer=await ctx.sessionPersistence.open('migration-main','write');await writer.append([{type:'turn/start',seq:2,time:4,data:{turn:2}},{type:'turn/end',seq:3,time:5,data:{turn:2,reason:{kind:'completed'}}}]);await writer.flush();await writer.close();
  }finally{await ctx.fiber.dispose();}
  ctx=await backend(next,sessions);try{const reader=await ctx.sessionPersistence.open('migration-main','read');assert.equal((await reader.read()).events.length,4);await reader.close();}finally{await ctx.fiber.dispose();}
  const after=await inventory(sessions);for(const [name,digest] of Object.entries(historical))assert.equal(after[name],digest);
  assert(Object.keys(after).some(name=>name.endsWith('session.v4.jsonl.zstd')));
  const migrated=JSON.parse(await readFile(join(candidate,'dsh/storages/workspace.json')));assert.deepEqual(migrated.global.workspaceIds,['w1']);assert.deepEqual(migrated.global.archivedSessionIds,['migration-main']);
  for(const name of ['dsh/attachments/fixture.txt','dsh/skills/migration-fixture/SKILL.md'])assert.deepEqual(await readFile(join(candidate,name)),await readFile(join(source,name)));
  assert.deepEqual(await inventory(source),before);assert.deepEqual(await inventory(backup),before);assert.deepEqual(await inventory(project),projectBefore);
  const restored=join(root,'restored-v3');await cp(backup,restored,{recursive:true,errorOnExist:true,force:false});
  const restoredCtx=await backend(old,join(restored,'dsh/sessions'));try{const reader=await restoredCtx.sessionPersistence.open('migration-main','read');assert.equal(reader.header.version,3);assert.deepEqual((await reader.read()).events,events);await reader.close();}finally{await restoredCtx.fiber.dispose();}
  await writeFile(join(root,'report.json'),JSON.stringify({status:'PASS',sessionReadOnlyNoWrite:true,immutableV3:true,v4Continuation:true,downgradeFromBackup:true,sharedWorkspaceDeduplicated:true,sourceAndProjectUnchanged:true},null,2));
  console.log('Migration evidence: '+root);
});

test('unknown session generation refuses opening without rewriting historical data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-source-future-')),dir=join(root,'_no-cwd/future');await mkdir(dir,{recursive:true});
  const {zstdCompressSync}=await import('node:zlib');await writeFile(join(dir,'session.v99.jsonl.zstd'),zstdCompressSync(Buffer.from(JSON.stringify({type:'session',id:'future',version:99,createdAt:1,isSeeded:false,delegationDepth:0})+'\n')));
  const before=await inventory(root),ctx=await backend(next,root);try{await assert.rejects(ctx.sessionPersistence.open('future','write'));}finally{await ctx.fiber.dispose();}assert.deepEqual(await inventory(root),before);
});
