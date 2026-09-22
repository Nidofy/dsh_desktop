// Narrow fix for the pinned Web composition: the bound port is ephemeral.
// Keep the native orientation prose, but deliver its URL through DSH's durable
// runtime-context snapshots instead of changing the system prompt on restart.
const contextName='desktop:web-endpoint';
const sectionName='app:web-surface';
const introduction='You are interacting with the user through the DeepSeek Harness Web GUI at ';
export function stabilizeWebSurface(assembly,url){
  const endpoint=assembly.contexts.find(context=>context.name===contextName);
  // A preset can suppress runtime context. In that case preserve the native
  // section, since there would be no context in which to deliver the address.
  if(!endpoint)return assembly;
  const prefix=introduction+url+'.';
  const section=assembly.sections.find(section=>section.name===sectionName);
  if(!section?.text.startsWith(prefix))return {...assembly,contexts:assembly.contexts.filter(context=>context.name!==contextName)};
  return {...assembly,sections:assembly.sections.map(section=>section.name===sectionName?{
    ...section,text:introduction+'the URL in the current desktop runtime context.'+section.text.slice(prefix.length),
  }:section)};
}
export function installPromptStability(ctx){
  ctx.inject(['systemPrompt','webServer'],promptCtx=>{
    const url=()=>`http://127.0.0.1:${promptCtx.webServer.port}`;
    promptCtx.systemPrompt.context({name:contextName,order:100,
      text:()=>`Current DSH Desktop Web GUI URL: ${url()}. This address supersedes earlier desktop GUI addresses. It contains no authentication token.`,
    });
    promptCtx.on('system-prompt/assemble',async(_assembly,_context,next)=>stabilizeWebSurface(await next(),url()));
  });
}
