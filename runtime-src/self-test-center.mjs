import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SelfTestRun,SelfTestStore,exportSelfTest,selfTestMarkdown} from './self-test.mjs';
import {localSelfTests} from './self-test-local.mjs';
import {providerSelfTests} from './self-test-provider.mjs';
import {selfTestHtml,selfTestScript} from './self-test-page.mjs';

export function installSelfTestCenter(ctx,home,cache){
 const store=new SelfTestStore(home),runner=new SelfTestRun({store,local:localSelfTests(ctx,home,dirname(fileURLToPath(import.meta.url))),provider:providerSelfTests(ctx,cache)});
 ctx.effect(()=>async()=>{if(runner.controller){runner.cancel(runner.current.id);await runner.done;}});
 const report=id=>runner.current?.id===id?Promise.resolve(runner.snapshot()):store.read(id);
 return {runner,async handle(req,res,url){
  const json=(status,value)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
  try{
   if(req.method==='GET'){
    if(url.pathname==='/desktop-diagnostics/self-test'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(selfTestHtml);return;}
    if(url.pathname==='/desktop-diagnostics/self-test.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(selfTestScript);return;}
    if(url.pathname==='/desktop-diagnostics/api/self-test/state'){const connection=await cache.state().catch(()=>null);json(200,{current:runner.snapshot(),models:connection?.models??[],fingerprint:connection?.fingerprint??null,connectionAvailable:!!connection});return;}
    if(url.pathname==='/desktop-diagnostics/api/self-test/history'){const live=runner.snapshot();json(200,(await store.list()).slice(0,20).map(row=>row.id===live?.id?{...row,status:live.status}:row));return;}
    if(url.pathname==='/desktop-diagnostics/api/self-test/report'){json(200,await report(url.searchParams.get('id')));return;}
    if(url.pathname==='/desktop-diagnostics/api/export'&&url.searchParams.has('selfTest')){const value=await report(url.searchParams.get('selfTest')),md=url.searchParams.get('format')==='md';res.writeHead(200,{'content-type':md?'text/markdown; charset=utf-8':'application/json; charset=utf-8','content-disposition':`attachment; filename="DSH-self-test.${md?'md':'json'}"`}).end(md?selfTestMarkdown(value):JSON.stringify(exportSelfTest(value),null,2));return;}
   }
   if(req.method==='POST'){
    if(req.headers.origin!=='http://'+req.headers.host||req.headers['content-type']!=='application/json'){json(403,{error:'需要同源 JSON 请求'});return;}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096){json(413,{error:'请求过大'});return;}chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{json(400,{error:'JSON 无效'});return;}
    if(url.pathname==='/desktop-diagnostics/api/self-test/start'){
      if(value?.mode==='provider'){const current=await cache.state();if(current.fingerprint!==value.fingerprint||!current.models.some(m=>m.id===value.model)){json(409,{error:'连接或模型已经变化，请刷新后确认预算'});return;}}
      try{json(202,runner.start(value));}catch{json(409,{error:'自检正在运行，或尚未确认有效的检查参数与请求预算'});}return;
    }
    if(url.pathname==='/desktop-diagnostics/api/self-test/cancel'){try{runner.cancel(value.id);json(200,{cancelRequested:true});}catch{json(409,{error:'当前自检已经变化，请刷新'});}return;}
   }
   json(404,{error:'入口不存在'});
  }catch{json(500,{error:'自检状态无法读取；请检查本机存储和引擎状态'});}
 }};
}
