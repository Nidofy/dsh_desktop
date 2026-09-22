// Synthetic-only, final HTTP wire regression over the actual pinned DSH.
// No real model endpoint, user skill roots, credentials, or project sources.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {assessWirePrefix} from '../runtime-src/prefix-regression.mjs';
const resources=resolve(process.argv[2]??'runtime');
const require=createRequire(join(resources,'dsh/package.json'));
await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/prefix-wire-'));
const report={schemaVersion:1,status:'RUNNING',protocols:[],scope:'Pinned DSH + local synthetic HTTP; no provider cache effectiveness claim'};
const pause=()=>new Promise(r=>setTimeout(r,100));
const summary=['Primary Request and Intent','Key Technical Concepts','Files and Code','Errors and Fixes','Pending Jobs','Current Work','Next Step','Critical Context'].map(title=>'## '+title+'\n- Synthetic fixture; no user data.').join('\n\n');
for(const protocol of ['openai','anthropic']){
  const work=join(root,protocol,'workspace'),home=join(root,protocol,'home'),skillRoot=join(root,protocol,'skills');
  await mkdir(join(work,'.git'),{recursive:true});await mkdir(home,{recursive:true});await mkdir(skillRoot,{recursive:true});
  await writeFile(join(work,'AGENTS.md'),'SYNTHETIC_RULE_V1: Reply using only this fixture.\n');
  await writeFile(join(work,'CLAUDE.md'),'SYNTHETIC_CLAUDE_RULE: Keep the fixture local.\n');
  await writeFile(join(work,'fixture.txt'),'SYNTHETIC_READ_CONTENT\n');
  await writeFile(join(work,'second.txt'),'SYNTHETIC_SECOND_READ\n');
  const putSkill=async(name,description)=>{await mkdir(join(skillRoot,name),{recursive:true});await writeFile(join(skillRoot,name,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\nSYNTHETIC_SKILL_BODY_${name}: perform no external actions.\n`);};
  await putSkill('zulu-fixture','Synthetic Z skill.');await putSkill('alpha-fixture','Synthetic A skill.');
  // The web deployment mounts these plugins in the agent preset, not the host.
  // Copy the shipped standard composition and override only fixture discovery
  // and manual compaction budget. Never mutate the bundled preset installation.
  const presetDir=join(home,'.agent-presets','prefix-fixture');await mkdir(presetDir,{recursive:true});
  let preset=await readFile(join(resources,'dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'),'utf8');
  preset=preset.replace("  name: '@deepseek-ai/dsh-skill-filesystem'","  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    includeDefaultRoots: false\n    customSkillDirs: ["+JSON.stringify(skillRoot)+"]\n    watchUsePolling: true\n    watchStabilityThresholdMs: 100\n    watchPollIntervalMs: 100");
  preset=preset.replace("      name: '@deepseek-ai/dsh-compaction-basic'","      name: '@deepseek-ai/dsh-compaction-basic'\n      config:\n        auto: false\n        retainTokens: 0\n        maxTokens: 1024\n        compactionRetries: 0");
  preset=preset.replace(/name: '(@deepseek-ai\/[^']+)'/g,(_match,name)=>'name: '+JSON.stringify(pathToFileURL(require.resolve(name)).href));
  await writeFile(join(presetDir,'preset.yml'),'name: Synthetic prefix fixture\ndescription: Isolated regression over the shipped standard preset.\n');
  await writeFile(join(presetDir,'agent.cordis.yml'),preset);
  const requests=[],checks=[],errors=[];let phase='initial',retryLeft=0;
  const mock=http.createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4*1024*1024)throw Error('Fixture request too large');}
      const body=JSON.parse(raw),text=JSON.stringify(body.messages),isTitle=text.includes('Generate the session title from this JSON array of human messages:'),isCompact=text.includes('You are now acting as a compaction engine for this AI coding assistant.');
      requests.push({phase,body,raw,isTitle,isCompact});
      if(!isTitle&&retryLeft>0){retryLeft--;res.writeHead(503,{'content-type':'application/json','retry-after':'0'}).end(JSON.stringify({error:{type:'overloaded_error',message:'Synthetic retry'}}));return;}
      const results=protocol==='openai'?body.messages.filter(m=>m.role==='tool'):body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result'):[]);
      let tool;
      if(!isTitle&&!isCompact&&phase==='tool-loop'&&results.length===0)tool={name:'read',args:{file_path:'fixture.txt'},id:'synthetic-read'};
      if(!isTitle&&!isCompact&&phase==='tool-loop'&&results.length===1)tool={name:'read',args:{file_path:'second.txt'},id:'synthetic-read-two'};
      if(!isTitle&&!isCompact&&phase==='skill-load'&&!text.includes('SYNTHETIC_SKILL_BODY_alpha-fixture'))tool={name:'skill',args:{name:'alpha-fixture'},id:'synthetic-skill'};
      const reply=isCompact?summary:'SYNTHETIC_REPLY_'+phase;
      res.writeHead(200,{'content-type':'text/event-stream'});
      if(protocol==='openai'){
        const delta=tool?{role:'assistant',tool_calls:[{index:0,id:tool.id,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]}:{role:'assistant',content:reply};
        for(const [i,d] of [delta,{}].entries())res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:d,finish_reason:i?tool?'tool_calls':'stop':null}]})+'\n\n');
        res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[],usage:{prompt_tokens:500,completion_tokens:20,total_tokens:520,prompt_tokens_details:{cached_tokens:0}}})+'\n\n');res.end('data: [DONE]\n\n');
      }else{
        const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
        send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:500,output_tokens:0}}});
        send('content_block_start',{index:0,content_block:tool?{type:'tool_use',id:tool.id,name:tool.name,input:{}}:{type:'text',text:''}});
        send('content_block_delta',{index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.args)}:{type:'text_delta',text:reply}});
        send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{});res.end();
      }
    }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const patch=JSON.parse(await readFile(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
  for(const row of patch)for(const plugin of row.insert??[])if(['desktop-observability','desktop-model-defaults','desktop-client'].includes(plugin.id))plugin.name=pathToFileURL(join(resources,{'desktop-observability':'desktop-observability.mjs','desktop-model-defaults':'model-defaults.mjs','desktop-client':'desktop-client/index.mjs'}[plugin.id])).href;
  const provider=patch.find(p=>p.id==='llm-pi-ai').config.providers['desktop-internal'];
  provider.baseURL=`http://127.0.0.1:${mock.address().port}${protocol==='openai'?'/v1':''}`;provider.retryPolicy={mode:'normal',maxRetries:1};
  patch.push({id:'session-title-first-prompt-llm',disabled:true},{id:'session-title-llm',disabled:true},
    {id:'permission-presets',config:{defaultPreset:'workspace-write',presets:{'workspace-write':{sandbox:'workspace-write',approval:'ask'},'read-only':{sandbox:'read-only',approval:'ask'}}}});
  const plugin=join(home,'fixture-plugin.mjs');
  await writeFile(plugin,`import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
export const name='prefix-fixture-control';export const inject=['commands','tools'];
export async function apply(ctx){const require=createRequire(${JSON.stringify(join(resources,'dsh/package.json'))});const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);let disposers=[];
ctx.commands.register({name:'prefix-fixture-tools',description:'Synthetic fixture control',input:{hint:'on/off/reorder'},handler:async invocation=>{for(const dispose of disposers)dispose();disposers=[];const input=invocation.rawInput.trim();if(!['on','off','reorder'].includes(input))return {kind:'error',text:'invalid fixture'};for(const name of input==='off'?[]:input==='on'?['z_fixture','a_fixture']:['a_fixture','z_fixture'])disposers.push(ctx.tools.register(defineTool({name,description:'Synthetic fixed tool',parameters:{},output:{schema:{type:'object',properties:{},additionalProperties:false},render:()=>[{type:'text',text:'synthetic'}]},execute:async()=>({})})));return {kind:'success',text:'Fixture tools '+input};}});
ctx.effect(()=>()=>{for(const dispose of disposers)dispose();});}
`);
  patch.push({insert:[{id:'prefix-fixture-control',name:pathToFileURL(plugin).href}]});
  const overlay=join(home,'patch.json');await writeFile(overlay,JSON.stringify(patch));
  const env={...process.env,DSH_HOME:home,DSH_DESKTOP_PATCH:overlay,DSH_DESKTOP_LLM_KEY:'synthetic-prefix-key',DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:'',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'*'};
  for(const key of Object.keys(env))if(/^(OPENAI_|ANTHROPIC_|DEEPSEEK_)/i.test(key))delete env[key];
  let child,output='',origin,cookie,sessionId,turn=0;
  async function start(){let launch;child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:work,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{const value=bytes.toString();output+=value;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(value)?.[1];});
    child.stdin.write('start '+JSON.stringify({diagnosticKey:'09'.repeat(32)})+'\n');
    const end=Date.now()+60000;while(!launch&&child.exitCode===null&&Date.now()<end)await pause();assert(launch,'DSH fixture startup; inspect engine.log');
    origin=new URL(launch).origin;const response=await fetch(launch,{redirect:'manual'});cookie=response.headers.get('set-cookie').split(';')[0];
  }
  async function stop(){if(!child||child.exitCode!==null)return;child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause();if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}}
  async function rpc(method,args){const response=await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args}})});const value=await response.json();assert(value.result?.ok,JSON.stringify(value));return value.result.value;}
  const request=(method,request)=>rpc(method,{request});
  async function command(line){const result=await rpc('commands/execute',{agentId:sessionId,line,submittedAttachments:[]});assert.equal(result?.result?.kind,'success',JSON.stringify(result));return result;}
  async function prompt(name){phase=name;const start=requests.length;await request('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'SYNTHETIC_TURN_'+name+': complete the synthetic fixture.'}]});turn++;
    const end=Date.now()+45000;let complete=false;
    while(Date.now()<end){const response=await fetch(origin+'/desktop-diagnostics/api/recovery/session?id='+sessionId,{headers:{cookie}});const value=await response.json();if(value.turn===turn&&value.status==='COMPLETED'){complete=true;break;}if(value.status==='FAILED')throw Error('Fixture turn failed: '+name);await pause();}
    assert(complete,'turn timed out: '+name);assert.deepEqual(errors,[]);return requests.slice(start).filter(r=>!r.isTitle&&!r.isCompact);
  }
  function check(name,before,after,options={}){const result=assessWirePrefix(protocol,before.body,after.body,options);checks.push({name,...result});assert(result.pass,`${protocol} ${name}: ${JSON.stringify(result)}`);}
  const last=rows=>{assert(rows.length,'expected real HTTP request');return rows.at(-1);};
  try{
    await start();({sessionId}=await request('session/create',{cwd:work,agentPreset:'prefix-fixture'}));
    const tool=await prompt('tool-loop');assert.equal(tool.length,3);assert(JSON.stringify(tool[1].body.messages).includes('SYNTHETIC_READ_CONTENT'));assert(JSON.stringify(tool[2].body.messages).includes('SYNTHETIC_SECOND_READ'));assert(JSON.stringify(tool[0].body).includes('SYNTHETIC_RULE_V1'));assert(JSON.stringify(tool[0].body).includes('SYNTHETIC_CLAUDE_RULE'));assert(JSON.stringify(tool[0].body).indexOf('alpha-fixture')<JSON.stringify(tool[0].body).indexOf('zulu-fixture'),'skill catalog sorted independently of creation order');
    check('tool-result-append',tool[0],tool[1]);check('second-tool-result-append',tool[1],tool[2]);let prior=last(tool);
    let rows=await prompt('next-turn');check('next-turn-append',prior,rows[0]);prior=last(rows);
    retryLeft=1;rows=await prompt('retry');assert.equal(rows.length,2);assert.equal(rows[0].raw,rows[1].raw,'retry sends identical final HTTP request bytes');check('retry-identical',rows[0],rows[1],{expected:'identical'});check('retry-turn-prefix',prior,rows[0]);prior=last(rows);
    const oldOrigin=origin;await stop();const coldStart=requests.length;
    // Reserve the old port so the OS cannot randomly reuse it in this test.
    const portGuard=http.createServer((_req,res)=>res.writeHead(410).end());await new Promise((resolve,reject)=>{portGuard.once('error',reject);portGuard.listen(Number(new URL(oldOrigin).port),'127.0.0.1',resolve);});
    try{await start();}finally{await new Promise(resolve=>portGuard.close(resolve));}
    assert.notEqual(origin,oldOrigin,'restart fixture must exercise a different bound port');await rpc('session/list',{_request:{}});assert.equal(requests.length,coldStart,'cold read must not call the model');rows=await prompt('resume');check('restart-resume-prefix',prior,rows[0]);assert(JSON.stringify(rows[0].body.messages).includes('Current DSH Desktop Web GUI URL: '+origin),'new endpoint arrives in durable context');prior=last(rows);
    rows=await prompt('skill-load');assert.equal(rows.length,2);assert(JSON.stringify(rows[1].body).includes('SYNTHETIC_SKILL_BODY_alpha-fixture'));check('skill-load-start',prior,rows[0]);check('skill-body-append',rows[0],rows[1]);prior=last(rows);
    await putSkill('middle-fixture','Synthetic new catalog entry.');
    const skillDeadline=Date.now()+10000;let skillReady=false;
    while(Date.now()<skillDeadline){const skills=await request('skills/list',{sessionId});if(JSON.stringify(skills).includes('middle-fixture')){skillReady=true;break;}await pause();}
    assert(skillReady,'native filesystem watcher must publish the new skill before the turn');rows=await prompt('skill-catalog-change');assert(JSON.stringify(last(rows).body).includes('middle-fixture'),'updated catalog reaches actual request');check('skill-catalog-append',prior,rows[0]);prior=last(rows);
    await writeFile(join(work,'AGENTS.md'),'SYNTHETIC_RULE_V2: Keep all fixture data local.\n');rows=await prompt('rules-refresh');assert(JSON.stringify(last(rows).body).includes('SYNTHETIC_RULE_V2'));check('rules-refresh-append',prior,rows[0]);prior=last(rows);
    await command('/permission read-only');rows=await prompt('permission-change');assert(JSON.stringify(rows[0].body.messages).includes('Current DSH file policy: read-only.'));check('permission-context-append',prior,rows[0]);prior=last(rows);
    await command('/prefix-fixture-tools on');rows=await prompt('tool-enable');assert(JSON.stringify(rows[0].body.tools).includes('a_fixture'));check('tool-enable-break',prior,rows[0],{expected:'break',allowedBreaks:['TOOLS']});prior=last(rows);
    await command('/prefix-fixture-tools reorder');rows=await prompt('tool-reorder');check('registration-order-stable',prior,rows[0]);prior=last(rows);
    await command('/prefix-fixture-tools off');rows=await prompt('tool-disable');check('tool-disable-break',prior,rows[0],{expected:'break',allowedBreaks:['TOOLS']});prior=last(rows);
    phase='compaction';const begin=requests.length;const compact=await command('/compact');assert.match(compact.result.text,/Compacted /);const compactRequests=requests.slice(begin).filter(r=>r.isCompact);assert.equal(compactRequests.length,1,'one real native compaction request');
    check('compaction-summary-prefix',prior,compactRequests[0]);
    rows=await prompt('after-compaction');assert(JSON.stringify(rows[0].body).includes('<compacted-summary>'),'real checkpoint reached wire');check('compaction-history-break',prior,rows[0],{expected:'break',allowedBreaks:['MESSAGES']});prior=last(rows);
    rows=await prompt('compaction-next-turn');check('post-compaction-prefix-stable',prior,rows[0]);prior=last(rows);
    await request('session/selectModel',{sessionId,provider:'desktop-internal',model:'glm-5.3-flash',reasoningEffort:'off'});rows=await prompt('model-switch');assert.equal(rows[0].body.model,'glm-5.3-flash');
    const system=body=>JSON.stringify(protocol==='openai'?body.messages.filter(message=>['system','developer'].includes(message.role)):body.system);
    assert.equal(system(rows[0].body),system(prior.body).replace('powered by the glm-5.3 model.','powered by the glm-5.3-flash model.'),'model switch changes only the native persona model identifier');
    check('model-switch-break',prior,rows[0],{expected:'break',allowedBreaks:['MODEL','SYSTEM']});prior=last(rows);
    rows=await prompt('model-next-turn');check('post-model-switch-prefix-stable',prior,rows[0]);
    assert(!output.includes('OFFLINE_TEST_DENIED'));report.protocols.push({protocol,status:'PASS',checks,requests:requests.length,compactionRequests:compactRequests.length});
    console.log('PASS '+protocol+': '+checks.length+' native wire prefix cases');
  }catch(error){report.status='FAIL';report.protocols.push({protocol,status:'FAIL',checks,error:String(error)});throw error;}
  finally{await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));await writeFile(join(home,'engine.log'),output);await writeFile(join(home,'synthetic-wire.json'),JSON.stringify(requests,null,2));await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));}
}
report.status='PASS';await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log('Evidence:',root);
