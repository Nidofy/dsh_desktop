// A small synthetic package using the real pinned Node binary. No product/user data.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,cp,writeFile,rename,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInventory} from '../runtime-src/runtime-integrity.mjs';
await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/distribution-check-'));
const resources=join(root,'resources');await mkdir(join(resources,'runtime'),{recursive:true});
await cp('runtime/runtime/node.exe',join(resources,'runtime/node.exe'));await cp('runtime-src/runtime-integrity.mjs',join(resources,'runtime-integrity.mjs'));await cp('scripts/verify-distribution.ps1',join(root,'Verify-DSHDesktop.ps1'));await writeFile(join(root,'DSHDesktop.exe'),'synthetic executable is never run');
const versions=JSON.parse(await readFile('versions.json','utf8'));
await writeFile(join(resources,'runtime-integrity.json'),JSON.stringify({schemaVersion:1,kind:'desktop-runtime',versions,files:await createInventory(resources)}));
await writeFile(join(root,'package-integrity.json'),JSON.stringify({schemaVersion:1,kind:'desktop-package',versions,files:await createInventory(root)}));
const shell=process.argv[2]??'powershell.exe';
async function verify(){return new Promise((resolve,reject)=>{const child=spawn(shell,['-NoProfile','-NonInteractive','-File',join(root,'Verify-DSHDesktop.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('exit',code=>resolve({code,output}));});}
let r=await verify();assert.equal(r.code,0,r.output);assert(r.output.includes('"status":"PASS"'));
await writeFile(join(root,'unexpected.dll'),'unexpected');r=await verify();assert.notEqual(r.code,0);assert(r.output.includes('INTEGRITY_EXTRA'));await rename(join(root,'unexpected.dll'),join(resolve('.build'),root.split(/[\\/]/).at(-1)+'-extra.dll'));
await writeFile(join(root,'DSHDesktop.exe'),'changed');r=await verify();assert.notEqual(r.code,0);assert(r.output.includes('INTEGRITY_CHANGED'));
await writeFile(join(resources,'runtime-integrity.mjs'),'throw Error("must not execute");');r=await verify();assert.notEqual(r.code,0);assert(r.output.includes('Integrity verifier checksum mismatch'));assert(!r.output.includes('must not execute'));
console.log('PASS distribution verifier: real pinned Node, complete synthetic package, extra/changed files, verifier tamper refused before execution');console.log(JSON.stringify({root,shell}));
