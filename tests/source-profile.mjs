import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {prepareSourceProfile} from '../runtime-src/source-profile.mjs';
import {diagnosticState} from '../runtime-src/diagnostic-state.mjs';
const runtimeRoot=resolve(process.env.SOURCE_TEST_RUNTIME??'.build/source-qualification-s2/resources');
const {parse,stringify}=createRequire(join(runtimeRoot,'dsh/package.json'))('yaml');
// Synthetic values only; host integration exercises real Windows DPAPI separately.
const protection={protect:async b=>Buffer.from(b),unprotect:async b=>Buffer.from(b)};
async function fixture(){
  const root=await mkdtemp(resolve('.build/source-profile-')),home=join(root,'dsh');
  const provider={api:'openai-completions',apiKeyEnv:'DSH_DESKTOP_LLM_KEY',baseURL:'http://127.0.0.1:9/v1',models:[{id:'fixture'}],desktopCacheKey:{mode:'session',models:['fixture']}};
  const patch=[{id:'llm-pi-ai',config:{providers:{'desktop-internal':provider}}},{id:'agent-default-model',config:{provider:'desktop-internal',model:'fixture'}}];
  return {root,home,runtimeRoot,patch,transactionOptions:{protection},dir:join(home,'profiles/dsh-desktop')};
}
test('profile has editable provider reference, native fields survive restart and launcher has no overriding provider',async()=>{
  const f=await fixture(),args=await prepareSourceProfile(f);
  assert.equal(args[1],'dsh-desktop');assert(!args.includes('--from-default-profile'));
  const patchPath=join(f.dir,'cordis.patch.yml');
  const rows=parse(await readFile(patchPath,'utf8'));
  const provider=rows.find(r=>r.id==='llm-pi-ai').config.providers['desktop-internal'];
  assert.equal(provider.apiKeyEnv,'DSH_DESKTOP_LLM_KEY');assert(!Object.hasOwn(provider,'desktopCacheKey'));
  rows.push({id:'ui-theme',config:{preference:'dark',fontSize:16}});
  await writeFile(patchPath,stringify(rows));const before=await readFile(patchPath,'utf8');
  await prepareSourceProfile(f);assert.equal(await readFile(patchPath,'utf8'),before);
  const launcher=JSON.parse(await readFile(join(f.root,'desktop.source.patch.json'),'utf8'));
  assert(!launcher.some(r=>['llm-pi-ai','agent-default-model'].includes(r.id)));
  f.patch[0].config.providers['desktop-internal'].baseURL='http://127.0.0.1:8/v1';await prepareSourceProfile(f);
  assert.deepEqual(parse(await readFile(patchPath,'utf8')).find(r=>r.id==='ui-theme'),rows.at(-1));
});
test('unknown or legacy settings are refused before import and original bytes survive',async()=>{
  const f=await fixture();await mkdir(f.home);await writeFile(join(f.home,'settings.yaml'),'unknown: synthetic\n');
  await assert.rejects(prepareSourceProfile(f),{code:'SOURCE_LEGACY_SETTINGS_PENDING'});
  assert.equal(await readFile(join(f.home,'settings.yaml'),'utf8'),'unknown: synthetic\n');
});
test('profile transaction recovers after each durable interruption point',async()=>{
  for(const point of ['prepared','after:cordis.patch.yml','after:desktop-settings-revision.json','committed']){
    const f=await fixture();await prepareSourceProfile(f);
    f.patch[0].config.providers['desktop-internal'].baseURL='http://127.0.0.1:8/v1';
    await assert.rejects(prepareSourceProfile({...f,transactionOptions:{protection,fault:async phase=>{if(phase===point)throw Error('INTERRUPTED');}}}),/INTERRUPTED/);
    await prepareSourceProfile(f);
    const rows=parse(await readFile(join(f.dir,'cordis.patch.yml'),'utf8'));
    assert.equal(rows.filter(r=>r.id==='llm-pi-ai').length,1);
    assert.equal(rows.find(r=>r.id==='llm-pi-ai').config.providers['desktop-internal'].baseURL,'http://127.0.0.1:8/v1');
  }
});
test('competing edits stop a connection replacement and preserve the live profile',async()=>{
  const f=await fixture();await prepareSourceProfile(f);
  const path=join(f.dir,'cordis.patch.yml'),rows=parse(await readFile(path,'utf8'));
  rows[0].config.providers['desktop-internal'].models=[{id:'native-edit'}];await writeFile(path,stringify(rows));
  const before=await readFile(path,'utf8');f.patch[0].config.providers['desktop-internal'].baseURL='http://127.0.0.1:7/v1';
  await assert.rejects(prepareSourceProfile(f),{code:'SETTINGS_TRANSACTION_CONFLICT'});
  assert.equal(await readFile(path,'utf8'),before);
});
test('experiment restore retains a native profile override across restart',async()=>{
  const f=await fixture();await prepareSourceProfile(f);const path=join(f.dir,'cordis.patch.yml');
  const rows=parse(await readFile(path,'utf8'));rows.push({id:'spill-policy',config:{maxInlineBytes:32000}});await writeFile(path,stringify(rows));
  try{
    diagnosticState.preferences.spillMode='compact';await prepareSourceProfile(f);assert.equal(diagnosticState.effectiveSpillBytes,24000);
    diagnosticState.preferences.spillMode='restore';await prepareSourceProfile(f);assert.equal(diagnosticState.effectiveSpillBytes,32000);
    await prepareSourceProfile(f);assert.equal(diagnosticState.effectiveSpillBytes,32000);
  }finally{delete diagnosticState.preferences.spillMode;}
});
