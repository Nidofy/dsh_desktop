import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes} from 'node:crypto';
import {relative,resolve,isAbsolute,sep} from 'node:path';
import {snapshotPipe} from './task-snapshot-bridge.mjs';

const roots=new Set(['desktop-measurements','desktop-cache-probes','desktop-self-tests','desktop-changes','desktop-actions','desktop-artifact-exports','desktop-task-snapshots']);
export class StorageAdmissionError extends Error {
  constructor(code){super({STORAGE_QUOTA_UNAVAILABLE:'无法预留本机存储额度，请到设置中的存储总览检查占用、统计状态及配额。',STORAGE_RELEASE_UNCONFIRMED:'存储额度释放尚未确认，请检查引擎状态；文件或任务不会自动重试。',STORAGE_RESERVATION_EXPIRED:'此任务的存储预留已结束。',STORAGE_RESERVATION_EXCEEDED:'此任务写入量已超过预留上限，已有记录保留。'}[code]);this.code=code;}
}
export class StorageAdmission {
  #pipe; #home; #enabled=false; #closed=false; #context=new AsyncLocalStorage(); #releaseTail=Promise.resolve();
  constructor(pipe){this.#pipe=pipe;}
  configure(enabled,home){if(this.#home||!enabled)return;this.#home=resolve(home);this.#enabled=true;}
  managed(path){if(!this.#enabled)return false;const part=relative(this.#home,resolve(path));return !isAbsolute(part)&&!part.startsWith('..'+sep)&&roots.has(part.split(sep)[0]);}
  async acquire(path,bytes,{signal}={}){
    if(!this.managed(path))return {run:work=>work(),release:async()=>{}};
    if(this.#closed||!Number.isSafeInteger(bytes)||bytes<1||bytes>1024**3)throw new StorageAdmissionError('STORAGE_QUOTA_UNAVAILABLE');
    signal?.throwIfAborted();
    const id=randomBytes(16).toString('hex');
    const release=()=>{
      const task=this.#releaseTail.catch(()=>{}).then(async()=>{
        // Idempotent cleanup only, never retry the associated file write.
        for(let attempt=0;attempt<2;attempt++){try{const result=await this.#pipe.request({action:'releaseStorage',reservationId:id});if(result.status==='RELEASED')return;}catch{}}
        throw new StorageAdmissionError('STORAGE_RELEASE_UNCONFIRMED');
      });this.#releaseTail=task;return task;
    };
    try{const value=await this.#pipe.request({action:'reserveStorage',bytes,expiresAt:Date.now()+13000},{requestId:id,signal});if(value.status!=='RESERVED'||value.reservationId!==id)throw Error();signal?.throwIfAborted();}
    catch{await release().catch(()=>{});throw new StorageAdmissionError('STORAGE_QUOTA_UNAVAILABLE');}
    const context={id,bytes,used:0,active:true};let released=false;
    return {run:work=>this.#context.run(context,work),release:async()=>{if(released)return;released=true;context.active=false;await release();}};
  }
  async write(path,bytes,work){
    if(!this.managed(path))return work();
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>1024**3)throw new StorageAdmissionError('STORAGE_QUOTA_UNAVAILABLE');
    const context=this.#context.getStore();
    if(context){
      // Already admitted jobs may persist their final cancellation record after
      // shutdown begins. Count cumulative writes, including failed temporaries.
      if(!context.active)throw new StorageAdmissionError('STORAGE_RESERVATION_EXPIRED');
      if(context.used+bytes>context.bytes)throw new StorageAdmissionError('STORAGE_RESERVATION_EXCEEDED');
      context.used+=bytes;return work();
    }
    const lease=await this.acquire(path,bytes);
    try{return await lease.run(work);}finally{await lease.release();}
  }
  close(){this.#closed=true;}
}
export const storageAdmission=new StorageAdmission(snapshotPipe);
