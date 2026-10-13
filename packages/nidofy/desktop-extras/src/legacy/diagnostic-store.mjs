import {readFile,mkdir,readdir,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeReport} from './diagnostic-comparison.mjs';
import {writeAtomic} from './project-actions.mjs';
export class MeasurementStore {
  async close(){await this.queue.catch(()=>{});}
  constructor(home,{maxFiles=100,maxBytes=50*1024*1024,storage}={}){this.directory=home?join(home,'desktop-measurements'):null;this.maxFiles=maxFiles;this.maxBytes=maxBytes;this.storage=storage;this.queue=Promise.resolve();}
  async files(){if(!this.directory)return [];await mkdir(this.directory,{recursive:true});const names=(await readdir(this.directory)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));return (await Promise.all(names.map(async name=>({name,...await stat(join(this.directory,name))})))).sort((a,b)=>a.mtimeMs-b.mtimeMs);}
  async list(){const files=await this.files();return Promise.all(files.reverse().map(async f=>{try{const r=await this.read(f.name.slice(0,-5));return {id:f.name.slice(0,-5),measurement:r.measurement,requests:r.records.length};}catch{return {id:f.name.slice(0,-5),unreadable:true};}}));}
  async read(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid measurement');const file=join(this.directory,id+'.json');if((await stat(file)).size>this.maxBytes)throw Error('Oversized measurement');return normalizeReport(JSON.parse(await readFile(file,'utf8')));}
  save(report){const task=this.queue.catch(()=>{}).then(async()=>{
    if(!this.directory)throw Error('No archive directory');
    const value=normalizeReport(report),id=randomUUID();value.measurement.id=id;
    const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>this.maxBytes)throw Error('Measurement too large');
    await mkdir(this.directory,{recursive:true});const file=join(this.directory,id+'.json');
    const write=()=>writeAtomic(file,bytes);await(this.storage?this.storage.write(file,Buffer.byteLength(bytes)*2,write):write());
    const files=await this.files();let total=files.reduce((n,f)=>n+f.size,0);
    while(files.length>this.maxFiles||total>this.maxBytes){const old=files.shift();await unlink(join(this.directory,old.name));total-=old.size;}
    return {id,measurement:value.measurement};
  });this.queue=task;return task;}
}
