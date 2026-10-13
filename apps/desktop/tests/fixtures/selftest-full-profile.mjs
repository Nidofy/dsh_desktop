/** Current full-profile Host, exact authentication, formal local checks and process-loss cold read; no Agent or model generation. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const repo=resolve(import.meta.dirname,'../../../..'), evidence=resolve(process.argv[2])
await mkdir(evidence,{recursive:true})
const root=await mkdtemp(join(tmpdir(),'dsh-selftest-host-')),home=join(root,'home'),project=join(root,'project'),source=join(root,'runtime/primary-runtime')
await writeFile(join(evidence,'fixture-root.json'),JSON.stringify({root,home,project,isolated:true})+'\n')
const projections=[],children=new Set(), observations=[]
process.on('message',message=>{if(message?.type==='cancel')for(const child of children)child.kill()})
try{
  await mkdir(home);await mkdir(project)
  for(const scope of ['@deepseek-ai','@nidofy']){
    const installed=join(repo,'node_modules/.pnpm/node_modules',scope),target=join(project,'node_modules',scope)
    await mkdir(target,{recursive:true})
    for(const name of await readdir(installed)){const path=join(target,name);await symlink(await realpath(join(installed,name)),path,process.platform==='win32'?'junction':'dir');projections.push(path)}
  }
  await writeFile(join(project,'package.json'),JSON.stringify({name:'isolated-selftest-profile',private:true,type:'module',
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@nidofy/dsh-desktop-bundle']}}}))
  await cp(join(repo,'packages/skill/skill-office/assets'),join(root,'runtime/office-skills'),{recursive:true})
  await mkdir(join(source,'dependencies/node/bin'),{recursive:true});await cp(process.execPath,join(source,'dependencies/node/bin/node.exe'))
  const patch=join(root,'distribution.patch.json')
  await writeFile(patch,JSON.stringify([{id:'webserver',config:{host:'127.0.0.1',port:0}},
    ...['llm-deepseek','llm-deepseek-account','session-title-llm','session-telemetry-otel','desktop-product-telemetry','product-analytics','agent-instructions'].map(id=>({id,disabled:true})),
    {insert:[{id:'selftest-profile-qualification',name:pathToFileURL(join(import.meta.dirname,'selftest-profile-probe.mjs')).href}]}]))
  function launch(){
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(path|systemroot|windir|comspec|pathext)$/iu.test(name)))
    const child=spawn(process.execPath,[join(repo,'apps/desktop-host/lib/index.js'),project,project,source],{cwd:project,
      env:{...env,DSH_HOME:home,HOME:root,USERPROFILE:root,TEMP:root,TMP:root,TMPDIR:root,
        DSH_DESKTOP_DISTRIBUTION_PATCH:patch,DSH_DESKTOP_DISTRIBUTION_KIND:'personal',
        DSH_DESKTOP_PROTECTION_HELPER:join(repo,'native/nidofy-protection/target/release/nidofy-protection.exe')},
      stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
    children.add(child);const messages=[],output=[]
    child.stdout.on('data',chunk=>output.push(String(chunk)));child.stderr.on('data',chunk=>output.push(String(chunk)))
    child.on('message',message=>messages.push(message))
    const done=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',async(code,signal)=>{
      await writeFile(join(evidence,'host-'+child.pid+'.log'),output.join('').replace(/token=[A-Za-z0-9_-]+/g,'token=[redacted]'));accept({code,signal})})})
    const wait=async predicate=>{const deadline=Date.now()+45000;while(!predicate()){
      if(child.exitCode!==null||Date.now()>deadline)throw Error('Host did not reach expected state: '+output.join(''));await new Promise(accept=>setTimeout(accept,20))}}
    return {child,done,async api(){await wait(()=>messages.some(row=>row.type==='ready'||row.type==='fatal'))
      const ready=messages.find(row=>row.type==='ready'||row.type==='fatal');assert.equal(ready.type,'ready',ready.diagnostic??output.join(''))
      const base=new URL(ready.url).origin,exchange=await fetch(ready.url,{redirect:'manual'}),cookie=exchange.headers.get('set-cookie')?.split(';')[0]
      assert.equal(exchange.status,303);assert.ok(cookie)
      return {base,cookie,async observations(){const response=await fetch(base+'/api/selftest-qualification',{headers:{cookie,origin:base}})
        assert.equal(response.status,200);return response.json()},async post(method,data={}){const response=await fetch(base+'/api/nidofy/workbench/selftest/'+method,{method:'POST',
        headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(45000)})
        const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value}}
    },async stop(force=false){if(force)child.kill();else child.send({type:'shutdown'});const timeout=setTimeout(()=>child.kill(),45000)
      try{const result=await done;if(!force)assert.deepEqual(result,{code:0,signal:null});children.delete(child)}finally{clearTimeout(timeout)}}}
  }
  let host=launch(),api=await host.api()
  assert.equal((await fetch(api.base+'/api/nidofy/workbench/selftest/ui')).status,401)
  assert.equal((await fetch(api.base+'/api/nidofy/workbench/selftest/start',{method:'POST',headers:{cookie:api.cookie,origin:'https://wrong.invalid'},body:'{}'})).status,403)
  const ui=await fetch(api.base+'/api/nidofy/workbench/selftest/ui?locale=zh-CN',{headers:{cookie:api.cookie}})
  assert.equal(ui.status,200);assert.match(await ui.text(),/Electron 自检中心/)
  assert.deepEqual(await api.post('connection-capacity'),{roots:0,unsettled:0,available:true,code:'OK'})
  if(process.argv[3]==='provider'){
    const requests=[],responses=new Set();let hold=false
    const provider=createServer(async(request,response)=>{
      responses.add(response);response.on('close',()=>responses.delete(response))
      const chunks=[];for await(const chunk of request)chunks.push(chunk)
      const body=JSON.parse(Buffer.concat(chunks).toString());assert.equal(body.model,'synthetic-model')
      assert.equal(body.max_tokens??body.max_completion_tokens,64);assert.equal(request.headers.authorization,'Bearer synthetic-selftest-only')
      requests.push(body);response.writeHead(200,{'content-type':'text/event-stream'})
      const tools=body.tools?.length>0
      response.write('data: '+JSON.stringify({choices:[{index:0,delta:tools?{role:'assistant',tool_calls:[{index:0,id:'echo-local',type:'function',function:{name:'selftest_echo',arguments:'{"value":"synthetic"}'}}]}:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\n')
      if(hold)return
      response.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:tools?'tool_calls':'stop'}],usage:{prompt_tokens:512,completion_tokens:8,prompt_tokens_details:{cached_tokens:16}}})+'\n\ndata: [DONE]\n\n')
    })
    await new Promise(accept=>provider.listen(0,'127.0.0.1',accept))
    try{
      const endpoint='http://127.0.0.1:'+provider.address().port
      const connection=await fetch(api.base+'/api/nidofy/mutate',{method:'POST',headers:{cookie:api.cookie,origin:api.base,'content-type':'application/json'},
        body:JSON.stringify({action:'save',operationId:randomUUID(),connection:'synthetic',expectedRevision:0,
          profile:{api:'openai-completions',baseURL:endpoint+'/v1',models:[{id:'synthetic-model'}],defaultContextWindow:8192,defaultMaxTokens:64,retryPolicy:{mode:'normal',maxRetries:0}},
          credential:{mode:'replace',value:'synthetic-selftest-only'}})})
      assert.equal(connection.status,200,await connection.text())
      const prepare=()=>api.post('connection-prepare',{connection:'synthetic',model:'synthetic-model',requests:5})
      const settled=async id=>{let report;const deadline=Date.now()+45000;do{report=await api.post('read',{id});if(Date.now()>deadline)throw Error('Provider report timeout');await new Promise(accept=>setTimeout(accept,30))}while(report.status==='RUNNING');return report}
      const waitRequests=async count=>{const deadline=Date.now()+15000;while(requests.length<count){if(Date.now()>deadline)throw Error('Provider request did not start');await new Promise(accept=>setTimeout(accept,20))}}
      const plan=await prepare();assert.equal(requests.length,0);assert.equal(plan.configurationRevision,1);assert.equal(plan.policyRevision.profile,0)
      const id=randomUUID();await api.post('start',{mode:'provider',operationId:id,ticket:plan.ticket,accepted:true})
      const report=await settled(id);assert.equal(report.status,'COMPLETED',JSON.stringify(report));assert.equal(requests.length,5)
      assert.equal(report.rows.filter(row=>row.status==='PASS').length,5);assert.ok(report.rows.slice(-2).every(row=>row.status==='UNKNOWN'))
      assert.deepEqual(await api.observations(),{modelRequests:5,createdAgents:0})
      assert.deepEqual(await api.post('connection-capacity'),{roots:1,unsettled:0,available:true,code:'OK'})
      const require=createRequire(join(project,'package.json'))
      const [{Context},{default:Jsonl},{Session}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-session-persistence-jsonl','@deepseek-ai/dsh-session'].map(name=>import(pathToFileURL(require.resolve(name)).href)))
      const cold=new Context();await cold.plugin(Jsonl,{root:join(home,'nidofy-extras/selftests/inputs',id),compression:'none'})
      try{const logs=await cold.sessionPersistence.list();assert.equal(logs.length,5)
        for(const row of logs){const raw=await cold.sessionPersistence.observeDurable(row.header.id),session=Session.create(raw.meta.id,raw.events,raw.meta)
          assert.equal(session.requestHeader().config.maxTokens,64);assert.equal(session.deriveMessages()[0].content[0].text,requests[Number(String(row.header.id).split('-').at(-1))].messages[0].content)
        }
      }finally{await cold.fiber.dispose()}
      const exported=await api.post('export',{id});for(const privateText of [root,endpoint,'synthetic-model','synthetic-selftest-only',id,'Call selftest_echo'])assert.ok(!JSON.stringify(exported).includes(privateText))
      await writeFile(join(evidence,'provider-report.json'),JSON.stringify(report,null,2)+'\n')
      observations.push('authenticated-full-profile-five-synthetic-sends-64-output-budget-official-input-cold-reconstruction-zero-agents')
      hold=true;const cancellation=await prepare(),cancelId=randomUUID();await api.post('start',{mode:'provider',operationId:cancelId,ticket:cancellation.ticket,accepted:true})
      await waitRequests(6);await api.post('cancel',{id:cancelId});assert.equal((await api.post('read',{id:cancelId})).status,'CANCELLED');assert.equal(requests.length,6)
      const interrupted=randomUUID(),crash=await prepare();await api.post('start',{mode:'provider',operationId:interrupted,ticket:crash.ticket,accepted:true});await waitRequests(7)
      const path=join(home,'nidofy-extras/selftests/reports',interrupted+'.json'),before=await readFile(path)
      assert.equal(JSON.parse(before).rows.find(row=>row.id==='connection').phase,'RUNNING');await host.stop(true)
      host=launch();api=await host.api();const recovered=await api.post('read',{id:interrupted})
      assert.equal(recovered.status,'INTERRUPTED');assert.equal(recovered.rows.find(row=>row.id==='connection').status,'UNKNOWN')
      assert.deepEqual(await readFile(path),before);assert.equal(requests.length,7);assert.deepEqual(await api.observations(),{modelRequests:0,createdAgents:0})
      assert.deepEqual(await api.post('connection-capacity'),{roots:3,unsettled:1,available:true,code:'OK'})
      assert.deepEqual(await readFile(path),before);assert.equal(requests.length,7)
      await host.stop();observations.push('cancel-started-sse-drain-and-forced-host-exit-during-observed-request-no-replay')
      await writeFile(join(evidence,'provider-summary.json'),JSON.stringify({observations,syntheticRequests:7,paidRequests:0,createdAgents:0,renderer:'UNKNOWN',installer:'UNKNOWN',gateway:'UNKNOWN'},null,2)+'\n')
      console.log(JSON.stringify({root,observations,syntheticRequests:7,paidRequests:0}))
    }finally{for(const response of responses)response.destroy();provider.closeAllConnections();await new Promise(accept=>provider.close(accept))}
  }else{
  const id=randomUUID();await api.post('start',{mode:'local',operationId:id})
  let report;const deadline=Date.now()+60000
  do{report=await api.post('read',{id});if(Date.now()>deadline)throw Error('Selftest timeout');await new Promise(accept=>setTimeout(accept,100))}while(report.status==='RUNNING')
  await writeFile(join(evidence,'local-report.json'),JSON.stringify(report,null,2)+'\n')
  assert.equal(report.status,'COMPLETED',JSON.stringify(report));assert.equal(report.budget.modelRequests,0)
  assert.ok(report.rows.some(row=>row.id==='storage'&&row.status==='PASS'))
  assert.ok(report.rows.some(row=>row.id==='shell'&&row.status==='PASS'),JSON.stringify(report))
  assert.ok(report.rows.some(row=>row.id==='prefix'&&row.status==='PASS'&&row.metrics.requests===0),JSON.stringify(report))
  assert.ok(report.rows.slice(-2).every(row=>row.status==='UNKNOWN'))
  assert.deepEqual(await api.observations(),{modelRequests:0,createdAgents:0})
  const exported=await api.post('export',{id});assert.ok(!JSON.stringify(exported).includes(root));assert.ok(!('id'in exported))
  observations.push('authenticated-full-host-zero-model-local-report-field-unknown')
  await host.stop();host=launch();api=await host.api();assert.equal((await api.post('read',{id})).status,'COMPLETED')
  const interrupted=randomUUID();await api.post('start',{mode:'local',operationId:interrupted});await host.stop(true)
  const rawPath=join(home,'nidofy-extras/selftests/reports',interrupted+'.json'),before=await readFile(rawPath)
  host=launch();api=await host.api();const cold=await api.post('read',{id:interrupted})
  assert.equal(cold.status,'INTERRUPTED');assert.deepEqual(await readFile(rawPath),before)
  assert.deepEqual(await api.observations(),{modelRequests:0,createdAgents:0})
  assert.ok(cold.rows.every(row=>row.status!=='PASS'));await host.stop()
  observations.push('forced-isolated-host-exit-read-only-interrupted-no-replay')
  await writeFile(join(evidence,'summary.json'),JSON.stringify({observations,modelRequests:0,renderer:'UNKNOWN',installer:'UNKNOWN'},null,2)+'\n')
  console.log(JSON.stringify({root,observations,modelRequests:0}))
  }
}finally{
  for(const child of children){child.kill();await new Promise(accept=>{if(child.exitCode!==null)accept();else child.once('close',accept)})}
  for(const path of projections)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error})
}
