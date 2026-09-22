// Browser visual fixture with real local repository service, synthetic files only.
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {installChangeReview} from '../runtime-src/change-review-integration.mjs';
import {desktopThemeCss,desktopThemeScript} from '../runtime-src/desktop-theme-assets.mjs';
await mkdir('.build',{recursive:true});const root=await mkdtemp(resolve('.build/changes-ui-')),workspace=join(root,'示例工程');await mkdir(workspace);
const exec=promisify(execFile),git=(...args)=>exec('git',args,{cwd:workspace,windowsHide:true});await git('init');await writeFile(join(workspace,'求解器.cpp'),'int compute() {\n  return 1;\n}\n');await writeFile(join(workspace,'README.md'),'# Example\n');await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','init');
await writeFile(join(workspace,'README.md'),'# Example\nUser notes\n');const center=installChangeReview({on(){}},join(root,'home'),process.argv.includes('--snapshot')?{snapshots:{enabled:true,request:async()=>({status:'OPEN_REQUESTED'})}}:{});const baseline=await center.manager.capture(workspace);if(process.argv.includes('--snapshot'))await center.manager.capture(workspace,{source:'turn-start',sessionId:'fixture-snapshot',turn:2});
await writeFile(join(workspace,'求解器.cpp'),'int compute() {\n  return 2;\n}\n');await writeFile(join(workspace,'README.md'),'# Example\nUser notes\nTask notes\n');await writeFile(join(workspace,'notes.md'),'Synthetic new artifact\n');
let theme={preference:'dark',fontSize:14};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://'+req.headers.host);res.setHeader('cache-control','no-store');res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 if(url.pathname==='/desktop-diagnostics/theme.css'){res.writeHead(200,{'content-type':'text/css'}).end(desktopThemeCss);return;}
 if(url.pathname==='/desktop-diagnostics/theme.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(desktopThemeScript);return;}
 if(url.pathname==='/desktop-diagnostics/api/appearance'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(theme));return;}
 if(url.pathname==='/fixture/light'){theme={preference:'light',fontSize:17};res.writeHead(200).end('Fixture appearance changed');return;}
 await center.handle(req,res,url);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/desktop-diagnostics/changes?'+new URLSearchParams({workspace}),root,baseline:baseline.id})));
const timer=setTimeout(stop,10*60*1000);function stop(){clearTimeout(timer);server.closeAllConnections();server.close();}process.on('SIGINT',stop);
