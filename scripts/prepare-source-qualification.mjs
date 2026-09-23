// A source qualification runtime is isolated and cannot pass production admission.
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {project,importArtifact,verifyArtifact} from './harness-source.mjs';
import {createInventory,verifyRuntime,hashFile,verifyInventory} from '../runtime-src/runtime-integrity.mjs';

const artifact=resolve(process.argv[2]),output=resolve(process.argv[3]);
const source=await verifyArtifact(artifact);
await mkdir(output,{recursive:false});
const target=join(output,'resources');
await importArtifact(artifact,target);
const versions=JSON.parse(await readFile(join(project,'versions.json'),'utf8'));
const node=await hashFile(join(project,'runtime/runtime/node.exe'));
if(node.sha256!==versions.nodeSha256)throw Error('Node identity differs');
const webview=JSON.parse(await readFile(join(project,'runtime/webview2-manifest.json'),'utf8'));
if(webview.version!==versions.webview2||webview.cabSha256!==versions.webview2CabSha256)throw Error('WebView identity differs');
await verifyInventory(join(project,'runtime/webview2'),webview.files);
for(const name of ['runtime','webview2','webview2-manifest.json'])await cp(join(project,'runtime',name),join(target,name),{recursive:true});
execFileSync(process.execPath,[join(project,'scripts/sync-desktop-runtime.mjs'),target],{cwd:project,windowsHide:true,stdio:'inherit'});
const candidateVersions={...versions,dsh:source.source.version};
await writeFile(join(target,'source-qualification.json'),JSON.stringify({schemaVersion:1,sourceCommit:source.source.commit,productionAdmission:false,nativeAcceptance:'NOT_RUN'}));
const files=await createInventory(target,{exclude:['runtime-integrity.json']});
await writeFile(join(target,'runtime-integrity.json'),JSON.stringify({schemaVersion:1,kind:'desktop-runtime',versions:candidateVersions,files},null,2));
await verifyRuntime(target);
console.log(JSON.stringify({output,sourceCommit:source.source.commit,files:files.length,status:'QUALIFICATION_ONLY'}));
