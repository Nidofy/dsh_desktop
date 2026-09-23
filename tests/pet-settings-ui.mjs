// Settings controller contracts; native enable/disable/quit is checked separately.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile('shell-ui/index.html','utf8');
const elements=new Map([...html.matchAll(/id="(pet-[^"]+)"/g)].map(([,id])=>[id,{value:'',checked:false,textContent:'',replaceChildren(){},append(){}}]));
elements.get('pet-template-state').value='WAITING_INPUT';
let stored={schemaVersion:3,enabled:false,instances:[{id:'1',enabled:true,resource:'xiaojing',scale:1,interaction:true,look:true,moodEnabled:false,affinity:0,bubble:{placement:'top',fontSize:14,durationMs:5000,theme:'dark',templates:{}}}]};
let nextFailure=false,warning=null,writes=[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const invoke=async(name,args)=>{
 if(name==='pet_packages')return {items:[{id:'xiaojing',displayName:'吃白饭的大肥鱼'}]};
 assert.equal(name,'pet_settings');
 if(args.settings){
  const call={...structuredClone(args)};writes.push(call);
  await tick();
  if(nextFailure){nextFailure=false;throw Error('桌宠窗口无法打开');}
  stored=structuredClone(args.settings);
 }
 return {config:structuredClone(stored),warning};
};
vm.runInNewContext(await readFile('shell-ui/pets-settings.js','utf8'),{document:{getElementById:id=>elements.get(id),createElement:()=>({})},window:{__TAURI__:{core:{invoke}}},structuredClone,Date,console});
await tick();
const enable=elements.get('pet-enabled');enable.checked=true;enable.onchange();
assert.match(elements.get('pet-status').textContent,/正在应用/);
// A second input during native window creation must not be dropped or replace
// the first write's baseline with unacknowledged state.
elements.get('pet-scale').onchange({target:{type:'select-one',value:'1.5'}});
await tick();await tick();await tick();
assert.equal(writes.length,2);
assert.equal(writes[0].base.enabled,false);
assert.equal(writes[1].base.enabled,true);
assert.equal(writes[1].base.instances[0].scale,1);
assert.equal(stored.instances[0].scale,1.5);
assert.match(elements.get('pet-status').textContent,/已启用 1 只/);
nextFailure=true;enable.checked=false;enable.onchange();await tick();await tick();
assert.match(elements.get('pet-status').textContent,/桌宠窗口无法打开/);
assert.equal(enable.checked,true,'failed change reloads confirmed configuration');
warning='配置已恢复，请检查位置';enable.checked=false;enable.onchange();await tick();await tick();
assert.equal(elements.get('pet-status').textContent,warning,'save warning must not become success');
console.log('PASS pet settings: pending changes, acknowledged baseline, errors and recovery warnings');
