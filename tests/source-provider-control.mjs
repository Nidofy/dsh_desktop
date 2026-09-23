import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveSourceKeys,sourceCredential,sourceProviderControl,installSourceProviderControl,sourceProviderPolicy} from '../runtime-src/source-provider-control.mjs';
test('private key snapshots are immutable and stale engine messages cannot mutate settings',async()=>{
  const ref='DSH_DESKTOP_PROVIDER_KEY_R900_'+'a'.repeat(32);receiveSourceKeys({[ref]:'synthetic-key'});
  assert.equal(sourceCredential(ref).value,'synthetic-key');assert.equal(process.env[ref],undefined);
  assert.throws(()=>receiveSourceKeys({[ref]:'different-key'}),/IMMUTABLE/);assert.equal(sourceCredential(ref).value,'synthetic-key');
  assert.throws(()=>receiveSourceKeys({OPENAI_API_KEY:'ambient'}),/INVALID/);
  let writes=0,dispose;const ctx={settings:{replace:async()=>writes++},effect:fn=>{dispose=fn();}};installSourceProviderControl(ctx);
  const prior=process.env.DSH_DESKTOP_SETTINGS_OWNER;process.env.DSH_DESKTOP_SETTINGS_OWNER='p-'+'b'.repeat(32);
  try{const responses=[];await sourceProviderControl({id:'c'.repeat(32),epoch:'p-'+'a'.repeat(32),revision:1},line=>responses.push(line));assert.equal(writes,0);assert.deepEqual(responses,[]);}finally{dispose();if(prior===undefined)delete process.env.DSH_DESKTOP_SETTINGS_OWNER;else process.env.DSH_DESKTOP_SETTINGS_OWNER=prior;}
});

test('policy follows immutable credential revision during settings publication and rollback',async()=>{
  const route='desktop-legacy',oldRef='DSH_DESKTOP_PROVIDER_KEY_R901_legacy',newRef='DSH_DESKTOP_PROVIDER_KEY_R902_legacy';
  const old={api:'openai-completions',apiKeyEnv:oldRef,models:[{id:'fixture'}],desktopCacheKey:{mode:'off',models:[]}};
  const next={...old,apiKeyEnv:newRef,desktopCacheKey:{mode:'session',models:['fixture']}};
  const values={'llm-pi-ai':{providers:{[route]:old}},'agent-default-model':{provider:route,model:'fixture'}};
  let midWrite=false,dispose;
  const settings={get:name=>values[name],replace:async(name,value)=>{
    if(name==='agent-default-model'&&value.reasoningEffort===42)throw Error('second write rejected');
    values[name]=value;
    if(name==='llm-pi-ai'&&value.providers[route].apiKeyEnv===newRef){midWrite=true;assert.equal(sourceProviderPolicy(route,newRef).desktopCacheKey.mode,'session');assert.equal(sourceProviderPolicy(route,oldRef).desktopCacheKey.mode,'off');}
  }};
  const ctx={settings,get:()=>settings,effect:fn=>{dispose=fn();}};installSourceProviderControl(ctx,{[route]:old});
  const prior=process.env.DSH_DESKTOP_SETTINGS_OWNER;const epoch='p-'+'d'.repeat(32);process.env.DSH_DESKTOP_SETTINGS_OWNER=epoch;
  try{
    const responses=[];await sourceProviderControl({id:'e'.repeat(32),epoch,revision:902,providers:{[route]:next},keys:{[newRef]:'synthetic'},selection:{provider:route,model:'fixture',reasoningEffort:42}},line=>responses.push(JSON.parse(line.slice(13))));
    assert(midWrite);assert.equal(responses[0].ok,false);assert.equal(values['llm-pi-ai'].providers[route].apiKeyEnv,oldRef);assert.equal(sourceProviderPolicy(route,oldRef).desktopCacheKey.mode,'off');
  }finally{dispose();if(prior===undefined)delete process.env.DSH_DESKTOP_SETTINGS_OWNER;else process.env.DSH_DESKTOP_SETTINGS_OWNER=prior;}
});
