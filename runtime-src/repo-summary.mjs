import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {lstat,readFile} from 'node:fs/promises';
import {diagnosticState} from './diagnostic-state.mjs';
const exec=promisify(execFile);
async function git(cwd,args,signal){
  const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
  for(const k of Object.keys(env))if(/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|CEILING_DIRECTORIES)/.test(k))delete env[k];
  return (await exec('git',['--no-optional-locks','-c','core.fsmonitor=false',...args],{cwd,env,signal,windowsHide:true,timeout:10000,maxBuffer:2*1024*1024})).stdout;
}
export async function repoSummary(cwd,signal){
  const raw=await git(cwd,['status','--porcelain=v1','-z','--untracked-files=all'],signal);
  const tokens=raw.split('\0'),changedFiles=[];let untrackedCount=0;
  for(let i=0;i<tokens.length;i++){const token=tokens[i];if(!token)continue;const status=token.slice(0,2),path=token.slice(3);if(status==='??')untrackedCount++;if(changedFiles.length<200)changedFiles.push({path,status});if(/[RC]/.test(status))i++;}
  const [head,branch]=await Promise.all([git(cwd,['rev-parse','--verify','HEAD'],signal).catch(()=>''),git(cwd,['symbolic-ref','--short','-q','HEAD'],signal).catch(()=>'')]);
  return {vcs:'git',head:head.trim()||null,branch:branch.trim()||null,dirty:raw.length>0,changedFiles,untrackedCount,truncated:tokens.filter(Boolean).length>200};
}
export async function workspaceFingerprint(cwd,capture){
  try{
    const root=(await git(cwd,['rev-parse','--show-toplevel'])).trim();
    const summary=await repoSummary(root);let bytes=0,complete=!summary.truncated;const hashes=[];
    // Dirty contents are bounded; a directory/symlink/oversized file makes comparability unknown.
    for(const file of summary.changedFiles){const path=resolve(root,file.path),rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel)){complete=false;continue;}
      try{const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||(bytes+=s.size)>4*1024*1024){complete=false;continue;}hashes.push([file.path,file.status,capture.id(await readFile(path))]);}
      catch(e){if(e.code==='ENOENT')hashes.push([file.path,file.status,'deleted']);else complete=false;}}
    const staged=await git(root,['diff','--cached','--no-ext-diff','--no-textconv','--binary']);
    return {vcs:'git',revision:summary.head?capture.id(summary.head):null,state:capture.id(JSON.stringify({hashes,staged:capture.id(staged)})),complete:complete&&!!summary.head};
  }catch{return {vcs:'unknown-or-hg',revision:null,state:null,complete:false};}
}
export async function registerRepoTool(ctx){
  if(!diagnosticState.preferences.repoSummary)return;
  const require=createRequire(join(dirname(fileURLToPath(import.meta.url)),'dsh/package.json'));
  const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
  ctx.inject(['tools'],toolCtx=>{toolCtx.tools.register(defineTool({name:'repo_summary',description:'Read-only Git branch, HEAD and bounded changed-file status for the current workspace. Does not return a patch. Unsupported repositories should use existing shell tools.',parameters:{},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(_args,exec){if(!exec.agent?.session.header.cwd)throw Error('Workspace unavailable');return repoSummary(exec.agent.session.header.cwd,exec.signal);}}));});
}
