// Real sockets, native DSH proxy policy, Node trust loading. No external network.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=mkdtempSync(resolve('.build/profile-network-')), runtime=resolve('runtime');
const node=join(runtime,'runtime/node.exe');
const openssl=process.env.DSH_TEST_OPENSSL ?? 'C:/Program Files/Git/usr/bin/openssl.exe';
assert(existsSync(openssl),'Set DSH_TEST_OPENSSL to a developer OpenSSL executable');
const cert=join(root,'ca.pem'),key=join(root,'test-key.pem');
const generated=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true,encoding:'utf8'});
assert.equal(generated.status,0,generated.stderr);
const results=[],sockets=new Set(),requests=[];
const plain=http.createServer((req,res)=>{requests.push(req.url);res.end('PROFILE_NETWORK_OK');});
const secure=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>res.end('PROFILE_TLS_OK'));
let proxyCalls=0;
const proxy=http.createServer((req,res)=>{
  proxyCalls++;const target=new URL(req.url);assert.equal(target.hostname,'gateway.test');
  const upstream=http.request({host:'127.0.0.1',port:plain.address().port,path:target.pathname,method:req.method},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);
});
proxy.on('connect',(req,client,head)=>{
  proxyCalls++;
  const target=new URL('http://'+req.url);assert.equal(target.hostname,'gateway.test');
  const upstream=net.connect({host:'127.0.0.1',port:plain.address().port},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
  for(const socket of [client,upstream]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{client.destroy();upstream.destroy();});}
});
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',r));
await Promise.all([plain,secure,proxy].map(listen));
const proxyURL=`http://127.0.0.1:${proxy.address().port}`;
const source=`
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(${JSON.stringify(join(runtime,'dsh/package.json'))});
const {createLaunchEnvironmentSnapshot}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-launch-environment')).href);
const {installProxyFromEnvironment,proxyRouteFor}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-http-proxy')).href);
const {validateExtraCa}=await import(${JSON.stringify(pathToFileURL(resolve('runtime-src/desktop-network.mjs')).href)});
await validateExtraCa();
const warnings=[];
const close=await installProxyFromEnvironment(createLaunchEnvironmentSnapshot([{source:'process',values:process.env},{source:'user-env',values:{HTTP_PROXY:'http://127.0.0.1:1',http_proxy:'http://127.0.0.1:1'}}]),m=>warnings.push(m));
try {const r=await fetch(process.env.TEST_URL,{signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({status:r.status,body:await r.text(),warnings}));}finally{await close();}
`;
async function run(mode,url,extra={}) {
  const overlay=JSON.parse(readFileSync(`.build/profile-network-fixtures/${mode}.json`,'utf8'));
  const env={...process.env,HTTP_PROXY:proxyURL,HTTPS_PROXY:proxyURL,ALL_PROXY:proxyURL,NO_PROXY:'',NODE_USE_ENV_PROXY:'',NODE_EXTRA_CA_CERTS:'',NODE_OPTIONS:'',TEST_URL:url};
  // Windows environment names are case insensitive; canonicalize both sides.
  for(const name of Object.keys(env)){if(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'].includes(name.toUpperCase())&&name!==name.toUpperCase())delete env[name];}
  for(const [name,value] of Object.entries(overlay)){
    const canonical=name.toUpperCase();
    if(value===null)delete env[canonical];else env[canonical]=value==='http://127.0.0.1:9876'?proxyURL:value;
  }
  Object.assign(env,extra);
  const child=spawn(node,['--use-system-ca','--input-type=module','-e',source],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  const timer=setTimeout(()=>child.kill(),15000);
  const code=await new Promise((r,reject)=>{child.on('error',reject);child.on('exit',r);});clearTimeout(timer);
  return {code,out,err};
}
try {
  const direct=await run('direct',`http://127.0.0.1:${plain.address().port}/direct`);
  assert.equal(direct.code,0,direct.err);assert.equal(proxyCalls,0);assert.equal(JSON.parse(direct.out).body,'PROFILE_NETWORK_OK');
  for(const mode of ['explicit','inherit']) {
    const before=proxyCalls,result=await run(mode,`http://gateway.test:${plain.address().port}/${mode}`);
    assert.equal(result.code,0,result.err);assert.equal(proxyCalls,before+1);assert.equal(JSON.parse(result.out).body,'PROFILE_NETWORK_OK');
  }
  const before=proxyCalls,loopback=await run('explicit',`http://127.0.0.1:${plain.address().port}/loopback`);
  assert.equal(loopback.code,0,loopback.err);assert.equal(proxyCalls,before,'native loopback bypass');
  const tlsURL=`https://localhost:${secure.address().port}/tls`;
  const untrusted=await run('direct',tlsURL);assert.notEqual(untrusted.code,0,'untrusted certificate must fail');
  const trusted=await run('direct',tlsURL,{NODE_EXTRA_CA_CERTS:cert});assert.equal(trusted.code,0,trusted.err);assert.equal(JSON.parse(trusted.out).body,'PROFILE_TLS_OK');
  const invalid=join(root,'invalid.pem');writeFileSync(invalid,'not a certificate');
  for(const file of [invalid,join(root,'missing.pem')]) {
    const rejected=await run('direct',tlsURL,{NODE_EXTRA_CA_CERTS:file});assert.notEqual(rejected.code,0);assert.match(rejected.err,/enterprise CA could not be validated/);
  }
  results.push({status:'PASS',direct:true,explicitProxy:true,inheritedProxy:true,loopbackBypass:true,untrustedTlsRejected:true,enterpriseCa:true,invalidCaStopsStartup:true});
  console.log('PASS profile network: native proxy sockets, loopback bypass, TLS verification, enterprise CA, fail-closed CA startup');
} finally {
  for(const socket of sockets)socket.destroy();
  for(const server of [plain,secure,proxy]){server.closeAllConnections();server.close();}
  writeFileSync(join(root,'report.json'),JSON.stringify(results,null,2));console.log('Evidence directory:',root);
}
