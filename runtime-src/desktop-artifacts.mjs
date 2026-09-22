import {randomUUID,createHash} from 'node:crypto';
import {realpath,lstat,open,mkdir,readFile,readdir,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,basename,extname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {writeAtomic} from './project-actions.mjs';
import {storageAdmission} from './storage-admission.mjs';

const MAX_DOWNLOAD=512*1024*1024;
const OPENABLE=new Set(['.txt','.md','.log','.json','.csv','.tsv','.pdf','.png','.jpg','.jpeg','.gif','.webp','.bmp','.docx','.xlsx','.pptx']);
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export class ArtifactError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new ArtifactError(code,message);};
export function artifactPath(value){return typeof value==='string'&&value.length>0&&value.length<=4096&&!isAbsolute(value)&&!/[\0:\\]/.test(value)&&!value.split('/').some(p=>!p||p==='.'||p==='..'||['.git','.hg'].includes(p.toLowerCase())||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
async function rootPath(workspace){if(typeof workspace!=='string'||!isAbsolute(workspace)||workspace.startsWith('\\\\')||workspace.includes('\0'))fail('WORKSPACE','请选择本机绝对工作区路径');const root=await realpath(workspace);if(!(await lstat(root)).isDirectory())fail('WORKSPACE','工作区不是目录');return root;}
async function resolveFile(root,path){
  if(!artifactPath(path))fail('PATH','文件必须位于工作区内，不能使用链接、父目录或设备路径');let target=root;
  for(const part of path.split('/')){target=join(target,part);const s=await lstat(target);if(s.isSymbolicLink())fail('LINK','文件路径包含链接，请在真实工作区中选择文件');}
  const canonical=await realpath(target),stat=await lstat(target);if(!inside(root,canonical)||!stat.isFile()||stat.isSymbolicLink())fail('PATH','不是工作区内的普通文件');return {target:canonical,stat};
}
export class DesktopArtifacts{
  constructor(home,{openNative,now=Date.now}={}){this.home=home;this.registry=join(home,'desktop-artifacts.json');this.now=now;this.openNative=openNative;this.leases=new Map();this.serial=Promise.resolve();this.stagingBytes=0;this.downloads=0;}
  async registrations(){try{const s=await lstat(this.registry);if(!s.isFile()||s.size>256*1024)throw Error();const value=JSON.parse(await readFile(this.registry,'utf8'));if(value.version!==1||!Array.isArray(value.items)||value.items.length>256||value.items.some(r=>typeof r.workspace!=='string'||!artifactPath(r.path)))throw Error();return value.items;}catch(error){if(error.code==='ENOENT')return [];fail('STORAGE','本地文件登记无法读取，请保留原文件并检查存储');}}
  async register(workspace,path){const root=await rootPath(workspace);await resolveFile(root,path);const job=this.serial.catch(()=>{}).then(async()=>{const rows=await this.registrations(),key=r=>r.workspace===root&&r.path===path;const next=[{workspace:root,path,time:this.now()},...rows.filter(r=>!key(r))].slice(0,256);await mkdir(this.home,{recursive:true});await writeAtomic(this.registry,JSON.stringify({version:1,items:next}));});this.serial=job;await job;return this.describe(root,path,{source:'manual'});}
  async list(workspace){const root=await rootPath(workspace);return Promise.all((await this.registrations()).filter(r=>r.workspace===root).slice(0,100).map(async row=>{try{return await this.describe(root,row.path,{source:'manual',registeredAt:row.time});}catch{return {name:basename(row.path),path:row.path,source:'manual',available:false,message:'文件已移动、删除或不再满足路径要求'};}}));}
  async describe(workspace,path,metadata={}){
    const root=await rootPath(workspace),{target,stat}=await resolveFile(root,path);for(const [id,value] of this.leases)if(this.now()-value.createdAt>600000)this.leases.delete(id);
    const identity=createHash('sha256').update(root+'\0'+path+'\0'+fingerprint(stat)).digest('hex');let id=[...this.leases].find(([,v])=>v.identity===identity)?.[0];
    if(!id){id=randomUUID();this.leases.set(id,{root,path,target,identity,fingerprint:fingerprint(stat),createdAt:this.now()});if(this.leases.size>512)this.leases.delete(this.leases.keys().next().value);}
    return {...metadata,id,name:basename(path),path,available:true,size:stat.size,modifiedAt:stat.mtimeMs,canOpen:OPENABLE.has(extname(path).toLowerCase()),canSave:stat.size<=MAX_DOWNLOAD};
  }
  async resolveLease(id){const value=this.leases.get(id);if(!value||this.now()-value.createdAt>600000)fail('EXPIRED','文件入口已过期，请刷新列表');const {target,stat}=await resolveFile(value.root,value.path);if(target!==value.target||fingerprint(stat)!==value.fingerprint)fail('CHANGED','文件已变化，请刷新后重新选择');return {...value,stat};}
  async action(id,action,signal){if(!['open','reveal'].includes(action))fail('ACTION','不支持的文件操作');const value=await this.resolveLease(id);if(action==='open'&&!OPENABLE.has(extname(value.path).toLowerCase()))fail('OPEN_TYPE','此类型不直接启动；可定位文件或另存后自行处理');if(!this.openNative)fail('UNAVAILABLE','本机打开服务不可用');signal?.throwIfAborted();await this.openNative(value.target,action,signal);return {accepted:true};}
  async download(id,res,signal){const value=await this.resolveLease(id);if(value.stat.size>MAX_DOWNLOAD)fail('LIMIT','另存上限为 512 MiB，请定位后使用文件管理器复制');
    if(this.downloads>=2||this.stagingBytes+value.stat.size>MAX_DOWNLOAD)fail('BUSY','已有文件正在另存，请稍后重试');this.downloads++;this.stagingBytes+=value.stat.size;
    const dir=join(this.home,'desktop-artifact-exports'),temp=join(dir,randomUUID()+'.tmp');let file,snapshot,storageLease;
    try{
      storageLease=await storageAdmission.acquire(temp,Math.max(1,value.stat.size),{signal});
      await mkdir(dir,{recursive:true});
      // Only stale owned temporary files are cleaned; never recurse into user directories.
      let priorBytes=0;for(const name of await readdir(dir)){if(!/^[a-f0-9-]{36}\.tmp$/.test(name))continue;const s=await lstat(join(dir,name));if(!s.isFile()||s.isSymbolicLink())continue;if(Date.now()-s.mtimeMs>3600000)await unlink(join(dir,name)).catch(()=>{});else priorBytes+=s.size;}
      if(priorBytes+value.stat.size>MAX_DOWNLOAD)fail('BUSY','临时另存空间已满，请等待正在进行的下载结束后重试');
      file=await open(value.target,'r');
      const stat=await file.stat();if(fingerprint(stat)!==value.fingerprint)fail('CHANGED','文件已变化，请刷新');await this.resolveLease(id);signal?.throwIfAborted();
      snapshot=await open(temp,'wx+',0o600);
      // Numeric fd ownership stays here; FileHandle streams with autoClose:false
      // otherwise retain a handle reference after EOF and can prevent close().
      if(stat.size)await pipeline(createReadStream(value.target,{fd:file.fd,autoClose:false,start:0,end:stat.size-1}),createWriteStream(temp,{fd:snapshot.fd,autoClose:false}),{signal});
      await snapshot.sync();if((await snapshot.stat()).size!==stat.size||fingerprint(await file.stat())!==value.fingerprint)fail('CHANGED','准备另存期间文件发生变化，请刷新后重试');await this.resolveLease(id);
      const name=basename(value.path).replace(/[\r\n]/g,'_');res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="DSH-artifact${extname(name).replace(/[^.a-zA-Z0-9]/g,'')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'content-length':stat.size,'x-content-type-options':'nosniff','cache-control':'no-store'});
      if(stat.size===0)res.end();else await pipeline(createReadStream(temp,{fd:snapshot.fd,autoClose:false,start:0,end:stat.size-1}),res,{signal});
    }finally{await Promise.allSettled([file?.close(),snapshot?.close()]);await unlink(temp).catch(()=>{});this.downloads--;this.stagingBytes-=value.stat.size;await storageLease?.release();}
  }
}
