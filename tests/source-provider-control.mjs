import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveSourceKeys,sourceCredential,sourceProviderControl,installSourceProviderControl} from '../runtime-src/source-provider-control.mjs';
test('private key snapshots are immutable and stale engine messages cannot mutate settings',async()=>{
  const ref='DSH_DESKTOP_PROVIDER_KEY_R900_'+'a'.repeat(32);receiveSourceKeys({[ref]:'synthetic-key'});
  assert.equal(sourceCredential(ref).value,'synthetic-key');assert.equal(process.env[ref],undefined);
  assert.throws(()=>receiveSourceKeys({[ref]:'different-key'}),/IMMUTABLE/);assert.equal(sourceCredential(ref).value,'synthetic-key');
  assert.throws(()=>receiveSourceKeys({OPENAI_API_KEY:'ambient'}),/INVALID/);
  let writes=0,dispose;const ctx={settings:{replace:async()=>writes++},effect:fn=>{dispose=fn();}};installSourceProviderControl(ctx);
  const prior=process.env.DSH_DESKTOP_SETTINGS_OWNER;process.env.DSH_DESKTOP_SETTINGS_OWNER='p-'+'b'.repeat(32);
  try{const responses=[];await sourceProviderControl({id:'c'.repeat(32),epoch:'p-'+'a'.repeat(32),revision:1},line=>responses.push(line));assert.equal(writes,0);assert.deepEqual(responses,[]);}finally{dispose();if(prior===undefined)delete process.env.DSH_DESKTOP_SETTINGS_OWNER;else process.env.DSH_DESKTOP_SETTINGS_OWNER=prior;}
});
