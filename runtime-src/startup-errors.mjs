// Emit fixed classifications only. Raw exceptions can contain credentials,
// settings, request text and URLs and must not enter the desktop log.
export function startupErrorCode(error,stage='BOOT') {
  const message=typeof error?.message==='string'?error.message:'';
  if(message.startsWith('workspace domain is inconsistent:'))return 'BOOT_WORKSPACE_INCONSISTENT';
  if(/not a symlink or dsh-managed module proxy/.test(message))return 'BOOT_MODULE_LINK';
  if(['EACCES','EPERM'].includes(error?.code))return 'BOOT_ACCESS_DENIED';
  if(['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error?.code))return 'BOOT_MODULE_MISSING';
  if(error?.code==='EADDRINUSE')return 'BOOT_ADDRESS_IN_USE';
  if(stage==='SETTINGS')return 'BOOT_SETTINGS_INVALID';
  if(stage==='PREFERENCES')return 'BOOT_PREFERENCES_INVALID';
  return 'BOOT_UNEXPECTED';
}
export function failStartup(error,stage){
  // Synchronous write makes the reason visible even when the process exits
  // immediately; the supervisor drains this pipe before reporting the exit.
  process.stdout.write('dsh desktop error: '+startupErrorCode(error,stage)+'\n',()=>process.exit(1));
}
export function installStartupErrors(){
  process.on('uncaughtException',error=>failStartup(error));
  process.on('unhandledRejection',error=>failStartup(error));
}
