import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ADAPTER_SHA256 = '1f787eb5cd3d0308e7a2563cdb2b8cc2c1fc153fe06b55d39439fb2446059483';
export function cacheKeyBridgeRequired(patch) {
  if(!Array.isArray(patch))throw Object.assign(Error('DESKTOP_CACHE_KEY_POLICY_INVALID'),{code:'DESKTOP_CACHE_KEY_POLICY_INVALID'});
  let required=false;
  for(const item of patch){
    if(item?.id!=='llm-pi-ai')continue;
    for(const profile of Object.values(item.config?.providers??{})){
      const policy=profile?.desktopCacheKey;
      if(policy===undefined||policy?.mode==='native')continue;
      if(profile.api!=='openai-completions'||!['off','session'].includes(policy?.mode))
        throw Object.assign(Error('DESKTOP_CACHE_KEY_POLICY_UNSUPPORTED'),{code:'DESKTOP_CACHE_KEY_POLICY_UNSUPPORTED'});
      if(policy.mode==='session'&&(!Array.isArray(policy.models)||!policy.models.length||policy.models.some(model=>typeof model!=='string'||!model)))
        throw Object.assign(Error('DESKTOP_CACHE_KEY_POLICY_INVALID'),{code:'DESKTOP_CACHE_KEY_POLICY_INVALID'});
      required=true;
    }
  }
  return required;
}
export function configureCacheKeyBridge(runtimeRoot,patch){
  if(!cacheKeyBridgeRequired(patch))return {status:'not-requested',hook:null};
  // Native mode never reads or modifies the pinned adapter. Explicit off also
  // needs this bridge: suppressing an upstream key is a request behavior.
  return {status:'installed',hook:installCacheKeyBridge(runtimeRoot)};
}
export function extendCacheKeyAdapter(source, helperUrl) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (createHash('sha256').update(bytes).digest('hex') !== ADAPTER_SHA256) throw Error('DESKTOP_CACHE_KEY_ADAPTER_MISMATCH');
  let result = bytes.toString('utf8');
  const edits = [
    ['\tcacheRetention: z.union([', '\tdesktopCacheKey: z.object({ mode: z.union(["native", "off", "session"]).default("native"), models: z.array(z.string()).default([]) }),\n\tcacheRetention: z.union(['],
    ['...profileOptions(profile, reasoning, apiKey),', '...profileOptions(profile, reasoning, apiKey),\n\t\t\t\t...desktopCacheKeyOptions(profile, model, options),'],
  ];
  for (const [before, after] of edits) {
    if (result.split(before).length !== 2) throw Error('DESKTOP_CACHE_KEY_ADAPTER_ANCHOR_MISMATCH');
    result = result.replace(before, after);
  }
  return `import {desktopCacheKeyOptions} from ${JSON.stringify(helperUrl)};\n` + result;
}
export function installCacheKeyBridge(runtimeRoot) {
  const filename = join(runtimeRoot,'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
  const target = pathToFileURL(filename).href;
  // Validate before the CLI initializes so an upstream upgrade cannot silently
  // drop the setting. This narrowly pinned in-memory extension never writes to
  // node_modules, intercepts fetch, or patches another provider SDK.
  extendCacheKeyAdapter(readFileSync(filename),new URL('./desktop-cache-key.mjs',import.meta.url).href);
  return registerHooks({load(url,context,nextLoad) {
    const loaded = nextLoad(url,context);
    if (url !== target) return loaded;
    return {...loaded, source:extendCacheKeyAdapter(loaded.source,new URL('./desktop-cache-key.mjs',import.meta.url).href)};
  }});
}
