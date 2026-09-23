import {cp,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';

// The runtime root's .mjs files are owned by runtime-src. Reusing a runtime
// across versions must not ship removed desktop modules from the old version.
export async function syncRootModules(source,target){
  const current=(await readdir(source,{withFileTypes:true})).filter(e=>e.name.endsWith('.mjs'));
  const staged=(await readdir(target,{withFileTypes:true})).filter(e=>e.name.endsWith('.mjs'));
  if([...current,...staged].some(e=>!e.isFile()))throw Error('Desktop root modules must be regular files');
  const names=new Set(current.map(e=>e.name));
  for(const entry of current)await cp(join(source,entry.name),join(target,entry.name));
  for(const entry of staged)if(!names.has(entry.name))await unlink(join(target,entry.name));
}
