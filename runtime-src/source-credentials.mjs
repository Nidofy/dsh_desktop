import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {ownsSourceCredential,sourceCredential} from './source-provider-control.mjs';
const require=createRequire(join(dirname(fileURLToPath(import.meta.url)),'dsh/package.json'));
const {LocalCredentialProvider}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-credentials-local')).href);
// Extend the public credential service; preserve native local/record handling
// for every other reference (including opt-in vision credentials). No core patch.
export default class DesktopSourceCredentials extends LocalCredentialProvider {
  resolve(ref){return ownsSourceCredential(ref)?Promise.resolve(sourceCredential(ref)):super.resolve(ref);}
  describe(ref){return ownsSourceCredential(ref)?Promise.resolve({configured:!!sourceCredential(ref),source:'windows-supervisor',writable:false}):super.describe(ref);}
  set(ref,value){if(ownsSourceCredential(ref))return Promise.reject(Error('Use Desktop connection settings for this Windows credential'));return super.set(ref,value);}
  unset(ref){if(ownsSourceCredential(ref))return Promise.reject(Error('Use Desktop connection settings for this Windows credential'));return super.unset(ref);}
}
