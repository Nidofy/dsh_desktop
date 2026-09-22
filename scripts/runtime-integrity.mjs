// Build-time creation is explicit. Verify never rewrites a manifest.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInventory,verifyInventory,readManifest,verifyRuntime,hashFile} from '../runtime-src/runtime-integrity.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const [mode,input]=process.argv.slice(2),root=resolve(input??join(project,'runtime'));
const versions=JSON.parse(await readFile(join(project,'versions.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const lock=await readFile(join(project,'build-deps/package-lock.json'));
const save=(name,value)=>writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
async function verifyDsh(){
 const m=await readManifest(join(root,'dsh-integrity.json'));
 if(m.schemaVersion!==1||m.kind!=='dsh-dependencies'||m.version!==versions.dsh||m.lockSha256!==digest(lock))throw Error('DSH baseline does not match pinned build dependencies; prepare again');
 return verifyInventory(join(root,'dsh'),m.files);
}
if(mode==='create-dsh'){
 const installed=await readFile(join(root,'dsh/package-lock.json'));if(digest(installed)!==digest(lock))throw Error('Installed lock differs from build lock');
 const pkg=JSON.parse(await readFile(join(root,'dsh/node_modules/@deepseek-ai/dsh/package.json'),'utf8'));if(pkg.version!==versions.dsh)throw Error('DSH version differs from pin');
 const files=await createInventory(join(root,'dsh'));await save('dsh-integrity.json',{schemaVersion:1,kind:'dsh-dependencies',version:versions.dsh,lockSha256:digest(lock),files});console.log(JSON.stringify({kind:'DSH_BASELINE_CREATED',files:files.length}));
}else if(mode==='create-runtime'){
 await verifyDsh();
 const node=await hashFile(join(root,'runtime/node.exe'));if(node.sha256!==versions.nodeSha256)throw Error('Official Node checksum mismatch');
 const desktop=await readManifest(join(root,'desktop-runtime-manifest.json'));for(const f of desktop.files){const v=await hashFile(join(root,f.path));if(v.sha256!==f.sha256||v.bytes!==f.bytes)throw Error('Desktop source manifest mismatch');}
 const webview=await readManifest(join(root,'webview2-manifest.json'));if(webview.version!==versions.webview2||webview.cabSha256!==versions.webview2CabSha256)throw Error('WebView baseline mismatch');await verifyInventory(join(root,'webview2'),webview.files);
 const files=await createInventory(root,{exclude:['runtime-integrity.json']});await save('runtime-integrity.json',{schemaVersion:1,kind:'desktop-runtime',versions,files});console.log(JSON.stringify({kind:'RUNTIME_BASELINE_CREATED',files:files.length}));
}else if(mode==='verify-runtime'){
 const {manifest,metrics}=await verifyRuntime(root);if(JSON.stringify(manifest.versions)!==JSON.stringify(versions))throw Error('Runtime versions differ from build versions');console.log(JSON.stringify({kind:'RUNTIME_VERIFIED',...metrics}));
}else if(mode==='create-package'){
 await verifyRuntime(join(root,'resources'));
 const files=await createInventory(root,{exclude:['package-integrity.json']});await save('package-integrity.json',{schemaVersion:1,kind:'desktop-package',versions,files});console.log(JSON.stringify({kind:'PACKAGE_BASELINE_CREATED',files:files.length}));
}else if(mode==='verify-package'){
 const m=await readManifest(join(root,'package-integrity.json'));if(m.schemaVersion!==1||m.kind!=='desktop-package')throw Error('Invalid package manifest');const metrics=await verifyInventory(root,m.files,{exclude:['package-integrity.json']});await verifyRuntime(join(root,'resources'));console.log(JSON.stringify({kind:'PACKAGE_VERIFIED',...metrics}));
}else throw Error('Expected create-dsh, create-runtime, verify-runtime, create-package, or verify-package');
