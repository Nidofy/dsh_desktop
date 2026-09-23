import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
export const routeA='desktop-p-'+'a'.repeat(32),routeB='desktop-p-'+'b'.repeat(32);
const keyName=(revision,letter)=>'DSH_DESKTOP_PROVIDER_KEY_R'+revision+'_'+letter.repeat(32);
export function prepareHotFixture(patch){
  const original=patch[1].config.providers['desktop-internal'];
  patch[1].config.providers={
    [routeA]:{...original,displayName:'Same provider · A',apiKeyEnv:keyName(0,'a')},
    [routeB]:{...original,displayName:'Same provider · B',apiKeyEnv:keyName(0,'b')},
  };
  patch.find(row=>row.id==='agent-default-model').config.provider=routeA;
  for(const row of patch)for(const item of row.insert??[]){if(item.id==='desktop-model-defaults')item.config.provider=routeA;if(item.id==='desktop-observability')item.config.managedProvider=routeA;}
  return {[keyName(0,'a')]:'desktop-test-key',[keyName(0,'b')]:'desktop-test-key'};
}
const wait=async condition=>{const end=Date.now()+20000;while(!condition()){if(Date.now()>end)throw Error('Hot provider wait timed out');await new Promise(r=>setTimeout(r,50));}};
export async function runSourceProviderWire({protocol,patch,overlay,requests,rpc,api,prompt,home,dataHome,control,start,stop,setMode,held,release,setStartKeys,pid}){
  const initialPid=pid(),original=structuredClone(patch[1].config.providers),model=original[routeA].models[0].id;
  const catalog=await rpc('session/modelCatalog');assert(catalog.groups.some(g=>g.id===routeA));assert(catalog.groups.some(g=>g.id===routeB));
  assert.equal(catalog.groups.find(g=>g.id===routeA).models[0].id,catalog.groups.find(g=>g.id===routeB).models[0].id);
  const session=await rpc('session/create',{cwd:home});await rpc('session/selectModel',{sessionId:session.sessionId,provider:routeA,model});
  const boundary=requests.length;setMode('hot-hold');const inFlight=prompt(session.sessionId,1);await wait(held);
  const oldRecord=(await api('snapshot')).records.findLast(row=>row.status==='running'&&row.purpose==='conversation');assert(oldRecord);
  function config(revision,empty=false){
    const providers=structuredClone(original),keys={};
    for(const [route,letter] of [[routeA,'a'],[routeB,'b']]){
      providers[route].baseURL=original[route].baseURL.replace(/\/(v1)?$/,'')+'/r'+revision+(protocol==='openai'?'/v1':'');
      providers[route].apiKeyEnv=keyName(revision,letter);keys[keyName(revision,letter)]=empty?'':'hot-key-'+revision;
    }
    return {revision,providers,keys,selection:{provider:routeA,model}};
  }
  const second=config(1);assert.equal((await control(second)).ok,true);assert.equal(pid(),initialPid);
  assert.equal((await api('snapshot')).records.find(row=>row.id===oldRecord.id).fingerprint.config,oldRecord.fingerprint.config,'a previous request retains its generation fingerprint');
  setMode('normal');release();await inFlight;
  const rows=requests.slice(boundary).filter(row=>!row.isTitle);assert(rows[0].path.startsWith('/v1')||!rows[0].path.includes('/r1/'));
  assert(rows.some(row=>row.path.includes('/r1/')),'subsequent request uses the new endpoint within the same agent turn');
  await prompt(session.sessionId,2);assert(requests.at(-1).path.includes('/r1/'));
  await rpc('session/selectModel',{sessionId:session.sessionId,provider:routeB,model});await prompt(session.sessionId,3);
  assert.equal((await control(second)).ok,false,'stale revision refused');
  const invalid=config(2);invalid.selection.model='absent';assert.equal((await control(invalid)).ok,false);
  const rollback=config(2);rollback.selection.reasoningEffort=42;assert.equal((await control(rollback)).ok,false,'second profile write fails and rolls back the first');
  const revoked=config(3,true);assert.equal((await control(revoked)).ok,true);const beforeRevoked=requests.length;
  await prompt(session.sessionId,4);assert.equal(requests.length,beforeRevoked,'empty credential fails before sending a model request');
  const restored=config(4);assert.equal((await control(restored)).ok,true);await prompt(session.sessionId,5);assert(requests.at(-1).path.includes('/r4/'));
  patch[1].config.providers=restored.providers;patch.find(row=>row.id==='agent-default-model').config=restored.selection;writeFileSync(overlay,JSON.stringify(patch));setStartKeys(restored.keys);
  const beforeRestart=requests.length;await stop();await start();assert.equal(requests.length,beforeRestart,'restart does not replay a request');
  await prompt(session.sessionId,6);assert(requests.at(-1).path.includes('/r4/'));
  for(const file of ['profiles/dsh-desktop/cordis.patch.yml','.credentials.yaml'])if(existsSync(join(dataHome,file)))assert(!readFileSync(join(dataHome,file),'utf8').includes('hot-key-'),'Windows key never enters YAML');
  return {protocol,status:'PASS',sameModelTwoProviders:true,inFlightSnapshot:true,nextRequest:true,pidUnchanged:true,emptyCredentialRefused:true,staleRevisionRefused:true,invalidSelectionRefused:true,partialWriteRollback:true,keysNotInYaml:true,restartPersistence:true};
}
