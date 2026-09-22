const ids=new Set(['pat','happy','dragged']),triggers=new Set(['head-tap','body-tap','long-press','drag']);
export function validateInteractions(value,dimensions){
 if(value?.schemaVersion!==1||!Array.isArray(value.animations)||value.animations.length>24)throw Error('不支持的互动格式');
 const seen=new Set();
 for(const a of value.animations){
  if(typeof a.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(a.id)||seen.has(a.id))throw Error('互动动作无效');seen.add(a.id);
  if(typeof a.atlasPath!=='string'||!/^[a-zA-Z0-9_-]+\.(png|webp)$/.test(a.atlasPath)||!dimensions[a.atlasPath])throw Error('互动图像无效');
  if(!Number.isInteger(a.cellWidth)||!Number.isInteger(a.cellHeight)||a.cellWidth<1||a.cellHeight<1||a.cellWidth>512||a.cellHeight>512||!Array.isArray(a.frames)||a.frames.length<1||a.frames.length>32||a.frames.length!==a.durationsMs?.length||typeof a.loop!=='boolean')throw Error('互动帧无效');
  const [w,h]=dimensions[a.atlasPath];
  for(const f of a.frames)if(!Number.isInteger(f.row)||!Number.isInteger(f.column)||f.row<0||f.column<0||(f.column+1)*a.cellWidth>w||(f.row+1)*a.cellHeight>h)throw Error('互动裁切越界');
  if(a.durationsMs.some(t=>!Number.isInteger(t)||t<40||t>5000))throw Error('互动时长无效');
 }
 for(const [trigger,id]of Object.entries(value.triggers??{}))if(!triggers.has(trigger)||!seen.has(id))throw Error('互动触发器无效');
 for(const id of value.idleVariants??[])if(!seen.has(id)||ids.has(id))throw Error('待机动作无效');
 return value;
}
