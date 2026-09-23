import {readHarnessSetting} from './harness-settings.mjs';
import {cacheKeyBridgeRequired} from './desktop-cache-key-bridge.mjs';
import {diagnosticState} from './diagnostic-state.mjs';
let context,policies,revision=-1,busy=false;
const secrets=new Map();
const managed=/^desktop-(?:legacy|p-[a-f0-9]{32})$/;
const keyName=/^DSH_DESKTOP_PROVIDER_KEY_R\d{1,16}_(?:legacy|[a-f0-9]{32})$/;
export function ownsSourceCredential(ref){return keyName.test(ref);}
export function sourceCredential(ref){const value=secrets.get(ref);return value?{value,source:'windows-supervisor'}:undefined;}
export function sourceProviderPolicies(fallback){return policies??fallback;}
export function installSourceProviderControl(ctx,initialPolicies){context=ctx;policies??=structuredClone(initialPolicies??{});ctx.effect(()=>()=>{if(context===ctx)context=undefined;});}
export function receiveSourceKeys(keys){
  if(!keys||typeof keys!=='object'||Array.isArray(keys)||Object.keys(keys).length>64)throw Error('SOURCE_PROVIDER_KEYS_INVALID');
  for(const [name,key] of Object.entries(keys))if(!keyName.test(name)||typeof key!=='string'||key.length>16384||key.includes('\0'))throw Error('SOURCE_PROVIDER_KEYS_INVALID');
  for(const [name,key] of Object.entries(keys))if(secrets.has(name)&&secrets.get(name)!==key)throw Error('SOURCE_PROVIDER_KEY_IMMUTABLE');
  for(const [name,key] of Object.entries(keys))secrets.set(name,key);
}
// Private supervisor pipe only. Keys never enter the profile or response. Native
// settings remain the live writer and reconcile volatile LLM config in place.
export async function sourceProviderControl(request,write=line=>process.stdout.write(line)){
  const id=request?.id,epoch=request?.epoch;
  if(!/^[a-f0-9]{32}$/.test(id??'')||epoch!==process.env.DSH_DESKTOP_SETTINGS_OWNER)return;
  let ok=false,code='SOURCE_PROVIDER_UPDATE_FAILED';
  if(busy){write('dsh control: '+JSON.stringify({id,epoch,ok:false,code:'SOURCE_PROVIDER_BUSY'})+'\n');return;}
  busy=true;
  try{
    const {providers,selection,keys}=request;
    if(!context?.settings||!Number.isSafeInteger(request.revision)||request.revision<=revision||!providers||typeof providers!=='object'||Array.isArray(providers)||Object.keys(providers).length>32||!managed.test(selection?.provider??'')||!providers[selection.provider]?.models?.some(model=>model.id===selection.model))throw Error();
    for(const [route,provider] of Object.entries(providers))if(!managed.test(route)||!keyName.test(provider?.apiKeyEnv??'')||!Object.hasOwn(keys??{},provider.apiKeyEnv)||Object.hasOwn(provider,'apiKey'))throw Error();
    cacheKeyBridgeRequired([{id:'llm-pi-ai',config:{providers}}]);
    const oldProviders=structuredClone(readHarnessSetting(context,'llm-pi-ai')??{providers:{}});
    const oldSelection=structuredClone(readHarnessSetting(context,'agent-default-model'));
    const nextProviders=Object.fromEntries(Object.entries(oldProviders.providers).filter(([route])=>!managed.test(route)));
    for(const [route,value] of Object.entries(providers)){const clean=structuredClone(value);delete clean.desktopCacheKey;nextProviders[route]=clean;}
    receiveSourceKeys(keys);
    try{
      await context.settings.replace('llm-pi-ai',{providers:nextProviders});
      await context.settings.replace('agent-default-model',selection);
    }catch{
      try{await context.settings.replace('llm-pi-ai',oldProviders);if(oldSelection)await context.settings.replace('agent-default-model',oldSelection);}catch{code='SOURCE_PROVIDER_RECOVERY_REQUIRED';}
      throw Error();
    }
    policies=structuredClone(providers);revision=request.revision;
    diagnosticState.retiredManagedProviders=[...new Set([...(diagnosticState.retiredManagedProviders??[]),...Object.keys(oldProviders.providers).filter(route=>managed.test(route)&&!providers[route])])].filter(route=>!providers[route]);
    diagnosticState.managedModels={provider:selection.provider,models:providers[selection.provider].models.map(model=>model.id),defaultModel:selection.model};
    diagnosticState.managedProvider=selection.provider;
    diagnosticState.providerConfiguration=JSON.stringify(providers[selection.provider]);
    ok=true;
  }catch{}finally{busy=false;}
  write('dsh control: '+JSON.stringify({id,epoch,ok,...(!ok?{code}:{})})+'\n');
}
