import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
// Explicit argv, no shell interpolation. Full bounded logs are separate from diagnostics.
export async function runCommand({command,args=[],cwd,timeoutMs=60000,logFile,maxLogBytes=1024*1024,signal}){
  const started=Date.now();let tail='',bytes=0,truncated=false,timedOut=false,spawnError=false;const chunks=[];
  const child=spawn(command,args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  const stop=()=>{if(!child.pid)return;if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());killer.on('exit',code=>{if(code!==0)child.kill();});const fallback=setTimeout(()=>{if(child.exitCode===null)child.kill();},2000);fallback.unref();}else child.kill('SIGKILL');};
  const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-4000);const remaining=maxLogBytes-bytes;if(remaining>0){chunks.push(chunk.subarray(0,remaining));bytes+=Math.min(chunk.length,remaining);}if(chunk.length>remaining)truncated=true;});
  const code=await new Promise(resolve=>{child.on('error',()=>{spawnError=true;resolve(null);});child.on('close',resolve);});
  clearTimeout(timer);signal?.removeEventListener('abort',stop);
  if(logFile){await mkdir(dirname(logFile),{recursive:true});await writeFile(logFile,Buffer.concat(chunks));}
  return {status:signal?.aborted?'CANCELLED':timedOut?'TIMEOUT':spawnError?'SPAWN_ERROR':code===0?'PASS':'FAIL',exitCode:code,durationMs:Date.now()-started,logBytes:bytes,logTruncated:truncated,logFile,tail};
}
export function matrixCases(matrix={},full=false){
  const allowed={toolOutputBudget:[50000,24000],skillDescription:[500,250],maxConcurrency:[1,2,4],repoSummary:[false,true]};
  for(const [key,values] of Object.entries(matrix))if(!allowed[key]||!Array.isArray(values)||!values.length||values.length>3||values.some(v=>!allowed[key].includes(v)))throw Error('Invalid matrix dimension: '+key);
  const entries=Object.entries(matrix),base=Object.fromEntries(entries.map(([k,v])=>[k,v[0]]));
  if(full)return entries.reduce((rows,[k,values])=>rows.flatMap(row=>values.map(v=>({...row,[k]:v}))),[{}]);
  return [base,...entries.flatMap(([key,values])=>values.slice(1).map(value=>({...base,[key]:value})))];
}
export function interleave(cases,repeat=1){if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw Error('repeat must be 1..10');return Array.from({length:repeat},(_,round)=>cases.map((_,offset)=>({round:round+1,caseIndex:(round+offset)%cases.length,config:cases[(round+offset)%cases.length]}))).flat();}
