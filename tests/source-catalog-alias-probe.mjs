// Actual Host catalog inheritance regression; any model difference fails qualification.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {sourceEnvironment,fixtureBase} from './runtime-fixture.mjs';
const runtime=resolve(process.argv[2]??'.build/source-qualification-s2/resources');
const receipt=JSON.parse(await readFile(join(runtime,'harness-source-artifact.json'),'utf8'));
await mkdir(fixtureBase(),{recursive:true});const fixture=await mkdtemp(join(fixtureBase(),'catalog-alias-'));
const root=join(fixture,'c-'+crypto.randomUUID().replaceAll('-','')),home=join(root,'dsh');await mkdir(home,{recursive:true});
const providers={},pairs=[];
for(const [i,known] of ['zai-coding-cn','anthropic','deepseek'].entries()){
 const rows=JSON.parse(await readFile(`.build/provider-presets/${known}/desktop.patch.json`,'utf8'));
 const config=rows[1].config.providers[known],alias='desktop-p-'+String(i+1).repeat(32);
 config.baseURL='http://127.0.0.1:9/v1';providers[known]=config;providers[alias]={...structuredClone(config),catalogProvider:known};pairs.push({known,alias});
}
const overlay=join(root,'desktop.patch.json');await writeFile(overlay,JSON.stringify([{id:'session-telemetry-otel',disabled:true},{id:'llm-pi-ai',config:{providers}}]));
const env={...process.env,...sourceEnvironment(runtime,root,home),DSH_HOME:home,DSH_DESKTOP_PATCH:overlay,DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:''};
for(const key of Object.keys(env))if(/^(OPENAI_|ANTHROPIC_|DEEPSEEK_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
let output='',launch,exited=false;
const child=spawn(join(runtime,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(runtime,'host.mjs')).href,join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
child.on('exit',()=>exited=true);for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});child.stdin.write('start\n');
const pause=()=>new Promise(r=>setTimeout(r,100));
try{
 const deadline=Date.now()+60000;while(!launch&&!exited&&Date.now()<deadline)await pause();assert(launch,output);
 const auth=await fetch(launch,{redirect:'manual'}),cookie=auth.headers.get('set-cookie').split(';')[0],origin=new URL(launch).origin;
 const method='session/modelCatalog',response=await(await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:{}}})})).json();
 assert(response.result.ok);const groups=response.result.value.groups,losses=[];
 const compared=[];
 for(const {known,alias} of pairs){const native=groups.find(g=>g.id===known),route=groups.find(g=>g.id===alias);assert(native&&route);assert(native.models.length>0);assert.deepEqual(route.models.map(m=>m.id).sort(),native.models.map(m=>m.id).sort());compared.push({provider:known,models:native.models.length});for(const model of native.models){const aliased=route.models.find(m=>m.id===model.id);assert(aliased);for(const field of ['reasoning','input','modalities'])if(JSON.stringify(model[field])!==JSON.stringify(aliased[field]))losses.push({provider:known,model:model.id,field,builtin:model[field]??null,alias:aliased[field]??null});}}
 assert(!output.includes('OFFLINE_TEST_DENIED'));
 const evidence={schemaVersion:1,sourceCommit:receipt.source.commit,status:losses.length?'BLOCKED':'PASS',method:'actual source Host session/modelCatalog RPC',modelRequests:0,catalogProvider:true,compared,losses};
 const report=join(fixture,'report.json');await writeFile(report,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,differences:losses.length,report}));
 if(losses.length)process.exitCode=2;
}finally{if(!exited){child.stdin.write('stop\n');const deadline=Date.now()+10000;while(!exited&&Date.now()<deadline)await pause();if(!exited)child.kill();}}
