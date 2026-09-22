import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative,isAbsolute,delimiter,sep} from 'node:path';
import {realpath,lstat,open,mkdir,readdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from './project-actions.mjs';

const exec=(file,args,options)=>new Promise((resolve,reject)=>execFile(file,args,options,(error,stdout,stderr)=>{if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}else resolve({stdout,stderr});}));
const MAX_FILE=2*1024*1024,MAX_TOTAL=16*1024*1024,MAX_RECORD=24*1024*1024,MAX_FILES=10000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,path)=>{const r=relative(root,path);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const revision=value=>typeof value==='string'&&/^[a-f0-9]{40,64}$/.test(value);
export class ChangeError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new ChangeError(code,message);};
export function validRepoPath(path){return typeof path==='string'&&path.length>0&&path.length<=4096&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes(':')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..'||['.git','.hg'].includes(p.toLowerCase()));}
export function vcsEnvironment(){
  const env={};for(const [key,value] of Object.entries(process.env))if(/^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|PATHEXT)$/i.test(key))env[key]=value;
  return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'',HGPLAIN:'1',HGRCPATH:'',HGRCSKIPREPO:'1',HGENCODING:process.platform==='win32'?'mbcs':'utf-8',HGEDITOR:'',PAGER:''};
}
let ansiEncoding;
async function decodePaths(repo,buffer){
  let encoding='utf-8';
  if(repo.vcs==='hg'&&process.platform==='win32'){
    // Mercurial deliberately retains the Windows ANSI filesystem encoding.
    // Windows PowerShell 5.1's .NET Framework Default encoding reports CP_ACP.
    ansiEncoding??=(async()=>{const shell=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const {stdout}=await exec(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command','[System.Text.Encoding]::Default.CodePage'],{env:vcsEnvironment(),windowsHide:true,timeout:5000,maxBuffer:1024});const cp=stdout.trim();const name={'65001':'utf-8','936':'gbk','932':'shift_jis','949':'euc-kr','950':'big5','874':'windows-874'}[cp]??(/^125[0-8]$/.test(cp)?'windows-'+cp:null);if(!name)fail('ENCODING','当前 Windows 代码页不支持 Hg 路径读取');return name;})();
    encoding=await ansiEncoding;
  }
  try{return new TextDecoder(encoding,{fatal:true}).decode(buffer);}catch{fail('ENCODING','仓库路径无法按当前系统编码准确解码');}
}
async function executable(name){
  const path=Object.entries(process.env).find(([key])=>key.toLowerCase()==='path')?.[1]??'';
  for(const dir of path.split(delimiter)){if(!isAbsolute(dir))continue;const candidate=join(dir,process.platform==='win32'?name+'.exe':name);try{if((await lstat(candidate)).isFile())return candidate;}catch{}}
  fail('VCS_MISSING',`未找到 ${name}；请安装命令行程序并加入 PATH 后重启 DSH。`);
}
export async function runVcs(repo,args,{signal,maxBuffer=4*1024*1024}={}){
  const prefix=repo.vcs==='git'?['--no-optional-locks','--no-pager','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.quotePath=false','-c','status.renames=false','-c','diff.renames=false']:['--noninteractive','--config','ui.paginate=never'];
  try{
    const file=await executable(repo.vcs),options={cwd:repo.root,env:vcsEnvironment(),encoding:'buffer',windowsHide:true,timeout:10000,maxBuffer,signal};
    if(repo.vcs==='git'){
      // status may otherwise launch an arbitrary clean/process filter from Git config.
      let names;try{names=(await exec(file,[...prefix,'config','--null','--name-only','--get-regexp','^filter\\.'],options)).stdout.toString().split('\0').filter(Boolean);}catch(error){if(error.code!==1)throw error;names=[];}
      const drivers=new Set(names.map(key=>key.slice(0,key.lastIndexOf('.'))));
      if(drivers.size>64)fail('LIMIT','Git filter 配置超过读取上限');
      for(const driver of drivers)prefix.push('-c',driver+'.clean=','-c',driver+'.process=','-c',driver+'.required=false');
    }
    try{return (await exec(file,[...prefix,...args],options)).stdout;}catch(error){if(repo.vcs==='hg'&&args[0]==='files'&&error.code===1&&!error.stdout?.length)return Buffer.alloc(0);throw error;}
  }
  catch(error){if(error instanceof ChangeError)throw error;if(signal?.aborted)throw signal.reason;fail(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'LIMIT':'VCS_FAILED','仓库读取失败或超时；未执行提交、回退或网络命令。');}
}
export async function discoverRepository(workspace){
  if(typeof workspace!=='string'||!isAbsolute(workspace)||workspace.includes('\0'))fail('WORKSPACE','需要绝对工作区路径');
  let root=await realpath(workspace);if(!(await lstat(root)).isDirectory())fail('WORKSPACE','工作区不是目录');
  for(;;){for(const vcs of ['git','hg']){try{const s=await lstat(join(root,'.'+vcs));if(s.isSymbolicLink())fail('LINK','仓库元数据目录不能是链接');if(s.isDirectory()||(vcs==='git'&&s.isFile()))return {root,vcs};}catch(e){if(e.code!=='ENOENT')throw e;}}const parent=dirname(root);if(parent===root)break;root=parent;}
  fail('NO_REPOSITORY','该工作区不在 Git 或 Hg 仓库内');
}
export function parseStatus(vcs,buffer){
  const rows=buffer.toString('utf8').split('\0').filter(Boolean).map(token=>({path:token.slice(vcs==='git'?3:2).replaceAll('\\','/'),status:token.slice(0,vcs==='git'?2:1)}));
  if(rows.length>MAX_FILES||rows.some(row=>!validRepoPath(row.path)))fail('LIMIT','文件数量超过 10000，或包含不支持的路径');
  return rows;
}
async function status(repo,signal,rev){
  if(rev&&repo.vcs==='git'){
    const raw=await runVcs(repo,['diff','--name-only','-z','--no-ext-diff','--no-textconv','--no-renames',rev,'--'],{signal});
    const current=await status(repo,signal);const paths=new Set([...raw.toString('utf8').split('\0').filter(Boolean),...current.map(r=>r.path)]);
    if(paths.size>MAX_FILES||[...paths].some(p=>!validRepoPath(p)))fail('LIMIT','变更路径超过范围');return [...paths].map(path=>({path,status:'?'}));
  }
  return parseStatus(repo.vcs,await decodePaths(repo,await runVcs(repo,repo.vcs==='git'?['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none']:['status','-0',...(rev?['--rev',rev]:[])],{signal})));
}
async function repoRevision(repo,signal){
  const output=await runVcs(repo,repo.vcs==='git'?['rev-parse','--verify','HEAD']:['log','-r','.','--template','{node}'],{signal}).catch(error=>{if(signal?.aborted)throw error;return Buffer.from('');});
  const value=output.toString().trim();return revision(value)?value:null;
}
async function manifest(repo,signal){
  const raw=await runVcs(repo,repo.vcs==='git'?['ls-files','--cached','-z']:['files','-0'],{signal});
  const paths=[...new Set((await decodePaths(repo,raw)).split('\0').filter(Boolean).map(p=>p.replaceAll('\\','/')))];if(paths.length>MAX_FILES||paths.some(p=>!validRepoPath(p)))fail('LIMIT','跟踪文件超过 10000 或存在不支持路径');return paths;
}
async function boundedFile(path,limit){const file=await open(path,'r');try{if(!(await file.stat()).isFile()||(await file.stat()).size>limit)fail('LIMIT','文件超过大小上限');const buffer=Buffer.alloc(limit+1);let n=0;while(n<buffer.length){const {bytesRead}=await file.read(buffer,n,buffer.length-n);if(!bytesRead)break;n+=bytesRead;}if(n>limit)fail('LIMIT','文件超过大小上限');return buffer.subarray(0,n);}finally{await file.close();}}
export async function workingFile(repo,path){
  if(!validRepoPath(path))return {kind:'unknown',reason:'UNSAFE_PATH'};
  let target=repo.root;
  try{
    for(const part of path.split('/')){target=join(target,part);const s=await lstat(target);if(s.isSymbolicLink())return {kind:'unknown',reason:'LINK'};}
    if(!inside(repo.root,await realpath(target)))return {kind:'unknown',reason:'OUTSIDE'};
    const before=await lstat(target);if(!before.isFile())return {kind:'unknown',reason:'SPECIAL'};
    if(before.size>MAX_FILE)return {kind:'unknown',reason:'LARGE'};
    const content=await boundedFile(target,MAX_FILE),after=await lstat(target);
    if(after.isSymbolicLink()||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||!inside(repo.root,await realpath(target)))return {kind:'unknown',reason:'CHANGED_DURING_READ'};
    return {kind:'file',hash:hash(content),size:content.length,content:content.toString('base64')};
  }catch(error){return error.code==='ENOENT'?{kind:'absent'}:{kind:'unknown',reason:'UNREADABLE'};}
}
const signature=value=>value.kind==='file'?value.hash:value.kind;
const publicFile=({content,...value})=>value;
async function indexFile(repo,path,signal){
  try{const bytes=await runVcs(repo,['cat-file','blob',':0:'+path],{maxBuffer:MAX_FILE,signal});return {kind:'file',hash:hash(bytes),size:bytes.length,content:bytes.toString('base64')};}
  catch(error){if(signal?.aborted)throw error;return {kind:'unknown',reason:'INDEX_UNAVAILABLE'};}
}
async function indexState(repo,row,tracked,signal){
  if(repo.vcs!=='git')return null;
  return !tracked.includes(row.path)?{kind:'absent'}:publicFile(await indexFile(repo,row.path,signal));
}
async function revisionFile(repo,rev,path){
  if(!rev)return {kind:'absent'};
  try{const bytes=await runVcs(repo,repo.vcs==='git'?['cat-file','blob',rev+':'+path]:['cat','--rev',rev,'--','path:'+path],{maxBuffer:MAX_FILE});return {kind:'file',hash:hash(bytes),size:bytes.length,content:bytes.toString('base64')};}
  catch{return {kind:'unknown',reason:'REVISION_UNAVAILABLE'};}
}
let diff;
function patchText(path,before,after){
  const a=Buffer.from(before.content??'','base64'),b=Buffer.from(after.content??'','base64');
  if(a.includes(0)||b.includes(0))return {text:null,reason:'BINARY'};
  let left,right;try{const decoder=new TextDecoder('utf-8',{fatal:true});left=decoder.decode(a);right=decoder.decode(b);}catch{return {text:null,reason:'ENCODING'};}
  if(a.length+b.length>256*1024)return {text:null,reason:'LARGE'};
  if(!diff){for(const path of ['dsh/package.json','../runtime/dsh/package.json']){try{diff=createRequire(join(dirname(fileURLToPath(import.meta.url)),path))('diff');break;}catch{}}}
  if(!diff)fail('DEPENDENCY','差异渲染组件不可用');
  const parsed=diff.structuredPatch(before.kind==='absent'?'/dev/null':'a/'+path,after.kind==='absent'?'/dev/null':'b/'+path,left.replace(/\r\n/g,'\n'),right.replace(/\r\n/g,'\n'),'','',{context:3,timeout:500});
  if(!parsed)return {text:null,reason:'DIFF_LIMIT'};
  const text=parsed.hunks.length?diff.formatPatch(parsed):'';return Buffer.byteLength(text)>512*1024?{text:null,reason:'DIFF_LIMIT'}:{text,reason:null};
}

/** Bounded local baselines for review. Clean content stays referenced by VCS revision: this is not a full restore snapshot. */
export class ChangeReview{
  constructor(home){this.dir=join(home,'desktop-changes');this.tail=Promise.resolve();}
  async list(workspace){const repo=await discoverRepository(workspace),key=hash(process.platform==='win32'?repo.root.toLowerCase():repo.root);await mkdir(this.dir,{recursive:true});const items=[];
    for(const name of await readdir(this.dir)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;try{const row=JSON.parse(await boundedFile(join(this.dir,name),MAX_RECORD));if(row.workspaceKey===key)items.push({id:row.id,createdAt:row.createdAt,sessionId:row.sessionId,turn:row.turn,source:row.source,coverage:row.coverage,revision:row.revision});}catch{}}
    return {repo,items:items.sort((a,b)=>b.createdAt-a.createdAt)};
  }
  async capture(workspace,{sessionId=null,turn=null,source='manual',signal}={}){
    const job=this.tail.catch(()=>{}).then(async()=>{
      signal?.throwIfAborted();const repo=await discoverRepository(workspace),startedAt=Date.now();
      const [rev,dirty,tracked]=await Promise.all([repoRevision(repo,signal),status(repo,signal),manifest(repo,signal)]);
      let bytes=0,coverage='COMPLETE';const files=Object.create(null);
      for(const row of dirty){signal?.throwIfAborted();let file=bytes>=MAX_TOTAL?{kind:'unknown',reason:'BUDGET'}:await workingFile(repo,row.path);if(file.kind==='file'&&(bytes+=file.size)>MAX_TOTAL)file={kind:'unknown',reason:'BUDGET'};const index=await indexState(repo,row,tracked,signal);if(file.kind==='unknown'||index?.kind==='unknown')coverage='PARTIAL';files[row.path]={...file,status:row.status,index};}
      const endStatus=await status(repo,signal),endRev=await repoRevision(repo,signal);
      // status is not a lock: recheck every captured dirty file as well as the VCS view.
      for(const [path,file] of Object.entries(files)){signal?.throwIfAborted();if(file.kind!=='unknown'&&(signature(await workingFile(repo,path))!==signature(file)||repo.vcs==='git'&&signature(await indexState(repo,{path},tracked,signal))!==signature(file.index))){files[path]={kind:'unknown',reason:'CHANGED_DURING_CAPTURE',status:file.status};coverage='PARTIAL';}}
      if(JSON.stringify(endStatus)!==JSON.stringify(dirty)||rev!==endRev)coverage='PARTIAL';
      if(!rev&&tracked.length)coverage='PARTIAL';
      const row={schemaVersion:1,id:randomUUID(),root:repo.root,vcs:repo.vcs,workspaceKey:hash(process.platform==='win32'?repo.root.toLowerCase():repo.root),createdAt:startedAt,completedAt:Date.now(),source,sessionId,turn,revision:rev,coverage,tracked,files};
      await mkdir(this.dir,{recursive:true});signal?.throwIfAborted();await writeAtomic(join(this.dir,row.id+'.json'),JSON.stringify(row));await this.prune();return {id:row.id,coverage,createdAt:row.createdAt};
    });this.tail=job;return job;
  }
  async prune(){const files=[];for(const name of await readdir(this.dir)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const s=await lstat(join(this.dir,name));files.push({name,size:s.size,time:s.mtimeMs});}files.sort((a,b)=>b.time-a.time);let size=0;for(let i=0;i<files.length;i++){size+=files[i].size;if(i>=30||size>128*1024*1024)await unlink(join(this.dir,files[i].name));}}
  async baseline(repo,id){
    if(!/^[a-f0-9-]{36}$/.test(id??''))fail('BASELINE','请选择有效基线');
    let value;try{value=JSON.parse(await boundedFile(join(this.dir,id+'.json'),MAX_RECORD));}catch{fail('BASELINE','基线不存在、已过期或无法读取');}
    if(value.schemaVersion!==1||value.id!==id||!samePath(value.root??'',repo.root)||value.vcs!==repo.vcs||!Array.isArray(value.tracked)||value.tracked.length>MAX_FILES||value.tracked.some(p=>!validRepoPath(p))||!value.files||typeof value.files!=='object'||Object.keys(value.files).some(p=>!validRepoPath(p))||value.revision!==null&&!revision(value.revision))fail('BASELINE','基线与当前仓库不匹配或格式损坏');
    return value;
  }
  async inspect(workspace,baselineId,signal){
    const repo=await discoverRepository(workspace),[head,dirty]=await Promise.all([repoRevision(repo,signal),status(repo,signal)]);
    if(!baselineId)return {repo,revision:head,baseline:null,rows:dirty.map(r=>({...r,classification:'NO_BASELINE'}))};
    const base=await this.baseline(repo,baselineId),changed=await status(repo,signal,base.revision),tracked=repo.vcs==='git'||!base.revision?await manifest(repo,signal):[],paths=[...new Set([...Object.keys(base.files),...changed.map(r=>r.path),...(!base.revision?tracked:[])])].sort(),rows=[];
    if(paths.length>MAX_FILES)fail('LIMIT','合并后的比较范围超过 10000 个文件');
    for(const path of paths){signal?.throwIfAborted();const original=Object.hasOwn(base.files,path)?base.files[path]:null;let classification;
      if(base.coverage!=='COMPLETE')classification='UNKNOWN';
      else if(original){const current=await workingFile(repo,path),currentStatus=dirty.find(r=>r.path===path)?.status??'  ',index=await indexState(repo,{path},tracked,signal);classification=original.kind==='unknown'||current.kind==='unknown'||index?.kind==='unknown'?'UNKNOWN':signature(original)===signature(current)&&original.status===currentStatus&&(repo.vcs!=='git'||original.index&&signature(original.index)===signature(index))?'PREEXISTING':'DURING_TASK';}
      else classification='DURING_TASK';
      rows.push({path,status:dirty.find(r=>r.path===path)?.status??'  ',classification,preexisting:!!original});
    }
    return {repo,revision:head,baseline:{id:base.id,createdAt:base.createdAt,source:base.source,sessionId:base.sessionId,turn:base.turn,coverage:base.coverage,revision:base.revision},rows};
  }
  async patch(workspace,path,{baselineId=null,mode='repository'}={}){
    if(!validRepoPath(path)||!['repository','task','before','staged','unstaged'].includes(mode))fail('PATH','不支持的路径或差异类型');
    const repo=await discoverRepository(workspace);let before,after;
    if(['repository','staged','unstaged'].includes(mode)){
      const dirty=await status(repo);if(!dirty.some(row=>row.path===path))fail('STALE','该文件已不在仓库变更列表，请刷新');
      const rev=await repoRevision(repo),tracked=await manifest(repo),entry=dirty.find(r=>r.path===path);
      // Added files have no parent blob; deleted files still have one, even after staging.
      before=/^(\?\?|A | A|\? |A$|\?$)/.test(entry.status)?{kind:'absent'}:await revisionFile(repo,rev,path);
      if(repo.vcs==='git'&&entry.status[0]==='A')before={kind:'absent'};
      if(!tracked.includes(path)&&entry.status.trim()==='??')before={kind:'absent'};
      after=await workingFile(repo,path);
      if(mode!=='repository'){
        if(repo.vcs!=='git')fail('MODE','Hg 没有 Git 暂存区，请使用仓库或任务比较');
        const index=!tracked.includes(path)?{kind:'absent'}:await indexFile(repo,path);
        if(mode==='staged')after=index;else before=index;
      }
    }else{
      const base=await this.baseline(repo,baselineId),saved=Object.hasOwn(base.files,path)?base.files[path]:null;
      if(!saved&&!base.tracked.includes(path)){const current=await status(repo,undefined,base.revision);if(!current.some(r=>r.path===path)&&(base.revision||!(await manifest(repo)).includes(path)))fail('PATH','文件不在基线或当前变化范围内');}
      const initial=saved??(base.tracked.includes(path)?await revisionFile(repo,base.revision,path):{kind:'absent'});
      if(mode==='before'){if(!saved)fail('PATH','该文件没有基线前变化');before=/^(\?\?|A |A$|\?$)/.test(saved.status)?{kind:'absent'}:await revisionFile(repo,base.revision,path);after=initial;}
      else{before=initial;after=await workingFile(repo,path);}
    }
    if(before.kind==='unknown'||after.kind==='unknown')return {path,mode,before:publicFile(before),after:publicFile(after),text:null,reason:'INCOMPLETE'};
    return {path,mode,before:publicFile(before),after:publicFile(after),...patchText(path,before,after)};
  }
}
