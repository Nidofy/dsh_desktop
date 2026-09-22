import {readFile,lstat,readdir,realpath,open,mkdir,rename,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {inflateRawSync,crc32} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
export const LIMITS=Object.freeze({archive:64*1024*1024,total:128*1024*1024,files:256,json:1024*1024,pixels:32*1024*1024,edge:4096});
const hash=b=>createHash('sha256').update(b).digest('hex');
const validId=s=>typeof s==='string'&&/^[a-z][a-z0-9_-]{0,47}$/.test(s);
const id=s=>{if(!validId(s))throw Error('资源 ID 无效');return s;};
export function safeName(name){
 if(typeof name!=='string'||name.length>200||!name||name.includes('\\')||name.startsWith('/')||/[\x00-\x1f:]/.test(name))throw Error('包内路径无效');
 const parts=name.replace(/\/$/,'').split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))throw Error('包内路径无效');return parts.join('/');
}
function budget(files){let total=0;const seen=new Set();if(files.size>LIMITS.files)throw Error('资源文件过多');for(const [name,data]of files){const key=safeName(name).toLowerCase();if(seen.has(key))throw Error('包内存在重名文件');seen.add(key);total+=data.length;if(total>LIMITS.total||(/\.json$/i.test(name)&&data.length>LIMITS.json))throw Error('资源超过大小限制');}}
export function parseZip(bytes){
 if(bytes.length>LIMITS.archive)throw Error('ZIP 超过 64 MiB');let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
 if(end<0)throw Error('ZIP 目录损坏');const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count>LIMITS.files||offset+size!==end)throw Error('不支持多卷、ZIP64 或超量包');
 let p=offset,total=0;const files=new Map(),seen=new Set(),ranges=[];
 for(let i=0;i<count;i++){
  if(p+46>end||bytes.readUInt32LE(p)!==0x02014b50)throw Error('ZIP 目录损坏');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),compressed=bytes.readUInt32LE(p+20),length=bytes.readUInt32LE(p+24),n=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),attrs=bytes.readUInt32LE(p+38),local=bytes.readUInt32LE(p+42);
  if(p+46+n+extra+comment>end)throw Error('ZIP 目录越界');const rawName=bytes.subarray(p+46,p+46+n),name=new TextDecoder('utf-8',{fatal:true}).decode(rawName),clean=safeName(name),key=clean.toLowerCase(),mode=(attrs>>>16)&0xf000;
  if(seen.has(key)||mode===0xa000||(attrs&0x400)||flags&1||![0,8].includes(method)||length>LIMITS.total||total+length>LIMITS.total||length>Math.max(1024*1024,compressed*200))throw Error('ZIP 链接、重名、加密或压缩比例超限');seen.add(key);total+=length;
  if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method)throw Error('ZIP 本地头损坏');const ln=bytes.readUInt16LE(local+26),le=bytes.readUInt16LE(local+28),start=local+30+ln+le,finish=start+compressed;
  if(finish>offset||!bytes.subarray(local+30,local+30+ln).equals(rawName)||ranges.some(([a,b])=>local<b&&finish>a))throw Error('ZIP 文件越界或重叠');ranges.push([local,finish]);
  const data=method===0?bytes.subarray(start,finish):inflateRawSync(bytes.subarray(start,finish),{maxOutputLength:Math.min(LIMITS.total,length+1)});
  if(data.length!==length||crc32(data)!==crc)throw Error('ZIP 文件长度或 CRC 错误');if(name.endsWith('/')){if(length)throw Error('ZIP 目录含数据');}else files.set(clean,Buffer.from(data));p+=46+n+extra+comment;
 }
 if(p!==end)throw Error('ZIP 尾部不匹配');budget(files);return files;
}
async function regular(path,max){const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size>max)throw Error('拒绝链接或超限文件');const file=await open(path,'r');try{const after=await file.stat();if(before.ino!==after.ino||before.dev!==after.dev||after.size>max)throw Error('源文件已变化');const bytes=Buffer.alloc(after.size);let read=0;while(read<bytes.length){const result=await file.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)throw Error('源文件不完整');read+=result.bytesRead;}const final=await lstat(path);if(final.isSymbolicLink()||final.ino!==before.ino||final.size!==before.size)throw Error('源文件已变化');return bytes;}finally{await file.close();}}
export async function readPackage(source){
 const stat=await lstat(source);if(stat.isSymbolicLink())throw Error('拒绝链接或重解析点');if(stat.isFile())return parseZip(await regular(source,LIMITS.archive));if(!stat.isDirectory())throw Error('请选择资源目录或 ZIP');const root=await realpath(source),files=new Map();let count=0,total=0;
 async function walk(folder,prefix=''){for(const entry of await readdir(folder,{withFileTypes:true})){if(++count>LIMITS.files)throw Error('资源条目过多');const name=safeName(prefix+entry.name),path=join(folder,entry.name),s=await lstat(path),actual=await realpath(path),rel=relative(root,actual);if(s.isSymbolicLink()||rel.startsWith('..')||isAbsolute(rel))throw Error('拒绝链接或路径逃逸');if(s.isDirectory())await walk(path,name+'/');else {const bytes=await regular(path,LIMITS.total-total);total+=bytes.length;files.set(name,bytes);}}}
 await walk(root);budget(files);return files;
}
const counts=[6,8,8,4,5,8,6,6,6],names=['idle','running-right','running-left','waving','jumping','failed','waiting','running','review'];
const durations=[[280,110,110,140,140,320],...[1,2].map(()=>[120,120,120,120,120,120,120,220]),[140,140,140,280],[140,140,140,140,280],[140,140,140,140,140,140,140,240],[150,150,150,150,150,260],[120,120,120,120,120,220],[150,150,150,150,150,280]];
export async function validatePackage(files,resources){
 budget(files);const json=name=>{const b=files.get(name);if(!b||b.length>LIMITS.json)throw Error('清单缺失或过大：'+name);return JSON.parse(b.toString('utf8'));};const pet=json('pet.json');id(pet.id);
 if(typeof pet.displayName!=='string'||pet.displayName.length<1||pet.displayName.length>64||/[\x00-\x1f]/.test(pet.displayName))throw Error('宠物名称无效');
 const version=pet.spriteVersionNumber??1;if(![1,2].includes(version)||pet.frame||pet.animations)throw Error('仅支持固定 8×9 或 8×11/v2 标准布局');
 const atlas=safeName(pet.spritesheetPath),rows=version===2?11:9;
 const require=createRequire(join(resources,'dsh/package.json')),sharp=require('sharp');let pixels=0;const images=new Map();
 async function decode(name){if(images.has(name))return images.get(name);if(!/\.(png|webp)$/.test(name)||!files.has(name))throw Error('图像缺失或格式不支持');const data=files.get(name),image=sharp(data,{limitInputPixels:LIMITS.pixels,animated:false}),meta=await image.metadata();if(!['png','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>LIMITS.edge||meta.height>LIMITS.edge||(meta.pages??1)!==1)throw Error('图像尺寸或帧数超限');pixels+=meta.width*meta.height;if(pixels>LIMITS.pixels)throw Error('总解码像素超限');const decoded=await image.ensureAlpha().raw().toBuffer();if(decoded.length!==meta.width*meta.height*4)throw Error('图像解码无效');const result={width:meta.width,height:meta.height,decoded,data};images.set(name,result);return result;}
 const base=await decode(atlas);if(base.width!==1536||base.height!==rows*208)throw Error('版本与图集尺寸不匹配');
 let animations=names.map((name,row)=>({id:name,row,frameCount:counts[row],durationsMs:durations[row],loop:!['waving','jumping','failed'].includes(name)}));
 if(files.has('asset-manifest.json')){const supplied=json('asset-manifest.json');if(supplied.schemaVersion!==1||supplied.columns!==8||supplied.rows!==rows||supplied.cellWidth!==192||supplied.cellHeight!==208||supplied.animations?.length!==9)throw Error('基础动画清单无效');animations=supplied.animations.map((a,r)=>{if(a.id!==names[r]||a.row!==r||a.frameCount!==counts[r]||a.durationsMs?.length!==counts[r]||a.durationsMs.some(t=>!Number.isInteger(t)||t<40||t>5000)||typeof a.loop!=='boolean')throw Error('基础帧时长无效');return {id:a.id,row:r,frameCount:a.frameCount,durationsMs:a.durationsMs,loop:a.loop};});}
 // Full decode, used-cell occupancy and unused-cell transparency, not just headers.
 for(let r=0;r<rows;r++)for(let c=0;c<8;c++){let opaque=0;for(let y=r*208;y<(r+1)*208;y++)for(let x=c*192;x<(c+1)*192;x++)if(base.decoded[(y*1536+x)*4+3])opaque++;const used=r>=9||c<counts[r]||(version===2&&r===0&&c===6);if(used&&!opaque||!used&&opaque)throw Error('图集使用格为空或空白格不透明');}
 let interactions=null;const extPath=files.has('interactions.json')?'interactions.json':files.has('extensions/interactions.json')?'extensions/interactions.json':null;
 if(extPath){const ext=json(extPath);if(ext.schemaVersion!==1||!Array.isArray(ext.animations)||ext.animations.length>24)throw Error('互动版本无效');const seen=new Set(),allowed=new Set(['head-tap','body-tap','long-press','drag']),output=[];
  for(const a of ext.animations){if(!/^[a-z][a-z0-9-]{0,31}$/.test(a.id)||seen.has(a.id))throw Error('互动 ID 无效');seen.add(a.id);const name=safeName((extPath.startsWith('extensions/')?'extensions/':'')+a.atlasPath),im=await decode(name);if(!Number.isInteger(a.cellWidth)||!Number.isInteger(a.cellHeight)||a.cellWidth<1||a.cellHeight<1||a.cellWidth>512||a.cellHeight>512||!Array.isArray(a.frames)||a.frames.length<1||a.frames.length>32||a.durationsMs?.length!==a.frames.length||a.durationsMs.some(t=>!Number.isInteger(t)||t<40||t>5000)||typeof a.loop!=='boolean')throw Error('互动帧无效');for(const f of a.frames)if(!Number.isInteger(f.row)||!Number.isInteger(f.column)||f.row<0||f.column<0||(f.row+1)*a.cellHeight>im.height||(f.column+1)*a.cellWidth>im.width)throw Error('互动裁切越界');output.push({id:a.id,atlasPath:name,cellWidth:a.cellWidth,cellHeight:a.cellHeight,frames:a.frames.map(f=>({row:f.row,column:f.column})),durationsMs:a.durationsMs,loop:a.loop});}
  for(const [trigger,action]of Object.entries(ext.triggers??{}))if(!allowed.has(trigger)||!seen.has(action))throw Error('互动触发器无效');const idle=ext.idleVariants??[];if(!Array.isArray(idle)||idle.length>8||idle.some(k=>!seen.has(k)||['pat','happy','dragged'].includes(k)))throw Error('随机待机声明无效');interactions={schemaVersion:1,animations:output,triggers:ext.triggers??{},idleVariants:idle};
 }
 const selected=new Map();selected.set('pet.json',Buffer.from(JSON.stringify({id:pet.id,displayName:pet.displayName,description:typeof pet.description==='string'?pet.description.slice(0,256):'',spriteVersionNumber:version,spritesheetPath:atlas})));selected.set('asset-manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,columns:8,rows,cellWidth:192,cellHeight:208,animations})));for(const [name,image]of images)selected.set(name,image.data);if(interactions)selected.set('interactions.json',Buffer.from(JSON.stringify(interactions)));
 const digest=hash(Buffer.concat([...selected].sort(([a],[b])=>a.localeCompare(b)).flatMap(([name,b])=>[Buffer.from(name+'\0'),b])));
 return {id:pet.id,displayName:pet.displayName,version,digest,files:selected,manifest:{columns:8,rows,cellWidth:192,cellHeight:208,animations},atlas,interactions,warnings:interactions?[]:['缺少互动扩展，使用基础动作反馈'],preview:'data:image/'+(atlas.endsWith('.png')?'png':'webp')+';base64,'+base.data.toString('base64')};
}
function publicView(p){return {id:p.id,displayName:p.displayName,version:p.version,digest:p.digest,warnings:p.warnings,preview:p.preview};}
export function encodeZip(files){const locals=[],central=[];let offset=0;for(const [name,data]of files){const n=Buffer.from(safeName(name)),crc=crc32(data),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);locals.push(head,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=30+n.length+data.length;}const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);const result=Buffer.concat([...locals,dir,end]);if(result.length>LIMITS.archive)throw Error("导出 ZIP 超过 64 MiB");return result;}
export async function packageCommand({home,resources,action,source,expected,replace=false,resourceId,destination}){
 const root=resolve(home,'pet-resources');try{if((await lstat(root)).isSymbolicLink())throw Error('资源库不能是链接');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(root,{recursive:true});const catalogPath=join(root,'catalog.json');let catalog={schemaVersion:1,items:[]},catalogWarning=null;try{catalog=JSON.parse(await regular(catalogPath,LIMITS.json));if(catalog.schemaVersion!==1||!Array.isArray(catalog.items)||catalog.items.length>100)throw Error('资源目录索引无效');for(const item of catalog.items){id(item.id);if(!/^[a-z0-9_-]+$/.test(item.folder))throw Error('资源目录索引无效');}}catch(e){if(e.code!=='ENOENT'){catalogWarning='资源索引不可读，已保留原文件；仍可使用和导出内置宠物';catalog={schemaVersion:1,items:[]};if(!['list'].includes(action)&&!(['asset','export'].includes(action)&&resourceId==='xiaojing'))throw Error(catalogWarning);}}
 const removeFolder=async folder=>{if(!folder)return;const target=resolve(root,folder);if(dirname(target)!==root||!/^[a-z0-9_-]+$/.test(folder))throw Error('资源删除路径无效');await rm(target,{recursive:true,force:true});};
 const commit=async()=>{const temp=catalogPath+'.'+randomUUID();await writeFile(temp,JSON.stringify(catalog),{flag:'wx'});await rename(temp,catalogPath);};
 const locate=rid=>rid==='xiaojing'?join(resources,'pets/xiaojing'):join(root,catalog.items.find(i=>i.id===id(rid))?.folder??'missing');
 if(action==='list')return {warning:catalogWarning,items:[{id:'xiaojing',displayName:'吃白饭的大肥鱼',builtin:true},...catalog.items.map(({id,displayName})=>({id,displayName,builtin:false}))]};
 if(action==='preview'||action==='import'){
  const p=await validatePackage(await readPackage(source),resources);if(action==='preview')return {...publicView(p),duplicate:p.id==='xiaojing'||catalog.items.some(i=>i.id===p.id)};
  if(p.digest!==expected)throw Error('源包已变化，请重新预检');if(p.id==='xiaojing')throw Error('内置资源只读，请为自定义包使用不同 ID');const old=catalog.items.find(i=>i.id===p.id);if(old&&!replace)throw Error('资源 ID 已存在，请明确选择替换');if(!old&&catalog.items.length>=100)throw Error('最多保存 100 个资源包');
  const folder=p.id+'-'+randomUUID(),stage=join(root,'.stage-'+randomUUID()),final=join(root,folder);await mkdir(stage);
  try{for(const [name,bytes]of p.files){const path=join(stage,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}await validatePackage(await readPackage(stage),resources);await rename(stage,final);catalog.items=catalog.items.filter(i=>i.id!==p.id);catalog.items.push({id:p.id,displayName:p.displayName,folder});await commit();}catch(e){if(dirname(resolve(stage))===root)await rm(stage,{recursive:true,force:true});await removeFolder(folder);throw e;}
  let warning;try{await removeFolder(old?.folder);}catch{warning='新资源已安装，旧资源目录未能清理';}return {id:p.id,installed:true,warning};
 }
 if(action==='delete'){id(resourceId);if(resourceId==='xiaojing')throw Error('内置资源不可删除');const old=catalog.items.find(i=>i.id===resourceId);catalog.items=catalog.items.filter(i=>i.id!==resourceId);await commit();let warning;try{await removeFolder(old?.folder);}catch{warning='资源已卸载，旧目录未能清理';}return {deleted:true,warning};}
 if(action==='asset'||action==='export'){
  const p=await validatePackage(await readPackage(locate(resourceId)),resources);
  if(action==='asset'){const images={};for(const [name,b]of p.files)if(/\.(png|webp)$/.test(name))images[name]='data:image/'+(name.endsWith('.png')?'png':'webp')+';base64,'+b.toString('base64');return {id:p.id,displayName:p.displayName,manifest:p.manifest,atlas:p.atlas,interactions:p.interactions,images,warnings:p.warnings};}
  const parent=await lstat(destination);if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('请选择普通导出目录');const path=join(destination,p.id+'-'+p.digest.slice(0,8)+'-'+randomUUID().slice(0,8)+'.zip');await writeFile(path,encodeZip(p.files),{flag:'wx'});return {path};
 }
 throw Error('不支持的资源操作');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error('请求过大');}
 try{const request=JSON.parse(raw);console.log(JSON.stringify({ok:true,value:await packageCommand(request)}));}catch(e){console.log(JSON.stringify({ok:false,error:String(e.message).slice(0,200)}));process.exitCode=1;}
}
