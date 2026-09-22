import {randomUUID} from 'node:crypto';
import {mkdir,open,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {writeAtomic} from './project-actions.mjs';
import {storageAdmission} from './storage-admission.mjs';

export const selfTestSessionPrefix='desktop-self-test-';
export const contracts=[
 ['node','local','捆绑 Node 完整性','核对实际进程路径、版本及官方固定 SHA-256。'],
 ['dsh','local','完整运行时文件','逐文件核对 DSH/依赖、Node、WebView2 和桌面模块；检测缺失、修改及额外文件。清单不是数字签名。'],
 ['modules','local','桌面扩展完整性','逐文件校验构建清单中的桌面扩展。'],
 ['webview','local','Fixed WebView2 文件','逐文件校验浏览器清单；不代表窗口已成功启动。'],
 ['storage','local','存储与原子写入','在自检目录写入、替换、重新读取合成记录。'],
 ['shell','local','原生命令与文件读写','通过 DSH workspace-write 沙箱执行固定命令。'],
 ['skills','local','原生 Skill 加载','只发现并加载自检目录中的合成 Skill。'],
 ['action-trust','local','操作信任拦截','未信任的合成操作必须被拒绝。'],
 ['action-run','local','操作执行与冷读','信任固定合成操作，执行后重新载入持久结果。'],
 ['action-change','local','操作配置变更','修改合成配置后必须重新信任。'],
 ['cancel','local','命令取消演练','取消隔离工作区中的原生长命令，验证取消结果。'],
 ['git','local','Git 状态与任务差异','在新建空仓库中验证状态、基线和修改比较。'],
 ['hg','local','Hg 状态与任务差异','在新建空仓库中验证；未安装 Hg 时跳过。'],
 ['artifact','local','产物变化保护','更新合成文件后旧下载引用必须失效。'],
 ['prefix','local','前缀分类契约','验证追加、改写与缓存路由变化；完整原生序列由构建门禁覆盖。'],
 ['recovery','local','中断状态冷读','持久化合成中断事件投影，保持未确认副作用为未知。'],
 ['notification','local','通知去重与隐私','合成事件仅进入独立内存 feed，不弹系统通知。'],
 ['probe-failure','local','探针失败演练','注入适配失败，确认停止后续请求并保留结束状态。'],
 ['connection','provider','连接请求','使用当前连接和原生适配器发送限定合成请求。'],
 ['streaming','provider','流式输出','检查适配层实际输出块及终止状态。'],
 ['tool-call','provider','工具调用协议','请求固定 echo 工具并验证参数；不执行模型生成命令。'],
 ['cache-counter','provider','缓存计数可见性','呈现适配层计数覆盖；原始服务字段覆盖仍未知。'],
 ['cache-repeat','provider','重复前缀缓存读取','只有重复请求报告正缓存读取才通过；否则未知。'],
 ['native-acceptance','manual','原生窗口与恢复现场验收','需现场检查通知弹出/点击、窗口恢复及真实异常退出。'],
 ['egress','manual','企业网络现场验收','需目标机网络观察；本机自检不能证明系统全局无出网。'],
].map(([id,group,label,scope])=>({id,group,label,scope}));
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const states=['PASS','FAIL','UNKNOWN','SKIPPED'];
const statuses=['RUNNING','COMPLETED','CANCELLED','TIMEOUT','INTERRUPTED','FAILED'];
const codes=new Set(['OK','NOT_SELECTED','FIELD_UNVERIFIED','LOCAL_ERROR','ASSERTION_FAILED','DEPENDENCY_MISSING','SERVICE_UNAVAILABLE','NO_COUNTER','NO_POSITIVE_CACHE_READ','PROVIDER_FAILED','OUTPUT_LIMIT','RETRIES_ENABLED','CONFIGURATION_CHANGED','CANCELLED','TIMEOUT','PROCESS_INTERRUPTED','STORAGE_FAILED','CLEANUP_FAILED','INTEGRITY_MISSING','INTEGRITY_CHANGED','INTEGRITY_EXTRA','INTEGRITY_UNSAFE','INTEGRITY_LIMIT','INTEGRITY_MANIFEST']);
const numeric=v=>Number.isFinite(v)&&v>=0?v:null;
export function exportSelfTest(report){
  return {schemaVersion:1,kind:'desktop-self-test',status:statuses.includes(report?.status)?report.status:'FAILED',mode:['local','provider'].includes(report?.mode)?report.mode:'local',
    startedAt:numeric(report?.startedAt),endedAt:numeric(report?.endedAt),durationMs:numeric(report?.durationMs),
    configurationFingerprint:/^[a-f0-9]{64}$/.test(report?.configurationFingerprint)?report.configurationFingerprint:null,
    budget:{timeoutMs:180000,providerRequests:report?.mode==='provider'?5:0,maxOutputTokensPerRequest:64,syntheticInputBytesPerCacheRequest:2048,retries:0},
    warning:codes.has(report?.warning)?report.warning:null,
    rows:contracts.map(contract=>{const row=report?.rows?.find(r=>r.id===contract.id);return {...contract,status:states.includes(row?.status)?row.status:'UNKNOWN',code:codes.has(row?.code)?row.code:'LOCAL_ERROR',durationMs:numeric(row?.durationMs),
      metrics:Object.fromEntries(Object.entries(row?.metrics??{}).filter(([key,value])=>['files','requests','counterCoverage','positiveRepeatReads','bytes'].includes(key)&&Number.isFinite(value)&&value>=0))};})};
}
export function selfTestMarkdown(report){const r=exportSelfTest(report);return ['# DSH Desktop 自检',`运行：${r.status} / ${r.mode}`,'PASS 仅表示对应检查范围通过；UNKNOWN 需要补充证据，SKIPPED 表示未执行。','', '| 检查 | 结果 | 代码 | 范围 |','|---|---|---|---|',...r.rows.map(row=>`| ${row.label} | ${row.status} | ${row.code} | ${row.scope} |`),''].join('\n');}
export class CheckResult extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
export function requireCheck(condition){if(!condition)throw new CheckResult('FAIL','ASSERTION_FAILED');}
export class SelfTestStore{
 constructor(home){this.dir=join(home,'desktop-self-tests','reports');this.tail=Promise.resolve();}
 async save(report){const value={...exportSelfTest(report),id:report.id};if(!ID.test(value.id))throw Error('Invalid self-test identity');const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>65536)throw Error('Report size limit');
   const task=this.tail.catch(()=>{}).then(async()=>{await mkdir(this.dir,{recursive:true});await writeAtomic(join(this.dir,value.id+'.json'),bytes);const rows=await this.list();for(const row of rows.slice(20))await unlink(join(this.dir,row.id+'.json'));});this.tail=task;await task;}
 async read(id){if(!ID.test(id??''))throw Error('Invalid self-test identity');const f=await open(join(this.dir,id+'.json'),'r');let value;try{if((await f.stat()).size>65536)throw Error();value=JSON.parse(await f.readFile('utf8'));}finally{await f.close();}if(value.id!==id||value.schemaVersion!==1||value.kind!=='desktop-self-test')throw Error('Invalid report');const result={...exportSelfTest(value),id};if(result.status==='RUNNING'){result.status='INTERRUPTED';result.warning='PROCESS_INTERRUPTED';result.rows=result.rows.map(row=>row.code==='NOT_SELECTED'&&row.group===result.mode?{...row,status:'UNKNOWN',code:'PROCESS_INTERRUPTED'}:row);}return result;}
 async list(){const files=await readdir(this.dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});if(files.length>200)throw Error('Self-test history exceeds budget');const rows=[];for(const name of files)if(name.endsWith('.json')&&ID.test(name.slice(0,-5)))try{const r=await this.read(name.slice(0,-5));rows.push({id:r.id,mode:r.mode,status:r.status,startedAt:r.startedAt});}catch{}return rows.sort((a,b)=>b.startedAt-a.startedAt);}
}
export class SelfTestRun{
 constructor({store,local,provider,now=Date.now}){Object.assign(this,{store,local,provider,now});this.current=null;this.controller=null;}
 snapshot(){if(!this.current)return null;const value={...exportSelfTest(this.current),id:this.current.id};if(this.controller){value.status='RUNNING';value.endedAt=null;value.durationMs=null;}return value;}
 start(options){if(this.controller)throw Error('已有自检正在运行');if(!options||!['local','provider'].includes(options.mode)||Object.keys(options).some(k=>!['mode','accepted','model','fingerprint'].includes(k)))throw Error('自检参数无效');if(options.mode==='provider'&&(options.accepted!==true||typeof options.model!=='string'||!options.model.length||options.model.length>256||!/^[a-f0-9]{64}$/.test(options.fingerprint??'')))throw Error('请确认当前连接和五次合成请求预算');
   const controller=new AbortController();this.controller=controller;this.current={schemaVersion:1,id:randomUUID(),status:'RUNNING',mode:options.mode,startedAt:this.now(),configurationFingerprint:options.mode==='provider'?options.fingerprint:null,rows:contracts.map(c=>({...c,status:c.group==='manual'?'UNKNOWN':'SKIPPED',code:c.group==='manual'?'FIELD_UNVERIFIED':'NOT_SELECTED',durationMs:null}))};
   this.done=this.run(options,controller).finally(()=>{this.controller=null;});return this.snapshot();}
 cancel(id){if(!this.controller||this.current?.id!==id)throw Error('当前自检已经变化');this.controller.abort('CANCELLED');}
 async run(options,controller){
   let lease;try{lease=await storageAdmission.acquire(this.store.dir,64*1024*1024,{signal:controller.signal});}
   catch{Object.assign(this.current,{status:controller.signal.aborted?'CANCELLED':'FAILED',warning:'STORAGE_FAILED',endedAt:this.now()});return;}
   try{return await lease.run(()=>this.runReserved(options,controller));}finally{await lease.release().catch(()=>{this.current.warning='STORAGE_FAILED';});}
 }
 async runReserved(options,controller){const signal=controller.signal,report=this.current;const timer=setTimeout(()=>controller.abort('TIMEOUT'),180000);timer.unref?.();
   const checkpoint=async()=>{try{await this.store.save({...exportSelfTest(report),id:report.id});}catch{throw new CheckResult('FAIL','STORAGE_FAILED');}};
   const check=async(id,execute)=>{signal.throwIfAborted();const row=report.rows.find(r=>r.id===id);if(!row||row.group!==options.mode)throw Error('Invalid self-test contract');const began=this.now();try{const result=await execute(signal);signal.throwIfAborted();Object.assign(row,{status:'PASS',code:'OK',...result});}catch(error){Object.assign(row,{status:signal.aborted?'UNKNOWN':error instanceof CheckResult?error.status:'FAIL',code:signal.aborted?signal.reason:error instanceof CheckResult?error.code:'LOCAL_ERROR'});}row.durationMs=this.now()-began;await checkpoint();};
   try{await checkpoint();await this[options.mode]({options,signal,check,report});report.status=signal.aborted?signal.reason:'COMPLETED';}
   catch(error){report.status=signal.aborted?signal.reason:'FAILED';report.warning=signal.aborted?signal.reason:error instanceof CheckResult?error.code:'LOCAL_ERROR';}
   finally{clearTimeout(timer);report.endedAt=this.now();report.durationMs=report.endedAt-report.startedAt;if(signal.aborted)for(const row of report.rows)if(row.group===options.mode&&row.code==='NOT_SELECTED'){row.status='SKIPPED';row.code=signal.reason;}try{await checkpoint();}catch{report.warning='STORAGE_FAILED';}}
 }
}
