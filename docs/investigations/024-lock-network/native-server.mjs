import http from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const profile=mkdtempSync(resolve('.build/lock-native-')),home=join(profile,'DSHDesktop');mkdirSync(home);
const samples=[],requests=[];let previous=Date.now();
const timer=setInterval(()=>{const now=Date.now();samples.push({time:new Date(now).toISOString(),gapMs:now-previous});previous=now;writeFileSync(join(profile,'heartbeat.json'),JSON.stringify(samples));},1000);
const server=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
  const isTitle=JSON.stringify(body.messages).includes('Generate the session title');
  const row={startedAt:new Date().toISOString(),isTitle,chunks:0,finished:false,closed:false};requests.push(row);
  const save=()=>writeFileSync(join(profile,'requests.json'),JSON.stringify(requests,null,2));save();
  const chunk=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'lock-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
  res.writeHead(200,{'content-type':'text/event-stream'});chunk({role:'assistant',content:'本地锁屏验证开始。\n'});
  const finish=()=>{row.finished=true;row.finishedAt=new Date().toISOString();chunk({content:'\nLOCK_TEST_COMPLETED'},'stop');res.end('data: [DONE]\n\n');save();console.log('COMPLETED '+JSON.stringify(row));};
  if(isTitle){finish();return;}
  console.log('TASK_STARTED '+row.startedAt);
  const ticks=setInterval(()=>{row.chunks++;chunk({content:`${row.chunks} `});save();},1000);
  const end=setTimeout(finish,180000);
  res.on('close',()=>{clearInterval(ticks);clearTimeout(end);row.closed=true;row.closedAt=new Date().toISOString();save();});
 }catch{res.destroy();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const id='p-'+crypto.randomUUID().replaceAll('-','');
const fixture={profile,home,credentialId:id,createdAt:new Date().toISOString(),exe:resolve('dist/DSHDesktop-0.2.4-rc.2-win-x64/DSHDesktop.exe')};
writeFileSync(resolve('.build/lock-native-fixture.json'),JSON.stringify(fixture,null,2));
writeFileSync(join(home,'connections.json'),JSON.stringify({schemaVersion:1,revision:1,activeId:id,profiles:[{id,credentialRef:id,connection:{providerName:'锁屏验证 · 本地合成服务',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',model:'fixture',models:['fixture'],timeoutMs:300000,streamIdleTimeoutMs:300000,modelLimits:{},modelCapabilities:{fixture:{source:'unknown',reasoning:null}},cache:{retention:'native',anthropicMarkers:false,keyMode:'native',keyModels:[]}},network:{proxyMode:'direct',proxyUrl:'',noProxy:'',caFile:''}}]},null,2));
writeFileSync(join(home,'pets.json'),JSON.stringify({schemaVersion:3,enabled:false,instances:[]}));
console.log('READY '+profile);
const stop=()=>{clearInterval(timer);server.closeAllConnections();server.close();};
process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.includes('stop'))stop();});
setTimeout(()=>{stop();process.exit(0);},12*60000).unref();
