import http from 'node:http';
export async function createMock(options={}){
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'desktop-mock',object:'model'}]}));return;}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  let raw='';for await(const c of req){raw+=c;if(raw.length>2000000){res.writeHead(413).end();return;}}
  const body=JSON.parse(raw);requests.push({model:body.model,authorized:req.headers.authorization==='Bearer desktop-test-key',tools:body.tools?.map(t=>t.function.name)??[],toolResults:body.messages?.filter(m=>m.role==='tool').map(m=>m.content)??[]});
  if(req.headers.authorization!=='Bearer desktop-test-key'){res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'invalid test key'}}));return;}
  if(body.model!=='desktop-mock'){res.writeHead(404,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'unknown model'}}));return;}
  if(options.stall){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();return;}
  const names=body.tools?.map(t=>t.function.name)??[];
  const stage=body.messages?.filter(m=>m.role==='tool').length??0;
  let tool;
  if(names.includes('read')&&stage===0)tool={name:'read',arguments:JSON.stringify({file_path:'fixture.txt'})};
  if(names.includes('edit')&&stage===1)tool={name:'edit',arguments:JSON.stringify({file_path:'fixture.txt',old_string:'ORIGINAL_CONTENT',new_string:'EDITED_CONTENT'})};
  if(names.includes('pwsh')&&stage===2)tool={name:'pwsh',arguments:JSON.stringify({command:"[IO.File]::WriteAllText((Join-Path (Get-Location) 'shell-proof.txt'), 'SHELL_OK')",description:'Write smoke-test proof in the test workspace'})};
  const message=tool?{role:'assistant',content:null,tool_calls:[{index:0,id:`mock-tool-${stage}`,type:'function',function:tool}]}:{role:'assistant',content:'MOCK_LLM_OK'};
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});for(const [i,delta] of [message,{}].entries())res.write(`data: ${JSON.stringify({id:'mock-1',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:i===0?null:tool?'tool_calls':'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');}
  else{res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'mock-1',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message,finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {server,requests,url:`http://127.0.0.1:${server.address().port}/v1`};
}
