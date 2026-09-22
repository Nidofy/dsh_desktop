import assert from 'node:assert/strict';
import http from 'node:http';
import {analyzeImage,imageByteLimit} from '../runtime-src/vision-provider.mjs';
const requests=[];
let mode='ok';
const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  requests.push({url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks))});
  if(mode==='redirect'){res.writeHead(302,{location:'/leak'}).end();return;}
  if(mode==='unauthorized'){res.writeHead(401).end('secret-key');return;}
  if(mode==='large'){res.end('x'.repeat(1024*1024+1));return;}
  if(mode==='invalid'){res.end('secret-key');return;}
  if(mode==='empty'){res.end('{}');return;}
  if(mode==='slow'){setTimeout(()=>res.end('{}'),1500);return;}
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(req.url.endsWith('messages')?{content:[{type:'text',text:'图片测试'}]}:{choices:[{message:{content:'图片测试'}}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const config={enabled:true,baseURL:`http://127.0.0.1:${server.address().port}/v1/`,model:'vision-fixture',maxTokens:4096,timeoutMs:1000};
const input={data:Buffer.from('image-fixture'),mediaType:'image/png',question:'说明图片',apiKey:'secret-key'};
try{
  for(const api of ['openai-completions','anthropic-messages']){
    assert.equal((await analyzeImage({...config,api},input)).text,'图片测试');
    const r=requests.at(-1);assert.equal(r.body.model,config.model);assert.equal(r.body.messages.length,1);
    const image=r.body.messages[0].content[0];
    if(api==='openai-completions'){assert.equal(r.url,'/v1/chat/completions');assert.equal(r.headers.authorization,'Bearer secret-key');assert.equal(image.image_url.url,'data:image/png;base64,'+input.data.toString('base64'));}
    else{assert.equal(r.url,'/v1/messages');assert.equal(r.headers['x-api-key'],'secret-key');assert.equal(r.headers['anthropic-version'],'2023-06-01');assert.equal(image.source.data,input.data.toString('base64'));}
  }
  const c={...config,api:'openai-completions'};
  const count=requests.length;
  await assert.rejects(analyzeImage({...c,enabled:false},input),/启用/);
  await assert.rejects(analyzeImage(c,{...input,data:Buffer.alloc(imageByteLimit+1)}),/10 MB/);
  await assert.rejects(analyzeImage(c,{...input,mediaType:'text/plain'}),/仅支持/);
  await assert.rejects(analyzeImage(c,{...input,apiKey:''}),/API Key/);
  await assert.rejects(analyzeImage({...c,baseURL:'http://secret@example.com'},input),/不含凭据/);
  assert.equal(requests.length,count);
  for(const [kind,pattern] of [['redirect',/无法连接/],['unauthorized',/HTTP 401/],['invalid',/有效 JSON/],['large',/过大/],['empty',/未返回文字/],['slow',/超时/]]){
    mode=kind;await assert.rejects(analyzeImage(c,input),error=>{assert.doesNotMatch(error.message,/secret-key/);return pattern.test(error.message);});
  }
  assert.equal(requests.filter(r=>r.url==='/leak').length,0);
  await assert.rejects(analyzeImage(c,{...input,signal:AbortSignal.abort()}),/取消/);
  console.log('PASS: dual vision protocols, payload/auth, limits, no redirect, redacted errors, cancellation/timeout.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
