import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'assets/pets/xiaojing/package'),target=join(root,'shell-ui/pet/assets/xiaojing');
const checks=JSON.parse(await readFile(join(source,'checksums.json')));
for(const entry of checks.files){const bytes=await readFile(join(source,entry.file));if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Pet checksum mismatch: '+entry.file);}
const manifest=JSON.parse(await readFile(join(source,'asset-manifest.json')));
const png=await readFile(join(source,'spritesheet.png'));
if(png.readUInt32BE(16)!==1536||png.readUInt32BE(20)!==2288||manifest.animations.map(a=>a.frameCount).join()!=='6,8,8,4,5,8,6,6,6')throw Error('Invalid built-in atlas geometry');
await mkdir(target,{recursive:true});
const files=['pet.json','asset-manifest.json','atlas-layout.json','spritesheet.webp'];
for(const file of files)await copyFile(join(source,file),join(target,file));
await writeFile(join(target,'manifest.js'),'export default '+JSON.stringify(manifest)+';\n');
await writeFile(join(target,'staging.json'),JSON.stringify({schemaVersion:1,files:checks.files.filter(f=>files.includes(f.file))},null,2)+'\n');
console.log('Pet source checksums verified; production assets staged (preview/scripts excluded).');
const extension=join(root,'assets/pets/xiaojing/extensions');
const extChecks=JSON.parse(await readFile(join(extension,'checksums.json')));
for(const entry of extChecks.files){const bytes=await readFile(join(extension,entry.file));if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Interaction checksum mismatch: '+entry.file);}
await mkdir(join(target,'extensions'),{recursive:true});
for(const file of ['interactions.json','pat.webp','happy.webp','dragged.webp'])await copyFile(join(extension,file),join(target,'extensions',file));
const interactions=JSON.parse(await readFile(join(extension,'interactions.json')));
await writeFile(join(target,'extensions/manifest.js'),'export default '+JSON.stringify(interactions)+';\n');
