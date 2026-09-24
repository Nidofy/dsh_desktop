// Versioned launch facts. Source probes are deliberately separate from desktop admission.
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute,basename} from 'node:path';

export const harnessAdapterVersion = 1;
export const sourceCommit = '5e2879f0478ba9336128312e715dee7a9f56c3db';
export const sourceProfile = 'dsh-desktop';
const contracts = Object.freeze({
  '0.1.5-rc.2': Object.freeze({id:'registry-015rc2-v1',version:'0.1.5-rc.2',node:'24.16.0',sessionWriter:3,settings:'settings.yaml',desktopReady:true}),
  '0.1.7-alpha.2': Object.freeze({id:'source-017a2-v1',version:'0.1.7-alpha.2',node:'24.16.0',sessionWriter:4,settings:'profiles/dsh-desktop/cordis.patch.yml',desktopReady:false,commit:sourceCommit}),
});
const failure = code => Object.assign(Error(code),{code});

export function selectHarnessAdapter(version) {
  if (!Object.hasOwn(contracts,version)) throw failure('HARNESS_ADAPTER_UNKNOWN');
  return contracts[version];
}

// Called before settings or migration writes. Full file integrity is checked by
// assembly/distribution verification and the local self-test, not this identity probe.
export async function requireDesktopAdapter(runtimeRoot, candidate) {
  const pkg=JSON.parse(await readFile(join(runtimeRoot,'dsh/node_modules/@deepseek-ai/dsh/package.json'),'utf8'));
  const adapter=selectHarnessAdapter(pkg.version);
  if (pkg.name!=='@deepseek-ai/dsh' || process.versions.node!==adapter.node) throw failure('HARNESS_ADAPTER_IDENTITY');
  if (!adapter.desktopReady) {
    if(!candidate||!/^c-[a-f0-9]{32}$/.test(candidate.id??'')||basename(candidate.root??'')!==candidate.id)throw failure('HARNESS_ADAPTER_NOT_READY');
    await sourceProbeArguments(candidate);
    const receipt=JSON.parse(await readFile(join(runtimeRoot,'harness-source-artifact.json'),'utf8'));
    if(receipt.source?.commit!==sourceCommit||receipt.source?.version!==adapter.version||receipt.status!=='SOURCE_SMOKE_PASSED')throw failure('HARNESS_ADAPTER_IDENTITY');
  }
  return adapter;
}

async function statOrMissing(path) {
  try {return await lstat(path);} catch(error) {if(error.code==='ENOENT')return null;throw error;}
}

// The caller supplies a newly allocated test/candidate root, never the user's stable root.
// No files are created or repaired here; incomplete initialization is kept for inspection.
export async function sourceProbeArguments({root,home}) {
  if(!isAbsolute(root)||!isAbsolute(home))throw failure('HARNESS_PROFILE_ISOLATION');
  root=resolve(root);home=resolve(home);
  if(home!==join(root,'dsh'))throw failure('HARNESS_PROFILE_ISOLATION');
  const parts=['', 'dsh', 'dsh/profiles', 'dsh/profiles/'+sourceProfile];
  for(const part of parts){
    const stat=await statOrMissing(join(root,part));
    if(stat && (!stat.isDirectory()||stat.isSymbolicLink()))throw failure('HARNESS_PROFILE_PATH');
    if(!part&&!stat)throw failure('HARNESS_PROFILE_ISOLATION');
  }
  // Reject linked ancestors as well: a candidate path must not alias another home.
  for(let path=root;;){
    const stat=await lstat(path);
    if(stat.isSymbolicLink())throw failure('HARNESS_PROFILE_PATH');
    const parent=resolve(path,'..');if(parent===path)break;path=parent;
  }
  const dir=join(home,'profiles',sourceProfile),stat=await statOrMissing(dir);
  const args=['--profile',sourceProfile];
  if(!stat) return [...args,'--from-default-profile','web','--host','127.0.0.1','--port','0','--no-open'];
  const manifestPath=join(dir,'package.json'),manifestStat=await statOrMissing(manifestPath);
  if(!manifestStat?.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>65536)throw failure('HARNESS_PROFILE_INCOMPLETE');
  let manifest;
  try {manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{throw failure('HARNESS_PROFILE_INCOMPLETE');}
  const bundles=manifest?.dsh?.profile?.bundles;
  // The native plugin manager appends installed bundle names to this manifest.
  // Keep the two desktop foundations and reject duplicate/path-like specifiers.
  const foundations=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'];
  const packageName=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  if(!Array.isArray(bundles)||bundles.length<2||bundles.length>128||foundations.some((name,i)=>bundles[i]!==name)||new Set(bundles).size!==bundles.length||bundles.some(name=>typeof name!=='string'||name.length>214||!packageName.test(name)))throw failure('HARNESS_PROFILE_INCOMPATIBLE');
  return [...args,'--host','127.0.0.1','--port','0','--no-open'];
}
