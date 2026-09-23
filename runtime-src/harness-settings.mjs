// Settings APIs differ between the two explicitly supported Harness versions.
export function readHarnessSetting(ctx, name) {
  const settings=ctx.get('settings');
  if(!settings)return undefined;
  if(typeof settings.get==='function')return settings.get(name);
  return settings.describe().find(row=>row.ns===name)?.value;
}

export function installHarnessSettings(ctx,name,schema,config,validate=()=>{}) {
  if(typeof ctx.settings.installSection==='function') {
    let current=()=>config;
    ctx.settings.installSection(ctx,name,schema,config,{setSource:source=>{current=source;},onChange:()=>{},validate});
    return ()=>current();
  }
  const current=()=>Object.fromEntries(Object.entries(config).map(([key,value])=>[key,value.get()]));
  validate(current());
  ctx.on('internal/config',function(_raw,next){
    const raw=next();
    if(this===ctx.fiber){
      const resolved=schema(raw);
      validate(Object.fromEntries(Object.entries(resolved).map(([key,value])=>[key,typeof value?.get==='function'?value.get():value])));
    }
    return raw;
  });
  return current;
}
