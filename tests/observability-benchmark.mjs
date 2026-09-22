import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Capture,observeStream} from '../runtime-src/diagnostic-capture.mjs';
if(!process.argv[2]) {
 const samples=[];
 for(const enabled of ['off','on','on','off']) {
  const child=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),enabled],{encoding:'utf8',windowsHide:true});
  if(child.status!==0)throw Error(child.stderr);
  samples.push(JSON.parse(child.stdout));
 }
 const report={fixture:'300 logical requests; 20 x 2048-character messages; 4 tools; 16 streamed chunks; no network delay; default spill unchanged',
  interpretation:'Synthetic CPU/memory overhead, not end-to-end model performance. Independent child processes; maxRSS is process high-water mark including Node.',samples};
 mkdirSync('.build',{recursive:true});writeFileSync('.build/observability-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} else {
 const enabled=process.argv[2]==='on',capture=new Capture({key:Buffer.alloc(32,7)});
 const options={provider:'fixture',model:'mock',sessionId:'benchmark',messages:Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:[{type:'text',text:'x'.repeat(2048)}]})),tools:Array.from({length:4},(_,i)=>({name:'tool'+i,description:'test',parameters:{type:'object',properties:{query:{type:'string'}}}}))};
 async function* source(){for(let i=0;i<14;i++)yield {type:'text-delta',text:'test',index:0};yield {type:'usage',usage:{inputTokens:1000,outputTokens:100}};yield {type:'finish',reason:{kind:'stop'}};}
 for(let i=0;i<20;i++)for await(const c of enabled?observeStream(capture,options,source):source()){}
 capture.clear();global.gc();const heapBefore=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();let chunks=0;
 for(let i=0;i<300;i++)for await(const c of enabled?observeStream(capture,options,source):source())chunks++;
 const wallMs=performance.now()-start,cpuUsed=process.cpuUsage(cpu);global.gc();
 console.log(JSON.stringify({enabled,requests:300,chunks,wallMs,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,peakRssKiB:process.resourceUsage().maxRSS,
  retainedHeapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,retainedRecordBytes:capture.bytes,records:capture.records.length,
  incompleteFingerprints:capture.records.filter(r=>!r.fingerprint.complete).length}));
}
