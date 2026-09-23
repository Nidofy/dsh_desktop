import {desktopCacheKeyOptions} from './desktop-cache-key.mjs';
import {cacheKeyBridgeRequired} from './desktop-cache-key-bridge.mjs';
export const name='desktop-source-cache';
export function apply(ctx,config) {
  cacheKeyBridgeRequired([{id:'llm-pi-ai',config}]);
  ctx.on('llm-pi-ai/prepare-payload',scope=>{
    const configured=config.providers?.[scope.provider];
    if(!configured)return;
    // Scope comes from the adapter's request snapshot, so a native endpoint edit
    // also changes the cache key. No schema extension or source patch is needed.
    return desktopCacheKeyOptions({...configured,provider:scope.provider,api:scope.api,baseURL:scope.baseURL},
      {id:scope.model},{sessionId:scope.sessionId}).onPayload;
  });
}
