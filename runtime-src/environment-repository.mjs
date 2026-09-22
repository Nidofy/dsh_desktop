import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,join,delimiter} from 'node:path';
import {lstat} from 'node:fs/promises';
import {discoverRepository,runVcs,vcsEnvironment} from './change-review.mjs';
const exec=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const text=async(repo,args)=> (await runVcs(repo,args)).toString('utf8').trim();
const safe=promise=>promise.catch(()=>null);
const branchName=value=>typeof value==='string'&&value.length>0&&value.length<200&&!value.startsWith('-')&&!/[\x00-\x20~^:?*\[\\]/.test(value)&&!value.includes('..')&&!value.includes('@{');
export function parseNumstat(raw){let added=0,deleted=0,binary=0;for(const line of raw.split('\n')){const match=/^(\d+|-)\t(\d+|-)\t/.exec(line);if(!match)continue;if(match[1]==='-'){binary++;continue;}added+=Number(match[1]);deleted+=Number(match[2]);}return {added,deleted,binary};}
export async function environmentRepository(workspace){
  const repo=await discoverRepository(workspace);
  if(repo.vcs!=='git')return {...repo,branches:[],diff:null,canWrite:false};
  const [raw,head,branch,diff,cached,remotes,upstream]=await Promise.all([
    safe(text(repo,['for-each-ref','--format=%(refname:short)','refs/heads/'])),
    safe(text(repo,['rev-parse','--verify','HEAD'])),safe(text(repo,['symbolic-ref','--short','-q','HEAD'])),
    safe(text(repo,['diff','--numstat','--no-ext-diff','--no-textconv','--no-renames','HEAD','--'])),
    safe(text(repo,['diff','--cached','--numstat','--no-ext-diff','--no-textconv','--no-renames','--'])),
    safe(text(repo,['remote'])),safe(text(repo,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']))
  ]);
  const working=diff===null?await safe(text(repo,['diff','--numstat','--no-ext-diff','--no-textconv','--no-renames','--'])):null;
  const stats=diff===null?(cached===null||working===null?null:parseNumstat(cached+'\n'+working)):parseNumstat(diff);
  return {...repo,head,branch,branches:(raw||'').split('\n').filter(Boolean).slice(0,500),diff:stats,remotes:(remotes||'').split('\n').filter(Boolean),upstream,canWrite:true};
}
export async function compareEnvironmentBranch(workspace,branch){
  if(!branchName(branch))throw Error('请选择有效分支');
  const repo=await discoverRepository(workspace);if(repo.vcs!=='git')throw Error('当前比较入口支持 Git 仓库');
  const revision=await text(repo,['rev-parse','--verify','refs/heads/'+branch]);
  if(!/^[a-f0-9]{40,64}$/.test(revision))throw Error('分支已不存在');
  const base=await text(repo,['merge-base',revision,'HEAD']);
  const patch=await text(repo,['diff','--no-ext-diff','--no-textconv','--no-renames',base,'HEAD','--']);
  return {branch,base,patch:patch.slice(0,200000),truncated:patch.length>200000};
}
async function mutationGit(repo,args){
  // User-initiated Git actions inherit the user's identity/credential helpers,
  // but never the model/API secrets or alternate repository environment.
  const env=vcsEnvironment();delete env.GIT_CONFIG_GLOBAL;delete env.GIT_CONFIG_NOSYSTEM;
  let file;const path=Object.entries(process.env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
  for(const dir of path.split(delimiter)){if(!isAbsolute(dir))continue;const candidate=join(dir,process.platform==='win32'?'git.exe':'git');if(await lstat(candidate).then(s=>s.isFile()).catch(()=>false)){file=candidate;break;}}
  if(!file)throw Error('未找到 Git');
  try{return (await exec(file,['--no-pager',...args],{cwd:repo.root,env,windowsHide:true,timeout:60000,maxBuffer:1024*1024})).stdout;}
  catch{throw Error('Git 操作未成功。请检查仓库身份、暂存区或远程连接后刷新。');}
}
async function fingerprint(repo){
  const values=await Promise.all([
    safe(text(repo,['rev-parse','--verify','HEAD'])),safe(text(repo,['symbolic-ref','--short','-q','HEAD'])),
    text(repo,['status','--porcelain=v1','-z','--no-renames','--untracked-files=all']),
    text(repo,['diff','--cached','--binary','--no-ext-diff','--no-textconv','--no-renames','--']),
    text(repo,['diff','--binary','--no-ext-diff','--no-textconv','--no-renames','--']),
    text(repo,['for-each-ref','--format=%(objectname) %(refname)','refs/heads/','refs/remotes/']),
    safe(text(repo,['config','--get-regexp','^(remote|branch)\\.']))
  ]);return sha(JSON.stringify(values));
}
export function createEnvironmentOperations(){
  const tickets=new Map(),busy=new Set();
  return {
    async preview(workspace,input){
      if(!['switch','create','commit','push'].includes(input.action))throw Error('不支持的操作');
      const repo=await discoverRepository(workspace);if(repo.vcs!=='git')throw Error('Hg 请使用现有工程操作或终端');
      const info=await environmentRepository(workspace),status=await text(repo,['status','--porcelain=v1','-z','--no-renames','--untracked-files=all']);
      let description,args;
      if(input.action==='switch'||input.action==='create'){
        if(!branchName(input.branch))throw Error('分支名称无效');
        await text(repo,['check-ref-format','--branch',input.branch]);
        if(status)throw Error('工作区有未提交的更改，请先提交或自行暂存后切换分支');
        if(input.action==='switch'&&!info.branches.includes(input.branch))throw Error('分支已不存在');
        if(input.action==='create'&&info.branches.includes(input.branch))throw Error('分支已存在');
        description=(input.action==='create'?'创建并切换到 ':'切换到 ')+input.branch;
        args=input.action==='create'?['switch','-c',input.branch]:['switch','--no-guess',input.branch];
      }else if(input.action==='commit'){
        if(typeof input.message!=='string'||!input.message.trim()||input.message.length>4000)throw Error('请填写提交说明');
        const files=await text(repo,['diff','--cached','--name-only','-z','--']);if(!files)throw Error('暂存区没有更改，请先使用 Git 将要提交的文件加入暂存区');
        description='提交已暂存的 '+files.split('\0').filter(Boolean).length+' 个文件';
        args=['commit','-m',input.message];
      }else{
        if(!info.branch||!branchName(info.branch)||!info.remotes.includes(input.remote))throw Error('请选择有效远程和本地分支');
        description='推送 '+info.branch+' 到 '+input.remote+'/'+info.branch;
        args=['push','--',input.remote,'refs/heads/'+info.branch+':refs/heads/'+info.branch];
      }
      const token=randomUUID(),entry={repo,args,description,state:await fingerprint(repo),expires:Date.now()+60000};
      for(const [key,value] of tickets)if(value.expires<Date.now())tickets.delete(key);
      if(tickets.size>=64)throw Error('待确认操作过多，请稍后重试');
      tickets.set(token,entry);return {token,description,workspace:repo.root,branch:info.branch,expires:entry.expires};
    },
    async apply(workspace,token){
      const entry=tickets.get(token);tickets.delete(token);if(!entry||entry.expires<Date.now())throw Error('操作预览已过期，请重新预览');
      const repo=await discoverRepository(workspace);if(repo.root!==entry.repo.root)throw Error('工程已变化，请重新预览');
      if(busy.has(repo.root))throw Error('仓库操作正在进行');busy.add(repo.root);
      try{if(await fingerprint(repo)!==entry.state)throw Error('仓库状态已变化，请重新预览');await mutationGit(repo,entry.args);return {ok:true,description:entry.description};}
      finally{busy.delete(repo.root);}
    }
  };
}
