import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createInventory} from '../runtime-src/runtime-integrity.mjs';
import {project,validatePin,assertIdentity,verifyArtifact,importArtifact,admission,validateDeployment,workspaceClosure,verifyImportedSource} from '../scripts/harness-source.mjs';

const pin=JSON.parse(await readFile(join(project,'build-deps/harness-source.json'),'utf8'));
const source={...pin,platform:process.platform,arch:process.arch};
async function fixture(){
  await mkdir(join(project,'.build'),{recursive:true});
  const root=await mkdtemp(join(project,'.build/source-contract-'));
  const artifact=join(root,'artifact'),runtime=join(artifact,'runtime'),cli=join(runtime,'dsh/node_modules/@deepseek-ai/dsh');
  await mkdir(cli,{recursive:true});
  await writeFile(join(cli,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:pin.version}));
  const manifest={schemaVersion:1,kind:'harness-source-artifact',status:'SOURCE_SMOKE_PASSED',source,smoke:{version:pin.version},files:await createInventory(runtime)};
  await writeFile(join(artifact,'source-artifact.json'),JSON.stringify(manifest));
  return {root,artifact,runtime,cli,manifest};
}

test('pin and artifact identity reject changed commits, dependency locks and targets',()=>{
  assert.equal(validatePin(pin),pin);
  assert.throws(()=>validatePin({...pin,commit:'master'}));
  for(const key of ['repository','commit','version','node','packageManager','lockSha256','workspaceSha256'])assert.throws(()=>assertIdentity({...source,[key]:'changed'},pin));
  assert.throws(()=>assertIdentity({...source,platform:'other'},pin));
});
test('candidate source cannot silently replace current desktop engine',()=>{
  const result=admission({source},{...pin,desktopAdapterApproved:false},{dsh:'0.1.5-rc.2',node:pin.node});
  assert.equal(result.allowed,false);
  assert.deepEqual(result.reasons,['DESKTOP_ENGINE_VERSION_MISMATCH','DESKTOP_ADAPTER_NOT_APPROVED']);
  assert.equal(admission({source},{...pin,desktopAdapterApproved:true},{dsh:pin.version,node:pin.node}).allowed,true);
});
test('verified candidate import creates a complete new tree and refuses existing destinations',async()=>{
  const f=await fixture(),out=join(f.root,'import');
  await verifyArtifact(f.artifact,pin);await importArtifact(f.artifact,out,pin);
  const baseline=JSON.parse(await readFile(join(out,'dsh-integrity.json'),'utf8'));
  assert.equal(baseline.source.commit,pin.commit);
  assert.equal(baseline.sourceArtifactSha256.length,64);
  await assert.rejects(importArtifact(f.artifact,out,pin),/already exists/);
});
test('changed bytes, added files and missing successful smoke reject before import',async()=>{
  const f=await fixture();
  await writeFile(join(f.cli,'package.json'),'{}');
  await assert.rejects(verifyArtifact(f.artifact,pin),/INTEGRITY_CHANGED/);
  const g=await fixture();await writeFile(join(g.runtime,'extra'),'unexpected');
  await assert.rejects(verifyArtifact(g.artifact,pin),/INTEGRITY_EXTRA/);
  const h=await fixture();h.manifest.status='BUILD_ONLY';await writeFile(join(h.artifact,'source-artifact.json'),JSON.stringify(h.manifest));
  await assert.rejects(verifyArtifact(h.artifact,pin),/successful source smoke/);
});
test('deployment cannot depend on checkout links outside its own directory',async()=>{
  const f=await fixture(),deploy=join(f.root,'deploy');await mkdir(deploy);
  await writeFile(join(deploy,'plain'),'ok');await validateDeployment(deploy);
  await symlink(f.cli,join(deploy,'escape'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(validateDeployment(deploy),/escapes output/);
});
test('import refuses an artifact with traversal manifest paths',async()=>{
  const f=await fixture();f.manifest.files[0].path='../outside';
  await writeFile(join(f.artifact,'source-artifact.json'),JSON.stringify(f.manifest));
  await assert.rejects(importArtifact(f.artifact,join(f.root,'out'),pin),/INTEGRITY_MANIFEST/);
});
test('workspace closure includes runtime peers and cycles, excludes dev-only packages',()=>{
  const pkg=(name,rest={})=>[name,{path:name,manifest:{name,...rest}}];
  const entries=new Map([
    pkg('@deepseek-ai/dsh',{dependencies:{service:'workspace:*'},devDependencies:{test:'workspace:*'}}),
    pkg('service',{peerDependencies:{peer:'workspace:*'}}),
    pkg('peer',{peerDependencies:{service:'workspace:*'}}),pkg('test'),
  ]);
  assert.deepEqual(workspaceClosure(entries).map(p=>p.manifest.name),['@deepseek-ai/dsh','service','peer']);
});
test('production source validation binds imported receipt, files, approval and version',async()=>{
  const f=await fixture(),out=join(f.root,'import');await importArtifact(f.artifact,out,pin);
  const baseline=JSON.parse(await readFile(join(out,'dsh-integrity.json'),'utf8'));
  const approved={...pin,desktopAdapterApproved:true},versions={dsh:pin.version,node:pin.node};
  await verifyImportedSource(out,baseline,approved,versions);
  await assert.rejects(verifyImportedSource(out,baseline,{...pin,desktopAdapterApproved:false},versions),/not approved/);
  await assert.rejects(verifyImportedSource(out,baseline,approved,{...versions,dsh:'0.1.5-rc.2'}),/not approved/);
  await assert.rejects(verifyImportedSource(out,{...baseline,files:[]},approved,versions),/baseline differs/);
  await writeFile(join(out,'harness-source-artifact.json'),'{}');
  await assert.rejects(verifyImportedSource(out,baseline,approved,versions),/receipt changed/);
});
