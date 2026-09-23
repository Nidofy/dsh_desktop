import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
const fixture=JSON.parse(readFileSync('.build/lock-native-fixture.json','utf8'));
const rows=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){walk(p);continue;}if(!p.endsWith('.zstd'))continue;let b=readFileSync(p),text='';while(b.length){const r=zstdDecompressSync(b,{info:true});if(!r.engine.bytesWritten)break;text+=r.buffer.toString();b=b.subarray(r.engine.bytesWritten);}for(const line of text.split('\n').filter(Boolean)){const e=JSON.parse(line);if(['turn/start','turn/end','step/start','step/end'].includes(e.type))rows.push({type:e.type,time:e.time,seq:e.seq,reason:e.data?.reason??null});}}}
walk(join(fixture.home,'dsh/sessions'));
const beats=JSON.parse(readFileSync(join(fixture.profile,'heartbeat.json'),'utf8'));
const requests=JSON.parse(readFileSync(join(fixture.profile,'requests.json'),'utf8'));
const report={desktopVersion:'0.2.4-rc.2',manualLockReportedByUser:true,actualSleepTest:false,modelEndpoint:'synthetic-loopback',events:rows,requests,maxHeartbeatGapMs:Math.max(...beats.map(b=>b.gapMs)),evidenceScope:'One Windows machine; user reported locking/unlocking. OS audit events unavailable; exact lock interval not independently timestamped.'};
writeFileSync(resolve('docs/investigations/024-lock-network/native-summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
