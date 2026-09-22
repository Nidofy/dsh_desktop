// Browser visual fixture only. Native execution is covered by --self-test-only.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {selfTestHtml,selfTestScript} from '../runtime-src/self-test-page.mjs';
import {desktopThemeCss,desktopThemeScript} from '../runtime-src/desktop-theme-assets.mjs';
import {contracts,exportSelfTest,selfTestMarkdown} from '../runtime-src/self-test.mjs';
const local=JSON.parse(await readFile(process.argv[2]??'.build/observability-wire-YSmi5K/openai/self-test-local.json','utf8'));
const provider={...structuredClone(local),id:crypto.randomUUID(),mode:'provider',rows:contracts.map(c=>({...c,status:c.group==='provider'?'PASS':c.group==='manual'?'UNKNOWN':'SKIPPED',code:c.group==='provider'?'OK':c.group==='manual'?'FIELD_UNVERIFIED':'NOT_SELECTED',durationMs:c.group==='provider'?100:null}))};
let current=local,preference={preference:'dark',fontSize:14};
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const send=(type,text)=>res.writeHead(200,{'content-type':type,'cache-control':'no-store'}).end(text),json=value=>send('application/json',JSON.stringify(value));
 try{
 if(url.pathname==='/desktop-diagnostics/self-test')return send('text/html',selfTestHtml.replace('<main>','<main><div class="actions"><small>浏览器 fixture · 不执行真实检查</small><a class="button" href="/fixture/light">浅色 17px</a><a class="button" href="/fixture/dark">深色 14px</a></div>'));
 if(url.pathname==='/desktop-diagnostics/self-test.js')return send('text/javascript',selfTestScript);
 if(url.pathname==='/desktop-diagnostics/theme.css')return send('text/css',desktopThemeCss);
 if(url.pathname==='/desktop-diagnostics/theme.js')return send('text/javascript',desktopThemeScript);
 if(url.pathname==='/desktop-diagnostics/api/appearance')return json(preference);
 if(url.pathname.startsWith('/fixture/')){preference={preference:url.pathname.endsWith('light')?'light':'dark',fontSize:url.pathname.endsWith('light')?17:14};res.writeHead(302,{location:'/desktop-diagnostics/self-test'}).end();return;}
 if(url.pathname==='/desktop-diagnostics/api/self-test/state')return json({current,models:[{id:'synthetic-model',name:'合成模型 · 浏览器 fixture'}],fingerprint:'a'.repeat(64)});
 if(url.pathname==='/desktop-diagnostics/api/self-test/history')return json([local,provider].map(({id,mode,status,startedAt})=>({id,mode,status,startedAt})));
 if(url.pathname==='/desktop-diagnostics/api/self-test/report')return json([local,provider,current].find(r=>r.id===url.searchParams.get('id')));
 if(url.pathname==='/desktop-diagnostics/api/self-test/start'){let raw='';for await(const c of req)raw+=c;const value=JSON.parse(raw);current={...(value.mode==='provider'?provider:local),id:crypto.randomUUID(),status:'RUNNING',startedAt:Date.now()};setTimeout(()=>{if(current.status==='RUNNING')current={...current,status:'COMPLETED'};},3000);return json(current);}
 if(url.pathname==='/desktop-diagnostics/api/self-test/cancel'){current={...current,status:'CANCELLED'};return json({cancelRequested:true});}
 if(url.pathname==='/desktop-diagnostics/api/export'){const r=[local,provider,current].find(r=>r.id===url.searchParams.get('selfTest'));return send('text/plain',url.searchParams.has('format')?selfTestMarkdown(r):JSON.stringify(exportSelfTest(r)));}
 res.writeHead(404).end();
 }catch{res.writeHead(500).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('Self-test browser fixture: http://127.0.0.1:'+server.address().port+'/desktop-diagnostics/self-test');
