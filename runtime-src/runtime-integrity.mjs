import {open,lstat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,isAbsolute} from 'node:path';

const MAX_FILES=100000,MAX_BYTES=16*1024**3,MAX_MANIFEST=32*1024**2;
export class IntegrityError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new IntegrityError('INTEGRITY_'+code);};
const pathValid=p=>typeof p==='string'&&p.length>0&&p.length<4096&&!isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s));
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
export async function hashFile(path,{signal}={}) {
  signal?.throwIfAborted();const before=await lstat(path,{bigint:true}).catch(()=>fail('MISSING'));
  if(!before.isFile()||before.isSymbolicLink())fail('UNSAFE');if(before.size>BigInt(MAX_BYTES))fail('LIMIT');
  const file=await open(path,'r').catch(()=>fail('MISSING'));
  try {
    if(stamp(before)!==stamp(await file.stat({bigint:true})))fail('CHANGED');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of file.createReadStream({autoClose:false,signal})){bytes+=chunk.length;if(bytes>MAX_BYTES)fail('LIMIT');hash.update(chunk);}
    if(stamp(before)!==stamp(await file.stat({bigint:true}))||bytes!==Number(before.size))fail('CHANGED');
    return {bytes,sha256:hash.digest('hex')};
  } finally {await file.close();}
}
export async function readManifest(path){
  const stat=await lstat(path).catch(()=>fail('MISSING'));if(!stat.isFile()||stat.isSymbolicLink())fail('UNSAFE');if(stat.size>MAX_MANIFEST)fail('LIMIT');
  const file=await open(path,'r');try{const buffer=Buffer.alloc(MAX_MANIFEST+1);let n=0;while(n<buffer.length){const r=await file.read(buffer,n,buffer.length-n);if(!r.bytesRead)break;n+=r.bytesRead;}if(n>MAX_MANIFEST)fail('LIMIT');try{return JSON.parse(buffer.subarray(0,n).toString('utf8'));}catch{fail('MANIFEST');}}finally{await file.close();}
}
async function paths(root,exclude,signal){
  const files=[],seen=new Set();let entries=0;
  const rootStat=await lstat(root).catch(()=>fail('MISSING'));if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('UNSAFE');
  async function walk(folder,prefix='',depth=0){
    signal?.throwIfAborted();if(depth>48)fail('LIMIT');
    const names=(await readdir(folder)).sort();
    for(const name of names){signal?.throwIfAborted();if(++entries>MAX_FILES*2)fail('LIMIT');const relative=prefix+name;if(!pathValid(relative))fail('UNSAFE');
      const key=relative.toLowerCase();if(seen.has(key))fail('MANIFEST');seen.add(key);
      const path=join(folder,name),stat=await lstat(path).catch(()=>fail('CHANGED'));if(stat.isSymbolicLink())fail('UNSAFE');
      if(stat.isDirectory())await walk(path,relative+'/',depth+1);
      else if(stat.isFile()){if(!exclude.has(relative)){files.push(relative);if(files.length>MAX_FILES)fail('LIMIT');}}
      else fail('UNSAFE');
    }
  }
  await walk(root);return files.sort();
}
async function parallel(values,fn){let index=0,failed;await Promise.all(Array.from({length:8},async()=>{while(!failed&&index<values.length){const i=index++;try{await fn(values[i],i);}catch(error){failed??=error;}}}));if(failed)throw failed;}
export async function createInventory(root,{exclude=[],signal}={}){
  root=resolve(root);const names=await paths(root,new Set(exclude),signal),files=new Array(names.length);let total=0;
  await parallel(names,async(path,i)=>{const hash=await hashFile(join(root,path),{signal});total+=hash.bytes;if(total>MAX_BYTES)fail('LIMIT');files[i]={path,...hash};});
  if(JSON.stringify(files).length>MAX_MANIFEST-4096)fail('LIMIT');return files;
}
export async function verifyInventory(root,files,{exclude=[],signal}={}) {
  root=resolve(root);if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)fail('MANIFEST');
  const expected=new Map();let total=0;
  for(const file of files){if(!file||!pathValid(file.path)||expected.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256??''))fail('MANIFEST');total+=file.bytes;if(total>MAX_BYTES)fail('LIMIT');expected.set(file.path.toLowerCase(),file);}
  const actual=await paths(root,new Set(exclude),signal);if(actual.some(path=>!expected.has(path.toLowerCase())))fail('EXTRA');if(actual.length!==files.length)fail('MISSING');
  await parallel(actual,async path=>{const file=expected.get(path.toLowerCase());if(path!==file.path)fail('CHANGED');const actual=await hashFile(join(root,path),{signal});if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)fail('CHANGED');});
  return {files:files.length,bytes:total};
}
export async function verifyRuntime(root,{signal}={}) {
  const manifest=await readManifest(join(root,'runtime-integrity.json'));
  if(manifest.schemaVersion!==1||manifest.kind!=='desktop-runtime')fail('MANIFEST');
  const metrics=await verifyInventory(root,manifest.files,{exclude:['runtime-integrity.json'],signal});
  const node=manifest.files.find(f=>f.path==='runtime/node.exe');
  if(!node||node.sha256!==manifest.versions?.nodeSha256)fail('MANIFEST');
  return {manifest,metrics};
}
