// Browser-only UI fixture. This does NOT test the native Tauri bridge or write
// user profiles/credentials. Use the Rust tests for those contracts.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const connection={providerName:'内网示例 · UI 测试',baseUrl:'http://internal.example/v1',api:'openai-completions',model:'glm-5.3',models:['glm-5.3'],modelLimits:{},timeoutMs:300000,streamIdleTimeoutMs:300000};
let catalog={schemaVersion:1,revision:1,activeId:'legacy',profiles:[{id:'legacy',connection,network:{proxyMode:'direct',proxyUrl:'',noProxy:'',caFile:''},credentialRef:'fixture'}]};
if(process.argv.includes('--two-profiles'))catalog.profiles.push({...structuredClone(catalog.profiles[0]),id:'p-'+'d'.repeat(32),connection:{...structuredClone(connection),providerName:'第二连接 · UI 测试'}});
let active=structuredClone(catalog.profiles[0]);
let corrupt=process.argv.includes('--corrupt'), previous=structuredClone(catalog), beforeRestore;
previous.profiles[0].connection.providerName='上次保存 · UI 测试';
previous.profiles[0].connection.model='glm-5.3-flash';
previous.profiles[0].connection.models=['glm-5.3-flash'];
let recoveryVersion=1;
let credentialRows=[{id:'p-'+'a'.repeat(32),writtenAt:Date.now()-3*86400000},{id:'p-'+'b'.repeat(32),writtenAt:Date.now()-4*86400000}];
let credentialVersion=1;
let quotaRevision=0,quotaLimit=2147483648;
const recoverySource=source=>source==='previous'?previous:source==='before-restore'?beforeRestore:undefined;
const snapshots=[];
let snapshotScopes={version:1,revision:0,items:[]};
const snapshotRows=new Map();
if(process.argv.includes('--snapshot')){
  snapshots.push({id:'8'.repeat(32),workspace:'D:\\UI-fixture\\工程',count:2,createdAt:Date.now()-60000,sealed:true,task:{sessionId:'fixture-task',turn:2},admission:'CONFIRMED'});
  snapshotRows.set('8'.repeat(32),[{path:'src/main.cpp',status:'RESTORED',message:'已有恢复记录'},{path:'new.txt',status:'INTERRUPTED',message:'结果未知'}]);
}
const snapshotArchives=new Map([['D:\\UI-fixture\\existing-archive',{snapshot:{id:'9'.repeat(32),workspace:'D:\\UI-fixture\\工程',count:1,createdAt:Date.now(),sealed:true},rows:[{path:'old.txt',status:'READY',message:'原内容备份可恢复'}]}]]);
let storageRows=[['measurements','诊断采集记录'],['fixtures','自检遗留工作目录'],['snapshots','文件恢复快照与备份']].map(([category,label],i)=>({category,label,id:'fixture-'+i,token:'fixture-token-'+i,bytes:4096*(i+1),files:i+1,modifiedAt:Date.now()-40*86400000}));
const bridge=`window.__TAURI__={core:{invoke:async(command,args)=>{const r=await fetch('/fixture-invoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});const body=await r.json();if(!r.ok)throw body.error;return body;}}};`;
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url==='/fixture-invoke'&&req.method==='POST') {
      const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>128*1024)throw Error('Too large');chunks.push(c);}
      const {command,args}=JSON.parse(Buffer.concat(chunks));let result;
      if(command==='appearance')result={preference:process.argv.includes('--light')?'light':'dark',fontSize:process.argv.includes('--light')?17:14};
      else if(command==='diagnostics')result={backendHealth:'ready',detail:'浏览器 UI 测试；无原生引擎和真实凭据',activeProfileId:active.id,activeProfileName:active.connection.providerName,activeProfileNeedsApply:JSON.stringify(active)!==JSON.stringify(catalog.profiles.find(p=>p.id===active.id)),desktopVersion:'development',snapshotNavigation:process.argv.includes('--snapshot')?{requestId:'fixture-navigation',id:'8'.repeat(32)}:null};
      else if(command==='connection_profiles'){if(corrupt)throw Error('Fixture: 配置损坏');result=catalog;}
      else if(command==='global_storage_stats')result={bytes:12582912,files:12,limitBytes:quotaLimit,quotaRevision,reservedBytes:1048576,availableBytes:corrupt?null:Math.max(0,quotaLimit-13631488),complete:!corrupt,enforcement:'NATIVE_AND_NODE_ADMISSION',warnings:corrupt?['隐藏连接 / 文件不可读取：统计不完整']:[],profiles:[{id:'legacy',home:'D:\\UI-fixture\\dsh',bytes:4194304,files:8,complete:true},{id:'p-'+'c'.repeat(32),home:'D:\\UI-fixture\\profiles\\旧连接\\dsh',bytes:8388608,files:4,complete:!corrupt}]};
      else if(command==='set_storage_quota'){
        if(args.expectedRevision!==quotaRevision)throw Error('总配额设置已变化，请重新扫描后保存');
        if(!Number.isInteger(args.limitBytes)||args.limitBytes<268435456||args.limitBytes>68719476736)throw Error('额度无效');
        quotaLimit=args.limitBytes;quotaRevision++;
        result={bytes:12582912,files:12,limitBytes:quotaLimit,quotaRevision,reservedBytes:1048576,availableBytes:corrupt?null:Math.max(0,quotaLimit-13631488),complete:!corrupt,enforcement:'NATIVE_AND_NODE_ADMISSION',warnings:[],profiles:[]};
      }
      else if(command==='credential_cleanup') {
        if(corrupt)throw Error('配置损坏，无法确定凭据引用');
        if(args?.selection){
          if(args.selection.token!==String(credentialVersion)+'-'+recoveryVersion)throw Error('预览已过期，请重新扫描');
          result=args.selection.ids.map(id=>({id,status:credentialRows.some(row=>row.id===id)?'DELETED':'ALREADY_MISSING'}));
          credentialRows=credentialRows.filter(row=>!args.selection.ids.includes(row.id));credentialVersion++;
        } else result={token:String(credentialVersion)+'-'+recoveryVersion,rows:credentialRows,referenced:3,recent:1,total:credentialRows.length+4};
      }
      else if(command==='connection_recovery') {
        if(args?.source) {
          if(args.token!==`${args.source}-${recoveryVersion}`)throw Error('配置或备份已变化，请重新预览后再回退。');
          const source=recoverySource(args.source);if(!source)throw Error('Fixture: 备份不可用');
          const next=structuredClone(source);beforeRestore=corrupt?undefined:structuredClone(catalog);
          next.revision=catalog.revision+1024;catalog=next;corrupt=false;recoveryVersion++;result=catalog;
        } else result={currentStatus:corrupt?'INVALID':'CURRENT',candidates:[['previous','上一次保存前的配置'],['before-restore','上一次回退前的配置'],['legacy','旧版单连接配置']].map(([source,label])=>{
          const c=recoverySource(source);return {source,label,available:!!c,error:c?null:'尚无此备份',token:c?`${source}-${recoveryVersion}`:null,removedProfiles:[],profiles:c?.profiles.map(p=>({id:p.id,name:p.connection.providerName,endpoint:p.connection.baseUrl,api:p.connection.api,models:p.connection.models.length,credentialAvailable:false,networkReady:true,active:p.id===c.activeId}))??[]};
        })};
      }
      else if(command==='desktop_storage') {
        if(args.selection){result=args.selection.map(s=>{const row=storageRows.find(r=>r.id===s.id&&r.token===s.token);if(!row)return {...s,status:'REFUSED',deletedFiles:0,freedBytes:0,message:'预览已变化'};storageRows=storageRows.filter(r=>r!==row);return {...s,status:'DELETED',deletedFiles:row.files,freedBytes:row.bytes,message:'已永久清理所选记录（内存 fixture）'};});}
        else result={rows:storageRows.filter(r=>r.modifiedAt<=Date.now()-args.days*86400000),managedBytes:storageRows.reduce((n,r)=>n+r.bytes,0),warnings:[],cutoffMs:Date.now()-args.days*86400000,home:'D:\\UI-fixture\\dsh'};
      }
      else if(command==='task_snapshots') {
        if(args.profileId!==active.id)throw Error('当前连接已变化，请重新载入快照');
        const {action,id,workspace,paths}=args.request;
        const item=snapshots.find(item=>item.id===id);
        if(action==='list')result={items:snapshots,storagePath:'D:\\UI-fixture\\home\\desktop-task-snapshots',incomplete:0};
        else if(action==='browse') {
          if(!workspace)throw Error('请输入工作区');
          result={workspace,directory:args.request.directory,truncated:false,rows:args.request.directory?[{name:'main.cpp',path:'src/main.cpp',kind:'file',bytes:512,selectable:true}]:[{name:'src',path:'src',kind:'directory'},{name:'README.md',path:'README.md',kind:'file',bytes:128,selectable:true},{name:'large.bin',path:'large.bin',kind:'file',bytes:10000000,selectable:false}]};
        } else if(action==='export') {
          if(!item||!args.request.destination)throw Error('请选择快照和已有导出目录');
          const directory=args.request.destination+'\\DSH-snapshot-fixture-'+id;
          snapshotArchives.set(directory,{snapshot:structuredClone(item),rows:structuredClone(snapshotRows.get(id))});
          result={directory,snapshotId:id,files:5,bytes:1024,workspace:item.workspace,verified:true};
        } else if(action==='verifyArchive'||action==='importArchive') {
          const stored=snapshotArchives.get(args.request.directory);if(!stored)throw Error('归档校验失败');
          if(action==='verifyArchive')result={directory:args.request.directory,snapshotId:stored.snapshot.id,files:5,bytes:1024,workspace:stored.snapshot.workspace,verified:true};
          else {if(snapshots.some(s=>s.id===stored.snapshot.id))throw Error('同编号快照已存在；不会覆盖');snapshots.push(structuredClone(stored.snapshot));snapshotRows.set(stored.snapshot.id,structuredClone(stored.rows));result={snapshot:stored.snapshot,imported:true};}
        }
        else if(action==='scopes')result=snapshotScopes;
        else if(action==='arm') {
          if(args.request.revision!==snapshotScopes.revision)throw Error('范围配置已变化，请重新载入');
          if(!workspace||!paths?.length)throw Error('请选择工作区与文件');
          snapshotScopes={...snapshotScopes,revision:snapshotScopes.revision+1,items:[...snapshotScopes.items.filter(s=>s.workspace!==workspace),{id:String(snapshotScopes.revision+1).padStart(32,'0'),workspace,paths,identity:'fixture'}]};result=snapshotScopes;
        } else if(action==='disarm') {
          if(args.request.revision!==snapshotScopes.revision)throw Error('范围配置已变化，请重新载入');
          snapshotScopes={...snapshotScopes,revision:snapshotScopes.revision+1,items:snapshotScopes.items.filter(s=>s.id!==id)};result=snapshotScopes;
        }
        else if(action==='capture') {
          if(!workspace||!paths?.length)throw Error('请选择工作区与文件');
          result={id:String(snapshots.length+1).padStart(32,'0'),workspace,count:paths.length,createdAt:Date.now(),sealed:false};
          snapshots.unshift(result); snapshotRows.set(result.id,paths.map((path,i)=>({path,status:i===1?'CONFLICT':'READY',message:i===1?'结束记录后文件已变化，保持当前内容':'恢复为快照中的原始内容'})));
        } else if(!item)throw Error('快照不存在');
        else if(action==='seal'){item.sealed=true;result=item;}
        else if(action==='preview'||action==='restore') {
          const rows=snapshotRows.get(id);
          if(action==='restore')for(const row of rows)if(paths.includes(row.path)&&row.status==='READY'){row.status='RESTORED';row.message='已有恢复记录，不会自动重放';}
          result={snapshot:item,rows};
        } else if(action==='details') {
          result={snapshot:item,storagePath:'D:\\UI-fixture\\snapshots\\'+id,currentWorkspaceChecked:false,endRecordedAt:item.sealed?Date.now()-30000:null,rows:(snapshotRows.get(id)??[]).map((row,i)=>({path:row.path,before:{kind:'file',bytes:123,sha256:'a'.repeat(64)},end:{kind:'file',bytes:234,sha256:'b'.repeat(64)},originalBackup:{status:'VERIFIED',name:'before-'+i+'.bin',sha256:'a'.repeat(64)},recoveryBackup:{status:row.status==='RESTORED'?'VERIFIED':'UNVERIFIED',name:'pre-restore-'+i+'.bin',sha256:'b'.repeat(64)},recovery:{status:row.status==='RESTORED'?'RESTORED':row.status==='INTERRUPTED'?'UNKNOWN':'NOT_ATTEMPTED',preparedAt:Date.now()-10000,completedAt:row.status==='RESTORED'?Date.now()-5000:null}}))};
        } else throw Error('Unsupported snapshot fixture');
      }
      else if(command==='save_connection_profile') {
        if(corrupt)throw Error('Fixture: 配置损坏');
        if(args.revision!==catalog.revision)throw Error('Stale revision');
        previous=structuredClone(catalog);recoveryVersion++;
        const id=args.id??'p-00000000000000000000000000000001';
        if(!args.id&&!args.apiKey)throw Error('请输入测试占位密钥');
        const p={id,connection:args.connection,network:args.network,credentialRef:'fixture'};
        const index=catalog.profiles.findIndex(p=>p.id===id);
        if(index<0)catalog.profiles.push(p);else catalog.profiles[index]=p;
        catalog.revision++;result=catalog;
      } else if(command==='delete_connection_profile') {
        if(args.revision!==catalog.revision)throw Error('Stale revision');
        if(catalog.activeId===args.id&&catalog.profiles.length>1&&!args.replacementId)throw Error('请选择其他连接');
        catalog.profiles=catalog.profiles.filter(p=>p.id!==args.id);
        if(!catalog.profiles.length)catalog.profiles.push({id:'legacy',connection:{...connection,baseUrl:'',models:[],model:''},network:{proxyMode:'inherit'},credentialRef:null});
        if(catalog.activeId===args.id)catalog.activeId=args.replacementId||catalog.profiles[0].id;
        active=catalog.profiles.find(p=>p.id===catalog.activeId);catalog.revision++;result=catalog;
      } else if(command==='activate_connection_profile') {
        if(args.revision!==catalog.revision)throw Error('Stale revision');
        previous=structuredClone(catalog);recoveryVersion++;
          catalog.activeId=args.id;active=structuredClone(catalog.profiles.find(p=>p.id===args.id));catalog.revision++;result=null;
      } else throw Error('Unsupported fixture operation');
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));return;
    }
    if(req.url==='/fixture-bridge.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(bridge);return;}
    const file=req.url==='/'?'index.html':req.url.slice(1);
    if(!['index.html','provider-catalog.js','app.js','settings-navigation.js','profile-recovery.js','storage.js','credentials.js','snapshots.js','style.css','dsh-tokens.css','desktop-theme.css','desktop-theme.js','icon.png'].includes(file)){res.writeHead(404).end();return;}
    let bytes=await readFile(join(resolve('shell-ui'),file));
    if(file==='index.html')bytes=bytes.toString().replace('<script src="desktop-theme.js"','<script src="fixture-bridge.js" defer></script><script src="desktop-theme.js"');
    res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"}).end(bytes);
  } catch(error) {res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}));}
});
server.listen(0,'127.0.0.1',()=>console.log(`Settings UI fixture: http://127.0.0.1:${server.address().port}/`));
const stop=()=>{process.stdin.pause();server.closeAllConnections();server.close();clearTimeout(timer);};
const timer=setTimeout(stop,10*60*1000);process.on('SIGINT',stop);
process.stdin.once('data',()=>{process.stdin.pause();stop();});

