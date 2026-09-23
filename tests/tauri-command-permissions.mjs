import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const build=await readFile('src-tauri/build.rs','utf8');
const registered=new Set([...build.matchAll(/"([a-z_]+)"/g)].map(m=>m[1]));
const capabilities={shell:JSON.parse(await readFile('src-tauri/capabilities/shell.json','utf8')),pet:JSON.parse(await readFile('src-tauri/capabilities/pet.json','utf8'))};
async function verify(dir,kind){for(const entry of await readdir(dir,{withFileTypes:true})){
  if(entry.isDirectory()){await verify(join(dir,entry.name),entry.name==='pet'?'pet':kind);continue;}
  if(!entry.name.endsWith('.js'))continue;
  const text=await readFile(join(dir,entry.name),'utf8');
  for(const [,command] of text.matchAll(/\binvoke\(\s*['"]([a-z_]+)['"]/g)){
    assert(registered.has(command),`${entry.name}: ${command} missing from Tauri command manifest`);
    assert(capabilities[kind].permissions.includes('allow-'+command.replaceAll('_','-')),`${entry.name}: ${command} missing from ${kind} capability`);
  }
}}
for(const [kind,capability] of Object.entries(capabilities)){
  assert.equal(capability.local,true);assert.equal(capability.remote,undefined);
  assert.deepEqual(capability.windows,kind==='pet'?['pet-*']:['shell']);
}
await verify('shell-ui','shell');
assert(!capabilities.pet.permissions.includes('allow-connection-apply-mode'));
console.log('PASS local frontend commands have explicit Tauri registration and correctly scoped permissions');
