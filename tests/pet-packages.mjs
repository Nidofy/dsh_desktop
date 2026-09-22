import {readPackage,validatePackage,parseZip,encodeZip,safeName} from '../runtime-src/pet-packages.mjs';
import assert from 'node:assert/strict';import {resolve} from 'node:path';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const resources=resolve('runtime');
const source=await readPackage(resolve('assets/pets/xiaojing/package'));const p=await validatePackage(source,resources);assert.equal(p.version,2);assert.equal(p.manifest.animations[0].frameCount,6);
const zip=encodeZip(p.files);const round=await validatePackage(parseZip(zip),resources);assert.equal(round.digest,p.digest);assert(!round.files.has('preview.html'));assert(!round.files.has('README.md'));
for(const name of ['../pet.json','/root','a\\b','a:b','CON','a/../b','x.','x/COM1.png'])assert.throws(()=>safeName(name));
const future=new Map(source);future.set('pet.json',Buffer.from(JSON.stringify({...JSON.parse(source.get('pet.json')),spriteVersionNumber:99})));await assert.rejects(()=>validatePackage(future,resources));
const bad=new Map(source);bad.set('spritesheet.webp',Buffer.from('not an image'));await assert.rejects(()=>validatePackage(bad,resources));
const duplicate=Buffer.from(encodeZip(new Map([['aaa',Buffer.from('a')],['bbb',Buffer.from('b')]])));for(let i=0;i<duplicate.length-3;i++)if(duplicate.subarray(i,i+3).toString()==='bbb')duplicate.write('aaa',i);assert.throws(()=>parseZip(duplicate));
const escape=Buffer.from(encodeZip(new Map([['abc',Buffer.from('x')]])));for(let i=0;i<escape.length-3;i++)if(escape.subarray(i,i+3).toString()==='abc')escape.write('../',i);assert.throws(()=>parseZip(escape));
const crc=Buffer.from(zip);crc[100]^=1;assert.throws(()=>parseZip(crc));
for(const attrs of [0xa0000000,0x400]){const linked=Buffer.from(encodeZip(new Map([['pet.json',Buffer.from('{}')]])));const central=linked.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));linked.writeUInt32LE(attrs,central+38);assert.throws(()=>parseZip(linked),'ZIP symlink/reparse rejected');}
const bomb=Buffer.from(encodeZip(new Map([['bomb',Buffer.from('x')]])));const central=bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bomb.writeUInt32LE(200*1024*1024,central+24);assert.throws(()=>parseZip(bomb),'declared expansion rejected before allocation');
assert.throws(()=>parseZip(zip.subarray(0,zip.length-8)),'truncated directory rejected');
const caseCollision=new Map([['pet.json',Buffer.from('{}')],['PET.JSON',Buffer.from('{}')]]);await assert.rejects(()=>validatePackage(caseCollision,resources));
const malicious=new Map(source);malicious.set('install.js',Buffer.from('throw Error("must never execute")'));assert(!(await validatePackage(malicious,resources)).files.has('install.js'));
await mkdir('.build/pet023/evidence',{recursive:true});await writeFile('.build/pet023/evidence/validated-v2.json',JSON.stringify({id:p.id,digest:p.digest,zipBytes:zip.length,tests:'roundtrip, scripts excluded, invalid version, corrupt image, ZIP duplicate/traversal/CRC, dangerous paths'}));console.log('PASS package decoding, v2 geometry, bounded ZIP, normalization and unsafe fixtures');
