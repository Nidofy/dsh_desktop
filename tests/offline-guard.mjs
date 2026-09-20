// TEST INSTRUMENTATION ONLY. Never shipped/loaded by the desktop.
// Deny non-loopback DNS and TCP and package-manager launches within Node.
import net from 'node:net';
import dns from 'node:dns';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const loopback=h=>!h||['127.0.0.1','::1','localhost'].includes(h);
const reject=h=>{process.stderr.write('OFFLINE_TEST_DENIED_NON_LOOPBACK\n');throw new Error(`OFFLINE_TEST_DENIED_NON_LOOPBACK: ${h}`);};
const lookup=dns.lookup;
dns.lookup=function(host,...rest){if(!loopback(host))reject(host);return lookup.call(this,host,...rest);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const o=typeof a[0]==='object'?a[0]:{host:typeof a[1]==='string'?a[1]:undefined};if(o.port&&!loopback(o.host))reject(o.host);return connect.apply(this,args);};
for(const method of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[method];cp[method]=function(file,...args){if(/(?:^|[\\/])(?:npm|npx|pnpm|yarn)(?:\.cmd|\.exe)?$/i.test(file))throw new Error('OFFLINE_TEST_DENIED_PACKAGE_MANAGER');return original.call(this,file,...args);};}
syncBuiltinESMExports();
