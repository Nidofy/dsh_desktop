// Local build provenance, not a signature or target-machine acceptance claim.
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createInventory,hashFile} from '../runtime-src/runtime-integrity.mjs';

export const inputDirectories=['src-tauri/src','src-tauri/icons','src-tauri/generated','src-tauri/capabilities','src-tauri/permissions','shell-ui','runtime-src','scripts','tests','desktop-theme'];
export const inputFiles=['versions.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/tauri.conf.json','src-tauri/build.rs','.cargo/config.toml','build-deps/package.json','build-deps/package-lock.json','assets/icon-source.png','assets/wallpaper-transparent.png'];
export const outputFiles=['src-tauri/target/x86_64-pc-windows-msvc/release/DSHDesktop.exe','runtime/desktop-runtime-manifest.json','runtime/runtime-integrity.json','runtime/dsh-integrity.json','runtime/webview2-manifest.json'];
const startPath='.build/release-build-start.json',receiptPath='.build/release-build-receipt.json';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function json(root,path){return JSON.parse(await readFile(join(root,path),'utf8'));}
async function atomic(root,path,value){
  const target=join(root,path),temp=target+'.'+randomUUID()+'.new';
  try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await rename(temp,target);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function entries(root,paths){return Promise.all(paths.map(async path=>({path,...await hashFile(join(root,path))})));}
async function inputs(root){
  const result=await entries(root,inputFiles);
  for(const dir of inputDirectories)for(const file of await createInventory(join(root,dir)))result.push({...file,path:dir+'/'+file.path});
  return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function version(root){
  const v=await json(root,'versions.json'),tauri=await json(root,'src-tauri/tauri.conf.json');
  const cargo=await readFile(join(root,'src-tauri/Cargo.toml'),'utf8');
  const packageBlock=cargo.split(/\[package\]/)[1]?.split(/\n\[/)[0];
  if(typeof v.desktop!=='string'||tauri.version!==v.desktop||!packageBlock?.includes(`version = "${v.desktop}"`))throw Error('Desktop version differs between versions.json, Cargo and Tauri');
  return v.desktop;
}
export async function beginBuild(root){
  await mkdir(join(root,'.build'),{recursive:true});
  const value={schemaVersion:1,kind:'desktop-build-start',id:randomUUID(),desktopVersion:await version(root),startedAt:new Date().toISOString(),inputs:await inputs(root)};
  await atomic(root,startPath,value);return value;
}
export async function completeBuild(root){
  const start=await json(root,startPath);
  if(start.schemaVersion!==1||start.kind!=='desktop-build-start'||start.desktopVersion!==await version(root)||!equal(start.inputs,await inputs(root)))throw Error('Build inputs changed during the gate; rerun the complete build');
  const value={...start,kind:'desktop-build-receipt',gate:'scripts/build-windows.ps1',status:'PASS',completedAt:new Date().toISOString(),outputs:await entries(root,outputFiles),targetAcceptance:'NOT_IMPLIED'};
  await atomic(root,receiptPath,value);return value;
}
export async function verifyBuild(root){
  const receipt=await json(root,receiptPath),start=await json(root,startPath);
  if(receipt.schemaVersion!==1||receipt.kind!=='desktop-build-receipt'||receipt.status!=='PASS'||receipt.gate!=='scripts/build-windows.ps1'||receipt.id!==start.id)throw Error('No completed receipt for the latest build attempt');
  if(receipt.desktopVersion!==await version(root)||!equal(receipt.inputs,await inputs(root))||!equal(receipt.outputs,await entries(root,outputFiles)))throw Error('Sources, settings UI, executable or runtime changed since the build gate; rebuild before packaging');
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(fileURLToPath(new URL('../',import.meta.url))),mode=process.argv[2];
  const fn={begin:beginBuild,complete:completeBuild,verify:verifyBuild}[mode];if(!fn)throw Error('Expected begin, complete or verify');
  const result=await fn(root);console.log(JSON.stringify({kind:result.kind,status:result.status??'STARTED',id:result.id,desktopVersion:result.desktopVersion,inputs:result.inputs.length}));
}
