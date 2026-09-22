import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),source=join(root,'runtime-src'),target=join(root,'runtime');
await mkdir(target,{recursive:true});
for(const name of await readdir(source))if(name.endsWith('.mjs'))await cp(join(source,name),join(target,name));
await cp(join(source,'desktop-client'),join(target,'desktop-client'),{recursive:true});
await cp(join(source,'desktop-environment'),join(target,'desktop-environment'),{recursive:true});
const files=[];
async function inventory(folder,prefix=''){
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(entry.isDirectory()){await inventory(join(folder,entry.name),prefix+entry.name+'/');continue;}
    if(!entry.isFile())throw Error('Desktop source inventory must contain regular files');
    const bytes=await readFile(join(folder,entry.name));files.push({path:prefix+entry.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
for(const name of (await readdir(source)).filter(n=>n.endsWith('.mjs')).sort()){
  const bytes=await readFile(join(source,name));files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await inventory(join(source,'desktop-client'),'desktop-client/');
await inventory(join(source,'desktop-environment'),'desktop-environment/');
const versions=JSON.parse(await readFile(join(root,'versions.json'),'utf8'));
await writeFile(join(target,'desktop-runtime-manifest.json'),JSON.stringify({schemaVersion:1,versions,files},null,2)+'\n');
console.log('Synchronized desktop host modules and native DSH client navigation extension.');
