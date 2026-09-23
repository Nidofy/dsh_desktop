import {execFile} from 'node:child_process';
import {join,win32} from 'node:path';

const limit=16*1024*1024;
function dpapi(operation, bytes) {
  if(process.platform!=='win32'||!Buffer.isBuffer(bytes)||bytes.length>limit)
    throw Object.assign(Error('SETTINGS_PROTECTION_UNAVAILABLE'),{code:'SETTINGS_PROTECTION_UNAVAILABLE'});
  const root=process.env.SystemRoot;
  if(!root||!win32.isAbsolute(root)||root.startsWith('\\\\'))throw Error('SETTINGS_PROTECTION_UNAVAILABLE');
  // Fixed local OS helper; sensitive bytes only travel over private stdio.
  // No profile, scripts on disk, secret argv, shell expansion or plaintext fallback.
  const script=`$ErrorActionPreference='Stop';try{Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$e=[Text.Encoding]::UTF8.GetBytes('DSHDesktop/settings-transaction/v1');$r=[Security.Cryptography.ProtectedData]::${operation}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))}catch{exit 1}`;
  return new Promise((resolve,reject)=>{
    const child=execFile(join(root,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,timeout:15000,maxBuffer:24*1024*1024,encoding:'utf8',env:{SystemRoot:root,WINDIR:root}},
      (error,stdout)=>{
        if(error||!stdout||!/^[A-Za-z0-9+/]+={0,2}$/.test(stdout))return reject(Object.assign(Error('SETTINGS_PROTECTION_UNAVAILABLE'),{code:'SETTINGS_PROTECTION_UNAVAILABLE'}));
        const result=Buffer.from(stdout,'base64');
        if(result.length>limit)return reject(Error('SETTINGS_PROTECTION_UNAVAILABLE'));
        resolve(result);
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(bytes.toString('base64'));
  });
}

export const settingsProtection={
  protect:bytes=>dpapi('Protect',bytes),
  unprotect:bytes=>dpapi('Unprotect',bytes),
};
