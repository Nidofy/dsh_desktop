/** Actual bounded Agent tool selection over isolated copied inputs and a local synthetic provider; every root is retained. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, readdir, rename, mkdir, mkdtemp, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { checkEngineeringResources } from './experiments-engineering-resources.mjs'

export async function runEngineeringTasksProfile({host,api,launch,evidence,root,home,project,node}) {
  const requests=[],failures=[],responses=new Set();let mode='complete'
  const journalCounts=async(sessionId,action,cwd)=>{
    const url=api.base+'/api/experiments-session-resource-observer?'+new URLSearchParams({id:sessionId,...action?{action}:{},...cwd?{cwd}:{}})
    const response=await fetch(url,{method:action?'POST':'GET',headers:{cookie:api.cookie,origin:api.base}})
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value
  }
  const provider=createServer(async(request,response)=>{
    responses.add(response);response.once('close',()=>responses.delete(response))
    try {
      const parts=[];for await(const part of request)parts.push(part)
      const body=JSON.parse(Buffer.concat(parts).toString());requests.push(body)
      assert.equal(body.model,'engineering-model');assert.equal(request.headers.authorization,'Bearer synthetic-engineering-only')
      assert.equal(body.max_tokens??body.max_completion_tokens,64)
      assert.deepEqual(body.tools.map(tool=>tool.function.name),['list_project_actions','run_project_action'])
      if(mode==='failure'){response.writeHead(500);response.end('{"error":{"message":"synthetic failure"}}');return}
      response.writeHead(200,{'content-type':'text/event-stream'})
      const first=!body.messages.some(message=>message.role==='tool')
      if(mode==='hold'){response.write('data: '+JSON.stringify({model:'synthetic-engineering-response',choices:[{index:0,delta:{role:'assistant',content:'Held'},finish_reason:null}]})+'\n\n');return}
      const delta=mode==='denied'?{role:'assistant',tool_calls:[{index:0,id:'denied-call',type:'function',function:{name:'pwsh',arguments:'{"command":"unapproved synthetic command"}'}}]}:
        first?{role:'assistant',tool_calls:[{index:0,id:'engineering-call',type:'function',function:{name:'run_project_action',arguments:'{"id":"case"}'}}]}:{role:'assistant',content:'The retained receipt records the result; user acceptance is pending.'}
      response.write('data: '+JSON.stringify({model:'synthetic-engineering-response',choices:[{index:0,delta,finish_reason:null}]})+'\n\n')
      response.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:first||mode==='denied'?'tool_calls':'stop'}],
        usage:{prompt_tokens:12,completion_tokens:5,prompt_tokens_details:{cached_tokens:3}}})+'\n\ndata: [DONE]\n\n')
    }catch(error){failures.push(String(error));response.destroy()}
  })
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve))
  try {
    const quote=value=>"'"+value.replaceAll("'","''")+"'"
    const config={schemaVersion:1,actions:[{id:'case',label:'Reviewed isolated acceptance case',command:'& '+quote(node)+' --test --test-isolation=none --test-reporter=tap ./src/case.test.mjs',timeoutMs:10000,
      verification:{schemaVersion:1,intent:'Same isolated engineering task',parser:'node-tap-13/1',coverage:'complete',sources:['src'],inputs:['inputs'],toolchain:[node],parameters:{tolerance:0}}}]}
    const saved=await api.post('actions/save',{workspace:project,config});await api.post('actions/trust',{workspace:project,fingerprint:saved.fingerprint})
    const original=await readFile(join(project,'src/case.test.mjs'))
    const endpoint='http://127.0.0.1:'+provider.address().port
    const mutation=await fetch(api.base+'/api/nidofy/mutate',{method:'POST',headers:{cookie:api.cookie,origin:api.base,'content-type':'application/json'},
      body:JSON.stringify({action:'save',operationId:randomUUID(),connection:'engineering',expectedRevision:0,
        profile:{api:'openai-completions',baseURL:endpoint+'/v1',models:[{id:'engineering-model'}],defaultContextWindow:32768,defaultMaxTokens:64,retryPolicy:{mode:'normal',maxRetries:0}},
        credential:{mode:'replace',value:'synthetic-engineering-only'}})})
    assert.equal(mutation.status,200,await mutation.text())
    for(const method of ['engineering-prepare','engineering-start','engineering-read','engineering-cancel','engineering-compare',
      'matrix-prepare','matrix-start','matrix-read','matrix-cancel','matrix-export','matrix-import']) {
      const url=api.base+'/api/nidofy/workbench/experiments/'+method
      assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401)
      assert.equal((await fetch(url,{method:'POST',headers:{cookie:api.cookie,origin:'https://foreign.invalid'},body:'{}'})).status,403)
    }
    const input={experimentId:randomUUID(),caseId:randomUUID(),source:project,paths:['src','inputs'],actionIds:['case'],connection:'engineering',model:'engineering-model',text:'Run the reviewed case action once in this isolated copied workspace. Report its retained receipt; do not claim user acceptance.',
      shellBudget:{outputBytes:8388608,retainedSpillBytes:268435456},
      resourceBudget:{workspaceBytes:16777216,workspaceEntries:1024,retainedWorkspaceBytes:536870912,sessionBytes:2097152,sessionDiskBytes:2097152,sessionEvents:4096},
      budget:{requests:2,outputTokensPerRequest:64,outputTokens:128,toolCalls:2,actions:1,durationMs:30000}}
    const plan=await api.post('experiments/engineering-prepare',input)
    assert.equal(requests.length,0);assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0})
    assert.equal(plan.reviewedActions[0].command,config.actions[0].command)
    const id=randomUUID();await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
    const settled=async id=>{const deadline=Date.now()+45000;for(;;){const value=await api.post('experiments/engineering-read',{id});if(value?.status!=='RUNNING')return value;if(Date.now()>deadline)throw Error('Engineering task did not settle');await new Promise(resolve=>setTimeout(resolve,30))}}
    const result=await settled(id);await writeFile(join(evidence,'engineering-result.json'),JSON.stringify(result,null,2)+'\n')
    assert.equal(result.status,'COMPLETED',JSON.stringify(result.terminal));assert.equal(result.counts.dispatches,2);assert.equal(result.counts.outputTokens,10)
    assert.equal(result.counts.providerWireRequests,null);assert.equal(result.receipts.length,1)
    assert.deepEqual(result.resourceAllocation.budget,input.resourceBudget)
    assert.equal(result.resourceResult.diskPeakBytes,null);assert.equal(result.resourceResult.memoryPeakBytes,null)
    assert.ok(result.resourceResult.checkpoints.some(row=>row.phase==='drained'&&row.session?.diskBytes>0))
    assert.equal(result.receipts[0].view.phase,'COMMITTED');assert.equal(result.receipts[0].view.receipt.tests,'PASSED');assert.equal(result.receipts[0].view.receipt.acceptance,'PENDING')
    assert.equal(result.receipts[0].link.turn,1);assert.equal(result.receipts[0].link.step,1);assert.equal(result.receipts[0].link.callId,'engineering-call')
    assert.equal(result.dispatchInputs.length,2);assert.equal(result.requestObservations.length,2)
    assert.equal(result.intent.workspace.includes('dsh-engineering-task-'),true);assert.notEqual(result.intent.workspace,project)
    assert.deepEqual(await readFile(join(project,'src/case.test.mjs')),original)
    assert.deepEqual(await api.counts(),{modelRequests:2,createdAgents:1});assert.equal(requests.length,2)
    const directory=join(home,'nidofy-extras/experiments/engineering-v1',id),before=new Map()
    for(const name of await readdir(directory))before.set(name,await readFile(join(directory,name)))
    await host.stop();host=launch();api=await host.api()
    const coldBefore=await journalCounts(result.intent.sessionId)
    const cold=await api.post('experiments/engineering-read',{id});assert.deepEqual(cold,result)
    const coldAfter=await journalCounts(result.intent.sessionId)
    assert.equal(coldAfter.observeDurable-coldBefore.observeDurable,1)
    assert.equal(coldAfter.withGeneration-coldBefore.withGeneration,1)
    const coldReadChecks={completed:{before:coldBefore,after:coldAfter,cuts:cold.preparedInputs.length}}
    const retainedTerminal=join(root,'single-read-original-terminal.json')
    await rename(join(directory,'terminal.json'),retainedTerminal)
    const interruptedBefore=await journalCounts(result.intent.sessionId)
    const interrupted=await api.post('experiments/engineering-read',{id})
    const interruptedAfter=await journalCounts(result.intent.sessionId)
    assert.equal(interrupted.status,'INTERRUPTED');assert.equal(interrupted.counts,null);assert.equal(interrupted.dispatchInputs,null)
    assert.deepEqual(interrupted.preparedInputs,result.preparedInputs);assert.deepEqual(interrupted.receipts,[])
    assert.equal(interruptedAfter.observeDurable-interruptedBefore.observeDurable,1)
    assert.equal(interruptedAfter.withGeneration-interruptedBefore.withGeneration,1)
    coldReadChecks.interrupted={before:interruptedBefore,after:interruptedAfter,cuts:interrupted.preparedInputs.length}
    await writeFile(join(directory,'terminal.json'),before.get('terminal.json'))
    assert.deepEqual(await readFile(retainedTerminal),before.get('terminal.json'))
    for(const[name,bytes]of before)assert.deepEqual(await readFile(join(directory,name)),bytes)
    assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0});assert.equal(requests.length,2)
    mode='hold'
    const held=await api.post('experiments/engineering-prepare',{...input,caseId:randomUUID()}),cancelId=randomUUID()
    await api.post('experiments/engineering-start',{id:cancelId,ticket:held.ticket,accepted:true})
    const deadline=Date.now()+15000;while(requests.length<3){if(Date.now()>deadline)throw Error('Held request did not arrive');await new Promise(resolve=>setTimeout(resolve,30))}
    const cancelled=await api.post('experiments/engineering-cancel',{id:cancelId});assert.equal(cancelled.status,'CANCELLED')
    assert.equal(requests.length,3);assert.equal(responses.size,0);assert.deepEqual(await readFile(join(project,'src/case.test.mjs')),original)
    const cases=[]
    for(const[scenario,patch]of [['exhausted',{budget:{...input.budget,requests:1,outputTokens:64}}],['denied',{}],['failure',{}]]) {
      mode=scenario==='exhausted'?'complete':scenario
      const before=requests.length,plan=await api.post('experiments/engineering-prepare',{...input,...patch,caseId:randomUUID()}),id=randomUUID()
      await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
      const value=await settled(id)
      assert.equal(value.status,'UNKNOWN');assert.equal(value.counts.dispatches,1);assert.equal(requests.length,before+1)
      assert.equal(value.counts.actionAttempts,scenario==='exhausted'?1:0)
      if(scenario==='failure')assert.equal(value.counts.outputTokens,0)
      if(scenario==='denied')assert.equal(value.receipts.length,0)
      cases.push({scenario,result:value})
    }
    await writeFile(join(evidence,'refusal-cases.json'),JSON.stringify(cases,null,2)+'\n')
    const terminalPath=join(directory,'terminal.json'),terminalBytes=await readFile(terminalPath)
    await writeFile(join(evidence,'original-terminal.bytes'),terminalBytes)
    const forged=JSON.parse(terminalBytes.toString());forged.counts.providerWireRequests=0
    await writeFile(terminalPath,JSON.stringify(forged));assert.equal((await api.post('experiments/engineering-read',{id},400)).error,'EXPERIMENT_ENGINEERING_RECORD_INVALID')
    await writeFile(terminalPath,terminalBytes)
    const cutPath=join(directory,'input-1.json'),cutBytes=await readFile(cutPath)
    await writeFile(join(evidence,'original-input.bytes'),cutBytes)
    const badCut=JSON.parse(cutBytes.toString());badCut.input.messages[0].content=[{type:'text',text:'forged input'}]
    await writeFile(cutPath,JSON.stringify(badCut));assert.equal((await api.post('experiments/engineering-read',{id},400)).error,'EXPERIMENT_ENGINEERING_INPUT_UNCONFIRMED')
    await writeFile(cutPath,cutBytes)
    const removed=join(root,'pruned-original-attempt');await mkdir(removed,{recursive:true})
    await writeFile(join(evidence,'pruned-original-path.json'),JSON.stringify({path:removed,synthetic:true,retained:true})+'\n')
    const observationPath=join(directory,'observation-1.json'),observationBytes=await readFile(observationPath)
    await rename(cutPath,join(removed,'input-1.json'));await rename(observationPath,join(removed,'observation-1.json'))
    const reduced=JSON.parse(terminalBytes.toString());reduced.counts.dispatches=1;reduced.counts.allocatedOutputTokens=64
    reduced.counts.inputTokens=9;reduced.counts.outputTokens=5;reduced.counts.cacheReadTokens=3
    await writeFile(terminalPath,JSON.stringify(reduced))
    assert.equal((await api.post('experiments/engineering-read',{id},400)).error,'EXPERIMENT_ENGINEERING_SETTLEMENT_INVALID')
    await writeFile(cutPath,cutBytes);await writeFile(observationPath,observationBytes);await writeFile(terminalPath,terminalBytes)
    assert.deepEqual(await readFile(join(removed,'input-1.json')),cutBytes)
    assert.deepEqual(await readFile(join(removed,'observation-1.json')),observationBytes)
    mode='complete'
    const local=async(path,data)=>{const response=await fetch(api.base+path,{method:'POST',headers:{cookie:api.cookie,origin:api.base,'content-type':'application/json'},body:JSON.stringify(data)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value}
    const source=await local('/api/experiments-notebook-source',{})
    const notebookPlan=await api.post('experiments/engineering-prepare',{...input,caseId:randomUUID(),notebookSessionId:source.sessionId})
    assert.equal(notebookPlan.notebookInput.scope.sessionId,source.sessionId)
    const beforeNotebook=requests.length,notebookId=randomUUID()
    await api.post('experiments/engineering-start',{id:notebookId,ticket:notebookPlan.ticket,accepted:true})
    const notebookResult=await settled(notebookId);assert.equal(notebookResult.status,'COMPLETED')
    assert.equal(requests.length,beforeNotebook+2);assert.deepEqual(notebookResult.notebookInput,notebookPlan.notebookInput)
    assert.equal(notebookResult.receipts.length,1);assert.equal(notebookResult.receipts[0].view.receipt.acceptance,'PENDING')
    assert.ok(requests[beforeNotebook].messages.some(message=>JSON.stringify(message.content).includes('Working notes at this turn boundary')))
    assert.equal(requests[0].messages.some(message=>JSON.stringify(message.content).includes('Working notes at this turn boundary')),false)
    const stalePlan=await api.post('experiments/engineering-prepare',{...input,caseId:randomUUID(),notebookSessionId:source.sessionId})
    const settings=await local('/api/nidofy-notebook/settings',{})
    await local('/api/nidofy-notebook/save-settings',{...settings,autoOrganize:!settings.autoOrganize})
    const beforeStale=requests.length,staleId=randomUUID(),stale=await api.post('experiments/engineering-start',{id:staleId,ticket:stalePlan.ticket,accepted:true},400)
    assert.equal(stale.error,'EXPERIMENT_NOTEBOOK_INPUT_CHANGED');assert.equal(requests.length,beforeStale)
    assert.equal(await api.post('experiments/engineering-read',{id:staleId}),null)
    await writeFile(join(evidence,'notebook-engineering-result.json'),JSON.stringify(notebookResult,null,2)+'\n')
    const cacheRuns=[],cacheCaseId=randomUUID()
    for(const cacheMode of ['native','off','session']) {
      const extras=await local('/api/nidofy-extras/status',{})
      await local('/api/nidofy-extras/preferences',{...extras.preferences,cache:true,cachePolicy:{mode:cacheMode,models:['engineering-model']}})
      const plan=await api.post('experiments/engineering-prepare',{...input,caseId:cacheCaseId,cacheMode}),before=requests.length,id=randomUUID()
      assert.equal(plan.cacheInput.policy.mode,cacheMode);assert.equal(plan.cacheInput.mounted,true)
      await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
      const value=await settled(id);assert.equal(value.status,'COMPLETED');assert.equal(requests.length,before+2)
      assert.deepEqual(value.cacheInput,plan.cacheInput);assert.equal(value.receipts.length,1)
      for(const observation of value.requestObservations)assert.equal(observation.observation.cache.policy.mode,cacheMode)
      assert.equal(value.requestObservations[0].observation.cache.hint,cacheMode==='native'?'NATIVE':cacheMode==='off'?'REMOVED':'SESSION_KEY')
      cacheRuns.push(value)
    }
    const staleCache=await api.post('experiments/engineering-prepare',{...input,caseId:randomUUID(),cacheMode:'session'})
    const extras=await local('/api/nidofy-extras/status',{})
    await local('/api/nidofy-extras/preferences',{...extras.preferences,cachePolicy:{mode:'off',models:['engineering-model']}})
    const beforeCacheChange=requests.length,cacheChanged=await api.post('experiments/engineering-start',{id:randomUUID(),ticket:staleCache.ticket,accepted:true},400)
    assert.equal(cacheChanged.error,'EXPERIMENT_CACHE_INPUT_CHANGED');assert.equal(requests.length,beforeCacheChange)
    await writeFile(join(evidence,'cache-engineering-results.json'),JSON.stringify(cacheRuns,null,2)+'\n')
    const cacheComparison=await api.post('experiments/engineering-compare',{a:cacheRuns[0].intent.id,b:cacheRuns[1].intent.id,factor:'cache'})
    assert.equal(cacheComparison.task,'NOT_COMPARABLE');assert.equal(cacheComparison.quality,'UNKNOWN');assert.equal(cacheComparison.efficiencyEligible,false)
    assert.equal(cacheComparison.checks.find(row=>row.name==='case').result,'SAME')
    assert.equal(cacheComparison.checks.find(row=>row.name==='cache-input').result,'DIFFERENT')
    assert.deepEqual(cacheComparison.counts.dispatches,{a:2,b:2,missing:0})
    await writeFile(join(evidence,'cache-engineering-comparison.json'),JSON.stringify(cacheComparison,null,2)+'\n')
    mode='complete'
    const matrixInput={rows:[{...input,cacheMode:'off'},{...input,cacheMode:'off',notebookSessionId:source.sessionId}],budget:{requests:4,outputTokens:256,durationMs:30000}}
    const rejectedBudget=await api.post('experiments/matrix-prepare',{...matrixInput,budget:{...matrixInput.budget,requests:3}},400)
    assert.equal(rejectedBudget.error,'EXPERIMENT_MATRIX_BUDGET_EXHAUSTED')
    const matrixPlan=await api.post('experiments/matrix-prepare',matrixInput),matrixId=randomUUID(),beforeMatrix=requests.length
    await api.post('experiments/matrix-start',{id:matrixId,ticket:matrixPlan.ticket,accepted:true})
    const matrixSettled=async id=>{const deadline=Date.now()+45000;for(;;){const value=await api.post('experiments/matrix-read',{id});if(value?.status!=='RUNNING')return value;if(Date.now()>deadline)throw Error('Matrix did not settle');await new Promise(resolve=>setTimeout(resolve,30))}}
    const matrix=await matrixSettled(matrixId);assert.equal(matrix.status,'COMPLETED');assert.equal(matrix.rounds.length,2)
    assert.equal(matrix.counts.dispatches,4);assert.equal(matrix.counts.outputTokens,20);assert.equal(matrix.counts.providerWireRequests,null)
    assert.equal(requests.length,beforeMatrix+4);assert.equal(matrix.efficiencyEligible,false)
    await writeFile(join(evidence,'matrix-result.json'),JSON.stringify(matrix,null,2)+'\n')
    const comparisonSelection={a:matrix.rounds[0].runId,b:matrix.rounds[1].runId,factor:'notebook'}
    const comparison=await api.post('experiments/engineering-compare',comparisonSelection)
    assert.equal(comparison.task,'NOT_COMPARABLE');assert.equal(comparison.quality,'UNKNOWN');assert.equal(comparison.efficiencyEligible,false)
    assert.deepEqual(comparison.counts.dispatches,{a:2,b:2,missing:0});assert.deepEqual(comparison.counts.outputTokens,{a:10,b:10,missing:0})
    assert.deepEqual(comparison.counts.providerWireRequests,{a:null,b:null,missing:2});assert.equal(comparison.exactModelVersion,null)
    assert.equal(comparison.a.receipts.length,1);assert.equal(comparison.b.receipts.length,1)
    assert.equal(comparison.checks.find(row=>row.name==='first-complete-model-input').result,'DIFFERENT')
    assert.equal(comparison.a.receipts[0].view.receipt.acceptance,'PENDING');assert.equal(comparison.b.receipts[0].view.receipt.acceptance,'PENDING')
    const repeated=await api.post('experiments/engineering-compare',{...comparisonSelection,b:comparisonSelection.a})
    assert.equal(repeated.task,'NOT_COMPARABLE');assert.equal(repeated.quality,'UNKNOWN')
    assert.equal((await api.post('experiments/engineering-compare',{...comparisonSelection,counts:0},400)).error,'EXPERIMENT_ENGINEERING_INPUT_INVALID')
    await writeFile(join(evidence,'engineering-comparison.json'),JSON.stringify(comparison,null,2)+'\n')
    const matrixDirectory=join(home,'nidofy-extras/experiments/matrices-v1',matrixId),matrixBytes=new Map()
    for(const name of await readdir(matrixDirectory))matrixBytes.set(name,await readFile(join(matrixDirectory,name)))
    const parallelReads=await Promise.all([api.post('experiments/matrix-read',{id:matrixId}),api.post('experiments/matrix-read',{id:matrixId})])
    for(const value of parallelReads)assert.deepEqual(value,matrix)
    const report=await api.post('experiments/matrix-export',{id:matrixId})
    assert.equal(report.kind,'engineering-matrix-report');assert.equal(report.schemaVersion,1)
    assert.deepEqual(await api.post('experiments/matrix-import',{report:JSON.stringify(report)}),matrix)
    assert.deepEqual(await api.post('experiments/engineering-compare',comparisonSelection),comparison)
    assert.equal((await api.post('experiments/matrix-import',{report:JSON.stringify({...report,schemaVersion:2})},400)).error,'EXPERIMENT_MATRIX_RECORD_INVALID')
    const alteredReport=structuredClone(report);alteredReport.matrix.intent.budget.requests=3
    assert.equal((await api.post('experiments/matrix-import',{report:JSON.stringify(alteredReport)},400)).error,'EXPERIMENT_MATRIX_IMPORT_SOURCE_UNCONFIRMED')
    assert.equal((await api.post('experiments/matrix-import',{report:'x'.repeat(1048577)},400)).error,'EXPERIMENT_MATRIX_INPUT_INVALID')
    await writeFile(join(evidence,'matrix-report.json'),JSON.stringify(report,null,2)+'\n')
    const matrixTerminalPath=join(matrixDirectory,'terminal.json'),matrixTerminal=JSON.parse(matrixBytes.get('terminal.json').toString())
    await writeFile(join(evidence,'original-matrix-terminal.bytes'),matrixBytes.get('terminal.json'))
    await writeFile(matrixTerminalPath,JSON.stringify({...matrixTerminal,schemaVersion:2}))
    assert.equal((await api.post('experiments/matrix-read',{id:matrixId},400)).error,'EXPERIMENT_MATRIX_RECORD_INVALID')
    await writeFile(matrixTerminalPath,matrixBytes.get('terminal.json'))
    const roundPath=join(matrixDirectory,'round-1.json'),round=JSON.parse(matrixBytes.get('round-1.json').toString())
    await writeFile(join(evidence,'original-matrix-round.bytes'),matrixBytes.get('round-1.json'))
    await writeFile(roundPath,JSON.stringify({...round,counts:{...round.counts,providerWireRequests:0}}))
    assert.equal((await api.post('experiments/matrix-read',{id:matrixId},400)).error,'EXPERIMENT_MATRIX_RECORD_INVALID')
    await writeFile(roundPath,matrixBytes.get('round-1.json'))
    mode='hold'
    const matrixCancelPlan=await api.post('experiments/matrix-prepare',matrixInput),matrixCancelId=randomUUID(),beforeMatrixCancel=requests.length
    await api.post('experiments/matrix-start',{id:matrixCancelId,ticket:matrixCancelPlan.ticket,accepted:true})
    const matrixDeadline=Date.now()+15000;while(requests.length<beforeMatrixCancel+1){if(Date.now()>matrixDeadline)throw Error('Matrix held request did not arrive');await new Promise(resolve=>setTimeout(resolve,30))}
    const matrixCancelled=await api.post('experiments/matrix-cancel',{id:matrixCancelId});assert.equal(matrixCancelled.status,'CANCELLED')
    assert.equal(requests.length,beforeMatrixCancel+1);assert.equal(matrixCancelled.rounds.length,1)
    assert.equal(matrixCancelled.rounds[0].status,'CANCELLED');assert.equal(matrixCancelled.counts.dispatches,null)
    await writeFile(join(evidence,'matrix-cancelled.json'),JSON.stringify(matrixCancelled,null,2)+'\n')
    assert.deepEqual(failures,[])
    assert.equal(requests.length,19);assert.deepEqual(await api.counts(),{modelRequests:18,createdAgents:11})
    await host.stop();host=launch();api=await host.api()
    assert.deepEqual(await api.post('experiments/matrix-read',{id:matrixId}),matrix)
    assert.deepEqual(await api.post('experiments/matrix-read',{id:matrixCancelId}),matrixCancelled)
    assert.deepEqual(await api.post('experiments/matrix-import',{report:JSON.stringify(report)}),matrix)
    assert.deepEqual(await api.post('experiments/engineering-compare',comparisonSelection),comparison)
    for(const[name,bytes]of matrixBytes)assert.deepEqual(await readFile(join(matrixDirectory,name)),bytes)
    assert.equal(requests.length,19);assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0})
    mode='complete'
    const resourceChecks=await checkEngineeringResources({api,input,settled,requests,evidence,root,home,project,reference:result})
    assert.deepEqual(await api.counts(),{modelRequests:resourceChecks.officialStreamEntries,createdAgents:resourceChecks.actualAgents})
    const finalHttpCalls=requests.length
    await host.stop();host=launch();api=await host.api()
    const resourceCases=JSON.parse(await readFile(join(evidence,'resource-refusal-cases.json'),'utf8'))
    for(const row of resourceCases)assert.deepEqual(await api.post('experiments/engineering-read',{id:row.value.intent.id}),row.value)
    const journal=join(home,'nidofy-extras/experiments/engineering-v1'),syntheticIntents=[]
    for(let index=0;index<10;index++){
      const id=randomUUID(),intent={...result.intent,id,sessionId:'engineering-task-'+id}
      await mkdir(join(journal,id));await writeFile(join(journal,id,'intent.json'),JSON.stringify(intent));syntheticIntents.push(id)
    }
    await writeFile(join(evidence,'unfinished-admission-inputs.json'),JSON.stringify({synthetic:true,ids:syntheticIntents},null,2)+'\n')
    const beforeCopies=(await readdir(root)).filter(name=>name.startsWith('dsh-engineering-task-')).sort()
    const refusedPlan=await api.post('experiments/engineering-prepare',input)
    const refused=await api.post('experiments/engineering-start',{id:randomUUID(),ticket:refusedPlan.ticket,accepted:true},400)
    assert.equal(refused.error,'EXPERIMENT_ENGINEERING_STORAGE_LIMIT')
    assert.deepEqual((await readdir(root)).filter(name=>name.startsWith('dsh-engineering-task-')).sort(),beforeCopies)
    assert.equal(requests.length,finalHttpCalls);assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0})
    for(const action of ['oversize','logical']) {
      const oversizedId=randomUUID(),oversizedSession='engineering-task-'+oversizedId
      const physical=await journalCounts(oversizedSession,action)
      assert.equal(physical.sizeBytes>2*1024*1024,action==='oversize')
      const oversizedDirectory=join(journal,oversizedId);await mkdir(oversizedDirectory)
      await writeFile(join(oversizedDirectory,'intent.json'),JSON.stringify({...result.intent,id:oversizedId,sessionId:oversizedSession}))
      await writeFile(join(oversizedDirectory,'input-1.json'),JSON.stringify({...result.preparedInputs[0],sessionId:oversizedSession}))
      const oversizedBefore=await journalCounts(oversizedSession)
      const oversizedRefusal=await api.post('experiments/engineering-read',{id:oversizedId},400)
      assert.equal(oversizedRefusal.error,'EXPERIMENT_RESOURCE_SESSION_LIMIT')
      const oversizedAfter=await journalCounts(oversizedSession)
      assert.equal(oversizedAfter.observeDurable-oversizedBefore.observeDurable,action==='oversize'?0:1)
      assert.equal(oversizedAfter.withGeneration-oversizedBefore.withGeneration,0)
      assert.equal(requests.length,finalHttpCalls);assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0})
      coldReadChecks[action]={sessionId:oversizedSession,sizeBytes:physical.sizeBytes,
        observeDurable:oversizedAfter.observeDurable-oversizedBefore.observeDurable,withGeneration:0,retained:true}
    }
    const emptyId=randomUUID(),emptySession='engineering-task-'+emptyId
    const emptyParent=await mkdtemp(join(root,'dsh-engineering-task-empty-')),emptyWorkspace=join(emptyParent,'project')
    await mkdir(emptyWorkspace)
    const emptyPhysical=await journalCounts(emptySession,'empty',emptyWorkspace),durable=emptyPhysical.durable
    assert.equal(durable.events.length,0);assert.equal(durable.durableThrough,-1)
    const info=await lstat(emptyParent,{bigint:true}),emptyDirectory=join(journal,emptyId);await mkdir(emptyDirectory)
    const allocation={...result.resourceAllocation,id:emptyId,workspace:emptyWorkspace,identity:`${info.dev}:${info.ino}`}
    const resource={schemaVersion:1,kind:'engineering-resource-result',id:emptyId,checkpoints:[{phase:'drained',workspace:null,
      session:{bytes:Buffer.byteLength(JSON.stringify({meta:durable.meta,inheritedEventCount:durable.inheritedEventCount,
        generation:durable.generation,durableThrough:-1,events:[]})),diskBytes:emptyPhysical.sizeBytes,events:0,
        generation:durable.generation,through:-1},diagnostic:null}],diskPeakBytes:null,memoryPeakBytes:null}
    const emptyIntent={...result.intent,id:emptyId,sessionId:emptySession,workspace:emptyWorkspace}
    await writeFile(join(emptyDirectory,'intent.json'),JSON.stringify(emptyIntent))
    await writeFile(join(emptyDirectory,'resource-allocation.json'),JSON.stringify(allocation))
    const resourceBytes=JSON.stringify(resource);await writeFile(join(emptyDirectory,'resource-result.json'),resourceBytes)
    const emptyBefore=await journalCounts(emptySession),emptyRead=await api.post('experiments/engineering-read',{id:emptyId})
    const emptyAfter=await journalCounts(emptySession)
    assert.equal(emptyRead.status,'INTERRUPTED');assert.equal(emptyRead.counts,null);assert.deepEqual(emptyRead.preparedInputs,[])
    assert.equal(emptyAfter.observeDurable-emptyBefore.observeDurable,1);assert.equal(emptyAfter.withGeneration-emptyBefore.withGeneration,1)
    await journalCounts(emptySession,'append')
    assert.equal((await api.post('experiments/engineering-read',{id:emptyId},400)).error,'EXPERIMENT_RESOURCE_RECORD_INVALID')
    assert.equal(await readFile(join(emptyDirectory,'resource-result.json'),'utf8'),resourceBytes)
    assert.equal(requests.length,finalHttpCalls);assert.deepEqual(await api.counts(),{modelRequests:0,createdAgents:0})
    coldReadChecks.noDispatch={sessionId:emptySession,originalThrough:-1,observeDurable:1,withGeneration:1,
      appendedWatermark:'REFUSED_WITH_ORIGINAL_RESOURCE_BYTES',retained:true}
    await writeFile(join(evidence,'single-session-read-checks.json'),JSON.stringify(coldReadChecks,null,2)+'\n')
    await host.stop()
    const summary={root,paidRequests:0,syntheticProviderHttpCalls:finalHttpCalls,officialStreamEntries:20+resourceChecks.officialStreamEntries,
      actualAgents:12+resourceChecks.actualAgents,actualProtectedActions:8+resourceChecks.actualProtectedActions,
      completedEngineeringTasks:7+resourceChecks.completedEngineeringTasks,completedMatrices:1,
      resourceChecks,
      coldReadChecks,syntheticOversizeSessions:2,syntheticEmptySessions:1,
      renderer:'UNKNOWN',installer:'UNKNOWN',immutableModelVersion:'UNKNOWN',efficiencyEligible:false,
      observations:['full-profile-two-official-input-cuts-one-actual-agent-reviewed-protected-shell-t11-causal-receipt','cold-read-original-bytes-zero-agent-zero-resend','cancel-drains-provider-no-subsequent-action',
        'output-allocation-exhaustion-denied-model-command-provider-failure-stop-without-retry','forged-wire-count-and-full-input-refuse-original-synthetic-bytes-retained',
        'explicit-notebook-input-actual-agent-and-t11-no-current-history-fallback','changed-notebook-settings-refuse-before-agent-or-dispatch',
        'actual-cache-owner-confirmed-revision-native-off-session-applied-hints-no-key-observation','changed-cache-policy-refuse-before-agent-or-dispatch',
        'aggregate-budget-matrix-sequential-actual-turns-round-archives-and-null-wire-count','matrix-cancel-drains-active-round-and-prevents-next-row',
        'concurrent-original-round-reads-no-generation-ownership-collision','future-matrix-terminal-and-forged-wire-count-refused-original-bytes-retained',
        'cold-matrix-read-identical-bytes-zero-agent-zero-resend','bounded-report-original-source-version-size-validation-zero-replay',
        'whole-turn-comparison-counts-original-inputs-independent-receipts-differences-unknown-version-no-efficiency',
        'bounded-admission-refuses-before-copy-allocation-zero-agent-zero-dispatch-synthetic-unfinished-inputs-retained']}
    await writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({evidence,...summary}))
  } finally {for(const response of responses)response.destroy();await new Promise(resolve=>provider.close(resolve))}
}
