import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export async function runCacheKeyWire({protocol,api,rpc,prompt,start,stop,patch,overlay,requests,home}) {
  const original = structuredClone(patch[1].config.providers['desktop-internal']);
  const outcomes = [];
  async function configure(variant) {
    await stop();
    const source = JSON.parse(readFileSync(join('.build/cache-profile-fixtures',protocol,variant,'desktop.patch.json'),'utf8'));
    patch[1].config.providers['desktop-internal'] = {...source[1].config.providers['desktop-internal'],baseURL:original.baseURL};
    writeFileSync(overlay,JSON.stringify(patch)); await start();
  }
  async function probe(model) {
    const state = await api('cache/state'), boundary = requests.length;
    await api('cache/start',{model:model??state.models[0].id,fingerprint:state.fingerprint,inputBytes:2048,requests:4,accepted:true},202);
    const deadline = Date.now()+20000;let current;
    do { await new Promise(r=>setTimeout(r,100)); current=(await api('cache/state')).current; } while(current.status==='RUNNING'&&Date.now()<deadline);
    assert.equal(current.status,'COMPLETED',JSON.stringify(current));
    const rows=requests.slice(boundary);assert.equal(rows.length,4);assert.equal(rows[0].raw,rows[1].raw);assert.equal(rows[2].raw,rows[3].raw);
    return rows;
  }
  for(const variant of protocol==='openai'?['automatic','long','short-markers','key-only','key-long','key-markers','off-long']:['automatic','long']) {
    await configure(variant); const rows=await probe();
    for(const {body,raw} of rows) {
      const keyed=variant.startsWith('key-');
      if(keyed)assert.match(body.prompt_cache_key,/^dsh_[A-Za-z0-9_-]{43}$/);
      else if(variant==='long'&&protocol==='openai')assert(body.prompt_cache_key,'legacy long remains compatible');
      else assert.equal(body.prompt_cache_key,undefined);
      const long=['long','key-long','off-long'].includes(variant);
      if(protocol==='openai')assert.equal(body.prompt_cache_retention,long?'24h':undefined);
      if(variant==='automatic'||variant==='key-only')assert(!raw.includes('cache_control'));
      if(variant.endsWith('markers')){assert(raw.includes('cache_control'));assert(!raw.includes('"ttl"'));}
      if(protocol==='anthropic'&&long)assert(raw.includes('"ttl":"1h"'));
    }
    if(variant.startsWith('key-'))assert.notEqual(rows[0].body.prompt_cache_key,rows[2].body.prompt_cache_key,'probe groups use distinct keys');
    if(variant==='key-long')for(const {body} of await probe('glm-5.3')){assert.equal(body.prompt_cache_key,undefined,'unselected model suppresses even native long key');assert.equal(body.prompt_cache_retention,'24h');}
    outcomes.push({variant,status:'PASS'});console.log('PASS '+protocol+' independent key wire: '+variant);
  }
  if(protocol==='openai') {
    await configure('key-only');
    const {sessionId}=await rpc('session/create',{cwd:home});
    await rpc('session/selectModel',{sessionId,provider:'desktop-internal',model:'glm-5.3-flash',reasoningEffort:'low'});
    let boundary=requests.length;await prompt(sessionId,1);
    const first=requests.slice(boundary).filter(r=>!r.isTitle);assert(first.length>=2,'native tool loop');
    const key=first[0].body.prompt_cache_key;assert.match(key,/^dsh_[A-Za-z0-9_-]{43}$/);
    for(const r of first)assert.equal(r.body.prompt_cache_key,key);
    assert(first.some(r=>r.toolResults.length));
    await stop();await start();boundary=requests.length;await prompt(sessionId,2);
    const resumed=requests.slice(boundary).filter(r=>!r.isTitle);assert(resumed.length);
    for(const r of resumed)assert.equal(r.body.prompt_cache_key,key,'restart/next turn preserves session key');
    const other=await rpc('session/create',{cwd:home});boundary=requests.length;await prompt(other.sessionId,1);
    const otherRequest=requests.slice(boundary).find(r=>!r.isTitle);assert.match(otherRequest.body.prompt_cache_key,/^dsh_/);assert.notEqual(otherRequest.body.prompt_cache_key,key);
    outcomes.push({variant:'native-tool-loop-and-restart-isolation',status:'PASS'});
    console.log('PASS openai independent key wire: real native tool loop, next turn, restart and session isolation');
  }
  return outcomes;
}
