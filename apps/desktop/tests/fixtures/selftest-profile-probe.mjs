/** Test-only observation of the full Host's actual model and Agent entry points. */
export const name='selftest-profile-qualification'
export const inject=['connection','agents','llm']
export function apply(ctx){
  let modelRequests=0,createdAgents=0
  ctx.on('llm/stream',(_options,next)=>{modelRequests++;return next()})
  ctx.on('agent/created',()=>{createdAgents++})
  ctx.on('connection/request',async(request,response,next)=>{
    if(new URL(request.url??'/','http://localhost').pathname!=='/api/selftest-qualification')return next()
    response.setHeader('content-type','application/json');response.end(JSON.stringify({modelRequests,createdAgents}))
  })
  ctx.effect(()=>{
    const collect=message=>{
      if(message?.type!=='collect')return
      const available=typeof globalThis.gc==='function'
      if(available)globalThis.gc()
      process.send?.({type:'collected',available})
    }
    process.on('message',collect);return()=>process.off('message',collect)
  })
}
