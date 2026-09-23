import {desktopCacheKeyOptions} from './desktop-cache-key.mjs';
import {cacheKeyBridgeRequired} from './desktop-cache-key-bridge.mjs';
import {installSourceProviderControl,sourceProviderPolicy} from './source-provider-control.mjs';
import {readHarnessSetting} from './harness-settings.mjs';
export const name='desktop-source-cache';
export const inject=['settings'];
export function apply(ctx,config) {
  cacheKeyBridgeRequired([{id:'llm-pi-ai',config}]);
  installSourceProviderControl(ctx,config.providers);
  ctx.on('llm-pi-ai/prepare-payload',scope=>{
    const current=readHarnessSetting(ctx,'llm-pi-ai')?.providers?.[scope.provider];
    const configured=sourceProviderPolicy(scope.provider,current?.apiKeyEnv,config.providers);
    if(!configured)return;
    // Scope comes from the adapter's request snapshot, so a native endpoint edit
    // also changes the cache key. No schema extension or source patch is needed.
    return desktopCacheKeyOptions({...configured,provider:scope.provider,api:scope.api,baseURL:scope.baseURL},
      {id:scope.model},{sessionId:scope.sessionId}).onPayload;
  });
}
