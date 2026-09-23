import {frameAt} from './animation.js';
import {Presentation,bubbles} from './state.js';
import {Gestures,LookDirection} from './gestures.js';
import {IdleSchedule,bubbleText,idleMood} from './idle.js';
import {DragQueue} from './drag.js';
import builtinManifest from './assets/xiaojing/manifest.js';
import builtinExtension from './assets/xiaojing/extensions/manifest.js';
const {invoke}=window.__TAURI__.core,{listen}=window.__TAURI__.event;
invoke('pet_ready',{decoded:false}).catch(()=>{});
const canvas=document.querySelector('canvas'),context=canvas.getContext('2d'),bubble=document.querySelector('#bubble');
const image=async src=>{const i=new Image();i.src=src;await i.decode();return i;};
const builtinAtlas=await image('assets/xiaojing/spritesheet.webp'),builtinImages={};
for(const a of builtinExtension.animations)builtinImages[a.atlasPath]=await image('assets/xiaojing/extensions/'+a.atlasPath);
let manifest=builtinManifest,extension=builtinExtension,atlas=builtinAtlas,images=builtinImages,resource='xiaojing',assetGeneration=0,assetWarning='';
const model=new Presentation(),look=new LookDirection(),idle=new IdleSchedule();let timer,start=Date.now(),action='',lastFrame=Date.now(),bubbleVisible=false,hover=null,scale=1,nativeDragging=false,neutralUntil=0;
const command=(action,target=model.target())=>invoke('pet_action',{action,target}).catch(()=>{bubble.textContent='会话暂不可用';});
async function loadResource(id){const generation=++assetGeneration;resource=id;assetWarning='';
 try{if(id==='xiaojing'){canvas.setAttribute('aria-label','吃白饭的大肥鱼');manifest=builtinManifest;extension=builtinExtension;atlas=builtinAtlas;images=builtinImages;}else{const data=await invoke('pet_resource'),nextAtlas=await image(data.images[data.atlas]),nextImages={};for(const a of data.interactions?.animations??[])nextImages[a.atlasPath]=await image(data.images[a.atlasPath]);if(generation!==assetGeneration)return;manifest=data.manifest;extension=data.interactions??{animations:[],triggers:{},idleVariants:[]};atlas=nextAtlas;images=nextImages;canvas.setAttribute('aria-label',data.displayName);}}
 catch{if(generation!==assetGeneration)return;manifest=builtinManifest;extension=builtinExtension;atlas=builtinAtlas;images=builtinImages;assetWarning='已使用内置宠物';}
 if(generation!==assetGeneration)return;model.reaction=null;hover=null;action='';draw();
}
function settings(s){const changed=s.resource!==resource;model.settingsChanged(s);scale=s.scale??1;canvas.style.width=192*scale+'px';canvas.style.height=208*scale+'px';bubble.style.fontSize=(s.bubble?.fontSize??14)*scale+'px';bubble.dataset.theme=s.bubble?.theme??'dark';bubble.dataset.placement=s.bubble?.placement??'top';bubbleVisible=null;if(changed)void loadResource(s.resource);draw();}
function draw(){
 clearTimeout(timer);if(document.hidden)return;
 if(Date.now()-lastFrame>6000){model.row=null;model.frame=null;model.reaction=null;}
 let name=model.animation();
 const moodVariants=idleMood(model.settings,Date.now())==='happy'&&extension.animations.some(a=>a.id==='happy')?['happy']:(extension.idleVariants??[]);
 const variant=idle.choose(moodVariants,name!=='idle'||!!hover);
 if(name==='idle'&&variant){if(variant==='neutral'&&manifest.rows===11){neutralUntil=Date.now()+(idleMood(model.settings,Date.now())==='resting'?3000:1200);}else if(variant!=='neutral'){model.reaction={id:variant,kind:'idle'};name=variant;}}
 if(name!==action){action=name;start=Date.now();}
 const extra=extension.animations.find(a=>a.id===name);let animation=extra?{...extra,frameCount:extra.frames.length}:manifest.animations.find(a=>a.id===name)??manifest.animations[0];if(model.reaction?.kind==='idle')animation={...animation,loop:false};let frame=frameAt(animation,Date.now()-start);
 if(frame.done){model.reaction=null;action='';draw();return;}
 const observation=name==='idle'&&manifest.rows===11?(model.settings.look&&hover?hover:Date.now()<neutralUntil?{row:0,column:6}:null):null;
 const cell=extra?extra.frames[frame.column]:observation??{column:frame.column,row:animation.row};
 const texture=extra?images[extra.atlasPath]:atlas,w=extra?.cellWidth??192,h=extra?.cellHeight??208;
 context.clearRect(0,0,192,208);context.drawImage(texture,cell.column*w,cell.row*h,w,h,0,0,192,208);
 const text=model.bubble()?bubbleText(model.row.status,bubbles,model.settings.bubble?.templates):assetWarning; bubble.textContent=text;bubble.hidden=!text;bubble.style.maxWidth=232*scale+'px';bubble.style.maxHeight=128*scale+'px';
 const height=text?Math.ceil(bubble.getBoundingClientRect().height/scale):0;
 if(height!==bubbleVisible){bubbleVisible=height;command('bubble-size',{height});}
 timer=setTimeout(draw,observation?150:Math.max(16,Math.ceil(frame.remaining)));
}
const dispose=await listen('pet-state',e=>{lastFrame=Date.now();model.accept(e.payload);if(model.row&&model.reaction?.kind==='idle')model.reaction=null;draw();});
const disposeSettings=await listen('pet-settings',e=>settings(e.payload));
const disposeResource=await listen('pet-resource-changed',()=>loadResource(model.settings.resource));
const snapshot=await invoke('pet_snapshot');settings(snapshot.settings);model.accept(snapshot.state);await loadResource(snapshot.settings.resource);draw();
function react(trigger){if(!model.settings.interaction)return;const fallback={'head-tap':'waving','long-press':'waving','body-tap':'jumping'},id=extension.triggers[trigger]??fallback[trigger];model.interact(id);command('interact');draw();}
const dragging=new DragQueue((action,target)=>invoke('pet_action',{action,target}),()=>{nativeDragging=false;model.drag=null;gesture.reset();bubble.textContent='拖动未完成，请重试';draw();},()=>{bubbleVisible=null;draw();});
const gesture=new Gestures((kind,p)=>{
 if(kind==='double')command('navigate');
 if(kind==='tap')react(p.y<5+198*.4?'head-tap':'body-tap');
 if(kind==='long')react('long-press');
 if(kind==='drag'){nativeDragging=true;model.drag=model.settings.interaction?(extension.triggers.drag??(p.dx<0?'running-left':'running-right')):p.dx<0?'running-left':'running-right';dragging.start();draw();}
 if(kind==='drag-move')dragging.move();
 if(kind==='drag-end'||kind==='drag-cancel'){dragging.finish();nativeDragging=false;model.drag=null;draw();}
},{doubleMs:snapshot.doubleMs||350});
const point=e=>{const b=canvas.getBoundingClientRect();return {id:e.pointerId,type:e.pointerType,button:e.button,x:(e.clientX-b.left)/scale,y:(e.clientY-b.top)/scale};};
canvas.addEventListener('pointerdown',e=>{gesture.down(point(e));if(gesture.active){dragging.prepare({x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);}});
canvas.addEventListener('pointermove',e=>{const p=point(e);gesture.move(p);if(!gesture.active&&['mouse','pen'].includes(e.pointerType)&&!e.buttons){hover=look.update(p.x-96,p.y-104);draw();}});
canvas.addEventListener('pointerup',e=>{gesture.up(point(e));dragging.finish();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);});
const cancelPointer=()=>{gesture.reset();dragging.finish();};
canvas.addEventListener('pointercancel',cancelPointer);canvas.addEventListener('lostpointercapture',()=>{if(gesture.active)cancelPointer();});window.addEventListener('blur',cancelPointer);
canvas.addEventListener('pointerleave',()=>{hover=null;look.reset();draw();});bubble.onclick=()=>command('navigate');
const menu=document.createElement('div');menu.id='menu';menu.hidden=true;for(const [name,label]of [['pin','固定当前会话'],['unpin','自动跟随'],['hide','隐藏这只宠物']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>{menu.hidden=true;command(name);};menu.append(button);}document.body.append(menu);
canvas.addEventListener('contextmenu',e=>{e.preventDefault();gesture.reset();menu.hidden=!menu.hidden;});
document.addEventListener('visibilitychange',()=>{start=Date.now();model.reaction=null;cancelPointer();draw();});
window.addEventListener('pagehide',()=>{clearTimeout(timer);cancelPointer();dispose();disposeSettings();disposeResource();});
invoke('pet_ready',{decoded:true}).catch(()=>{});
