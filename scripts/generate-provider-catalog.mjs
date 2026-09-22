// Build-time catalog from the exact DSH dependency shipped with this desktop.
import {builtinProviders,getBuiltinModels} from '../runtime/dsh/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
import {writeFile,mkdir} from 'node:fs/promises';
const ids=['deepseek','zai-coding-cn','zai','anthropic','minimax-cn','minimax','kimi-coding','moonshotai-cn','moonshotai','qwen-token-plan-cn','qwen-token-plan','xiaomi','cerebras'];
const labels={'zai-coding-cn':'智谱 Coding Plan（中国）','zai':'Z.AI Coding Plan（国际）','minimax-cn':'MiniMax（中国）','minimax':'MiniMax（国际）','moonshotai-cn':'Moonshot（中国）','moonshotai':'Moonshot（国际）','qwen-token-plan-cn':'阿里云 Token Plan（中国）'};
const preferred={deepseek:'deepseek-v4-flash','zai-coding-cn':'glm-5.3',zai:'glm-5.3'};
const catalog=ids.map(id=>{
  const provider=builtinProviders().find(p=>p.id===id),all=getBuiltinModels(id);
  const first=all.find(m=>m.id===preferred[id])??all[0];
  if(!provider||!first||!['openai-completions','anthropic-messages'].includes(first.api))throw Error('Unsupported provider '+id);
  const models=all.filter(m=>m.api===first.api&&m.baseUrl===first.baseUrl).map(m=>({
    id:m.id,name:m.name,contextWindow:m.contextWindow,maxTokens:Math.min(m.maxTokens,m.contextWindow-1),
    // The native route inherits reasoning, modalities and vendor-specific
    // compatibility from DSH instead of copying it into a generic provider.
  }));
  if(!models.length||models.length>100)throw Error('Invalid provider catalog '+id);
  return {id,name:labels[id]??provider.name,baseUrl:first.baseUrl,api:first.api,model:first.id,models};
});
await mkdir('src-tauri/generated',{recursive:true});
await writeFile('src-tauri/generated/provider-catalog.json',JSON.stringify(catalog,null,2)+'\n');
await writeFile('shell-ui/provider-catalog.js','window.desktopProviderCatalog = '+JSON.stringify(catalog)+';\n');
console.log('Generated '+catalog.length+' bundled provider presets.');

