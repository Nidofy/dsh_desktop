import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {startupErrorCode} from '../runtime-src/startup-errors.mjs';
assert.equal(startupErrorCode({code:'EPERM',message:'secret'}),'BOOT_ACCESS_DENIED');
assert.equal(startupErrorCode(new Error('not a symlink or dsh-managed module proxy')),'BOOT_MODULE_LINK');
assert.equal(startupErrorCode(new Error('workspace domain is inconsistent: private path')),'BOOT_WORKSPACE_INCONSISTENT');
assert.equal(startupErrorCode(new Error('private-setting'),'SETTINGS'),'BOOT_SETTINGS_INVALID');
assert.equal(startupErrorCode({code:'SOURCE_LEGACY_SECTION_UNSUPPORTED',message:'private-setting'},'SETTINGS'),'BOOT_LEGACY_MIGRATION');
assert.equal(startupErrorCode({code:'SETTINGS_TRANSACTION_CONFLICT',message:'private-setting'},'SETTINGS'),'BOOT_SETTINGS_CONFLICT');
assert.equal(startupErrorCode({code:'SETTINGS_PROTECTION_UNAVAILABLE',message:'private-setting'},'SETTINGS'),'BOOT_SETTINGS_RECOVERY');
assert.equal(startupErrorCode(new Error('atomic-write: timed out waiting for the writer lock at private-path'),'SETTINGS'),'BOOT_SETTINGS_LOCKED');
const module=pathToFileURL(resolve('runtime-src/startup-errors.mjs')).href;
for(const code of ["throw Error('secret-provider-response')","Promise.reject(Error('secret-provider-response'))"]){
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {installStartupErrors} from ${JSON.stringify(module)};installStartupErrors();${code}`],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.equal(result.stdout,'dsh desktop error: BOOT_UNEXPECTED\n');assert.equal(result.stderr,'');
}
console.log('PASS startup errors: fixed classifications, synchronous exit receipt, no exception payload');
