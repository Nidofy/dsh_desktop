/** Real three-minute engineering timeout in a fresh supported Host; one held local synthetic request and no action or billing. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function runEngineeringTimeoutProfile({host,api,launch,evidence,root,home,project,node}) {
  const durationMs=process.argv[4]==='deadline-diagnostic'?2000:process.argv[4]==='deadline-medium'?12000:180000
  const responses=new Set();let requests=0
  const provider=createServer(async(request,response)=>{
    for await(const _part of request){};requests++
    responses.add(response);response.once('close',()=>responses.delete(response))
    response.writeHead(200,{'content-type':'text/event-stream'})
    response.write('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'Held synthetic request'},finish_reason:null}]})+'\n\n')
  })
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve))
  try {
    const original=await readFile(join(project,'src/case.test.mjs')),quote=value=>"'"+value.replaceAll("'","''")+"'"
    const config={schemaVersion:1,actions:[{id:'case',label:'Reviewed isolated timeout case',command:'& '+quote(node)+' --test --test-isolation=none --test-reporter=tap ./src/case.test.mjs',timeoutMs:Math.min(10000,durationMs),
      verification:{schemaVersion:1,intent:'Timeout must not execute this action',parser:'node-tap-13/1',coverage:'complete',sources:['src'],inputs:['inputs'],toolchain:[node],parameters:{tolerance:0}}}]}
    const saved=await api.post('actions/save',{workspace:project,config});await api.post('actions/trust',{workspace:project,fingerprint:saved.fingerprint})
    const mutation=await fetch(api.base+'/api/nidofy/mutate',{method:'POST',headers:{cookie:api.cookie,origin:api.base,'content-type':'application/json'},body:JSON.stringify({
      action:'save',operationId:randomUUID(),connection:'engineering',expectedRevision:0,credential:{mode:'replace',value:'synthetic-timeout-only'},
      profile:{api:'openai-completions',baseURL:'http://127.0.0.1:'+provider.address().port+'/v1',models:[{id:'engineering-model'}],defaultContextWindow:32768,defaultMaxTokens:64,retryPolicy:{mode:'normal',maxRetries:0}}})})
    assert.equal(mutation.status,200,await mutation.text())
    const input={experimentId:randomUUID(),caseId:randomUUID(),source:project,paths:['src','inputs'],actionIds:['case'],connection:'engineering',model:'engineering-model',text:'Wait for this one held synthetic request; never execute an action.',
      shellBudget:{outputBytes:8388608,retainedSpillBytes:134217728},
      resourceBudget:{workspaceBytes:33554432,workspaceEntries:1024,retainedWorkspaceBytes:536870912,sessionBytes:2097152,sessionDiskBytes:2097152,sessionEvents:4096},
      budget:{requests:2,outputTokensPerRequest:64,outputTokens:128,toolCalls:2,actions:1,durationMs}}
    if(process.argv[3]==='engineering-refusal'){
      const refused=await api.post('experiments/engineering-prepare',input,400)
      assert.equal(refused.error,'EXPERIMENT_ENGINEERING_SANDBOX_REFUSED');assert.equal(requests,0)
      assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0});assert.deepEqual(await readFile(join(project,'src/case.test.mjs')),original)
      await host.stop()
      const summary={root,qualification:'actual-full-access-profile-refuses-engineering-prepare',paidRequests:0,syntheticProviderHttpCalls:0,
        officialStreamEntries:0,actualAgents:0,actualProtectedActions:0,sourceUnchanged:true}
      await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({evidence,...summary}));return
    }
    const plan=await api.post('experiments/engineering-prepare',input),id=randomUUID(),startedAt=new Date().toISOString(),clock=performance.now()
    await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
    await host.collect()
    let value,collections=1,lastCollection=performance.now()
    for(;;){value=await api.post('experiments/engineering-read',{id});if(value?.status!=='RUNNING')break;if(performance.now()-clock>durationMs+30000)throw Error('Timeout did not settle');if(performance.now()-lastCollection>5000){await host.collect();collections++;lastCollection=performance.now()}await new Promise(resolve=>setTimeout(resolve,1000))}
    const elapsedMs=performance.now()-clock
    assert.equal(value.status,'TIMEOUT');assert.ok(elapsedMs>=durationMs-1000&&elapsedMs<durationMs+30000,JSON.stringify({elapsedMs}));assert.ok(collections>=(durationMs===180000?30:1))
    assert.equal(value.counts.dispatches,1);assert.equal(value.counts.outputTokens,null);assert.equal(value.counts.providerWireRequests,null)
    assert.equal(value.receipts.length,0);assert.equal(value.counts.actionAttempts,0);assert.equal(requests,1);assert.equal(responses.size,0)
    assert.deepEqual(await api.counts(),{modelRequests:1,createdAgents:1});assert.deepEqual(await readFile(join(project,'src/case.test.mjs')),original)
    await writeFile(join(evidence,'timeout-result.json'),JSON.stringify(value,null,2)+'\n')
    const terminalPath=join(home,'nidofy-extras/experiments/engineering-v1',id,'terminal.json'),terminal=await readFile(terminalPath)
    await host.stop();host=launch();api=await host.api()
    assert.deepEqual(await api.post('experiments/engineering-read',{id}),value);assert.deepEqual(await readFile(terminalPath),terminal)
    assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0});assert.equal(requests,1)
    await host.stop()
    const summary={root,startedAt,completedAt:new Date().toISOString(),budgetDurationMs:durationMs,observedElapsedMs:elapsedMs,forcedGcCollections:collections,
      status:'TIMEOUT',paidRequests:0,syntheticProviderHttpCalls:1,officialStreamEntries:1,actualAgents:1,actualProtectedActions:0,
      coldReadUnchanged:true,subsequentDispatches:0,analysisThreeMinuteClock:'UNKNOWN',renderer:'UNKNOWN',installer:'UNKNOWN'}
    await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({evidence,...summary}))
  }finally{for(const response of responses)response.destroy();await new Promise(resolve=>provider.close(resolve))}
}
