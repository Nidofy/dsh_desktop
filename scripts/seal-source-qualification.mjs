// Re-seal desktop-only edits in an explicitly non-production qualification tree.
// Dependencies must still match the separately sealed source artifact byte for byte.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {verifyArtifact,project} from './harness-source.mjs';
import {createInventory,verifyInventory,hashFile,verifyRuntime} from '../runtime-src/runtime-integrity.mjs';
const [artifact,target]=process.argv.slice(2).map(p=>resolve(p));
if(!artifact||!target)throw Error('Expected source artifact and qualification resources');
const source=await verifyArtifact(artifact),qualification=JSON.parse(await readFile(join(target,'source-qualification.json'),'utf8'));
if(qualification.productionAdmission!==false||qualification.sourceCommit!==source.source.commit)throw Error('Not this source qualification tree');
const receipt=JSON.parse(await readFile(join(target,'harness-source-artifact.json'),'utf8'));
if(JSON.stringify(receipt)!==JSON.stringify(source))throw Error('Qualification source receipt changed');
await verifyInventory(join(target,'dsh'),source.files.map(file=>({...file,path:file.path.slice(4)})));
const versions=JSON.parse(await readFile(join(project,'versions.json'),'utf8'));
if((await hashFile(join(target,'runtime/node.exe'))).sha256!==versions.nodeSha256)throw Error('Node mismatch');
const webview=JSON.parse(await readFile(join(target,'webview2-manifest.json'),'utf8'));
if(webview.version!==versions.webview2||webview.cabSha256!==versions.webview2CabSha256)throw Error('WebView mismatch');
await verifyInventory(join(target,'webview2'),webview.files);
const desktop=JSON.parse(await readFile(join(target,'desktop-runtime-manifest.json'),'utf8'));
for(const entry of desktop.files){const actual=await hashFile(join(target,entry.path));if(actual.sha256!==entry.sha256||actual.bytes!==entry.bytes)throw Error('Desktop module mismatch');}
desktop.versions={...versions,dsh:source.source.version};
await writeFile(join(target,'desktop-runtime-manifest.json'),JSON.stringify(desktop,null,2)+'\n');
const files=await createInventory(target,{exclude:['runtime-integrity.json']});
await writeFile(join(target,'runtime-integrity.json'),JSON.stringify({schemaVersion:1,kind:'desktop-runtime',versions:{...versions,dsh:source.source.version},files},null,2)+'\n');
await verifyRuntime(target);
console.log(JSON.stringify({status:'QUALIFICATION_ONLY',sourceCommit:source.source.commit,files:files.length}));
