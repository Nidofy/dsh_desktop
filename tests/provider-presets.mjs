// Load the Rust-generated presets through the real DSH registry, without API requests.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {isSourceRuntime,sourceEnvironment,fixtureBase} from './runtime-fixture.mjs';
const presets=JSON.parse(await readFile('src-tauri/generated/provider-catalog.json','utf8'));
const runtime=resolve(process.argv[2]??'runtime');await mkdir(fixtureBase(),{recursive:true});
const fixture=await mkdtemp(join(fixtureBase(),'provider-catalog-wire-')),root=isSourceRuntime(runtime)?join(fixture,'c-'+crypto.randomUUID().replaceAll('-','')):fixture;await mkdir(root,{recursive:true});
const providers={};
for(const p of presets){
  const overlay=JSON.parse(await readFile(join('.build/provider-presets',p.id,'desktop.patch.json'),'utf8'));
  providers[p.id]=overlay[1].config.providers[p.id];
}
const overlay=join(root,'desktop.patch.json');
await writeFile(overlay,JSON.stringify([{id:'session-telemetry-otel',disabled:true},{id:'llm-pi-ai',config:{providers}}]));
const home=join(root,'dsh');await mkdir(home);
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:'fixture-key',NODE_OPTIONS:'',NODE_PATH:''};
for(const k of Object.keys(env))if(/^(DSH_DESKTOP_PATCH|DSH_DESKTOP_ROOT|DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(k))delete env[k];
Object.assign(env,sourceEnvironment(runtime,root,home));if(isSourceRuntime(runtime))env.DSH_DESKTOP_PATCH=overlay;
let output='',launch,exited=false;
const child=spawn(join(runtime,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(runtime,'host.mjs')).href,join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
child.on('exit',()=>exited=true);
for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});
const pause=()=>new Promise(r=>setTimeout(r,100));child.stdin.write('start\n');
try {
  const deadline=Date.now()+90000;while(!launch&&!exited&&Date.now()<deadline)await pause();
  assert(launch,'Native provider startup: '+output);
  const response=await fetch(launch,{redirect:'manual'}),cookie=response.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
  const result=await (await fetch(origin+'/api/session/modelCatalog',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method:'session/modelCatalog',rpcId:crypto.randomUUID(),payload:{args:{}}})})).json();
  assert(result.result?.ok,JSON.stringify(result));
  const groups=result.result.value.groups;
  const directory=await (await fetch(origin+'/api/llm/listConfigurableProviders',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method:'llm/listConfigurableProviders',rpcId:crypto.randomUUID(),payload:{args:{}}})})).json();
  assert.deepEqual(directory.result?.value?.filter(p=>p.error&&presets.some(s=>s.id===p.provider)),[],'All preset routes must resolve');
  for(const preset of presets){
    const group=groups.find(g=>g.id===preset.id);
    assert(group,'Missing provider '+preset.id); 
    assert.deepEqual(group.models.map(m=>m.id).sort(),preset.models.map(m=>m.id).sort(),preset.id);
    for(const m of preset.models){
      const actual=group.models.find(x=>x.id===m.id);
      if(m.reasoningEfforts===false)assert(!actual.reasoning?.efforts?.some(e=>e.id!=='off'),m.id+' must not acquire invented thinking levels');
    }
  }
  assert(!output.includes('OFFLINE_TEST_DENIED'));
  console.log('PASS native provider catalog: '+presets.length+' providers, '+presets.reduce((n,p)=>n+p.models.length,0)+' models, no external requests');
} finally {
  if(!exited){child.stdin.write('stop\n');const deadline=Date.now()+10000;while(!exited&&Date.now()<deadline)await pause();if(!exited)child.kill();}
}

