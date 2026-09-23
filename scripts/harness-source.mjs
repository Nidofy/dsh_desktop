// Build-time source candidates. Nothing here launches a model or touches user profiles.
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,lstat,readdir,realpath,rename} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createInventory,verifyInventory,readManifest,hashFile} from '../runtime-src/runtime-integrity.mjs';

export const project=resolve(fileURLToPath(new URL('../',import.meta.url)));
export const pinPath=join(project,'build-deps/harness-source.json');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const git=(source,args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true}).trim();
const inside=(root,path)=>{const p=relative(root,path);return p===''||(!p.startsWith('..')&&!isAbsolute(p));};
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};

export function validatePin(pin){
  if(pin?.schemaVersion!==1||!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(pin.repository??'')||
    !/^[a-f0-9]{40}$/.test(pin.commit??'')||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pin.version??'')||
    !/^pnpm@\d+\.\d+\.\d+$/.test(pin.packageManager??'')||
    !/^[a-f0-9]{64}$/.test(pin.lockSha256??'')||!/^[a-f0-9]{64}$/.test(pin.workspaceSha256??'')||
    typeof pin.desktopAdapterApproved!=='boolean')throw Error('Invalid Harness source pin');
  return pin;
}

export async function inspectSource(source,pin){
  pin??=await json(pinPath);validatePin(pin);source=await realpath(source);
  if(git(source,['rev-parse','--show-toplevel']).replaceAll('\\','/').toLowerCase()!==source.replaceAll('\\','/').toLowerCase())throw Error('Source must be the checkout root');
  if(git(source,['rev-parse','HEAD'])!==pin.commit)throw Error('Source commit differs from pin');
  if(git(source,['status','--porcelain','--untracked-files=normal']))throw Error('Source checkout must be clean; commit reviewed changes before building');
  if(git(source,['remote','get-url','origin'])!==pin.repository)throw Error('Source origin differs from pin');
  const pkg=await json(join(source,'package.json'));
  if(pkg.version!==pin.version||pkg.packageManager!==pin.packageManager)throw Error('Source version/package manager differs from pin');
  if(process.versions.node!==pin.node)throw Error('Use the pinned Node version for source builds');
  if((await hashFile(join(source,'pnpm-lock.yaml'))).sha256!==pin.lockSha256||(await hashFile(join(source,'pnpm-workspace.yaml'))).sha256!==pin.workspaceSha256)throw Error('Source dependency inputs differ from pin');
  return {schemaVersion:1,repository:pin.repository,commit:pin.commit,version:pin.version,packageManager:pin.packageManager,node:process.versions.node,platform:process.platform,arch:process.arch,lockSha256:pin.lockSha256,workspaceSha256:pin.workspaceSha256};
}

export function assertIdentity(identity,pin){
  validatePin(pin);
  for(const key of ['repository','commit','version','packageManager','node','lockSha256','workspaceSha256'])if(identity?.[key]!==pin[key])throw Error('Artifact source identity differs: '+key);
  if(identity.platform!==process.platform||identity.arch!==process.arch)throw Error('Artifact platform differs from host');
}

export async function verifyArtifact(artifact,pin){
  pin??=await json(pinPath);artifact=resolve(artifact);const manifest=await readManifest(join(artifact,'source-artifact.json'));
  if(manifest.schemaVersion!==1||manifest.kind!=='harness-source-artifact'||manifest.status!=='SOURCE_SMOKE_PASSED'||manifest.smoke?.version!==pin.version)throw Error('Artifact has no successful source smoke');
  assertIdentity(manifest.source,pin);
  await verifyInventory(join(artifact,'runtime'),manifest.files);
  const pkg=await json(join(artifact,'runtime/dsh/node_modules/@deepseek-ai/dsh/package.json'));
  if(pkg.version!==manifest.source.version)throw Error('Artifact CLI version differs');
  return manifest;
}

// pnpm deploy should contain its dependency closure. Escaping links are never copied.
export async function validateDeployment(root){
  root=await realpath(root);let count=0;
  async function walk(path,ancestors=new Set()){
    if(++count>200000)throw Error('Deployment file limit');
    const canonical=await realpath(path);
    if(!inside(root,canonical))throw Error('Deployment link escapes output: '+relative(root,path));
    const stat=await lstat(canonical);
    if(stat.isDirectory()){
      if(ancestors.has(canonical)||ancestors.size>48)throw Error('Deployment link cycle/depth');
      const next=new Set(ancestors).add(canonical);
      for(const name of await readdir(canonical))await walk(join(canonical,name),next);
    }else if(!stat.isFile())throw Error('Unsupported deployment entry');
  }
  await walk(root);
}

export async function begin(source,run){
  run=resolve(run);
  const identity=await inspectSource(source);
  await mkdir(run,{recursive:false});
  await save(join(run,'source-build-start.json'),{source:identity,startedAt:new Date().toISOString()});
  return identity;
}

// pnpm converts a reviewed workspace build key to an absolute file URL during deploy.
// Translate only that existing approval; all other ignored scripts still fail.
export async function normalizeDeploymentApproval(source,run){
  run=resolve(run);
  await inspectSource(source);
  const workspace=await readFile(join(source,'pnpm-workspace.yaml'),'utf8');
  if(!workspace.includes("'@deepseek-ai/dsh-subprocess-local@file:packages/subprocess/subprocess-local': true"))throw Error('Upstream has not approved subprocess-local postinstall');
  const path=join(run,'deploy-locked/pnpm-workspace.yaml'),text=await readFile(path,'utf8');
  const pattern=/^  '(@deepseek-ai\/dsh-subprocess-local@file:[^']+)': set this to true or false\r?$/gm;
  const matches=[...text.matchAll(pattern)];
  if(matches.length!==1)throw Error('Expected one relocated subprocess-local approval');
  const target=fileURLToPath(matches[0][1].slice('@deepseek-ai/dsh-subprocess-local@'.length));
  if((await realpath(target))!==(await realpath(join(source,'packages/subprocess/subprocess-local'))))throw Error('Relocated build approval points outside pinned package');
  const edited=text.replace(pattern,"  '$1': true");
  if(edited.includes('set this to true or false'))throw Error('Other unreviewed build scripts require inspection');
  await writeFile(path,edited);
  return {translated:'@deepseek-ai/dsh-subprocess-local',sourceCommit:(await inspectSource(source)).commit};
}

export function workspaceClosure(packages,root='@deepseek-ai/dsh'){
  const selected=new Map();
  function visit(name){
    if(selected.has(name))return;
    const pkg=packages.get(name);if(!pkg)throw Error('Workspace entry missing: '+name);
    selected.set(name,pkg);
    for(const section of ['dependencies','peerDependencies','optionalDependencies'])for(const dep of Object.keys(pkg.manifest[section]??{})){
      const child=packages.get(dep);if(!child)continue;
      const supported=(values,host)=>!values||(!values.includes('!'+host)&&(values.every(x=>x.startsWith('!'))||values.includes(host)));
      if(!supported(child.manifest.os,process.platform)||!supported(child.manifest.cpu,process.arch)){
        if(section!=='optionalDependencies')throw Error('Required workspace package targets another platform: '+dep);
        continue;
      }
      visit(dep);
    }
  }
  visit(root);return [...selected.values()];
}

// Workspace peers are not automatically installed by pnpm. Pack the missing peers
// from this same clean checkout, preserving each package's published file selection.
export async function completeWorkspaceClosure(source,run){
  run=resolve(run);source=await realpath(source);await inspectSource(source);
  const packages=new Map();
  const paths=git(source,['ls-files']).split('\n').filter(p=>/^(packages\/[^/]+\/[^/]+|vendor\/[^/]+|apps\/[^/]+|native\/system\/packages\/[^/]+)\/package.json$/.test(p));
  for(const path of paths){const manifest=await json(join(source,path));packages.set(manifest.name,{path:dirname(path),manifest});}
  const selected=workspaceClosure(packages),deployment=join(run,'deploy-locked'),packs=join(run,'workspace-packs');
  await mkdir(packs,{recursive:true});
  const require=createRequire(join(source,'package.json'));
  const tar=await import(pathToFileURL(require.resolve('tar')).href);
  const receipts=[];
  for(const pkg of selected){
    const target=join(deployment,'node_modules',pkg.manifest.name);
    if(await exists(join(target,'package.json'))){
      if((await json(join(target,'package.json'))).version!==pkg.manifest.version)throw Error('Deployed workspace version differs: '+pkg.manifest.name);
      continue;
    }
    const packDir=join(packs,pkg.manifest.name.replaceAll('/','_'));await mkdir(packDir,{recursive:false});
    execFileSync(process.execPath,[join(source,'node_modules/pnpm/bin/pnpm.mjs'),'--dir',join(source,pkg.path),'pack','--pack-destination',packDir],{cwd:source,encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000,windowsHide:true});
    const archives=(await readdir(packDir)).filter(name=>name.endsWith('.tgz'));if(archives.length!==1)throw Error('Expected one workspace tarball');
    const archive=join(packDir,archives[0]);let unsafe=false;
    await tar.t({file:archive,strict:true,onReadEntry:entry=>{
      const parts=entry.path.split('/');if(parts[0]!=='package'||parts.some(p=>p==='..'||p==='.'||/[\\:\x00-\x1f]/.test(p))||!['File','Directory'].includes(entry.type))unsafe=true;
    }});
    if(unsafe)throw Error('Unsafe workspace tarball');
    await mkdir(target,{recursive:true});await tar.x({file:archive,cwd:target,strip:1,strict:true});
    const installed=await json(join(target,'package.json'));if(installed.name!==pkg.manifest.name||installed.version!==pkg.manifest.version)throw Error('Packed workspace identity differs');
    receipts.push({name:installed.name,version:installed.version,source:pkg.path,archiveSha256:(await hashFile(archive)).sha256});
  }
  await inspectSource(source);
  const result={sourceCommit:(await inspectSource(source)).commit,requiredWorkspacePackages:selected.length,packedMissingPeers:receipts};
  await save(join(deployment,'source-workspace-packages.json'),result);return result;
}

export async function assemble(source,run){
  run=resolve(run);
  const start=await json(join(run,'source-build-start.json'));
  if(JSON.stringify(start.source)!==JSON.stringify(await inspectSource(source)))throw Error('Source changed during build');
  const deployment=join(run,'deploy-locked');await validateDeployment(deployment);
  if(!await exists(join(deployment,'pnpm-lock.yaml')))throw Error('Frozen deployment lock missing');
  const artifact=join(run,'artifact.pending'),dsh=join(artifact,'runtime/dsh'),cli=join(dsh,'node_modules/@deepseek-ai/dsh');
  if(await exists(artifact))throw Error('Assembly output exists');
  await mkdir(cli,{recursive:true});
  await cp(join(deployment,'node_modules'),join(dsh,'node_modules'),{recursive:true,dereference:true});
  if(!await exists(join(cli,'lib/bin.js')))throw Error('CLI is missing from completed workspace closure');
  await cp(join(deployment,'source-workspace-packages.json'),join(dsh,'source-workspace-packages.json'));
  await save(join(dsh,'package.json'),{name:'dsh-desktop-source-runtime',private:true,type:'module',dependencies:{'@deepseek-ai/dsh':start.source.version}});
  await cp(join(source,'pnpm-lock.yaml'),join(dsh,'source-pnpm-lock.yaml'));
  await cp(join(source,'pnpm-workspace.yaml'),join(dsh,'source-pnpm-workspace.yaml'));
  await cp(join(deployment,'pnpm-lock.yaml'),join(dsh,'deployed-pnpm-lock.yaml'));
  return artifact;
}

export async function seal(source,run){
  run=resolve(run);
  const start=await json(join(run,'source-build-start.json'));
  if(JSON.stringify(start.source)!==JSON.stringify(await inspectSource(source)))throw Error('Source changed during build');
  const artifact=join(run,'artifact.pending'),runtime=join(artifact,'runtime');
  const before=await createInventory(runtime);
  const home=join(run,'smoke-home');await mkdir(home,{recursive:true});
  const env={...process.env,DSH_HOME:home,DSH_AGENTS_HOME:join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'};
  for(const key of Object.keys(env))if(key.startsWith('DSH_')&&!['DSH_HOME','DSH_AGENTS_HOME','DSH_TELEMETRY_DISABLED'].includes(key)||['NODE_OPTIONS','NODE_PATH','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL'].includes(key))delete env[key];
  const cli=join(runtime,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  const version=execFileSync(process.execPath,[cli,'--version'],{cwd:home,env,encoding:'utf8',timeout:30000,windowsHide:true}).trim();
  if(version!==start.source.version)throw Error('Installed CLI version smoke failed');
  const help=execFileSync(process.execPath,[cli,'--help'],{cwd:home,env,encoding:'utf8',timeout:30000,windowsHide:true});
  if(!help.includes('profile'))throw Error('Installed CLI help smoke failed');
  await verifyInventory(runtime,before);
  const manifest={schemaVersion:1,kind:'harness-source-artifact',status:'SOURCE_SMOKE_PASSED',source:start.source,startedAt:start.startedAt,completedAt:new Date().toISOString(),smoke:{version,help:true,modelCalls:0},desktopAcceptance:'NOT_RUN',files:before};
  await save(join(artifact,'source-artifact.json'),manifest);
  await verifyArtifact(artifact);
  const final=join(run,'artifact');await rename(artifact,final);return {artifact:final,files:before.length,source:start.source};
}

export function admission(manifest,pin,versions){
  const reasons=[];
  if(manifest.source.version!==versions.dsh)reasons.push('DESKTOP_ENGINE_VERSION_MISMATCH');
  if(!pin.desktopAdapterApproved)reasons.push('DESKTOP_ADAPTER_NOT_APPROVED');
  if(manifest.source.node!==versions.node)reasons.push('DESKTOP_NODE_VERSION_MISMATCH');
  return {allowed:reasons.length===0,reasons};
}

export async function verifyImportedSource(root,baseline,pin,versions){
  if(!pin.desktopAdapterApproved||versions.dsh!==pin.version||versions.node!==pin.node)throw Error('Source runtime not approved for this desktop combination');
  const path=join(root,'harness-source-artifact.json'),manifest=await readManifest(path);
  if((await hashFile(path)).sha256!==baseline.sourceArtifactSha256)throw Error('Imported source receipt changed');
  if(manifest.kind!=='harness-source-artifact'||manifest.status!=='SOURCE_SMOKE_PASSED'||manifest.smoke?.version!==pin.version)throw Error('Imported source smoke missing');
  assertIdentity(manifest.source,pin);assertIdentity(baseline.source,pin);
  if(manifest.files.some(file=>!file.path.startsWith('dsh/')))throw Error('Source artifact contains unexpected runtime component');
  const expected=manifest.files.map(file=>({...file,path:file.path.slice(4)}));
  if(JSON.stringify(expected)!==JSON.stringify(baseline.files))throw Error('Imported dependency baseline differs from source artifact');
  return verifyInventory(join(root,'dsh'),expected);
}

// Import is copy + verify + atomic rename into a new directory; never merge into a live tree.
export async function importArtifact(artifact,destination,pin){
  pin??=await json(pinPath);const manifest=await verifyArtifact(artifact,pin);destination=resolve(destination);
  if(await exists(destination))throw Error('Import destination already exists');
  const parent=await realpath(dirname(destination));
  if(inside(resolve(artifact),parent))throw Error('Import cannot be inside artifact');
  const pending=join(parent,'.harness-import-'+randomUUID());await mkdir(pending);
  await cp(join(artifact,'runtime/dsh'),join(pending,'dsh'),{recursive:true});
  await save(join(pending,'harness-source-artifact.json'),manifest);
  const files=await createInventory(join(pending,'dsh'));
  await save(join(pending,'dsh-integrity.json'),{schemaVersion:1,kind:'dsh-dependencies',version:manifest.source.version,source:manifest.source,sourceArtifactSha256:(await hashFile(join(pending,'harness-source-artifact.json'))).sha256,files});
  await verifyInventory(pending,manifest.files,{exclude:['harness-source-artifact.json','dsh-integrity.json']});
  await rename(pending,destination);
  return {status:'IMPORTED_CANDIDATE',destination,source:manifest.source};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,a,b]=process.argv.slice(2);let result;
  if(mode==='inspect')result=await inspectSource(a);
  else if(mode==='begin')result=await begin(a,b);
  else if(mode==='assemble')result=await assemble(a,b);
  else if(mode==='normalize-approval')result=await normalizeDeploymentApproval(a,b);
  else if(mode==='complete-closure')result=await completeWorkspaceClosure(a,b);
  else if(mode==='seal')result=await seal(a,b);
  else if(mode==='verify')result={status:'VERIFIED',source:(await verifyArtifact(a)).source};
  else if(mode==='import')result=await importArtifact(a,b);
  else if(mode==='admission'){
    const manifest=await verifyArtifact(a),pin=await json(pinPath),versions=await json(join(project,'versions.json'));
    result=admission(manifest,pin,versions);console.log(JSON.stringify(result));if(!result.allowed)process.exit(2);process.exit(0);
  }else throw Error('Expected inspect/begin/assemble/seal/verify/import/admission');
  console.log(JSON.stringify(result));
}
