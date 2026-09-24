import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
const runtime=resolve('.build/source-qualification-s3/resources');
process.env.DSH_CATALOG_WIRE_KEY='synthetic-catalog-key';
const modulePath=p=>pathToFileURL(join(runtime,'dsh/node_modules',p)).href;
const {Context}=await import(modulePath('@deepseek-ai/cordis/lib/index.js'));
const {default:Llm,createUserMessage}=await import(modulePath('@deepseek-ai/dsh-llm/lib/index.js'));
const PiAi=await import(modulePath('@deepseek-ai/dsh-llm-pi-ai/lib/index.js'));
const {getBuiltinModels}=await import(modulePath('@earendil-works/pi-ai/dist/providers/all.js'));
const records=[],scopes=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw);records.push({body,headers:req.headers,path:req.url});
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(new URL(req.url,'http://localhost').pathname.endsWith('/messages')){
  const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  send('message_start',{message:{id:'synthetic',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:2,output_tokens:0}}});
  send('content_block_start',{index:0,content_block:{type:'text',text:''}});
  send('content_block_delta',{index:0,delta:{type:'text_delta',text:'CATALOG_WIRE_OK'}});
  send('content_block_stop',{index:0});
  send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
  send('message_stop',{});res.end();
 }else{
  for(const [i,delta]of[{role:'assistant',content:'CATALOG_WIRE_OK'},{}].entries())res.write(`data: ${JSON.stringify({id:'synthetic',model:body.model,choices:[{index:0,delta,finish_reason:i?'stop':null}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const baseURL=`http://127.0.0.1:${server.address().port}/v1`,results=[];
try{
 for(const known of ['deepseek','zai-coding-cn','anthropic']){
  const models=getBuiltinModels(known);
  const model=models.find(m=>m.id===({deepseek:'deepseek-v4-flash','zai-coding-cn':'glm-5.3',anthropic:'claude-sonnet-4-6'}[known]))??models[0];
  assert(model);
  const ctx=new Context();
  try{
   await ctx.plugin(Llm);
   ctx.on('llm-pi-ai/prepare-payload',scope=>{scopes.push(scope);});
   const profile={apiKeyEnv:'DSH_CATALOG_WIRE_KEY',baseURL,models:[{id:model.id}]};
   await ctx.plugin(PiAi,{providers:{[known]:profile,alias:{...profile,catalogProvider:known}}});
   const start=records.length;
   for(const provider of [known,'alias']){
    const chunks=[];
    for await(const chunk of ctx.llm.stream({provider,model:model.id,messages:[createUserMessage({content:[{type:'text',text:'Reply CATALOG_WIRE_OK.'}],source:{kind:'test'}})]}))chunks.push(chunk);
    assert(chunks.some(c=>c.type==='finish'&&c.reason.kind==='stop'),JSON.stringify(chunks));
   }
   assert.equal(records.length-start,2);
   const original=records[start],alias=records[start+1];
   assert.deepEqual(alias.body,original.body,'alias must preserve the entire final request body');
   assert.equal(alias.path,original.path);
   for(const header of ['authorization','x-api-key','anthropic-version','anthropic-beta'])assert.equal(alias.headers[header],original.headers[header]);
   assert.equal(scopes.at(-1).provider,'alias');assert.equal(scopes.at(-2).provider,known);
   results.push({provider:known,model:model.id,api:model.api,completeBodyEqual:true,authAndProtocolHeadersEqual:true,routeScopeIndependent:true});
  }finally{await ctx.fiber.dispose();}
 }
}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
await writeFile('docs/evidence/0.2.5/source-catalog-native-wire.json',JSON.stringify({schemaVersion:1,sourceCommit:'5e2879f0478ba9336128312e715dee7a9f56c3db',status:'PASS',method:'built public Cordis/LLM plugin composition against loopback mocks',modelRequests:records.length,results},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',requests:records.length,results}));
