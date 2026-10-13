/** Supported Host resource refusals preserve actual copies/Session journals and prevent later provider/action work. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkEngineeringResources({api,input,settled,requests,evidence,root,home,project,reference}) {
  const cases=[],before=requests.length,original=await readFile(join(project,'src/case.test.mjs')),beforeCounts=await api.counts()
  const first=await api.post('experiments/engineering-prepare',input)
  assert.deepEqual(first.resourceBudget,input.resourceBudget)
  const copiesBefore=(await readdir(root)).filter(name=>name.startsWith('dsh-engineering-task-')).sort()
  const refusedPlan=await api.post('experiments/engineering-prepare',{...input,resourceBudget:{...input.resourceBudget,
    retainedWorkspaceBytes:input.resourceBudget.workspaceBytes}})
  const refused=await api.post('experiments/engineering-start',{id:randomUUID(),ticket:refusedPlan.ticket,accepted:true},400)
  assert.equal(refused.error,'EXPERIMENT_RESOURCE_RETAINED_LIMIT')
  assert.deepEqual((await readdir(root)).filter(name=>name.startsWith('dsh-engineering-task-')).sort(),copiesBefore)
  assert.equal(requests.length,before)
  const directory=join(home,'nidofy-extras/experiments/engineering-v1',reference.intent.id)
  const backup=join(root,'synthetic-old-resource-sidecars');await mkdir(backup)
  for(const name of ['resource-allocation.json','resource-result.json'])await rename(join(directory,name),join(backup,name))
  const legacy=await api.post('experiments/engineering-read',{id:reference.intent.id})
  assert.equal(legacy.resourceAllocation,null);assert.equal(legacy.resourceResult,null)
  assert.equal(legacy.status,'COMPLETED');assert.equal(legacy.counts.dispatches,2)
  const noOwnerPlan=await api.post('experiments/engineering-prepare',input)
  const noOwner=await api.post('experiments/engineering-start',{id:randomUUID(),ticket:noOwnerPlan.ticket,accepted:true},400)
  assert.equal(noOwner.error,'EXPERIMENT_RESOURCE_OWNER_UNAVAILABLE');assert.equal(requests.length,before)
  for(const name of ['resource-allocation.json','resource-result.json'])await writeFile(join(directory,name),await readFile(join(backup,name)))
  const restored=await api.post('experiments/engineering-read',{id:reference.intent.id});assert.deepEqual(restored,reference)
  const resourcePath=join(directory,'resource-result.json'),resourceBytes=await readFile(resourcePath)
  await writeFile(join(evidence,'original-resource-result.bytes'),resourceBytes)
  const forged=JSON.parse(resourceBytes.toString());forged.diskPeakBytes=0
  await writeFile(resourcePath,JSON.stringify(forged))
  assert.equal((await api.post('experiments/engineering-read',{id:reference.intent.id},400)).error,'EXPERIMENT_RESOURCE_RECORD_INVALID')
  await writeFile(resourcePath,resourceBytes)
  for(const key of ['sessionBytes','sessionDiskBytes']) {
    const plan=await api.post('experiments/engineering-prepare',{...input,resourceBudget:{...input.resourceBudget,[key]:1}}),id=randomUUID()
    await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
    const value=await settled(id)
    await writeFile(join(evidence,'resource-case-'+key+'.json'),JSON.stringify(value,null,2)+'\n')
    assert.equal(value.status,'UNKNOWN');assert.equal(value.counts.dispatches,0);assert.equal(value.counts.actionAttempts,0)
    assert.equal(requests.length,before);assert.equal(value.terminal.diagnostic,'EXPERIMENT_RESOURCE_SESSION_LIMIT')
    assert.equal(value.resourceResult.diskPeakBytes,null);assert.equal(value.resourceResult.memoryPeakBytes,null)
    assert.ok(value.resourceResult.checkpoints.some(row=>row.diagnostic==='EXPERIMENT_RESOURCE_SESSION_LIMIT'))
    cases.push({scenario:key,value})
  }
  const shellBefore = requests.length
  const retainedPlan = await api.post('experiments/engineering-prepare', { ...input, shellBudget: { ...input.shellBudget, retainedSpillBytes: input.shellBudget.outputBytes } })
  const retainedRefusal = await api.post('experiments/engineering-start', { id: randomUUID(), ticket: retainedPlan.ticket, accepted: true }, 400)
  assert.equal(retainedRefusal.error, 'EXPERIMENT_RESOURCE_SHELL_RETAINED_LIMIT'); assert.equal(requests.length, shellBefore)
  const shellPlan = await api.post('experiments/engineering-prepare', { ...input, shellBudget: { ...input.shellBudget, outputBytes: 1 } }), shellId = randomUUID()
  await api.post('experiments/engineering-start', { id: shellId, ticket: shellPlan.ticket, accepted: true })
  const shellResult = await settled(shellId)
  assert.equal(shellResult.status, 'UNKNOWN'); assert.equal(shellResult.terminal.diagnostic, 'EXPERIMENT_RESOURCE_SHELL_LIMIT')
  assert.equal(requests.length, shellBefore + 1); assert.equal(shellResult.counts.dispatches, 1)
  assert.equal(shellResult.receipts.length, 1); assert.equal(shellResult.receipts[0].view.receipt.tests, 'PASSED')
  assert.ok(shellResult.shellResult.runs[0].stdout.bytes > 1); assert.equal(shellResult.shellResult.runs[0].stderr.bytes, 0)
  await writeFile(join(evidence, 'shell-exhaustion.json'), JSON.stringify(shellResult, null, 2)+'\n')
  cases.push({scenario:'complete-shell-output-exhaustion-preserves-t11',value:shellResult})
  await writeFile(join(project,'src/case.test.mjs'),"import {test} from 'node:test';test('actual full spill',()=>{process.stdout.write(('#'+ 'x'.repeat(1000)+'\\n').repeat(600));});\n")
  const spillPlan = await api.post('experiments/engineering-prepare', input), spillId = randomUUID()
  await api.post('experiments/engineering-start', { id: spillId, ticket: spillPlan.ticket, accepted: true })
  const spillResult = await settled(spillId), spill = spillResult.shellResult.runs[0].stdout.spill
  assert.ok(spill); assert.ok(spill.bytes > 512*1024); assert.equal((await readFile(spill.path)).length, spill.bytes)
  assert.equal(spillResult.receipts.length,1)
  await writeFile(join(evidence,'actual-shell-spill.json'),JSON.stringify(spillResult,null,2)+'\n')
  cases.push({scenario:'actual-shell-spill',value:spillResult})
  await writeFile(join(project,'src/case.test.mjs'),original)
  const actionBefore=requests.length
  await writeFile(join(project,'src/case.test.mjs'),"import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('retained oversized output',()=>writeFileSync('output.bin',Buffer.alloc(2048,7)));\n")
  const plan=await api.post('experiments/engineering-prepare',{...input,resourceBudget:{...input.resourceBudget,workspaceBytes:1024}}),id=randomUUID()
  await api.post('experiments/engineering-start',{id,ticket:plan.ticket,accepted:true})
  const value=await settled(id)
  await writeFile(join(evidence,'resource-case-action-output.json'),JSON.stringify(value,null,2)+'\n')
  assert.equal(value.status,'UNKNOWN');assert.equal(value.counts.dispatches,1);assert.equal(value.counts.actionAttempts,1)
  assert.equal(requests.length,actionBefore+1);assert.equal(value.terminal.diagnostic,'EXPERIMENT_RESOURCE_WORKSPACE_LIMIT')
  assert.deepEqual(await readFile(join(value.intent.workspace,'output.bin')),Buffer.alloc(2048,7))
  assert.equal(value.receipts.length,1);assert.equal(value.receipts[0].view.receipt.tests,'PASSED')
  cases.push({scenario:'reviewed-action-output-over-limit',value})
  await writeFile(join(project,'src/case.test.mjs'),original)
  await writeFile(join(evidence,'resource-refusal-cases.json'),JSON.stringify(cases,null,2)+'\n')
  const afterCounts=await api.counts()
  return {cases:cases.length,syntheticProviderHttpCalls:requests.length-before,officialStreamEntries:afterCounts.modelRequests-beforeCounts.modelRequests,
    actualAgents:afterCounts.createdAgents-beforeCounts.createdAgents,actualProtectedActions:cases.reduce((sum,row)=>sum+row.value.counts.actionAttempts,0),
    completedEngineeringTasks:cases.filter(row=>row.value.status==='COMPLETED').length,paidRequests:0,retainedCapacityAdmission:'REFUSED_BEFORE_COPY',oldResourceAbsence:'UNKNOWN_READ_REFUSED_ADMISSION',
    forgedPeak:'REFUSED',runtimeDiskPeak:null,hostMemoryPeak:null}
}
