// Exercise the production Rust-generated overlays through the unmodified DSH CLI.
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
const resources=resolve(process.argv[2]??'runtime');
mkdirSync('.build',{recursive:true});
const root=mkdtempSync(resolve('.build/protocol-models-'));
const pause=()=>new Promise(r=>setTimeout(r,100));
const results=[];
function events(dir,id){
 if(!existsSync(dir))return [];
 let text='';
 function walk(folder){for(const e of readdirSync(folder,{withFileTypes:true})){
  const p=join(folder,e.name);if(e.isDirectory()){walk(p);continue;}
  if(!p.includes(id)||!p.endsWith('.zstd'))continue;
  let bytes=readFileSync(p);while(bytes.length){try{const r=zstdDecompressSync(bytes,{info:true});if(!r.engine.bytesWritten)break;text+=r.buffer.toString();bytes=bytes.subarray(r.engine.bytesWritten);}catch{break;}}
 }}walk(dir);return text.split('\n').filter(Boolean).map(l=>JSON.parse(l));
}
for(const protocol of ['openai','anthropic']){
 const home=join(root,protocol);mkdirSync(home,{recursive:true});writeFileSync(join(home,'fixture.txt'),'PROTOCOL_TOOL_READ_OK');
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  try{
   const endpoint=new URL(req.url,'http://localhost').pathname;
   assert.equal(endpoint,protocol==='openai'?'/gateway/v1/chat/completions':'/gateway/v1/messages');
   assert.equal(req.method,'POST');
   let raw='';for await(const c of req)raw+=c;
   const body=JSON.parse(raw);
   const authenticated=protocol==='openai'?req.headers.authorization==='Bearer desktop-test-key':req.headers['x-api-key']==='desktop-test-key'&&!!req.headers['anthropic-version'];
   const toolResults=protocol==='openai'?body.messages.filter(m=>m.role==='tool').map(m=>m.content):body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result').map(c=>c.content):[]);
   requests.push({model:body.model,endpoint,authenticated,toolResults});
   assert(authenticated,'protocol-specific authentication');assert(['fixture-first','fixture-second'].includes(body.model));assert(body.stream);
   const callTool=!toolResults.length;
   res.writeHead(200,{'content-type':'text/event-stream'});
   if(protocol==='openai'){
    const delta=callTool?{role:'assistant',tool_calls:[{index:0,id:'fixture-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:'fixture.txt'})}}]}:{role:'assistant',content:'PROTOCOL_REPLY_OK'};
    for(const [i,d] of [delta,{}].entries())res.write(`data: ${JSON.stringify({id:'fixture-response',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:d,finish_reason:i?callTool?'tool_calls':'stop':null}]})}\n\n`);
    res.end('data: [DONE]\n\n');
   }else{
    const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
    send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:20,output_tokens:0}}});
    send('content_block_start',{index:0,content_block:callTool?{type:'tool_use',id:'fixture-read',name:'read',input:{}}:{type:'text',text:''}});
    send('content_block_delta',{index:0,delta:callTool?{type:'input_json_delta',partial_json:JSON.stringify({file_path:'fixture.txt'})}:{type:'text_delta',text:'PROTOCOL_REPLY_OK'}});
    send('content_block_stop',{index:0});
    send('message_delta',{delta:{stop_reason:callTool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:12}});
    send('message_stop',{});res.end();
   }
  }catch(error){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'invalid_request_error',message:String(error)}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const patch=JSON.parse(readFileSync(`.build/config-protocol-fixtures/${protocol}/desktop.patch.json`,'utf8'));
 patch[1].config.providers['desktop-internal'].baseURL=`http://127.0.0.1:${server.address().port}/gateway${protocol==='openai'?'/v1':''}`;
 const overlay=join(home,'desktop.patch.json');writeFileSync(overlay,JSON.stringify(patch));
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,DSH_HOME:join(home,'dsh'),DSH_TELEMETRY_DISABLED:'1',DSH_DESKTOP_LLM_KEY:'desktop-test-key',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'};
 for(const key of Object.keys(env))if(/^(DEEPSEEK_|OPENAI_|ANTHROPIC_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(key))delete env[key];
 let child,output='',origin,cookie;
 async function start(){
  let launch;output='';
  child=spawn(join(resources,'runtime/node.exe'),['--import',pathToFileURL(resolve('tests/offline-guard.mjs')).href,'--import',pathToFileURL(join(resources,'host.mjs')).href,join(resources,'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',overlay,'--host','127.0.0.1','--port','0','--no-open'],{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output+=c;launch??=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)?.[1];});
  child.stdin.write('start\n');const deadline=Date.now()+90000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await pause();assert(launch,'DSH startup');
  const response=await fetch(launch,{redirect:'manual'});cookie=response.headers.get('set-cookie').split(';')[0];origin=new URL(launch).origin;
 }
 async function stop(){if(!child||child.exitCode!==null)return;child.stdin.write('stop\n');const end=Date.now()+10000;while(child.exitCode===null&&Date.now()<end)await pause();if(child.exitCode===null)child.kill();}
 async function rpc(method,request){const response=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({type:'client-request',method,rpcId:crypto.randomUUID(),payload:{args:request===undefined?{}:{request}}})});const data=await response.json();assert(data.result?.ok,JSON.stringify(data));return data.result.value;}
 try{
  await start();
  const catalog=await rpc('session/modelCatalog');
  assert.deepEqual(catalog.groups.find(g=>g.id==='desktop-internal').models.map(m=>m.id),['fixture-first','fixture-second']);
  assert.equal(catalog.default.model,'fixture-second');
  const {sessionId}=await rpc('session/create',{cwd:home});
  async function prompt(count){
   await rpc('session/prompt',{sessionId,requestId:crypto.randomUUID(),mode:'queue',content:[{type:'text',text:'Read fixture.txt, then reply PROTOCOL_REPLY_OK.'}]});
   const end=Date.now()+25000;let history=[];
   while(Date.now()<end){history=events(join(home,'dsh/sessions'),sessionId);if(history.filter(e=>e.type==='turn/end').length>=count)break;await pause();}
   const turns=history.filter(e=>e.type==='turn/end');
   assert(turns.length>=count,'completed turn persisted');assert(!turns.some(e=>e.data?.reason?.kind==='error'),JSON.stringify(turns));
   assert(JSON.stringify(history).includes('PROTOCOL_REPLY_OK'),'streamed assistant text persisted');
  }
  await prompt(1);
  assert(requests.some(r=>JSON.stringify(r.toolResults).includes('PROTOCOL_TOOL_READ_OK')),'native read result returned through protocol');
  const boundary=requests.length;
  await rpc('session/selectModel',{sessionId,provider:'desktop-internal',model:'fixture-first'});
  await prompt(2);
  assert(requests.slice(boundary).some(r=>r.model==='fixture-first'),'selection changes actual request model');
  assert(!output.includes('OFFLINE_TEST_DENIED'));
  await stop();await start();
  assert.equal((await rpc('session/modelCatalog')).default.model,'fixture-first','native last selection persists');
  results.push({protocol,status:'PASS',models:['fixture-first','fixture-second'],defaultModel:'fixture-second',switchedModel:'fixture-first',nativeReadTool:true,streamedReply:true,selectionPersistsAfterRestart:true,requests:requests.map(({toolResults,...r})=>r)});
  console.log(`PASS ${protocol}: catalog, default, model switch, auth, streaming, read tool, restart persistence`);
 }finally{await stop();server.closeAllConnections();server.close();writeFileSync(join(root,'report.json'),JSON.stringify(results,null,2));}
}
console.log('Evidence directory:',root);
