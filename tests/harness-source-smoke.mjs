// Isolated Web-host probe, separate from CLI smoke and Tauri acceptance.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {project,verifyArtifact} from '../scripts/harness-source.mjs';
import {sourceProbeArguments,sourceProfile} from '../runtime-src/harness-adapter.mjs';

const artifact=resolve(process.argv[2]);
const manifest=await verifyArtifact(artifact);
await mkdir(join(project,'.build'),{recursive:true});
const home=await mkdtemp(join(project,'.build/harness-web-smoke-'));
const env={...process.env};
for(const key of Object.keys(env))if(/^(DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|NODE_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/i.test(key))delete env[key];
Object.assign(env,{DSH_HOME:join(home,'dsh'),DSH_AGENTS_HOME:join(home,'agents'),DSH_TELEMETRY_DISABLED:'1',USERPROFILE:home,HOME:home,
  PATH:process.platform==='win32'?`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`:'/usr/bin:/bin'});
const cli=join(artifact,'runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
async function probeLaunch(attempt) {
const args=await sourceProbeArguments({root:home,home:env.DSH_HOME});
assert.equal(args.includes('--from-default-profile'),attempt===1,'Only the first launch initializes');
const child=spawn(process.execPath,['--import',pathToFileURL(join(project,'tests/offline-guard.mjs')).href,cli,...args],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',launch,error;
child.on('error',e=>{error=e;});
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
  output=(output+data).slice(-256*1024);
  const match=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output);
  if(match)launch=match[1];
});
const report={attempt,profile:sourceProfile,sourceCommit:manifest.source.commit,version:manifest.source.version,home,status:'FAIL',modelCalls:0,tauriAcceptance:'NOT_RUN',checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
  const deadline=Date.now()+90000;
  while(!launch&&!error&&child.exitCode===null&&Date.now()<deadline)await sleep(100);
  if(error)throw error;
  assert(launch,'Web host must announce readiness within 90s');
  const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
  const origin=new URL(launch).origin;
  const exchange=await request(launch,{redirect:'manual'});
  const cookie=exchange.headers.get('set-cookie')?.split(';')[0];assert(cookie,'Local auth exchange');
  const root=await request(origin,{headers:{cookie}});assert.equal(root.status,200);
  const html=await root.text();assert(html.includes('<html'));
  const assets=[...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(m=>m[1]);
  assert(assets.length>0,'Packaged Web assets');
  for(const asset of assets){const url=new URL(asset,origin);assert.equal(url.origin,origin);assert.equal((await request(url,{headers:{cookie}})).status,200);}
  assert(!output.includes('OFFLINE_TEST_DENIED'),'No blocked public-network/package-manager attempts');
  report.checks=['fresh custom profile boot','loopback authenticated HTTP','packaged JS/CSS assets: '+assets.length,'no system Node or package manager on PATH','no observed denied egress'];
  report.status='PASS';
} catch(e){report.error=e.message;process.exitCode=1;}
finally {
  if(child.exitCode===null)child.kill();
  const deadline=Date.now()+5000;while(child.exitCode===null&&child.signalCode===null&&!error&&Date.now()<deadline)await sleep(50);
  report.cleanup=child.exitCode!==null||child.signalCode!==null||error?'OWNED_PROCESS_STOPPED':'STOP_TIMEOUT';
  if(report.cleanup==='STOP_TIMEOUT'){report.status='FAIL';process.exitCode=1;}
  await writeFile(join(home,`host-${attempt}.log`),output.replace(/token=[^\s"&]+/g,'token=[redacted]'));
}
return report;
}
const report={sourceCommit:manifest.source.commit,version:manifest.source.version,home,status:'FAIL',tauriAcceptance:'NOT_RUN',modelCalls:0,launches:[]};
try{
  for(const attempt of [1,2]){
    const result=await probeLaunch(attempt);report.launches.push(result);
    assert.equal(result.status,'PASS','Profile launch '+attempt);
  }
  await verifyArtifact(artifact);report.artifactUnchanged=true;report.status='PASS';
}catch(error){report.error=error.message;process.exitCode=1;}
await writeFile(join(home,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
