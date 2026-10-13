/** Legacy writer adapter to the Host's durable multi-process quota owner. */
import {relative,isAbsolute,sep} from 'node:path';
const owners = new Set();
export class StorageAdmissionError extends Error {constructor(code){super(code);this.code=code;}}
export function installStorageAdmission(storage){
  owners.add(storage);
  return ()=>owners.delete(storage);
}
function ownerFor(path){
  const matches=[...owners].filter(owner=>{const r=relative(owner.home,path);return r!==''&&!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);});
  if(matches.length!==1)throw new StorageAdmissionError(matches.length?'STORAGE_OWNER_CONFLICT':'STORAGE_OWNER_REQUIRED');
  return matches[0];
}
export const storageAdmission={
  async acquire(path,bytes,{signal,terminalBytes=64*1024}={}){
    signal?.throwIfAborted();
    const owner=ownerFor(path);await owner.validatePath(path);
    return owner.reserve('project-action',bytes,terminalBytes);
  },
  async write(path,bytes,work){
    return ownerFor(path).write(path,bytes,work);
  }
};
